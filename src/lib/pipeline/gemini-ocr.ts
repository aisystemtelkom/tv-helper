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
  /** Of those, how many have a box that was sliced rather than returned. */
  interpolatedLines: number;
  /** Entries dropped because their box failed validation. */
  droppedEntries: number;
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
 * A page whose lines are mostly interpolated has quietly stopped being "the
 * rectangle is the union of measured line boxes" and become "trust the model's
 * block box with a 12px pad". That may still be fine -- the probe supports it
 * -- but it is not what this design specified, so it is reported rather than
 * discovered later.
 */
const INTERPOLATION_ALARM_SHARE = 0.5;

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

  const reasons: string[] = [];
  if (droppedEntries > 0) {
    reasons.push(
      `${droppedEntries} of ${entries.length} entries failed box validation`,
    );
  }
  if (lines.length === 0) {
    reasons.push("the reply produced no lines at all");
  }
  if (
    lines.length > 0 &&
    interpolatedLines > lines.length * INTERPOLATION_ALARM_SHARE
  ) {
    reasons.push(
      `${interpolatedLines} of ${lines.length} lines have interpolated boxes`,
    );
  }

  return {
    lines,
    report: {
      blocks: entries.length,
      segments: bands.length,
      lines: lines.length,
      interpolatedLines,
      droppedEntries,
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
