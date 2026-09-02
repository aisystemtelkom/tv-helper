/**
 * The render-then-OCR loop, with pdf.js, the canvas, and the OCR engine all
 * injected.
 *
 * Injected because the two runtimes that run this loop cannot both be tested:
 * the browser supplies a Web Worker's `OffscreenCanvas` and the pdf.js browser
 * build, which `node --test` has no way to conjure. Taking them as arguments
 * puts the part that can actually be wrong -- page order, page numbering,
 * progress accounting, and the bound on how many rendered pages are alive at
 * once -- under test against `@napi-rs/canvas`, and leaves only a dozen lines
 * of wiring in `pipeline.worker.ts` unexercised.
 */

import type { PDFPageProxy } from "pdfjs-dist";
import type { Line } from "../pipeline/geometry.ts";
import {
  DEFAULT_DPI,
  renderPageUpright,
  type CanvasFactory,
  type RenderedPage,
} from "../pipeline/render.ts";

/** Just enough of pdf.js's loading task to render a document and let it go. */
export type PdfDocumentLike = {
  numPages: number;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
  destroy(): Promise<void>;
};

export type IngestDeps = {
  /**
   * Opens the PDF. The browser and Node use different pdf.js entry points,
   * and the caller decides where the bytes come from -- in the worker they
   * are read from IndexedDB and the open document is cached, so passing them
   * through here would read the file twice.
   */
  loadDocument(): Promise<PdfDocumentLike>;
  /** A 2D context of the requested size: OffscreenCanvas, or @napi-rs/canvas. */
  makeContext: CanvasFactory;
  /** Rendered pixels to numbered lines of words with real glyph boxes. */
  ocr(page: RenderedPage): Promise<Line[]>;
  /** Defaults to `DEFAULT_DPI` (300). Tests drop it to keep fixtures small. */
  dpi?: number;
  /**
   * How many pages may be rendered and OCR'd at once. Defaults to
   * `DEFAULT_CONCURRENCY`; a test that wants the old strictly-serial
   * behaviour passes 1, and gets it exactly.
   *
   * It is a memory bound as much as a speed knob: every in-flight page holds
   * an upright 300 DPI bitmap, ~33MB, so this number times 33MB is the peak.
   */
  concurrency?: number;
};

/**
 * Four pages in flight.
 *
 * OCR is a network round trip to `/api/ocr` now, not local wasm, so the loop
 * spends nearly all of its wall clock waiting rather than computing: a serial
 * loop over 29 pages is 29 round trips end to end. Four is the number the
 * migration's probe measured its ~3.6s/page of model time at, so it is the
 * one figure in this design that has a measurement behind it; nothing here
 * has measured whether 6 or 8 would be better, and the answer is a stopwatch
 * on a real bundle, not an argument.
 *
 * It is deliberately small. 4 x ~33MB of rendered RGBA is ~140MB of peak
 * browser memory, which a tab survives; the whole 29-page bundle at once is
 * the gigabyte the old strictly-serial invariant existed to forbid, and that
 * bound is what this constant replaces it with.
 */
export const DEFAULT_CONCURRENCY = 4;

/** One page's OCR result. Deliberately carries no pixels; see below. */
export type IngestedPage = {
  /** 0-based, within this document. */
  index: number;
  widthPx: number;
  heightPx: number;
  lines: Line[];
};

/**
 * Renders and OCRs every page of one PDF, up to `concurrency` at a time, and
 * hands the results to `onPage` IN ASCENDING PAGE INDEX.
 *
 * NEVER ACCUMULATES RENDERED PAGES. An upright 300 DPI A4 page is 2480x3507,
 * about 33MB as RGBA, and a bundle is 29 of them: rendering them all would
 * cost a gigabyte to produce a few hundred kilobytes of text. At most
 * `concurrency` rendered pages are alive at once -- 4 x 33MB is ~140MB, a
 * bound rather than a promise of one -- and each one goes out of scope as
 * soon as its lines are back. Only the lines survive, and a page of lines is
 * kilobytes, which is why buffering a few of them to restore order is free.
 *
 * ORDER IS THE WHOLE REASON THIS FUNCTION IS SHAPED THE WAY IT IS. The pages
 * finish in whatever order the model answers, but `runtime.ts` appends each
 * one to the END of `BrowserRun.pages` in arrival order, and `Zone.pageIndex`
 * is a POSITION in that array. A page arriving out of order therefore does not
 * mis-order a list; it silently repoints every zone in the run at a different
 * scan, and the docx that comes out opens fine, looks complete, carries a crop
 * of the wrong page, and gets signed. So completed pages are buffered here and
 * released strictly in index order, through a single chained promise, so that
 * two `onPage` calls can never overlap either.
 *
 * `onPage` is awaited, which is what lets the caller persist each page as it
 * is released. A 29-page bundle takes minutes, and a browser tab that is
 * reloaded halfway through should keep the pages it already paid for.
 *
 * Progress is reported per page rather than at the end because seconds of OCR
 * times 29 pages is long enough that a UI with no bar reads as hung. `done`
 * counts released pages, not finished ones, so it never goes backwards and
 * never runs ahead of what the caller has been given.
 *
 * A page that throws fails the whole ingest: no further page is started, the
 * pages already released stay released, and the first error is the one that
 * propagates. In-flight pages are awaited before the document is destroyed,
 * so nothing is torn down under a render that is still running.
 */
export async function ingestPdf(
  deps: IngestDeps,
  onPage: (
    page: IngestedPage,
    done: number,
    total: number,
  ) => void | Promise<void>,
): Promise<number> {
  const document = await deps.loadDocument();
  try {
    const total = document.numPages;
    const concurrency = Math.max(
      1,
      Math.min(deps.concurrency ?? DEFAULT_CONCURRENCY, total),
    );

    /** Finished pages waiting for their turn, keyed by 0-based page index. */
    const ready = new Map<number, IngestedPage>();
    /** The next index `onPage` may be given. Nothing may skip ahead of it. */
    let nextToRelease = 0;

    // Every release runs on this one chain, so `onPage` calls are serialised
    // even though the work that feeds them is not. A worker awaits its own
    // link before taking another page, which also stops the buffer growing
    // without bound when the caller's persistence is slower than OCR.
    let releases: Promise<void> = Promise.resolve();
    function releaseWhatIsReady(): Promise<void> {
      releases = releases.then(async () => {
        for (;;) {
          const next = ready.get(nextToRelease);
          if (!next) return;
          ready.delete(nextToRelease);
          nextToRelease += 1;
          await onPage(next, nextToRelease, total);
        }
      });
      return releases;
    }

    // A shared cursor rather than a slice per worker: pages take unequal time,
    // so handing worker k pages k, k+n, k+2n would leave three workers idle
    // behind one slow page.
    let nextToStart = 0;
    let failure: unknown;

    async function worker(): Promise<void> {
      while (failure === undefined) {
        const pageNumber = nextToStart + 1; // pdf.js is 1-based
        if (pageNumber > total) return;
        nextToStart += 1;

        const page = await document.getPage(pageNumber);
        try {
          const rendered = await renderPageUpright(
            page,
            deps.dpi ?? DEFAULT_DPI,
            deps.makeContext,
          );
          const lines = await deps.ocr(rendered);
          ready.set(pageNumber - 1, {
            index: pageNumber - 1,
            widthPx: rendered.width,
            heightPx: rendered.height,
            lines,
          });
        } finally {
          // pdf.js caches the page's operator list and any decoded images on
          // the proxy. Without this the whole document's pixels accumulate
          // inside pdf.js even though nothing here holds a reference.
          page.cleanup();
        }

        await releaseWhatIsReady();
      }
    }

    // `allSettled`, not `all`: `all` rejects on the first failure while the
    // other three pages are still rendering, and the `finally` below would
    // then destroy the document out from under them. Every worker is awaited,
    // and the first error is rethrown once they have all stopped.
    const settled = await Promise.allSettled(
      Array.from({ length: concurrency }, async () => {
        try {
          await worker();
        } catch (error) {
          failure ??= error;
          throw error;
        }
      }),
    );
    const rejected = settled.find((result) => result.status === "rejected");
    if (rejected) throw (rejected as PromiseRejectedResult).reason;

    return total;
  } finally {
    await document.destroy();
  }
}
