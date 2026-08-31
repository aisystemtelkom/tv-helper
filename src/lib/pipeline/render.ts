import type { PDFPageProxy } from "pdfjs-dist";

export type Box = { x: number; y: number; w: number; h: number };

export type RenderedPage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

/**
 * Supplied by the caller so the browser can pass an OffscreenCanvas context
 * and Node can pass @napi-rs/canvas, without this module importing either.
 */
export type CanvasFactory = (
  width: number,
  height: number,
) => CanvasRenderingContext2D;

/**
 * The scans measure ~3507x2480 across an A4 landscape MediaBox, which is
 * about 300 DPI. Rendering below that throws away the small print the whole
 * product exists to read.
 */
export const DEFAULT_DPI = 300;

/**
 * `getViewport` applies the page's own /Rotate, so every box downstream is in
 * upright pixels and no other module has to think about rotation again.
 */
export async function renderPageUpright(
  page: PDFPageProxy,
  dpi: number = DEFAULT_DPI,
  makeContext: CanvasFactory,
): Promise<RenderedPage> {
  const viewport = page.getViewport({ scale: dpi / 72 });
  const width = Math.round(viewport.width);
  const height = Math.round(viewport.height);

  const context = makeContext(width, height);
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);

  // `canvas: null` is required, not cosmetic. In pdfjs-dist 6.x `canvas` is a
  // required RenderParameters property, and the library only honors the
  // supplied `canvasContext` when `canvas` is falsy. Omitting it fails tsc.
  await page.render({ canvas: null, canvasContext: context, viewport }).promise;

  return { data: context.getImageData(0, 0, width, height).data, width, height };
}
