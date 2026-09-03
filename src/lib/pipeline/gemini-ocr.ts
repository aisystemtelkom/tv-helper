/**
 * OCR by Gemini vision: a page image in, this pipeline's own numbered `Line[]`
 * out.
 *
 * Pure in the same sense `classify.ts` is pure: no provider SDK import, no
 * `fetch`, no network, no credential. The model call arrives as an injected
 * `AskImage`, so `src/lib/model.ts` stays the only file that knows how the
 * model is reached, and the whole conversion is testable offline against
 * fixture reply strings.
 *
 * ## What this replaces, and the two things the probe measured that shape it
 *
 * Under tesseract the pipeline's central claim was "the model is never asked
 * for a pixel coordinate": OCR supplied a real glyph box per word and the
 * model only ever answered with a line RANGE. That claim inverts here -- the
 * boxes now come from the model -- and it was inverted on measurement, not on
 * faith: against tesseract's own glyph boxes on four real 300 DPI pages the
 * median IoU was 0.897 with no systematic offset, and 99 of 104 blocks fully
 * contained their glyphs once the 12px `CROP_PADDING_PX` the exporter already
 * adds was allowed.
 *
 * Two measured findings are load-bearing on the code below:
 *
 *  1. GEMINI RETURNS PARAGRAPH BLOCKS, NOT VISUAL LINES, and cannot be
 *     prompted out of it. A 43-line justified contract page came back as 23
 *     entries, 10 of them multi-line, one spanning 7 printed lines. A
 *     deliberately strict "one entry per physical line, no entry may ever
 *     contain a newline" prompt returned 22 entries with 10 still multi-line.
 *     Every line-denominated constant in this tree -- FOOTER_GAP_MULTIPLE,
 *     MAX_FOOTER_LINES, HEAD_LINES, TOUCH_RATIO, the gate's proportional
 *     overshoot rule, the sample's twelve human crops running 2 to 43 lines --
 *     assumes one entry is one printed line. So the PRODUCER manufactures the
 *     granularity (see `bandsFor`), and the prompt does not try.
 *  2. GEMINI CONFABULATES SMALL PRINT confidently, deterministically and
 *     invisibly at whole-page resolution, while reading the same region
 *     perfectly as a crop. Nothing in this module can catch that; the
 *     crop-level second pass on values bound for the xlsx is what does. Do not
 *     read a clean `report` here as a statement about text quality.
 */

import { z } from "zod";

import { encodePng } from "../export/png.ts";
import { assertLinesWellFormed, groupWordsIntoLines, type Line, type Word } from "./geometry.ts";
import { extractJson } from "./json.ts";
// `detectRuntime` lives in `ocr.ts` today only because that is where it was
// written. It is engine-agnostic and survives tesseract's removal; the plan
// hoists it to `src/lib/runtime-scope.ts` when `ocr.ts` goes, and `png.ts`
// repoints at it then too. Importing it from here is deliberately temporary.
import { detectRuntime } from "./ocr.ts";
import type { Box, RenderedPage } from "./render.ts";

/**
 * The image-capable ask.
 *
 * Declared HERE and nowhere else, deliberately not beside `Ask` in
 * `classify.ts`. That separation is what lets a reader confirm in one line
 * that classify, locate and extract are still provably text-only: `Ask` is
 * `(prompt: string) => Promise<string>` and has no image parameter anywhere
 * in `src/lib/pipeline/`, and `AskImage` has exactly one consumer.
 */
export type ImageInput = { bytes: Uint8Array; mediaType: "image/png" };

/**
 * A JSON Schema the provider is asked to CONSTRAIN GENERATION to, not merely
 * to be told about. It is deliberately a required parameter of `AskImage`
 * rather than something a caller opts into.
 *
 * MEASURED, and the measurement is the whole reason this parameter exists.
 * Four real 300 DPI contract pages, `gemini-3.5-flash`, same prompt:
 *
 *     without a response schema:  0 of 4 replies were parseable JSON
 *     with one:                   4 of 4, keys exactly {box_2d, text}, 0 bad boxes
 *
 * Unconstrained, the model emits a doubled key (`"label": "text": "..."`), a
 * `box_2d` that is a string rather than an array, a third key spelling
 * (`text_content`), and outright syntax errors mid-array -- four distinct
 * malformations, each of which took a whole page down. Every one of them
 * disappears under constrained decoding, because the grammar cannot produce
 * them.
 *
 * The tolerances below (`repairDoubledKeys`, the three accepted key
 * spellings, the non-array `box_2d` drop) are kept as defence in depth, NOT as
 * the load-bearing path. If this schema is ever dropped they are what stands
 * between the pipeline and a blank run -- but they were each written after a
 * failure, and the schema is what stops the next unmeasured malformation.
 */
export type ResponseSchema = Record<string, unknown>;

export const OCR_RESPONSE_SCHEMA: ResponseSchema = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          box_2d: {
            type: "array",
            items: { type: "integer" },
            minItems: 4,
            maxItems: 4,
          },
          text: { type: "string" },
        },
        required: ["box_2d", "text"],
      },
    },
  },
  required: ["lines"],
};

/**
 * `schema` is REQUIRED, so a caller cannot forget it and quietly fall back to
 * the unconstrained behaviour that measured 0 of 4. `ocrPageWithGemini`
 * supplies `OCR_RESPONSE_SCHEMA`; the caller's only job is to forward it to
 * the provider, which is the one thing this module must not do itself.
 */
export type AskImage = (
  prompt: string,
  image: ImageInput,
  schema: ResponseSchema,
) => Promise<string>;

/**
 * Hand-bumped, and part of every OCR cache key.
 *
 * The generate cache is content-addressed on the source PDF's hash, which is
 * what makes it hazard-free for a fixed engine. It is NOT hazard-free across a
 * prompt change: the same pixels would keep hitting an entry produced by
 * different wording forever, and the run would look both fast and correct.
 *
 * IT VERSIONS THE WHOLE REPLY-TO-LINES PIPELINE, not only the wording. The
 * cached artifact is the converted `Line[]`, so a change to how a reply is
 * split into bands changes what the same pixels and the same prompt produce
 * just as surely as a reworded sentence does. Bump this whenever `OCR_PROMPT`
 * changes by so much as a word, OR whenever `linesFromGeminiReply` changes what
 * it makes of a given reply.
 *
 * v1 -> v2: edge blanks in an entry's transcription stopped consuming a band
 * (see `printedSegments`), and the doubled-key repair below landed. Both change
 * the geometry produced from an identical reply.
 *
 * DELIBERATELY NOT BUMPED for the collapsed-block and thin-page reasons. They
 * only measure and report: the same reply still produces byte-identical
 * `Line[]`, and the rule above is about what this module makes of a reply, not
 * about what it says while making it. Bumping would invalidate 41 cached image
 * reads to change nothing downstream, and would also destroy the one property
 * that makes the new alarms checkable for free -- that a cached gate re-run
 * must still print the same 9/12 while flagging the two pages it previously
 * called clean.
 */
export const OCR_PROMPT_VERSION = "v2";

/**
 * Free-form wording, on purpose.
 *
 * The one prompt variant worth trying was tried: a strict "one entry per
 * physical line" instruction changed nothing about the block granularity and
 * cost 14 more input tokens. Effort spent here is effort wasted; the
 * granularity is manufactured downstream instead.
 *
 * The JSON shape sentence asks for an OBJECT rather than a bare array because
 * `extractJson` spans first-`{` to last-`}`, and a top-level array would not
 * parse at all.
 *
 * The "do not invent" sentence is not expected to work -- the probe measured a
 * faint footer coming back as four different plausible strings across five
 * identical calls, never flagged, never declined. It is here because it costs
 * nothing, not because it is a control.
 *
 * DO NOT REWORD THIS TO FIX THE DOUBLED-KEY DEFECT. That was measured too, on a
 * synthetic page, and the answer is that the wording is not the lever. See
 * `repairDoubledKeys`: four variants were tried -- the key named `text`, the
 * key named `label`, the key named `transcription`, and an explicit "never emit
 * a label key and never write two keys before one value" -- and every one of
 * them still produced `"label": "<the asked-for key>": "<value>"` on at least
 * one of two identical calls. Effort spent here is effort wasted twice over.
 */
export const OCR_PROMPT = [
  "Detect every region of printed text on this scanned page and transcribe it.",
  "Return the 2D bounding box of each region as box_2d.",
  "",
  "Transcribe exactly what is printed, in the original Indonesian or English:",
  "headings, table cells, form labels, form values, page numbers, footers,",
  "stamp and letterhead text. Do not translate, correct, reorder or summarise.",
  "Where a region is illegible, transcribe only what is actually readable.",
  "",
  "Reply with JSON only, as a single object:",
  '{"lines":[{"box_2d":[ymin,xmin,ymax,xmax],"text":"..."}]}',
].join("\n");

export type OcrReport = {
  /** Entries in the model's reply, before any of them were validated. */
  blocks: number;
  /** Per-printed-line bands kept after splitting and dropping blank ones. */
  segments: number;
  /** Numbered lines handed downstream. */
  lines: number;
  /**
   * Of those, how many have a box that was sliced rather than returned.
   *
   * A NUMBER TO PRINT, NOT AN ALARM. See `pageGeometry` for why the alarm this
   * used to raise was deleted.
   */
  interpolatedLines: number;
  /** Entries dropped because their box failed validation. */
  droppedEntries: number;
  /** Non-whitespace characters transcribed across every kept line. */
  transcribedChars: number;
  /** The lowest returned box bottom, as a share of the page height. */
  verticalCoverage: number;
  /** Median height of a numbered line, in pixels. */
  medianLineHeight: number;
  /** Lines that are one printed line inside a paragraph-sized box. */
  collapsedBlocks: number;
  /** Page-wide characters per unit of box area, over a normal line's own. */
  lineDensityRatio: number;
  /**
   * The lowest returned box bottom over the page's own last ink row, measured
   * from the RGBA the model was shown. See `checkPageCompleteness`.
   *
   * OPTIONAL, and absent wherever no pixels were available. `/api/ocr` receives
   * a PNG and returns lines, and the migration spec's ruling that the route
   * stays pixel-free is not being widened for a diagnostic: the check runs on
   * the device, which already holds the RGBA and is the only side that can
   * re-request a page. A caller that ran the check fills this in; a caller that
   * could not leaves it undefined, and undefined must never read as "checked
   * and fine".
   */
  inkCoverage?: number;
  /**
   * The other half of the same assertion: the most ink, in one stretch of the
   * page, that no returned box covered, over the page height. Optional for
   * exactly the same reason as `inkCoverage`, and absent means not measured.
   *
   * Both are stored rather than only the verdict because a cached page keeps
   * them and `scripts/measure-locate.mjs` re-reads them: the assertion itself
   * cannot re-fire on a cached run, since that would need the pixels back.
   */
  uncoveredInkRunShare?: number;
  degraded: boolean;
  reasons: string[];
};

/**
 * The reply shape, with the coordinate tuple deliberately typed as
 * `unknown[]`.
 *
 * The split is between PACKAGING and CONTENT, the same rule `extractJson`
 * follows. A reply that is not `{lines:[{box_2d, text}]}` at all is a
 * packaging failure and throws here, loudly, for the whole reply. A single
 * entry whose coordinates are the wrong arity, the wrong type, non-finite or
 * in the wrong convention is a CONTENT failure of that one entry, and it is
 * dropped and counted so the convention guard downstream can decide whether
 * the reply as a whole is unusable.
 *
 * Typing `box_2d` as `z.number()` would route both through the same throw and
 * lose that distinction -- and it would also throw on `1e999`, which is legal
 * JSON, parses to `Infinity`, and is precisely the non-finite case the
 * validator below exists to drop.
 */
const Reply = z.object({
  lines: z.array(
    z
      .object({
        // `unknown`, not `unknown[]`. A `box_2d` that arrives as a string is a
        // CONTENT failure of one entry and belongs in `convertBox`'s
        // drop-and-count, not in a throw that discards the other 23 lines of
        // the page. Measured: one entry of 24 on a real page came back as a
        // string, and `z.array(...)` here took the whole page down with it.
        box_2d: z.unknown(),
        // THREE SPELLINGS, all measured coming back from a prompt that asks
        // for exactly one of them. `label` is the key Gemini's
        // object-detection habit reaches for; `text_content` turned up on a
        // real contract page alongside `label` in the same entry. None of
        // these is speculative tolerance -- each was observed, and accepting
        // it turns an otherwise perfectly usable page into a usable page.
        // Preference order at the read site is text, then text_content, then
        // label, because `label` is the one Gemini also uses for a short
        // region NAME rather than a transcription.
        text: z.string().optional(),
        text_content: z.string().optional(),
        label: z.string().optional(),
      })
      // An entry carrying NONE of them is a packaging failure and throws for
      // the whole reply, exactly as a missing `text` did before. It is the one
      // case where widening the schema must not widen what is accepted.
      .refine(
        (e) =>
          typeof e.text === "string" ||
          typeof e.text_content === "string" ||
          typeof e.label === "string",
        {
          message:
            'an entry has no "text", "text_content" or "label" transcription',
        },
      ),
  ),
});

/**
 * Repairs the one malformation gemini-3.5-flash reliably emits, and NOTHING
 * else.
 *
 * MEASURED, not guessed at. On a synthetic page with invented content, asked
 * with this module's own prompt, the model returns entries like:
 *
 *     {"box_2d": [191, 97, 206, 375], "label": "text": "BANK CONTOH NUSANTARA"}
 *
 * which is not JSON -- a key, a colon, and then another key instead of a value.
 * `extractJson` is a strict `JSON.parse` by design and throws a SyntaxError, so
 * ONE such entry anywhere on the page takes the whole page down, and with it
 * the run. It arrived on 5 of 8 whole-page calls across four prompt variants,
 * so it is the common case rather than an edge one.
 *
 * The cause is the model welding its object-detection output format
 * (`{box_2d, label}`) onto whatever key the prompt asked for. It follows the
 * asked-for key faithfully and simply prefixes a stray `"label":` to it: asking
 * for `transcription` produced `"label": "transcription": "..."`. That is why
 * this lives here and not in the prompt -- see `OCR_PROMPT`.
 *
 * WHY REPAIRING IS ALLOWED HERE. `extractJson`'s standing rule is "recover from
 * packaging, never from content", and this is packaging in the strictest sense:
 * in JSON a key may not be followed by another key, so `"label": "text": "v"`
 * has exactly one possible reading -- the value belongs to the second key and
 * the first has none. Nothing is inferred about the transcription or the box.
 * The lookahead requires the following token to be a quoted string FOLLOWED BY
 * A COLON, so a legitimate `"label": "BANK CONTOH NUSANTARA"` is untouched, and
 * so is a value with a colon inside it (`"label": "Nomor LOP: LOP999001"`),
 * where the colon falls inside the quotes rather than after them.
 *
 * It runs on the raw reply string, BEFORE `extractJson`, so `extractJson`
 * remains the single parse gate every model reply in this tree goes through
 * (AGENTS.md) and no other caller inherits a tolerance it did not ask for.
 */
export function repairDoubledKeys(reply: string): string {
  return reply.replace(/"label"\s*:\s*(?="(?:[^"\\]|\\.)*"\s*:)/g, "");
}

/** Gemini's documented convention: `[ymin, xmin, ymax, xmax]`, scaled 0-1000. */
const NORMALIZED_MAX = 1000;

/**
 * Beyond this share of entries failing box validation, the reply is not a
 * thin page -- it is a reply in a different coordinate convention, and it must
 * be an error rather than a handful of survivors. See `convertBox`.
 */
const MAX_DROPPED_SHARE = 0.05;
const MIN_DROPPED_ALLOWANCE = 3;

/**
 * Below this many lines a page's own median is not a statistic, and the two
 * alarms that compare against that median are not allowed to fire.
 *
 * The 29 pages of the gate bundle carry 18 to 54 numbered lines and the twelve
 * human crops carry 2 to 54, so this only ever silences a crop small enough
 * that its line count already says everything there is to say about it.
 *
 * IT DOES NOT SILENCE `COLLAPSED_TEXT_ASPECT`, and that is the correction, not
 * an oversight: suppressing every alarm below 8 lines was anti-correlated with
 * severity, because the worse the under-read the fewer lines survive to be
 * judged. The aspect rule needs no page statistic at all, so it fires at any
 * line count.
 */
const MIN_LINES_FOR_PAGE_STATISTICS = 8;

/**
 * A box this many times the page's median line height, carrying a single
 * printed line, is a COLLAPSED BLOCK: a paragraph-sized rectangle with only the
 * paragraph's first line transcribed into it.
 *
 * This is the second of the two silent under-read modes measured on 2026-09-02,
 * and it is the one that reads as completely clean everywhere else. Because the
 * returned text carries no newline, `printedSegments` sees one segment,
 * `bandsFor` never splits it, and the line is tagged `"measured"` -- so
 * `droppedEntries` is 0, `interpolatedLines` is 0, `finishReason` is STOP, and
 * nothing at all says the other four printed lines of that paragraph are
 * missing. The line NUMBERING every slot proposal and every stored citation is
 * denominated in silently collapses with it.
 *
 * MEASURED over the 29 pages of the gate bundle and the twelve human crops, at
 * 2x: 27 of 29 pages and 12 of 12 crops scored 0 or 1, `splitba:0` scored 6 and
 * `merged:20` scored 10. The alarm therefore fires at 2, which is one page of
 * margin over everything healthy this bundle contains -- thin, and calibrated
 * on one bundle, which is the honest description of every constant in this
 * tree. 2.5x separates identically (0-1 healthy, 4 and 10), so the multiple is
 * not on a cliff edge even though the count is.
 *
 * THIS RULE CANCELS ITSELF WHEN THE DEFECT IS THE NORM, which is why it is no
 * longer the only one. `medianLineHeight` is computed over the very lines being
 * judged, so a page whose paragraphs ALL came back as one line each has a
 * median that IS the collapsed height, and not one line is over 2x it. The same
 * page-wide shape cancels `lineDensityRatio` too, for the same reason: the
 * reference band then contains the collapsed lines themselves and the ratio is
 * 1.000 by construction. `splitba:0` was caught only because its defect hit a
 * minority of its lines (6 of 27). `COLLAPSED_TEXT_ASPECT` below is the
 * absolute anchor that does not cancel.
 *
 * ONE STRUCTURAL FALSE-POSITIVE SOURCE, not visible from this rule's wording:
 * it counts LINES, and a line is `groupWordsIntoLines`'s union across a whole
 * row. A form row where a tall multi-line cell (arriving space-joined, so one
 * segment) sits at the same y as a short label unions into one `"measured"`
 * line whose height is the tall cell's -- indistinguishable here from a genuine
 * collapsed paragraph. That is the mechanism by which this alarm would start
 * firing on a second bundle with denser forms, and it is flagged for Task 8's
 * re-derivation alongside `THIN_PAGE_DENSITY_RATIO`'s margin.
 */
const COLLAPSED_BLOCK_HEIGHT_MULTIPLE = 2;

/**
 * A line whose box is this many mean character widths TALL is a collapsed
 * block, whatever the rest of the page looks like.
 *
 * THE ABSOLUTE ANCHOR, and the reason it exists is that both of the other two
 * alarms are relative to the page's own median and therefore cancel exactly
 * when the paragraph collapse goes page-wide -- the case that loses the most
 * text and reports the most cleanly. This one compares a line against its own
 * transcription instead of against its neighbours: `box.h * characters /
 * box.w` is the box's height measured in units of the mean character advance
 * of the text inside it. One printed line of type is about two of its own
 * character widths tall whatever the DPI, the font size or the page, so this
 * is scale-free and needs no bundle median, no DPI and no plumbing. A
 * paragraph-sized rectangle carrying one line of text is as many times taller
 * as the printed lines it swallowed.
 *
 * MEASURED over the same 29 cached pages and twelve crops. Per-page count of
 * lines over 4:
 *
 *     13 pages scored 0, 14 pages scored 1, all twelve crops scored 0
 *     splitba:0 (paragraph collapse)    6   its lines run 4.0 to 12.3
 *     merged:20 (granularity collapse)  9   its lines run 14.4 to 69.4
 *
 * THE SEPARATION IS IN THE COUNT, NOT IN THE LINE. Healthy pages do produce a
 * single line over 4 -- a letterhead unioned across a row, a duty-stamp block
 * standing on end -- at 4.8 to 23.8, which overlaps the defect's own range.
 * Those are the union-across-a-row artifact described above, and they are why
 * the alarm needs two before it says anything.
 *
 * ITS SENSITIVITY FLOOR IS ABOUT 2X, like the median rule's. A paragraph read
 * down to two of its three printed lines lands near 3 and is not caught by
 * either. Nothing here catches a mild under-read; the pixel-side completeness
 * assertion is what stands behind them all.
 */
const COLLAPSED_TEXT_ASPECT = 4;

/**
 * How many collapsed lines a page may carry before it is called out.
 *
 * MEASURED MARGIN, RECORDED SO TASK 8 RE-DERIVES IT RATHER THAN CARRYING IT
 * FORWARD UNEXAMINED: on the only bundle ever measured, the two rules together
 * put 13 pages at 0 and 14 pages at 1, against the two defects at 6 and 10. So
 * roughly half the healthy pages in this bundle sit exactly one line below the
 * trigger. That is the same shape as the interpolation alarm this file already
 * deleted for firing on 21 of 29 healthy pages, and it is a candidate to become
 * the same thing on the next bundle.
 */
const COLLAPSED_BLOCK_ALARM_COUNT = 2;

/**
 * The height band a line has to sit in to be a reference for "how densely does
 * this page print".
 *
 * The reference must exclude the collapsed blocks themselves, because they are
 * exactly what is being detected: letting a paragraph-sized box into the median
 * drags the reference toward the defect and the alarm stops separating. On
 * `splitba:0` that is the difference between a ratio of 0.660 and one of 0.629.
 */
const NORMAL_LINE_MIN_MULTIPLE = 0.6;
const NORMAL_LINE_MAX_MULTIPLE = 1.6;

/**
 * Below this, the page is THIN: it transcribed far fewer characters per unit of
 * returned box area than a normally sized line on that same page does.
 *
 * The pure page-shaped proxy for the same paragraph collapse the count above
 * catches entry by entry. Both are computed from the reply alone -- no pixels --
 * so `linesFromGeminiReply` stays pure and its fixture suite stays offline.
 *
 * MEASURED on the same 29 pages: the other 28 ran 0.759 to 1.061 and the twelve
 * crops 0.778 to 0.994; `splitba:0` alone came in at 0.629. 0.70 is the middle
 * of that empty band, derived the way `FOOTER_GAP_MULTIPLE` was.
 *
 * IT IS THE NARROWEST CONSTANT IN THIS TREE AND THE MARGIN BELONGS ON THE
 * RECORD: the three healthy pages nearest it measured 0.759, 0.779 and 0.794,
 * so healthy print comes within 13% of the threshold, and the one defect at
 * 0.629 sits only 8% below the healthy floor. Task 8 re-derives it from a clean
 * run; until then read a pass here as "not obviously thin", not as "dense".
 *
 * IT ALSO CANCELS WHEN THE COLLAPSE GOES PAGE-WIDE, for the same reason
 * `COLLAPSED_BLOCK_HEIGHT_MULTIPLE` does: the reference band is 0.6x-1.6x this
 * page's own median line height, so if every line is a collapsed paragraph the
 * reference is a collapsed paragraph and the ratio is 1.000 by construction.
 * `COLLAPSED_TEXT_ASPECT` is the anchor that survives that case.
 *
 * Two limits worth knowing before reading a clean number as health. It does NOT
 * catch the other under-read mode -- a page that simply stops (`merged:19`
 * transcribed 21 lines whose lowest box bottom was y=1803 of 3507) measured a
 * perfectly ordinary 0.865, because what it did transcribe it transcribed
 * densely. `verticalCoverage` is the number that shows that one, and only the
 * pixel-side completeness assertion can decide it. Nor does it catch
 * `merged:20`, whose ten collapsed blocks each carry 179-448 characters and
 * which therefore measures 1.061, the highest in the bundle: dense, and still
 * roughly twenty-six printed lines short of what the page holds (tesseract read
 * the same page as 47 lines against Gemini's 21). The two alarms are two views
 * of one defect and neither subsumes the other.
 */
const THIN_PAGE_DENSITY_RATIO = 0.7;

/**
 * Converts one `box_2d` into a pixel `Box`, or returns null for the caller to
 * drop and count.
 *
 * TWO SCALE FACTORS, NEVER ONE. `y` scales against the image HEIGHT and `x`
 * against the image WIDTH, independently. A single scalar is the classic
 * plausible-wrong-rectangle bug: on the square-ish crops it looks right, and
 * on a 2480x3507 page it produces a clean, complete-looking picture of the
 * wrong part of the page. Nothing downstream would notice.
 *
 * Rounded to whole pixels because that is the space every consumer works in:
 * `cropToPng` rounds anyway, tesseract's boxes were always integers, and
 * integer edges are what make a block's bands sum back to exactly the block's
 * own box (see `bandsFor`).
 *
 * `segments` is how many printed lines this entry's text claims. The height
 * floor is `segments`, not 1: an entry claiming three printed lines in two
 * pixels cannot produce three bands with any area, and a zero-height band is
 * invisible to `linesTouchedBy`, so an operator's drag over it would silently
 * cite nothing. For a single-line entry this is exactly the `h >= 1` rule.
 */
function convertBox(
  box2d: unknown,
  width: number,
  height: number,
  segments: number,
): Box | null {
  // MEASURED, not defensive: on a real 300 DPI contract page
  // `gemini-3.5-flash` returned one entry of 24 whose `box_2d` was a STRING
  // rather than an array, and the schema's `z.array(...)` rejected the whole
  // page for it -- 23 good lines thrown away over one bad entry, which is the
  // opposite of the packaging/content split this module documents. A wrong
  // TYPE is a content failure of one entry, exactly like a wrong arity, so it
  // is dropped and counted here and the convention guard decides whether the
  // reply as a whole is unusable.
  if (!Array.isArray(box2d)) return null;
  if (box2d.length !== 4) return null;
  if (!box2d.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return null;
  }
  const [ymin, xmin, ymax, xmax] = box2d as number[];

  // Written as `!(a > b)` rather than `a <= b` so a reversed range and a
  // zero-extent range are both rejected by the same clause.
  if (!(xmax > xmin) || !(ymax > ymin)) return null;

  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const left = Math.round(clamp((xmin / NORMALIZED_MAX) * width, width));
  const right = Math.round(clamp((xmax / NORMALIZED_MAX) * width, width));
  const top = Math.round(clamp((ymin / NORMALIZED_MAX) * height, height));
  const bottom = Math.round(clamp((ymax / NORMALIZED_MAX) * height, height));

  const w = right - left;
  const h = bottom - top;
  // A box that lay entirely off the page collapses to zero extent here, which
  // is how a reply in pixel coordinates fails: on a 2480x3507 page nearly
  // every real box has a coordinate above 1000, so scaling it as if it were
  // normalized throws it off the page and it is dropped.
  if (w < 1 || h < segments) return null;

  return { x: left, y: top, w, h };
}

/**
 * Slices a block's box into `n` equal vertical bands, one per printed line.
 *
 * The bands' union is EXACTLY the original box, which is the property that
 * keeps this honest: interpolation redistributes a measured rectangle, it
 * never invents area outside it. The first band's top is the box's top and the
 * last band's bottom is the box's bottom by construction rather than by
 * arithmetic luck, so no rounding residue accumulates at the seam.
 *
 * Equal bands are an approximation of leading, not a measurement, which is the
 * entire reason the resulting lines are tagged `"interpolated"`. Within a
 * paragraph the true pitch is very close to blockHeight/n; across a block that
 * mixes a heading with body text it is not.
 */
function bandsFor(box: Box, n: number): Box[] {
  const bands: Box[] = [];
  for (let k = 0; k < n; k++) {
    const top = box.y + Math.round((box.h * k) / n);
    const bottom =
      k === n - 1 ? box.y + box.h : box.y + Math.round((box.h * (k + 1)) / n);
    bands.push({ x: box.x, y: top, w: box.w, h: bottom - top });
  }
  return bands;
}

/**
 * The printed lines an entry's transcription claims, with EDGE blanks removed
 * and interior blanks kept.
 *
 * The distinction is the whole point, and getting it backwards produces a
 * rectangle that opens fine and is one printed line off:
 *
 *  - An INTERIOR blank is a printed line. `"Kepada\n\nBANK CONTOH NUSANTARA"`
 *    is three printed lines with the middle one empty, and the model's box
 *    bounds all three, so the blank must consume its band or the survivors
 *    shift up onto the wrong ones. That is why blanks are dropped only after
 *    `bandsFor` has paired them, in the loop below.
 *  - A LEADING or TRAILING blank is NOT a printed line. It is a stray newline
 *    in the transcription, and the model's box bounds only the ink -- there is
 *    no blank band above the first glyph or below the last one to consume.
 *    Counting it splits the block into one band too many, so every line in the
 *    block gets a box shifted by an accumulating fraction of a line, up to a
 *    full line off at the bottom. On a single-line entry it is worse: one
 *    trailing newline halves the box, and the crop keeps the top half of the
 *    glyphs and clips the rest. Nothing downstream notices any of it -- the
 *    bands are finite, on-page and plausibly placed.
 *
 * Returns an empty array for an entry that transcribed to nothing at all. That
 * entry contributes no lines and is NOT counted against the convention guard:
 * an empty transcription is a content failure of the text, not evidence that
 * the reply is in a different coordinate convention, and inflating the drop
 * count with it would make the guard fire on a page of empty stamps.
 */
function printedSegments(text: string): string[] {
  const segments = text.split(/\r?\n/);
  let first = 0;
  let last = segments.length - 1;
  while (first <= last && !segments[first].trim()) first++;
  while (last >= first && !segments[last].trim()) last--;
  return segments.slice(first, last + 1);
}

/** Non-whitespace characters, which is what "transcribed" means here. */
function inkChars(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * What a page's own numbered lines say about how completely it was read.
 *
 * Exported and computed from `Line[]` alone, for two reasons that are both
 * load-bearing:
 *
 *  - IT TAKES NO PIXELS, so `linesFromGeminiReply` stays a pure function of
 *    (reply, width, height) and its fixture suite stays offline. Every number
 *    here is derived from boxes and text the model already returned.
 *  - IT TAKES LINES, NOT A REPLY, so `scripts/measure-locate.mjs` can recompute
 *    it over the pages already sitting in its OCR cache. That is the difference
 *    between these alarms arriving on the next fresh 41-image run and arriving
 *    on a cached re-run that costs nothing -- and a diagnostic nobody can afford
 *    to run is a diagnostic nobody runs.
 *
 * `collapsedBlocks` counts LINES rather than reply entries, in the units that
 * survive downstream and that the harness can recount from a cached page. It
 * counts a line flagged by EITHER rule -- taller than four of its own text's
 * character widths, or, on a page with enough lines to have a median, taller
 * than twice that median while carrying a single printed segment. Lines with no
 * `origin` at all (tesseract, and runs ingested before the migration) are never
 * counted, because "not recorded" must not read as "measured".
 *
 * The aspect rule deliberately does NOT require `origin === "measured"`. That
 * requirement excused, by type rather than by measurement, the partial collapse
 * -- a paragraph box carrying the first two of its five printed lines splits
 * into two `"interpolated"` bands that are just as oversized and just as short
 * of their paragraph. See `COLLAPSED_TEXT_ASPECT`.
 *
 * NONE OF THIS IS A STATEMENT ABOUT TEXT QUALITY. The probe measured Gemini
 * confabulating small print confidently and repeatably at whole-page
 * resolution; a page can score perfectly here and still carry a wrong stamp
 * serial. Only the crop-level second pass speaks to that.
 */
export type PageGeometry = {
  transcribedChars: number;
  verticalCoverage: number;
  medianLineHeight: number;
  collapsedBlocks: number;
  lineDensityRatio: number;
  reasons: string[];
};

export function pageGeometry(lines: Line[], height: number): PageGeometry {
  const reasons: string[] = [];
  const transcribedChars = lines.reduce((n, l) => n + inkChars(l.text), 0);
  const lowestBottom = lines.reduce(
    (y, l) => Math.max(y, l.box.y + l.box.h),
    0,
  );
  const verticalCoverage = height > 0 ? lowestBottom / height : 0;
  const medianLineHeight = medianOf(lines.map((l) => l.box.h));

  const enough =
    lines.length >= MIN_LINES_FOR_PAGE_STATISTICS && medianLineHeight > 0;

  // TWO RULES, OR'd, and the split is the point. The median one is sensitive on
  // a page where the collapse is a minority and blind where it is the norm; the
  // aspect one is absolute and blind to nothing, at the cost of one healthy
  // false positive per page from the union-across-a-row artifact. Neither is
  // suppressed by the other, and only the median one is gated on `enough`,
  // because only it needs the page to be a statistic. That gate used to silence
  // BOTH alarms below 8 lines, which was anti-correlated with severity: the
  // worse the under-read, the fewer lines survive to be judged, and a whole
  // page returning six paragraph boxes and a footer switched off every alarm in
  // this file. The aspect rule now fires on exactly that shape.
  //
  // `origin === undefined` is excluded from both: tesseract lines, and runs
  // ingested before the migration, recorded nothing here, and "not recorded"
  // must never read as "measured and fine".
  const collapsedBlocks = lines.filter((l) => {
    if (l.origin === undefined) return false;
    const chars = inkChars(l.text);
    const aspect =
      l.box.w > 0 && chars > 0 ? (l.box.h * chars) / l.box.w : 0;
    if (aspect > COLLAPSED_TEXT_ASPECT) return true;
    return (
      enough &&
      l.origin === "measured" &&
      l.box.h > COLLAPSED_BLOCK_HEIGHT_MULTIPLE * medianLineHeight
    );
  }).length;

  // The reference is a NORMALLY SIZED line's density, not the whole page's
  // median: see NORMAL_LINE_MIN_MULTIPLE.
  const areaOf = (l: Line) => l.box.w * l.box.h;
  const densityOf = (l: Line) =>
    areaOf(l) > 0 ? inkChars(l.text) / areaOf(l) : 0;
  const referenceDensity = medianOf(
    lines
      .filter(
        (l) =>
          l.box.h >= NORMAL_LINE_MIN_MULTIPLE * medianLineHeight &&
          l.box.h <= NORMAL_LINE_MAX_MULTIPLE * medianLineHeight,
      )
      .map(densityOf),
  );
  const totalArea = lines.reduce((a, l) => a + areaOf(l), 0);
  const pageDensity = totalArea > 0 ? transcribedChars / totalArea : 0;
  // 1 is the neutral reading, used where there is nothing to compare against.
  // A zero here would fire the thin-page alarm on every page whose lines are
  // all abnormally tall, which is a different claim than the one it makes.
  const lineDensityRatio =
    referenceDensity > 0 ? pageDensity / referenceDensity : 1;

  if (collapsedBlocks >= COLLAPSED_BLOCK_ALARM_COUNT) {
    reasons.push(
      `collapsed blocks: ${collapsedBlocks} of ${lines.length} lines sit in a ` +
        `paragraph-sized box -- over ${COLLAPSED_TEXT_ASPECT} mean character ` +
        `widths tall, or over ${COLLAPSED_BLOCK_HEIGHT_MULTIPLE}x this page's ` +
        `median line height (${Math.round(medianLineHeight)}px) -- which is what ` +
        "a paragraph read down to its first line looks like",
    );
  }
  if (enough && lineDensityRatio < THIN_PAGE_DENSITY_RATIO) {
    reasons.push(
      `thin page: ${transcribedChars} characters across the returned boxes is ` +
        `${(100 * lineDensityRatio).toFixed(0)}% of the density a normally sized ` +
        "line on this same page prints at",
    );
  }

  return {
    transcribedChars,
    verticalCoverage,
    medianLineHeight,
    collapsedBlocks,
    lineDensityRatio,
    reasons,
  };
}

/**
 * The whole engine: a reply string and the image's own dimensions in, this
 * pipeline's numbered lines out.
 *
 * Exported separately from `ocrPageWithGemini` so every rule below is testable
 * offline, with no API call. `pnpm test` makes no network calls today and that
 * guarantee does not get to lapse because OCR became a model reply.
 *
 * Five moves, in this order:
 *
 *  1. PARSE through `extractJson` then zod, like every other model reply in
 *     this tree, with one measured packaging repair applied to the raw string
 *     first (`repairDoubledKeys`).
 *  2. SPLIT an entry into one segment per printed line, and assign each
 *     segment its band BEFORE dropping the blank ones. Dropping first would
 *     shift every surviving segment onto the wrong band -- a rectangle one
 *     printed line off, which is exactly the kind of wrong that opens fine and
 *     gets signed. An edge blank is the exception and is removed FIRST, by
 *     `printedSegments`, because it is not a printed line at all; see there
 *     for why the two cases pull in opposite directions.
 *  3. CONVERT with two independent scale factors, clamped and validated.
 *  4. GUARD the convention: drop a failing entry and count it, but throw once
 *     too many fail.
 *  5. GROUP through the existing, unmodified `groupWordsIntoLines`, which
 *     supplies dense `i`, reading order, deterministic left-to-right ordering
 *     within a row, and the same-row re-merge every line-denominated constant
 *     in this tree was calibrated against.
 */
export function linesFromGeminiReply(
  reply: string,
  width: number,
  height: number,
): { lines: Line[]; report: OcrReport } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new Error(
      `OCR needs the image's real dimensions, got ${width}x${height}. They come ` +
        "from the PNG's own IHDR so there is one source of truth for the " +
        "coordinate space; a caller-supplied guess is how OCR ends up measured " +
        "at one DPI and cropped at another.",
    );
  }

  const entries = Reply.parse(extractJson(repairDoubledKeys(reply))).lines;

  const bands: Word[] = [];
  // Identity set rather than a field on `Word`: `groupWordsIntoLines` passes
  // the very objects through to `Line.words`, so membership survives the
  // grouping without widening the shared `Word` type for one producer.
  const interpolated = new Set<Word>();
  let droppedEntries = 0;

  for (const entry of entries) {
    // Preference order, not arbitrary: `text` is what the prompt asks for,
    // `text_content` is a spelling Gemini substitutes wholesale, and `label`
    // is last because it is also the key Gemini uses for a short region NAME
    // when it emits a transcription under one of the other two. Taking
    // `label` first would replace a full line of text with the word "footer".
    //
    // `?? ""` is unreachable -- the schema's refine already rejected an entry
    // carrying none of the three -- and is here only because the refine
    // narrows nothing for the type checker.
    const transcription = entry.text ?? entry.text_content ?? entry.label ?? "";
    const segments = printedSegments(transcription);
    // An entry that transcribed to nothing has no printed line to place. It is
    // skipped rather than counted as a box failure -- see `printedSegments`.
    if (segments.length === 0) continue;

    const box = convertBox(entry.box_2d, width, height, segments.length);
    if (!box) {
      droppedEntries++;
      continue;
    }

    const slices = bandsFor(box, segments.length);
    const sliced = segments.length > 1;
    for (let k = 0; k < segments.length; k++) {
      const text = segments[k].trim();
      // Blank segments are dropped only AFTER `slices[k]` has been paired with
      // segment k. See move 2 above.
      if (!text) continue;
      const band: Word = { text, box: slices[k] };
      bands.push(band);
      if (sliced) interpolated.add(band);
    }
  }

  const allowance = Math.max(
    MIN_DROPPED_ALLOWANCE,
    entries.length * MAX_DROPPED_SHARE,
  );
  if (droppedEntries > allowance) {
    throw new Error(
      `${droppedEntries} of ${entries.length} OCR entries failed box validation, ` +
        `over the ${allowance} allowed. This is what a reply in the wrong ` +
        "coordinate convention looks like -- pixels instead of 0-1000, or " +
        "[xmin,ymin,xmax,ymax] instead of [ymin,xmin,ymax,xmax] -- and it must " +
        "be a loud error, not a page that quietly came back with a handful of " +
        "surviving lines.",
    );
  }

  const lines: Line[] = groupWordsIntoLines(bands).map((line) => ({
    ...line,
    origin: line.words.some((w) => interpolated.has(w))
      ? ("interpolated" as const)
      : ("measured" as const),
  }));

  // The producer half of the contract, asserted where it is produced. The
  // other half runs at `/api/propose`'s body parser, before the credential is
  // spent on lines that cannot be cited correctly.
  assertLinesWellFormed(lines, width, height);

  const interpolatedLines = lines.filter(
    (l) => l.origin === "interpolated",
  ).length;

  const geometry = pageGeometry(lines, height);

  const reasons: string[] = [];
  if (droppedEntries > 0) {
    reasons.push(
      `${droppedEntries} of ${entries.length} entries failed box validation`,
    );
  }
  if (lines.length === 0) {
    reasons.push("the reply produced no lines at all");
  }
  reasons.push(...geometry.reasons);

  // THERE IS NO INTERPOLATION ALARM ANY MORE, and its deletion is a measured
  // decision rather than a tidy-up. It fired at "over half this page's lines
  // have sliced boxes" and, on the 2026-09-02 gate run, that was 21 of 29
  // pages -- including entirely healthy ones -- while staying silent on BOTH
  // pages that were genuinely broken (`splitba:0` logged 0 interpolated,
  // `merged:20` logged 2). A warning that fires on 72% of healthy inputs and on
  // neither bad one is not a guard; it is noise that trains the next reader to
  // skip the line, and it did exactly that for four investigations.
  //
  // `interpolatedLines` is still counted and still reported. It is a number to
  // print and read, and its real meaning is a DESIGN outcome, not a per-page
  // fault: at 69% of all lines bundle-wide, this pipeline has quietly become
  // "trust the model's block box with a 12px pad". That is a thing to record
  // and argue about once, not to re-announce per page.
  return {
    lines,
    report: {
      blocks: entries.length,
      segments: bands.length,
      lines: lines.length,
      interpolatedLines,
      droppedEntries,
      transcribedChars: geometry.transcribedChars,
      verticalCoverage: geometry.verticalCoverage,
      medianLineHeight: geometry.medianLineHeight,
      collapsedBlocks: geometry.collapsedBlocks,
      lineDensityRatio: geometry.lineDensityRatio,
      degraded: reasons.length > 0,
      reasons,
    },
  };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** "IHDR", which a PNG requires to be the first chunk. */
const IHDR_TYPE = [0x49, 0x48, 0x44, 0x52];
/** Signature (8) + chunk length (4) + type (4) + width (4) + height (4). */
const IHDR_END = 24;

/**
 * Reads the image's own width and height out of the PNG's IHDR chunk.
 *
 * ONE SOURCE OF TRUTH FOR THE COORDINATE SPACE, and that is the whole reason
 * this exists rather than a `{width, height}` parameter beside the bytes. The
 * scariest silent failure in this design is OCR measured against one set of
 * dimensions and the crop cut from a re-render at another: every box would be
 * finite, on-page, plausibly placed, and wrong. Deriving the dimensions from
 * the bytes themselves makes it impossible to hold the image without holding
 * its coordinate space, and it means `/api/ocr` needs no metadata from its
 * caller at all -- there is nothing for a caller to claim.
 */
export function pngDimensions(png: Uint8Array): {
  width: number;
  height: number;
} {
  if (png.length < IHDR_END) {
    throw new Error(
      `not a PNG: ${png.length} bytes is shorter than a signature plus IHDR`,
    );
  }
  if (PNG_SIGNATURE.some((byte, i) => png[i] !== byte)) {
    throw new Error("not a PNG: the 8-byte signature does not match");
  }
  if (IHDR_TYPE.some((byte, i) => png[12 + i] !== byte)) {
    throw new Error("not a PNG: the first chunk is not IHDR");
  }

  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width < 1 || height < 1) {
    throw new Error(`PNG IHDR declares a ${width}x${height} image`);
  }
  return { width, height };
}

/**
 * Encodes a rendered page for upload.
 *
 * Node encodes in-process with `src/lib/export/png.ts`. The browser hands the
 * pixels to an `OffscreenCanvas` and lets `convertToBlob` do it, which is the
 * browser's own native PNG encoder: against a 2480x3507 page the JavaScript
 * encoder otherwise means a pure-JS CRC32 and row-filter pass over 35MB per
 * page on top of the compression, inside the same worker that is also
 * rendering. Both produce a PNG whose IHDR `pngDimensions` reads back.
 *
 * `detectRuntime()`, never `typeof window`: a Web Worker has no `window`
 * either, and a Web Worker is exactly where this runs in the browser.
 */
export async function pageToPng(page: RenderedPage): Promise<ImageInput> {
  if (detectRuntime() === "node") {
    return {
      bytes: await encodePng(page.data, page.width, page.height),
      mediaType: "image/png",
    };
  }

  if (typeof OffscreenCanvas === "undefined") {
    throw new Error(
      "Encoding a page for OCR in the browser needs OffscreenCanvas, which " +
        "this browser does not expose. Rendering and upload both run in a Web " +
        "Worker, where a DOM <canvas> is unreachable.",
    );
  }

  const canvas = new OffscreenCanvas(page.width, page.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("OffscreenCanvas gave no 2D context.");
  // `RenderedPage.data` is declared as a bare `Uint8ClampedArray`, which TS
  // widens to `ArrayBufferLike`, while `ImageData` insists on `ArrayBuffer`.
  // Every RenderedPage in this codebase comes from `getImageData().data`,
  // which is always ArrayBuffer-backed, so this narrows a fact that already
  // holds rather than asserting a new one.
  const pixels = page.data as Uint8ClampedArray<ArrayBuffer>;
  context.putImageData(new ImageData(pixels, page.width, page.height), 0, 0);

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mediaType: "image/png",
  };
}

/**
 * One page, one call.
 *
 * The dimensions come from the image's own IHDR rather than from a caller, so
 * the coordinate space the boxes are scaled against is provably the coordinate
 * space of the pixels the model was shown.
 *
 * Retry, cost logging and the `finishReason` refusal all live in the caller's
 * `ask`, exactly as they do for every other model call in this tree: this
 * module never learns how the model is reached.
 */
export async function ocrPageWithGemini(
  image: ImageInput,
  ask: AskImage,
): Promise<{ lines: Line[]; report: OcrReport }> {
  const { width, height } = pngDimensions(image.bytes);
  return linesFromGeminiReply(
    await ask(OCR_PROMPT, image, OCR_RESPONSE_SCHEMA),
    width,
    height,
  );
}

// ---------------------------------------------------------------------------
// THE COMPLETENESS ASSERTION.
//
// The one part of this module that is allowed to look at pixels, and it is
// deliberately fenced off down here, below everything `linesFromGeminiReply`
// needs. That function stays a pure function of (reply, width, height) and its
// fixture suite stays offline; the assertion takes the ink extent as a NUMBER
// from whichever caller already holds the RGBA.
//
// THE DEFECT IT EXISTS FOR. On 2026-09-02 Gemini returned a materially
// incomplete transcription of a whole page with `finishReason=STOP`, zero
// dropped entries, no flag anywhere, and output far under the 16384 cap.
// Measured at roughly 7% of whole-page reads (3 short in 43). It hit 2 of the
// 29 pages of the gate bundle, both carrying scored slots, and took the gate
// from 11/12 to 9/12. The other 27 pages read at 0.94x to 1.32x tesseract's
// character volume with a median of 1.03x -- Gemini normally reads MORE than
// tesseract, which is exactly what makes a short read hard to see.
//
// TWO PROPERTIES MAKE THIS ACCEPTABLE where a second segmentation engine
// (the ink-projection profiler of the migration spec's §8.1, which was
// prototyped, measured and refused) is not:
//
//  1. IT NEVER SUPPLIES A COORDINATE. It is an assertion, not a segmenter. It
//     answers yes/no questions about ink the model's boxes did not cover, and
//     the model's boxes remain the only source of geometry anywhere in this
//     pipeline. Nothing it computes is ever written into a `Line`, a zone, a
//     crop or a citation.
//  2. IT CANNOT MOVE A RECTANGLE. A false negative leaves the pipeline exactly
//     where it is today; a false positive costs an image call, and then, if it
//     keeps failing, THE RUN.
//
// PROPERTY 2 USED TO SAY "a wasted retry, not a wrong crop", and that was
// wrong about the terminal case in a way worth correcting rather than quietly
// fixing. After COMPLETENESS_ATTEMPTS this throws `IncompletePageError`, no
// caller catches it, and all three abort: `scripts/generate.mjs` ends the
// bundle with no docx, no xlsx and no OUTSTANDING report; `pipeline.worker.ts`
// stops the ingest; `scripts/measure-locate.mjs` kills the gate. The false
// positive costs the run, not the call. That IS the behaviour the Task 7
// verdict ordered -- "after retries exhaust, fail loudly (never a silent thin
// page)" -- and it is the right trade for this failure class, but a reader has
// to be told the real price rather than a comfortable one.
//
// WHAT A FALSE POSITIVE WOULD LOOK LIKE, since the calibration set contains no
// example of one: ink the model correctly declines to transcribe, below or
// beside the last line of print. A table's bottom rule, a page frame, a wet
// stamp, a signature (AGENTS.md records Gemini declining handwriting on
// `TTD Pejabat`), a punch-hole shadow, a photocopy edge. All 29 calibration
// pages happened to carry text within 1.5% of their ink bottom, so this shape
// is untested, and the tool is required to be document-agnostic.
//
// AND IT IS STILL TWO THRESHOLDS CALIBRATED ON ONE BUNDLE. That is the honest
// description of every constant in this tree and it is worth saying plainly
// here too. The separations they rest on, measured over all 29 pages of the
// gate bundle by re-rendering each page and re-reading the cached Gemini lines:
// see MIN_INK_COVERAGE and MAX_UNCOVERED_INK_RUN_SHARE, and the two real pages
// neither of them catches.
// ---------------------------------------------------------------------------

/**
 * A pixel darker than this is ink.
 *
 * 128 is mid grey, which on these scans is far below the paper (bright, in the
 * 200s) and far above a glyph core (near 0). The threshold matters less than it
 * looks: re-measuring the whole bundle at 96, 160 and 200 moved the healthy
 * minimum only from 0.985 to 0.971 and the truncated page only from 0.539 to
 * 0.532, so every one of them separates the two populations by the same wide
 * margin. 128 is the middle of that range rather than an edge of it.
 */
const INK_LUMINANCE_MAX = 128;

/**
 * A row needs this many ink pixels before it counts as a row of ink.
 *
 * Speckle resistance, and it is measurable rather than decorative: at 1 pixel
 * the healthy minimum falls from 0.985 to 0.972 because a single stray dark
 * pixel below the last real glyph counts as a whole row of print. At 3 it does
 * not, and at 8 and 20 nothing further improves. The direction of the error is
 * the reason to keep it small: too FEW required pixels over-estimates the ink
 * extent and costs a wasted retry, while too many under-estimate it and let a
 * short page through silently, which is the failure this whole check exists
 * for.
 */
const MIN_INK_PIXELS_PER_ROW = 3;

/**
 * Below this share of the page's own ink, the returned boxes did not reach the
 * bottom of what is printed and the page is treated as incompletely read.
 *
 * MEASURED over the 29 pages of the gate bundle, with the ink extent computed
 * by `inkRowProfile` below and the box extent taken from the Gemini lines
 * already in the harness's OCR cache -- so this is a property of these two
 * estimators together, not a number borrowed from a different measurement:
 *
 *     merged:19 (the truncated page)   0.539
 *     the other 28 pages               0.985 to 1.016
 *
 * A ratio ABOVE 1 is normal and is not a fault -- a text box routinely ends a
 * pixel or two past the last row carrying ink -- so this is a lower bound and
 * nothing more.
 *
 * 0.90 IS NEAR THE HEALTHY FLOOR, NOT IN THE MIDDLE OF THE EMPTY BAND, and the
 * asymmetry is the whole reason it moved. It was 0.75, the midpoint, which left
 * 0.235 of margin in each direction as though the two errors cost the same.
 * They do not. Measured with this code on a synthetic page: boxes stopping at
 * 80% of the ink scored 0.775 and PASSED -- a page can lose its bottom fifth,
 * about 750px or a dozen printed lines at 300 DPI, and say nothing. What that
 * buys on the other side is margin against a false positive, whose cost is an
 * image call and, if it repeats, the run. What it spends is margin against a
 * false negative, whose cost this module states in `IncompletePageError`: a
 * plausible wrong line range, a plausible wrong crop, and a citation a
 * validator signs. 0.90 keeps 0.085 below the healthiest-but-one page and
 * halves the blind zone. If it turns out to cost real retries on a second
 * bundle, that is a measurement, and a measurement is exactly what the old
 * number was missing.
 *
 * IT IS ONE NUMBER OVER A WHOLE PAGE, so it is not the only rule: a single box
 * anywhere near the bottom satisfies it completely. See
 * `MAX_UNCOVERED_INK_RUN_SHARE`.
 *
 * TWO REAL DEFECTS ON THIS SAME BUNDLE THAT IT DOES NOT CATCH, because reading
 * a clean number here as "the page was read properly" is exactly the mistake
 * this project keeps paying for:
 *
 *  - `splitba:0`, the paragraph collapse: six boxes 2.3x to 6.8x the page's
 *    median line height, each carrying only the FIRST printed line of its
 *    paragraph. Its boxes reach the ink perfectly well and it scores 0.999.
 *    `collapsedBlocks` and `lineDensityRatio` are what see that one.
 *  - `merged:20`, the granularity collapse: 21 numbered lines where tesseract
 *    read 47, all the text present but the line NUMBERING every citation is
 *    denominated in collapsed with it. It scores 1.014.
 *
 * Four views of one failure class, and none of them subsumes the others.
 */
export const MIN_INK_COVERAGE = 0.9;

/**
 * The most ink a page may carry, in one stretch, that no returned box covers --
 * counted in rows and expressed as a share of the page height.
 *
 * A RUN IS BROKEN BY INK THE BOXES DID COVER, NOT BY BLANK PAPER. The gaps
 * between printed lines carry no ink and say nothing either way, so breaking a
 * run on them would reduce every run to a single line's height and the rule
 * would measure nothing. Measured both ways over the 29 pages: breaking on
 * blanks puts the truncated page at 471px against a healthy maximum of 88px,
 * and bridging them puts it at 1095px against the same 88px -- the same
 * decision on this bundle, and a far wider margin on the general case of a
 * truncated body of ordinary line-spaced text.
 *
 * WHY A SECOND RULE AT ALL. `MIN_INK_COVERAGE` reduces the whole page to
 * `max(box.y + box.h)`, so ONE box anywhere in the bottom quartile defeats it
 * entirely. Demonstrated against this code: 14 body lines ending at y=1711 of
 * a 3507px page whose ink runs to y=3345 -- a page transcribed down to 52% --
 * scores 0.511 on the ratio and fails, but add the page's running FOOTER as one
 * more returned box and the identical truncation scores 1.000, complete,
 * degraded false, no reasons. A running footer is precisely the fragment most
 * likely to survive:
 * `trimRunningFooter`, `MAX_FOOTER_LINES` and `FOOTER_GAP_MULTIPLE`
 * exist because these pages carry them, and the Task 7 verdict records Gemini
 * reading an initialling strip and a page number as three separate lines where
 * tesseract read one. `merged:19` was caught by the coin landing the other way.
 *
 * So the profile is walked rather than reduced: every row of ink the boxes did
 * not cover is counted, and the longest unbroken stretch of them is what is
 * judged. It costs nothing extra -- the same single pass over the same RGBA --
 * and it catches the truncation whether or not a footer survived, and a hole in
 * the MIDDLE of a page, which no bottom-edge ratio can see at all.
 *
 * MEASURED over the same 29 pages, largest uncovered ink run as a share of
 * page height:
 *
 *     27 pages                0.003 to 0.025   (9px to 88px of 3507)
 *     splitba:0               0.033            (116px)
 *     merged:19 (truncated)   0.312            (1095px)
 *
 * The healthy runs are the letterhead logo, a duty stamp and the odd rule the
 * model does not transcribe, which is the shape a false positive would take on
 * another bundle too. `splitba:0` sits between them and passes, correctly: its
 * boxes DO cover its ink and its defect is the paragraph collapse, which
 * `collapsedBlocks` is what catches.
 *
 * 0.06 is about 210px here, four to five printed lines at 300 DPI: 2.4x above
 * everything healthy this bundle contains, 1.8x above `splitba:0`, and 5.2x
 * below the one truncated page. The margin is deliberately spent toward
 * catching, for the same asymmetry `MIN_INK_COVERAGE` argues.
 */
export const MAX_UNCOVERED_INK_RUN_SHARE = 0.06;

/**
 * How many times a page is read before the run is failed.
 *
 * 3 is two retries. The arithmetic: at the measured ~7% short-read rate, a
 * 29-page bundle expects about two short pages, so two retries each is about
 * four extra image calls on a 29-call run -- roughly 14%, paid only when the
 * guard fires.
 *
 * WHETHER A RETRY ACTUALLY RECOVERS A TRUNCATED PAGE IS UNTESTED IN THE WILD,
 * and the Task 7 verdict says so in as many words. The probe measured five
 * calls of one page returning byte-identical text, which is evidence that
 * SOME of Gemini's mistakes are deterministic; the truncation is a different
 * mode and its intermittency (3 short in 43 identical-shaped reads) is
 * evidence that this one is not. If a re-run turns out never to recover, the
 * named fallback is page tiling -- the truncated page recovers to full text
 * when sent in halves -- and it costs the same 2x while adding a seam, a
 * y-remap and de-duplication. Reach for it with a measurement, not a hunch.
 *
 * Either way the page never comes back short and quiet: after the last attempt
 * this throws, which is the same rule as `/api/ocr`'s never-a-200-with-zero-
 * lines. No caller catches that throw, so the price of exhausting the attempts
 * is the whole run -- the ingest, the bundle or the gate. Deliberate, per the
 * Task 7 verdict's no-silent-thin-page rule, and named here so nobody reads the
 * retry as the worst case.
 */
export const COMPLETENESS_ATTEMPTS = 3;

/**
 * Which rows of the rendered page carry ink, in one pass over the RGBA
 * `render.ts` already handed the caller.
 *
 * No decoder, no second render, no model call: every caller of this check is
 * holding these exact pixels when it asks. The inner loop stops at the third
 * ink pixel of a row, so a page of print costs far less than its 8.7M pixels;
 * a blank row is the expensive case and there is no way around reading it.
 * Measured at 2480x3507: 4ms for a printed page, 21ms for an entirely blank
 * one, against seconds of render and model time. It walks the whole page rather
 * than exiting early at the last ink row, and that costs nothing worth having.
 *
 * A ROW PROFILE RATHER THAN A SINGLE `lastInkRow`, which is what this used to
 * return. Reducing the page to its last ink row can only support a
 * bottom-edge ratio, and a bottom-edge ratio is satisfied by one surviving box
 * near the bottom -- see `MAX_UNCOVERED_INK_RUN_SHARE` for the demonstration
 * and for what the profile buys instead. Same pass, same pixels, strictly more
 * answerable.
 *
 * A fully transparent pixel is not ink. `renderPageUpright` fills the page
 * white before drawing so this never arises on a real page; it matters for a
 * synthetic page built by a test, where an unpainted zero byte would otherwise
 * read as black.
 */
export type InkProfile = {
  /** `rows[y]` is 1 where row y carries ink, 0 where it does not. */
  rows: Uint8Array;
  height: number;
  /** The last row carrying ink, an index; -1 when the page carries none. */
  inkBottomY: number;
};

export function inkRowProfile(page: RenderedPage): InkProfile {
  const { data, width, height } = page;
  const rows = new Uint8Array(height);
  let inkBottomY = -1;
  for (let y = 0; y < height; y++) {
    let ink = 0;
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = rowStart + x * 4;
      if (data[i + 3] < 8) continue;
      const luminance =
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (luminance < INK_LUMINANCE_MAX) {
        ink++;
        if (ink >= MIN_INK_PIXELS_PER_ROW) {
          rows[y] = 1;
          inkBottomY = y;
          break;
        }
      }
    }
  }
  return { rows, height, inkBottomY };
}

export type PageCompleteness = {
  /** The page's last ink row, an index; -1 when the page carries no ink. */
  inkBottomY: number;
  /** The lowest bottom edge of any returned box, in the same pixels. */
  boxBottomY: number;
  /** `boxBottomY` over the ink extent. 1 for a page with no ink at all. */
  inkCoverage: number;
  /** The most rows of ink no returned box covers, in one stretch. See
   *  `MAX_UNCOVERED_INK_RUN_SHARE` for what breaks a stretch. */
  uncoveredInkRun: number;
  /** That run over the page height, which is the unit the threshold is in. */
  uncoveredInkRunShare: number;
  complete: boolean;
  /** Which rules the page missed, one sentence each. Empty when complete. */
  shortfalls: string[];
};

/**
 * Did the model's boxes cover the page's ink?
 *
 * TWO RULES, and a page has to satisfy both. They fail on different shapes and
 * the second exists because the first is a max-reduction:
 *
 *  1. The lowest returned box bottom reaches `MIN_INK_COVERAGE` of the page's
 *     own ink extent. This is the coarse one: one box near the bottom of the
 *     page satisfies it however little else was returned.
 *  2. No stretch of the page leaves more than `MAX_UNCOVERED_INK_RUN_SHARE` of
 *     its height in ink rows that no returned box covers. This is the one that
 *     survives a running footer coming back with a truncated body, and the only
 *     one that can see a hole in the middle of a page.
 *
 * `inkBottomY` is an INDEX and `boxBottomY` is an EXCLUSIVE edge, so the ink
 * extent is `inkBottomY + 1` and the two are then measured the same way. Off by
 * one here would be worth 1/3507 of a page, but the ratio is compared against a
 * calibrated constant and the constant deserves to mean what it says.
 *
 * A page with no ink is complete by definition. Demanding that the boxes cover
 * nothing would fail every genuinely blank scan forever, and a blank page
 * already reports itself through `reasons` ("the reply produced no lines at
 * all") without needing this check to invent a fault.
 *
 * NO COORDINATE LEAVES THIS FUNCTION. It reads the boxes and the ink and
 * returns numbers about them; the row where the ink was missed is deliberately
 * not among them, because a caller holding it would be one small step from
 * cropping to it, and the model's boxes are the only geometry this pipeline
 * ships.
 */
export function checkPageCompleteness(
  lines: Line[],
  ink: InkProfile,
): PageCompleteness {
  const boxBottomY = lines.reduce((y, l) => Math.max(y, l.box.y + l.box.h), 0);
  const inkExtent = ink.inkBottomY + 1;
  const inkCoverage = inkExtent > 0 ? boxBottomY / inkExtent : 1;

  // One byte per row, painted by the boxes, then walked once alongside the ink
  // profile. Clamped rather than trusted: `assertLinesWellFormed` has already
  // held every box inside the page, and a row index out of range here would
  // silently write past the array rather than fail.
  const covered = new Uint8Array(ink.height);
  for (const line of lines) {
    const top = Math.max(0, Math.round(line.box.y));
    const bottom = Math.min(ink.height, Math.round(line.box.y + line.box.h));
    for (let y = top; y < bottom; y++) covered[y] = 1;
  }

  let run = 0;
  let uncoveredInkRun = 0;
  for (let y = 0; y < ink.height; y++) {
    if (ink.rows[y] === 1 && covered[y] === 0) {
      run++;
      if (run > uncoveredInkRun) uncoveredInkRun = run;
    } else if (ink.rows[y] === 1) {
      // Ink the boxes DID cover is what ends a run: it is evidence the model
      // was still reading here. A blank row neither ends one nor counts toward
      // it -- see MAX_UNCOVERED_INK_RUN_SHARE for why breaking on blank paper
      // would make this rule measure nothing.
      run = 0;
    }
  }
  const uncoveredInkRunShare =
    ink.height > 0 ? uncoveredInkRun / ink.height : 0;

  const shortfalls: string[] = [];
  if (inkCoverage < MIN_INK_COVERAGE) {
    shortfalls.push(
      `its returned boxes reach y=${boxBottomY} against ink to ` +
        `y=${ink.inkBottomY}, ${(100 * inkCoverage).toFixed(0)}% of it, under ` +
        `the ${(100 * MIN_INK_COVERAGE).toFixed(0)}% a page has to reach`,
    );
  }
  if (uncoveredInkRunShare > MAX_UNCOVERED_INK_RUN_SHARE) {
    shortfalls.push(
      `${uncoveredInkRun}px of the page carries ink that no returned box ` +
        "covers, in one stretch with nothing read inside it -- " +
        `${(100 * uncoveredInkRunShare).toFixed(1)}% of the page height, over ` +
        `the ${(100 * MAX_UNCOVERED_INK_RUN_SHARE).toFixed(1)}% allowed`,
    );
  }

  return {
    inkBottomY: ink.inkBottomY,
    boxBottomY,
    inkCoverage,
    uncoveredInkRun,
    uncoveredInkRunShare,
    complete: shortfalls.length === 0,
    shortfalls,
  };
}

/**
 * Thrown when every attempt came back short. It carries the measurement rather
 * than only a sentence, so a caller can count firings and print numbers without
 * parsing prose.
 */
export class IncompletePageError extends Error {
  readonly completeness: PageCompleteness;
  readonly attempts: number;
  /** The last attempt's throw, when one of them failed rather than read short. */
  readonly lastError?: unknown;

  constructor(
    label: string,
    completeness: PageCompleteness,
    attempts: number,
    lastError?: unknown,
  ) {
    super(
      `${label}: OCR came back short on all ${attempts} attempts -- ` +
        `${completeness.shortfalls.join("; and ")}. The model transcribed part ` +
        "of the page and stopped, with finishReason=STOP and nothing else " +
        "about the reply out of the ordinary, which is why this is checked " +
        "against the pixels. Failing here is the point: a page read a third " +
        "short produces a plausible wrong line range, a plausible wrong crop " +
        "and a citation a validator signs. Every attempt sent the SAME bytes " +
        "with the SAME prompt, so a deterministic short read cannot recover " +
        "here by construction; if this fires repeatedly on a page a person can " +
        "see is fine, the two things to weigh are page tiling (the named " +
        "fallback, which recovered the one measured truncation) and whether " +
        "ink the model correctly declines to transcribe -- a stamp, a " +
        "signature, a frame, a scan edge -- is what these numbers are actually " +
        "measuring.",
    );
    this.name = "IncompletePageError";
    this.completeness = completeness;
    this.attempts = attempts;
    this.lastError = lastError;
    // A MIXED LADDER IS NOT A SHORT PAGE, and saying so sends the reader to the
    // pixels when the answer is in the reply. When some attempt threw -- a
    // truncated reply, an unusable one -- the message above is true of the
    // attempts that DID return and silent about the one that did not, so the
    // cause is appended rather than left for someone to find in a stack trace.
    if (lastError) {
      const why =
        lastError instanceof Error ? lastError.message : String(lastError);
      this.message +=
        ` At least one attempt did not come back short but FAILED outright: ` +
        `${why} That is a different fault from a short read and is worth ` +
        "ruling out first.";
      this.cause = lastError;
    }
  }
}

/** One attempt that did not produce a usable reading, handed to the caller. */
export type ShortRead = {
  /** 1-based. */
  attempt: number;
  attempts: number;
  lines: number;
  completeness: PageCompleteness;
  /**
   * Set when the attempt THREW rather than came back short -- a truncated
   * reply, an unusable one, a transport failure that outlived its own retries.
   * The ladder treats both the same way, because both mean "ask again", but a
   * log that showed them the same way would send someone hunting a short page
   * that never existed.
   */
  error?: unknown;
};

/**
 * The stand-in completeness for an attempt that threw before anything could be
 * measured. Zero coverage and one shortfall naming the cause: a page nothing
 * read is not a page that read well, and defaulting it to complete would let
 * a failed attempt look like a passing one in the log.
 */
const UNREAD_PAGE: PageCompleteness = {
  complete: false,
  inkCoverage: 0,
  uncoveredInkRunShare: 1,
  inkBottomY: 0,
  boxBottomY: 0,
  uncoveredInkRun: 0,
  shortfalls: ["the attempt failed before a reading could be measured"],
};

/**
 * `recognize` is whatever this caller's route to the model is: `askImage` in
 * Node, a `fetch` of `/api/ocr` in the browser worker. The helper owns the PNG
 * encode, the ink measurement, the assertion and the retry, so all three
 * callers share one behaviour instead of three near-copies that drift.
 */
export type RecognizePage = (
  image: ImageInput,
) => Promise<{ lines: Line[]; report: OcrReport }>;

/**
 * One page, read until it is complete or the attempts run out.
 *
 * The PNG is encoded ONCE and the same bytes are re-sent on every attempt. The
 * check is on the model's answer, not on the encoding, and re-encoding would
 * both cost a second pass over 35MB of RGBA and quietly change what is being
 * retried.
 *
 * WHICH MEANS A RETRY DIFFERS FROM THE ATTEMPT THAT FAILED IN NOTHING BUT THE
 * MODEL'S OWN SAMPLING, and that is worth stating rather than leaving for
 * someone to discover from a run that burned three calls and aborted anyway.
 * The bet is that this defect is intermittent -- 3 short in 43 identically
 * shaped reads -- while the probe separately measured five identical calls of
 * one page returning byte-identical text, so it is a bet, not a certainty. The
 * callers log the fact when the guard fires, and `COMPLETENESS_ATTEMPTS`
 * carries what to reach for if it turns out never to recover.
 *
 * `onShort` is called for every attempt that came back short, including the
 * last one before the throw. Every caller passes one: a guard that never fires
 * is untested, not unnecessary, so its firings have to be visible in the run
 * log with a count rather than inferred from a missing error.
 */
export async function ocrPageCompletely(
  page: RenderedPage,
  recognize: RecognizePage,
  options: {
    label?: string;
    attempts?: number;
    onShort?: (short: ShortRead) => void;
  } = {},
): Promise<{
  lines: Line[];
  report: OcrReport;
  completeness: PageCompleteness;
  /** Which attempt answered, 1-based. Above 1 means the guard fired and the
   *  re-read recovered, which is a good outcome and worth counting. */
  attempt: number;
  /** The encoded page, so a caller can log what it actually uploaded. */
  image: ImageInput;
}> {
  const attempts = Math.max(1, options.attempts ?? COMPLETENESS_ATTEMPTS);
  const label = options.label ?? "page";

  const image = await pageToPng(page);
  const ink = inkRowProfile(page);

  let last: PageCompleteness | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // A FAILED ATTEMPT IS NOT A FAILED LADDER, and getting that wrong cost a
    // 29-page gate run at page 26. The guard correctly caught a short read and
    // re-sent the identical image; the RETRY came back at 16,369 output tokens
    // against a 16,384 cap, which the OCR path rightly refuses -- and because
    // the throw escaped this loop, one unlucky second attempt ended a run that
    // had already paid for twenty-five pages.
    //
    // An attempt that ERRORS and one that comes back SHORT are the same thing
    // to the ladder: this reading is unusable, ask again. They are NOT the same
    // thing in the message at the end, so both are carried and both are named.
    let lines, report;
    try {
      ({ lines, report } = await recognize(image));
    } catch (error) {
      lastError = error;
      options.onShort?.({
        attempt,
        attempts,
        lines: 0,
        completeness: last ?? UNREAD_PAGE,
        error,
      });
      continue;
    }
    const completeness = checkPageCompleteness(lines, ink);
    last = completeness;
    if (completeness.complete) {
      return {
        lines,
        report: {
          ...report,
          inkCoverage: completeness.inkCoverage,
          uncoveredInkRunShare: completeness.uncoveredInkRunShare,
        },
        completeness,
        attempt,
        image,
      };
    }
    options.onShort?.({
      attempt,
      attempts,
      lines: lines.length,
      completeness,
    });
  }

  // An error on the LAST attempt is the more useful thing to report: claiming
  // "came back short on all attempts" when the final one actually threw sends
  // the reader looking at the pixels instead of at the reply.
  if (!last && lastError) throw lastError;
  throw new IncompletePageError(
    label,
    last as PageCompleteness,
    attempts,
    lastError,
  );
}
