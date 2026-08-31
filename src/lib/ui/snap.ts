/**
 * Turning a drag on a page image into a zone.
 *
 * A crop that slices a line of text in half is never what anyone wants, so a
 * drawn rectangle snaps to whole OCR lines by default. Holding the modifier
 * key gives free pixels, which is what a signature or stamp block needs
 * because it has no lines to snap to.
 *
 * The snapped rectangle is built the same way `locate.ts` builds a proposed
 * one -- union the boxes of the lines in the range, then pad by
 * `CROP_PADDING_PX` -- so a zone an operator redraws is the same kind of
 * object as a zone the model proposed, and re-deriving it from its citation
 * gives the same pixels back.
 *
 * Pure, so `src/lib/ui/ui.test.mts` can drive it without a browser.
 */

import { padBox, unionBoxes } from "../pipeline/geometry.ts";
import type { Line } from "../pipeline/geometry.ts";
import { CROP_PADDING_PX } from "../pipeline/locate.ts";
import type { Box } from "../pipeline/render.ts";
import { NO_LINE_CITATION } from "./evidence.ts";
import type { StoredPage } from "./runtime.ts";

export type Point = { x: number; y: number };

/** A drag reports two corners in any order; a box has a positive size. */
export function normalizeBox(a: Point, b: Point): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function clampBox(box: Box, bounds: Box): Box {
  const x = Math.max(bounds.x, Math.min(box.x, bounds.x + bounds.w));
  const y = Math.max(bounds.y, Math.min(box.y, bounds.y + bounds.h));
  const right = Math.min(bounds.x + bounds.w, Math.max(box.x + box.w, x));
  const bottom = Math.min(bounds.y + bounds.h, Math.max(box.y + box.h, y));
  return { x, y, w: right - x, h: bottom - y };
}

export function pageBounds(page: StoredPage): Box {
  return { x: 0, y: 0, w: page.widthPx, h: page.heightPx };
}

/**
 * A line counts as touched when the drag covers at least this share of the
 * line's own height. Sized off the line rather than off the drag so that
 * dragging a tall box does not lower the bar for every line it passes over.
 */
export const TOUCH_RATIO = 0.4;

export function linesTouchedBy(
  lines: Line[],
  box: Box,
  ratio: number = TOUCH_RATIO,
): Line[] {
  const top = box.y;
  const bottom = box.y + box.h;
  return lines.filter((line) => {
    const overlap =
      Math.min(bottom, line.box.y + line.box.h) - Math.max(top, line.box.y);
    return line.box.h > 0 && overlap >= ratio * line.box.h;
  });
}

/** Lines the box covers completely, top to bottom and left to right. */
export function linesInsideBox(lines: Line[], box: Box): Line[] {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  return lines.filter(
    (line) =>
      line.box.y >= box.y &&
      line.box.y + line.box.h <= bottom &&
      line.box.x >= box.x &&
      line.box.x + line.box.w <= right,
  );
}

export type DrawnZone = {
  box: Box;
  lineRange: [number, number];
  /** How the rectangle was arrived at, for the readout in the editor. */
  mode: "snapped" | "free";
};

/**
 * `snap: false` keeps the operator's exact pixels and cites only the lines it
 * covers WHOLE. A half-covered line is not evidence the crop shows, and
 * citing it would put a transcript beside the picture that disagrees with it.
 */
export function drawZone(
  drawn: Box,
  page: StoredPage,
  snap: boolean,
  pad: number = CROP_PADDING_PX,
): DrawnZone {
  const bounds = pageBounds(page);

  if (snap) {
    const touched = linesTouchedBy(page.lines, drawn);
    if (touched.length > 0) {
      const from = Math.min(...touched.map((l) => l.i));
      const to = Math.max(...touched.map((l) => l.i));
      // Every line between the endpoints, not only the touched ones, so the
      // range is contiguous and `boxForLineRange(from, to)` reproduces this
      // rectangle exactly.
      const inRange = page.lines.filter((l) => l.i >= from && l.i <= to);
      return {
        box: padBox(unionBoxes(inRange.map((l) => l.box)), pad, bounds),
        lineRange: [from, to],
        mode: "snapped",
      };
    }
    // Nothing to snap to. Falling through to free pixels is better than
    // refusing the drag: a signature block is exactly this case.
  }

  const box = clampBox(drawn, bounds);
  const whole = linesInsideBox(page.lines, box);
  const lineRange: [number, number] =
    whole.length > 0
      ? [
          Math.min(...whole.map((l) => l.i)),
          Math.max(...whole.map((l) => l.i)),
        ]
      : [NO_LINE_CITATION, NO_LINE_CITATION];

  return { box, lineRange, mode: "free" };
}

/**
 * The smallest drag worth acting on, in page pixels. Below this a drag is a
 * mis-click, and turning one into a zone would replace a good proposal with a
 * few pixels of white paper.
 */
export const MIN_DRAG_PX = 24;

export function isMeaningfulDrag(box: Box): boolean {
  return box.w >= MIN_DRAG_PX && box.h >= MIN_DRAG_PX;
}
