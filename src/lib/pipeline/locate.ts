import { z } from "zod";
import type { Box } from "./render.ts";
import { boxForLineRange, type Line } from "./geometry.ts";
import { extractJson } from "./json.ts";
import type { Ask } from "./classify.ts";

export type OcrPage = {
  index: number;
  width: number;
  height: number;
  lines: Line[];
};

export type Zone = {
  pageIndex: number;
  box: Box;
  lineRange: [number, number];
};

export type LocateResult = {
  zone: Zone;
  text: string;
  confidence: "high" | "low";
} | null;

/**
 * A crop flush against the glyphs looks clipped once it is a picture in a
 * Word table. Twelve pixels at 300 DPI is about 1mm of white space.
 */
export const CROP_PADDING_PX = 12;

/**
 * How many times the block's OWN median line pitch a vertical gap must exceed
 * before what follows it is read as a running page footer rather than as more
 * of the block. See `trimRunningFooter`.
 *
 * Picked from the measured distribution, not by taste, and the first value
 * tried was wrong in a way worth recording. 8 looked comfortable against the
 * one footer this bundle demonstrates (33x its block's line pitch) until
 * `pnpm measure:locate` was made to print the same ratio for the twelve
 * HUMAN-authored crops -- every gap inside one of those is content spacing a
 * person deliberately kept, so it is a gap this rule must never cut. Those
 * measure 1.5x, 1.5x, 2.0x, 2.3x, 2.7x, 3.0x, 3.2x, 5.0x, 6.1x, 7.1x and
 * 8.5x. A threshold of 8 sits INSIDE that range: the `SP / Isi Surat` crop
 * alone would have been eligible for trimming.
 *
 * 16 is the middle of the empty band between the widest legitimate gap
 * measured (8.5x) and the footer (33x) -- roughly a factor of two of clearance
 * on each side, in the ratio terms the rule actually thresholds on. The gate
 * prints both bounds on every run and warns if a crop ever reaches this
 * constant, so the margin is checked rather than remembered.
 */
export const FOOTER_GAP_MULTIPLE = 16;

/**
 * Below this many lines, "the block's median line pitch" is not a
 * measurement. Three lines give two gaps, and a median of two numbers that
 * includes the very outlier being tested is not robust.
 */
const MIN_LINES_FOR_GAP_TRIM = 4;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Drops trailing lines that are separated from the rest of the chosen block by
 * a vertical gap far larger than the block's own line spacing.
 *
 * ## Why this is not the page-position rule that was already rejected
 *
 * The prompt asks the model to stop at "the next heading, the next unrelated
 * section, or the end of the page". A running page footer is none of those, so
 * the model runs into it. Measured on the sample bundle, `KB / TTD Pejabat`
 * answers lines 3-16 of the contract's last page: lines 3-15 are the closing
 * paragraph and signature block, ending 41% down the page, and line 16 is the
 * initialling-and-page-number strip at 92%. The union is 9.11in tall for a
 * block the human cropped at 1.98in -- six inches of blank paper carried into
 * the deliverable as evidence.
 *
 * An earlier attempt at a geometric fix keyed on where a line sits on the PAGE
 * (drop a line inside a y-band that repeats across the pool). That was rightly
 * rejected: this bundle's footer band sits at 91.7-92.7% of page height while
 * `KB / Detail`'s last line of real body text sits at 90.4%, so any threshold
 * that catches the footer is roughly one line away from deleting evidence, and
 * a constant fitted to one bundle's margins is not document-agnostic.
 *
 * This rule measures something else entirely: a gap between two lines, in
 * units of the surrounding text's own line pitch. It never refers to page
 * height, page margins, or a position on the page, so it carries over to a
 * document with different margins, a different page size, or a different scan
 * DPI unchanged -- the numerator and the denominator scale together.
 *
 * The separation it relies on is wide, not marginal. Measured across all
 * twelve human-authored crops in the sample, the largest gap that occurs
 * INSIDE a crop -- the gaps this rule must never cut -- is 8.5x, while the
 * footer `KB / TTD Pejabat` swallowed sits 33x above its block's pitch.
 * `FOOTER_GAP_MULTIPLE` is 16, in the empty middle of that band; see its own
 * comment for why the first value tried was too low. `pnpm measure:locate`
 * prints both bounds on every run, so the margin stays checked rather than
 * asserted here.
 *
 * ## What it deliberately does not do
 *
 * It only trims the END of the block. A letterhead at the top is the mirror
 * image, but no measured reply in the sample begins on one, so a leading trim
 * would be behaviour added on a hunch -- and this function's whole claim to
 * being safe is that every part of it is answering a measurement.
 *
 * It cuts at the LAST oversized gap rather than dropping one final line,
 * because a footer can OCR as more than one line; those lines sit close to
 * each other, so the oversized gap is the one above the first of them.
 *
 * It refuses to fire when too few lines remain to have measured anything, and
 * it returns the range untouched -- never a reversed or empty one -- in every
 * case it declines, so `boxForLineRange` still raises the same errors it did
 * before on a malformed reply.
 */
export function trimRunningFooter(
  lines: Line[],
  from: number,
  to: number,
): [number, number] {
  const picked = lines
    .filter((l) => l.i >= from && l.i <= to)
    .sort((a, b) => a.i - b.i);
  if (picked.length < MIN_LINES_FOR_GAP_TRIM) return [from, to];

  // Top-to-top pitch, not the white space between glyph boxes. A line's box
  // height is set by its tallest glyph, so a box-gap measure reads the space
  // under an all-caps line as smaller than the identical leading under a
  // lowercase one. Top-to-top is the typographic leading and is stable.
  const pitches: number[] = [];
  for (let k = 1; k < picked.length; k++) {
    pitches.push(picked[k].box.y - picked[k - 1].box.y);
  }

  const typical = median(pitches);
  // A degenerate block (every line at the same y, e.g. one row of a table that
  // OCR split) has no pitch to be a multiple of. Decline rather than divide.
  if (typical <= 0) return [from, to];

  let cutAfter = -1;
  for (let k = 0; k < pitches.length; k++) {
    if (pitches[k] >= FOOTER_GAP_MULTIPLE * typical) cutAfter = k;
  }
  if (cutAfter < 0) return [from, to];

  const kept = picked.slice(0, cutAfter + 1);
  if (kept.length < MIN_LINES_FOR_GAP_TRIM) return [from, to];

  return [from, kept[kept.length - 1].i];
}

const Reply = z.object({
  pageIndex: z.number().int().min(0).nullable(),
  from: z.number().int().min(0).nullable(),
  to: z.number().int().min(0).nullable(),
  confidence: z.enum(["high", "low"]),
});

/**
 * Page headers are numbered by their *position in this listing* (0, 1, 2...
 * in the order shown), never by the page's true index in the source
 * document. A pool like the Surat Penunjukan's `[23, 24, 25, 26]` would
 * otherwise be the only pool whose first page is not labeled "page 0" --
 * measured behaviour (see task-7-report.md) is that the model then answers
 * with a `pageIndex` one below the true page it clearly meant (its chosen
 * `from`/`to` lines matched the intended page's content exactly, just under
 * the wrong label), consistent with treating a non-zero first label as a
 * 1-based ordinal to be converted to 0-based rather than an opaque id to
 * echo back. Every other pool offered so far happens to start at 0, which
 * hides this: a "-1 conversion" and "copy the label verbatim" habit produce
 * the same answer when the first label is already 0. Local, always-0-based
 * position numbering removes the ambiguity outright instead of trying to
 * out-word it, and costs nothing -- `locateSlot` maps the reply straight
 * back to `pages[reply.pageIndex].index` for the true page identity.
 *
 * ## DO NOT ADD A SENTENCE TO THIS PROMPT WITHOUT RE-RUNNING THE GATE
 *
 * The wording below is a measured asset: it is what moved the gate from 6/12
 * to 9/12 under the old scoring rule, and the tree measures 11/12 with it.
 * Every slot is asked with this same text, so changing one sentence re-asks
 * all eight field slots and re-rolls all eight answers.
 *
 * Two attempts to close the footer defect (below) by adding a boundary
 * sentence here were A/B'd against the real bundle and both REVERTED:
 *
 *  - naming the running strip at the top AND bottom of the page: 11/12 -> 10/12
 *    (reproduced twice). It fixed `KB / TTD Pejabat` but walked `KB / Detail`
 *    from lines 2-28 to 0-28, a whole-page grab.
 *  - naming only the bottom footer, described by its content ("Page 3 of 23"):
 *    11/12 -> 9/12. It fixed `KB / TTD Pejabat` too, and broke `KB / Tanggal`
 *    (2-12 for a 2-line crop) and `KB / ToP (1)` (11-27, missing its crop).
 *
 * Both wordings fixed the target and cost more elsewhere, which is why the
 * repair that shipped is `trimRunningFooter` -- geometry applied after the
 * reply, leaving this prompt untouched.
 *
 * ### The noise floor, which any future A/B here has to clear
 *
 * The same prompt asked three times gives the SAME total (11/12 each time) but
 * NOT the same answers: 4 of the 8 field slots returned a different line range
 * across those three identical runs (`KB / Para Pihak` 13-42 / 11-42,
 * `KB / Jangka Waktu` 25-42 / 25-43, `KB / ToP (2)` 6-15 / 6-16,
 * `KB / TTD Pejabat` 3-16 / 1-16). Sample it with
 * `MEASURE_LOCATE_REPEAT=1 pnpm measure:locate`, which re-asks under a separate
 * cache key.
 *
 * So "this change moved N of the twelve answers" is NOT evidence of anything --
 * half of them move on their own. Judge a prompt change on the TOTAL, and
 * sample it more than once before believing a one-point difference.
 *
 * ## The footer defect, and why the fix is geometric rather than a prompt rule
 *
 * The boundary paragraph below stops the block at "the next heading, the next
 * unrelated section, or the end of the page". A running page footer is none of
 * those, so the model ends its block on one.
 *
 * Measured on the sample bundle: `KB / TTD Pejabat` answers lines 3-16 of the
 * contract's last page (1-16 on two of the three samples). Lines 3-15 are the
 * closing paragraph and signature block, ending at y=1493 of a 3507px page;
 * line 16 is the initialling-and-page-number strip at y=3216. The crop was
 * 9.11in tall for a block the human cropped at 1.98in. `trimRunningFooter`
 * brings it to 3.03in (1.53x the human's) with no other slot moving at all.
 *
 * An earlier version of this note also named `SP / TTD`, `KB / Jangka Waktu`,
 * `KB / Detail` and `KB / ToP (1)` as ending on their footer "the same way".
 * Re-measured, that list is wrong and the error mattered, because it made the
 * defect look four times bigger than it is:
 *
 *  - `SP / TTD` makes NO model call -- it is a `layout: "images"` whole-page
 *    capture, so it has no line range to be wrong about.
 *  - `KB / Jangka Waktu` does not take the footer at all on the sampled run
 *    (25-42 against a human 25-42, exactly 1.00x).
 *  - `KB / Detail` and `KB / ToP (1)` do take it, but their body text already
 *    runs to 90% and 84% of the page, so the footer adds 1.05x and 1.20x --
 *    not worth a prompt change, and `trimRunningFooter` deliberately leaves
 *    both alone rather than firing near legitimate content.
 *
 * `pnpm measure:locate` now prints a crop-extent table on every run, so these
 * are printed numbers rather than remembered ones.
 */
export function buildLocatePrompt(
  slotLabel: string,
  hint: string,
  pages: OcrPage[],
): string {
  const listing = pages
    .map(
      (p, position) =>
        `--- page ${position} ---\n` +
        p.lines.map((l) => `${l.i}: ${l.text}`).join("\n"),
    )
    .join("\n\n");

  return [
    `Find the section of this document that answers the field "${slotLabel}".`,
    `What that field means: ${hint}`,
    "",
    "The pages below are OCR text with every line numbered. Choose the whole",
    "labelled block or section that contains this field, not the single line",
    "that states it. The result is cropped out and pasted into a validation",
    "document as evidence, so it must carry enough surrounding context for a",
    "reviewer to see what they are looking at without opening the source.",
    "",
    "Include the section heading or label line, every line of that block, and",
    "stop at the natural boundary: the next heading, the next unrelated",
    "section, or the end of the page. When the field sits inside a table or a",
    "numbered clause, return the whole table or clause. Prefer taking a few",
    "lines too many over cutting the block short. Do not run on into an",
    "unrelated section.",
    "",
    "Pages are numbered by their position in this list: the first page shown",
    "is page 0, the second is page 1, and so on, regardless of where each",
    "page sits in the original document.",
    "",
    'Reply with JSON only: {"pageIndex":0,"from":7,"to":8,"confidence":"high"}',
    "(pageIndex is that position number, not a document page number.)",
    'If no page contains it, reply {"pageIndex":null,"from":null,"to":null,',
    '"confidence":"low"}.',
    "",
    listing,
  ].join("\n");
}

export async function locateSlot(
  slotLabel: string,
  hint: string,
  pages: OcrPage[],
  ask: Ask,
): Promise<LocateResult> {
  const reply = Reply.parse(
    extractJson(await ask(buildLocatePrompt(slotLabel, hint, pages))),
  );

  if (reply.pageIndex === null || reply.from === null || reply.to === null) {
    return null;
  }

  // reply.pageIndex is a position in `pages` (see buildLocatePrompt's header
  // comment), not the page's own true index -- look it up by array position,
  // then use the page's real `.index` below for anything that leaves this
  // function.
  const page = pages[reply.pageIndex];
  if (!page) {
    throw new Error(
      `model returned pageIndex ${reply.pageIndex}, which is not a position in the ` +
        `${pages.length} pages offered (0-${pages.length - 1})`,
    );
  }

  // The model is asked for text boundaries and cannot see the page, so it has
  // no way to know that its last line is a running footer two thirds of a page
  // below the block. Trimming here rather than in the prompt keeps the prompt
  // wording -- a measured asset -- untouched. `from` and `to` below are the
  // TRIMMED range, and every one of the three things that leave this function
  // is derived from it: the box, the `lineRange` a reviewer reads as the
  // citation, and the `text` transcript. Letting any one of them keep the
  // untrimmed range is the wrong-and-quiet shape -- a crop that disagrees with
  // the line numbers printed beside it.
  const [from, to] = trimRunningFooter(page.lines, reply.from, reply.to);

  const bounds: Box = { x: 0, y: 0, w: page.width, h: page.height };
  const box = boxForLineRange(page.lines, from, to, CROP_PADDING_PX, bounds);

  return {
    zone: { pageIndex: page.index, box, lineRange: [from, to] },
    // Sorted by line number rather than trusting `page.lines`' array order.
    // `groupWordsIntoLines` is the only producer today and it emits lines in
    // `i` order, so this is currently a no-op -- but `OcrPage.lines` is a
    // plain `Line[]` a caller supplies, and the moment one is assembled from
    // a cache, a merge, or a re-ordered subset, an unsorted array turns this
    // join into scrambled evidence text. The box above is safe either way
    // (`unionBoxes` is order-independent); only the text is exposed. Scrambled
    // text is the wrong-and-quiet shape exactly: nothing throws, the crop
    // still looks right, and the transcript beside it silently disagrees
    // with the picture.
    text: page.lines
      .filter((l) => l.i >= from && l.i <= to)
      .sort((a, b) => a.i - b.i)
      .map((l) => l.text)
      .join("\n"),
    confidence: reply.confidence,
  };
}
