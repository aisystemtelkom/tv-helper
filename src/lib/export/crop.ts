import type { Box, RenderedPage } from "../pipeline/render.ts";
import { encodePng } from "./png.ts";

/**
 * Copies the sub-rectangle out of the page's RGBA buffer row by row. Boxes
 * arrive from geometry.ts already clamped to the page, so an out-of-bounds
 * box here means a caller skipped padBox and is a bug worth throwing on:
 * reading past the end of a row would silently wrap onto the next scanline
 * and yield a sheared image rather than an error.
 *
 * Async because `encodePng` is: the browser path deflates through
 * `CompressionStream`, which has no synchronous API.
 */
export async function cropToPng(
  page: RenderedPage,
  box: Box,
): Promise<Uint8Array> {
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
