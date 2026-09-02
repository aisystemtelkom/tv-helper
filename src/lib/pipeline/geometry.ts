import type { Box } from "./render";

/**
 * A boxed text fragment -- a WORD under tesseract, a PER-PRINTED-LINE BAND
 * under Gemini.
 *
 * The name is now narrower than the thing, and that is a wrong-and-quiet
 * hazard worth spelling out rather than renaming across seven fixture
 * builders. `src/lib/pipeline/ocr.ts` pushes one entry per recognised word,
 * each with its own glyph box. `src/lib/pipeline/gemini-ocr.ts` pushes one
 * entry per printed line, because Gemini returns paragraph blocks and the
 * per-line boxes inside a block are sliced arithmetically, not measured.
 *
 * So do NOT read per-word geometry out of `Line.words`. Under Gemini a
 * "word" is a whole line's text and a whole line's box, and anything that
 * measures inter-word spacing or picks a single word's rectangle out of a
 * line will be quietly wrong on every page the new engine produced.
 */
export type Word = { text: string; box: Box };

/**
 * One numbered line of a page, which is the unit the whole pipeline counts
 * in: the locate prompt numbers these, the model answers with a range of
 * them, and `boxForLineRange` turns that range back into a rectangle.
 *
 * `origin` says how `box` was arrived at. `"measured"` means the engine
 * returned this rectangle for this text. `"interpolated"` means at least one
 * contributing fragment came from a multi-line block whose box was sliced
 * into equal vertical bands, so the top and bottom edges are arithmetic
 * rather than observed. It exists so an operator can see the difference on
 * the proposal plate and so the gate can count it per slot -- a sliced
 * rectangle presented as a measured one is exactly this project's failure
 * class.
 *
 * OPTIONAL on purpose. `StoredPage.lines` is persisted opaquely by
 * `src/lib/storage/runs.ts` with no version check anywhere, so runs ingested
 * before the Gemini migration read back with no `origin` at all. Undefined
 * must therefore mean "not recorded", never "measured".
 */
export type Line = {
  i: number;
  text: string;
  box: Box;
  words: Word[];
  origin?: "measured" | "interpolated";
};

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
 *
 * THIS FUNCTION GOT MORE LOAD-BEARING, NOT LESS, WITH THE GEMINI ENGINE.
 * It is now also the granularity restorer, and `gemini-ocr.ts` depends on
 * three properties of it that are easy to lose in a "tidy up":
 *
 *  - Gemini returns FINER entries than tesseract on form pages, splitting a
 *    label column and a value column into two entries at the same y. Left
 *    unmerged, those two contribute a near-zero top-to-top pitch and drag
 *    down the median that `trimRunningFooter` divides by, so its
 *    `gap >= FOOTER_GAP_MULTIPLE x median` test fires where it should not
 *    and trims real evidence off a crop that still looks fine. Re-merging
 *    same-row entries is what keeps FOOTER_GAP_MULTIPLE, MAX_FOOTER_LINES
 *    and HEAD_LINES measuring what they were calibrated against.
 *  - The left-to-right sort inside a row is what makes a stored citation
 *    mean the same thing on re-export. Two side-by-side headings on a
 *    BA form were measured swapping index between two identical runs; they
 *    land in one overlap row here and are ordered by x, deterministically.
 *  - `i` is assigned densely from array position, which is the contract
 *    `assertLinesWellFormed` states and `boxForLineRange` relies on.
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
 * The single written statement of the producer contract: what any OCR engine
 * must hand this pipeline before anything downstream is allowed to believe a
 * line number.
 *
 * Every rule here is one that nothing else in the tree checks, and whose
 * violation is silent rather than loud:
 *
 *  - `lines[k].i === k`. `boxForLineRange` selects by `i` and then asserts
 *    the COUNT, so a set of lines numbered 0,1,3 answers "lines 0-2" with
 *    two boxes and throws -- but three sites write
 *    `lineRange: [0, lines.length - 1]` straight from the array length, and
 *    those cite the wrong text instead of throwing when `i` is not the array
 *    position.
 *  - Array order non-decreasing in `box.y`. Four consumers read the array
 *    unsorted and call that reading order: the locate prompt, the field
 *    extractor, the whole-page transcript, and the positional
 *    `lines.slice(0, HEAD_LINES)` the classifier uses to decide a page's
 *    document type. An array that is dense and correctly numbered but out of
 *    reading order produces a plausible, wrongly-ordered listing.
 *  - Finite, positive, on-page boxes. `cropToPng`'s own guards are written
 *    as `w <= 0` and `x + w > page.width`, both of which are FALSE for NaN,
 *    so a NaN box reaches `new Uint8ClampedArray(NaN * NaN * 4)` and
 *    produces an empty picture rather than an error. A zero-height box is
 *    invisible to `linesTouchedBy`, so an operator's drag over it silently
 *    cites nothing.
 *
 * Throws with the failing index and the rule named, because the point of
 * calling this at the producer AND at the API boundary is that the first
 * reader of the message is someone who does not yet know which of the two is
 * at fault.
 */
export function assertLinesWellFormed(
  lines: Line[],
  width: number,
  height: number,
): void {
  let previousY = -Infinity;

  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];

    if (line.i !== k) {
      throw new Error(
        `lines[${k}].i is ${line.i}, not ${k}: line numbers must be dense and ` +
          "equal to the array position, or a cited range names different text " +
          "than the rectangle covers",
      );
    }

    const { x, y, w, h } = line.box;
    if (![x, y, w, h].every((v) => Number.isFinite(v))) {
      throw new Error(
        `lines[${k}].box is not finite: ${JSON.stringify(line.box)}. A NaN ` +
          "passes cropToPng's comparison guards and yields an empty image",
      );
    }
    if (w <= 0 || h <= 0) {
      throw new Error(
        `lines[${k}].box is ${w}x${h}: a line with no area is invisible to ` +
          "linesTouchedBy, so a drag over it cites nothing",
      );
    }
    if (x < 0 || y < 0 || x + w > width || y + h > height) {
      throw new Error(
        `lines[${k}].box ${x},${y} ${w}x${h} escapes the ${width}x${height} page`,
      );
    }

    if (y < previousY) {
      throw new Error(
        `lines[${k}].box.y is ${y}, above lines[${k - 1}].box.y of ${previousY}: ` +
          "array order is reading order for the locate prompt, the field " +
          "extractor, the page transcript and the classifier's head slice",
      );
    }
    previousY = y;
  }
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
