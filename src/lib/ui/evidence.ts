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
  /**
   * True when `page.index` was not unique across the run, so a `Zone`'s
   * `pageIndex` cannot identify a page on its own and array position was used
   * instead. Surfaced in the UI rather than swallowed -- see `resolvePage`.
   */
  ambiguous: boolean;
};

/**
 * The page a zone points at.
 *
 * `Zone.pageIndex` is a number and `StoredPage` carries both an `id` and an
 * `index`, and the contract does not say whether that index is numbered
 * across the whole run or restarts per source document. Both readings are
 * handled, and the one case where they genuinely cannot be told apart is
 * reported rather than guessed at silently:
 *
 *   - indexes unique across the run  -> look the page up by index. This is
 *     the headless pipeline's numbering (`generate.mjs` numbers pages
 *     globally and keeps `pageInDoc` separately), so it is the expected path.
 *   - indexes repeat                 -> they restart per document, so the
 *     index alone names several pages. Fall back to array position and set
 *     `ambiguous`, which the contact sheet renders as a warning on the plate.
 *
 * Getting this wrong is the exact wrong-and-quiet failure this project fears:
 * a crop cut from the wrong page still looks like a crop.
 */
export function resolvePage(
  run: BrowserRun,
  pageIndex: number,
): ResolvedPage | null {
  const indexes = new Set(run.pages.map((p) => p.index));
  const unique = indexes.size === run.pages.length;

  const page = unique
    ? run.pages.find((p) => p.index === pageIndex)
    : run.pages[pageIndex];
  if (!page) return null;

  const siblings = run.pages.filter((p) => p.sourceId === page.sourceId);
  const source = run.sources.find((s) => s.id === page.sourceId);

  return {
    page,
    sourceName: source?.name ?? page.sourceId,
    pageInDoc: Math.max(0, siblings.indexOf(page)),
    pagesInDoc: source?.pageCount ?? siblings.length,
    ambiguous: !unique,
  };
}

/**
 * The number to store in a new `Zone.pageIndex` so that `resolvePage` finds
 * this page again.
 *
 * The inverse of `resolvePage`, and it has to be written as one: a zone the
 * operator draws by hand is stored by number, and if that number is read back
 * under a different rule than it was written under, the crop is cut from a
 * different page and still looks like a crop. `ui.test.mts` holds the
 * round-trip both numbering schemes have to satisfy.
 */
export function zonePageRef(run: BrowserRun, page: StoredPage): number {
  const indexes = new Set(run.pages.map((p) => p.index));
  return indexes.size === run.pages.length
    ? page.index
    : run.pages.indexOf(page);
}

export type Citation = {
  /** The file a reviewer would open. */
  source: string;
  /** That file's own page number, 1-based, as a reader would count it. */
  page: string;
  /** `L 31-58`, or a plain statement that there is no line citation. */
  lines: string;
  lineCount: number;
  /** Physical size of the crop at the render DPI, e.g. `4.1 x 1.3 in`. */
  size: string;
  /** Share of the page's height the crop covers, 0-1. */
  heightShare: number;
  /**
   * Advisory: the crop covers most of the page. The known unfixed defect in
   * `locate.ts` (a running page footer gets swallowed, so a 1.3in signature
   * block comes back 9.5in tall) shows up as exactly this, and it is the
   * shape the design asks the operator to catch by eye.
   */
  spansPage: boolean;
  ambiguous: boolean;
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

  return {
    source: resolved.sourceName,
    page: `p ${resolved.pageInDoc + 1}/${resolved.pagesInDoc}`,
    lines: cited ? `L ${from}-${to}` : "drawn by hand, no line citation",
    lineCount: cited ? to - from + 1 : 0,
    size: sizeInInches(zone.box),
    heightShare,
    spansPage: heightShare >= SPANS_PAGE_RATIO,
    ambiguous: resolved.ambiguous,
  };
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
