"use client";

/**
 * Renders PDF pages to PNG images.
 *
 * Ollama's OpenAI-compatible endpoint rejects PDF file parts outright
 * ("invalid message format"), and Gemma 3 is an image model regardless. So a
 * PDF only reaches the model as pictures of its pages.
 *
 * Everything here runs in the browser: the document never leaves the machine.
 */

/**
 * Gemma 3 spends ~256 tokens per image against our 8192-token context
 * (`OLLAMA_CONTEXT_LENGTH`). Twenty pages would exhaust the window before the
 * question was even read, so pages are capped and the caller is told.
 */
export const DEFAULT_PAGE_LIMIT = 5;

/**
 * Gemma 3's vision tower sees 896x896. Rendering far above that costs base64
 * payload and IndexedDB space without giving the model more detail, but a
 * little headroom helps small print survive the downscale.
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
