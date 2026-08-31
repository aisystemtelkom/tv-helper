"use client";

/**
 * Renders PDF pages to PNG images.
 *
 * A PDF reaches the model as pictures of its pages. Gemini can accept PDF
 * parts directly, but rasterizing here keeps conversion in the browser and
 * keeps one code path for every attachment type.
 *
 * Everything here runs in the browser: only the rendered pages are uploaded.
 */

/**
 * Now a cost cap rather than a context cap: Gemini 3.5 Flash has a 1M-token
 * context, but every page costs ~1110 prompt tokens at MEDIA_RESOLUTION_HIGH,
 * so an uncapped 40-page scan is a bill. Pages are capped and the caller is
 * told. Raising this multiplies per-request cost linearly.
 */
export const DEFAULT_PAGE_LIMIT = 5;

/**
 * Sized for Gemma 3's 896x896 vision tower, which no longer serves this app.
 * Gemini bills a flat rate per image tier, so raising this costs upload and
 * IndexedDB space but no extra API tokens, and may recover detail on dense
 * scans. Measure against real documents before changing it.
 */
const TARGET_EDGE = 1024;

export type PdfRenderResult = {
  pages: Blob[];
  totalPages: number;
  truncated: boolean;
};

let pdfjs: typeof import("pdfjs-dist") | undefined;

/**
 * pdf.js defaults to fetching its worker from a CDN. That would put a third
 * party in the request path of a local-only app and break offline use, so the
 * worker is resolved from the installed package and bundled by Turbopack.
 */
const loadPdfjs = async () => {
  if (pdfjs) return pdfjs;

  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  pdfjs = lib;
  return lib;
};

export const renderPdfToImages = async (
  file: Blob,
  pageLimit = DEFAULT_PAGE_LIMIT,
): Promise<PdfRenderResult> => {
  const lib = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());

  // Keep the loading task: `destroy()` lives on it, not on the document.
  const task = lib.getDocument({ data });
  const document = await task.promise;

  try {
    const totalPages = document.numPages;
    const renderCount = Math.min(totalPages, pageLimit);
    const pages: Blob[] = [];

    for (let pageNumber = 1; pageNumber <= renderCount; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = TARGET_EDGE / Math.max(base.width, base.height);
      const viewport = page.getViewport({ scale });

      const canvas = document_createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not get a 2D canvas context.");

      // Flatten onto white; PDFs assume paper, and transparent pixels render
      // as black once encoded to PNG.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pages.push(await canvasToPng(canvas));
      page.cleanup();
    }

    return { pages, totalPages, truncated: totalPages > renderCount };
  } finally {
    await task.destroy();
  }
};

const document_createCanvas = (width: number, height: number) => {
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(width));
  canvas.height = Math.max(1, Math.floor(height));
  return canvas;
};

const canvasToPng = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Failed to encode page PNG.")),
      "image/png",
    );
  });
