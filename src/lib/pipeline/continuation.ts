/**
 * Does a capture CONTINUE onto the next page, and if so, where does it end?
 *
 * Named `continuation` rather than `lanjutan` because code, comments and specs
 * in this repo stay English (docs/ui-bahasa.md) while the operator's word for
 * the same thing is "lanjutan" -- `captureLabel` in `src/lib/ui/slots.ts`
 * renders capture 2 as "ToP (lanjutan)". One concept, two vocabularies, and
 * this is the English side of it.
 *
 * ## Why this module exists at all
 *
 * `SlotDef.crops` used to DECLARE that the ToP row holds two pictures. An
 * operator testing the tool found the failure that produces: the sheet showed
 * "ToP 1" and "ToP 2" with the second permanently missing, and they said --
 * correctly -- that there is only ONE ToP. Read off the sample's own pictures,
 * capture 1 is "Pasal 6 PEMBAYARAN PEKERJAAN" items 1 to 3 and capture 2 is
 * items 4 and 5 OF THAT SAME PASAL carrying the next page's header. One
 * clause, split by a page break. Nothing about that is a property of the
 * template: on another contract the same clause fits one page, or runs to
 * three. So a continuation has to be DISCOVERED from the documents in hand,
 * and the declaration had to go.
 *
 * ## The shape: filter, then confirm. It is not a detector.
 *
 * Measured over bundle one's twelve human-authored crops (2026-09-03), the
 * geometric rule "the capture's last line is the last content line of its
 * page" fires on 7 of 12 and only 1 of those 7 actually continues: recall
 * 1/1, precision 14% (25% counting field slots alone). That is a bad detector
 * and a good FILTER -- it costs no model call and removes 5 of 12 slots from
 * consideration before anything is asked. So:
 *
 *   stage 0  a whole-page capture is not asked at all (`wholePageCapture`)
 *   stage 1  `checkForContinuation`, pure geometry, free
 *   stage 2  `confirmContinuation`, ONE next page, ~760 input tokens
 *   loop     the confirmed continuation becomes stage 1's input again
 *
 * Three of the six false positives are whole-page captures, where ending at
 * the last content line is true BY CONSTRUCTION and carries no information at
 * all. That is why `wholePageCapture` is a required argument rather than
 * something a caller may forget.
 *
 * THOSE NUMBERS PREDATE `furnitureSlack`, which can only make stage 1 fire
 * MORE (it takes the lower of the last content line and a tolerance, never a
 * higher one), so the 1/1 recall stands and the 14% precision is an upper
 * bound rather than a measurement of the code as it is now. It exists because
 * the reverse -- under-detected furniture silently DECLINING a real
 * continuation -- was measured on 4 of bundle one's 29 pages. Re-measure both
 * halves when the gate grows a continuation case.
 *
 * ## THE ANSWER IS A PROPOSAL. IT IS NEVER AN AUTOFILL.
 *
 * Measured on the four field slots stage 1 fires on, one shot, no tuning:
 * ToP -> next page answered `continues: true, lines 0-15` and the human's crop
 * on that page is exactly lines 0-15; Jangka Waktu and TTD Pejabat correctly
 * answered false; Detail answered `true, lines 2-10` and is WRONG -- it read
 * the next clause's own "Pasal" heading as a continuation. Three of four, one
 * plausible-wrong. A plausible wrong crop under the right label is exactly the
 * failure this project is organised against, so stage 2's answer goes to an
 * operator to rule on. `scripts/generate.mjs`, which has no operator and
 * writes its files unreviewed, deliberately runs STAGE 1 ONLY and reports what
 * it finds in the outstanding report rather than cropping it.
 *
 * ## What is NOT measured, and must not be claimed
 *
 *  - Bundle two (155 pages, 56 human crops, 59% of them continuations) is
 *    unmeasured for DETECTION. Its footers and clause conventions come from a
 *    different customer. The filter's recall is one observation.
 *  - The stage-2 prompt below is UNGATED. `pnpm measure:locate` scores
 *    single-shot locates and has no notion of a continuation, and the tree's
 *    own noise floor (4 of 8 field slots return a different range across three
 *    IDENTICAL runs) says four probe calls prove nothing. Extending the gate
 *    with the ToP pair as a continuation case is the work that has to land
 *    beside this, or the re-tuning-without-measurement trap opens on a second
 *    prompt.
 */

import { z } from "zod";
import type { Box } from "./render.ts";
import { boxForLineRange, type Line } from "./geometry.ts";
import { extractJson } from "./json.ts";
import type { Ask } from "./classify.ts";
import {
  CROP_PADDING_PX,
  trimRunningFooter,
  type OcrPage,
  type Zone,
} from "./locate.ts";

// ---------------------------------------------------------------------------
// Running furniture: the header and footer strip that repeats down a document.
//
// FENCED, AND THE FENCE IS THE POINT. Everything below may answer exactly one
// question -- "which line is this page's last CONTENT line" -- and may never
// trim, shorten or otherwise touch a zone's extent. `trimRunningFooter` in
// locate.ts stays the only thing allowed near a crop, its 16x constant is
// unchanged, and it is deliberately NOT reused here.
//
// It is not reused because it does not work for this question, measured rather
// than assumed. `FOOTER_GAP_MULTIPLE = 16` was tuned to almost never fire (3
// of 29 pages of bundle one), because its job is to protect evidence. On the
// dense contract pages the gap above the 3-line running footer measures only
// 5.7x its block's pitch, so it finds ZERO footer lines on merged pages 0, 17,
// 18, 19 and 20 where the repeated-text rule below finds 3, 3, 1, 3 and 2. Run
// the continuation rule on `trimRunningFooter`'s output and it fires on 4
// crops, catches the one true continuation zero times, and is 0 true / 4
// false. A footer detector that works is a separate piece, and this is it.
// ---------------------------------------------------------------------------

/**
 * How many lines at the bottom of a page are eligible to be furniture.
 *
 * Bundle one's contract carries a 3-line footer (an initialling strip with
 * "Page N of 23", then two reference lines) and its letters carry 2. Six is
 * double the largest measured, the same order of clearance `MAX_FOOTER_LINES`
 * keeps on its own bound.
 */
export const FURNITURE_TAIL_LINES = 6;

/**
 * How much of two lines' token sets must coincide before they count as the
 * same running line. Digits are masked first, so "Page 3 of 23" and "Page 10
 * of 23" are already identical; the tolerance is for OCR drift in the words
 * around them.
 */
export const FURNITURE_TOKEN_OVERLAP = 0.6;

/** On what share of a document's pages a line must repeat to be furniture. */
export const FURNITURE_PAGE_SHARE = 0.5;

/**
 * Below this many pages, "it repeats" is not a measurement and the detector
 * returns nothing at all.
 *
 * DELIBERATE, not accidental. A 2-page document (this bundle's SPLITBA scan)
 * gives every one of its bottom lines a 50% or 100% "repeat" rate against a
 * single other page, so the share threshold above means nothing there.
 *
 * WHAT THAT COSTS, STATED THE RIGHT WAY ROUND. This comment used to claim the
 * consequence was stage 1 firing MORE often, "never a missed continuation".
 * That is backwards, and the file's own next test says so: `lastContentLine(p,
 * new Set())` is 4 where `lastContentLine(p, new Set([2,3,4]))` is 1. With no
 * furniture detected, `lastContentLine` returns a LATER line -- the footer --
 * and the plain test `to < lastContent` then declines every capture that ends
 * where the CONTENT ends. Undetected furniture is a silent MISS, which is the
 * one direction this design cannot afford.
 *
 * It is not hypothetical either. Measured over bundle one's 29 pages, four
 * pages have `lastContentLine` returning a footer line: both SPLITBA pages
 * (too short to measure), merged page 7 (one OCR-dropped character puts its
 * doc-id line at 0.50 overlap, under the 0.60 threshold, so 2 of its 3 footer
 * lines go undetected) and merged page 23 (a different embedded document,
 * zero detected). So `furnitureSlack` below treats a page whose furniture was
 * NOT detected as the risky case rather than the safe one.
 */
export const FURNITURE_MIN_PAGES = 3;

/**
 * The most of a page that may be treated as possibly-furniture when this
 * page's own furniture went undetected.
 *
 * A GUARD, NOT A MEASUREMENT, and worth saying which. A running footer sits at
 * the bottom of a page; it is never a quarter of it. On a real 300 DPI A4
 * contract page OCR yields 40 to 50 lines, so a quarter is ten or more and
 * this bound never binds. What it stops is the degenerate end: a page with
 * three lines on it, where an unbounded slack would treat the whole body as a
 * possible footer strip and fire stage 1 on every capture.
 */
export const FURNITURE_SLACK_PAGE_SHARE = 0.25;

/**
 * A line reduced to what makes it comparable across pages.
 *
 * Digits become `#` and RUNS of `#` collapse to one, which is the half that
 * actually matters: a running footer's page number changes length partway down
 * a long document ("Page 9 of 23" then "Page 10 of 23"), so masking each digit
 * without collapsing makes the same footer look different on exactly the pages
 * the rule has to match.
 *
 * Compared as a SET, not a multiset. A footer line is short and its words are
 * distinct; counting repeats would only make the two spellings of one footer
 * disagree over an OCR-doubled word.
 */
export function furnitureTokens(text: string): string[] {
  const masked = text
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .trim();
  return masked === "" ? [] : masked.split(/\s+/);
}

/**
 * Does this line carry a WORD, and not only masked digits?
 *
 * THE FENCE THAT KEEPS A TABLE'S BOTTOM ROW OUT OF THE FURNITURE. `furnitureTokens`
 * masks every digit run to `#` and the comparison is a Set, so a line reading
 * only "17.500.000" reduces to the single token `{"#"}` and overlaps every
 * other money-only line at 1.0 -- a perfect match. A price annex whose every
 * page ends on a total row would have that row classified as running furniture
 * on every page, and a capture that visibly stopped a row SHORT of the page
 * bottom would then fire as `at-page-bottom`: a false positive on evidence
 * that stopped where it stopped.
 *
 * Not observed on bundle one, where every detected furniture line is a genuine
 * footer, so this is constructed rather than measured. The exposure is bundle
 * two, which splits its contract checklist across three tables (see the
 * 2026-09-03 findings) and whose xlsx work is all price and quantity rows.
 *
 * A running footer that is nothing but a bare page number is excluded by this,
 * and that is the direction to be wrong in: the page then has no detected
 * furniture at all, which `furnitureSlack` treats as the risky case and gives
 * a full tail's tolerance to.
 */
function carriesAWord(tokens: ReadonlySet<string>): boolean {
  for (const token of tokens) if (/\p{L}/u.test(token)) return true;
  return false;
}

function tokenOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  // Divided by the LONGER side, so a one-word line cannot claim a perfect
  // match against every longer line that happens to contain that word.
  return shared / Math.max(a.size, b.size);
}

/**
 * Which lines of each page are running furniture, keyed by `OcrPage.index`.
 *
 * Pooled PER SOURCE DOCUMENT, and the caller has to scope it that way. It
 * mattered on the sample: pooling the 27-page contract separately from the
 * 2-page SPLITBA gives the SPLITBA pages zero furniture lines, which is right,
 * where a run-wide pool blurs two documents' page furniture together.
 *
 * Document-agnostic by construction: no page-height constant, no margin, no
 * y-band, no font. The only thing it keys on is that a running footer RUNS.
 */
export function runningFurniture(
  documentPages: readonly OcrPage[],
): Map<number, Set<number>> {
  const furniture = new Map<number, Set<number>>();
  for (const page of documentPages) furniture.set(page.index, new Set());
  if (documentPages.length < FURNITURE_MIN_PAGES) return furniture;

  /** Each page's candidate tail lines, pre-tokenised. */
  const tails = documentPages.map((page) =>
    page.lines
      .slice(Math.max(0, page.lines.length - FURNITURE_TAIL_LINES))
      .map((line) => ({ i: line.i, tokens: new Set(furnitureTokens(line.text)) }))
      .filter((entry) => entry.tokens.size > 0 && carriesAWord(entry.tokens)),
  );

  const needed = FURNITURE_PAGE_SHARE * documentPages.length;

  for (const [position, page] of documentPages.entries()) {
    const set = furniture.get(page.index)!;
    for (const candidate of tails[position]) {
      let pagesCarryingIt = 0;
      for (const [otherPosition, otherTail] of tails.entries()) {
        if (otherPosition === position) {
          pagesCarryingIt += 1;
          continue;
        }
        const matched = otherTail.some(
          (other) =>
            tokenOverlap(candidate.tokens, other.tokens) >= FURNITURE_TOKEN_OVERLAP,
        );
        if (matched) pagesCarryingIt += 1;
      }
      if (pagesCarryingIt >= needed) set.add(candidate.i);
    }
  }

  return furniture;
}

/**
 * The last line of a page that is not running furniture, or `null` when every
 * line reads as furniture (which is a page with nothing on it worth citing,
 * and a case stage 1 declines rather than guesses at).
 */
export function lastContentLine(
  page: OcrPage,
  furniture: ReadonlySet<number> = new Set(),
): number | null {
  for (let k = page.lines.length - 1; k >= 0; k--) {
    if (!furniture.has(page.lines[k].i)) return page.lines[k].i;
  }
  return null;
}

/**
 * How many lines above its last DETECTED content line a capture may still end
 * on and count as running off the bottom of this page.
 *
 * WHY THERE IS ANY SLACK AT ALL. `lastContentLine` is only as good as the
 * furniture detector, and the detector under-fires in two measured ways: a
 * document too short to measure returns nothing (`FURNITURE_MIN_PAGES`), and
 * one OCR-dropped character drops a real footer line under the 0.60 overlap
 * threshold (bundle one's merged page 7, where 2 of 3 footer lines go
 * undetected and `lastContent` lands on line 48 while the content ends at 45).
 * Both make `lastContent` too LOW on the page, and a capture that ends exactly
 * where the content ends is then declined with no signal at all. That is a
 * silent miss, and recall is the thing this filter exists to protect.
 *
 * THE SLACK IS THE DOCUMENT'S OWN FOOTER DEPTH, not a tuned number. Whatever
 * the deepest furniture strip detected anywhere in this document is, that many
 * lines at the bottom of any page in it could be furniture the detector missed
 * on that page. When NOTHING was detected anywhere -- a 2-page scan, or a
 * document whose footer OCR'd differently on every page -- `FURNITURE_TAIL_LINES`
 * stands in, which is double the deepest footer measured on bundle one.
 *
 * IT CAN ONLY MAKE STAGE 1 FIRE MORE, NEVER LESS. The caller takes the LOWER
 * of `lastContent` and `lastLine - slack`, so no capture that fires today
 * stops firing. The cost is stage-2 calls at ~760 tokens each on pages where
 * the detector already worked (there the two agree and nothing changes) or
 * where it did not (there the extra calls are the point).
 */
export function furnitureSlack(
  page: OcrPage,
  documentPages: readonly OcrPage[],
  furniture: ReadonlyMap<number, ReadonlySet<number>>,
): number {
  let deepest = 0;
  for (const other of documentPages) {
    deepest = Math.max(deepest, furniture.get(other.index)?.size ?? 0);
  }
  const depth = deepest > 0 ? deepest : FURNITURE_TAIL_LINES;
  return Math.min(
    depth,
    Math.floor(page.lines.length * FURNITURE_SLACK_PAGE_SHARE),
  );
}

// ---------------------------------------------------------------------------
// Stage 1: the free geometric filter.
// ---------------------------------------------------------------------------

export type ContinuationVerdict =
  /** The capture ends at its page's last content line, or within the slack. */
  | "at-page-bottom"
  /**
   * The capture ends BELOW that line: it has taken running furniture in.
   *
   * Fires like `at-page-bottom` -- the block may still run on -- but it is the
   * WEAKEST evidence of a continuation, not the strongest, and it says
   * something about this capture's own extent that an operator should see. The
   * gate already knows `locateSlot` overshoots (its containment rule exists to
   * "reject a range that runs the full page when the crop does not") and
   * `trimRunningFooter` only fires on 3 of bundle one's 29 pages, so ranges
   * carrying footer lines reach here routinely.
   */
  | "past-last-content"
  /** It stops short of the page bottom, so nothing was cut off. */
  | "above-last-content"
  /** A whole-page capture, where the test carries no information. */
  | "whole-page-capture"
  /** The capture is on the last page of its own document. */
  | "no-next-page"
  /** Every line of the page reads as furniture. */
  | "no-content-line";

export type ContinuationCheck = {
  looksLikeContinuation: boolean;
  verdict: ContinuationVerdict;
  /** One sentence, with the numbers in it, fit for a log line or a report. */
  reason: string;
  /** The page a continuation would be looked for on, when there is one. */
  nextPage: OcrPage | null;
};

/**
 * Does this capture run off the bottom of its page?
 *
 * Pure, offline, free, and deliberately imprecise: see the header comment for
 * the 14% precision and the 1/1 recall it was measured at. It exists to make
 * stage 2 cheap, not to be believed.
 *
 * `documentPages` is ONE SOURCE DOCUMENT's pages, in order. That is what fences
 * a chain to the document it started in: page 27 of a merged contract scan is
 * not continued by page 0 of a separate SPLITBA scan, however adjacent their
 * global page numbers are.
 */
export function checkForContinuation(options: {
  zone: { pageIndex: number; lineRange: readonly [number, number] };
  documentPages: readonly OcrPage[];
  furniture: ReadonlyMap<number, ReadonlySet<number>>;
  /**
   * True for a `layout: "images"` slot. REQUIRED rather than defaulted: a
   * whole-page capture ends at its page's last content line by construction,
   * so the geometric test says nothing about it, and three of the six false
   * positives measured on bundle one were exactly that. A caller that forgets
   * to pass it would get those three back.
   */
  wholePageCapture: boolean;
}): ContinuationCheck {
  const { zone, documentPages, furniture, wholePageCapture } = options;

  const at = documentPages.findIndex((page) => page.index === zone.pageIndex);
  if (at === -1) {
    throw new Error(
      `zone page ${zone.pageIndex} is not among the ${documentPages.length} ` +
        "pages of the document supplied: continuation is scoped to one source " +
        "document, so the caller must pass the pages of the document the zone " +
        "sits in",
    );
  }
  const page = documentPages[at];
  const nextPage = documentPages[at + 1] ?? null;

  if (wholePageCapture) {
    return {
      looksLikeContinuation: false,
      verdict: "whole-page-capture",
      reason:
        "a whole-page capture ends at its page's last content line by " +
        "construction, so running off the bottom says nothing about it",
      nextPage,
    };
  }

  if (!nextPage) {
    return {
      looksLikeContinuation: false,
      verdict: "no-next-page",
      reason: `page ${page.index} is the last page of its document`,
      nextPage: null,
    };
  }

  const own = furniture.get(page.index) ?? new Set<number>();
  const lastContent = lastContentLine(page, own);
  if (lastContent === null) {
    return {
      looksLikeContinuation: false,
      verdict: "no-content-line",
      reason:
        `every line of page ${page.index} reads as running furniture, so ` +
        "there is no last content line to test against",
      nextPage,
    };
  }

  const to = zone.lineRange[1];

  // The highest line a capture may end on and still count as running off the
  // bottom. `lastContent` when the furniture detector worked on this page, and
  // `slack` lines above it when it may not have -- see `furnitureSlack`. The
  // `min` is what makes this monotone: it is never stricter than `lastContent`,
  // so nothing that fires today stops firing.
  const lastLine = page.lines[page.lines.length - 1]?.i ?? lastContent;
  const slack = furnitureSlack(page, documentPages, furniture);
  const bottom = Math.max(0, Math.min(lastContent, lastLine - slack));

  if (to < bottom) {
    return {
      looksLikeContinuation: false,
      verdict: "above-last-content",
      reason:
        bottom === lastContent
          ? `its last line (${to}) sits ${lastContent - to} line(s) above page ` +
            `${page.index}'s last content line (${lastContent})`
          : `its last line (${to}) sits ${bottom - to} line(s) above line ` +
            `${bottom}, the highest line on page ${page.index} a capture can ` +
            `end on and still count as running off the bottom (its last ` +
            `detected content line is ${lastContent}, and this document's ` +
            `running furniture is up to ${slack} line(s) deep)`,
      nextPage,
    };
  }

  // COUNTED BELOW THE CAPTURE, NOT BELOW `lastContent`. The old sentence read
  // the furniture off the page's last content line whatever the capture did,
  // so a range that had swallowed all three footer lines was reported as
  // having three furniture lines below it -- and this string is not
  // decoration: it is the `reason` in the OUTSTANDING JSON and the
  // `LANJUTAN LIKELY` log line an operator opens a page from.
  const furnitureBelow = page.lines.filter(
    (line) => line.i > to && own.has(line.i),
  ).length;
  const belowNote =
    furnitureBelow > 0
      ? `, with ${furnitureBelow} running-furniture line(s) below it`
      : "";

  if (to > lastContent) {
    return {
      looksLikeContinuation: true,
      verdict: "past-last-content",
      reason:
        `its last line (${to}) runs ${to - lastContent} line(s) PAST page ` +
        `${page.index}'s last content line (${lastContent}), so this capture ` +
        `has taken running furniture in; the block may still run onto page ` +
        `${nextPage.index}, but check this capture's own extent first`,
      nextPage,
    };
  }

  return {
    looksLikeContinuation: true,
    verdict: "at-page-bottom",
    reason:
      to === lastContent
        ? `its last line (${to}) is page ${page.index}'s last content line ` +
          `(${lastContent}${belowNote}), so the block may run onto page ` +
          `${nextPage.index}`
        : `its last line (${to}) sits ${lastContent - to} line(s) above page ` +
          `${page.index}'s last detected content line (${lastContent}), inside ` +
          `the ${slack} line(s) this document's running furniture can occupy, ` +
          `so the block may run onto page ${nextPage.index}`,
    nextPage,
  };
}

// ---------------------------------------------------------------------------
// Stage 2: one page, one question.
// ---------------------------------------------------------------------------

/**
 * How much of the confirmed capture's tail the model is shown.
 *
 * SIX, WITH NO BASIS, and saying so is the point: the four probe calls behind
 * this design used six and nobody has measured five or twelve. Too few and a
 * table's continuation has nothing to recognise itself against; too many and
 * the tail is mostly the previous page's unrelated content. It is a named
 * constant so an A/B over it is a one-line change rather than a rewrite.
 */
export const CONTINUATION_CONTEXT_LINES = 6;

const Reply = z.object({
  continues: z.boolean(),
  from: z.number().int().min(0).nullable(),
  to: z.number().int().min(0).nullable(),
  confidence: z.enum(["high", "low"]),
});

/**
 * The whole prompt: the slot, the tail of the block, and ONE page.
 *
 * ## Why this is cheap, and why it is also more accurate than the wide call
 *
 * One page's numbered listing measured a median 2,736 characters, about 760
 * tokens, against 20.2k for bundle one's whole-bundle locate listing: 3.8%.
 * And the page is GIVEN, so unlike `locateSlot` this call cannot land on the
 * wrong one. That is not only a saving. Asked the way the tree asks it today
 * -- one locate call across all 29 pages -- the ToP continuation answers page
 * 20 lines 5-16 and FAILS containment against the human's 0-15, which is the
 * gate's long-standing `KB / ToP (2)` miss. Asked here, given page 20, it
 * answers 0-15 exactly.
 *
 * ## Lines are numbered by POSITION in this listing
 *
 * Same discipline, same measured reason, as `buildLocatePrompt`: the reply is
 * mapped back through `nextPage.lines[position].i` by `confirmContinuation`.
 * A page's lines are dense and 0-based today (`assertLinesWellFormed` requires
 * it), so position and `i` agree -- but they agree by an invariant enforced
 * elsewhere, and reading the reply as an `i` directly would be correct only
 * for as long as that holds.
 *
 * ## The boundary sentence was A/B'd, and it is not a fix
 *
 * The measured false positive is `KB / Detail`, which read the NEXT clause's
 * own "Pasal" heading as a continuation and answered lines 2-10 with from=2
 * being that heading. Adding "if this page opens a new numbered clause,
 * article or heading of its own, answer false" changed nothing: Detail still
 * answered 2-10, ToP and both negatives held. The sentence stays in the
 * wording below because it states the question honestly, NOT because it works.
 * Recorded so nobody re-derives that patch and reports it as the repair. The
 * repair, if there is one, is a gate case and an A/B: the untried candidates,
 * in order, are showing the WHOLE previous block instead of its tail, asking
 * the model to name what the block is before ruling, and asking only for the
 * continuation's first line and deriving the end geometrically.
 */
export function buildContinuationPrompt(
  slotLabel: string,
  hint: string,
  tail: readonly Line[],
  nextPage: OcrPage,
): string {
  const shown = tail.slice(Math.max(0, tail.length - CONTINUATION_CONTEXT_LINES));
  const listing = nextPage.lines
    .map((line, position) => `${position}: ${line.text}`)
    .join("\n");

  return [
    `A block of text was cut from the bottom of one page to answer the field "${slotLabel}".`,
    `What that field means: ${hint}`,
    "",
    `The last ${shown.length} line(s) of that block, in order, are:`,
    ...shown.map((line) => line.text),
    "",
    "Decide whether the NEXT page carries MORE OF THAT SAME BLOCK: the rest of",
    "a table whose rows were cut off, the rest of a numbered list or clause",
    "that stopped part-way, the rest of a sentence. A page that opens",
    "something new -- a different clause, a different table, a different",
    "section -- is not a continuation, even when its subject is related. A",
    "repeated table header row, a letterhead or a running page header above",
    "the continuing content does not make it a new block.",
    "",
    "If it continues, give the range of lines on the next page that the",
    "continuation covers, and stop where the continuing block itself stops.",
    "",
    "Lines are numbered by their position in the listing below: the first line",
    "shown is line 0.",
    "",
    'Reply with JSON only: {"continues":true,"from":0,"to":15,"confidence":"high"}',
    'or {"continues":false,"from":null,"to":null,"confidence":"high"}.',
    "",
    `--- next page ---`,
    listing,
  ].join("\n");
}

export type ContinuationZone = {
  zone: Zone;
  text: string;
  confidence: "high" | "low";
};

/**
 * Asks the one question and turns a yes into a rectangle.
 *
 * Throws on a reply that is malformed or that cites a line the page does not
 * have, rather than salvaging it. `findContinuations` catches that and stops
 * the chain with the message recorded: a continuation nobody can validate is
 * a capture the operator draws by hand, which is the design's floor and a
 * perfectly good outcome. Inventing a range is not.
 */
export async function confirmContinuation(
  slotLabel: string,
  hint: string,
  tail: readonly Line[],
  nextPage: OcrPage,
  ask: Ask,
): Promise<ContinuationZone | null> {
  const reply = Reply.parse(
    extractJson(await ask(buildContinuationPrompt(slotLabel, hint, tail, nextPage))),
  );

  if (!reply.continues) return null;
  if (reply.from === null || reply.to === null) {
    throw new Error(
      'the model answered "continues": true with a null line range, so there ' +
        "is nothing to crop",
    );
  }
  if (reply.from > reply.to) {
    throw new Error(`line range reversed: ${reply.from} > ${reply.to}`);
  }
  const first = nextPage.lines[reply.from];
  const last = nextPage.lines[reply.to];
  if (!first || !last) {
    throw new Error(
      `the model returned lines ${reply.from}-${reply.to}, which is not a ` +
        `position range in page ${nextPage.index}'s ${nextPage.lines.length} ` +
        `lines (0-${nextPage.lines.length - 1})`,
    );
  }

  // Same trim, same reason, as `locateSlot`: the model is asked for text
  // boundaries and cannot see that its last line is a running footer two
  // thirds of a page below the block. And, as there, the TRIMMED range is what
  // every one of the three things leaving this function is derived from -- the
  // box, the citation and the transcript -- because a crop that disagrees with
  // the line numbers printed beside it is the wrong-and-quiet shape.
  const [from, to] = trimRunningFooter(nextPage.lines, first.i, last.i);

  const bounds: Box = { x: 0, y: 0, w: nextPage.width, h: nextPage.height };
  const box = boxForLineRange(nextPage.lines, from, to, CROP_PADDING_PX, bounds);

  return {
    zone: { pageIndex: nextPage.index, box, lineRange: [from, to] },
    text: nextPage.lines
      .filter((line) => line.i >= from && line.i <= to)
      .sort((a, b) => a.i - b.i)
      .map((line) => line.text)
      .join("\n"),
    confidence: reply.confidence,
  };
}

// ---------------------------------------------------------------------------
// The chain.
// ---------------------------------------------------------------------------

/**
 * The most continuations one capture may grow, before the walk stops and SAYS
 * SO.
 *
 * Twelve, from a measurement rather than a feeling: counted off the two
 * human-authored Form Validasi files, bundle two's deepest slot holds TEN
 * captures, i.e. nine continuations, and bundle one's deepest holds two. A cap
 * of 2, 3 or 5 would silently truncate real evidence on a document this
 * project has already been handed. Twelve is nine plus three.
 *
 * WHICH MEANS THE CAP IS NOT A SAFETY MECHANISM ON ITS OWN. It cannot be small
 * enough to be one without cutting a real chain, so what protects a 151-page
 * document from a model that keeps answering yes is that hitting the cap is
 * REPORTED -- `stoppedAtCap`, a `"cap"` step, and a line in the caller's log --
 * never a quiet stop. A chain also cannot outrun its document: every link
 * moves to the next page and `documentPages` is finite.
 */
export const MAX_CONTINUATION_CHAIN = 12;

export type ContinuationStepOutcome =
  /** Stage 2 said yes and the range validated: a capture to review. */
  | "found"
  /** Stage 1 declined. `verdict` says which of its four reasons. */
  | "declined"
  /** Stage 1 fired, stage 2 said no. */
  | "model-declined"
  /** Stage 2 answered something that could not be turned into a rectangle. */
  | "model-error"
  /** `MAX_CONTINUATION_CHAIN` reached with the chain still saying yes. */
  | "cap";

export type ContinuationStep = {
  /** Which capture this step is about: 2 is the first continuation. */
  ordinal: number;
  /** The page the capture before it ends on. */
  fromPageIndex: number;
  outcome: ContinuationStepOutcome;
  verdict?: ContinuationVerdict;
  reason: string;
  zone?: Zone;
  text?: string;
  confidence?: "high" | "low";
};

/**
 * Did the walk end on "we looked past this capture and there is nothing more"?
 *
 * READ THE VERDICT, NEVER THE OUTCOME ALONE, and this function exists because
 * reading the outcome alone shipped a lie. `/api/propose` recorded
 * `continuationChecked` from `outcome === "declined" || "model-declined"`, and
 * stage 1 declines a WHOLE-PAGE capture with verdict `whole-page-capture`
 * precisely because the geometric test carries no information about it. So
 * every `layout: "images"` capture -- four of AO_TEMPLATE's twelve, and 16 of
 * bundle two's 33 continuations belong to whole-page sections -- was stamped
 * "diperiksa, tidak ada lanjutan" although nothing had looked. An unexamined
 * capture reading as examined and complete is the exact failure
 * `continuationChecked` was added to prevent.
 *
 * Two verdicts are a definitive no: `above-last-content` (the block visibly
 * stops before the page does) and `no-next-page` (there is no page to run
 * onto). `whole-page-capture` and `no-content-line` are NON-ANSWERS -- the
 * module declines them rather than guessing -- and so are `cap` and
 * `model-error`, which are "we ran out of budget" and "we could not read the
 * reply". Only the model saying no (`model-declined`) joins the first two.
 */
export function endedOnDefinitiveNo(
  step: ContinuationStep | undefined,
): boolean {
  if (!step) return false;
  if (step.outcome === "model-declined") return true;
  if (step.outcome !== "declined") return false;
  return (
    step.verdict === "above-last-content" || step.verdict === "no-next-page"
  );
}

/**
 * Walks a capture forward until something says stop, and records every step.
 *
 * The recursion is the operator's own requirement ("there can be more than 1
 * lanjutan") and it needs nothing declared anywhere: each confirmed
 * continuation becomes stage 1's input, so a slot that runs to nine
 * continuations on one contract and none on the next is the same code path.
 *
 * `steps` is returned whole, including every decline, because "we looked and
 * found none" is information the operator does not currently get and is what
 * separates a checked capture from an unchecked one. The design's trade is
 * explicit: dropping the declared count swaps "asserts a capture that may not
 * exist" for "may silently miss one that does", and the ONLY thing that closes
 * it is recording that the search happened. A caller that throws `steps` away
 * has re-opened it.
 */
export async function findContinuations(options: {
  slotLabel: string;
  hint: string;
  /** The confirmed capture to walk forward from. */
  zone: Zone;
  /** The lines of the page that zone sits on, for the tail shown to the model. */
  documentPages: readonly OcrPage[];
  furniture: ReadonlyMap<number, ReadonlySet<number>>;
  wholePageCapture: boolean;
  ask: Ask;
  maxChain?: number;
  log?: (line: string) => void;
}): Promise<{
  zones: Zone[];
  steps: ContinuationStep[];
  stoppedAtCap: boolean;
}> {
  const {
    slotLabel,
    hint,
    documentPages,
    furniture,
    wholePageCapture,
    ask,
    maxChain = MAX_CONTINUATION_CHAIN,
    log = () => {},
  } = options;

  const zones: Zone[] = [];
  const steps: ContinuationStep[] = [];
  let current = options.zone;
  let stoppedAtCap = false;

  for (;;) {
    const ordinal = zones.length + 2;

    if (zones.length >= maxChain) {
      stoppedAtCap = true;
      const reason =
        `stopped after ${maxChain} continuation(s) at the chain cap while the ` +
        "block still looked like it ran on; the rest has to be checked by hand";
      steps.push({
        ordinal,
        fromPageIndex: current.pageIndex,
        outcome: "cap",
        reason,
      });
      log(`  ${slotLabel}: CAP -- ${reason}`);
      break;
    }

    const check = checkForContinuation({
      zone: current,
      documentPages,
      furniture,
      wholePageCapture,
    });
    if (!check.looksLikeContinuation || !check.nextPage) {
      steps.push({
        ordinal,
        fromPageIndex: current.pageIndex,
        outcome: "declined",
        verdict: check.verdict,
        reason: check.reason,
      });
      log(`  ${slotLabel}: no lanjutan -- ${check.reason}`);
      break;
    }

    const page = documentPages.find((p) => p.index === current.pageIndex)!;
    // RUNNING FURNITURE IS NOT PART OF THE BLOCK, and the tail is the only
    // thing stage 2 has to recognise the continuation against. A located range
    // that overshot into the footer strip (verdict `past-last-content`, which
    // fires like any other) would otherwise show the model a page-number and
    // initialling line as the last words of the clause, and asking "does this
    // continue" against page furniture is a mechanism for exactly the
    // plausible-wrong extent this design has already measured once.
    const ownFurniture = furniture.get(current.pageIndex) ?? new Set<number>();
    const tail = page.lines.filter(
      (line) =>
        line.i >= current.lineRange[0] &&
        line.i <= current.lineRange[1] &&
        !ownFurniture.has(line.i),
    );

    let confirmed: ContinuationZone | null;
    try {
      confirmed = await confirmContinuation(
        slotLabel,
        hint,
        tail,
        check.nextPage,
        ask,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      steps.push({
        ordinal,
        fromPageIndex: current.pageIndex,
        outcome: "model-error",
        reason,
      });
      log(`  ${slotLabel}: lanjutan check FAILED -- ${reason}`);
      break;
    }

    if (!confirmed) {
      const reason =
        `page ${check.nextPage.index} does not carry more of this block`;
      steps.push({
        ordinal,
        fromPageIndex: current.pageIndex,
        outcome: "model-declined",
        reason,
      });
      log(`  ${slotLabel}: no lanjutan -- ${reason}`);
      break;
    }

    steps.push({
      ordinal,
      fromPageIndex: current.pageIndex,
      outcome: "found",
      reason:
        `page ${confirmed.zone.pageIndex} lines ` +
        `${confirmed.zone.lineRange[0]}-${confirmed.zone.lineRange[1]} ` +
        "continue this block",
      zone: confirmed.zone,
      text: confirmed.text,
      confidence: confirmed.confidence,
    });
    log(
      `  ${slotLabel}: lanjutan ${ordinal - 1} proposed on page ` +
        `${confirmed.zone.pageIndex} lines ` +
        `${confirmed.zone.lineRange[0]}-${confirmed.zone.lineRange[1]} ` +
        `(${confirmed.confidence} confidence)`,
    );
    zones.push(confirmed.zone);
    current = confirmed.zone;
  }

  return { zones, steps, stoppedAtCap };
}
