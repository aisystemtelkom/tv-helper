/**
 * Operator-UI logic tests.
 *
 * No browser, no runtime, no model: every function under test is pure, which
 * is why the citation, the snapping and the slot bookkeeping were written as
 * pure functions in the first place. What they protect is the thing a human
 * validator signs -- a crop cut from the wrong page, a transcript that does
 * not match its picture, or a half-filled slot rendered as complete are all
 * failures that LOOK fine in the deliverable.
 */

import { emptyConfigCheck, emptyEpicCheck } from "../config/types.ts";
import type { Sheet } from "../xlsx/grid.ts";
import {
  buildFieldsOnlyRequest,
  buildInterpretRequest,
  buildResearchRequest,
} from "./checkpoint.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { applySectionEdit } from "../browser/sections.ts";
import {
  emptyOverlay,
  resolveTemplate,
  type NodeId,
  type ProposedSection,
  type TemplateOverlay,
} from "../forms/overlay.ts";
import {
  AO_TEMPLATE,
  type SectionDef,
  type SlotDef,
  type Template,
} from "../forms/template.ts";
import type { Line, Word } from "../pipeline/geometry.ts";
import type { Box } from "../pipeline/render.ts";
import {
  NO_LINE_CITATION,
  citeZone,
  hasLineCitation,
  resolvePage,
  cropSize,
  textForLineRange,
  zonePageRef,
} from "./evidence.ts";
import type { BrowserRun, SlotState, StoredPage, Zone } from "./runtime.ts";
import { continuationChecked, zoneFingerprint } from "../browser/captures.ts";
import {
  continuationHint,
  nextPageInBerkas,
  withHandDrawnLink,
  withNoContinuation,
} from "./continuation.ts";
import {
  buildExtractRequest,
  extractionSignature,
  fillableValues,
  noteForField,
  usableExtraction,
  type ExtractedField,
} from "./extract.ts";
import {
  captureLabel,
  aggregateStatus,
  describeOutstanding,
  hasUnreviewedProposals,
  outstandingIndexes,
  progressOf,
  proposedIndexesIn,
  sheetSections,
  unmatchedStates,
  type PlacedSlot,
} from "./slots.ts";
import { blockingItems, planExport } from "./export.ts";
import {
  DISCOVER_FENCED_REASON,
  NO_USULAN_WAITING,
  PAGES_NOT_IN_JUDUL,
  REASON_HINT_LABEL,
  REASON_ORDER,
  berkasUsulan,
} from "./outstanding.ts";
import {
  buildProposeRequest,
  discoverIds,
  searchablePageCount,
} from "./propose.ts";
import {
  hiddenSections,
  packetPosition,
  provenanceOf,
  removalNeedsDialog,
  removeSectionEdit,
  sectionRemovalCost,
} from "./headings.ts";
import {
  clampBox,
  drawZone,
  isMeaningfulDrag,
  linesInsideBox,
  linesTouchedBy,
  normalizeBox,
} from "./snap.ts";
import {
  documentDigest,
  fileDigest,
  findInOtherOrders,
  heldDocuments,
  screenDigested,
  screenDocuments,
} from "./runtime.ts";

/* ------------------------------------------------------------------ fixtures */

function word(text: string, box: Box): Word {
  return { text, box };
}

function line(i: number, text: string, box: Box): Line {
  return { i, text, box, words: [word(text, box)] };
}

function page(
  id: string,
  sourceId: string,
  index: number,
  lines: Line[] = [],
): StoredPage {
  return { id, sourceId, index, widthPx: 1000, heightPx: 2000, lines };
}

/**
 * Fictional identifiers only: this repo is public.
 *
 * `StoredPage.index` RESTARTS AT 0 FOR EVERY SOURCE, which is the contract
 * `src/lib/browser/types.ts` states and what `ingestDocument` actually writes.
 * This fixture used to number them 0..4 across the run, which no producer of a
 * `BrowserRun` does, and that is what made the old two-reading `resolvePage`
 * look reasonable. A `Zone.pageIndex` is the position in `pages`, always.
 */
const RUN: BrowserRun = {
  id: "run-1",
  createdAt: 0,
  // An order nobody has renamed anything on. Required rather than optional, so
  // that no run can quietly lose an operator's naming work; `resolveTemplate`
  // short-circuits an empty one to the base by identity, so this fixture
  // behaves exactly as it did before overlays existed.
  overlay: emptyOverlay(AO_TEMPLATE),
  konfigurasi: emptyConfigCheck(),
  epic: emptyEpicCheck(),
  sources: [
    { id: "s1", name: "SPLITBA_LOP999001.pdf", pageCount: 2 },
    { id: "s2", name: "LOP999001_merged.pdf", pageCount: 3 },
  ],
  pages: [
    page("p0", "s1", 0),
    page("p1", "s1", 1),
    page("p2", "s2", 0),
    page("p3", "s2", 1),
    page("p4", "s2", 2),
  ],
  slots: [],
};

/* ----------------------------------------------------------------- evidence */

test("resolvePage names the file a reviewer would open, and its own page number", () => {
  const resolved = resolvePage(RUN, 3);
  assert.ok(resolved);
  assert.equal(resolved.sourceName, "LOP999001_merged.pdf");
  // Run-global page 3 is the SECOND page of the second document. Reporting
  // "3" here is the mistake a cell note already had to fix once.
  assert.equal(resolved.pageInDoc, 1);
  assert.equal(resolved.pagesInDoc, 3);
});

test("resolvePage reads pageIndex as the run-global position, never as StoredPage.index", () => {
  /*
   * THIS ASSERTION REPLACES ONE THAT PINNED A DEFECT.
   *
   * It used to read: with `StoredPage.index` repeating across sources,
   * `resolvePage` sets `ambiguous: true` and the plate warns "page numbering
   * repeats in this run, so this page was matched by position - open it
   * before accepting". But indexes repeat in EVERY multi-source run -- that
   * is the documented contract, not a degenerate case -- so the warning fired
   * on every citation of every real run, and it fired over the correct
   * answer. Permanent alarm fatigue on the one signal the design depends on
   * for a reviewer to distrust a citation is worse than no signal at all.
   *
   * What is worth asserting is the thing that actually decides whether a crop
   * comes off the right page: run-global position wins over `index` when the
   * two disagree. Here run-global page 2 is the second document's FIRST page
   * (`index` 0), and `index` 2 belongs to a different page entirely (`p4`).
   */
  const resolved = resolvePage(RUN, 2);
  assert.ok(resolved);
  assert.equal(resolved.page.id, "p2");
  assert.equal(resolved.page.index, 0);
  assert.equal(resolved.sourceName, "LOP999001_merged.pdf");
  assert.equal(resolved.pageInDoc, 0);
});

test("resolvePage returns null for a page index the run does not have", () => {
  assert.equal(resolvePage(RUN, 99), null);
});

test("a hand-drawn zone reads back to the page it was drawn on", () => {
  // Written by `zonePageRef`, read by `resolvePage`. If these two ever
  // disagree the crop comes off a different page and still looks like a crop.
  // Both a single-source run (where position and `index` coincide) and a
  // multi-source one (where they do not) have to hold.
  for (const run of [
    RUN,
    { ...RUN, sources: [RUN.sources[0]], pages: RUN.pages.slice(0, 2) },
    {
      ...RUN,
      pages: [
        page("p0", "s1", 0),
        page("p1", "s1", 1),
        page("p2", "s2", 0),
        page("p3", "s2", 1),
      ],
    },
  ]) {
    for (const target of run.pages) {
      const resolved = resolvePage(run, zonePageRef(run, target));
      assert.equal(resolved?.page.id, target.id);
    }
  }
});

test("citeZone cites the source file and line range, and sizes the crop", () => {
  const cite = citeZone(RUN, {
    pageIndex: 2,
    box: { x: 100, y: 100, w: 1230, h: 390 },
    lineRange: [31, 58],
  });
  assert.ok(cite);
  assert.equal(cite.source, "LOP999001_merged.pdf");
  assert.equal(cite.page, 1);
  assert.equal(cite.pagesInDoc, 3);
  assert.deepEqual(cite.lines, [31, 58]);
  assert.equal(cite.lineCount, 28);
  // Centimetres with a comma decimal: the operators are in Indonesia holding
  // A4, so this is a size they can put two fingers on. Display only, and the
  // exporter still works in pixels.
  assert.equal(cite.size, "10,4 x 3,3 cm");
  assert.equal(cite.spansPage, false);
});

test("citeZone flags a crop that swallows most of the page", () => {
  // The shape locate.ts's known footer defect produces: a signature block
  // that ran on into the page footer and came back nine inches tall.
  const cite = citeZone(RUN, {
    pageIndex: 0,
    box: { x: 0, y: 100, w: 900, h: 1800 },
    lineRange: [1, 16],
  });
  assert.ok(cite);
  assert.equal(cite.spansPage, true);
  assert.equal(cite.wholePage, false);
  assert.ok(cite.heightShare >= 0.8);
});

test("a whole-page capture is described, not flagged as a runaway range", () => {
  // Four of the twelve captures are `layout: "images"` slots, which
  // `/api/propose` answers with the entire page and no model call. Warning
  // "covers 100% of the page - check it has not run on into a footer" over a
  // capture that is SUPPOSED to be the whole page puts a false alarm on a
  // third of the contact sheet, which is the same alarm fatigue the
  // `ambiguous` flag caused, on the same signal.
  const cite = citeZone(RUN, {
    pageIndex: 0,
    box: { x: 0, y: 0, w: 1000, h: 2000 },
    lineRange: [0, 93],
  });
  assert.ok(cite);
  assert.equal(cite.wholePage, true);
  assert.equal(cite.spansPage, false);
  // Still a real citation: the page it names is still the thing to check.
  assert.deepEqual(cite.lines, [0, 93]);
});

test("a hand-drawn zone with no lines carries no line citation", () => {
  const zone = {
    pageIndex: 0,
    box: { x: 0, y: 0, w: 100, h: 100 },
    lineRange: [NO_LINE_CITATION, NO_LINE_CITATION] as [number, number],
  };
  assert.equal(hasLineCitation(zone), false);
  const cite = citeZone(RUN, zone);
  assert.ok(cite);
  assert.equal(cite.lineCount, 0);
  // A hand-drawn zone cites no lines at all, and null is the only honest
  // answer. The old shape put the excuse in the field itself, as the string
  // "drawn by hand, no line citation", which meant the one place a caller
  // could read a range was also a place that sometimes held a sentence. It
  // must never read as a citation of line 0 either, which is what a `[0, 0]`
  // placeholder would have looked like from the outside.
  assert.equal(cite.lines, null);
});

test("citeZone counts the cited lines whose box was sliced, not measured", () => {
  // Gemini returns paragraph blocks, so a multi-line block's per-line boxes
  // are equal vertical bands: the text is measured, the edges are arithmetic.
  // The operator is the only reader who can judge whether the cut landed
  // where the page actually breaks, so the count has to reach the plate.
  const sliced = (i: number, y: number): Line => ({
    ...line(i, `line ${i}`, { x: 0, y, w: 100, h: 20 }),
    origin: "interpolated",
  });
  const measured = (i: number, y: number): Line => ({
    ...line(i, `line ${i}`, { x: 0, y, w: 100, h: 20 }),
    origin: "measured",
  });
  const run: BrowserRun = {
    ...RUN,
    pages: [
      page("p0", "s1", 0, [
        measured(0, 0),
        sliced(1, 20),
        sliced(2, 40),
        // Outside the cited range: counting it would make the chip a
        // property of the page rather than of this crop.
        sliced(3, 60),
      ]),
      ...RUN.pages.slice(1),
    ],
  };

  const cite = citeZone(run, {
    pageIndex: 0,
    box: { x: 0, y: 0, w: 100, h: 60 },
    lineRange: [0, 2],
  });
  assert.ok(cite);
  assert.equal(cite.lineCount, 3);
  assert.equal(cite.interpolatedLines, 2);
});

test("lines with no recorded origin are never counted as sliced", () => {
  // `Line.origin` is optional and undefined means NOT RECORDED: every run
  // ingested before the Gemini migration reads back that way, and
  // `StoredPage.lines` is persisted opaquely with no version check anywhere.
  // Counting those as interpolated would put the chip on every capture of
  // every old run -- the same permanent false alarm the `ambiguous` flag
  // caused, on the same signal.
  const run: BrowserRun = {
    ...RUN,
    pages: [
      page("p0", "s1", 0, [
        line(0, "first", { x: 0, y: 0, w: 100, h: 20 }),
        line(1, "second", { x: 0, y: 20, w: 100, h: 20 }),
      ]),
      ...RUN.pages.slice(1),
    ],
  };

  const cite = citeZone(run, {
    pageIndex: 0,
    box: { x: 0, y: 0, w: 100, h: 40 },
    lineRange: [0, 1],
  });
  assert.ok(cite);
  assert.equal(cite.interpolatedLines, 0);
});

test("a hand-drawn zone reports no sliced lines, because it cites none", () => {
  const run: BrowserRun = {
    ...RUN,
    pages: [
      page("p0", "s1", 0, [
        { ...line(0, "first", { x: 0, y: 0, w: 100, h: 20 }), origin: "interpolated" },
      ]),
      ...RUN.pages.slice(1),
    ],
  };

  const cite = citeZone(run, {
    pageIndex: 0,
    box: { x: 0, y: 0, w: 100, h: 40 },
    lineRange: [NO_LINE_CITATION, NO_LINE_CITATION],
  });
  assert.ok(cite);
  assert.equal(cite.interpolatedLines, 0);
});

test("cropSize converts pixels at the render DPI, in cm", () => {
  assert.equal(cropSize({ x: 0, y: 0, w: 600, h: 300 }), "5,1 x 2,5 cm");
});

test("textForLineRange reads the page in line order, not array order", () => {
  const scrambled = page("p", "s", 0, [
    line(2, "third", { x: 0, y: 200, w: 10, h: 10 }),
    line(0, "first", { x: 0, y: 0, w: 10, h: 10 }),
    line(1, "second", { x: 0, y: 100, w: 10, h: 10 }),
  ]);
  assert.equal(textForLineRange(scrambled, 0, 2), "first\nsecond\nthird");
  assert.equal(textForLineRange(scrambled, NO_LINE_CITATION, 2), "");
});

/* --------------------------------------------------------------------- snap */

const LINES: Line[] = [
  line(0, "one", { x: 100, y: 100, w: 500, h: 40 }),
  // A tall block (a stamp, say) a shallow drag will not touch.
  line(1, "two", { x: 100, y: 145, w: 500, h: 300 }),
  line(2, "three", { x: 100, y: 190, w: 500, h: 40 }),
];
const PAGE = page("pg", "s1", 0, LINES);

test("normalizeBox turns a drag in any direction into a positive box", () => {
  assert.deepEqual(normalizeBox({ x: 300, y: 400 }, { x: 100, y: 200 }), {
    x: 100,
    y: 200,
    w: 200,
    h: 200,
  });
});

test("clampBox keeps a box inside the page, which is what stops cropToPng throwing", () => {
  assert.deepEqual(
    clampBox(
      { x: -50, y: -50, w: 200, h: 200 },
      { x: 0, y: 0, w: 1000, h: 2000 },
    ),
    { x: 0, y: 0, w: 150, h: 150 },
  );
});

test("linesTouchedBy measures overlap against each line's own height", () => {
  const touched = linesTouchedBy(LINES, { x: 0, y: 95, w: 1000, h: 140 });
  // Line 1 is 300px tall and only 90px of it is covered: below the 40% bar.
  assert.deepEqual(
    touched.map((l) => l.i),
    [0, 2],
  );
});

test("a snapped drag returns a contiguous range and the box that range makes", () => {
  const zone = drawZone({ x: 0, y: 95, w: 1000, h: 140 }, PAGE, true);
  assert.equal(zone.mode, "snapped");
  // Lines 0 and 2 were touched; line 1 sits between them, so the citation
  // covers it and the rectangle must too -- otherwise re-deriving the box
  // from the citation would not give these pixels back.
  assert.deepEqual(zone.lineRange, [0, 2]);
  assert.deepEqual(zone.box, { x: 88, y: 88, w: 524, h: 369 });
});

test("a snapped drag over blank paper falls back to free pixels", () => {
  const zone = drawZone({ x: 700, y: 900, w: 200, h: 200 }, PAGE, true);
  assert.equal(zone.mode, "free");
  assert.deepEqual(zone.lineRange, [NO_LINE_CITATION, NO_LINE_CITATION]);
  assert.deepEqual(zone.box, { x: 700, y: 900, w: 200, h: 200 });
});

test("a free drag cites only the lines it covers whole", () => {
  // Covers line 0 entirely and clips line 1 and 2, so only line 0 is evidence
  // this crop actually shows.
  const zone = drawZone({ x: 50, y: 90, w: 900, h: 80 }, PAGE, false);
  assert.equal(zone.mode, "free");
  assert.deepEqual(zone.lineRange, [0, 0]);
  assert.deepEqual(zone.box, { x: 50, y: 90, w: 900, h: 80 });
});

test("linesInsideBox ignores a line the box only partly covers", () => {
  assert.deepEqual(
    linesInsideBox(LINES, { x: 50, y: 90, w: 900, h: 80 }).map((l) => l.i),
    [0],
  );
});

test("a free drag is clamped to the page", () => {
  const zone = drawZone({ x: 900, y: 1900, w: 400, h: 400 }, PAGE, false);
  assert.deepEqual(zone.box, { x: 900, y: 1900, w: 100, h: 100 });
});

test("a mis-click is not a zone", () => {
  assert.equal(isMeaningfulDrag({ x: 0, y: 0, w: 4, h: 200 }), false);
  assert.equal(isMeaningfulDrag({ x: 0, y: 0, w: 200, h: 200 }), true);
});

/* -------------------------------------------------------------------- slots */

/**
 * `id` is derived from the title HERE AND ONLY HERE, because a fixture's
 * titles are made up on the spot and unique by construction. The production
 * template writes both by hand for the reason `SectionDef.id` gives: a
 * transcription gets corrected, and an id that moves with it forks every
 * stored run.
 */
function section(title: string, layout: SectionDef["layout"], slots: SectionDef["slots"]): SectionDef {
  return { id: title.toLowerCase(), title, layout, ask: { title }, slots };
}

const TEMPLATE: Template = {
  id: "TEST",
  label: "TEST",
  sections: [
    section("Evidence", "table", [
      {
        key: "one",
        label: "One",
        docType: null,
        ask: { label: "One", hint: "h" },
        fillable: true,
      },
      {
        key: "two",
        label: "Two",
        docType: null,
        ask: { label: "Two", hint: "h" },
        fillable: true,
      },
      {
        key: "manual",
        label: "Pasted by hand",
        docType: null,
        ask: { label: "Pasted by hand", hint: "h" },
        fillable: false,
      },
    ]),
  ],
  fieldRows: [],
  fieldHints: {},
};

function state(key: string, status: SlotState["status"], zoned = false): SlotState {
  return {
    key,
    label: key,
    status,
    zone: zoned
      ? { pageIndex: 0, box: { x: 0, y: 0, w: 10, h: 10 }, lineRange: [0, 0] }
      : undefined,
  };
}

/** `aggregateStatus` takes slots with their positions; the positions are moot here. */
function placed(...states: SlotState[]): PlacedSlot[] {
  return states.map((s, index) => ({ state: s, index }));
}

test("a bagian holding one confirmed capture and one open one is partial", () => {
  // NOTE WHAT CHANGED AND WHAT DID NOT. It used to take a declared `required`
  // of 2, so ONE confirmed state read `partial` because the template asserted
  // a second picture nobody had looked for. Nothing declares one now, so the
  // second state has to actually EXIST -- which, for a lanjutan, means
  // something found it. The word still means "something is still open".
  assert.equal(
    aggregateStatus(
      placed(state("two", "confirmed", true), state("two", "outstanding")),
    ),
    "partial",
  );
  assert.equal(
    aggregateStatus(
      placed(state("two", "confirmed", true), state("two", "confirmed", true)),
    ),
    "confirmed",
  );
  // One confirmed capture and nothing else is finished, not half done: no
  // second picture is owed until one is found.
  assert.equal(
    aggregateStatus(placed(state("two", "confirmed", true))),
    "confirmed",
  );
});

test("a DISCOVERED lanjutan re-opens a bagian that had gone quiet", () => {
  /*
   * THE OPERATOR'S REQUIREMENT, IN ONE ASSERTION. A lanjutan is an optional
   * row that appears when one is found, so a bagian the operator had finished
   * with must NOT stay quiet when a second picture turns up under it. It
   * arrives `proposed` and the first branch carries it, which is what puts it
   * back in front of a person, drops it out of `decided`, and blocks the
   * export until they rule on it.
   *
   * The alternative -- appending it silently -- is a picture in the signed
   * packet that nobody looked at, which is what the export gate exists for.
   */
  const settled = placed(state("two", "confirmed", true));
  assert.equal(aggregateStatus(settled), "confirmed");

  const withLanjutan = placed(
    state("two", "confirmed", true),
    state("two", "proposed", true),
  );
  assert.equal(aggregateStatus(withLanjutan), "proposed");
});

test("a proposal outranks everything: it is the thing waiting on a person", () => {
  assert.equal(
    aggregateStatus(
      placed(state("two", "confirmed", true), state("two", "proposed", true)),
    ),
    "proposed",
  );
});

test("an operator's decision to ship empty beats the search result behind it", () => {
  assert.equal(aggregateStatus(placed(state("one", "unfilled"))), "unfilled");
  assert.equal(
    aggregateStatus(placed(state("one", "outstanding"))),
    "outstanding",
  );
  // A bagian the run holds NO state for: the template declares it and nobody
  // has looked, which owes a search rather than reading as a settled blank.
  assert.equal(aggregateStatus([]), "pending");
});

test("a settled slot that ships one crop and one blank is confirmed, not empty", () => {
  /*
   * THE SLOT IS FINISHED AND IT CARRIES EVIDENCE.
   *
   * This used to report `unfilled`, because `unfilled` was tested before
   * `partial`: the label claimed a deliberate blank over a slot that was about
   * to export a picture, which is this project's failure class in miniature
   * and the kind of thing an operator cannot see is wrong.
   *
   * The fix that suggests itself, `partial` whenever any capture is confirmed,
   * is also wrong and is pinned against here. The operator has settled BOTH
   * captures; nothing is owed. Calling it "sebagian" would mean the sheet can
   * never go quiet, and the second lie is worse than the first because it is
   * invisible: nothing on screen would say why the colour never clears.
   */
  const settled = placed(
    state("two", "confirmed", true),
    state("two", "unfilled"),
  );
  assert.equal(aggregateStatus(settled), "confirmed");
  assert.notEqual(aggregateStatus(settled), "partial");

  // Both blank on purpose is the one case that really is `unfilled`.
  assert.equal(
    aggregateStatus(placed(state("two", "unfilled"), state("two", "unfilled"))),
    "unfilled",
  );
});

test("partial means something is still open, never merely part-empty", () => {
  // Confirmed beside a capture the search could not find: the operator still
  // owes that one a decision, so the slot is genuinely part done.
  assert.equal(
    aggregateStatus(
      placed(state("two", "confirmed", true), state("two", "outstanding")),
    ),
    "partial",
  );
  // Nothing confirmed and something still open is named by what is open,
  // rather than borrowing `partial`.
  assert.equal(
    aggregateStatus(placed(state("two", "outstanding"), state("two", "unfilled"))),
    "outstanding",
  );
});

test("a slot the operator has finished with counts as decided", () => {
  /*
   * The aggregate word and `progressOf`'s `decided` have to agree, because
   * `decided` is what the export screen's affirmative is built on. The bug
   * this pins is only ever visible when the two disagree: under the old rule
   * the slot below read `unfilled` (so it did count as decided) while showing
   * a confirmed crop, and under the rejected fix it would have read `partial`
   * and stopped counting, so a finished packet would never say it was ready.
   */
  // TEMPLATE's `two` needs two captures; `one` is left with no state at all,
  // so it stays `pending` and the assertions below are about `two` alone.
  const run: BrowserRun = {
    ...RUN,
    slots: [state("two", "confirmed", true), state("two", "unfilled")],
  };
  const progress = progressOf(run, TEMPLATE);
  assert.equal(progress.confirmed, 1);
  assert.equal(progress.partial, 0);
  assert.equal(progress.unfilled, 0);
  assert.equal(
    progress.decided,
    1,
    "a slot the operator has nothing left to do on must count as decided",
  );
});

test("each capture of a two-capture slot keeps its own position in the run", () => {
  // Deliberately the SAME object twice, which is what a runtime that shares a
  // template-derived state would produce. Recovering the position with
  // `indexOf` would send both captures' buttons to index 0.
  const shared = state("two", "proposed", true);
  const run: BrowserRun = { ...RUN, slots: [state("one", "pending"), shared, shared] };
  const [only] = sheetSections(run, TEMPLATE);
  const two = only.entries.find((e) => e.def.key === "two");
  assert.deepEqual(two?.states.map((s) => s.index), [1, 2]);
});

test("outstanding slots are located by identity, and by key when the runtime copies", () => {
  const a = state("one", "outstanding");
  const b = state("two", "outstanding");
  const run: BrowserRun = {
    ...RUN,
    slots: [state("two", "confirmed", true), a, b],
  };

  assert.deepEqual(outstandingIndexes(run, [a, b]), [1, 2]);

  // A runtime that returns fresh objects rather than the run's own must not
  // silently produce an empty list: the header would name three missing slots
  // and the tambahan screen would offer nothing to decide about.
  const copies = [{ ...a }, { ...b }];
  assert.deepEqual(outstandingIndexes(run, copies), [1, 2]);
});

test("sheetSections accounts for every template slot, including untouched ones", () => {
  const run: BrowserRun = { ...RUN, slots: [state("one", "proposed", true)] };
  const [only] = sheetSections(run, TEMPLATE);
  assert.deepEqual(
    only.entries.map((e) => [e.def.key, e.status]),
    [
      ["one", "proposed"],
      ["two", "pending"],
      ["manual", "pending"],
    ],
  );
});

test("Accept all covers a two-capture slot's proposals, and counts them", () => {
  /*
   * OBSERVED IN THE REAL UI, on the real bundle. The contact sheet computed
   * this as "states whose `key` is one of this section's `SlotDef.key`s". A
   * two-capture slot's states are keyed `two#1` / `two#2`, which equal no
   * `SlotDef.key`, so they were invisible to it: the button read "Accept all
   * 2 in KB (lanjutan)" over a section holding three proposals, accepted two,
   * and left `kbLanjutan.top#1` proposed -- while the section's nav badge,
   * which reads the aggregate, said 3. An operator who clicked it had every
   * reason to think the section was finished.
   */
  const run: BrowserRun = {
    ...RUN,
    slots: [
      state("one", "proposed", true),
      state("two#1", "proposed", true),
      state("two#2", "proposed", true),
    ],
  };
  const [only] = sheetSections(run, TEMPLATE);
  // Every proposal in the section, by its position in `run.slots`.
  assert.deepEqual(proposedIndexesIn(only), [0, 1, 2]);
});

test("Accept all offers only the proposals, not the decisions already made", () => {
  const run: BrowserRun = {
    ...RUN,
    slots: [
      state("one", "confirmed", true),
      state("two#1", "proposed", true),
      state("two#2", "outstanding"),
    ],
  };
  const [only] = sheetSections(run, TEMPLATE);
  assert.deepEqual(proposedIndexesIn(only), [1]);
});

test("a stored slot the template no longer declares is surfaced, not dropped", () => {
  const run: BrowserRun = {
    ...RUN,
    slots: [state("one", "confirmed", true), state("ghost", "confirmed", true)],
  };
  assert.deepEqual(
    unmatchedStates(run, TEMPLATE).map((s) => s.key),
    ["ghost"],
  );
});

test("progress counts fillable slots only, so hand-pasted cells never read as missing", () => {
  const run: BrowserRun = {
    ...RUN,
    slots: [
      state("one", "confirmed", true),
      state("two", "confirmed", true),
      state("two", "outstanding"),
    ],
  };
  const progress = progressOf(run, TEMPLATE);
  assert.equal(progress.fillable, 2);
  assert.equal(progress.confirmed, 1);
  /*
   * `two` holds one CONFIRMED capture and one that came back outstanding, and
   * this assertion moved: it used to expect `outstanding: 1, partial: 0`.
   *
   * That was the same lie as the unfilled case reaching the sheet through a
   * different branch. Reporting "tidak ditemukan" over a slot that is about to
   * export a confirmed crop tells the operator nothing was found while the
   * picture sits underneath the label. The slot is genuinely PART found, which
   * is the word `partial` exists for.
   *
   * Nothing is hidden by the change. The tambahan screen lists captures from
   * the runtime's own per-capture `outstandingSlots(run)`, not from this
   * aggregate, so that second capture still gets its terminal decision; and
   * `hasUnreviewedProposals` counts `proposed` only, so the export gate is
   * unmoved either way.
   */
  assert.equal(progress.partial, 1);
  assert.equal(progress.outstanding, 0);
  assert.equal(progress.pending, 0);
  // Still not finished: one capture owes a decision, so it is not decided.
  assert.equal(progress.decided, 1);
});

test("a capture nobody has looked PAST is counted, and never reads as finished", () => {
  // The honest half of dropping the declared capture count. The old form
  // asserted a lanjutan existed and reported "1 dari 2" for ever; a discovered
  // one can do the opposite and silently MISS one that is really there. On the
  // second sample bundle that would be 33 chances to ship a truncated clause,
  // so "the search happened" has to be recorded, not assumed.
  const unlooked: BrowserRun = {
    ...RUN,
    slots: [
      state("one", "confirmed", true),
      // Stamped with the fingerprint of the zone `state` builds, which is what
      // makes it a verdict ABOUT THAT RECTANGLE rather than about the slot.
      {
        ...state("two", "confirmed", true),
        continuationCheckedFor: zoneFingerprint(
          state("two", "confirmed", true).zone!,
        ),
      },
    ],
  };

  const [evidence] = sheetSections(unlooked, TEMPLATE);
  assert.equal(evidence.entries[0].unchecked, 1, "`one` was never checked");
  assert.equal(evidence.entries[1].unchecked, 0, "`two` was");

  const progress = progressOf(unlooked, TEMPLATE);
  assert.equal(progress.uncheckedForContinuation, 1);
  // COUNTED, NOT BLOCKED, and the pair of assertions is the point: both
  // captures were accepted by a person, so the export is not held up. A block
  // that fires whenever somebody drew an area by hand without re-running
  // Proses teaches operators that the block means nothing.
  assert.equal(progress.decided, 2);
  assert.equal(hasUnreviewedProposals(unlooked, TEMPLATE), false);

  // A capture with no evidence is not "unchecked" -- there is nothing to look
  // past. Counting it would put the warning on every bagian of a fresh run,
  // where it says nothing at all.
  const fresh: BrowserRun = { ...RUN, slots: [state("one", "pending")] };
  assert.equal(progressOf(fresh, TEMPLATE).uncheckedForContinuation, 0);
});

test("export is blocked by an unreviewed proposal, not by an accepted gap", () => {
  const reviewed: BrowserRun = {
    ...RUN,
    slots: [state("one", "confirmed", true), state("two", "unfilled")],
  };
  assert.equal(hasUnreviewedProposals(reviewed, TEMPLATE), false);

  const waiting: BrowserRun = { ...RUN, slots: [state("one", "proposed", true)] };
  assert.equal(hasUnreviewedProposals(waiting, TEMPLATE), true);
});

test("describeOutstanding names the section a missing slot belongs to", () => {
  const [first, ghost] = describeOutstanding(
    [state("two", "outstanding"), state("ghost", "outstanding")],
    TEMPLATE,
  );
  assert.equal(first.sectionTitle, "Evidence");
  assert.equal(first.def?.key, "two");
  // Operator-visible, so Bahasa like every other string that reaches a screen.
  assert.equal(ghost.sectionTitle, "Tidak ada di template ini");
  assert.equal(ghost.def, undefined);
});

test("a second capture is named a continuation, never a second field", () => {
  // THE BUG THIS PINS. The sample's ToP slot holds two pictures because ONE
  // clause runs past the bottom of its page: capture 1 is `Pasal 6 PEMBAYARAN
  // PEKERJAAN` items 1-3, capture 2 is items 4-5 of that same Pasal on the
  // next page. Labelling them "ToP 1" and "ToP 2" told an operator the
  // document holds two Terms of Payment and one was missing, and sent them
  // looking for a second clause that does not exist.
  assert.equal(captureLabel("ToP", 1), "ToP");
  assert.equal(captureLabel("ToP", 2), "ToP (lanjutan)");

  // A single-capture slot is never decorated.
  assert.equal(captureLabel("Nomor", 1), "Nomor");

  // Three or more: the first is not a continuation of anything, so the
  // numbering starts at the second and counts continuations, not captures.
  assert.equal(captureLabel("Detail", 1), "Detail");
  assert.equal(captureLabel("Detail", 2), "Detail (lanjutan)");
  assert.equal(captureLabel("Detail", 3), "Detail (lanjutan 2)");
});

test("a capture's name does not change when a LATER one is discovered", () => {
  // THE INSTABILITY THIS PINS. The label used to take the slot's capture count
  // as well, reading "(lanjutan)" at two captures and "(lanjutan 1)" at three.
  // The count came from `SlotDef.crops` then and could not move; it is read off
  // the run now and grows, so finding a third capture renamed a picture the
  // operator had already accepted. Every ordinal keeps the name it had.
  const two = [1, 2].map((ordinal) => captureLabel("ToP", ordinal));
  const three = [1, 2, 3].map((ordinal) => captureLabel("ToP", ordinal));
  assert.deepEqual(two, ["ToP", "ToP (lanjutan)"]);
  assert.deepEqual(three, ["ToP", "ToP (lanjutan)", "ToP (lanjutan 2)"]);
  assert.deepEqual(three.slice(0, 2), two);
});

/* ------------------------------------------------------------- extraction */

test("the extract request numbers pages by POSITION IN THE RUN, and names their files", () => {
  const request = buildExtractRequest(RUN);

  // The wire contract is that a page's position in the array IS its
  // run-global index, which is what `Zone.pageIndex` means everywhere else.
  // `StoredPage.index` restarts at 0 per source, so sending that instead
  // would tell the route that two different pages are both page 0.
  assert.deepEqual(
    request.pages.map((p) => p.index),
    [0, 1, 2, 3, 4],
  );

  // And the file each page came from, so a citation can name the document a
  // reviewer would open rather than a uuid. The route falls back to the
  // sourceId, which is unambiguous and unreadable.
  assert.equal(request.pages[0].sourceName, "SPLITBA_LOP999001.pdf");
  assert.equal(request.pages[4].sourceName, "LOP999001_merged.pdf");
});

test("a blank value never overwrites a cell, whatever its status says", () => {
  // THE TRAP THIS PINS. A field can arrive with an empty value under a status
  // that is not a failure -- `not-searched` for the key nothing ever searches
  // (namaProyek), and `conflict`, which ships blank on purpose with both
  // spellings recorded. Writing "" in because the status was not `cited` would
  // erase what the operator, or the filename-derived guess, already put there.
  const values = fillableValues([
    { fieldKey: "cc", value: "", status: "not-searched", confidence: "low" },
    { fieldKey: "order", value: "", status: "not-found", confidence: "low" },
    { fieldKey: "quote", value: "   ", status: "uncited", confidence: "low" },
    { fieldKey: "idEpic", value: "LOP999001", status: "cited", confidence: "high" },
  ]);

  assert.equal(values.has("cc"), false);
  assert.equal(values.has("order"), false);
  assert.equal(values.has("quote"), false, "whitespace is not a value");
  assert.equal(values.get("idEpic"), "LOP999001");
});

test("a cited field is told WHERE to look, and is not told to be careful", () => {
  // The citation is the check, and a better one than a warning: it says where
  // to look instead of saying worry. An operator warned on every filled cell
  // stops reading the warning.
  const note = noteForField({
    fieldKey: "idEpic",
    value: "LOP999001",
    status: "cited",
    confidence: "high",
    source: {
      pageIndex: 3,
      lineRange: [9, 12],
      sourceName: "LOP999001_merged.pdf",
      pageInDoc: 1,
    },
  });

  assert.equal(note.warn, false);
  assert.match(note.text, /LOP999001_merged\.pdf/);
  assert.match(note.text, /hal 2/, "pageInDoc is 0-based and printed 1-based");
  assert.match(note.text, /baris 9-12/);
  assert.doesNotMatch(note.text, /Periksa dulu/);
});

test("a citation that names no document prints no page number either", () => {
  // `sourceName` and `pageInDoc` are optional, and a page number without the
  // document it belongs to is worse than no page number: for every page after
  // the first source file the bare number points into the wrong document.
  const note = noteForField({
    fieldKey: "quote",
    value: "1-70000000001",
    status: "cited",
    confidence: "high",
    source: { pageIndex: 3, lineRange: [4, 5] },
  });

  assert.match(note.text, /baris 4-5/);
  assert.doesNotMatch(note.text, /hal/);
});

test("a capped field keeps its citation AND gains a look-first", () => {
  // Low confidence on a CITED field means the key is capped rather than the
  // citation being doubtful. namaProyek's recorded failure was a citation
  // that PASSED validation while naming the wrong document's title, so
  // validation proves the lines exist, never that the model picked right.
  const note = noteForField({
    fieldKey: "namaProyek",
    value: "PSB VPN IP KCP Contoh",
    status: "cited",
    confidence: "low",
    source: {
      pageIndex: 0,
      lineRange: [2, 3],
      sourceName: "SPLITBA_LOP999001.pdf",
      pageInDoc: 0,
    },
  });

  assert.equal(note.warn, true);
  assert.match(note.text, /SPLITBA_LOP999001\.pdf/);
  assert.match(note.text, /Periksa dulu/);
});

test("a confabulated citation is reported as one, not as a missing citation", () => {
  // `citation-invalid` and `uncited` both leave a value with no usable
  // reference and they are opposite kinds of evidence. The first means the
  // model NAMED A PLACE AND THE PLACE WAS WRONG, which is evidence about the
  // VALUE. Collapsing them hides a confabulation on the record.
  const invalid = noteForField({
    fieldKey: "cc",
    value: "BANK CONTOH NUSANTARA",
    status: "citation-invalid",
    confidence: "low",
    reason: "Sumbernya tidak cocok.",
    claimed: { pageIndex: 6, from: 3, to: 9 },
  });
  const uncited = noteForField({
    fieldKey: "cc",
    value: "BANK CONTOH NUSANTARA",
    status: "uncited",
    confidence: "low",
    reason: "Model tidak menyebut sumber.",
  });

  assert.equal(invalid.warn, true);
  assert.match(invalid.text, /hal 7/, "the claim is printed 1-based");
  assert.match(invalid.text, /baris 3-9/);
  assert.notEqual(invalid.text, uncited.text);
  assert.doesNotMatch(uncited.text, /hal/);
});

test("a conflict lists both spellings and asks the operator to choose", () => {
  // A conflict blanks the cell on purpose: shipping either candidate would be
  // a coin toss printed as evidence. What the operator needs is both.
  const note = noteForField({
    fieldKey: "cc",
    value: "",
    status: "conflict",
    confidence: "low",
    reason: "Dua dokumen menjawab berbeda.",
    conflict: ["BANK CONTOH NUSANTARA", "BANK CONTOH NUSANTARA (Persero)"],
  });

  assert.equal(note.warn, true);
  assert.match(note.text, /BANK CONTOH NUSANTARA \(Persero\)/);
  assert.match(note.text, /Pilih sendiri/);
});

test("a field nothing looked for does not read as a field that was searched", () => {
  // The pair `/api/propose` was already bitten by: reporting an unsearched
  // slot as searched sent an operator hunting for documents to fill it.
  // Neither warns, because neither is a value to distrust; both are blanks
  // the operator fills.
  const notFound = noteForField({
    fieldKey: "order",
    value: "",
    status: "not-found",
    confidence: "low",
    reason: "Sudah dicari, tidak ada di dokumen ini.",
  });
  const notSearched = noteForField({
    fieldKey: "namaProyek",
    value: "",
    status: "not-searched",
    confidence: "low",
    reason: "Tidak pernah dicari otomatis.",
  });

  assert.equal(notFound.warn, false);
  assert.equal(notSearched.warn, false);
  assert.notEqual(notFound.text, notSearched.text);
});

test("fencing a berkas retires the reading that was taken with it", () => {
  /*
   * THE DEFECT THIS PINS, traced end to end.
   *
   * The shell caches `/api/extract`'s answer so that leaving Berkas and coming
   * back does not re-bill a reading of every page in the bundle. It was keyed
   * BY RUN ID ALONE, and neither marking a berkas "Tanpa AI" nor deleting one
   * invalidated it. So: read the values, go back, fence a berkas, return, and
   * export. The docx header table then carries values mined out of that
   * berkas, each with a citation that PASSES VALIDATION and points into the
   * one document the screen promised would not be read. The packet opens fine
   * and a validator signs it.
   */
  const fields: ExtractedField[] = [
    { fieldKey: "cc", value: "BANK CONTOH NUSANTARA", status: "cited", confidence: "high" },
  ];
  const cache = { runId: RUN.id, sig: extractionSignature(RUN), fields };

  // The ordinary case, which must keep working or every visit to Berkas pays
  // for a 29-page reading again.
  assert.equal(usableExtraction(cache, RUN), fields);

  // "Tanpa AI" on the berkas the value came out of.
  const fenced: BrowserRun = {
    ...RUN,
    sources: [{ ...RUN.sources[0], ai: false }, RUN.sources[1]],
  };
  assert.notEqual(extractionSignature(fenced), extractionSignature(RUN));
  assert.equal(usableExtraction(cache, fenced), null);

  // And the berkas taken out of the order altogether.
  const removed: BrowserRun = {
    ...RUN,
    sources: [RUN.sources[1]],
    pages: RUN.pages.filter((p) => p.sourceId === "s2"),
  };
  assert.equal(usableExtraction(cache, removed), null);

  // Another order's answer was already refused, and still is.
  assert.equal(usableExtraction(cache, { ...RUN, id: "run-2" }), null);
});

test("the signature moves for the berkas set and for nothing else", () => {
  /*
   * A SIGNATURE THAT MOVES TOO EASILY IS ITS OWN DEFECT. Every change re-bills
   * a reading of every page in the bundle, and this one is asked automatically
   * with no button for an operator to not press. Pages arrive one at a time
   * across minutes of ingest, and a page arriving inside a berkas the order
   * already had cannot produce a citation into a document nobody may read --
   * which is the only thing this key exists to stop.
   */
  const before = extractionSignature(RUN);

  assert.equal(
    extractionSignature({ ...RUN, pages: RUN.pages.slice(0, 4) }),
    before,
    "a berkas still being read is not a different berkas set",
  );
  assert.equal(
    extractionSignature({ ...RUN, slots: [state("one", "confirmed", true)] }),
    before,
    "accepting a potongan says nothing about which berkas may be read",
  );
  // ABSENT MEANS DIBACA AI, which is what every order stored before the choice
  // existed means. Reading `ai` as falsy would retire the reading on every one
  // of them, and re-bill it, for a fence nobody set.
  assert.equal(
    extractionSignature({
      ...RUN,
      sources: [{ ...RUN.sources[0], ai: true }, RUN.sources[1]],
    }),
    before,
  );
});

/* ------------------------------------------------- handing documents over */

/**
 * WHAT COUNTS AS THE SAME DOCUMENT.
 *
 * An operator hands berkas over one at a time while an earlier one is still
 * being read, so the same one gets handed over twice -- and a run holding one
 * document twice is this project's failure class, not a tidiness problem: it
 * offers the model two identical candidates for every bagian, and a crop
 * confirmed on the copy becomes a picture of a different scan the moment the
 * copy is removed and the surviving zones are renumbered.
 *
 * These tests are the negative ones as much as the positive ones. Refusing a
 * document the order does NOT have is the same failure pointed the other way:
 * the bagian living in it ship `tidak ditemukan`, which an operator reads as
 * "the document does not contain it".
 */

const scan = (name: string, body: string) =>
  new File([new TextEncoder().encode(`%PDF-1.7 ${body}`)], name, {
    type: "application/pdf",
  });

test("identity is the bytes, so a renamed copy is refused", async () => {
  // The commonest way this happens: the same attachment downloaded twice.
  const held = scan("LOP999001_BUNDLE.pdf", "merged contract");
  const copy = scan("LOP999001_BUNDLE (1).pdf", "merged contract");

  const { accepted, refused } = await screenDocuments(
    [copy],
    [{ name: held.name, digest: await fileDigest(held) }],
  );

  assert.equal(accepted.length, 0);
  assert.equal(refused.length, 1);
  // The refusal has to NAME the one already held, because under a byte
  // identity the two names are routinely different and "you already have this"
  // is otherwise unanswerable.
  assert.equal(refused[0].name, "LOP999001_BUNDLE (1).pdf");
  assert.equal(refused[0].held, "LOP999001_BUNDLE.pdf");
  assert.equal(refused[0].inSameDrop, false);
});

test("two different documents sharing a name are both accepted", async () => {
  // The failure pointed the other way. `document.pdf` out of two different
  // emails is a merged contract and a SPLITBA, and refusing the second would
  // ship every bagian inside it as tidak ditemukan.
  const first = scan("document.pdf", "merged contract");
  const second = scan("document.pdf", "splitba");

  const { accepted, refused } = await screenDocuments(
    [second],
    [{ name: first.name, digest: await fileDigest(first) }],
  );

  assert.equal(refused.length, 0);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].name, "document.pdf");
});

test("the same file twice in ONE hand-over keeps the first and says so", async () => {
  const one = scan("SPLITBA_LOP999001.pdf", "splitba");
  const again = scan("SPLITBA_LOP999001.pdf", "splitba");

  const { accepted, refused } = await screenDocuments([one, again], []);

  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].file, one);
  assert.equal(refused.length, 1);
  // Which sentence the operator reads depends on this: a repeat inside one
  // drop is a slip of the hand, a repeat against the order is a document they
  // already gave minutes ago.
  assert.equal(refused[0].inSameDrop, true);
});

test("a document already QUEUED is a duplicate before it is ever stored", async () => {
  /*
   * The one the whole queue exists for. `run.sources` holds what has finished
   * ingesting; a berkas dropped four minutes ago may still be waiting its turn
   * or be the one being read right now, and neither is in storage yet.
   * Screening against storage alone accepts a duplicate of the file on screen.
   */
  const waiting = scan("EMAIL_ORDER.pdf", "email print-out");
  const same = scan("EMAIL_ORDER.pdf", "email print-out");

  const { accepted, refused } = await screenDocuments(
    [same],
    [{ name: waiting.name, digest: await fileDigest(waiting) }],
  );

  assert.equal(accepted.length, 0);
  assert.equal(refused[0].held, "EMAIL_ORDER.pdf");
});

test("a source with no digest blocks nothing", async () => {
  // Runs ingested before sources carried a digest have nothing to compare.
  // Absent means UNKNOWN, and treating unknown as a match would refuse a
  // document the order does not have -- the expensive direction.
  const fresh = scan("LOP999001_BUNDLE.pdf", "merged contract");

  const { accepted, refused } = await screenDocuments(
    [fresh],
    heldDocuments([
      { id: "src-old", name: "LOP999001_BUNDLE.pdf", pageCount: 27 },
    ]),
  );

  assert.equal(refused.length, 0);
  assert.equal(accepted.length, 1);
});

test("the digest is the plain SHA-256 of the bytes", async () => {
  // Pinned so the identity cannot quietly change shape: a different digest
  // format across a release would make every stored source unmatchable and
  // every duplicate loadable again, silently.
  const bytes = new TextEncoder().encode("%PDF-1.7 merged contract");
  const expected = Buffer.from(
    await crypto.subtle.digest("SHA-256", bytes),
  ).toString("hex");

  assert.equal(await documentDigest(bytes.buffer as ArrayBuffer), expected);
  assert.match(expected, /^[0-9a-f]{64}$/);
});

test("two hand-overs a moment apart cannot both slip into the antrean", async () => {
  /*
   * THE RACE THE SECOND SCREENING EXISTS FOR, and it is an ordinary thing to
   * do rather than an exotic one: pick the berkas with the button, then drag
   * it in as well to make sure. Hashing is asynchronous, so both hand-overs
   * are screened against an antrean neither has been added to yet and both
   * come back accepted. The shell asks again at the instant it appends, which
   * is the one moment that can see the other's result -- and it asks the same
   * function, because what "already have it" means has to be one rule.
   */
  const file = scan("SPLITBA_LOP999001.pdf", "splitba");
  const held: { name: string; digest?: string }[] = [];

  const first = await screenDocuments([file], held);
  const second = await screenDocuments([file], held);

  // Both passed, exactly as they would in the browser.
  assert.equal(first.accepted.length, 1);
  assert.equal(second.accepted.length, 1);

  // The first one appends, so by the time the second asks again the antrean
  // holds it.
  const queued = first.accepted.map((one) => ({
    name: one.name,
    digest: one.digest,
  }));
  const late = screenDigested(second.accepted, queued);

  assert.equal(late.accepted.length, 0);
  assert.equal(late.refused[0].held, "SPLITBA_LOP999001.pdf");
});

test("screening again re-reads nothing and still keeps the survivors", async () => {
  // The second pass must not be a filter that quietly drops work: a hand-over
  // with nothing racing it has to come back whole, and come back as the SAME
  // records, because the file handle in them is what the drain loop ingests.
  const a = scan("LOP999001_BUNDLE.pdf", "merged contract");
  const b = scan("SPLITBA_LOP999001.pdf", "splitba");

  const { accepted } = await screenDocuments([a, b], []);
  const again = screenDigested(accepted, []);

  assert.equal(again.refused.length, 0);
  assert.deepEqual(
    again.accepted.map((one) => one.file),
    [a, b],
  );
});

/* ------------------------------------------------ a potongan with no bagian */

/**
 * A run holding evidence under a key this template does not declare.
 *
 * That happens for one reason today -- a stored run outliving the slot list
 * that made it -- and per-order judul deletion is about to make it routine.
 * The exporter places a crop BY KEY, so such a potongan reaches no cell in the
 * docx however carefully a person accepted it.
 */
function runWithOrphan(orphanHasZone: boolean): BrowserRun {
  return {
    id: "run-orphan",
    createdAt: 0,
    overlay: emptyOverlay(AO_TEMPLATE),
    konfigurasi: emptyConfigCheck(),
    epic: emptyEpicCheck(),
    sources: [{ id: "s1", name: "LOP999001_merged.pdf", pageCount: 1 }],
    pages: [page("p0", "s1", 0)],
    slots: [
      state("one", "confirmed", true),
      state("two", "unfilled"),
      { ...state("gone", "confirmed", orphanHasZone), label: "Lampiran Harga" },
    ],
  };
}

test("a potongan with no bagian to print it in STOPS the export", () => {
  /*
   * IT USED TO BE AN ADVISORY BESIDE A LIVE BUTTON. `plan.orphans` was
   * rendered in a slab and `blockingItems` never read it, so evidence a human
   * personally accepted could fail to reach the file over a green key -- which
   * is exactly the argument `kind: "lost"` already makes, on the case
   * per-order deletion turns from rare into routine.
   */
  const plan = planExport(runWithOrphan(true), TEMPLATE);
  assert.deepEqual(
    plan.orphans.map((orphan) => orphan.key),
    ["gone"],
  );

  const items = blockingItems(plan);
  // ON ITS OWN. Everything else in the fixture is settled: one bagian ships,
  // one is unfilled on the record, and the third slot is a cell pasted in by
  // hand. So the export is held by the orphan and by nothing else.
  assert.deepEqual(
    items.map((item) => item.kind),
    ["orphan"],
  );
  assert.equal(items[0].label, "Lampiran Harga");
  // Filed under the same words the outstanding panel uses for these rows, so
  // an operator meets one name for one thing.
  assert.equal(items[0].sectionTitle, "Di luar template ini");
  assert.equal(items[0].stateIndex, -1);
});

test("an orphan carrying no potongan does not stop anything", () => {
  // The same line `CaptureLossError` draws in storage: a row a stored run kept
  // after the template stopped declaring it costs nothing to leave out, and
  // blocking on it would teach an operator that the block means nothing.
  const plan = planExport(runWithOrphan(false), TEMPLATE);
  assert.equal(plan.orphans.length, 1);
  assert.deepEqual(blockingItems(plan), []);
});

test("a bagian the search failed on is not counted as a decision the operator made", () => {
  /*
   * THE SENTENCE THIS PINS. The export screen's ready-to-go summary read
   * "n dari m bagian membawa bukti, k terbit kosong atas keputusan Anda" --
   * k ship empty BY YOUR DECISION -- and k was every fillable bagian with no
   * evidence. Most of those are bagian the SEARCH FAILED on. In this product's
   * own vocabulary `sengaja dikosongkan` means the operator decided and `tidak
   * ditemukan` means we looked and did not find it; the line fused them and
   * credited the operator with a decision they never made, on the last screen
   * anybody reads before a validator signs.
   *
   * THE MIXTURE IS WHY THIS IS COMPUTED IN `planExport` AND NOT ON THE SCREEN.
   * The obvious screen-side derivation is `plan.empty[].status`, which is only
   * `placed[0]?.state.status`: `mixed` below holds an `unfilled` capture FIRST
   * and an `outstanding` one second, so that derivation would file the whole
   * bagian under "the operator decided" and re-tell the same lie in a new
   * shape. Each count here reads every capture.
   */
  const slot = (key: string, fillable = true): SlotDef => ({
    key,
    label: key,
    docType: null,
    ask: { label: key, hint: "h" },
    fillable,
  });
  const template: Template = {
    id: "BLANKS",
    label: "BLANKS",
    sections: [
      section("Kosong", "table", [
        slot("chosen"),
        slot("missing"),
        slot("mixed"),
        slot("ships"),
      ]),
    ],
    fieldRows: [],
    fieldHints: {},
  };

  const plan = planExport(
    {
      ...RUN,
      slots: [
        state("chosen", "unfilled"),
        state("missing", "outstanding"),
        // Ordered so the FIRST capture is the operator's decision and the
        // second is the failed search. `plan.empty[].status` reads "unfilled"
        // here, which is the trap.
        state("mixed", "unfilled"),
        state("mixed#2", "outstanding"),
        state("ships", "confirmed", true),
      ],
    },
    template,
  );

  const { tally } = plan;
  assert.equal(tally.slotsBlank, 3);
  assert.equal(tally.slotsBlankByChoice, 1, "only `chosen` was decided");
  assert.equal(tally.slotsBlankNotFound, 1, "only `missing` was searched for");
  assert.equal(tally.slotsBlankOther, 1, "`mixed` is neither, and says so");
  // A partition, not three overlapping readings: the screen prints all three
  // and their sum has to be the number of bagian shipping without evidence.
  assert.equal(
    tally.slotsBlankByChoice + tally.slotsBlankNotFound + tally.slotsBlankOther,
    tally.slotsBlank,
  );

  // And the trap itself, stated as the thing not to re-derive from.
  assert.equal(plan.empty.find((e) => e.key === "mixed")?.status, "unfilled");

  // Nothing here blocks, so this is exactly the branch the summary renders in:
  // the counts are printed beside "Siap diekspor", where the fused sentence
  // was.
  assert.deepEqual(blockingItems(plan), []);
});

/* ----------------------------------------------------------------- headings */

/**
 * A form with three judul: one holding work, one whole-page, one that ships
 * blank.
 *
 * THE THIRD IS THE INTERESTING ONE. It declares no slot, so the lembar periksa
 * demotes it into the "Diisi manual" register at the BOTTOM of the screen
 * while it may sit anywhere in the packet, which is the whole reason the judul
 * controls print a packet position rather than relying on the operator seeing
 * a row move.
 */
function judulSlot(key: string, label: string, fillable = true): SlotDef {
  return {
    key,
    label,
    docType: null,
    ask: { label, hint: "h" },
    fillable,
    ...(fillable ? { pageOrdinal: 0 } : {}),
  };
}

const HEADINGS_BASE: Template = {
  id: "HEADINGS",
  label: "HEADINGS",
  sections: [
    section("Satu", "table", [judulSlot("a", "A"), judulSlot("b", "B")]),
    section("Dua", "images", [judulSlot("c", "C")]),
    section("Tiga", "table", []),
  ],
  fieldRows: [],
  fieldHints: {},
};

function headingsRun(
  overlay: TemplateOverlay = emptyOverlay(HEADINGS_BASE),
  slots: SlotState[] = [],
): BrowserRun {
  return {
    id: "run-judul",
    createdAt: 0,
    overlay,
    konfigurasi: emptyConfigCheck(),
    epic: emptyEpicCheck(),
    sources: [{ id: "s1", name: "LOP999001_merged.pdf", pageCount: 1 }],
    pages: [page("p0", "s1", 0)],
    slots,
  };
}

/** Deterministic ids, so a test can name the judul it just added. */
function minter(): () => string {
  let n = 0;
  return () => `u:mint-${(n += 1)}`;
}

test("the cost of removing a judul counts the potongan the write would drop", () => {
  const run = headingsRun(undefined, [
    state("a", "confirmed", true),
    // A LANJUTAN, keyed `<slot>#2`. Counting the TEMPLATE's slots instead of
    // the run's states would miss it entirely, and a discovered capture is
    // exactly the evidence that lives nowhere but the stored list.
    state("a#2", "proposed", true),
    state("b", "pending"),
  ]);

  const cost = sectionRemovalCost(run, "satu", HEADINGS_BASE);
  // Two zone-carriers go; `b` carries no evidence, so it costs nothing to
  // re-seed and the operator is not asked about it. That is `putRun`'s own
  // test, because it is `putRun`'s own list.
  assert.equal(cost.captures, 2);
  assert.equal(cost.confirmed, 1);
  assert.equal(cost.added, false);
  assert.equal(cost.origin, null);
});

test("the cost and the edit are one computation, not two", () => {
  /*
   * The point of `sectionRemovalCost` calling the real edit. A confirmation
   * that counted potongan its own way would agree on every ordinary judul and
   * under-report the day it stopped agreeing, on the one act that cannot be
   * undone.
   */
  const run = headingsRun(undefined, [
    state("a", "confirmed", true),
    state("a#2", "confirmed", true),
    state("a#3", "outstanding"),
    state("b", "proposed", true),
  ]);

  const { removing } = applySectionEdit(
    run,
    { tag: "remove-section", id: "satu" },
    minter(),
    HEADINGS_BASE,
  );
  assert.equal(
    sectionRemovalCost(run, "satu", HEADINGS_BASE).captures,
    removing.length,
  );
});

test("the removal carries the number the operator was shown, zero included", () => {
  /*
   * THE DEFECT THIS PINS, and it is a two-run defect: the cost the dialog reads
   * is computed against the run REACT IS HOLDING, and `editSections` applies
   * the edit to whatever is STORED. A background ingest advances the stored one
   * once per page across minutes, and discovery appends a lanjutan while it
   * goes. So a judul that held nothing when this screen drew its keys can hold
   * a confirmed potongan by the time "Hapus judul" is pressed -- and the screen
   * skips the dialog entirely, because the cost it read said zero.
   *
   * Every storage guard is satisfied by that write. The revision is current
   * (the runtime re-reads inside its own lock), every page is carried, and
   * `putRun`'s `removing` opt-in is computed from the same stored run, so
   * `CaptureLossError` is handed exactly the list it asked for and has nothing
   * to refuse. The only fact missing from the write is what the human was told
   * they were spending, which is why it now travels on the edit.
   */
  const empty = headingsRun(undefined, [state("a", "pending"), state("b", "pending")]);
  const emptyCost = sectionRemovalCost(empty, "satu", HEADINGS_BASE);

  // The no-dialog press. ZERO IS SENT, not omitted: "nobody asked me anything"
  // is precisely the agreement to lose nothing, and it is the case the whole
  // defect is about.
  assert.equal(removalNeedsDialog(emptyCost), false);
  assert.deepEqual(removeSectionEdit("satu", emptyCost), {
    tag: "remove-section",
    id: "satu",
    droppingCaptures: 0,
  });

  // The stored order, which gained two potongan while that screen was drawn.
  const stored = headingsRun(undefined, [
    state("a", "confirmed", true),
    state("a#2", "confirmed", true),
    state("b", "pending"),
  ]);
  assert.throws(
    () =>
      applySectionEdit(
        stored,
        removeSectionEdit("satu", emptyCost),
        minter(),
        HEADINGS_BASE,
      ),
    { name: "CaptureCountChangedError" },
    "a press that asked nothing may not drop potongan somebody accepted",
  );

  // And the same press made against a screen drawn from the stored order goes
  // through, dialog and all. A ceiling that refused the honest case would just
  // be a broken control.
  const honest = sectionRemovalCost(stored, "satu", HEADINGS_BASE);
  assert.equal(removalNeedsDialog(honest), true);
  assert.equal(honest.captures, 2);
  const done = applySectionEdit(
    stored,
    removeSectionEdit("satu", honest),
    minter(),
    HEADINGS_BASE,
  );
  assert.deepEqual(done.removing.slice().sort(), ["a", "a#2"]);
});

test("a judul that is already hidden costs nothing to hide again", () => {
  // `removeSection` returns the run BY IDENTITY for a tombstoned judul, so
  // there is nothing to drop and nothing to warn about. A second tab, or a
  // double click, must not raise a dialog naming potongan that already went.
  const overlay = emptyOverlay(HEADINGS_BASE);
  overlay.sections = { satu: { removed: true } };
  const cost = sectionRemovalCost(
    headingsRun(overlay, [state("a", "confirmed", true)]),
    "satu",
    HEADINGS_BASE,
  );
  assert.equal(cost.captures, 0);
  assert.equal(cost.confirmed, 0);
});

test("a judul nobody can find costs nothing rather than throwing", () => {
  // Asked while deciding how loudly to ask. Raising here would take down the
  // sheet over a question that is never put to anybody.
  const cost = sectionRemovalCost(headingsRun(), "tidak-ada", HEADINGS_BASE);
  assert.deepEqual(cost, {
    captures: 0,
    confirmed: 0,
    added: false,
    origin: null,
  });
});

test("an added judul reports who put it there, so the dialog can say so", () => {
  const { run } = applySectionEdit(
    headingsRun(),
    { tag: "add-section", title: "Lampiran Harga" },
    minter(),
    HEADINGS_BASE,
  );
  const cost = sectionRemovalCost(run, "u:mint-1", HEADINGS_BASE);
  assert.equal(cost.added, true);
  assert.equal(cost.origin, "human");
  // Its bagian is seeded `pending` with no zone, so the ONLY thing removing it
  // costs is the name, which is why an added judul asks anyway.
  assert.equal(cost.captures, 0);
});

test("the hidden list is the base minus what this order prints", () => {
  const overlay = emptyOverlay(HEADINGS_BASE);
  // Renamed FIRST and hidden after, which is what an operator does when they
  // decide a judul is not theirs. `restoreSection` keeps the title patch, so
  // the row has to offer back the name they typed and not the form's.
  overlay.sections = { dua: { title: "Kesepakatan Bersama", removed: true } };
  const run = headingsRun(overlay);

  const hidden = hiddenSections(
    run,
    resolveTemplate(HEADINGS_BASE, overlay),
    HEADINGS_BASE,
  );
  assert.deepEqual(hidden, [{ id: "dua", title: "Kesepakatan Bersama" }]);
});

test("nothing is hidden on an order nobody has edited", () => {
  assert.deepEqual(
    hiddenSections(headingsRun(), HEADINGS_BASE, HEADINGS_BASE),
    [],
  );
});

test("an added judul never appears in the hidden list", () => {
  /*
   * It is DROPPED rather than tombstoned, so there is nothing to restore and
   * `restore-section` would throw on its id. A row offering it back would be a
   * key that fails every time it is pressed.
   */
  const { run } = applySectionEdit(
    headingsRun(),
    { tag: "add-section", title: "Lampiran Harga" },
    minter(),
    HEADINGS_BASE,
  );
  const { run: without } = applySectionEdit(
    run,
    { tag: "remove-section", id: "u:mint-1" },
    minter(),
    HEADINGS_BASE,
  );
  assert.deepEqual(
    hiddenSections(
      without,
      resolveTemplate(HEADINGS_BASE, without.overlay),
      HEADINGS_BASE,
    ),
    [],
  );
});

test("the packet position is the packet's order, not the sheet's", () => {
  /*
   * `Tiga` declares no slot, so the lembar periksa draws it at the BOTTOM in
   * the "Diisi manual" register whatever the packet says. Here it is FIRST in
   * the packet: an operator pressing Naikkan on `Satu` moves it past a judul
   * that is nowhere near it on screen, and the figure is the only thing that
   * reports the move.
   */
  const overlay = emptyOverlay(HEADINGS_BASE);
  overlay.order = ["tiga", "satu", "dua"];
  const resolved = resolveTemplate(HEADINGS_BASE, overlay);

  assert.deepEqual(packetPosition(resolved, "tiga"), { at: 1, of: 3 });
  assert.deepEqual(packetPosition(resolved, "satu"), { at: 2, of: 3 });
  assert.deepEqual(packetPosition(resolved, "dua"), { at: 3, of: 3 });
  // 0, never a -1 dressed up as a position: a judul that is not in the packet
  // has no place in it.
  assert.equal(packetPosition(resolved, "tidak-ada").at, 0);
});

test("a judul the form declares and nobody renamed says nothing", () => {
  assert.deepEqual(
    provenanceOf(headingsRun(), HEADINGS_BASE.sections[0], HEADINGS_BASE),
    { kind: "declared" },
  );
});

test("a renamed judul reports what the form calls it, derived from the base", () => {
  const overlay = emptyOverlay(HEADINGS_BASE);
  overlay.sections = { satu: { title: "Kesepakatan Bersama" } };
  const resolved = resolveTemplate(HEADINGS_BASE, overlay);

  assert.deepEqual(
    provenanceOf(headingsRun(overlay), resolved.sections[0], HEADINGS_BASE),
    { kind: "renamed", wasCalled: "Satu" },
  );
});

test("an accepted usulan names the berkas it was read out of", () => {
  const overlay: TemplateOverlay = {
    ...emptyOverlay(HEADINGS_BASE),
    added: [
      {
        id: "u:llm",
        title: "Lampiran Harga",
        slots: [{ id: "u:llm-1", label: "Halaman 1" }],
        origin: "llm",
        fromSourceId: "s1",
      },
    ],
  };
  const resolved = resolveTemplate(HEADINGS_BASE, overlay);

  assert.deepEqual(
    provenanceOf(
      headingsRun(overlay),
      resolved.sections[resolved.sections.length - 1],
      HEADINGS_BASE,
    ),
    { kind: "llm", sourceName: "LOP999001_merged.pdf" },
  );

  /*
   * AND IT DOES NOT INVENT ONE WHEN THE BERKAS IS GONE. Removing a document
   * takes its pages and leaves an accepted judul behind; the heading is still
   * the model's suggestion, and WHICH document it came from is the half that
   * stopped being true. Null, so the screen drops that clause instead of
   * naming a file the order no longer holds.
   */
  const orphaned: TemplateOverlay = {
    ...overlay,
    added: [{ ...overlay.added[0], fromSourceId: "sudah-dihapus" }],
  };
  const after = resolveTemplate(HEADINGS_BASE, orphaned);
  assert.deepEqual(
    provenanceOf(
      headingsRun(orphaned),
      after.sections[after.sections.length - 1],
      HEADINGS_BASE,
    ),
    { kind: "llm", sourceName: null },
  );
});

test("a judul the operator typed is not attributed to the model", () => {
  const { run } = applySectionEdit(
    headingsRun(),
    { tag: "add-section", title: "Lampiran Harga" },
    minter(),
    HEADINGS_BASE,
  );
  const resolved = resolveTemplate(HEADINGS_BASE, run.overlay);
  assert.deepEqual(
    provenanceOf(
      run,
      resolved.sections[resolved.sections.length - 1],
      HEADINGS_BASE,
    ),
    { kind: "human" },
  );
});

/* ---------------------------------------------------------------- lanjutan */

/**
 * A berkas whose pages look like the contract this feature exists for: a body
 * of clause lines with a two-line running footer under it.
 *
 * THE FOOTER IS NOT DECORATION IN THIS FIXTURE. `runningFurniture` is what
 * tells a capture that ends where the CONTENT ends from one that stops in the
 * middle of the page, and with no repeated strip to find it would read the
 * footer itself as the last content line and decline a real lanjutan in
 * silence. The body lines carry the page's own number so they do NOT repeat,
 * which is the other half of the same test: only the footer may be furniture.
 */
function clausePage(id: string, sourceId: string, index: number): StoredPage {
  const lines: Line[] = [];
  for (let i = 0; i < 18; i++) {
    lines.push(
      line(i, `hal ${index} butir ${i} pekerjaan`, {
        x: 100,
        y: 60 + i * 90,
        w: 800,
        h: 60,
      }),
    );
  }
  // Digits are masked and collapsed before comparison, so these two lines read
  // as the same running footer on every page of the berkas.
  lines.push(
    line(18, `Halaman ${index + 1} dari 4`, {
      x: 100,
      y: 60 + 18 * 90,
      w: 800,
      h: 60,
    }),
  );
  lines.push(
    line(19, "Dokumen contoh LOP999001", {
      x: 100,
      y: 60 + 19 * 90,
      w: 800,
      h: 60,
    }),
  );
  return { id, sourceId, index, widthPx: 1000, heightPx: 2000, lines };
}

/** A drawn rectangle over lines `from..to`, the way the snapper would leave it. */
function region(pageIndex: number, from: number, to: number): Zone {
  return {
    pageIndex,
    box: { x: 88, y: 60 + from * 90 - 12, w: 824, h: (to - from) * 90 + 84 },
    lineRange: [from, to],
  };
}

/** The whole page, which is what "Ambil halaman berikutnya" arms. */
function wholePage(pageIndex: number): Zone {
  return {
    pageIndex,
    box: { x: 0, y: 0, w: 1000, h: 2000 },
    lineRange: [0, 19],
  };
}

const TOP = "kbLanjutan.top";

/**
 * Four pages of one contract scan, then one page of an unrelated one.
 *
 * The second berkas is the point of the fixture rather than filler: `pages` is
 * one flat array across every document ingested, so run-global page 4 is
 * "next" to page 3 by position and is a different document entirely.
 */
const CHAIN_RUN: BrowserRun = {
  id: "run-lanjutan",
  createdAt: 0,
  overlay: emptyOverlay(AO_TEMPLATE),
  konfigurasi: emptyConfigCheck(),
  epic: emptyEpicCheck(),
  sources: [
    { id: "s1", name: "LOP999001_merged.pdf", pageCount: 4 },
    { id: "s2", name: "SPLITBA_LOP999001.pdf", pageCount: 1 },
  ],
  pages: [
    clausePage("c0", "s1", 0),
    clausePage("c1", "s1", 1),
    clausePage("c2", "s1", 2),
    clausePage("c3", "s1", 3),
    clausePage("c4", "s2", 0),
  ],
  slots: [
    {
      key: TOP,
      label: "ToP",
      status: "confirmed",
      origin: "human",
      zone: region(0, 10, 17),
      text: "Pasal 6 PEMBAYARAN PEKERJAAN",
    },
  ],
};

test("a lanjutan is offered only on the next page OF THE SAME BERKAS", () => {
  const inside = nextPageInBerkas(CHAIN_RUN, 0);
  assert.equal(inside?.pageIndex, 1);
  // The page's own number inside its document, which is the only one a
  // reviewer can act on, and never the run-global position.
  assert.equal(inside?.pageInDoc, 1);
  assert.equal(inside?.pagesInDoc, 4);
  assert.equal(inside?.sourceName, "LOP999001_merged.pdf");

  // Run-global page 4 EXISTS and is adjacent by position. It is page 0 of a
  // separate scan, so there is no lanjutan to offer: a whole-page capture of
  // it, filed under this bagian's label, is precisely the plausible-wrong
  // evidence a validator signs.
  assert.equal(nextPageInBerkas(CHAIN_RUN, 3), null);
  // The last page of the run, and a page the run does not have at all.
  assert.equal(nextPageInBerkas(CHAIN_RUN, 4), null);
  assert.equal(nextPageInBerkas(CHAIN_RUN, 9), null);
});

test("a whole-page capture yields no lanjutan hint at all", () => {
  // Stage 0's reason, asserted rather than described: a capture that IS the
  // page ends at that page's last content line BY CONSTRUCTION, so the
  // geometric reading is a fact about the rectangle and not about the
  // document. Three of bundle one's six measured false positives were exactly
  // this, and rendering one as advice would be a new wrong-and-quiet surface
  // built by the feature meant to close one.
  assert.equal(continuationHint(CHAIN_RUN, wholePage(0)), null);

  // THE SAME LINES DRAWN AS A REGION DO PRODUCE ONE, which is what makes the
  // null above the whole-page rule rather than a hint that never fires.
  assert.equal(continuationHint(CHAIN_RUN, region(0, 10, 17)), "runs-on");
});

test("the free hint reads the page bottom, and says nothing it cannot know", () => {
  // Stops well above the last content line: the block was not cut off.
  assert.equal(continuationHint(CHAIN_RUN, region(0, 2, 5)), "stops-short");
  // Ends on the last content line, with the running footer below it.
  assert.equal(continuationHint(CHAIN_RUN, region(0, 12, 17)), "runs-on");
  // Swallowed the footer as well. It still MAY run on, and the extra thing
  // that says is about the rectangle the operator is looking at.
  assert.equal(continuationHint(CHAIN_RUN, region(0, 12, 19)), "runs-on");

  // No line citation at all, which is a signature or stamp block taken as free
  // pixels. There is no last cited line to compare against the page's, so
  // there is nothing honest to say.
  assert.equal(
    continuationHint(CHAIN_RUN, {
      pageIndex: 0,
      box: { x: 600, y: 1500, w: 300, h: 200 },
      lineRange: [NO_LINE_CITATION, NO_LINE_CITATION],
    }),
    null,
  );
});

test("taking the next page stamps the PREVIOUS potongan, never the new one", () => {
  // Nothing has looked past anything yet, which is what closing the editor
  // leaves behind and what the sheet reads as "belum diperiksa lanjutannya".
  assert.equal(continuationChecked(CHAIN_RUN.slots[0]), false);

  const { run, key, index } = withHandDrawnLink(
    CHAIN_RUN,
    TOP,
    region(1, 0, 15),
    "lanjutan Pasal 6",
  );

  // MINTED BY THE WRITE, never guessed by the screen.
  assert.equal(key, `${TOP}#2`);
  assert.equal(index, 1);

  const parent = run.slots.find((slot) => slot.key === TOP)!;
  const link = run.slots.find((slot) => slot.key === key)!;

  // Something looked past the parent and what it found is now in the run.
  assert.equal(continuationChecked(parent), true);
  // Nothing has looked past the link, which is why the editor asks the same
  // question about it immediately.
  assert.equal(continuationChecked(link), false);

  // A person drew this rectangle and is looking at it, so there is nobody left
  // to review it. Everything a SEARCH finds still arrives `proposed`.
  assert.equal(link.status, "confirmed");
  assert.equal(link.origin, "human");
  // The template's own label, undecorated: `captureLabel` adds "(lanjutan)"
  // from the ordinal at render time.
  assert.equal(link.label, "ToP");
});

test('"tidak ada lanjutan" stamps the CURRENT potongan and appends nothing', () => {
  const run = withNoContinuation(CHAIN_RUN, TOP);
  assert.equal(run.slots.length, CHAIN_RUN.slots.length);
  assert.equal(continuationChecked(run.slots[0]), true);
  assert.equal(
    run.slots[0].continuationCheckedFor,
    zoneFingerprint(CHAIN_RUN.slots[0].zone!),
  );
});

test("a refused link stamps nothing, because nothing was found past it", () => {
  // The rectangle this bagian already holds. `withDiscoveredCaptures` declines
  // it as a duplicate, and the parent must NOT come back stamped: if nothing
  // was appended then nothing was found past it either.
  const dup = withHandDrawnLink(
    CHAIN_RUN,
    TOP,
    CHAIN_RUN.slots[0].zone!,
    "sama persis",
  );
  assert.equal(dup.key, null);
  assert.equal(dup.index, null);
  // The ORIGINAL run, by identity, so no caller can accidentally persist a
  // stamp that belongs to a write that did not happen.
  assert.equal(dup.run, CHAIN_RUN);
  assert.equal(continuationChecked(dup.run.slots[0]), false);

  // Same rule one step further: a bagian the operator has put on the record as
  // sengaja dikosongkan is not re-opened by a lanjutan.
  const emptied: BrowserRun = {
    ...CHAIN_RUN,
    slots: [{ ...CHAIN_RUN.slots[0], status: "unfilled" }],
  };
  const refused = withHandDrawnLink(emptied, TOP, region(1, 0, 15), "teks");
  assert.equal(refused.key, null);
  assert.equal(continuationChecked(refused.run.slots[0]), false);
});

test("a chain of three hand-drawn links leaves every link but the last stamped", () => {
  /*
   * THE DEFECT THIS PINS IS QUADRATIC, not cosmetic. An unstamped middle link
   * makes the next reading pass walk it again and append a byte-identical
   * duplicate of every link below it. Over a ten-capture bagian that is 36
   * duplicate rows and 36 extra model calls, on one press of a button the
   * export screen itself recommends pressing.
   */
  let run = CHAIN_RUN;
  let previous = TOP;
  const keys = [previous];

  // One link per remaining page of the berkas, which is the loop the operator
  // drives with "Ambil halaman berikutnya".
  for (const pageIndex of [1, 2, 3]) {
    const step = withHandDrawnLink(
      run,
      previous,
      wholePage(pageIndex),
      `hal ${pageIndex}`,
    );
    assert.ok(step.key, `link on page ${pageIndex} was refused`);
    run = step.run;
    previous = step.key;
    keys.push(previous);
  }

  assert.deepEqual(keys, [TOP, `${TOP}#2`, `${TOP}#3`, `${TOP}#4`]);
  assert.deepEqual(
    keys.map((key) =>
      continuationChecked(run.slots.find((slot) => slot.key === key)!),
    ),
    // Every link but the last: three have been looked past, and the fourth is
    // the one the strip is still asking about. Closing the editor there stamps
    // nothing, which is true -- nobody looked.
    [true, true, true, false],
  );

  // The chain ran out of berkas rather than out of patience, and the strip
  // says so instead of offering page 0 of the SPLITBA scan.
  assert.equal(nextPageInBerkas(run, 3), null);
});

/* --------------------------------------- the outstanding block's own claims */

/**
 * THE SENTENCES AT THE HEAD OF THE LEMBAR PERIKSA, AND WHY THEY GET A SUITE.
 *
 * Nothing here crops anything or moves a zone. What these pin is a class of
 * defect this project keeps meeting in words rather than in pixels: a line that
 * reads as a finding, is false, and is believed. Five of them shipped at once
 * on this block, and every one was a claim about WHAT THE TOOL HAD DONE made by
 * code that could not know -- because `reject-proposal` records nothing, so a
 * refused usulan is byte for byte one that never existed.
 *
 * The runs below are built with the REAL edits (`record-proposals`,
 * `accept-proposal`, `reject-proposal`), so the three histories a sentence has
 * to survive are the three an operator actually produces.
 */

/** A usulan over one berkas, cited to its first page. */
function usulanFor(
  id: NodeId,
  sourceId: string,
  title: string,
  pages: number[],
): ProposedSection {
  return {
    id,
    title,
    fromSourceId: sourceId,
    fromPages: pages,
    cite: { pageIndex: pages[0], lineRange: [0, 0] },
  };
}

/**
 * `RUN`, with lines on every page.
 *
 * `accept-proposal` mints a whole-page zone per page and refuses a page with no
 * lines, so the ACCEPTED arm of these tests cannot be built on the bare
 * fixture. The text is the document's own voice and therefore fictional, per
 * the rule in AGENTS.md.
 */
function usulanRun(): BrowserRun {
  return {
    ...RUN,
    overlay: emptyOverlay(AO_TEMPLATE),
    pages: RUN.pages.map((held, at) =>
      page(held.id, held.sourceId, held.index, [
        line(0, `KESEPAKATAN BERSAMA ${at}`, { x: 0, y: 0, w: 900, h: 40 }),
      ]),
    ),
  };
}

/** The berkas the block is talking about, by id. */
function berkas(run: BrowserRun, id: string) {
  const held = berkasUsulan(run).find((entry) => entry.id === id);
  assert.ok(held, `no berkas ${id} in this order`);
  return held;
}

function record(
  run: BrowserRun,
  sourceId: string,
  sections: ProposedSection[],
): BrowserRun {
  return applySectionEdit(run, { tag: "record-proposals", sourceId, sections })
    .run;
}

test("an empty usulan list never claims the AI found nothing", () => {
  /*
   * THE DEFECT. The line read "AI tidak menemukan judul di berkas X" whenever
   * that berkas had no usulan waiting -- including on a berkas whose usulan the
   * operator had just ruled on, one at a time, seconds earlier. It reported
   * their own work back to them as a failure of the tool's, at the head of the
   * screen where they decide whether to go and fetch another document.
   *
   * All three histories below end in the same place, and TWO OF THEM ARE
   * INDISTINGUISHABLE by construction: `reject-proposal` filters the entry out
   * of `overlay.proposed` and records nothing else at all.
   */
  const asked = record(usulanRun(), "s1", []);

  const proposed = record(usulanRun(), "s1", [
    usulanFor("u:one", "s1", "BERITA ACARA SPLITTING", [0]),
    usulanFor("u:two", "s1", "LAMPIRAN", [1]),
  ]);
  const rejected = ["u:one", "u:two"].reduce(
    (run, id) => applySectionEdit(run, { tag: "reject-proposal", id }).run,
    proposed,
  );
  // ONE minter across both accepts: a fresh one per call re-issues `u:mint-1`,
  // and `accept-proposal` refuses a duplicate id rather than letting two judul
  // share one.
  const mint = minter();
  const accepted = ["u:one", "u:two"].reduce(
    (run, id) => applySectionEdit(run, { tag: "accept-proposal", id }, mint).run,
    proposed,
  );

  for (const [name, run] of [
    ["nothing was ever proposed", asked],
    ["every usulan was refused", rejected],
    ["every usulan was accepted", accepted],
  ] as const) {
    assert.equal(
      berkas(run, "s1").usulan.length,
      0,
      `${name}: the block draws its empty branch here`,
    );
  }

  // So the sentence that branch prints may not report on the search. It states
  // what is on screen instead, which is true of all three.
  assert.ok(
    !NO_USULAN_WAITING.includes("menemukan"),
    `the empty-list line claims to know what the AI found: "${NO_USULAN_WAITING}"`,
  );
  assert.ok(NO_USULAN_WAITING.includes("menunggu keputusan"));
});

test("halaman under no judul are not reported as halaman nobody proposed", () => {
  /*
   * THE SAME ROOT CAUSE ONE LEVEL DOWN. The figure counts this berkas's
   * halaman that no usulan and no accepted judul covers, and the line called
   * them "tidak diusulkan jadi judul mana pun" -- which is a statement about a
   * search. A halaman whose usulan the operator REFUSED lands in exactly this
   * count and had a judul proposed for it.
   *
   * The figure itself is right and is not what changed: rejection is not
   * recoverable, so there is nothing to subtract. What changed is the claim
   * made about it.
   */
  const proposed = record(usulanRun(), "s1", [
    usulanFor("u:one", "s1", "BERITA ACARA SPLITTING", [0]),
  ]);
  const rejected = applySectionEdit(proposed, {
    tag: "reject-proposal",
    id: "u:one",
  }).run;
  const accepted = applySectionEdit(
    proposed,
    { tag: "accept-proposal", id: "u:one" },
    minter(),
  ).run;

  // s1 holds two halaman. One is spoken for while the usulan waits.
  assert.equal(berkas(proposed, "s1").unclaimed, 1);
  // Refusing it puts that halaman straight back in the count, with no trace of
  // the usulan that named it. This is the number the old sentence lied about.
  assert.equal(berkas(rejected, "s1").unclaimed, 2);
  // Accepting it must NOT release the halaman: the figure would then grow every
  // time the operator said yes. `overlay.added` carries the claim now.
  assert.equal(berkas(accepted, "s1").unclaimed, 1);

  // The other berkas is untouched by any of it.
  assert.equal(berkas(proposed, "s2").unclaimed, 3);

  assert.ok(
    !PAGES_NOT_IN_JUDUL.includes("diusulkan"),
    "the unclaimed-halaman line still claims nobody proposed them: " +
      `"${PAGES_NOT_IN_JUDUL}"`,
  );
});

test("the search line counts the halaman a round will actually be given", () => {
  /*
   * IT COUNTED `run.pages.length`, which includes every halaman of a berkas the
   * operator fenced with "tanpa AI" -- so the sentence promised a search over
   * pages `buildProposeRequest` strips the text off before sending. Here 2 of
   * the 5 halaman belong to the fenced berkas.
   */
  const run = usulanRun();
  const fenced: BrowserRun = {
    ...run,
    sources: run.sources.map((source) =>
      source.id === "s1" ? { ...source, ai: false } : source,
    ),
  };

  assert.equal(searchablePageCount(run), 5);
  assert.equal(searchablePageCount(fenced), 3);
  assert.notEqual(searchablePageCount(fenced), fenced.pages.length);

  // AND IT AGREES WITH THE REQUEST IT DESCRIBES. Two spellings of one fence is
  // how the sentence and the round start disagreeing about which halaman were
  // read, which is exactly the thing nobody can check by looking.
  const sent = buildProposeRequest(fenced, AO_TEMPLATE).pages.filter(
    (sentPage) => sentPage.searchable !== false,
  );
  assert.equal(searchablePageCount(fenced), sent.length);

  // Every berkas fenced: the branch that must not print "bisa dicari di 0
  // halaman", and must not let the key beside it stamp `tidak ditemukan` over
  // bagian nothing read a baris of.
  const all: BrowserRun = {
    ...run,
    sources: run.sources.map((source) => ({ ...source, ai: false })),
  };
  assert.equal(searchablePageCount(all), 0);
});

test("Cari judul lagi is down on a berkas the AI may not read", () => {
  /*
   * The key ran a whole pass and answered with a sentence about a search nobody
   * performed: `discoverIds` drops a fenced berkas and NOTHING lifts that, not
   * even naming it in `again`, which is precisely what this key does. So the
   * panel disables it on `fenced` and carries the reason on the control.
   */
  const asked = record(usulanRun(), "s1", []);
  const fenced: BrowserRun = {
    ...asked,
    sources: asked.sources.map((source) =>
      source.id === "s1" ? { ...source, ai: false } : source,
    ),
  };

  assert.equal(berkas(asked, "s1").fenced, false);
  assert.equal(berkas(fenced, "s1").fenced, true);

  // The fact that makes the press useless, stated where the panel cannot get it
  // wrong: asking again for this berkas by name buys nothing.
  assert.deepEqual(discoverIds(asked, { again: ["s1"] }), ["s1", "s2"]);
  assert.deepEqual(discoverIds(fenced, { again: ["s1"] }), ["s2"]);

  // A disabled control's reason rides on the control, and it names the fence
  // in the operator's own words rather than describing a round.
  assert.ok(DISCOVER_FENCED_REASON.includes("tanpa AI"));
});

test("the vocabulary panel does not count its own entries in its label", () => {
  /*
   * It read "Arti keempat keterangan ini" over FIVE of them: `REASON_ORDER` was
   * four words long when the label was typed, `emptied` was added, and the
   * numeral stayed. The panel that explains this product's vocabulary opened by
   * miscounting the vocabulary.
   *
   * The numeral is gone rather than bumped, so this asserts the ABSENCE of any
   * of them: a count with two spellings goes stale again the next time the list
   * grows, and it has grown once already.
   */
  assert.equal(REASON_ORDER.length, 5);
  for (const numeral of [
    "kedua",
    "ketiga",
    "keempat",
    "kelima",
    "keenam",
    "empat",
    "lima",
  ]) {
    assert.ok(
      !REASON_HINT_LABEL.includes(numeral),
      `the label counts its own entries ("${numeral}"), and that count went ` +
        `stale once already: "${REASON_HINT_LABEL}"`,
    );
  }
});

/* ------------------------------------------------------ the checkpoint wire */

/** A sheet the way `read.ts` produces one: only the cells that hold something. */
function configSheet(): Sheet {
  const cells = [
    { ref: "C9", row: 9, col: 3, text: "Nama Pelanggan", kind: "text" as const },
    { ref: "E9", row: 9, col: 5, text: "BANK CONTOH NUSANTARA", kind: "text" as const },
  ];
  return {
    name: "Sheet1",
    cells,
    byRef: new Map(cells.map((cell) => [cell.ref, cell])),
    dimension: "A1:E9",
    rows: 9,
    cols: 5,
    merges: [],
  };
}

test("a Konfig Excel reading carries the run's pages, because the scans are the evidence", () => {
  const request = buildInterpretRequest(RUN, configSheet());

  assert.equal(request.pages.length, RUN.pages.length);
  assert.equal(request.compare, undefined, "absent means compare, so this is the request it always was");
  assert.equal(request.sheet?.name, "Sheet1");
  assert.equal(
    request.sheet?.cells.length,
    2,
    "byRef is a Map and does not survive JSON; the cells travel and the server rebuilds it",
  );
});

test("Input EPIC's newer-workbook reading carries NO page listing at all", () => {
  /*
   * Found by review. EPIC is judged against the workbook, so the scans are not
   * part of that question -- but the route interpreted AND compared whenever a
   * sheet was present, spending the one call that carries the whole run's OCR
   * listing and handing back verdicts this caller cannot even store. On the
   * 151-page bundle that is a multi-megabyte request body and roughly half a
   * run's model bill, for a result no code reads.
   *
   * The empty array is honest only BECAUSE of the flag beside it: an empty
   * pages list on its own would buy the same saving by telling the route this
   * order has no readable page.
   */
  const request = buildFieldsOnlyRequest(RUN, configSheet());

  assert.equal(request.compare, false, "the intent is stated, not inferred");
  assert.deepEqual(request.pages, [], "and nothing that cannot be read is sent");
  assert.equal(request.sheet?.name, "Sheet1", "the sheet is the whole question");
  assert.equal(request.runId, RUN.id);
});

test("the one re-search names its fields and asks the widened question", () => {
  const fields = [
    {
      id: "f1",
      sheet: "Sheet1",
      label: "Nama Pelanggan",
      labelRef: "C9",
      valueRef: "E9",
      excelValue: "",
    },
  ];
  const request = buildResearchRequest(RUN, fields);

  assert.equal(request.retry, true);
  assert.equal(request.sheet, undefined, "the workbook has already been interpreted");
  assert.deepEqual(request.fields, fields);
  assert.equal(
    request.pages.length,
    RUN.pages.length,
    "a re-search reads the documents, so this one does carry them",
  );
});


/* ------------------------------------------- a berkas another order holds */

/** An order as `listRuns` reports it: a name, when it was made, its berkas. */
function storedOrder(
  id: string,
  createdAt: number,
  documents: { name: string; digest?: string }[],
) {
  return {
    id,
    createdAt,
    label: documents[0]?.name ?? "(belum ada dokumen)",
    documents,
  };
}

test("a berkas another order holds is found by its BYTES, and named as THAT order calls it", () => {
  // The renamed copy out of a downloads folder is the commonest way a file
  // comes back, which is why the notice has to print both names: under a byte
  // identity they are routinely different, and printing only the new one
  // would read as the app confusing two files.
  const found = findInOtherOrders(
    [{ name: "scan (1).pdf", digest: "d-kontrak" }],
    [storedOrder("run-lama", 100, [{ name: "LOP999001_KONTRAK.pdf", digest: "d-kontrak" }])],
    "run-baru",
  );

  assert.deepEqual(found, [
    {
      name: "scan (1).pdf",
      orders: [
        {
          runId: "run-lama",
          label: "LOP999001_KONTRAK.pdf",
          createdAt: 100,
          heldAs: "LOP999001_KONTRAK.pdf",
        },
      ],
    },
  ]);
});

test("every other order holding it is listed, newest first, and the open order never", () => {
  const same = { name: "LOP999001_KONTRAK.pdf", digest: "d-kontrak" };
  const found = findInOtherOrders(
    [same],
    [
      storedOrder("run-lama", 100, [same]),
      storedOrder("run-terbuka", 300, [same]),
      storedOrder("run-baru", 200, [same]),
    ],
    "run-terbuka",
  );

  assert.deepEqual(
    found[0].orders.map((order) => order.runId),
    ["run-baru", "run-lama"],
    "newest first, and the order the operator is standing in is not another order",
  );
});

test("a berkas stored before digests existed matches nothing, rather than everything", () => {
  // Absent means UNKNOWN (see `HeldDocument`). Matching two blank digests
  // against each other would tell the operator a file was used in an order
  // that has never seen it.
  const found = findInOtherOrders(
    [{ name: "LOP999001_KONTRAK.pdf", digest: "d-kontrak" }],
    [storedOrder("run-lama", 100, [{ name: "LOP999001_KONTRAK.pdf" }])],
    null,
  );
  assert.deepEqual(found, []);
});

test("an order holding the file twice is still ONE order in the notice", () => {
  // A run from before the in-order refusal may hold one document twice, and
  // listing it twice would read as two orders.
  const same = { name: "LOP999001_KONTRAK.pdf", digest: "d-kontrak" };
  const found = findInOtherOrders(
    [same],
    [storedOrder("run-lama", 100, [same, { ...same, name: "scan (1).pdf" }])],
    null,
  );
  assert.equal(found[0].orders.length, 1);
  assert.equal(found[0].orders[0].heldAs, "LOP999001_KONTRAK.pdf", "the first copy names it");
});

test("a berkas no other order holds produces no notice, and the candidates keep their order", () => {
  const found = findInOtherOrders(
    [
      { name: "SPLITBA_LOP999001.pdf", digest: "d-splitba" },
      { name: "baru.pdf", digest: "d-baru" },
      { name: "LOP999001_KONTRAK.pdf", digest: "d-kontrak" },
    ],
    [
      storedOrder("run-a", 100, [{ name: "LOP999001_KONTRAK.pdf", digest: "d-kontrak" }]),
      storedOrder("run-b", 200, [{ name: "SPLITBA_LOP999001.pdf", digest: "d-splitba" }]),
    ],
    null,
  );
  assert.deepEqual(
    found.map((one) => one.name),
    ["SPLITBA_LOP999001.pdf", "LOP999001_KONTRAK.pdf"],
  );
});
