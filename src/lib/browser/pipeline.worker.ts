/**
 * The render-and-OCR Web Worker: the browser half of the headless pipeline
 * `pnpm generate` runs in Node.
 *
 * It exists because the work is measured in minutes. Rendering a 300 DPI page
 * and getting its text back takes seconds and a bundle is 29 pages, so doing
 * this on the main thread would freeze the tab for the whole run.
 *
 * THE BROWSER MUST CONTACT NOTHING BUT THIS APP, and that property SURVIVES the
 * move to Gemini OCR even though "documents stay on the device" does not. The
 * two were always separate claims and they are worth separating here:
 *
 *   - pdf.js keeps its bundled worker. `GlobalWorkerOptions.workerSrc` is
 *     resolved from the installed package through `new URL(..., import.meta.url)`
 *     so the bundler emits it as an app asset. It must never be a CDN URL. This
 *     rule is untouched by the OCR change: it is about third-party HOSTS in the
 *     request path, not about where a document is processed.
 *   - OCR is a POST of one rendered page image to THIS APP'S OWN `/api/ocr`,
 *     which forwards it to the Gemini API server-side. The page image leaves
 *     the device; the PDF does not, the credential never reaches the browser,
 *     and the browser still talks to no host but this one.
 *
 * Verify with `performance.getEntriesByType("resource")` in the page: zero
 * external hosts, with a document ingested. That check still passes, and it is
 * now a check about hosts only -- it says nothing about what those requests
 * carry. `src/app/privacy/page.tsx` is the statement about that, and it was
 * rewritten in the same commit as this route.
 *
 * This module is deliberately thin. Everything decidable is in `ingest.ts`,
 * which takes pdf.js and the canvas as arguments so `node --test` can drive
 * the same loop; what is left here is wiring that only a real browser can
 * execute.
 */

import * as pdfjs from "pdfjs-dist";
import type { Line } from "../pipeline/geometry.ts";
import { pageToPng } from "../pipeline/gemini-ocr.ts";
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
 * instead of getting one of its own, which is nothing next to the seconds a
 * page costs to render and to have read. (This sentence used to name 40
 * seconds a page, a figure the rest of the tree contradicted at four to five;
 * neither was measured on the current engine, so it now names none.)
 * Setting `workerSrc` remains correct and required: the
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
      `source ${sourceId} is not in this device's storage. The PDF itself is ` +
        "never uploaded -- only a rendered page image goes to this app's own " +
        "server for text recognition -- so a run opened in a different browser " +
        "or profile has its OCR text but not its pages; the document has to be " +
        "added again.",
    );
  }

  const task = pdfjs.getDocument({
    data: new Uint8Array(source.bytes),
    CanvasFactory: OffscreenCanvasFactory,
    FilterFactory: NoFilterFactory,
    /*
     * RASTERIZE GLYPHS INSTEAD OF INSTALLING WEB FONTS. This one option is the
     * difference between readable evidence and a page of empty boxes, and
     * getting it wrong is silent.
     *
     * pdf.js defaults it to `isNodeJS`:
     *   `typeof src.disableFontFace === "boolean" ? src.disableFontFace : isNodeJS`
     * In Node that is true and pdf.js draws glyph outlines itself. In a
     * browser it is false and pdf.js builds a `FontFace` from the embedded
     * font and adds it to `document.fonts`. A Web Worker has NO `document`
     * and no CSS font loading, so the face is never installed, the canvas
     * falls back to a family that is not there, and every run of text using an
     * embedded font paints as TOFU -- one empty box per character.
     *
     * MEASURED, on the real bundle. The two-page SPLITBA's second page is a
     * printed email thread: a digital page, not a scan. Rendered in this
     * worker it came out as boxes with only its one raster table legible;
     * rendered by `pnpm generate` in Node, byte-identical input, it is a
     * perfectly readable email. OCR of the tofu produced 46 lines of noise
     * ("BENIBNIN BBB BNI TIDDD DD DED..."), which is exactly the shape that
     * gets past every check: the page renders, it is page-shaped, it yields
     * plausible line boxes, and the crop lands in a document a validator
     * signs with nothing readable on it.
     *
     * The bundle's other 28 pages are scans -- pure images, no text objects --
     * which is why this hid behind a run that otherwise looked healthy. Any
     * bundle carrying digital pages loses all of them at once.
     *
     * Matching Node is also what the geometry requires: zones are measured in
     * the pixels the headless pipeline produces.
     */
    disableFontFace: true,
  });
  open = { sourceId, task };
  return task.promise;
}

/**
 * The route's own words, whatever shape the failure took.
 *
 * THE SHAPE IS `{error, message, hint?, cause?}` AND `message` IS THE PROSE.
 * `error` is a machine slug -- `"bad-request"`, `"unusable-reply"`,
 * `"unauthenticated"`, `"model-unreachable"` -- and `message` is the sentence
 * written to be read by an operator mid-ingest: which credential to check, and
 * whether the pages already committed are still good. Reading `error` first
 * showed the operator the bare token `bad-request` and threw away the
 * explanation, which is the only part of the error worth having; it read as
 * working because exactly one of the four failure statuses happened to carry
 * its prose in `error`. `hint` is appended rather than replaced because it
 * carries the reassurance the operator actually needs ("Nothing in your run has
 * been changed"), which is a different sentence from the diagnosis.
 *
 * Falling back to `error` still matters: it is what a caller that only has the
 * slug is left with, and a slug beats "OCR failed".
 *
 * A response that is not JSON is its own diagnosis and is reported as such: the
 * one that matters is an HTML sign-in page, which is what a redirected
 * unauthenticated request delivers where JSON was expected.
 */
async function messageFrom(res: Response): Promise<string> {
  const where = `POST /api/ocr answered ${res.status}`;
  if (res.redirected || !res.headers.get("content-type")?.includes("json")) {
    return (
      `${where} with ${res.headers.get("content-type") ?? "no content type"}` +
      (res.redirected ? `, after a redirect to ${res.url}` : "") +
      ". That is almost always a signed-out session: sign in again and re-add " +
      "the document."
    );
  }
  try {
    const body = await res.json();
    const cause = body?.cause ? ` (${body.cause})` : "";
    const hint = body?.hint ? ` ${body.hint}` : "";
    return `${body?.message ?? body?.error ?? where}${cause}${hint}`;
  } catch {
    return `${where} with a body that is not JSON.`;
  }
}

/**
 * OCR: the page's pixels to this app's own `/api/ocr`, and numbered lines back.
 *
 * THE ENTIRE BROWSER SIDE OF THE GEMINI OCR MIGRATION IS THIS FUNCTION, because
 * `IngestDeps.ocr` was already `(page: RenderedPage) => Promise<Line[]>` and
 * already injected. Three rules hold it in place:
 *
 *  1. NO FALLBACK TO A LOCAL ENGINE ON ERROR. There is no second OCR path here
 *     and there must not be one: falling back on failure silently mixes two
 *     engines' geometry inside one bundle, and turns a broken deploy into a
 *     very slow run that nobody reports. A failure throws, and reaches the
 *     operator through the `failed` protocol message.
 *  2. `credentials: "same-origin"` is stated even though it is the default. A
 *     dedicated worker's fetch carries the session cookie the same way the
 *     page's does, and this route is inside `src/proxy.ts`'s matcher, so a
 *     signed-out ingest is refused rather than silently unauthenticated.
 *  3. THE DIMENSION ASSERTION IS NOT OPTIONAL. The server reads width and
 *     height from the PNG's own IHDR and returns them; if they are not this
 *     page's dimensions then OCR measured one coordinate space and every crop
 *     will be cut from another. Everything downstream of that looks completely
 *     normal -- boxes on the page, crops that render, a document that opens --
 *     which is precisely why it is checked here and not trusted.
 */
async function ocr(page: RenderedPage): Promise<Line[]> {
  const image = await pageToPng(page);

  const res = await fetch(new URL("/api/ocr", location.origin), {
    method: "POST",
    headers: { "content-type": "image/png" },
    // `BodyInit` insists on an ArrayBuffer-backed view, while `Uint8Array` on
    // its own widens to `ArrayBufferLike` (which includes SharedArrayBuffer).
    // Both producers in `pageToPng` -- `encodePng` and `convertToBlob` -- hand
    // back plain ArrayBuffer-backed bytes, so this narrows a fact that already
    // holds rather than asserting a new one. Same reason as the `ImageData`
    // narrowing inside `pageToPng` itself.
    body: image.bytes as Uint8Array<ArrayBuffer>,
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(await messageFrom(res));

  const body = await res.json();
  if (body.width !== page.width || body.height !== page.height) {
    throw new Error(
      `OCR measured ${body.width}x${body.height}, page is ${page.width}x${page.height}. ` +
        "Zone boxes are in the pixel space of a page rendered at DEFAULT_DPI, " +
        "so a mismatch means every rectangle for this page would be cut from " +
        "the wrong coordinate space.",
    );
  }
  return body.lines as Line[];
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
