import type { Box, RenderedPage } from "../pipeline/render.ts";
import { encodePng } from "./png.ts";

/**
 * Copies the sub-rectangle out of the page's RGBA buffer row by row. Boxes
 * arrive from geometry.ts already clamped to the page, so an out-of-bounds
 * box here means a caller skipped padBox and is a bug worth throwing on:
 * reading past the end of a row would silently wrap onto the next scanline
 * and yield a sheared image rather than an error.
 *
 * `expect` is the dimensions the box was MEASURED against, when the caller
 * knows them. It exists because `page` is very often not the bitmap the zone
 * was computed on: the browser stores OCR lines and re-renders the pixels on
 * demand, so a crop is cut from a second render of the same PDF page. Should
 * that render ever come back at a different DPI -- or with the page's own
 * `/Rotate` applied differently -- every box is silently measured with one
 * ruler and applied with another. The crop still encodes, still looks like a
 * crop, and shows a region nobody chose. That is invisible downstream, so it
 * is checked here where both numbers are in hand.
 *
 * Async because `encodePng` is: the browser path deflates through
 * `CompressionStream`, which has no synchronous API.
 */
export async function cropToPng(
  page: RenderedPage,
  box: Box,
  expect?: { width: number; height: number },
): Promise<Uint8Array> {
  if (expect && (page.width !== expect.width || page.height !== expect.height)) {
    throw new Error(
      `page is ${page.width}x${page.height} but this box was measured on a ` +
        `${expect.width}x${expect.height} page: the crop would be cut with a ` +
        "different ruler than the one that chose it",
    );
  }

  // BEFORE the comparisons below, because NaN loses every comparison it is
  // given. `w <= 0` is FALSE for NaN and so is `x + w > page.width`, so a NaN
  // box passed both guards, allocated `new Uint8ClampedArray(NaN * NaN * 4)`
  // -- a zero-length buffer -- copied no rows, and returned a valid 65-byte
  // PNG with a 0x0 IHDR. Measured, not theorised. An empty picture in a
  // validation packet is exactly this project's failure class: the docx opens,
  // the cell has a picture in it, and there is nothing to see.
  if (![box.x, box.y, box.w, box.h].every((v) => Number.isFinite(v))) {
    throw new Error(`crop box is not finite: ${JSON.stringify(box)}`);
  }

  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const w = Math.round(box.w);
  const h = Math.round(box.h);

  if (w <= 0 || h <= 0) throw new Error(`empty crop ${w}x${h}`);
  if (x < 0 || y < 0 || x + w > page.width || y + h > page.height) {
    throw new Error(
      `crop ${x},${y} ${w}x${h} escapes page ${page.width}x${page.height}`,
    );
  }

  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * page.width + x) * 4;
    out.set(page.data.subarray(from, from + w * 4), row * w * 4);
  }
  return await encodePng(out, w, h);
}
