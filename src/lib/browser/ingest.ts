/**
 * The render-then-OCR loop, with pdf.js, the canvas, and the OCR engine all
 * injected.
 *
 * Injected because the two runtimes that run this loop cannot both be tested:
 * the browser supplies a Web Worker's `OffscreenCanvas` and the pdf.js browser
 * build, which `node --test` has no way to conjure. Taking them as arguments
 * puts the part that can actually be wrong -- page order, page numbering,
 * progress accounting, and the promise that no two rendered pages are alive at
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
};

/** One page's OCR result. Deliberately carries no pixels; see below. */
export type IngestedPage = {
  /** 0-based, within this document. */
  index: number;
  widthPx: number;
  heightPx: number;
  lines: Line[];
};

/**
 * Renders and OCRs every page of one PDF, in order, handing each result to
 * `onPage` as it lands.
 *
 * NEVER ACCUMULATES PAGES. An upright 300 DPI A4 page is 2480x3507, about
 * 35MB as RGBA, and a bundle is 29 of them: collecting the results and
 * returning them at the end would cost a gigabyte to produce a few hundred
 * kilobytes of text. Each rendered page goes out of scope before the next is
 * rendered, and only the lines survive.
 *
 * `onPage` is awaited, which is what lets the caller persist each page before
 * the next one starts. A 29-page bundle takes minutes, and a browser tab that
 * is reloaded halfway through should keep the pages it already paid for.
 *
 * Progress is reported per page rather than at the end because 4-5 seconds of
 * OCR times 29 pages is long enough that a UI with no bar reads as hung.
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

    for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const rendered = await renderPageUpright(
          page,
          deps.dpi ?? DEFAULT_DPI,
          deps.makeContext,
        );
        const lines = await deps.ocr(rendered);
        await onPage(
          {
            index: pageNumber - 1,
            widthPx: rendered.width,
            heightPx: rendered.height,
            lines,
          },
          pageNumber,
          total,
        );
      } finally {
        // pdf.js caches the page's operator list and any decoded images on
        // the proxy. Without this the whole document's pixels accumulate
        // inside pdf.js even though nothing here holds a reference.
        page.cleanup();
      }
    }

    return total;
  } finally {
    await document.destroy();
  }
}
