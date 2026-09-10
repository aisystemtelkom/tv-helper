/**
 * WHAT THE DOWNLOAD WRITES, AND WHAT INPUT EPIC IS JUDGED AGAINST, must be
 * the same workbook.
 *
 * The failure this file protects is silent by construction: an `effectiveValue`
 * that read one decision wrongly would produce a patched workbook that opens
 * cleanly, an EPIC comparison confidently wrong about a cell nobody looked at,
 * and an amber count that says a finished order is finished. Every test below
 * therefore pins a RULE, decision by decision, rather than a shape.
 *
 * Pure: no IndexedDB, no model, no network. Fixtures are built by hand from the
 * fictional identifier set, never from a client workbook.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  configSummary,
  effectiveFields,
  effectiveValue,
  epicSummary,
  pendingEdits,
} from "./effective.ts";
import type {
  ConfigCheck,
  ConfigEntry,
  ConfigField,
  EpicCheck,
  EpicEntry,
} from "./types.ts";

const CUSTOMER = "BANK CONTOH NUSANTARA";

function field(over: Partial<ConfigField> = {}): ConfigField {
  return {
    id: "f-customer",
    sheet: "Sheet1",
    label: "Nama Pelanggan",
    labelRef: "C9",
    valueRef: "E9",
    excelValue: CUSTOMER,
    ...over,
  };
}

function entryOf(
  f: ConfigField,
  over: Partial<Omit<ConfigEntry, "field">> = {},
): ConfigEntry {
  return { field: f, verdict: "belum-diperiksa", decision: "belum", ...over };
}

function check(entries: ConfigEntry[], researched = false): ConfigCheck {
  return { entries, researched };
}

function epicEntry(over: Partial<EpicEntry> = {}): EpicEntry {
  return {
    fieldId: "f-customer",
    label: "Nama Pelanggan",
    excelValue: CUSTOMER,
    verdict: "belum-diperiksa",
    decision: "belum",
    ...over,
  };
}

test("setuju takes the scans' value, which is the whole content of the decision", () => {
  const entry = entryOf(field(), {
    verdict: "beda",
    documentValue: "PSB VPN IP KCP Contoh",
    decision: "setuju",
  });
  assert.equal(effectiveValue(entry), "PSB VPN IP KCP Contoh");
});

test("tolak keeps the workbook's value even though a recommendation is sitting there", () => {
  const entry = entryOf(field(), {
    verdict: "beda",
    documentValue: "PSB VPN IP KCP Contoh",
    decision: "tolak",
  });
  assert.equal(
    effectiveValue(entry),
    CUSTOMER,
    "tolak means the cell is left alone, whatever the scans said",
  );
});

test("belum keeps the workbook's value: silence is not consent", () => {
  const entry = entryOf(field(), {
    verdict: "beda",
    documentValue: "PSB VPN IP KCP Contoh",
    decision: "belum",
  });
  assert.equal(
    effectiveValue(entry),
    CUSTOMER,
    "an undecided field must read exactly as a rejected one",
  );
});

test("manual takes what the operator typed", () => {
  const entry = entryOf(field(), {
    verdict: "beda",
    documentValue: "PSB VPN IP KCP Contoh",
    decision: "manual",
    manualValue: "1209990001",
  });
  assert.equal(effectiveValue(entry), "1209990001");
});

test("manual with an empty string clears the cell, because clearing is a real instruction", () => {
  const entry = entryOf(field(), { verdict: "beda", decision: "manual", manualValue: "" });
  assert.equal(effectiveValue(entry), "");
});

test("manual with no typed value at all is still empty, never the workbook's value", () => {
  const entry = entryOf(field(), { verdict: "beda", decision: "manual" });
  assert.equal(
    effectiveValue(entry),
    "",
    "manualValue is present exactly when decision is manual; an absent one is an empty box, not a rejection",
  );
});

test("a setuju carrying no recommendation keeps the workbook's value rather than emptying the cell", () => {
  // A bug upstream, not a state to design around: `documentValue` is present
  // exactly when the verdict is `beda`. It resolves in the direction that
  // writes nothing, so a meaningless decision cannot empty a filled cell.
  const entry = entryOf(field(), { verdict: "tidak-ditemukan", decision: "setuju" });
  assert.equal(effectiveValue(entry), CUSTOMER);
});

test("pendingEdits emits the sheet and the VALUE address, never the label's", () => {
  const c = check([
    entryOf(field(), { verdict: "beda", documentValue: "PSB VPN IP KCP Contoh", decision: "setuju" }),
  ]);
  assert.deepEqual(pendingEdits(c), [
    { sheet: "Sheet1", ref: "E9", value: "PSB VPN IP KCP Contoh" },
  ]);
});

test("a decision that agrees with the workbook writes nothing", () => {
  // patchWorkbook rewrites a cell as an inline string and strips any formula
  // behind it, so a no-op edit is destructive: identical text, no formula.
  const typedItBack = entryOf(field(), {
    verdict: "beda",
    documentValue: "PSB VPN IP KCP Contoh",
    decision: "manual",
    manualValue: CUSTOMER,
  });
  const recommendationMatches = entryOf(field({ id: "f-quote", valueRef: "E10", excelValue: "1-70000000001" }), {
    verdict: "beda",
    documentValue: "1-70000000001",
    decision: "setuju",
  });

  assert.deepEqual(pendingEdits(check([typedItBack, recommendationMatches])), []);
});

test("clearing a filled cell IS an edit", () => {
  const c = check([entryOf(field(), { verdict: "beda", decision: "manual", manualValue: "" })]);
  assert.deepEqual(pendingEdits(c), [{ sheet: "Sheet1", ref: "E9", value: "" }]);
});

test("clearing an already empty cell is not an edit", () => {
  const c = check([
    entryOf(field({ excelValue: "" }), { verdict: "beda", decision: "manual", manualValue: "" }),
  ]);
  assert.deepEqual(pendingEdits(c), []);
});

test("an empty cell the scans supply a value for is an edit once it is accepted, and not before", () => {
  const empty = field({ id: "f-sid", label: "SID", labelRef: "C11", valueRef: "E11", excelValue: "" });
  const undecided = check([entryOf(empty, { verdict: "beda", documentValue: "1209990001" })]);
  assert.deepEqual(pendingEdits(undecided), [], "an undecided field is never written");

  const accepted = check([
    entryOf(empty, { verdict: "beda", documentValue: "1209990001", decision: "setuju" }),
  ]);
  assert.deepEqual(pendingEdits(accepted), [{ sheet: "Sheet1", ref: "E11", value: "1209990001" }]);
});

test("tolak and belum contribute no edits however many recommendations are standing", () => {
  const c = check([
    entryOf(field({ id: "a", valueRef: "E9" }), {
      verdict: "beda",
      documentValue: "PSB VPN IP KCP Contoh",
      decision: "tolak",
    }),
    entryOf(field({ id: "b", valueRef: "E10", excelValue: "LOP999001" }), {
      verdict: "beda",
      documentValue: "LOP999002",
      decision: "belum",
    }),
    entryOf(field({ id: "c", valueRef: "E11", excelValue: "Budi Contoh" }), { verdict: "cocok" }),
  ]);
  assert.deepEqual(pendingEdits(c), []);
});

test("two entries naming one cell are both emitted, so the patcher can refuse them out loud", () => {
  // Collapsing them here would keep one conflicting decision and record the
  // loser nowhere, in a workbook that opens cleanly. patchWorkbook's post-patch
  // verification is what says so.
  const c = check([
    entryOf(field({ id: "a", valueRef: "E9" }), {
      verdict: "beda",
      documentValue: "Budi Contoh",
      decision: "setuju",
    }),
    entryOf(field({ id: "b", labelRef: "C20", valueRef: "E9" }), {
      verdict: "beda",
      documentValue: "budi@contoh.example",
      decision: "setuju",
    }),
  ]);
  assert.deepEqual(pendingEdits(c), [
    { sheet: "Sheet1", ref: "E9", value: "Budi Contoh" },
    { sheet: "Sheet1", ref: "E9", value: "budi@contoh.example" },
  ]);
});

test("effectiveFields replaces the value and leaves the id and both addresses alone", () => {
  const c = check([
    entryOf(field(), { verdict: "beda", documentValue: "PSB VPN IP KCP Contoh", decision: "setuju" }),
    entryOf(field({ id: "f-quote", labelRef: "C10", valueRef: "E10", excelValue: "1-70000000001" }), {
      verdict: "beda",
      documentValue: "1-70000000002",
      decision: "tolak",
    }),
  ]);

  assert.deepEqual(effectiveFields(c), [
    {
      id: "f-customer",
      sheet: "Sheet1",
      label: "Nama Pelanggan",
      labelRef: "C9",
      valueRef: "E9",
      excelValue: "PSB VPN IP KCP Contoh",
    },
    {
      id: "f-quote",
      sheet: "Sheet1",
      label: "Nama Pelanggan",
      labelRef: "C10",
      valueRef: "E10",
      excelValue: "1-70000000001",
    },
  ]);
});

test("effectiveFields carries a multi-row workbook's group through untouched", () => {
  const c = check([
    entryOf(field({ group: "1209990001" }), {
      verdict: "beda",
      documentValue: "PSB VPN IP KCP Contoh",
      decision: "setuju",
    }),
  ]);
  const [first] = effectiveFields(c);
  assert.equal(first.group, "1209990001", "without the group an operator cannot tell two SIDs apart");
  assert.equal(first.excelValue, "PSB VPN IP KCP Contoh");
});

test("effectiveFields describes the same workbook pendingEdits patches", () => {
  const c = check([
    entryOf(field(), { verdict: "beda", documentValue: "Budi Contoh", decision: "setuju" }),
    entryOf(field({ id: "f-quote", valueRef: "E10", excelValue: "1-70000000001" }), {
      verdict: "beda",
      documentValue: "1-70000000002",
      decision: "belum",
    }),
  ]);

  const byRef = new Map(pendingEdits(c).map((edit) => [edit.ref, edit.value]));
  for (const f of effectiveFields(c)) {
    assert.equal(
      f.excelValue,
      byRef.get(f.valueRef) ?? c.entries.find((e) => e.field.id === f.id)?.field.excelValue,
      "Input EPIC must judge EPIC against the file the operator actually downloaded",
    );
  }
});

test("owed counts a recommendation nobody has ruled on, and only that", () => {
  const c = check([
    entryOf(field({ id: "a", valueRef: "E9" }), { verdict: "beda", documentValue: "Budi Contoh" }),
    entryOf(field({ id: "b", valueRef: "E10" }), {
      verdict: "beda",
      documentValue: "Budi Contoh",
      decision: "tolak",
    }),
    entryOf(field({ id: "c", valueRef: "E11" }), { verdict: "cocok" }),
    entryOf(field({ id: "d", valueRef: "E12" }), {
      verdict: "tidak-ditemukan",
      reason: "Tidak ada di berkas yang dibaca AI.",
    }),
    entryOf(field({ id: "e", valueRef: "E13" })),
  ]);

  const summary = configSummary(c);
  assert.equal(summary.total, 5);
  assert.equal(summary.cocok, 1);
  assert.equal(summary.belumSesuai, 2, "belumSesuai counts every beda, decided or not");
  assert.equal(summary.tidakDitemukan, 1);
  assert.equal(
    summary.owed,
    1,
    "only the undecided beda owes a decision: the amber mark means that and nothing else",
  );
});

test("a field the scans do not carry never owes a decision, however long it stands", () => {
  const c = check([
    entryOf(field({ id: "a", valueRef: "E9" }), { verdict: "tidak-ditemukan", reason: "Tidak ditemukan." }),
    entryOf(field({ id: "b", valueRef: "E10" }), { verdict: "tidak-ditemukan", reason: "Tidak ditemukan." }),
  ]);
  const summary = configSummary(c);
  assert.equal(summary.tidakDitemukan, 2);
  assert.equal(
    summary.owed,
    0,
    "an amber mark nothing can clear teaches the operator that the mark means nothing",
  );
});

test("a field nothing has compared yet is in the total and in no other count", () => {
  const summary = configSummary(check([entryOf(field())]));
  assert.equal(summary.total, 1);
  assert.equal(summary.cocok, 0);
  assert.equal(summary.belumSesuai, 0);
  assert.equal(summary.tidakDitemukan, 0);
  assert.equal(summary.owed, 0);
  assert.equal(summary.edits, 0);
});

test("edits is the number of cells the download would write, not the number of decisions taken", () => {
  const c = check([
    entryOf(field({ id: "a", valueRef: "E9" }), {
      verdict: "beda",
      documentValue: "Budi Contoh",
      decision: "setuju",
    }),
    entryOf(field({ id: "b", valueRef: "E10", excelValue: "1-70000000001" }), {
      verdict: "beda",
      documentValue: "1-70000000001",
      decision: "setuju",
    }),
    entryOf(field({ id: "c", valueRef: "E11" }), {
      verdict: "beda",
      documentValue: "Budi Contoh",
      decision: "tolak",
    }),
  ]);

  assert.equal(
    configSummary(c).edits,
    1,
    "three decisions, one cell: a screen counting decisions would promise a file it does not deliver",
  );
  assert.equal(configSummary(c).edits, pendingEdits(c).length);
});

test("the re-search is offered only while it is unspent AND something is missing", () => {
  const missing = entryOf(field({ id: "a", valueRef: "E9" }), {
    verdict: "tidak-ditemukan",
    reason: "Tidak ditemukan.",
  });
  const found = entryOf(field({ id: "b", valueRef: "E10" }), { verdict: "cocok" });

  assert.equal(configSummary(check([missing], false)).canResearch, true);
  assert.equal(
    configSummary(check([missing], true)).canResearch,
    false,
    "the budget is one per order and does not reset when the tab reloads",
  );
  assert.equal(
    configSummary(check([found], false)).canResearch,
    false,
    "offering it with nothing to search spends the order's only retry on a call that can find nothing",
  );
  assert.equal(configSummary(check([], false)).canResearch, false);
});

test("epicSummary counts EPIC's own fourth verdict, and never calls it a decision", () => {
  const c: EpicCheck = {
    basis: "lanjutkan",
    fields: [],
    captures: [],
    entries: [
      epicEntry({ verdict: "cocok" }),
      epicEntry({ fieldId: "b", verdict: "beda", epicValue: "Budi Contoh" }),
      epicEntry({ fieldId: "c", verdict: "beda", epicValue: "Budi Contoh", decision: "setuju" }),
      epicEntry({ fieldId: "d", verdict: "tidak-ditemukan", reason: "Tidak ada di tangkapan layar." }),
      epicEntry({
        fieldId: undefined,
        label: "Tanggal Aktivasi",
        excelValue: "",
        verdict: "tidak-ada-di-excel",
        epicValue: "2026-09-09",
      }),
      epicEntry({ fieldId: "f" }),
    ],
  };

  const summary = epicSummary(c);
  assert.equal(summary.total, 6);
  assert.equal(summary.cocok, 1);
  assert.equal(summary.belumSesuai, 2);
  assert.equal(summary.tidakDitemukan, 1);
  assert.equal(summary.tidakAdaDiExcel, 1);
  assert.equal(
    summary.owed,
    1,
    "a finding with no field to point at carries no cell to write, so it can owe no decision",
  );
});

test("an EPIC check nobody has begun counts nothing and owes nothing", () => {
  const summary = epicSummary({ basis: "belum", fields: [], captures: [], entries: [] });
  assert.deepEqual(summary, {
    total: 0,
    cocok: 0,
    belumSesuai: 0,
    tidakDitemukan: 0,
    tidakAdaDiExcel: 0,
    owed: 0,
  });
});
