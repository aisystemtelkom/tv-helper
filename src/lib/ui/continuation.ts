/**
 * THE HAND-DRAWN LANJUTAN CHAIN: the logic behind the question the zone editor
 * asks after every save.
 *
 * The operator's own words for what this is: "bisa pilih, ada lanjutan (next
 * page) atau enggak, sampe semua page ke-cover." One capture is saved, the
 * editor asks whether the rest of THAT SAME BAGIAN runs onto the next page, and
 * the loop ends when they say it does not.
 *
 * A LANJUTAN IS THE REST OF ONE BAGIAN, NOT A PAGE-RANGE SWEEPER. The sample's
 * two ToP pictures are items 1-3 and items 4-5 of one Pasal, split by a page
 * break. So the walk stops when that clause is complete, never when the
 * document runs out of pages, and the only thing that can say which is a
 * person looking at the page.
 *
 * ## Why this is a module of its own
 *
 * Everything here is pure, so `src/lib/ui/ui.test.mts` drives it under
 * `node --test` with no browser and no React. It is NOT in
 * `src/lib/browser/captures.ts` (which owns the minting) because the hint below
 * reaches into `src/lib/pipeline/continuation.ts`, and that module pulls in zod
 * and `locate.ts`. `captures.ts` is imported by `slots.ts` and `export.ts`,
 * which every screen in the product loads; hanging the pipeline off it would
 * put zod in chunks that have no use for it.
 *
 * ## The model is never asked anything here
 *
 * `checkForContinuation` is stage 1 of the pipeline's two-stage design: pure
 * geometry over the OCR lines the device already holds, no network, no token.
 * Stage 2, the confirming model call, is deliberately NOT reached from here.
 * The operator is standing in front of the page: asking a model to guess where
 * the block ends, and then asking the person to check the guess, is more
 * expensive and less certain than handing them the next page with a whole-page
 * draft already armed.
 */

import {
  checkForContinuation,
  runningFurniture,
} from "../pipeline/continuation.ts";
import type { OcrPage } from "../pipeline/locate.ts";
import { citeZone, resolvePage } from "./evidence.ts";
import { withDiscoveredCaptures } from "./runtime.ts";
import type { BrowserRun, StoredPage, Zone } from "./runtime.ts";

/**
 * The page a lanjutan would be carried onto, with everything needed to name it
 * to the operator.
 *
 * `pageIndex` is the RUN-GLOBAL position, which is what `Zone.pageIndex` means;
 * `pageInDoc` is the page's own number inside its berkas, which is the only
 * number a reviewer can act on. Confusing those two has already shipped a wrong
 * page reference once, in a cell note, which is why both are carried
 * rather than one being re-derived at the call site.
 */
export type NextPage = {
  pageIndex: number;
  page: StoredPage;
  sourceName: string;
  pageInDoc: number;
  pagesInDoc: number;
};

/**
 * The next page OF THE SAME BERKAS, or null.
 *
 * THE FENCE IS THE WHOLE POINT, and it is the same one `checkForContinuation`
 * enforces for itself: page 27 of a merged contract scan is not continued by
 * page 0 of a separate SPLITBA scan, however adjacent their run-global numbers
 * are. `BrowserRun.pages` is one flat append-only array across every document
 * ingested, so "the next page" without this test is routinely the first page of
 * an unrelated document -- and a whole-page capture of it, filed under this
 * bagian's label, is exactly the plausible-wrong evidence a validator signs.
 */
export function nextPageInBerkas(
  run: BrowserRun,
  pageIndex: number,
): NextPage | null {
  const here = run.pages[pageIndex];
  const next = run.pages[pageIndex + 1];
  if (!here || !next || next.sourceId !== here.sourceId) return null;

  const resolved = resolvePage(run, pageIndex + 1);
  if (!resolved) return null;

  return {
    pageIndex: pageIndex + 1,
    page: resolved.page,
    sourceName: resolved.sourceName,
    pageInDoc: resolved.pageInDoc,
    pagesInDoc: resolved.pagesInDoc,
  };
}

/**
 * What the free geometric filter can say about a saved potongan, reduced to the
 * two readings that carry information.
 *
 * Deliberately NOT `ContinuationVerdict`. Four of that type's six members are
 * non-answers ("this test says nothing here"), and a screen that rendered them
 * would be dressing an absence of information as advice.
 */
export type ContinuationHint =
  /** It ends at the bottom of its page, so the block MAY run on. */
  | "runs-on"
  /** It visibly stops above the page's last content line. */
  | "stops-short";

/**
 * The free reading, or null when there is nothing honest to say.
 *
 * NULL IS A REAL ANSWER AND THE SCREEN MUST RENDER NOTHING FOR IT. Three cases
 * reach it, and the first is the one that would otherwise do damage:
 *
 *  - A WHOLE-PAGE CAPTURE. A capture that IS the page ends at that page's last
 *    content line BY CONSTRUCTION, so "it runs to the bottom" is a fact about
 *    the rectangle rather than about the document. Three of the six false
 *    positives measured over bundle one were exactly this. Showing it as a
 *    recommendation would be a new wrong-and-quiet surface built by the feature
 *    meant to close one, and the operator has no way to tell an informative
 *    verdict from a tautological one.
 *  - A CAPTURE WITH NO LINE CITATION, which is a signature or a stamp block
 *    taken as free pixels. There is no last cited line to compare against the
 *    page's, so the geometry has nothing to measure; `checkForContinuation`
 *    would read the `-1` sentinel as a very high stop and answer
 *    `above-last-content`, which is a confident "no lanjutan" derived from
 *    nothing.
 *  - A page the run can no longer resolve, or a page whose every line reads as
 *    running furniture.
 *
 * `wholePageCapture` is decided GEOMETRICALLY here, through `citeZone`, rather
 * than from the section's `layout`. The editor's "Satu halaman" key produces a
 * whole-page rectangle on a `layout: "table"` bagian too, and the reason stage 0
 * exists applies to that one identically.
 */
export function continuationHint(
  run: BrowserRun,
  zone: Zone,
): ContinuationHint | null {
  const cite = citeZone(run, zone);
  if (!cite || cite.wholePage) return null;
  if (!cite.lines) return null;

  const here = run.pages[zone.pageIndex];
  if (!here) return null;

  const documentPages = pagesOfBerkas(run, here.sourceId);
  const furniture = runningFurniture(documentPages);

  // `checkForContinuation` throws when the zone's page is not among the pages
  // it was handed, which cannot happen through `pagesOfBerkas` -- but a hint is
  // the most disposable thing on this screen and must never take the editor
  // down with it. Silence is the correct degradation: no hint at all is what
  // the whole-page case already renders.
  let check;
  try {
    check = checkForContinuation({
      zone,
      documentPages,
      furniture,
      wholePageCapture: false,
    });
  } catch {
    return null;
  }

  switch (check.verdict) {
    // `past-last-content` fires like `at-page-bottom` -- the block may still
    // run on -- and it is folded into the same word here because the extra
    // thing it says ("this capture has swallowed running furniture") is about
    // the rectangle the operator is looking at, which they have just drawn and
    // can see. It is not about the next page, which is what this strip asks.
    case "at-page-bottom":
    case "past-last-content":
      return "runs-on";
    case "above-last-content":
      return "stops-short";
    default:
      return null;
  }
}

/**
 * One berkas's pages, as the pipeline's `OcrPage`.
 *
 * `index` IS THE RUN-GLOBAL POSITION, deliberately, because that is what a
 * `Zone.pageIndex` holds and `checkForContinuation` matches the zone against
 * these by `index`. Copying `StoredPage.index` -- the page's number inside its
 * own document -- would compile, work perfectly for a single-berkas order, and
 * silently look at the wrong page from the second document onward.
 */
function pagesOfBerkas(run: BrowserRun, sourceId: string): OcrPage[] {
  const pages: OcrPage[] = [];
  run.pages.forEach((page, index) => {
    if (page.sourceId !== sourceId) return;
    pages.push({
      index,
      width: page.widthPx,
      height: page.heightPx,
      lines: page.lines,
    });
  });
  return pages;
}

/**
 * A LINK THE OPERATOR DREW, appended to the chain, and the capture it follows
 * stamped as looked-past.
 *
 * THE STAMP IS THE HALF THAT IS EASY TO LEAVE OUT, and leaving it out is a
 * measured defect rather than untidiness: an unstamped middle link makes the
 * next reading pass walk the whole chain again and append a byte-identical
 * duplicate of every link, quadratically. Over bundle two's ten-capture slot
 * that is 36 duplicate rows and 36 extra model calls, on one press of a button
 * the export screen itself recommends pressing. So the append and the stamp are
 * ONE call and cannot be done separately by accident.
 *
 * WHICH LINK IS STAMPED, precisely: the PREVIOUS one. Something looked past it
 * and what it found is now in the run. The link being appended is NOT stamped --
 * nothing has looked past it yet, which is why the editor immediately asks the
 * same question about it.
 *
 * `confirmed`, not `proposed`, and that is the one place this differs from the
 * discovered path: a person drew this rectangle and is looking at it while they
 * press the key. There is nobody left to review it.
 */
export function withHandDrawnLink(
  run: BrowserRun,
  previousKey: string,
  zone: Zone,
  text: string,
): { run: BrowserRun; key: string | null; index: number | null } {
  const next = withDiscoveredCaptures(
    run,
    [{ after: previousKey, zone, text, origin: "human", status: "confirmed" }],
    [previousKey],
  );

  // NOTHING WAS APPENDED, AND THE CALLER MUST BE TOLD RATHER THAN REASSURED.
  // `withDiscoveredCaptures` declines an append whose parent has lost its zone,
  // whose parent the operator has since marked `sengaja dikosongkan`, or whose
  // rectangle this bagian already holds under another ordinal. All three are
  // legitimate refusals and all three mean the operator's drawing did not
  // become evidence, so the original run goes back -- the stamp on the parent
  // goes with it, because if nothing was appended then nothing was found past
  // it either.
  if (next.slots.length === run.slots.length) {
    return { run, key: null, index: null };
  }

  const index = next.slots.length - 1;
  return { run: next, key: next.slots[index].key, index };
}

/**
 * "Tidak ada lanjutan": a person looked past THIS capture and there is nothing
 * there.
 *
 * It stamps the CURRENT link, which is the opposite end from `withHandDrawnLink`
 * and the reason the two are separate functions rather than one with a flag.
 *
 * THE STAMP IS REFUSED IF THE CAPTURE NO LONGER HOLDS THE RECTANGLE THAT WAS
 * LOOKED AT, and that is enforced inside `withDiscoveredCaptures` rather than
 * here: the verdict is stored as the FINGERPRINT of the zone it was made about,
 * so a run re-read from storage whose capture was redrawn in another tab cannot
 * be stamped with a verdict about a rectangle that no longer exists.
 *
 * There is deliberately no third option beside this and taking the next page.
 * CLOSING THE EDITOR IS "later", and it stamps nothing, so the sheet keeps
 * saying "belum diperiksa lanjutannya" -- which is true, because nobody looked.
 * A third key would write "diperiksa, tidak ada lanjutan" for a search that
 * never happened, and that phrase is reserved in `docs/ui-bahasa.md` for a
 * search that actually looked past a potongan's page bottom.
 */
export function withNoContinuation(run: BrowserRun, key: string): BrowserRun {
  return withDiscoveredCaptures(run, [], [key]);
}
