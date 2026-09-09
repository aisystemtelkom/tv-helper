/**
 * Tests for the CHECKPOINT 2 / CHECKPOINT 3 EDIT ENGINE:
 * `src/lib/browser/config.ts`.
 *
 * ## What is actually at risk here
 *
 * `run.konfigurasi` and `run.epic` are the ONLY place an operator's rulings
 * about the workbook exist. A `setuju` decides which cell of the file they hand
 * back to EPIC gets amended; a `tolak` is a question they have already answered
 * and must not be asked again; a `manual` is a value they TYPED, which no model
 * call and no re-search can reconstruct. Nothing re-derives any of it, and the
 * screen these live behind is eleven or twenty amber rows the operator works
 * down one at a time.
 *
 * So the failures these pin are the ones that would lose that work QUIETLY:
 *
 *   - a re-search folded in as a plain replace, wiping the ten rows the
 *     operator had already settled before they spent it and putting all ten
 *     back on the amber list -- in the one gesture whose entire purpose is to
 *     ADD to what they know;
 *   - a replacement workbook arriving at storage as a shorter entries array
 *     with no opt-in, which `DecisionLossError` refuses in front of an operator
 *     doing something entirely legitimate;
 *   - a no-op press -- the same file handed over twice, a double click, two
 *     tabs -- writing anyway, advancing the revision and refusing whatever the
 *     screen was holding for a press that changed nothing;
 *   - `Ketik sendiri` with the box emptied, which is how an operator says "this
 *     cell should be blank" and which this engine refused outright until the
 *     test below was written.
 *
 * ## NO DATABASE HERE, ON PURPOSE
 *
 * Every gesture is pure arithmetic over a run: it takes a `BrowserRun`, returns
 * the next one, and computes the opt-in the storage layer will judge it by.
 * That is exactly what makes it worth asserting with nothing in the way. The
 * write itself -- the revision race, the five nets, the round trip -- is
 * `persistence.test.mts`, which drives the real `putRun` over `fake-indexeddb`.
 *
 * The one thing both files assert is `discardedDecisions`, and that is
 * deliberate rather than duplication: the whole design of this module is that
 * it derives its opt-in by calling the very function `putRun` runs to decide
 * whether to refuse the write. Every test below that checks a `removingDecisions`
 * checks it against that function rather than against a hand-written list, so a
 * gesture that started dropping something new is named automatically instead of
 * being refused in front of an operator.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ConfigEditError,
  addEpicCapture,
  applyConfigEdit,
  applyEpicEdit,
  attachWorkbook,
  checkpointFileIds,
  decideConfig,
  decideEpic,
  markResearched,
  recordComparison,
  recordEpicComparison,
  removeEpicCapture,
  setEpicBasis,
} from "./config.ts";
import {
  CONFIG_RESEARCHED_ID,
  EPIC_BASIS_ID,
  configEntryId,
  discardedDecisions,
  epicEntryId,
} from "../storage/runs.ts";
import {
  emptyConfigCheck,
  emptyEpicCheck,
  type ConfigCitation,
  type ConfigEntry,
  type ConfigField,
  type ConfigWorkbook,
  type EpicCapture,
  type EpicEntry,
} from "../config/types.ts";
import { emptyOverlay } from "../forms/overlay.ts";
import { AO_TEMPLATE } from "../forms/template.ts";
import type { BrowserRun, SlotState } from "./types.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Labels down column C, values in column E: one of the three real layouts. */
function field(id: string, over: Partial<ConfigField> = {}): ConfigField {
  return {
    id,
    sheet: "Konfigurasi",
    label: "Nama Pelanggan",
    labelRef: "C4",
    valueRef: "E4",
    excelValue: "BANK CONTOH NUSANTARA",
    ...over,
  };
}

function entry(id: string, over: Partial<ConfigEntry> = {}): ConfigEntry {
  return {
    field: field(id),
    verdict: "cocok",
    decision: "belum",
    ...over,
  };
}

const CITE: ConfigCitation = {
  pageIndex: 2,
  from: 4,
  to: 6,
  text: "Nama Pelanggan : BANK CONTOH NUSANTARA",
};

const WORKBOOK: ConfigWorkbook = {
  id: "wb-1",
  name: "LOP999001_ORDER_Config.xlsx",
  digest: "sha256-workbook-one",
  sheets: ["Konfigurasi", "Petunjuk"],
  sheet: "Konfigurasi",
};

/**
 * The workbook the operator amended in EPIC and handed over again.
 *
 * DIFFERENT BYTES, so it is a different workbook -- which is the whole identity
 * rule `intake.ts` states for a berkas, for the same reason: a name check
 * cannot see a renamed copy out of a downloads folder, and it cannot see an
 * edited one either.
 */
const WORKBOOK_2: ConfigWorkbook = {
  ...WORKBOOK,
  id: "wb-2",
  name: "LOP999001_ORDER_Config_rev2.xlsx",
  digest: "sha256-workbook-two",
};

function capture(id: string, digest: string, name?: string): EpicCapture {
  return {
    id,
    name: name ?? `EPIC-${id}.png`,
    digest,
    width: 1440,
    height: 900,
    lines: [
      {
        i: 0,
        text: "SID 1209990001",
        box: { x: 40, y: 120, w: 400, h: 24 },
        words: [{ text: "SID", box: { x: 40, y: 120, w: 60, h: 24 } }],
      },
    ],
  };
}

function epicEntry(over: Partial<EpicEntry> = {}): EpicEntry {
  return {
    fieldId: "f1",
    label: "Nama Pelanggan",
    excelValue: "BANK CONTOH NUSANTARA",
    verdict: "cocok",
    decision: "belum",
    ...over,
  };
}

/**
 * A capture-carrying slot, so the identity assertions below mean something.
 *
 * `removing`, `removingPages` and `removingSections` are empty BY PROOF for
 * every gesture in this module -- each one passes `slots`, `pages` and
 * `overlay` through by reference, and the three guards that read them compare
 * exactly what they were given. A fixture with an empty `slots` array could not
 * tell that proof from an accident, so this one carries a zone.
 */
const CONFIRMED: SlotState = {
  key: "kb.nomor",
  label: "Nomor",
  status: "confirmed",
  origin: "human",
  text: "Nomor: 1-70000000001",
  zone: {
    pageIndex: 1,
    box: { x: 120, y: 240, w: 800, h: 90 },
    lineRange: [3, 5],
  },
};

function run(over: Partial<BrowserRun> = {}): BrowserRun {
  return {
    id: "order-checkpoint",
    createdAt: 1_700_000_000_000,
    // Not 0. A run these gestures are applied to has been through storage --
    // `editConfig` re-reads it inside the lock -- and a fixture at revision 0
    // would quietly model a run that was never stored.
    rev: 7,
    sources: [{ id: "src-a", name: "LOP999001_BUNDLE.pdf", pageCount: 2 }],
    pages: [],
    slots: [CONFIRMED],
    overlay: emptyOverlay(AO_TEMPLATE),
    konfigurasi: emptyConfigCheck(),
    epic: emptyEpicCheck(),
    ...over,
  };
}

/** An order that holds a workbook and the rulings named. */
function withEntries(entries: ConfigEntry[], researched = false): BrowserRun {
  return run({ konfigurasi: { workbook: WORKBOOK, entries, researched } });
}

/**
 * The opt-in as the GUARD sees it, which is what every assertion below compares
 * against.
 *
 * A hand-written expected list would test that the author of the test and the
 * author of the gesture agreed, which is the agreement that has never been the
 * problem. What matters is that the gesture and `putRun` agree, and this is the
 * function `putRun` runs.
 */
function lostBy(before: BrowserRun, after: BrowserRun): string[] {
  return discardedDecisions(before, after).slice().sort();
}

/** Nothing outside the two checkpoints moved. Asserted by identity. */
function assertOnlyCheckpointsMoved(before: BrowserRun, after: BrowserRun) {
  assert.equal(after.slots, before.slots, "a checkpoint edit must not touch slots");
  assert.equal(after.pages, before.pages);
  assert.equal(after.overlay, before.overlay);
  assert.equal(after.sources, before.sources);
  assert.equal(after.rev, before.rev, "the revision is storage's to advance");
}

// ---------------------------------------------------------------------------
// 1. How a decision is addressed
// ---------------------------------------------------------------------------

test("an isian and an EPIC finding cannot answer to one id", () => {
  /*
   * ONE STRING ADDRESSES ONE ROW, in the edit that writes it, in the opt-in
   * that protects it and in the refusal that names it. The two checkpoints mint
   * their ids from values this module knows nothing about -- a `ConfigField.id`
   * comes from whatever interpreted the workbook -- so the namespace has to do
   * the separating rather than a hoped-for difference between two alphabets.
   */
  const both = "f1";
  assert.notEqual(
    configEntryId(entry(both)),
    epicEntryId(epicEntry({ fieldId: both })),
  );
  // And the two sentinels are in the same two namespaces, so a Checkpoint 2
  // budget and a Checkpoint 3 answer cannot be spent on each other either.
  assert.notEqual(CONFIG_RESEARCHED_ID, EPIC_BASIS_ID);
  for (const id of [CONFIG_RESEARCHED_ID, EPIC_BASIS_ID]) {
    assert.notEqual(id, configEntryId(entry(both)));
    assert.notEqual(id, epicEntryId(epicEntry({ fieldId: both })));
  }
});

test("a finding with no field is addressed by its label, which IS the finding", () => {
  /*
   * `tidak-ada-di-excel` is EPIC showing something the workbook has no field
   * for, so there is no `ConfigField.id` to point at -- that absence is the
   * whole content of the finding. The label is the only thing left, and the
   * `f:`/`l:` split is what stops a field id and a label that read alike from
   * answering to one string.
   */
  const orphan = epicEntry({ fieldId: undefined, label: "Tanggal Instalasi" });
  assert.equal(epicEntryId(orphan), "epic/entry/l:tanggal instalasi");
  assert.notEqual(
    epicEntryId(orphan),
    epicEntryId(epicEntry({ fieldId: "Tanggal Instalasi" })),
  );
});

test("that label is a TRANSCRIPTION, so the id survives the ways it is respelled", () => {
  /*
   * Found by review, and the failure it prevents is silent. The label of a
   * `tidak-ada-di-excel` finding is read off a screen capture by the model,
   * free-form, so it is not a value anything chose. Keyed verbatim, an
   * operator's ruling was addressed by a string the NEXT comparison could
   * spell differently -- and adding a capture and comparing again is the
   * designed path, not an edge case. Under a new spelling the ruling reads as
   * a new finding rather than a missing one, so `discardedDecisions` cannot
   * refuse the loss either: it never sees one.
   */
  const id = (label: string) =>
    epicEntryId(epicEntry({ fieldId: undefined, label }));

  const spellings = [
    "Tanggal Instalasi",
    "TANGGAL INSTALASI",
    "tanggal  instalasi",
    "Tanggal Instalasi :",
    " Tanggal Instalasi",
    "Tanggal Instalasi.",
  ];
  for (const spelling of spellings) {
    assert.equal(id(spelling), id("Tanggal Instalasi"), spelling);
  }

  // And it merges nothing it should not. Two different labels stay two ids;
  // deciding that two spellings denote one thing is `abbrev.ts`'s job and its
  // scars are about how expensive an over-eager rule is there.
  assert.notEqual(id("Tanggal Instalasi"), id("Tanggal Aktivasi"));
  assert.notEqual(id("SID CPE"), id("SID HUB"));
});

// ---------------------------------------------------------------------------
// 2. Attaching a workbook
// ---------------------------------------------------------------------------

test("attaching the first workbook loses nothing and says nothing was lost", () => {
  const before = run();
  const entries = [entry("f1"), entry("f2", { field: field("f2", { valueRef: "E5" }) })];

  const result = attachWorkbook(before, WORKBOOK, entries);

  assert.equal(result.run.konfigurasi.workbook, WORKBOOK);
  assert.deepEqual(result.run.konfigurasi.entries, entries);
  assert.deepEqual(result.removingDecisions, []);
  assertOnlyCheckpointsMoved(before, result.run);
  // The array is COPIED rather than adopted: the caller's array is often the
  // model reply's own, and a run holding a reference to it would change shape
  // if anything upstream kept editing it.
  assert.notEqual(result.run.konfigurasi.entries, entries);
});

test("a replacement workbook discards every ruling about the old one, AND SAYS SO", () => {
  /*
   * THE WRITE `DecisionLossError` EXISTS FOR, and the write that must not be
   * refused. Every ruling this order holds was made about the cells of the
   * workbook being replaced -- a `setuju` on "Nama Pelanggan" in the old sheet
   * is not a `setuju` on whatever stands at that name in the new one -- so they
   * genuinely do not survive it. That is a loss a person takes with their eyes
   * open, and the opt-in is how it says so instead of being a side effect of
   * writing a shorter array.
   */
  const decided = entry("f1", { verdict: "beda", documentValue: "PSB VPN IP KCP Contoh", citation: CITE, decision: "setuju" });
  const typed = entry("f2", { decision: "manual", manualValue: "1209990001" });
  const untouched = entry("f3");
  const before = withEntries([decided, typed, untouched], true);

  const result = attachWorkbook(before, WORKBOOK_2, [entry("g1")]);

  assert.equal(result.run.konfigurasi.workbook, WORKBOOK_2);
  assert.deepEqual(
    result.run.konfigurasi.entries.map((e) => e.field.id),
    ["g1"],
  );
  // Exactly the two a person ruled on. `f3` was still at `belum`, which is not
  // a decision -- the same line `overlay.proposed` is on one level up.
  assert.deepEqual(result.removingDecisions.slice().sort(), [
    configEntryId(decided),
    configEntryId(typed),
  ]);
  assert.deepEqual(result.removingDecisions.slice().sort(), lostBy(before, result.run));
});

test("the spent re-search is carried across a replacement, so it has no bypass", () => {
  /*
   * The budget the client named is per ORDER -- "max sekali aja biar ga boros
   * token" -- not per workbook. Resetting it here would make "hand another file
   * over" the way to buy a second re-search, which is a budget with a bypass;
   * and `discardedDecisions` guards the same fact from the other side, so the
   * write would be refused rather than merely wrong.
   */
  const before = withEntries([entry("f1")], true);

  const result = attachWorkbook(before, WORKBOOK_2, [entry("g1")]);

  assert.equal(result.run.konfigurasi.researched, true);
  assert.equal(result.removingDecisions.includes(CONFIG_RESEARCHED_ID), false);
  assert.deepEqual(lostBy(before, result.run), []);
});

test("the SAME workbook again is a no-op, by bytes rather than by name", () => {
  // Identity, so the runtime skips the write entirely: re-handing over the file
  // the order already holds must not cost the operator eleven decisions, and it
  // must not advance the revision and refuse whatever the screen is holding.
  const before = withEntries([entry("f1", { decision: "setuju", verdict: "beda", documentValue: "x" })]);

  const again = attachWorkbook(before, WORKBOOK, [entry("f1")]);
  assert.equal(again.run, before, "same digest and same sheet is the same workbook");
  assert.deepEqual(again.removingDecisions, []);

  // A renamed copy out of a downloads folder is the same workbook, and a name
  // check cannot see it.
  const renamed = attachWorkbook(before, { ...WORKBOOK, name: "config (1).xlsx" }, []);
  assert.equal(renamed.run, before);

  // Reading a DIFFERENT sheet of the same file is a different interpretation,
  // so it is not a no-op: the fields come from somewhere else entirely.
  const otherSheet = attachWorkbook(before, { ...WORKBOOK, sheet: "Petunjuk" }, [entry("g1")]);
  assert.notEqual(otherSheet.run, before);
  assert.equal(otherSheet.run.konfigurasi.workbook?.sheet, "Petunjuk");
});

test("a workbook with nothing to address it by is refused", () => {
  const before = run();
  for (const broken of [
    { ...WORKBOOK, id: "" },
    { ...WORKBOOK, digest: "" },
    { ...WORKBOOK, sheet: "" },
  ]) {
    assert.throws(() => attachWorkbook(before, broken, []), ConfigEditError);
  }
});

test("two isian answering to one id are refused before they are stored", () => {
  /*
   * A duplicate means a Terima on one row silently rules on the other, and one
   * of the two can never be decided at all -- the same defect `restoreSection`
   * refuses one level up. It is caught here rather than on the screen because
   * `discardedDecisions` keys by this string too: a stored duplicate would make
   * the guard's own answers arbitrary.
   */
  const before = run();
  assert.throws(
    () => attachWorkbook(before, WORKBOOK, [entry("f1"), entry("f1")]),
    (error: unknown) => {
      assert.ok(error instanceof ConfigEditError);
      assert.match(error.message, /permanently unaddressable/);
      return true;
    },
  );

  // And an entry with no field id at all: nothing could ever address it, not a
  // decision and not the opt-in that protects one.
  assert.throws(
    () => attachWorkbook(before, WORKBOOK, [{ ...entry("f1"), field: { ...field("f1"), id: "" } }]),
    ConfigEditError,
  );
});

// ---------------------------------------------------------------------------
// 3. Folding a comparison in
// ---------------------------------------------------------------------------

test("a re-search KEEPS every decision on a field that survives it", () => {
  /*
   * THE FOLD IS THE WHOLE FUNCTION. The re-search is offered once per order and
   * the operator may well have ruled on ten rows before spending it; a plain
   * replace would wipe those ten and put them back on the amber list, so the
   * tool would appear to forget work in the gesture whose entire purpose is to
   * add to it. Matched by `ConfigField.id`, which is stable within one order.
   *
   * THE MODEL'S HALF IS OVERWRITTEN AND THE PERSON'S HALF IS KEPT, which is the
   * same line `discardedDecisions` draws.
   */
  const before = withEntries([
    entry("f1", { verdict: "tidak-ditemukan", reason: "tidak ada di berkas mana pun", decision: "tolak" }),
    entry("f2", { verdict: "beda", documentValue: "1209990001", citation: CITE, decision: "manual", manualValue: "1209990002" }),
    entry("f3"),
  ]);

  const result = recordComparison(before, [
    entry("f1", { verdict: "beda", documentValue: "PSB VPN IP KCP Contoh", citation: CITE }),
    entry("f2", { verdict: "beda", documentValue: "1209990001", citation: CITE }),
    entry("f3", { verdict: "beda", documentValue: "Budi Contoh" }),
  ]);

  const [f1, f2, f3] = result.run.konfigurasi.entries;
  // The person's half, kept.
  assert.equal(f1.decision, "tolak");
  assert.equal(f2.decision, "manual");
  assert.equal(f2.manualValue, "1209990002");
  // The model's half, replaced -- including the `reason` that is only ever
  // written on a `tidak-ditemukan`, which would otherwise sit under a verdict
  // that contradicts it.
  assert.equal(f1.verdict, "beda");
  assert.equal(f1.documentValue, "PSB VPN IP KCP Contoh");
  assert.equal(f1.reason, undefined);
  // A row nobody had ruled on is taken from the new reading wholesale.
  assert.equal(f3.decision, "belum");
  assert.equal(f3.documentValue, "Budi Contoh");

  assert.deepEqual(result.removingDecisions, []);
  assertOnlyCheckpointsMoved(before, result.run);
});

test("a re-search does NOT resurrect a ruling for a field that is gone", () => {
  /*
   * A field the new reading does not mention is dropped, and if it carried a
   * ruling that is a real loss -- named in the opt-in rather than performed in
   * silence. It happens when a replacement reading interprets the sheet
   * differently, which is a thing the operator should be told about.
   *
   * The failure this pins is the fold reaching for `held` and putting the row
   * BACK: an isian the workbook no longer has, carrying a decision, in a screen
   * whose amber count is supposed to mean "a decision is owed here".
   */
  const gone = entry("f9", { decision: "setuju", verdict: "beda", documentValue: "x" });
  const before = withEntries([entry("f1", { decision: "tolak" }), gone]);

  const result = recordComparison(before, [entry("f1", { verdict: "beda", documentValue: "y" })]);

  assert.deepEqual(
    result.run.konfigurasi.entries.map((e) => e.field.id),
    ["f1"],
  );
  assert.deepEqual(result.removingDecisions, [configEntryId(gone)]);
  assert.deepEqual(result.removingDecisions, lostBy(before, result.run));
});

test("a decision survives a verdict that no longer supports it, and stays visible", () => {
  /*
   * THE RESIDUAL, PINNED RATHER THAN HIDDEN. A second comparison can answer
   * `tidak-ditemukan` for a field the first one found, and the fold keeps the
   * operator's `setuju` because the rule is "the person's half is kept" and
   * resetting only `setuju` would be a special case more surprising than either
   * uniform rule.
   *
   * What that costs is bounded and it is on screen: `effectiveValue` resolves a
   * `setuju` carrying no recommendation to `excelValue`, so the download writes
   * NOTHING rather than emptying a cell, and the row shows "Diterima" beside
   * "tidak ditemukan" where a person can see the contradiction. The thing this
   * asserts is that the ruling is not silently dropped and not silently acted
   * on.
   */
  const before = withEntries([
    entry("f1", { verdict: "beda", documentValue: "BANK CONTOH NUSANTARA", citation: CITE, decision: "setuju" }),
  ]);

  const result = recordComparison(before, [
    entry("f1", { verdict: "tidak-ditemukan", reason: "tidak ada di berkas mana pun" }),
  ]);

  const [f1] = result.run.konfigurasi.entries;
  assert.equal(f1.decision, "setuju");
  assert.equal(f1.verdict, "tidak-ditemukan");
  assert.equal(f1.documentValue, undefined);
  assert.deepEqual(result.removingDecisions, []);
});

test("the same answer twice writes nothing at all", () => {
  /*
   * Identity through a STRUCTURAL comparison, which is the only kind that can
   * work here: every one of these shapes round-trips through IndexedDB's
   * structured clone on every read, so a reference comparison would answer "not
   * the same" every time and a second Proses that found the same twenty values
   * would advance the revision and refuse whatever the screen was holding.
   */
  const entries = [entry("f1", { verdict: "beda", documentValue: "x", citation: CITE })];
  const before = withEntries(entries);

  // A fresh array of fresh objects carrying the same data.
  const again = recordComparison(before, [
    entry("f1", { verdict: "beda", documentValue: "x", citation: { ...CITE } }),
  ]);
  assert.equal(again.run, before);

  // `undefined` and an absent key are the same, because `putRun` stores these
  // through structured clone and a caller that spread over a field it did not
  // set produces one or the other arbitrarily.
  const spread = recordComparison(before, [
    { ...entry("f1", { verdict: "beda", documentValue: "x", citation: CITE }), manualValue: undefined, reason: undefined },
  ]);
  assert.equal(spread.run, before);
});

test("verdicts about a workbook this order does not hold are refused", () => {
  assert.throws(
    () => recordComparison(run(), [entry("f1")]),
    (error: unknown) => {
      assert.ok(error instanceof ConfigEditError);
      assert.match(error.message, /holds no workbook/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 4. Deciding one isian
// ---------------------------------------------------------------------------

test("Terima writes the decision and NOTHING else", () => {
  const target = entry("f1", { verdict: "beda", documentValue: "PSB VPN IP KCP Contoh", citation: CITE });
  const before = withEntries([target, entry("f2")]);

  const result = decideConfig(before, configEntryId(target), "setuju");

  assert.equal(result.run.konfigurasi.entries[0].decision, "setuju");
  // The model's half is untouched: a decision is a decision about THIS answer,
  // and a screen that showed a different recommendation after Terima would be
  // showing the operator something they never agreed to.
  assert.equal(result.run.konfigurasi.entries[0].documentValue, "PSB VPN IP KCP Contoh");
  assert.deepEqual(result.run.konfigurasi.entries[0].citation, CITE);
  // Its neighbour is the same object: one press rules on one row.
  assert.equal(result.run.konfigurasi.entries[1], before.konfigurasi.entries[1]);
  assert.equal(result.run.konfigurasi.workbook, WORKBOOK);
  // A decision made is not a decision lost.
  assert.deepEqual(result.removingDecisions, []);
  assertOnlyCheckpointsMoved(before, result.run);
});

test('an empty "Ketik sendiri" is an instruction to CLEAR the cell, not an absence', () => {
  /*
   * THIS FUNCTION REFUSED IT UNTIL THIS TEST WAS WRITTEN, and the refusal made
   * a documented state unreachable. `effectiveValue`
   * (`src/lib/config/effective.ts`) takes `manualValue` "THE EMPTY STRING
   * INCLUDED. Clearing a cell the workbook filled is a real instruction and a
   * reachable one: EPIC's template carries fields a particular order does not
   * use, and `""` is how an operator says so." This is the only gesture that
   * can write a manual decision, so while it refused a blank the operator could
   * type over a wrong value but never take one out -- and `tolak`, keep what the
   * workbook says, is the opposite instruction rather than a way to spell it.
   */
  const target = entry("f1", { verdict: "beda", documentValue: "1209990001", citation: CITE });
  const before = withEntries([target]);

  const cleared = decideConfig(before, configEntryId(target), "manual", "");

  assert.equal(cleared.run.konfigurasi.entries[0].decision, "manual");
  assert.equal(cleared.run.konfigurasi.entries[0].manualValue, "");
  // PRESENT, not merely falsy. `discardedDecisions` refuses a `manual` carried
  // back with `manualValue === undefined`, so a cleared cell stored as an
  // absent key would be read as a value the operator typed and then lost.
  assert.equal("manualValue" in cleared.run.konfigurasi.entries[0], true);
  assert.deepEqual(lostBy(before, cleared.run), []);

  // Pressed again with the same empty box: nothing to write.
  assert.equal(decideConfig(cleared.run, configEntryId(target), "manual", "").run, cleared.run);
});

test('a "manual" carrying nothing at all is a caller that dropped the field', () => {
  const target = entry("f1");
  const before = withEntries([target]);

  assert.throws(
    () => decideConfig(before, configEntryId(target), "manual"),
    (error: unknown) => {
      assert.ok(error instanceof ConfigEditError);
      assert.match(error.message, /carries nothing at all/);
      return true;
    },
  );

  // And the mirror: a value passed with a decision that has no room for one
  // would survive on the entry and be patched into the workbook as a value the
  // operator never typed.
  for (const decision of ["setuju", "tolak", "belum"] as const) {
    assert.throws(
      () => decideConfig(before, configEntryId(target), decision, "1209990001"),
      ConfigEditError,
    );
  }
  assert.throws(
    () => decideConfig(before, configEntryId(target), "sepakat" as never),
    ConfigEditError,
  );
});

test("changing a typed value to Tolak throws it away, and names it", () => {
  /*
   * DROPPED AND REVERTED ARE ONE SHAPE, one level down from where
   * `discardedAuthorship` says it about a heading. The entry IS the ruling:
   * there is no copy of a typed value anywhere else, so a `tolak` written over
   * a `manual` really does discard what the operator typed. It is allowed --
   * changing your mind is ordinary work -- and it says so, because the opt-in
   * is computed by asking the guard rather than by assuming.
   */
  const target = entry("f1", { decision: "manual", manualValue: "1209990001" });
  const before = withEntries([target]);

  const result = decideConfig(before, configEntryId(target), "tolak");

  assert.equal(result.run.konfigurasi.entries[0].decision, "tolak");
  // REMOVED rather than left behind: a stale `manualValue` under a `tolak`
  // reads to `effectiveValue` as a value the operator typed.
  assert.equal("manualValue" in result.run.konfigurasi.entries[0], false);
  assert.deepEqual(result.removingDecisions, [configEntryId(target)]);
  assert.deepEqual(result.removingDecisions, lostBy(before, result.run));
});

test("un-deciding a row is possible and is never silent", () => {
  const target = entry("f1", { decision: "setuju", verdict: "beda", documentValue: "x" });
  const before = withEntries([target]);

  const result = decideConfig(before, configEntryId(target), "belum");

  assert.equal(result.run.konfigurasi.entries[0].decision, "belum");
  assert.deepEqual(result.removingDecisions, [configEntryId(target)]);
});

test("the same press twice returns the run BY IDENTITY", () => {
  // A double click, or two tabs. Writing anyway would advance the revision and
  // refuse whatever the screen is holding, for a press that did nothing.
  const target = entry("f1", { decision: "tolak" });
  const before = withEntries([target]);
  assert.equal(decideConfig(before, configEntryId(target), "tolak").run, before);
});

test("deciding an isian this order does not hold is refused, in a developer's words", () => {
  const before = withEntries([entry("f1")]);
  assert.throws(
    () => decideConfig(before, "konfigurasi/entry/f-gone", "tolak"),
    (error: unknown) => {
      assert.ok(error instanceof ConfigEditError);
      // The sentence names the cause the next person will actually have hit: a
      // replacement workbook re-mints every field id, so a decision composed
      // against the previous one addresses nothing.
      assert.match(error.message, /re-mints every field id/);
      return true;
    },
  );

  // The bare `ConfigField.id` is NOT the entry id. One spelling addresses one
  // row here, in the opt-in that protects it and in the refusal that names it.
  assert.throws(() => decideConfig(before, "f1", "tolak"), ConfigEditError);
});

// ---------------------------------------------------------------------------
// 5. The one re-search
// ---------------------------------------------------------------------------

test("marking the re-search spent is idempotent and one-way", () => {
  /*
   * ONE-WAY BY CONSTRUCTION, not by convention: `ConfigEdit` has no
   * `mark-unresearched` tag, so there is nothing to call. What this pins is the
   * other half -- that spending it twice writes nothing, so the budget cannot
   * be refunded by a second press either.
   */
  const before = withEntries([entry("f1", { decision: "tolak" })]);

  const spent = markResearched(before);
  assert.equal(spent.run.konfigurasi.researched, true);
  assert.deepEqual(spent.removingDecisions, []);
  // Nothing else moved: the budget is one boolean.
  assert.deepEqual(spent.run.konfigurasi.entries, before.konfigurasi.entries);
  assert.equal(spent.run.konfigurasi.workbook, WORKBOOK);
  assertOnlyCheckpointsMoved(before, spent.run);

  assert.equal(markResearched(spent.run).run, spent.run, "already spent");
});

// ---------------------------------------------------------------------------
// 6. Checkpoint 3: which workbook EPIC is judged against
// ---------------------------------------------------------------------------

test("answering lanjutkan sets the basis and keeps the captures", () => {
  const held = capture("cap-1", "sha256-cap-one");
  const before = run({ epic: { ...emptyEpicCheck(), captures: [held] } });

  const result = setEpicBasis(before, "lanjutkan");

  assert.equal(result.run.epic.basis, "lanjutkan");
  assert.deepEqual(result.run.epic.fields, []);
  assert.equal("workbook" in result.run.epic, false, "a workbook belongs to baru alone");
  // A tangkapan layar is a picture of EPIC, and which workbook it is compared
  // against does not change what it shows.
  assert.deepEqual(result.run.epic.captures, [held]);
  assert.deepEqual(result.removingDecisions, []);
  assertOnlyCheckpointsMoved(before, result.run);
});

test("answering baru stores the newer workbook and its fields", () => {
  const before = run();
  const fields = [field("g1"), field("g2", { valueRef: "E5" })];

  const result = setEpicBasis(before, "baru", WORKBOOK_2, fields);

  assert.equal(result.run.epic.basis, "baru");
  assert.equal(result.run.epic.workbook, WORKBOOK_2);
  assert.deepEqual(result.run.epic.fields, fields);
  assert.notEqual(result.run.epic.fields, fields, "the array is copied, not adopted");
});

test("a basis without its yardstick, and a yardstick without its basis, are both refused", () => {
  const before = run();

  // "There is a newer one" with nothing supplied leaves Checkpoint 3 with no
  // yardstick at all, and the state that means that is `belum`.
  assert.throws(() => setEpicBasis(before, "baru"), ConfigEditError);
  assert.throws(() => setEpicBasis(before, "baru", { ...WORKBOOK_2, digest: "" }), ConfigEditError);

  // Under "lanjutkan" the fields come from Checkpoint 2 with every accepted
  // edit applied (`effectiveFields`), so a second copy stored here would give
  // the order two answers that can disagree.
  assert.throws(() => setEpicBasis(before, "lanjutkan", WORKBOOK_2), ConfigEditError);
  assert.throws(() => setEpicBasis(before, "belum", undefined, [field("g1")]), ConfigEditError);
  assert.throws(() => setEpicBasis(before, "mungkin" as never), ConfigEditError);
});

test("changing the yardstick clears every finding, and names the rulings that go", () => {
  /*
   * Every entry was judged against the basis that stood when it was computed,
   * so a change of basis makes them statements about a different workbook.
   * Carrying them would be worse than losing them: a `setuju` on "EPIC shows X
   * where the sheet says Y" is meaningless once Y comes from a different sheet.
   */
  const ruled = epicEntry({ fieldId: "f1", verdict: "beda", epicValue: "1209990001", decision: "setuju" });
  const held = capture("cap-1", "sha256-cap-one");
  const before = run({
    epic: { basis: "lanjutkan", fields: [], captures: [held], entries: [ruled, epicEntry({ fieldId: "f2" })] },
  });

  const result = setEpicBasis(before, "baru", WORKBOOK_2, [field("g1")]);

  assert.deepEqual(result.run.epic.entries, []);
  assert.deepEqual(result.run.epic.captures, [held], "the captures survive");
  assert.deepEqual(result.removingDecisions, [epicEntryId(ruled)]);
  assert.deepEqual(result.removingDecisions, lostBy(before, result.run));
});

test("forgetting the answer to the question is a loss of its own", () => {
  /*
   * `belum` is not a third option the operator picks; it is the state before
   * they have been asked. A write that puts it back does not merely re-ask the
   * question: while it stands, Checkpoint 3 has no yardstick, and the repair a
   * hurried operator reaches for is "lanjutkan" -- which judges EPIC against
   * Checkpoint 2's workbook whether or not that is the one they meant.
   */
  const before = run({ epic: { ...emptyEpicCheck(), basis: "lanjutkan" } });

  const result = setEpicBasis(before, "belum");

  assert.equal(result.run.epic.basis, "belum");
  assert.deepEqual(result.removingDecisions, [EPIC_BASIS_ID]);
  assert.deepEqual(result.removingDecisions, lostBy(before, result.run));
});

test("the same answer again is a no-op, workbook and all", () => {
  const lanjut = setEpicBasis(run(), "lanjutkan").run;
  assert.equal(setEpicBasis(lanjut, "lanjutkan").run, lanjut);

  const baru = setEpicBasis(run(), "baru", WORKBOOK_2, [field("g1")]).run;
  assert.equal(setEpicBasis(baru, "baru", WORKBOOK_2, [field("g1")]).run, baru);
  // Same bytes, same sheet, different name: the same workbook.
  assert.equal(setEpicBasis(baru, "baru", { ...WORKBOOK_2, name: "rev2 (1).xlsx" }, []).run, baru);
  // Different bytes: a different yardstick, so not a no-op.
  assert.notEqual(setEpicBasis(baru, "baru", { ...WORKBOOK_2, digest: "sha256-three" }, []).run, baru);
});

// ---------------------------------------------------------------------------
// 7. Tangkapan layar EPIC
// ---------------------------------------------------------------------------

test("a capture is appended and no finding is re-opened by it", () => {
  /*
   * A new capture may well hold the value a field was `tidak-ditemukan` for,
   * but clearing the verdicts here would discard every ruling on every
   * screenshot added -- so the operator runs the comparison again, and
   * `record-comparison` folds the fresh answers in while keeping what they
   * already settled.
   */
  const ruled = epicEntry({ decision: "tolak" });
  const first = capture("cap-1", "sha256-cap-one");
  const before = run({ epic: { basis: "lanjutkan", fields: [], captures: [first], entries: [ruled] } });

  const result = addEpicCapture(before, capture("cap-2", "sha256-cap-two"));

  assert.deepEqual(
    result.run.epic.captures.map((c) => c.id),
    ["cap-1", "cap-2"],
  );
  assert.equal(result.run.epic.entries, before.epic.entries);
  assert.deepEqual(result.removingDecisions, []);
  assertOnlyCheckpointsMoved(before, result.run);
});

test("a second copy of one screen is refused, and the same one again is not", () => {
  /*
   * The operator screenshots EPIC several times, saves them into one folder and
   * hands the folder over. Two copies of one screen give the comparison two
   * identical candidates for every value, and removing the duplicate afterwards
   * takes the citation an operator was reading with it. `digest` is the bytes,
   * because a name check cannot see a renamed copy.
   *
   * THE SAME ID AGAIN IS A NO-OP RATHER THAN A REFUSAL, because that is what
   * two tabs and a double press produce and neither is a mistake worth stopping
   * the operator over.
   */
  const held = capture("cap-1", "sha256-cap-one", "Screenshot 2026-09-09.png");
  const before = run({ epic: { ...emptyEpicCheck(), captures: [held] } });

  assert.equal(addEpicCapture(before, held).run, before, "the same capture again");
  assert.equal(
    addEpicCapture(before, { ...held, name: "renamed.png" }).run,
    before,
    "same id, and the id is what the blob store is keyed by",
  );

  assert.throws(
    () => addEpicCapture(before, capture("cap-2", "sha256-cap-one", "Screenshot (1).png")),
    (error: unknown) => {
      assert.ok(error instanceof ConfigEditError);
      assert.match(error.message, /Screenshot 2026-09-09\.png/);
      return true;
    },
  );

  for (const broken of [{ ...held, id: "" }, { ...held, digest: "" }]) {
    assert.throws(() => addEpicCapture(run(), broken), ConfigEditError);
  }
});

test("removing a capture resets every finding read off it, and only those", () => {
  /*
   * `EpicCitation.captureId` names this capture; leaving the entry behind would
   * leave a verdict, a value and a "lihat" pointing at a picture the order no
   * longer has, and a ruling on that verdict would be a decision about nothing.
   * The same choice `removeSource` makes about a zone found inside a removed
   * berkas.
   */
  const doomed = epicEntry({
    fieldId: "f1",
    verdict: "beda",
    epicValue: "1209990001",
    citation: { captureId: "cap-1", from: 0, to: 0, text: "SID 1209990001" },
    decision: "setuju",
  });
  const elsewhere = epicEntry({
    fieldId: "f2",
    label: "Alamat",
    verdict: "beda",
    epicValue: "Jl. Contoh No. 1",
    citation: { captureId: "cap-2", from: 3, to: 3, text: "Jl. Contoh No. 1" },
    decision: "tolak",
  });
  const before = run({
    epic: {
      basis: "lanjutkan",
      fields: [],
      captures: [capture("cap-1", "sha256-cap-one"), capture("cap-2", "sha256-cap-two")],
      entries: [doomed, elsewhere],
    },
  });

  const result = removeEpicCapture(before, "cap-1");

  assert.deepEqual(
    result.run.epic.captures.map((c) => c.id),
    ["cap-2"],
  );
  const [reset, kept] = result.run.epic.entries;
  assert.equal(reset.verdict, "belum-diperiksa");
  assert.equal(reset.decision, "belum");
  assert.equal(reset.epicValue, undefined);
  assert.equal(reset.citation, undefined);
  assert.equal(reset.reason, undefined);
  // The name and the workbook's own value stay: those are what the row IS, and
  // they did not come off the picture.
  assert.equal(reset.label, "Nama Pelanggan");
  assert.equal(reset.excelValue, "BANK CONTOH NUSANTARA");
  // A finding read off a DIFFERENT capture is untouched, decision included.
  assert.equal(kept, elsewhere);

  assert.deepEqual(result.removingDecisions, [epicEntryId(doomed)]);
  assert.deepEqual(result.removingDecisions, lostBy(before, result.run));

  // Two tabs removing the same capture must not make the second an error, and
  // an order that never held it is the same case.
  assert.equal(removeEpicCapture(result.run, "cap-1").run, result.run);
  const empty = run();
  assert.equal(removeEpicCapture(empty, "cap-1").run, empty);
});

// ---------------------------------------------------------------------------
// 8. Folding EPIC's answers in
// ---------------------------------------------------------------------------

test("an EPIC comparison keeps decisions, matched by field AND by label", () => {
  const byField = epicEntry({ fieldId: "f1", decision: "tolak" });
  const byLabel = epicEntry({
    fieldId: undefined,
    label: "Tanggal Instalasi",
    excelValue: "",
    verdict: "tidak-ada-di-excel",
    epicValue: "2026-09-09",
    decision: "manual",
    manualValue: "9 September 2026",
  });
  const before = run({
    epic: { basis: "lanjutkan", fields: [], captures: [], entries: [byField, byLabel] },
  });

  const result = recordEpicComparison(before, [
    epicEntry({ fieldId: "f1", verdict: "beda", epicValue: "BANK CONTOH" }),
    epicEntry({ fieldId: undefined, label: "Tanggal Instalasi", excelValue: "", verdict: "tidak-ada-di-excel", epicValue: "2026-09-10" }),
    epicEntry({ fieldId: "f3", label: "SID" }),
  ]);

  const [f1, orphan, fresh] = result.run.epic.entries;
  assert.equal(f1.decision, "tolak");
  assert.equal(f1.epicValue, "BANK CONTOH", "the model's half is replaced");
  // A finding with no field is matched by the only thing it has.
  assert.equal(orphan.decision, "manual");
  assert.equal(orphan.manualValue, "9 September 2026");
  assert.equal(fresh.decision, "belum");
  assert.deepEqual(result.removingDecisions, []);
  assertOnlyCheckpointsMoved(before, result.run);
});

test("EPIC verdicts before the question is answered are about nothing", () => {
  assert.throws(
    () => recordEpicComparison(run(), [epicEntry()]),
    (error: unknown) => {
      assert.ok(error instanceof ConfigEditError);
      assert.match(error.message, /basis/);
      return true;
    },
  );
});

test("two EPIC findings answering to one id are refused, and so is an unaddressable one", () => {
  const before = run({ epic: { ...emptyEpicCheck(), basis: "lanjutkan" } });

  assert.throws(
    () => recordEpicComparison(before, [epicEntry({ fieldId: "f1" }), epicEntry({ fieldId: "f1", label: "Lain" })]),
    ConfigEditError,
  );
  // The cost `epicEntryId` states out loud: two `tidak-ada-di-excel` findings
  // carrying the same label are one id, so they are refused here rather than
  // stored as a row that can never be decided.
  assert.throws(
    () =>
      recordEpicComparison(before, [
        epicEntry({ fieldId: undefined, label: "SID", verdict: "tidak-ada-di-excel" }),
        epicEntry({ fieldId: undefined, label: "SID", verdict: "tidak-ada-di-excel" }),
      ]),
    ConfigEditError,
  );
  assert.throws(
    () => recordEpicComparison(before, [epicEntry({ fieldId: undefined, label: "" })]),
    ConfigEditError,
  );

  // The same answer again writes nothing.
  const once = recordEpicComparison(before, [epicEntry({ fieldId: "f1" })]);
  assert.equal(recordEpicComparison(once.run, [epicEntry({ fieldId: "f1" })]).run, once.run);
});

test("deciding one EPIC finding follows the same four rules as an isian", () => {
  const target = epicEntry({ fieldId: "f1", verdict: "beda", epicValue: "1209990001" });
  const before = run({ epic: { basis: "lanjutkan", fields: [], captures: [], entries: [target] } });
  const id = epicEntryId(target);

  const taken = decideEpic(before, id, "setuju");
  assert.equal(taken.run.epic.entries[0].decision, "setuju");
  assert.deepEqual(taken.removingDecisions, []);
  assert.equal(decideEpic(taken.run, id, "setuju").run, taken.run, "the same press twice");

  // The empty box clears the cell here too, and it is stored as a value.
  const cleared = decideEpic(before, id, "manual", "");
  assert.equal(cleared.run.epic.entries[0].manualValue, "");
  assert.throws(() => decideEpic(before, id, "manual"), ConfigEditError);
  assert.throws(() => decideEpic(before, id, "tolak", "x"), ConfigEditError);

  assert.throws(
    () => decideEpic(before, "epic/entry/f:gone", "tolak"),
    (error: unknown) => {
      assert.ok(error instanceof ConfigEditError);
      assert.match(error.message, /change of basis clears every finding/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 9. The bytes these two checkpoints keep
// ---------------------------------------------------------------------------

test("checkpointFileIds names every blob the two checkpoints own, and nothing else", () => {
  /*
   * What this list is FOR: `editCheckpoint` compares the stored run's set
   * against the one it is about to write and deletes the difference, so a
   * replaced workbook and a removed screenshot do not sit in the blob store
   * forever counting against an origin quota a 29-page bundle already fills.
   * A missing id here is bytes nothing ever collects; an id that does not
   * belong is bytes deleted while the run still points at them.
   *
   * `BrowserRun.sources` is deliberately not consulted: a workbook is not a
   * berkas of the order, and listing it there would put it on the film strip
   * and into every search pool.
   */
  assert.deepEqual(checkpointFileIds(run()), []);

  const full = run({
    konfigurasi: { workbook: WORKBOOK, entries: [], researched: false },
    epic: {
      basis: "baru",
      workbook: WORKBOOK_2,
      fields: [],
      captures: [capture("cap-1", "sha256-cap-one"), capture("cap-2", "sha256-cap-two")],
      entries: [],
    },
  });
  assert.deepEqual(checkpointFileIds(full), ["wb-1", "wb-2", "cap-1", "cap-2"]);
});

// ---------------------------------------------------------------------------
// 10. The two dispatchers
// ---------------------------------------------------------------------------

test("every ConfigEdit tag reaches the gesture it names", () => {
  /*
   * The dispatcher is what a screen actually calls, so a tag wired to the wrong
   * gesture would be a press that did something else entirely. Compared against
   * calling each gesture directly rather than against a hand-written
   * expectation, which is what makes this a test of the WIRING.
   */
  const target = entry("f1");
  const before = withEntries([target]);
  const id = configEntryId(target);

  assert.deepEqual(
    applyConfigEdit(run(), { tag: "attach-workbook", workbook: WORKBOOK, entries: [target] }),
    attachWorkbook(run(), WORKBOOK, [target]),
  );
  assert.deepEqual(
    applyConfigEdit(before, { tag: "record-comparison", entries: [entry("f1", { verdict: "beda", documentValue: "x" })] }),
    recordComparison(before, [entry("f1", { verdict: "beda", documentValue: "x" })]),
  );
  assert.deepEqual(
    applyConfigEdit(before, { tag: "decide", entryId: id, decision: "manual", manualValue: "" }),
    decideConfig(before, id, "manual", ""),
  );
  assert.deepEqual(applyConfigEdit(before, { tag: "mark-researched" }), markResearched(before));
});

test("every EpicEdit tag reaches the gesture it names", () => {
  const target = epicEntry({ fieldId: "f1" });
  const before = run({
    epic: {
      basis: "lanjutkan",
      fields: [],
      captures: [capture("cap-1", "sha256-cap-one")],
      entries: [target],
    },
  });
  const id = epicEntryId(target);

  assert.deepEqual(
    applyEpicEdit(run(), { tag: "set-basis", basis: "baru", workbook: WORKBOOK_2, fields: [field("g1")] }),
    setEpicBasis(run(), "baru", WORKBOOK_2, [field("g1")]),
  );
  assert.deepEqual(
    applyEpicEdit(before, { tag: "add-capture", capture: capture("cap-2", "sha256-cap-two") }),
    addEpicCapture(before, capture("cap-2", "sha256-cap-two")),
  );
  assert.deepEqual(
    applyEpicEdit(before, { tag: "remove-capture", captureId: "cap-1" }),
    removeEpicCapture(before, "cap-1"),
  );
  assert.deepEqual(
    applyEpicEdit(before, { tag: "record-comparison", entries: [epicEntry({ fieldId: "f1", verdict: "beda", epicValue: "x" })] }),
    recordEpicComparison(before, [epicEntry({ fieldId: "f1", verdict: "beda", epicValue: "x" })]),
  );
  assert.deepEqual(
    applyEpicEdit(before, { tag: "decide", entryId: id, decision: "tolak" }),
    decideEpic(before, id, "tolak"),
  );
});
