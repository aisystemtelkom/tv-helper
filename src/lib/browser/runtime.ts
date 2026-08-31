"use client";

/**
 * The browser runtime: the pipeline `pnpm generate` runs headlessly in Node,
 * run instead inside the operator's own browser, with every run persisted on
 * the device.
 *
 * This is the whole public surface. Everything under `src/lib/browser/` other
 * than this file is an implementation detail, and `src/lib/storage/runs.ts`
 * is the IndexedDB layer under it.
 *
 * Three invariants hold this together. Each of them exists because breaking
 * it produces a run that still opens, still looks complete, and carries the
 * wrong evidence:
 *
 *  1. `BrowserRun.pages` is APPEND-ONLY. A zone's `pageIndex` is a position
 *     in it, so ingesting a dokumen tambahan adds to the end and never
 *     reorders or removes.
 *  2. INGESTING IS ADDITIVE. A later document can only add pages and fill
 *     slots; it never touches a zone an operator already confirmed. That is
 *     the foundation of the dokumen tambahan loop (2026-08-31 corrections,
 *     section 4).
 *  3. NO RENDERED PAGE IS KEPT. An upright 300 DPI page is 2480x3507, about
 *     35MB as RGBA, and a bundle is 29 of them. What is stored is OCR lines;
 *     pixels are produced on demand by `pageBitmap` and are the caller's to
 *     release.
 *
 * What this module does NOT do: it never asks the model anything. Slots are
 * seeded `"pending"` and stay there until something else -- a server route,
 * since `src/lib/model.ts` is the only file that may know how the model is
 * reached -- proposes a zone and writes the run back through `saveRun`.
 */

import { AO_TEMPLATE, type Template } from "../forms/template.ts";
import {
  appendPage,
  getPage,
  getRun,
  listRunMeta,
  putRun,
  putSource,
  deleteRun as deleteRunRecords,
  type RunMeta,
} from "../storage/runs.ts";
import { ingestSource, renderPageBitmap } from "./worker-client.ts";
import type {
  BrowserRun,
  RunSource,
  SlotState,
  StoredPage,
} from "./types.ts";

export type {
  BrowserRun,
  RunSource,
  SlotState,
  SlotStatus,
  StoredPage,
} from "./types.ts";

/**
 * Separates a multi-capture slot's ordinal from its template key. See
 * `SlotState.key`: the sample's ToP row holds two pictures cut from two
 * different pages, and one `SlotState` per slot would silently ship one of
 * them.
 */
const CAPTURE_SEPARATOR = "#";

/** The template key behind a `SlotState.key`, ordinal suffix removed. */
export function slotKeyOf(slotStateKey: string): string {
  const cut = slotStateKey.lastIndexOf(CAPTURE_SEPARATOR);
  return cut === -1 ? slotStateKey : slotStateKey.slice(0, cut);
}

/**
 * One `SlotState` per capture the template asks for, all `"pending"`.
 *
 * Non-fillable slots are left out. The sample ships MOM, BASO, BA Splitting,
 * SBR Pricing and BA Penjelasan Order as deliberately empty sections that the
 * operator completes by hand; putting them in the work list would ask the
 * operator to hunt for evidence that is known not to be in the bundle.
 * `scripts/generate.mjs` skips them on the same test.
 */
export function seedSlots(template: Template = AO_TEMPLATE): SlotState[] {
  const slots: SlotState[] = [];

  for (const section of template.sections) {
    for (const slot of section.slots) {
      if (!slot.fillable) continue;
      const captures = slot.crops ?? 1;
      if (captures === 1) {
        slots.push({ key: slot.key, label: slot.label, status: "pending" });
        continue;
      }
      for (let n = 1; n <= captures; n++) {
        slots.push({
          key: `${slot.key}${CAPTURE_SEPARATOR}${n}`,
          label: `${slot.label} (${n})`,
          status: "pending",
        });
      }
    }
  }

  return slots;
}

/**
 * The slots that were searched and not found: the list the operator is asked
 * "is there a dokumen tambahan for these?" about.
 *
 * `"pending"` is deliberately excluded. A slot nobody has looked for yet is
 * not evidence that is missing, and offering it as one would ask the operator
 * to supply documents for work that has not been done -- and, at the end of a
 * run, would let an unsearched slot ship as a considered blank.
 */
export function outstandingSlots(run: BrowserRun): SlotState[] {
  return run.slots.filter((slot) => slot.status === "outstanding");
}

/**
 * One freshly OCR'd page folded into a run.
 *
 * Exported because this is where "additive" is actually implemented, and an
 * invariant that only exists inside a function that needs IndexedDB, a Web
 * Worker and a real PDF to reach is an invariant nothing checks. Everything
 * it must not do is testable here in isolation:
 *
 *  - it APPENDS. Earlier pages keep their positions, so `Zone.pageIndex`
 *    keeps meaning what it meant.
 *  - it does not touch `slots`. A dokumen tambahan cannot cost the operator a
 *    zone they already confirmed.
 *  - it does not touch other sources, and records `pageCount` on this one
 *    from the document's own length rather than from how far the ingest has
 *    got, so an interrupted run says how long the document is.
 */
export function withAppendedPage(
  run: BrowserRun,
  page: StoredPage,
  sourcePageCount: number,
): BrowserRun {
  return {
    ...run,
    sources: run.sources.map((source) =>
      source.id === page.sourceId
        ? { ...source, pageCount: sourcePageCount }
        : source,
    ),
    pages: [...run.pages, page],
  };
}

function newRun(id: string): BrowserRun {
  return {
    id,
    createdAt: Date.now(),
    sources: [],
    pages: [],
    slots: seedSlots(),
  };
}

/** A run's small half, listed field by field so tsc names anything new. */
function metaOf(run: BrowserRun): RunMeta {
  return {
    id: run.id,
    createdAt: run.createdAt,
    sources: run.sources,
    slots: run.slots,
  };
}

function labelFor(sources: RunSource[]): string {
  if (sources.length === 0) return "(no documents yet)";
  const [first, ...rest] = sources;
  return rest.length === 0 ? first.name : `${first.name} +${rest.length} more`;
}

/**
 * Serialises this tab's writes per run.
 *
 * `saveRun` replaces a run wholesale, so two writes that overlap would end
 * with whichever finished last, silently discarding the other's pages. An
 * ingest writes after every page for minutes on end, which is exactly when a
 * UI is most likely to save a slot edit as well.
 *
 * It does NOT protect against a caller that saves a `BrowserRun` it captured
 * before an ingest started: that object genuinely does not have the new
 * pages, and no lock can invent them. Re-read with `loadRun` after an
 * `ingestDocument` resolves.
 */
const locks = new Map<string, Promise<unknown>>();

function withRunLock<T>(runId: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(runId);
  const result = previous ? previous.then(action, action) : action();
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  locks.set(runId, tail);
  void tail.then(() => {
    if (locks.get(runId) === tail) locks.delete(runId);
  });
  return result;
}

export async function listRuns(): Promise<
  { id: string; createdAt: number; label: string }[]
> {
  const meta = await listRunMeta();
  return meta.map((run) => ({
    id: run.id,
    createdAt: run.createdAt,
    label: labelFor(run.sources),
  }));
}

export async function loadRun(id: string): Promise<BrowserRun | null> {
  return getRun(id);
}

export async function saveRun(run: BrowserRun): Promise<void> {
  await withRunLock(run.id, () => putRun(run));
}

/** An empty run, persisted, with every fillable slot seeded `"pending"`. */
export async function createRun(id: string = crypto.randomUUID()): Promise<BrowserRun> {
  const run = newRun(id);
  await withRunLock(id, () => putRun(run));
  return run;
}

/** Deletes a run, its pages, and the PDFs it holds. */
export async function deleteRun(id: string): Promise<void> {
  await withRunLock(id, () => deleteRunRecords(id));
}

/**
 * Renders and OCRs every page of `file` in a Web Worker and APPENDS them to
 * the run.
 *
 * Additive, always. Existing pages keep their positions, so every zone
 * already found or confirmed still points where it did; slots are untouched
 * here entirely. Uploading a second document can therefore never cost the
 * operator work they have already accepted, which is what makes the dokumen
 * tambahan loop safe to run as many times as the operator has documents.
 *
 * The run is created if `runId` names one that does not exist yet, so a UI
 * can mint an id and ingest in one step.
 *
 * Each page is persisted as it finishes rather than at the end. A 29-page
 * bundle is minutes of OCR, and a tab reloaded partway through should keep
 * the pages it has already paid for. That also means an interrupted ingest
 * leaves a source whose `pageCount` is larger than the number of pages
 * actually stored for it -- which is the truth, and is visible, rather than a
 * record that claims to be complete.
 *
 * `onProgress` fires per page because OCR of one real page takes 4-5 seconds:
 * without it a bundle looks like a hung tab for several minutes.
 */
export async function ingestDocument(
  runId: string,
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<BrowserRun> {
  const sourceId = crypto.randomUUID();
  const name = file.name || "document.pdf";

  // Stored before the worker is asked for anything: the worker reads the
  // bytes from IndexedDB itself rather than being sent tens of megabytes
  // through postMessage on every request.
  await putSource({ id: sourceId, runId, name, bytes: await file.arrayBuffer() });

  return withRunLock(runId, async () => {
    const loaded = await getRun(runId);
    let run: BrowserRun = loaded ?? newRun(runId);

    const source: RunSource = { id: sourceId, name, pageCount: 0 };
    run = { ...run, sources: [...run.sources, source] };
    await putRun(run);

    // Writes are chained rather than awaited inside the callback: the worker
    // posts page results as it finishes them and does not wait for this side,
    // so two page messages can arrive while an earlier write is still in
    // flight, and IndexedDB writes to one run must not interleave.
    let writes: Promise<void> = Promise.resolve();
    let writeError: unknown;

    try {
      await ingestSource(sourceId, (page, done, total) => {
        const stored: StoredPage = {
          id: crypto.randomUUID(),
          sourceId,
          index: page.index,
          widthPx: page.widthPx,
          heightPx: page.heightPx,
          lines: page.lines,
        };

        const order = run.pages.length;
        // `total` comes with every page message, so the source's length is
        // recorded from the first page on rather than only at the end.
        run = withAppendedPage(run, stored, total);

        const meta = metaOf(run);
        writes = writes.then(() =>
          appendPage(meta, stored, order).catch((error: unknown) => {
            writeError ??= error;
          }),
        );

        onProgress?.(done, total);
      });
    } finally {
      // In a `finally` so a worker that dies mid-bundle still leaves the
      // pages it did finish committed, and so no write outlives the lock
      // that serialises it.
      await writes;
    }

    if (writeError) throw writeError;

    return run;
  });
}

/**
 * A page bitmap for display and for cropping, rendered on demand.
 *
 * Rendered at `DEFAULT_DPI`, the same scale OCR measured every zone box in,
 * so a box maps to bitmap pixels one to one. Nothing is cached: 35MB a page
 * times 29 pages is not a cache, it is the whole memory budget.
 *
 * THE CALLER MUST `close()` THE BITMAP when it is done with it.
 */
export async function pageBitmap(
  runId: string,
  pageId: string,
): Promise<ImageBitmap> {
  const page = await getPage(pageId);
  if (!page) throw new Error(`page ${pageId} is not stored on this device.`);
  // A page from another run would render perfectly and be the wrong document.
  if (page.runId !== runId) {
    throw new Error(
      `page ${pageId} belongs to run ${page.runId}, not ${runId}.`,
    );
  }
  return renderPageBitmap(page.sourceId, page.index);
}
