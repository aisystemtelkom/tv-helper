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

import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as browserRuntime from "../browser/runtime.ts";
import {
  captureOrdinalOf,
  seedSlots,
  slotKeyOf,
  withDiscoveredCaptures,
} from "../browser/runtime.ts";
import { AO_TEMPLATE } from "../forms/template.ts";
import { planExport } from "./export.ts";
import { liveRuntime } from "./live-runtime.ts";
import { applyProposals, buildProposeRequest, wantedKeys } from "./propose.ts";
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
function seededRun(slots: SlotState[] = seedSlots(AO_TEMPLATE)): BrowserRun {
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

  const request = buildProposeRequest(run);

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
  });

  assert.equal(applied.slots[0].status, "confirmed");
  assert.equal(applied.slots[0].zone?.pageIndex, 0, "the human's zone stands");
  assert.equal(applied.slots[1].status, "proposed");
  assert.equal(applied.slots[1].origin, "llm");
  assert.equal(applied.slots[2].status, "unfilled", "shipping empty is a decision");
});

test("only unsearched and not-found slots are offered to the search", () => {
  const slots: SlotState[] = [
    { key: "a", label: "A", status: "confirmed", zone: ZONE },
    { key: "b", label: "B", status: "pending" },
    { key: "c", label: "C", status: "outstanding" },
    { key: "d", label: "D", status: "proposed", zone: ZONE },
    { key: "e", label: "E", status: "unfilled" },
  ];

  // `outstanding` is included: that IS the dokumen tambahan loop. `proposed`
  // is not -- it is already waiting on a person, and re-answering it would
  // discard the thing they were about to rule on.
  assert.deepEqual(wantedKeys(seededRun(slots)), ["b", "c"]);
});
