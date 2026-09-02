/**
 * Pixels: turning a page bitmap into something the screen can show and the
 * exporter can cut.
 *
 * Browser-only by nature (canvas, blobs, object URLs), so it is kept apart
 * from the pure modules that `ui.test.mts` drives.
 *
 * NOTHING HERE UPLOADS ANYTHING. Every bitmap is drawn, read and discarded in
 * the tab. That is not incidental: documents stay on the device, and the only
 * thing this app ever sends anywhere is a model call made server-side.
 */

import type { Box, RenderedPage } from "../pipeline/render.ts";

function context2d(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("this browser refused a 2d canvas context");
  return ctx;
}

function toBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(URL.createObjectURL(blob));
      else reject(new Error("canvas produced no image"));
    }, "image/png");
  });
}

/**
 * The raw RGBA the crop and PNG encoders take. A 300 DPI A4 page is about
 * 35MB in this form, so callers cut what they need and drop the reference
 * rather than holding one per slot.
 */
export function bitmapToRenderedPage(bitmap: ImageBitmap): RenderedPage {
  const ctx = context2d(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { data: image.data, width: bitmap.width, height: bitmap.height };
}

/**
 * A crop, scaled for the review sheet.
 *
 * Scaled for the screen only. The exporter cuts from the full-resolution page
 * so the deliverable keeps every dot of the 300 DPI scan -- the whole reason
 * the pipeline renders that high is to keep small print readable.
 *
 * 1100, raised from 560. The review sheet gives the crop most of the row now
 * rather than a 272px thumbnail column, and the operator is being asked to
 * read Indonesian small print off a photocopy to decide whether it is the
 * right region. A picture rendered at half the width it is displayed at makes
 * that judgement on a blurred copy, which is the same failure as showing the
 * wrong page, only harder to notice. The cost is bounded: these are PNGs of
 * mostly white paper, held one per proposed zone, and the page bitmap they
 * are cut from is released either way.
 */
export async function cropToDisplayUrl(
  bitmap: ImageBitmap,
  box: Box,
  maxWidth = 1100,
): Promise<string> {
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  const scale = Math.min(1, maxWidth / w);
  const outW = Math.max(1, Math.round(w * scale));
  const outH = Math.max(1, Math.round(h * scale));

  const ctx = context2d(outW, outH);
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(
    bitmap,
    Math.round(box.x),
    Math.round(box.y),
    w,
    h,
    0,
    0,
    outW,
    outH,
  );
  return await toBlobUrl(ctx.canvas);
}

/**
 * A whole page, scaled to something a screen can hold, for the zone editor.
 *
 * Only one of these is alive at a time (the editor shows one page), so it can
 * afford to be sharper than a crop: the operator is dragging a rectangle over
 * lines of text they have to be able to read while they drag.
 */
export async function pageToDisplayUrl(
  bitmap: ImageBitmap,
  maxWidth = 1600,
): Promise<{ url: string; scale: number }> {
  const scale = Math.min(1, maxWidth / bitmap.width);
  const outW = Math.max(1, Math.round(bitmap.width * scale));
  const outH = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = context2d(outW, outH);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, outW, outH);
  return { url: await toBlobUrl(ctx.canvas), scale };
}

/**
 * Object URLs are held by the document until they are revoked, so a contact
 * sheet that re-rendered a few times would leak a page-sized blob each time.
 */
export function revokeUrls(urls: Iterable<string>): void {
  for (const url of urls) URL.revokeObjectURL(url);
}

/** Hands the operator a file. Same-origin blob, no network. */
export function downloadBytes(name: string, bytes: Uint8Array, type: string): void {
  const view = new Uint8Array(bytes);
  const blob = new Blob([view.buffer as ArrayBuffer], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers; a turn of
  // the event loop is enough for the click to have been taken.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
