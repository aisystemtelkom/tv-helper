/**
 * The crop-level second pass: every value bound for xlsx column E is re-read
 * from a picture of the lines it cites, and a disagreement blanks the cell.
 *
 * ## IT VERIFIES VALUES, NOT CROPS. Read that sentence twice.
 *
 * This pass compares two READINGS OF TEXT. It says nothing whatsoever about
 * whether the rectangle a citation names is the right rectangle. A crop of the
 * wrong region, re-read perfectly, agrees with a value extracted from that same
 * wrong region, and this pass reports agreement -- while the DOKUMEN VALIDASI
 * ships a picture of the wrong part of the wrong page. That is the more
 * expensive half of this project's failure class and NOTHING here touches it.
 * Only `pnpm measure:locate` measures whether a zone landed where it should.
 * Nobody should read this pass as making the gate optional.
 *
 * ## Why it exists at all
 *
 * The probe that authorised the Gemini OCR migration measured one finding that
 * this module is the entire answer to. At whole-page resolution Gemini
 * CONFABULATES SMALL PRINT confidently, deterministically and invisibly: a
 * faint footer reference came back as four different plausible strings across
 * five identical calls, never flagged and never declined, and a partly
 * ink-obscured stamp serial came back with 3 of its 17 characters wrong,
 * IDENTICALLY on all four calls of that page. Tesseract fails those regions
 * loudly ("Sa Pewa g A Pm 1 Sen"); Gemini fails them quietly and repeatably,
 * which is strictly worse for a document a human signs.
 *
 * Re-sent as CROPS, Gemini read both regions 100% correctly, on both runs. So
 * it is a whole-page tokenization artifact rather than a model limit, and
 * re-reading the cited region on its own is a mitigation that was measured to
 * work rather than one that sounds plausible.
 *
 * Two alternatives were considered and rejected on measurement:
 *
 *  - A SECOND WHOLE-PAGE CALL as a disagreement detector. Five calls of the
 *    same page returned byte-identical text and an identical output token
 *    count. It is deterministically wrong in the same place, so a second call
 *    buys nothing at all.
 *  - KEEPING TESSERACT as an on-device cross-check. It reads garbage in
 *    exactly the regions where Gemini is confidently wrong, so it cannot
 *    adjudicate, and it costs back the runtime the migration exists to remove.
 *
 * ## On disagreement, NOBODY WINS
 *
 * The cell ships blank with both readings recorded, exactly like the existing
 * `reconcileFieldValues` conflict path and for exactly the same reason: a blank
 * invites the operator to fill it in, a plausible wrong value does not. There
 * is no tie-break here on purpose. The crop reading is not "more correct" --
 * it is a second opinion, and two opinions that differ are a question for a
 * person, not an average for this file to take.
 *
 * Pure in the same sense `classify.ts` and `gemini-ocr.ts` are pure: no
 * provider SDK, no `fetch`, no credential. The model call arrives as an
 * injected `AskImage` and the page renderer as an injected function, so the
 * whole wiring -- which values are checked, which are skipped, what a
 * disagreement does to the list -- is exercisable offline.
 */

import { z } from "zod";

import { cropToPng } from "../export/crop.ts";
import type { FieldValue } from "./fields.ts";
import { boxForLineRange, type Line } from "./geometry.ts";
import type { AskImage, ImageInput } from "./gemini-ocr.ts";
import { extractJson } from "./json.ts";
import { CROP_PADDING_PX } from "./locate.ts";
import type { RenderedPage } from "./render.ts";

/**
 * Deliberately not `OCR_PROMPT`. That prompt asks for boxes over a whole page;
 * this one asks for characters out of a region already chosen, and the whole
 * point of the second pass is that the second look is not the first look
 * repeated.
 *
 * The "do not correct or complete" sentences are the load-bearing ones. The
 * failure being caught is a confident guess at illegible small print, and a
 * model told to transcribe a document is otherwise happy to supply the
 * reference number it believes belongs there.
 *
 * The JSON shape is an OBJECT because `extractJson` spans first-`{` to
 * last-`}`; a bare string or a top-level array would not parse.
 */
export const VERIFY_PROMPT = [
  "This image is a small crop cut out of a scanned document page.",
  "Transcribe every printed character in it, exactly as printed.",
  "",
  "Do not translate, correct, complete, reorder or reformat anything.",
  "Reproduce digits, reference numbers and serial numbers character by",
  "character. Where the image is illegible, transcribe only what is actually",
  "readable and leave the rest out rather than guessing at it.",
  "",
  'Reply with JSON only, as a single object: {"text":"..."}',
].join("\n");

const Reply = z.object({ text: z.string() });

/**
 * The schema this pass constrains generation to.
 *
 * Small, but for the same measured reason as `OCR_RESPONSE_SCHEMA`: asked in
 * prose for one JSON object, `gemini-3.5-flash` returned unparseable JSON on 4
 * of 4 real pages. This pass is the guard on every value a validator signs, so
 * it is the last place to leave the reply shape to chance.
 */
const VERIFY_RESPONSE_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
};

/**
 * One crop, one reading. Throws rather than returning a blank on an unusable
 * reply: a blank reading would disagree with every value and blank every cell,
 * which is a loud enough failure to be worth an actual exception instead.
 */
export async function reOcrCrop(crop: ImageInput, ask: AskImage): Promise<string> {
  const reply = await ask(VERIFY_PROMPT, crop, VERIFY_RESPONSE_SCHEMA);
  return Reply.parse(extractJson(reply)).text;
}

/**
 * The `{l,i,1}` and `{o,0}` folds `scripts/measure-locate.mjs` established.
 *
 * They are GLYPH confusions rather than tesseract quirks -- an "l" and a "1"
 * genuinely look alike at 8pt, whatever is reading them -- so they carry over
 * to a VLM unchanged. What does not carry over is the gate's 25% edit-distance
 * tolerance; see `agreesWith`.
 */
function foldConfusables(s: string): string {
  return s.replace(/[li1]/g, "1").replace(/[o0]/g, "0");
}

/**
 * Case, whitespace, punctuation and confusable glyphs folded away, so that
 * "PT. Bank Contoh Nusantara, Tbk" and "PT BANK CONTOH NUSANTARA TBK" are one
 * reading rather than two.
 *
 * One deliberate difference from `lineSignature` in the gate harness, which
 * this otherwise mirrors: single-character tokens are KEPT. The gate drops
 * them as noise because it is aligning whole pages of prose. Here the needle is
 * often a reference number, and dropping a lone character out of one is
 * dropping exactly the character a confabulation would have got wrong.
 */
export function normalizeReading(text: string): string {
  return text
    .split(/\s+/)
    .map((raw) => foldConfusables(raw.toLowerCase()).replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length > 0)
    .join(" ");
}

/**
 * Free-start/free-end fuzzy substring alignment: the lowest edit distance
 * between `needle` and any contiguous run inside `haystack`. Standard
 * Levenshtein DP with the first row held at 0, so a match may begin anywhere in
 * the haystack for free and end anywhere for free.
 *
 * Substring rather than whole-string, because the two sides are not the same
 * span of text: the value is one field, and the crop covers the whole cited
 * line range, which normally also prints the field's label and often its
 * neighbours. Comparing the two as wholes would report a disagreement on every
 * single value.
 *
 * O(n*m), with n the value's length and m the crop reading's -- tens by
 * hundreds of characters here, so the cost is not worth a thought.
 */
function bestSubstringDistance(needle: string, haystack: string): number {
  const n = needle.length;
  const m = haystack.length;
  if (n === 0) return 0;
  if (m === 0) return n;

  let previous = new Array<number>(m + 1).fill(0);
  let current = new Array<number>(m + 1);

  for (let i = 1; i <= n; i++) {
    current[0] = i;
    for (let j = 1; j <= m; j++) {
      const substitute = previous[j - 1] + (needle[i - 1] === haystack[j - 1] ? 0 : 1);
      const deletion = previous[j] + 1;
      const insertion = current[j - 1] + 1;
      current[j] = Math.min(substitute, deletion, insertion);
    }
    [previous, current] = [current, previous];
  }

  return Math.min(...previous);
}

/**
 * THE DEFAULT TOLERANCE IS ZERO, AND THAT IS A DECISION, NOT AN OVERSIGHT.
 *
 * The obvious move is to borrow the gate's tolerance, which admits an edit
 * distance up to 25% of the signature's own length. Borrowing it here would
 * defeat the whole pass: the measured confabulation this exists to catch is a
 * stamp serial with 3 of 17 characters wrong, which is 18%, and would sail
 * through as agreement. The gate's number is generous because it aligns two
 * noisy readings of a whole multi-line crop; these two readings are of the same
 * pixels by the same engine, and after normalisation an honest agreement is
 * character-identical.
 *
 * So the threshold is not a tuned constant at all -- there is no measured
 * noise floor for Gemini-against-Gemini on one region, and inventing a
 * proportional allowance with nothing behind it is the mistake the "+2 extra
 * lines" tolerance made in an earlier design. Zero means every surviving
 * difference is a question for the operator. If a real run shows a systematic
 * one-character difference, RE-DERIVE the allowance from that run's printed
 * distances and pass it here; do not guess at it now.
 *
 * `distance` is returned whatever the verdict, so a disagreement can say how
 * far apart the two readings were instead of only that they were.
 *
 * ASYMMETRIC: `value` is the needle and `reading` the haystack. The spec writes
 * this as `agreesWith(a, b)`; the names say which is which, because swapping
 * them asks a different and much weaker question ("does the crop's whole text
 * appear inside this one field's value").
 *
 * A value that normalises to nothing at all -- punctuation only -- has no
 * content to disagree about and comes back as agreement with distance 0.
 * `verifyCitedValues` filters those out before it gets here and counts them as
 * unverifiable, which is the honest disposition; agreement is only the answer
 * that costs nothing if some other caller forgets to.
 */
export function agreesWith(
  value: string,
  reading: string,
  tolerance = 0,
): { agree: boolean; distance: number } {
  const distance = bestSubstringDistance(
    normalizeReading(value),
    normalizeReading(reading),
  );
  return { agree: distance <= tolerance, distance };
}

/** What `verifyCitedValues` needs of a page: the geometry its citations index
 *  into, and the pixel dimensions those lines were measured against. */
export type VerifyPage = {
  width: number;
  height: number;
  lines: Line[];
};

export type VerifyDeps = {
  /**
   * Re-render one page of the run, by its bundle-global page index, at the
   * same DPI its lines were measured at. Injected rather than done here
   * because rendering means pdf.js and a document handle, neither of which
   * belongs in `src/lib/pipeline/`.
   *
   * Called ONCE PER DISTINCT PAGE, not once per value: a 300 DPI A4 page is
   * ~33MB of RGBA, and this module holds exactly one of them at a time for the
   * same reason `pnpm generate` splits into two passes.
   */
  renderPage: (pageIndex: number) => Promise<RenderedPage>;
  ask: AskImage;
  log?: (line: string) => void;
  /** See `agreesWith`. Left at 0 unless a measured run says otherwise. */
  tolerance?: number;
};

export type VerifyReport = {
  /** Values that were actually re-read from a crop. */
  checked: number;
  /** Of those, how many the crop reading agreed with. */
  agreed: number;
  /** Of those, how many disagreed and were therefore blanked. */
  disagreed: number;
  /**
   * Values this pass could not check at all, and why -- no citation to cut a
   * crop from, nothing left after normalisation, or the crop call itself
   * failed. These SHIP UNVERIFIED; see the note in the function body.
   */
  unverified: { fieldKey: string; reason: string }[];
};

/**
 * Re-reads every cited value from a picture of its own citation, and returns
 * the list with disagreements blanked.
 *
 * The returned list is a new array in the input's order, with the same entry
 * objects where nothing changed. A blanked entry keeps its `fieldKey`, drops
 * its `value` and its now-unsupported `source`, and carries both readings in
 * `conflict` with `conflictReason` saying which path blanked it -- because
 * `reconcileFieldValues`' own reason ("found more than once and the answers
 * disagree") would be a plainly FALSE statement about a value that was found
 * once and read twice.
 *
 * WHAT A FAILED VERIFICATION CALL DOES NOT DO: blank the cell. An unreachable
 * model is not evidence that a value is wrong, and treating it as such would
 * empty a whole workbook over a network blip -- the wrong-and-quiet shape
 * pointed the other way. Such a value ships exactly as it would have shipped
 * before this pass existed, and is named in `report.unverified` so the run's
 * summary can say how much of the workbook went unchecked.
 */
export async function verifyCitedValues(
  values: FieldValue[],
  pages: VerifyPage[],
  deps: VerifyDeps,
): Promise<{ values: FieldValue[]; report: VerifyReport }> {
  const log = deps.log ?? (() => {});
  const tolerance = deps.tolerance ?? 0;
  const report: VerifyReport = { checked: 0, agreed: 0, disagreed: 0, unverified: [] };

  // Position in `values` -> the checkable citation at that position. Built
  // first so the work can be grouped by page without losing the caller's
  // ordering, which every consumer downstream relies on.
  const work: { position: number; value: FieldValue; pageIndex: number }[] = [];
  values.forEach((value, position) => {
    if (value.conflict?.length) return; // already blank, nothing to re-read
    if (!value.value.trim()) return;
    if (!value.source) {
      report.unverified.push({ fieldKey: value.fieldKey, reason: "no citation to crop" });
      return;
    }
    if (!normalizeReading(value.value)) {
      report.unverified.push({
        fieldKey: value.fieldKey,
        reason: "nothing comparable left after normalisation",
      });
      return;
    }
    work.push({ position, value, pageIndex: value.source.pageIndex });
  });

  const out = [...values];
  const byPage = new Map<number, typeof work>();
  for (const item of work) {
    const list = byPage.get(item.pageIndex) ?? [];
    list.push(item);
    byPage.set(item.pageIndex, list);
  }

  for (const pageIndex of [...byPage.keys()].sort((a, b) => a - b)) {
    const page = pages[pageIndex];
    const items = byPage.get(pageIndex)!;
    if (!page) {
      // A citation validated against the pool it was extracted from can still
      // name a page this list does not hold if the caller passed the wrong
      // list. Report it rather than throwing: it costs the verification, not
      // the run, and the count says so.
      for (const { value } of items) {
        report.unverified.push({
          fieldKey: value.fieldKey,
          reason: `cited page ${pageIndex} is not in this run's page list`,
        });
      }
      continue;
    }

    let rendered: RenderedPage;
    try {
      rendered = await deps.renderPage(pageIndex);
    } catch (error) {
      for (const { value } of items) {
        report.unverified.push({
          fieldKey: value.fieldKey,
          reason: `page ${pageIndex} would not render: ${(error as Error).message}`,
        });
      }
      continue;
    }

    for (const { position, value } of items) {
      const source = value.source!;
      const [from, to] = source.lineRange;
      try {
        // The same padded union `locateSlot` cuts a docx crop from, so the
        // picture this pass reads is the picture the evidence would have been
        // cut from. `cropToPng`'s `expect` is the guard against the scariest
        // silent failure available here: lines measured on one render, pixels
        // cut from another at a different DPI, every box quietly wrong and
        // every crop still looking like a crop.
        const box = boxForLineRange(page.lines, from, to, CROP_PADDING_PX, {
          x: 0,
          y: 0,
          w: page.width,
          h: page.height,
        });
        const bytes = await cropToPng(rendered, box, {
          width: page.width,
          height: page.height,
        });
        const reading = await reOcrCrop({ bytes, mediaType: "image/png" }, deps.ask);
        const { agree, distance } = agreesWith(value.value, reading, tolerance);
        report.checked += 1;

        if (agree) {
          report.agreed += 1;
          log(
            `  ${value.fieldKey} = ${JSON.stringify(value.value)} -- crop agrees ` +
              `(page ${pageIndex}, lines ${from}-${to})`,
          );
          continue;
        }

        report.disagreed += 1;
        log(
          `  ${value.fieldKey} -- CROP DISAGREES (distance ${distance}) at page ` +
            `${pageIndex}, lines ${from}-${to}: page read ` +
            `${JSON.stringify(value.value)}, crop read ${JSON.stringify(reading)}; ` +
            "shipping blank",
        );
        out[position] = {
          fieldKey: value.fieldKey,
          value: "",
          // Both readings, in the order they were taken, and no winner. The
          // crop reading is the WHOLE cited line range, so it is normally
          // longer than the value -- that is the evidence, not noise, and
          // trimming it to look tidy would take away the thing the operator
          // settles this with.
          conflict: [value.value, reading],
          conflictReason:
            "the page reading and a re-read of the cited crop disagree " +
            `(edit distance ${distance} after normalising)`,
        };
      } catch (error) {
        report.unverified.push({
          fieldKey: value.fieldKey,
          reason: (error as Error).message,
        });
      }
    }
  }

  return { values: out, report };
}
