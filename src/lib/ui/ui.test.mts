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

import assert from "node:assert/strict";
import test from "node:test";

import type { SectionDef, Template } from "../forms/template.ts";
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
import type { BrowserRun, SlotState, StoredPage } from "./runtime.ts";
import {
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
import {
  clampBox,
  drawZone,
  isMeaningfulDrag,
  linesInsideBox,
  linesTouchedBy,
  normalizeBox,
} from "./snap.ts";

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
  // "3" here is the mistake the xlsx exporter already had to fix once.
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

function section(title: string, layout: SectionDef["layout"], slots: SectionDef["slots"]): SectionDef {
  return { title, layout, slots };
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
        hint: "h",
        fillable: true,
      },
      {
        key: "two",
        label: "Two",
        docType: null,
        hint: "h",
        fillable: true,
        crops: 2,
      },
      {
        key: "manual",
        label: "Pasted by hand",
        docType: null,
        hint: "h",
        fillable: false,
      },
    ]),
  ],
  xlsxRows: [],
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

test("a two-capture slot holding one capture is partial, not confirmed", () => {
  assert.equal(
    aggregateStatus(placed(state("two", "confirmed", true)), 1, 2),
    "partial",
  );
  assert.equal(
    aggregateStatus(
      placed(state("two", "confirmed", true), state("two", "confirmed", true)),
      2,
      2,
    ),
    "confirmed",
  );
});

test("a proposal outranks everything: it is the thing waiting on a person", () => {
  assert.equal(
    aggregateStatus(
      placed(state("two", "confirmed", true), state("two", "proposed", true)),
      2,
      2,
    ),
    "proposed",
  );
});

test("an operator's decision to ship empty beats the search result behind it", () => {
  assert.equal(aggregateStatus(placed(state("one", "unfilled")), 0, 1), "unfilled");
  assert.equal(
    aggregateStatus(placed(state("one", "outstanding")), 0, 1),
    "outstanding",
  );
  assert.equal(aggregateStatus([], 0, 1), "pending");
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
  assert.equal(aggregateStatus(settled, 1, 2), "confirmed");
  assert.notEqual(aggregateStatus(settled, 1, 2), "partial");

  // Both blank on purpose is the one case that really is `unfilled`.
  assert.equal(
    aggregateStatus(placed(state("two", "unfilled"), state("two", "unfilled")), 0, 2),
    "unfilled",
  );
});

test("partial means something is still open, never merely part-empty", () => {
  // Confirmed beside a capture the search could not find: the operator still
  // owes that one a decision, so the slot is genuinely part done.
  assert.equal(
    aggregateStatus(
      placed(state("two", "confirmed", true), state("two", "outstanding")),
      1,
      2,
    ),
    "partial",
  );
  // Confirmed beside a capture the run has no state for at all. `found` alone
  // cannot see this: the second picture is absent, not merely unfilled.
  assert.equal(
    aggregateStatus(placed(state("two", "confirmed", true)), 1, 2),
    "partial",
  );
  // Nothing confirmed and something still open is named by what is open,
  // rather than borrowing `partial`.
  assert.equal(
    aggregateStatus(placed(state("two", "outstanding"), state("two", "unfilled")), 0, 2),
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
  assert.equal(first.def?.crops, 2);
  // Operator-visible, so Bahasa like every other string that reaches a screen.
  assert.equal(ghost.sectionTitle, "Tidak ada di template ini");
  assert.equal(ghost.def, undefined);
});
