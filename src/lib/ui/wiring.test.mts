/**
 * WHAT THE OPERATOR ACTUALLY RUNS ON, and the contract mismatches that were
 * invisible while it ran on a fake.
 *
 * The app shipped on `createStubRuntime()` for an entire track. Nothing
 * failed, because nothing checked -- the stub answered every call, invented
 * pages, and painted its own scans. These tests are the check. A reviewer
 * asked for something louder than a comment; this is it, together with the
 * production-build refusal in `stub-runtime.ts` itself.
 *
 * The mismatch tests below are not hypothetical. Every one of them was
 * reproduced against the REAL `seedSlots` before it was fixed:
 *
 *   - the ToP row rendered "not searched" for ever and both its captures fell
 *     out of the sheet as belonging to no template;
 *   - `hasUnreviewedProposals` returned FALSE with a proposal sitting
 *     unreviewed on the second capture, so the export gate opened on a zone
 *     nobody had looked at;
 *   - `planExport` planned ZERO crops for the slot with BOTH captures
 *     confirmed, and listed it as shipping empty.
 *
 * All three are the same failure: a deliverable that opens fine, looks
 * complete, and is missing evidence a human validator then signs.
 */

import { emptyConfigCheck, emptyEpicCheck } from "../config/types.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as browserRuntime from "../browser/runtime.ts";
import {
  captureOrdinalOf,
  seedSlots,
  slotKeyOf,
  withDiscoveredCaptures,
} from "../browser/runtime.ts";
import { emptyOverlay, resolveTemplate } from "../forms/overlay.ts";
import type { TemplateOverlay } from "../forms/overlay.ts";
import { AO_TEMPLATE } from "../forms/template.ts";
import { planExport } from "./export.ts";
import { liveRuntime } from "./live-runtime.ts";
import {
  applyProposals,
  buildProposeRequest,
  capturesToWalk,
  wantedKeys,
} from "./propose.ts";
import type { BrowserRun, SlotState, StoredPage } from "./runtime.ts";
import {
  describeOutstanding,
  hasUnreviewedProposals,
  sheetSections,
  unmatchedStates,
} from "./slots.ts";
import { createStubRuntime } from "./stub-runtime.ts";

/* ------------------------------------------------------------- the wiring */

test("the production runtime IS the browser runtime, not the stub", () => {
  // Identity, member by member. A `Runtime` that merely had the right shape
  // would pass a structural check and still be a fake.
  assert.equal(liveRuntime.ingestDocument, browserRuntime.ingestDocument);
  assert.equal(liveRuntime.pageBitmap, browserRuntime.pageBitmap);
  assert.equal(liveRuntime.loadRun, browserRuntime.loadRun);
  assert.equal(liveRuntime.saveRun, browserRuntime.saveRun);
  assert.equal(liveRuntime.listRuns, browserRuntime.listRuns);
  assert.equal(liveRuntime.outstandingSlots, browserRuntime.outstandingSlots);
  // The two writes that take IDS AND RE-READ INSIDE THE LOCK rather than
  // taking a run. Both exist because a screen holds a `BrowserRun` for as long
  // as the operator is looking at it, and an ingest advances the revision once
  // per page: a stub standing in for either would hide exactly the staleness
  // they were written to survive.
  assert.equal(liveRuntime.editSections, browserRuntime.editSections);
  assert.equal(liveRuntime.setDocumentAi, browserRuntime.setDocumentAi);
});

test("the operator app imports the live runtime and does not import the stub", () => {
  // `operator-app.tsx` cannot be imported here (node's type stripping does not
  // handle JSX), so its IMPORT LIST is read instead. Import specifiers only --
  // prose mentioning the stub, including the comment explaining why it is not
  // wired, must not make this pass or fail.
  const source = readFileSync(
    fileURLToPath(
      new URL("../../components/operator/operator-app.tsx", import.meta.url),
    ),
    "utf8",
  );
  const specifiers = [
    ...source.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["'];/gm),
  ].map((match) => match[1]);

  assert.ok(
    specifiers.includes("@/lib/ui/live-runtime"),
    "the production entry point must import liveRuntime",
  );
  assert.ok(
    !specifiers.some((s) => s.includes("stub-runtime")),
    "the production entry point must not import the stub runtime",
  );
});

test("the stub refuses to construct in a production build", () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  try {
    env.NODE_ENV = "production";
    assert.throws(() => createStubRuntime(), /production build/);
  } finally {
    env.NODE_ENV = previous;
  }
});

test("the stub's runs carry production's slot keys and per-source page numbers", async () => {
  // The stub used to build its own slot list, giving a two-capture slot two
  // states under the SAME key, and to number pages across the whole run. Both
  // taught every screen a convention production does not use, and both were
  // invisible while the app ran on the stub.
  const stub = createStubRuntime();
  const [summary] = await stub.listRuns();
  const run = await stub.loadRun(summary.id);
  assert.ok(run);

  const keys = run.slots.map((s) => s.key);
  // Capture 1 is the template key VERBATIM -- nothing declares a second any
  // more -- and the stub DISCOVERS a lanjutan the way a real round does, so
  // the multi-capture screens are driven in `pnpm dev` without the sheet
  // asserting a picture nobody has looked for.
  assert.ok(keys.includes("kbLanjutan.top"));
  assert.ok(keys.includes("kbLanjutan.top#2"));
  for (const key of keys) {
    assert.ok(
      captureOrdinalOf(key) === 1 || key.includes("#"),
      `${key} must carry its ordinal in the key or be capture 1`,
    );
  }

  // The second document restarts at 0, exactly as a real ingest numbers it,
  // so `StoredPage.index` collides across sources the way it does in
  // production.
  const second = run.pages.filter((p) => p.sourceId === run.pages[4].sourceId);
  assert.deepEqual(
    second.map((p) => p.index),
    [0, 1, 2],
  );

  // And a zone the stub proposes indexes `run.pages`, not the source.
  for (const slot of run.slots) {
    if (!slot.zone) continue;
    assert.ok(
      slot.zone.pageIndex < run.pages.length,
      "a proposed zone must cite a position in run.pages",
    );
  }
});

/* ------------------------------------------- the multi-capture key mismatch */

/**
 * A run seeded exactly as the real runtime seeds one.
 *
 * TWO PAGES, because a lanjutan lives on the page AFTER its parent's: a run
 * holding one page can carry no continuation at all, and `planExport` would
 * drop the crop as citing a page the run does not have.
 */
function seededRun(
  slots: SlotState[] = seedSlots(AO_TEMPLATE),
  overlay: TemplateOverlay = emptyOverlay(AO_TEMPLATE),
): BrowserRun {
  const pages: StoredPage[] = [0, 1].map((index) => ({
    id: `p${index}`,
    sourceId: "s0",
    index,
    widthPx: 2480,
    heightPx: 3507,
    lines: [],
  }));
  return {
    id: "run",
    createdAt: 0,
    sources: [{ id: "s0", name: "LOP999001_merged.pdf", pageCount: pages.length }],
    pages,
    slots,
    // Nobody has renamed anything on this order by default. Required rather
    // than optional: `metaOf` lists a run's small half field by field so that
    // tsc names anything new, and an optional field walks straight past that.
    overlay,
    konfigurasi: emptyConfigCheck(),
    epic: emptyEpicCheck(),
  };
}

const ZONE = {
  pageIndex: 0,
  box: { x: 10, y: 10, w: 100, h: 50 },
  lineRange: [0, 1] as [number, number],
};

/**
 * Where a lanjutan actually lands: the NEXT page, its own lines.
 *
 * A distinct rectangle rather than a copy of `ZONE`, because
 * `withDiscoveredCaptures` now refuses to append a zone the slot already
 * holds -- a repeated answer is a second row carrying the same picture, which
 * is the operator's original complaint on evidence that is already in the
 * packet.
 */
const LANJUTAN_ZONE = {
  pageIndex: 1,
  box: { x: 10, y: 10, w: 100, h: 90 },
  lineRange: [0, 3] as [number, number],
};

/**
 * A run whose ToP capture holds evidence and has grown one DISCOVERED
 * lanjutan, built through production's own append.
 *
 * The second state used to come from `seedSlots` reading `SlotDef.crops: 2`.
 * It comes from a discovery now, which is the whole change -- but every
 * BEHAVIOUR below is still required, because a discovered capture renders,
 * gates and exports exactly like a declared one did. What changed is where it
 * comes from, not what it has to do.
 */
function runWithLanjutan(status: "proposed" | "confirmed"): BrowserRun {
  const seeded = seedSlots(AO_TEMPLATE).map((slot) =>
    slot.key === "kbLanjutan.top"
      ? { ...slot, status: "confirmed" as const, zone: ZONE }
      : slot,
  );
  const grown = withDiscoveredCaptures(seededRun(seeded), [
    { after: "kbLanjutan.top", zone: LANJUTAN_ZONE, text: "sambungan pasal" },
  ]);
  return {
    ...grown,
    slots: grown.slots.map((slot) =>
      slot.key === "kbLanjutan.top#2" ? { ...slot, status } : slot,
    ),
  };
}

test("a discovered lanjutan is grouped under the template slot it continues", () => {
  const run = runWithLanjutan("proposed");
  const entries = sheetSections(run, AO_TEMPLATE)
    .flatMap((section) => section.entries)
    .filter((entry) => entry.def.key === "kbLanjutan.top");

  assert.equal(entries.length, 1);
  // Both captures, matched to the slot. Grouping on the raw `<key>#n` string
  // matched nothing and rendered the row as an untouched slot for ever.
  assert.equal(entries[0].states.length, 2);
  assert.equal(entries[0].maxOrdinal, 2);
  assert.deepEqual(unmatchedStates(run, AO_TEMPLATE), []);

  // A bagian nothing has grown reports one capture, not a second that is
  // owed: that assertion is the operator report this feature comes from.
  const untouched = sheetSections(seededRun(), AO_TEMPLATE)
    .flatMap((section) => section.entries)
    .find((entry) => entry.def.key === "kbLanjutan.top");
  assert.equal(untouched?.states.length, 1);
  assert.equal(untouched?.maxOrdinal, 1);
});

test("an unreviewed proposal on a DISCOVERED lanjutan still blocks the export", () => {
  // This returned false. The design forbids exporting an unreviewed zone
  // outright, and the gate was open on exactly the capture most likely to be
  // missed -- which is now also the capture that appears without warning
  // under a bagian the operator had already finished with.
  assert.equal(
    hasUnreviewedProposals(runWithLanjutan("proposed"), AO_TEMPLATE),
    true,
  );
});

test("both confirmed captures of a grown slot reach the export plan", () => {
  const plan = planExport(runWithLanjutan("confirmed"), AO_TEMPLATE);

  // Planned ZERO before, with both captures confirmed, and reported the slot
  // as shipping empty. The docx would have carried a blank cell over two
  // accepted zones.
  const crops = plan.crops.filter((c) => c.key === "kbLanjutan.top");
  assert.equal(crops.length, 2);
  // The exporter stacks a cell's pictures in the order it receives them, so
  // the ordinals have to arrive in order and be the STORED ones.
  assert.deepEqual(
    crops.map((c) => c.ordinal),
    [1, 2],
  );
  assert.ok(!plan.empty.some((e) => e.key === "kbLanjutan.top"));
});

test("a capture is named by its own section, not reported as unknown", () => {
  const [entry] = describeOutstanding(
    [{ key: "kbLanjutan.top#2", label: "ToP (2)", status: "outstanding" }],
    AO_TEMPLATE,
  );
  assert.equal(entry.sectionTitle, "KB (lanjutan)");
  assert.equal(slotKeyOf("kbLanjutan.top#2"), "kbLanjutan.top");
});

/* ------------------------------------------------------- the run-global page */

test("the propose request numbers pages by POSITION IN THE RUN, not within their source", () => {
  // Two documents, each numbering its own pages from 0 -- which is what
  // `StoredPage.index` means. The request must renumber them 0..3.
  const pages: StoredPage[] = [
    { id: "a0", sourceId: "a", index: 0, widthPx: 10, heightPx: 10, lines: [] },
    { id: "a1", sourceId: "a", index: 1, widthPx: 10, heightPx: 10, lines: [] },
    { id: "b0", sourceId: "b", index: 0, widthPx: 10, heightPx: 10, lines: [] },
    { id: "b1", sourceId: "b", index: 1, widthPx: 10, heightPx: 10, lines: [] },
  ];
  const run: BrowserRun = { ...seededRun(), pages };

  const request = buildProposeRequest(run, AO_TEMPLATE);

  assert.deepEqual(
    request.pages.map((p) => p.index),
    [0, 1, 2, 3],
    "copying StoredPage.index here would point every zone in the second " +
      "document at a page of the first",
  );
  assert.deepEqual(
    request.pages.map((p) => p.sourceId),
    ["a", "a", "b", "b"],
  );
});

/* --------------------------------------------------------- applying answers */

test("a decision made while the search ran is not overwritten by its answer", () => {
  // A full pass is minutes of model calls. If the operator confirms a slot in
  // that window, the late answer must not replace their zone.
  const slots: SlotState[] = [
    { key: "a", label: "A", status: "confirmed", origin: "human", zone: ZONE },
    { key: "b", label: "B", status: "pending" },
    { key: "c", label: "C", status: "unfilled" },
  ];
  const run = { ...seededRun(slots) };

  const applied = applyProposals(run, {
    proposals: [
      { key: "a", zone: { ...ZONE, pageIndex: 9 }, text: "late", confidence: "high" },
      { key: "b", zone: ZONE, text: "found", confidence: "high" },
      { key: "c", zone: ZONE, text: "late", confidence: "high" },
    ],
    outstanding: [],
    outOfScope: [],
  });

  assert.equal(applied.slots[0].status, "confirmed");
  assert.equal(applied.slots[0].zone?.pageIndex, 0, "the human's zone stands");
  assert.equal(applied.slots[1].status, "proposed");
  assert.equal(applied.slots[1].origin, "llm");
  assert.equal(applied.slots[2].status, "unfilled", "shipping empty is a decision");
});

test("only unsearched and not-found slots are offered to the search", () => {
  // REAL TEMPLATE KEYS, and that is not cosmetic any more: `wantedKeys` filters
  // on `isSearchable`, so a fixture keyed "a".."e" would now come back empty
  // for the right reason and prove nothing about the status filter it is here
  // to test.
  const slots: SlotState[] = [
    { key: "kb.nomor", label: "Nomor", status: "confirmed", zone: ZONE },
    { key: "kb.tanggal", label: "Tanggal", status: "pending" },
    { key: "kb.jangkaWaktu", label: "Jangka Waktu", status: "outstanding" },
    { key: "kbLanjutan.detail", label: "Detail", status: "proposed", zone: ZONE },
    { key: "kbLanjutan.ttdPejabat", label: "TTD Pejabat", status: "unfilled" },
  ];

  // `outstanding` is included: that IS the dokumen tambahan loop. `proposed`
  // is not -- it is already waiting on a person, and re-answering it would
  // discard the thing they were about to rule on.
  assert.deepEqual(wantedKeys(seededRun(slots), AO_TEMPLATE), [
    "kb.tanggal",
    "kb.jangkaWaktu",
  ]);
});

/* ------------------------------------------------ the form the ORDER carries */

/**
 * One order's edits: a base judul deleted, and a judul of the operator's own
 * added beside it.
 *
 * Both halves matter and they fail in opposite directions. A DELETED judul
 * leaves its bagian's state sitting in `run.slots` for ever (`seedSlots` runs
 * once and the array only grows), so the key names nothing in this order's
 * form. An ADDED judul is `layout: "images"` by construction, captured by hand,
 * and its bagian carry the frozen `ADDED_SLOT_ASK` placeholder -- the literal
 * string "added bagian, never searched" -- so there is no question to ask about
 * one.
 */
const EDITED_OVERLAY: TemplateOverlay = {
  ...emptyOverlay(AO_TEMPLATE),
  sections: { "kb-lanjutan": { removed: true } },
  added: [
    {
      id: "u:lampiran",
      title: "Lampiran teknis",
      origin: "human",
      slots: [{ id: "u:lampiran-1", label: "Halaman 1" }],
    },
  ],
};

const EDITED_TEMPLATE = resolveTemplate(AO_TEMPLATE, EDITED_OVERLAY);

test("a bagian nothing will ever search is not offered to the search", () => {
  const slots: SlotState[] = [
    { key: "kb.nomor", label: "Nomor", status: "pending" },
    // Its judul was deleted from this order. The state stays; the question
    // stops being askable.
    { key: "kbLanjutan.detail", label: "Detail", status: "outstanding" },
    // The operator's own judul. Nothing can search it, by design.
    { key: "u:lampiran-1", label: "Halaman 1", status: "pending" },
  ];
  const run = seededRun(slots, EDITED_OVERLAY);

  // THE DEFECT, STATED FIRST: read the compile-time form and both of the last
  // two go up as `wanted`, the route finds no def for either, and both come
  // back as "tidak ditemukan" -- a word fixed to mean SEARCHED AND NOT FOUND --
  // on every reading pass, for ever.
  assert.deepEqual(wantedKeys(run, AO_TEMPLATE), ["kb.nomor", "kbLanjutan.detail"]);
  assert.deepEqual(wantedKeys(run, EDITED_TEMPLATE), ["kb.nomor"]);

  // And the request carries the filtered list, not a second opinion.
  assert.deepEqual(buildProposeRequest(run, EDITED_TEMPLATE).wanted, [
    "kb.nomor",
  ]);
});

test("a capture on an added bagian is never walked for a lanjutan", () => {
  // A hand-drawn area on the operator's own judul is ordinary and reaches
  // `capturesToWalk` unfiltered. The route would then build a continuation
  // prompt out of `ADDED_SLOT_ASK`, ask a model where "added bagian, never
  // searched" continues, and append whatever came back to a bagian the operator
  // is capturing themselves.
  const slots: SlotState[] = [
    { key: "kb.nomor", label: "Nomor", status: "confirmed", origin: "llm", zone: ZONE },
    {
      key: "u:lampiran-1",
      label: "Halaman 1",
      status: "confirmed",
      origin: "human",
      zone: LANJUTAN_ZONE,
    },
  ];
  const run = seededRun(slots, EDITED_OVERLAY);

  assert.deepEqual(
    capturesToWalk(run, EDITED_TEMPLATE).map((capture) => capture.key),
    ["kb.nomor"],
  );
});

test("an out-of-scope key is left EXACTLY as the answer found it", () => {
  const slots: SlotState[] = [
    { key: "u:lampiran-1", label: "Halaman 1", status: "pending" },
  ];
  const run = seededRun(slots, EDITED_OVERLAY);

  // A route that reports the same key BOTH ways is the case worth pinning:
  // out-of-scope has to win, or the operator is told the tool searched a bagian
  // nobody ever asked it about.
  const applied = applyProposals(run, {
    proposals: [],
    outstanding: [{ key: "u:lampiran-1", reason: "tidak ditemukan" }],
    outOfScope: [{ key: "u:lampiran-1", reason: "bagian ini ditambahkan" }],
  });

  assert.equal(applied.slots[0].status, "pending");
});

/* ------------------------------------ the form is resolved, never assumed */

/**
 * Strips comments so a screen may DISCUSS the compile-time template without
 * failing this test. `contact-sheet.tsx` does exactly that ("`AO_TEMPLATE`
 * declares 24 slots"), and a prose mention is not a read.
 *
 * `//` only when it is not preceded by `:`, so a `https://` inside a string
 * does not eat the rest of its line.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("no operator screen reads the compile-time template, with no exception", () => {
  /*
   * THE RULE THIS PINS. `BrowserRun.overlay` is this order's diff against
   * `AO_TEMPLATE`, so a screen reading the module constant renders the packet
   * under names the operator replaced, lists bagian they deleted as work still
   * owed, and plans an export that does not match the sheet they signed off.
   * All three open fine and look complete.
   *
   * IT USED TO CARRY ONE EXCEPTION AND NOW CARRIES NONE, which is the whole
   * reason this comment is here. `export-panel.tsx` printed
   * the field list's length as screen copy about the EPIC ORDER_Config sheet;
   * that sheet is gone and so is the read. An allowance kept past the thing it
   * allowed is not inert -- it would let a genuine per-order read into the one
   * file most likely to want one, under a name that reads as settled. So the
   * allowance went with the workbook, and adding one back means arguing for it
   * again.
   *
   * Source text rather than an import, for the reason the live-runtime test
   * above gives: node's type stripping does not handle JSX, so a `.tsx` cannot
   * be imported into `node --test`.
   */
  const dir = fileURLToPath(
    new URL("../../components/operator/", import.meta.url),
  );
  const offenders: string[] = [];

  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".tsx")) continue;
    const lines = withoutComments(readFileSync(join(dir, name), "utf8")).split(
      "\n",
    );
    lines.forEach((line, i) => {
      if (/\bAO_TEMPLATE\b/.test(line)) {
        offenders.push(`${name}:${i + 1} ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(offenders, []);
});
