import type { PDFPageProxy } from "pdfjs-dist";

export type Box = { x: number; y: number; w: number; h: number };

export type RenderedPage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

/**
 * What this module actually needs of a 2D drawing context: the three members
 * used below, and nothing else.
 *
 * It used to say `CanvasRenderingContext2D`, the DOM type, which admitted
 * NEITHER implementation this project runs on:
 *
 *   - `OffscreenCanvasRenderingContext2D`, the browser's only option inside a
 *     Web Worker (`src/lib/browser/pipeline.worker.ts`), is missing
 *     `getContextAttributes` and `drawFocusIfNeeded`;
 *   - `@napi-rs/canvas`'s `SKRSContext2D`, which every Node caller passes, is
 *     missing `drawFocusIfNeeded` and returns its own `ImageData` without
 *     `colorSpace`.
 *
 * The Node half went unnoticed because `scripts/*.mjs` are JavaScript and
 * `checkJs` is off, so nothing type-checked that call until a `.mts` test
 * did. Naming the three members is therefore not a loosening: it is the first
 * statement of this contract that is true of any caller, and it is narrow
 * enough that a caller passing something meaningless is still rejected.
 */
export type Canvas2D = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
  /**
   * Only `.data` is read, which is why the return type says only that. The
   * DOM and the Node implementations disagree about the rest of `ImageData`.
   */
  getImageData(
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): { data: Uint8ClampedArray };
};

/**
 * Supplied by the caller so the browser can pass an OffscreenCanvas context
 * and Node can pass @napi-rs/canvas, without this module importing either.
 */
export type CanvasFactory = (width: number, height: number) => Canvas2D;

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
  //
  // pdf.js declares `canvasContext` as the DOM `CanvasRenderingContext2D`
  // and drives it through the drawing API that every 2D context implements;
  // it has been handed an `@napi-rs/canvas` context by every Node caller in
  // this repo since the pipeline was written, and it renders to an
  // OffscreenCanvas context in browsers routinely. The assertion states that
  // here, once, next to the reason -- rather than in each caller, where the
  // same lie would be repeated with none of this context.
  await page.render({
    canvas: null,
    canvasContext: context as CanvasRenderingContext2D,
    viewport,
  }).promise;

  return { data: context.getImageData(0, 0, width, height).data, width, height };
}
