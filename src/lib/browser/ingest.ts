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
  IncompletePageError,
  ocrPageCompletely,
  type RecognizePage,
  type ShortRead,
} from "../pipeline/gemini-ocr.ts";
import {
  DEFAULT_DPI,
  renderPageUpright,
  type CanvasFactory,
  type RenderedPage,
} from "../pipeline/render.ts";
import type { PageShortfall } from "./types.ts";

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
  /**
   * Rendered pixels to numbered lines of words with real glyph boxes.
   *
   * RETURNS A PAIR, NOT AN ARRAY, and the second half is the reason. This was
   * `Promise<Line[]>`, so the only thing an implementation could say about a
   * page it had read badly was to throw -- and a throw here ends the whole
   * document (see below). `short` lets it say the third thing that is true of
   * a real bundle: this page was read, incompletely, and here is what was
   * read and what the guard measured. See `PageShortfall`.
   */
  ocr(page: RenderedPage): Promise<{ lines: Line[]; short?: PageShortfall }>;
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

/**
 * A page that could not be read, WITH THE PAGE NAMED.
 *
 * Every failure in this loop used to propagate exactly as it was thrown, and
 * not one of the things that can throw here knows which page it is on:
 * `renderPageUpright` is handed a page proxy, and `IngestDeps.ocr` is handed
 * only the rendered pixels and carries no index at all -- so
 * `pipeline.worker.ts` labels its OCR "a page of this document", deliberately,
 * because a counter kept there would be wrong the moment the loop stopped
 * being serial. THIS is the one place that holds the number.
 *
 * The cost of not carrying it was measured on a real bundle: a 151-page order
 * stopped part-way through and reported `IncompletePageError: a page of this
 * document ...`, which is true of any of the 151 and actionable for none of
 * them. The operator cannot open the page, and nobody can tell a bad scan from
 * a bad deploy.
 *
 * IT GOES IN THE MESSAGE, not only in the fields. `pipeline.worker.ts` posts
 * `error.message` and nothing else -- structured clone strips the prototype,
 * so the class, the fields and the `cause` do not survive the worker boundary
 * -- and that string is what the shell files behind `Detail teknis`. The
 * fields are for callers on this side of the boundary; the message is for the
 * human reading the screen.
 *
 * `pageNumber` is 1-BASED and within THIS document, matching what a PDF viewer
 * shows and what an xlsx note cites, never the run-global position.
 */
export class IngestPageError extends Error {
  readonly pageNumber: number;
  readonly pageCount: number;

  constructor(pageNumber: number, pageCount: number, cause: unknown) {
    super(
      `page ${pageNumber} of ${pageCount} could not be read: ${
        cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
      }`,
      { cause },
    );
    this.name = "IngestPageError";
    this.pageNumber = pageNumber;
    this.pageCount = pageCount;
  }
}

/**
 * MAY THIS FAILURE BE KEPT AS A SHORT PAGE, OR MUST IT END THE DOCUMENT?
 *
 * The decision this whole field exists for, and it lives HERE rather than in
 * `pipeline.worker.ts` where it is used, because that module opens with
 * `scope.addEventListener` and cannot be imported by `node --test` at all --
 * it is the dozen lines of wiring this file's header admits are unexercised.
 * A policy nothing can test is a policy nobody can change safely, and this one
 * decides whether a bundle survives.
 *
 * `null` means RETHROW. Only one shape is ever kept:
 *
 *  - It must be `IncompletePageError`. A render that failed, an unreachable
 *    route, a signed-out session and a dimension mismatch are not pages that
 *    were read, and a run that carried on through a broken deploy would be
 *    the wrong-and-quiet failure this project is organised against.
 *  - Its ladder must be CLEAN: every attempt answered, and every answer short.
 *    When some attempt threw outright -- a truncated reply, a 503, an aborted
 *    request -- what the page demonstrates may be a broken connection rather
 *    than ink the recogniser declined to read, and keeping it would turn a
 *    deploy problem into a bundle of quietly half-read pages. That is what
 *    `IncompletePageError.lastError` records and it is why this is not simply
 *    an `instanceof` check.
 *
 * WHO CALLS THIS IS THE POINT. `pipeline.worker.ts` does, because the browser
 * has an operator in front of it and every crop is confirmed by hand before it
 * can reach a deliverable. `scripts/generate.mjs` does NOT, and must not: it
 * writes its files unreviewed, so a page it knows it misread has to end the
 * run. Same guard, same measurement, two dispositions, decided by whether
 * anybody is there to be told.
 */
export function keepShortPage(
  error: unknown,
): { lines: Line[]; short: PageShortfall } | null {
  if (!(error instanceof IncompletePageError) || error.lastError) return null;
  return {
    lines: error.lines,
    short: {
      inkCoverage: error.completeness.inkCoverage,
      uncoveredInkRunShare: error.completeness.uncoveredInkRunShare,
      attempts: error.attempts,
      shortfalls: error.completeness.shortfalls,
    },
  };
}

/**
 * ONE PAGE, READ THE WAY THE BROWSER READS IT: the completeness ladder, and
 * then the keep-or-rethrow decision above.
 *
 * `pipeline.worker.ts` is two lines of wiring around this, and that is the
 * whole point of it living here. The worker cannot be imported by
 * `node --test` -- it opens with `scope.addEventListener` -- so anything left
 * inside it is untestable by construction, and what was left inside it was the
 * exact sequence that decides whether a bundle of 151 pages survives one bad
 * one. `recognize` is injected for the same reason `IngestDeps` injects
 * everything else: the worker passes a `POST /api/ocr`, a test passes a fake,
 * and a verification harness can pass Cloud Vision directly and exercise this
 * function rather than a copy of it that can drift from it.
 */
export async function ocrPageOrKeepShort(
  page: RenderedPage,
  recognize: RecognizePage,
  onShort?: (short: ShortRead) => void,
): Promise<{ lines: Line[]; short?: PageShortfall }> {
  try {
    const { lines } = await ocrPageCompletely(page, recognize, {
      // Deliberately not a page number: this function is handed one rendered
      // page and no index, and a counter kept here would be right only for as
      // long as the loop above stayed serial. `IngestPageError` carries the
      // number, from the one scope that holds it.
      label: "a page of this document",
      onShort,
    });
    return { lines };
  } catch (error) {
    const kept = keepShortPage(error);
    if (!kept) throw error;
    return kept;
  }
}

/** One page's OCR result. Deliberately carries no pixels; see below. */
export type IngestedPage = {
  /** 0-based, within this document. */
  index: number;
  widthPx: number;
  heightPx: number;
  lines: Line[];
  /** Set only when the page was read incompletely and kept anyway. */
  short?: PageShortfall;
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
          const { lines, short } = await deps.ocr(rendered);
          ready.set(pageNumber - 1, {
            index: pageNumber - 1,
            widthPx: rendered.width,
            heightPx: rendered.height,
            lines,
            // Spread rather than `short: short`, so a page that passed carries
            // no key at all: `{short: undefined}` and a missing `short` are
            // the same to a reader and NOT the same to IndexedDB or to a
            // `JSON.stringify` in a log line.
            ...(short ? { short } : {}),
          });
        } catch (error) {
          // Wrapped here rather than at either thrower, because this is the
          // only scope that knows both the page and the total. Already
          // wrapped is left alone so a nested loop cannot label a page twice.
          throw error instanceof IngestPageError
            ? error
            : new IngestPageError(pageNumber, total, error);
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
