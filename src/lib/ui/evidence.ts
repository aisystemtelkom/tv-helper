/**
 * Turning a stored zone into something an operator can judge without opening
 * the source document.
 *
 * The design calls the citation "the tell": a proposal citing the wrong page,
 * or a range far longer than the field warrants, has to read as wrong at a
 * glance. That only works if the citation names the document the reviewer
 * would actually open -- its file name and its own page number -- rather than
 * a number that is only meaningful inside this run. The same mistake was
 * already made and fixed once in the xlsx exporter (task-11 finding 2), and
 * this module exists so the contact sheet does not make it a second time.
 *
 * Everything here is pure so `src/lib/ui/ui.test.mts` can drive it.
 */

import { DEFAULT_DPI } from "../pipeline/render.ts";
import type { Box } from "../pipeline/render.ts";
import type { BrowserRun, StoredPage, Zone } from "./runtime.ts";

/**
 * A hand-drawn zone over a region with no OCR text has no line range to cite.
 * `Zone.lineRange` is not optional, so it carries this instead: out of band
 * for a real line index, which is always >= 0.
 *
 * Deliberately not 0, and deliberately not omitted. `[0, 0]` would read as a
 * true citation of the page's first line, and anything that re-derives a box
 * from it (`boxForLineRange`) would return a real rectangle somewhere else on
 * the page. A negative index makes that re-derivation throw, which is the
 * loud failure this project prefers to a quiet wrong one.
 */
export const NO_LINE_CITATION = -1;

export function hasLineCitation(zone: Zone): boolean {
  return zone.lineRange[0] >= 0 && zone.lineRange[1] >= 0;
}

export type ResolvedPage = {
  page: StoredPage;
  sourceName: string;
  /** 0-based position of this page inside its own source document. */
  pageInDoc: number;
  /** How many pages that source contributed to this run. */
  pagesInDoc: number;
};

/**
 * The page a zone points at: `BrowserRun.pages[pageIndex]`, and nothing else.
 *
 * THE CONTRACT IS NOT AMBIGUOUS, and this function used to act as though it
 * were. `src/lib/browser/types.ts` states both halves: `StoredPage.index` is
 * "the page's 0-based number WITHIN ITS OWN SOURCE DOCUMENT ... It is NOT the
 * run-global page number. That one is the page's position in
 * `BrowserRun.pages`, and it is what `Zone.pageIndex` refers to."
 * `/api/propose` re-derives the position rather than copying `page.index` and
 * refuses a request numbered the other way (`assertRunGlobalIndexes`), and
 * `zonePageRef` below writes the same number. So array position is the ONLY
 * reading, not a fallback from one.
 *
 * WHAT THIS REPLACES, AND WHY IT MATTERED. The old version looked a page up by
 * `index` when those values happened to be unique and by position when they
 * repeated, and set an `ambiguous` flag in the second case -- which the
 * contact sheet rendered as "page numbering repeats in this run, so this page
 * was matched by position - open it before accepting". Under the real contract
 * `index` restarts at 0 for every source, so a second document ALWAYS repeats
 * it: the warning fired on every citation of every multi-source run, which is
 * every real run. That is permanent alarm fatigue on the one signal the design
 * relies on for a reviewer to distrust a citation, and it warned about the
 * correct answer. (Both branches resolved to the same page anyway: indexes can
 * only be unique when there is one source, where position and index coincide.)
 *
 * The genuine failure -- a `pageIndex` the run cannot resolve -- is still
 * reported, as `null`.
 */
export function resolvePage(
  run: BrowserRun,
  pageIndex: number,
): ResolvedPage | null {
  const page = run.pages[pageIndex];
  if (!page) return null;

  const siblings = run.pages.filter((p) => p.sourceId === page.sourceId);
  const source = run.sources.find((s) => s.id === page.sourceId);

  return {
    page,
    sourceName: source?.name ?? page.sourceId,
    // From the run rather than from `page.index` so an interrupted ingest
    // still cites a position the run can actually show. The two agree
    // whenever a source's pages were stored in order, which is the only way
    // `ingestDocument` writes them.
    pageInDoc: Math.max(0, siblings.indexOf(page)),
    pagesInDoc: source?.pageCount ?? siblings.length,
  };
}

/**
 * The number to store in a new `Zone.pageIndex` so that `resolvePage` finds
 * this page again.
 *
 * The inverse of `resolvePage`, and it has to be written as one: a zone the
 * operator draws by hand is stored by number, and if that number is read back
 * under a different rule than it was written under, the crop is cut from a
 * different page and still looks like a crop. `ui.test.mts` holds the round
 * trip. Unconditional, for the reason spelled out above: the run-global
 * position is what `Zone.pageIndex` means.
 */
export function zonePageRef(run: BrowserRun, page: StoredPage): number {
  return run.pages.indexOf(page);
}

export type Citation = {
  /** The file a reviewer would open. */
  source: string;
  /** That file's own page number, 1-based, as a reader would count it. */
  page: string;
  /** `L 31-58`, or a plain statement that there is no line citation. */
  lines: string;
  lineCount: number;
  /**
   * How many of the cited lines had their rectangle SLICED rather than
   * measured -- `Line.origin === "interpolated"`.
   *
   * Gemini returns paragraph blocks, not printed lines, so a block covering
   * several lines is cut into equal vertical bands and each band becomes a
   * line. The text is the engine's; the top and bottom edges are arithmetic.
   * Within a paragraph that is close to the true leading, but a block whose
   * lines are not evenly spaced (a heading followed by body text, a table cell
   * wrapping) puts the boundary somewhere the page does not have one, and the
   * crop then clips a descender or takes a slice of the next line.
   *
   * The operator is the only one who can see that, so the number is surfaced
   * rather than acted on: a sliced rectangle presented as a measured one is
   * this project's failure class in miniature.
   *
   * `origin` is optional, and undefined means NOT RECORDED -- runs ingested
   * before the migration have no origin on any line. Counting those as
   * interpolated would put the chip on every capture of every old run, which
   * is the alarm fatigue the `ambiguous` flag already caused once.
   */
  interpolatedLines: number;
  /** Physical size of the crop at the render DPI, e.g. `4.1 x 1.3 in`. */
  size: string;
  /** Share of the page's height the crop covers, 0-1. */
  heightShare: number;
  /**
   * Advisory: the crop covers most of the page WITHOUT having been asked to.
   * The known unfixed defect in `locate.ts` (a running page footer gets
   * swallowed, so a 1.3in signature block comes back 9.5in tall) shows up as
   * exactly this, and it is the shape the design asks the operator to catch
   * by eye.
   *
   * Never true for a `wholePage` capture. Four of the twelve captures are
   * whole pages by design, so warning "covers 100% of the page - check it has
   * not run on into a footer" over them would have put a false alarm on a
   * third of the sheet -- the same alarm fatigue the `ambiguous` flag caused,
   * on the same signal.
   */
  spansPage: boolean;
  /**
   * The zone is the entire page: a `layout: "images"` capture, which
   * `/api/propose` produces deterministically and without a model call.
   * Worth saying, because "L 0-93 · 8.3 x 11.7 in" otherwise reads like a
   * runaway range rather than the intended answer.
   */
  wholePage: boolean;
};

/** Crops are cut at the render DPI, so a pixel box has a real physical size. */
export function sizeInInches(box: Box, dpi: number = DEFAULT_DPI): string {
  const w = box.w / dpi;
  const h = box.h / dpi;
  return `${w.toFixed(1)} x ${h.toFixed(1)} in`;
}

/** Above this share of page height a crop is flagged as covering the page. */
export const SPANS_PAGE_RATIO = 0.8;

export function citeZone(run: BrowserRun, zone: Zone): Citation | null {
  const resolved = resolvePage(run, zone.pageIndex);
  if (!resolved) return null;

  const [from, to] = zone.lineRange;
  const cited = hasLineCitation(zone);
  const heightShare =
    resolved.page.heightPx > 0 ? zone.box.h / resolved.page.heightPx : 0;
  const wholePage = coversWholePage(zone.box, resolved.page);

  return {
    source: resolved.sourceName,
    page: `p ${resolved.pageInDoc + 1}/${resolved.pagesInDoc}`,
    lines: cited ? `L ${from}-${to}` : "drawn by hand, no line citation",
    lineCount: cited ? to - from + 1 : 0,
    // Only over a real citation: a hand-drawn zone cites no lines at all, and
    // the plate already says so in as many words ("free pixels").
    interpolatedLines: cited
      ? resolved.page.lines.filter(
          (l) => l.i >= from && l.i <= to && l.origin === "interpolated",
        ).length
      : 0,
    size: sizeInInches(zone.box),
    heightShare,
    spansPage: !wholePage && heightShare >= SPANS_PAGE_RATIO,
    wholePage,
  };
}

/**
 * Is this box the whole page?
 *
 * `>=` rather than `===` on the extents, and `<=` on the origin, because a
 * hand-drawn zone is clamped to the page and can land exactly on its edges;
 * a capture that reaches every edge IS the page however it got there.
 */
function coversWholePage(box: Box, page: StoredPage): boolean {
  return (
    page.widthPx > 0 &&
    page.heightPx > 0 &&
    box.x <= 0 &&
    box.y <= 0 &&
    box.w >= page.widthPx &&
    box.h >= page.heightPx
  );
}

/**
 * The OCR text a zone covers, taken from the page rather than from whatever
 * was stored beside the zone.
 *
 * `SlotState.text` is the runtime's copy and is what the UI shows by default.
 * This is the second opinion the zone editor needs: once an operator drags a
 * new rectangle, the stored text describes the OLD one, and showing it beside
 * the new crop is a transcript that quietly disagrees with the picture.
 */
export function textForLineRange(
  page: StoredPage,
  from: number,
  to: number,
): string {
  if (from < 0 || to < from) return "";
  return page.lines
    .filter((l) => l.i >= from && l.i <= to)
    .sort((a, b) => a.i - b.i)
    .map((l) => l.text)
    .join("\n");
}
