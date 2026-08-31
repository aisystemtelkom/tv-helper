import type { Box } from "./render";

export type Word = { text: string; box: Box };
export type Line = { i: number; text: string; box: Box; words: Word[] };

export function unionBoxes(boxes: Box[]): Box {
  if (boxes.length === 0) throw new Error("unionBoxes needs at least one box");
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Clamped, because a crop that runs off the page throws in the encoder.
 * Width and height are also floored at 0: a negative pad (or a box already
 * larger than its bounds) must not produce a negative-size box, which is
 * exactly the malformed rectangle this function exists to prevent.
 */
export function padBox(box: Box, pad: number, bounds: Box): Box {
  const x = Math.max(bounds.x, box.x - pad);
  const y = Math.max(bounds.y, box.y - pad);
  const right = Math.min(bounds.x + bounds.w, box.x + box.w + pad);
  const bottom = Math.min(bounds.y + bounds.h, box.y + box.h + pad);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/**
 * Groups by vertical overlap rather than exact y, because scanned text is
 * never pixel-aligned and a two-pixel drift must not split a line in half.
 *
 * A word joins a row when its own vertical span overlaps the row's current
 * span by at least `yTolerance` of the *word's own* height:
 *
 *   overlap = min(word.bottom, row.bottom) - max(word.top, row.top)
 *   joins if overlap >= yTolerance * word.box.h
 *
 * This is directional on purpose. Sizing the threshold off the row's band
 * (as an earlier version did) let the tolerance grow every time a word
 * joined, so a chain of only-barely-overlapping words could walk arbitrarily
 * far down the page merging unrelated lines. Sizing it off the joining
 * word's own height keeps the threshold fixed no matter how tall the row's
 * accumulated band has become.
 */
export function groupWordsIntoLines(words: Word[], yTolerance = 0.5): Line[] {
  const rows: Word[][] = [];

  for (const w of [...words].sort((a, b) => a.box.y - b.box.y)) {
    const wordTop = w.box.y;
    const wordBottom = w.box.y + w.box.h;
    const row = rows.find((r) => {
      const rowTop = Math.min(...r.map((x) => x.box.y));
      const rowBottom = Math.max(...r.map((x) => x.box.y + x.box.h));
      const overlap = Math.min(wordBottom, rowBottom) - Math.max(wordTop, rowTop);
      return overlap >= yTolerance * w.box.h;
    });
    if (row) row.push(w);
    else rows.push([w]);
  }

  return rows.map((row, i) => {
    const ordered = [...row].sort((a, b) => a.box.x - b.box.x);
    return {
      i,
      text: ordered.map((w) => w.text).join(" "),
      box: unionBoxes(ordered.map((w) => w.box)),
      words: ordered,
    };
  });
}

/**
 * Inclusive of both endpoints, because the model is asked for "lines 7 to 8"
 * and a reader checking the citation counts both.
 */
export function boxForLineRange(
  lines: Line[],
  from: number,
  to: number,
  pad: number,
  bounds: Box,
): Box {
  if (from > to) throw new Error(`line range reversed: ${from} > ${to}`);
  const picked = lines.filter((l) => l.i >= from && l.i <= to);
  if (picked.length !== to - from + 1) {
    throw new Error(`lines ${from}-${to} are not all present on this page`);
  }
  return padBox(unionBoxes(picked.map((l) => l.box)), pad, bounds);
}
