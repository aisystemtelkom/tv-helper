"use client";

/**
 * The page's side of the render/OCR worker: request/response bookkeeping over
 * `postMessage`.
 *
 * One worker per tab, created on first use rather than at import time, so a
 * page that never ingests a document never pays to spawn it or to load
 * pdf.js and the tesseract wasm behind it.
 */

import type { IngestedPage } from "./ingest.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onPage?: (page: IngestedPage, done: number, total: number) => void;
};

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(message: string) {
  const failed = [...pending.values()];
  pending.clear();
  // The worker is gone; a new request must get a new one rather than post
  // into a dead port and hang forever.
  worker = undefined;
  for (const entry of failed) entry.reject(new Error(message));
}

function ensureWorker(): Worker {
  if (worker) return worker;

  // `new URL(..., import.meta.url)` is what tells the bundler to emit this as
  // a worker chunk of THIS app. A bare string path would be resolved by the
  // browser at runtime against whatever happened to be there.
  const created = new Worker(new URL("./pipeline.worker.ts", import.meta.url), {
    type: "module",
  });

  created.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    // A reply with no waiter means a bug in this file's bookkeeping, not a
    // recoverable condition; dropping it silently would strand the caller.
    if (!entry) return;

    switch (message.kind) {
      case "page":
        entry.onPage?.(message.page, message.done, message.total);
        return;
      case "ingested":
        pending.delete(message.id);
        entry.resolve(message.pageCount);
        return;
      case "bitmap":
        pending.delete(message.id);
        entry.resolve(message.bitmap);
        return;
      case "failed":
        pending.delete(message.id);
        entry.reject(new Error(message.message));
        return;
    }
  });

  // A worker that dies (an uncaught throw, an OOM on a huge scan) otherwise
  // leaves every in-flight promise pending forever, which in a UI reads as a
  // progress bar that simply stops.
  created.addEventListener("error", (event) =>
    failAll(
      `The document worker stopped: ${event.message || "no message"}. ` +
        "Reload and try the document again.",
    ),
  );
  created.addEventListener("messageerror", () =>
    failAll("The document worker sent a message that could not be read."),
  );

  worker = created;
  return created;
}

/**
 * `Omit` over a union collapses it to the properties every member shares, so
 * a plain `Omit<WorkerRequest, "id">` would quietly forbid `pageIndex`. The
 * conditional distributes over the union first.
 */
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

function send<T>(
  request: WithoutId<WorkerRequest>,
  onPage?: Pending["onPage"],
): Promise<T> {
  const id = nextId++;
  const target = ensureWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      onPage,
    });
    target.postMessage({ ...request, id } as WorkerRequest);
  });
}

/** Renders and OCRs every page of a stored source. Resolves with the count. */
export function ingestSource(
  sourceId: string,
  onPage: (page: IngestedPage, done: number, total: number) => void,
): Promise<number> {
  return send<number>({ kind: "ingest", sourceId }, onPage);
}

/**
 * One page as an `ImageBitmap`, rendered on demand.
 *
 * THE CALLER MUST `close()` IT. An upright 300 DPI page is about 35MB, and a
 * browser does not collect a bitmap promptly just because the reference went
 * away; a contact sheet that leaks one per page exhausts memory long before
 * the run is finished.
 */
export function renderPageBitmap(
  sourceId: string,
  pageIndex: number,
): Promise<ImageBitmap> {
  return send<ImageBitmap>({ kind: "bitmap", sourceId, pageIndex });
}
