/**
 * The render-and-OCR Web Worker: the browser half of the headless pipeline
 * `pnpm generate` runs in Node.
 *
 * It exists because the work is measured in minutes. OCR of one real 300 DPI
 * page takes 4-5 seconds and a bundle is 29 pages, so doing this on the main
 * thread would freeze the tab for the whole run.
 *
 * THE BROWSER MUST CONTACT NOTHING BUT THIS APP, and both libraries here
 * default to a CDN if you let them:
 *
 *   - pdf.js keeps its bundled worker. `GlobalWorkerOptions.workerSrc` is
 *     resolved from the installed package through `new URL(..., import.meta.url)`
 *     so the bundler emits it as an app asset. It must never be a CDN URL.
 *   - tesseract.js reads the assets `scripts/vendor-ocr.mjs` copies into
 *     `public/tesseract`. Those paths come from `ocrAssetsFor()` in
 *     `src/lib/pipeline/ocr.ts`, which is also the file that documents why
 *     this worker used to get them silently wrong.
 *
 * Verify with `performance.getEntriesByType("resource")` in the page: zero
 * external hosts, with a document ingested.
 *
 * This module is deliberately thin. Everything decidable is in `ingest.ts`,
 * which takes pdf.js and the canvas as arguments so `node --test` can drive
 * the same loop; what is left here is wiring that only a real browser can
 * execute.
 */

import * as pdfjs from "pdfjs-dist";
import { ocrToLines } from "../pipeline/ocr.ts";
import {
  DEFAULT_DPI,
  renderPageUpright,
  type CanvasFactory,
  type RenderedPage,
} from "../pipeline/render.ts";
import { getSource } from "../storage/runs.ts";
import { ingestPdf, type PdfDocumentLike } from "./ingest.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

/**
 * `DedicatedWorkerGlobalScope` lives in TypeScript's `webworker` lib, and this
 * project compiles with `dom`. Referencing the webworker lib from one file
 * adds it to the whole program and collides with `dom` on dozens of names, so
 * the two members this file actually uses are declared here instead.
 */
type WorkerScope = {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ): void;
};

const scope = globalThis as unknown as WorkerScope;

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/*
 * EXPECT "Warning: Setting up fake worker." IN THE CONSOLE, AND DO NOT CHASE
 * IT. It is not the CDN fallback, and reading it as one sends you after the
 * wrong thing.
 *
 * pdf.js decides whether it may spawn its own worker with
 * `PDFWorker._isSameOrigin(window.location, workerSrc)`. There is no `window`
 * inside a Web Worker, so that line throws ReferenceError, pdf.js catches it,
 * logs "The worker has been disabled." and falls back. It never gets as far as
 * `_createCDNWrapper`, which is the only thing in that function that would
 * reach a third party.
 *
 * So `workerSrc` above is still what gets loaded -- the fake-worker path
 * dynamically imports the very same URL -- and it is still the bundled asset.
 * Confirmed in the network log of a real 29-page ingest: 96 requests, every
 * one of them this origin, `/_next/static/media/pdf.worker.min.*.mjs` among
 * them, and no external host.
 *
 * The real consequence is only that PDF parsing shares this worker's thread
 * instead of getting one of its own, which is nothing next to the 40 seconds
 * a page costs in OCR. Setting `workerSrc` remains correct and required: the
 * fake worker imports it, and pdf.js's own default is a CDN URL.
 */

/**
 * pdf.js creates its own scratch canvases for soft masks and transparency
 * groups, and its default factory calls `document.createElement`. There is no
 * `document` in a worker, so without this a PDF that happens to use either
 * feature throws `document is not defined` from inside the library.
 *
 * pdf.js constructs this itself (`new CanvasFactory({ ownerDocument,
 * enableHWA })`), so it is passed as a class, not an instance.
 */
class OffscreenCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    const canvas = new OffscreenCanvas(width, height);
    return {
      canvas,
      context: canvas.getContext("2d", { willReadFrequently: true }),
    };
  }

  reset(
    canvasAndContext: { canvas: OffscreenCanvas | null },
    width: number,
    height: number,
  ) {
    if (!canvasAndContext.canvas) throw new Error("Canvas is not specified");
    if (width <= 0 || height <= 0) throw new Error("Invalid canvas size");
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: {
    canvas: OffscreenCanvas | null;
    context: unknown;
  }) {
    if (!canvasAndContext.canvas) throw new Error("Canvas is not specified");
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

/**
 * The same no-op filter factory pdf.js gives itself in Node, because a Web
 * Worker has no DOM either and pdf.js does not know that.
 *
 * `pdf.mjs` picks its default with
 * `src.FilterFactory || (isNodeJS ? NodeFilterFactory : DOMFilterFactory)`,
 * and `NodeFilterFactory` is literally `class extends BaseFilterFactory {}` --
 * every method returns "none" and nothing touches a document. A worker is not
 * Node, so it gets `DOMFilterFactory`, whose `#createUrl` reads
 * `this.#document.URL` off an `ownerDocument` that defaulted to a `document`
 * that does not exist.
 *
 * MEASURED, NOT REASONED. Ingesting the real bundle in Chrome, the last page
 * of the two-page SPLITBA scan -- the printed email thread, which is one of
 * the twelve captures -- died with "Cannot read properties of undefined
 * (reading 'URL')" after twenty-eight pages had ingested cleanly. The same
 * page renders without complaint under `pnpm generate`, because Node takes the
 * other branch. That asymmetry is the whole bug: a page that needs a transfer
 * function or an image mask renders headlessly and kills the browser ingest.
 *
 * Matching Node is also the right ANSWER and not merely the convenient one:
 * the browser runtime is meant to produce the same pixels as the headless
 * pipeline, since the zone geometry is measured in them.
 *
 * This is the same shape of defect as `OffscreenCanvasFactory` above, and the
 * lesson generalises: every `*Factory` pdf.js lets you inject exists because
 * its default reaches for a DOM.
 */
class NoFilterFactory {
  addFilter() {
    return "none";
  }
  addHCMFilter() {
    return "none";
  }
  addAlphaFilter() {
    return "none";
  }
  addLuminosityFilter() {
    return "none";
  }
  addKnockoutFilter() {
    return "none";
  }
  addHighlightHCMFilter() {
    return "none";
  }
  addSelectionHCMFilter() {
    return "none";
  }
  addSelectionFilter() {
    return "none";
  }
  createSelectionStyle() {
    return null;
  }
  destroy() {}
}

const makeContext: CanvasFactory = (width, height) => {
  const context = new OffscreenCanvas(width, height).getContext("2d");
  if (!context) throw new Error("OffscreenCanvas gave no 2D context.");
  return context;
};

/**
 * ONE open document at a time, deliberately.
 *
 * pdf.js holds the file's bytes plus its parsed structures, tens of megabytes
 * for a scan bundle. Viewing pages one after another out of the same document
 * is the normal case, so caching one saves re-parsing on every page view;
 * caching more would grow without a bound anyone chose.
 */
let open:
  | { sourceId: string; task: pdfjs.PDFDocumentLoadingTask }
  | undefined;

async function openDocument(sourceId: string): Promise<pdfjs.PDFDocumentProxy> {
  if (open?.sourceId === sourceId) return open.task.promise;

  if (open) {
    const previous = open;
    open = undefined;
    await previous.task.destroy();
  }

  const source = await getSource(sourceId);
  if (!source) {
    throw new Error(
      `source ${sourceId} is not in this device's storage. Documents are ` +
        "never uploaded, so a run opened in a different browser or profile " +
        "has its OCR text but not its pages; the document has to be added " +
        "again.",
    );
  }

  const task = pdfjs.getDocument({
    data: new Uint8Array(source.bytes),
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoFilterFactory,
  });
  open = { sourceId, task };
  return task.promise;
}

async function ocr(page: RenderedPage) {
  // Indonesian: every document in this pipeline is one. `ocrToLines` supplies
  // the vendored asset paths itself through `ocrAssetsFor()`.
  return ocrToLines(page, "ind");
}

/**
 * One page, rendered upright at `DEFAULT_DPI`, as a transferable bitmap.
 *
 * THE DPI IS NOT A DISPLAY CHOICE. Zone boxes are in the pixel space of a page
 * rendered at `DEFAULT_DPI`, because that is what OCR measured them in. A
 * bitmap rendered at any other scale would still draw correctly and would put
 * every rectangle in the wrong place -- including one an operator drew by
 * hand, which would be saved back wrong. Scale for display in CSS, on the
 * page, where the mapping is visible.
 *
 * It goes through `renderPageUpright` rather than repeating its two
 * load-bearing lines (the `/Rotate`-applying viewport, and pdf.js's
 * `canvas: null` requirement) so there is exactly one renderer in this
 * project. The cost is the `getImageData` copy that function makes and this
 * caller does not need; the alternative is a second renderer that can drift
 * from the one the zones were computed against.
 */
async function renderBitmap(
  sourceId: string,
  pageIndex: number,
): Promise<ImageBitmap> {
  const document = await openDocument(sourceId);
  const page = await document.getPage(pageIndex + 1);
  try {
    let context: OffscreenCanvasRenderingContext2D | undefined;
    await renderPageUpright(page, DEFAULT_DPI, (width, height) => {
      const created = makeContext(width, height);
      context = created as OffscreenCanvasRenderingContext2D;
      return created;
    });
    if (!context) throw new Error("renderPageUpright asked for no canvas.");
    return context.canvas.transferToImageBitmap();
  } finally {
    page.cleanup();
  }
}

async function handle(request: WorkerRequest): Promise<void> {
  if (request.kind === "bitmap") {
    const bitmap = await renderBitmap(request.sourceId, request.pageIndex);
    scope.postMessage({ kind: "bitmap", id: request.id, bitmap }, [bitmap]);
    return;
  }

  const pageCount = await ingestPdf(
    {
      // The worker owns document lifetime (see `openDocument`), so this hands
      // back a facade whose `destroy` is a no-op: the operator's next action
      // after an ingest is almost always to look at a page of the document
      // just ingested, and destroying it here would re-parse the whole file
      // to serve that.
      loadDocument: async (): Promise<PdfDocumentLike> => {
        const document = await openDocument(request.sourceId);
        return {
          numPages: document.numPages,
          getPage: (n) => document.getPage(n),
          destroy: async () => {},
        };
      },
      makeContext,
      ocr,
    },
    (page, done, total) => {
      scope.postMessage({ kind: "page", id: request.id, page, done, total });
    },
  );

  scope.postMessage({ kind: "ingested", id: request.id, pageCount });
}

scope.addEventListener("message", (event) => {
  const request = event.data;
  void handle(request).catch((error: unknown) => {
    scope.postMessage({
      kind: "failed",
      id: request.id,
      // The message, not the Error: structured clone strips the prototype,
      // and ocr.ts's asset-path timeout says exactly what to run to fix it.
      message: error instanceof Error ? error.message : String(error),
    });
  });
});
