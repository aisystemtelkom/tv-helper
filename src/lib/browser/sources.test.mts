/**
 * Tests for `src/lib/browser/sources.ts`: taking one berkas back out of an open
 * order.
 *
 * ## Why this file exists separately from `persistence.test.mts`
 *
 * That file drives `removeDocument` through the real IndexedDB and proves the
 * two WRITES happen. This one drives `removeSource` directly, because the
 * dangerous half of a removal is not the write, it is the ARITHMETIC: pages
 * come out of the middle of an array that four other structures index into by
 * position, and every one of those numbers has to move with them.
 *
 * `BrowserRun.pages` is indexed by position from THREE places, not one:
 *
 *   - `SlotState.zone.pageIndex`, the evidence an operator accepted;
 *   - `overlay.proposed[].fromPages` and `.cite.pageIndex`, a usulan waiting
 *     for a decision;
 *   - `overlay.added[].pages` and `.cite.pageIndex`, what an accepted judul
 *     says it was read from.
 *
 * The first was renumbered from the day this module was written. THE OTHER TWO
 * WERE NOT, and the failure is this project's exact shape: berkas A holds
 * positions 0-4 and berkas B holds 5-14, a usulan from B names pages [5, 6],
 * the operator removes A, and the usulan still says [5, 6] while B now occupies
 * 0-9. The panel draws a denah of B's SIXTH page under a heading transcribed
 * from B's first, and pressing Terima mints whole-page potongan over two pages
 * that do not carry that heading. Nothing throws. Nothing is marked.
 *
 * EVERY STRING HERE IS INVENTED, per the fictional set this repo uses:
 * LOP999001, 1-70000000001, BANK CONTOH NUSANTARA, PSB VPN IP KCP Contoh, SID
 * 1209990001, Budi Contoh.
 */

import { emptyConfigCheck, emptyEpicCheck } from "../config/types.ts";
import type { ConfigEntry } from "../config/types.ts";
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOverlay,
  emptyOverlay,
  type AddedSection,
  type ProposedSection,
  type TemplateOverlay,
} from "../forms/overlay.ts";
import { AO_TEMPLATE } from "../forms/template.ts";
import { removeSource, sourceRemovalCost, withSourceAi } from "./sources.ts";
import type { BrowserRun, SlotState, StoredPage } from "./types.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A page at RUN-GLOBAL position `at`, whose own `index` restarts per berkas.
 *
 * The two numbers are deliberately different in every fixture below. They are
 * the pair this module is easiest to confuse -- `StoredPage.index` is "page 3
 * of SPLITBA.pdf" and a `Zone.pageIndex` is "position 8 of this order" -- and a
 * fixture where they happen to agree cannot tell a correct remap from one that
 * read the wrong field.
 */
function page(sourceId: string, ownIndex: number): StoredPage {
  return {
    id: `${sourceId}-p${ownIndex}`,
    sourceId,
    index: ownIndex,
    widthPx: 2480,
    heightPx: 3507,
    lines: [
      {
        i: 0,
        text: `${sourceId} halaman ${ownIndex}`,
        box: { x: 100, y: 200, w: 900, h: 40 },
        words: [{ text: sourceId, box: { x: 100, y: 200, w: 200, h: 40 } }],
      },
    ],
  };
}

function zoneOn(pageIndex: number) {
  return {
    pageIndex,
    box: { x: 0, y: 0, w: 2480, h: 3507 },
    lineRange: [0, 0] as [number, number],
  };
}

/** Berkas A holds run positions 0-4; berkas B holds 5-14. */
function twoBerkas(overlay: TemplateOverlay, slots: SlotState[] = []): BrowserRun {
  return {
    id: "run-sources",
    createdAt: 1_700_000_000_000,
    rev: 3,
    sources: [
      { id: "src-a", name: "LOP999001_KONTRAK.pdf", pageCount: 5, digest: "d-a" },
      { id: "src-b", name: "LOP999001_SPLITBA.pdf", pageCount: 10, digest: "d-b" },
    ],
    pages: [
      ...Array.from({ length: 5 }, (_, i) => page("src-a", i)),
      ...Array.from({ length: 10 }, (_, i) => page("src-b", i)),
    ],
    slots,
    overlay,
    konfigurasi: emptyConfigCheck(),
    epic: emptyEpicCheck(),
  };
}

/** A usulan read out of berkas B's first two pages, at run positions 5 and 6. */
const USULAN_B: ProposedSection = {
  id: "u:00000000-0000-4000-8000-0000000000b1",
  title: "BERITA ACARA UJI TERIMA",
  fromSourceId: "src-b",
  fromPages: [5, 6],
  cite: { pageIndex: 5, lineRange: [0, 0] },
};

/** One read out of berkas A, which is the berkas these tests remove. */
const USULAN_A: ProposedSection = {
  id: "u:00000000-0000-4000-8000-0000000000a1",
  title: "SURAT PENUNJUKAN",
  fromSourceId: "src-a",
  fromPages: [1, 2],
  cite: { pageIndex: 1, lineRange: [0, 0] },
};

/** A judul the operator already accepted out of berkas B, run positions 7-8. */
const DITERIMA_B: AddedSection = {
  id: "u:00000000-0000-4000-8000-0000000000b2",
  title: "LAMPIRAN DAFTAR LAYANAN",
  slots: [
    { id: "u:00000000-0000-4000-8000-0000000000b3", label: "Halaman 1" },
    { id: "u:00000000-0000-4000-8000-0000000000b4", label: "Halaman 2" },
  ],
  origin: "llm",
  fromSourceId: "src-b",
  cite: { pageIndex: 7, lineRange: [0, 0] },
  pages: [7, 8],
};

/** And one accepted out of berkas A, run positions 3-4. */
const DITERIMA_A: AddedSection = {
  id: "u:00000000-0000-4000-8000-0000000000a2",
  title: "SURAT PENUNJUKAN",
  slots: [{ id: "u:00000000-0000-4000-8000-0000000000a3", label: "Halaman 1" }],
  origin: "llm",
  fromSourceId: "src-a",
  cite: { pageIndex: 3, lineRange: [0, 0] },
  pages: [3, 4],
};

function overlayWith(
  added: AddedSection[],
  proposed: ProposedSection[],
): TemplateOverlay {
  return { ...emptyOverlay(AO_TEMPLATE), added, proposed };
}

// ---------------------------------------------------------------------------
// 1. The overlay indexes into the same array the zones do
// ---------------------------------------------------------------------------

test("removing a berkas renumbers the USULAN of the berkas that survived", () => {
  /*
   * THE DEFECT, AS THE PANEL WOULD HAVE SHOWN IT. `USULAN_B` names run
   * positions 5 and 6, which are berkas B's first two pages. Removing berkas A
   * takes five pages out from in front of them, so B now occupies 0-9 and the
   * usulan means 0 and 1. Left at 5 and 6 it points at B's SIXTH and SEVENTH
   * pages: real pages, in the right document, carrying different text, under a
   * heading transcribed from a page it no longer names.
   *
   * The existing orphan guard in `outstanding-panel.tsx` does not see this one
   * at all: it finds usulan whose OWN berkas was removed, and this usulan's
   * berkas is still here.
   */
  const run = twoBerkas(overlayWith([], [USULAN_B]));

  const { run: after } = removeSource(run, "src-a");

  const moved = after.overlay.proposed.find((entry) => entry.id === USULAN_B.id);
  assert.deepEqual(moved?.fromPages, [0, 1]);
  assert.equal(moved?.cite.pageIndex, 0);
  // The line range is a fact about the page's own text and does not move.
  assert.deepEqual(moved?.cite.lineRange, [0, 0]);

  // And the pages it now names really are the ones it was read from: berkas B's
  // own first two. This is the assertion a shift computed the wrong way round
  // would fail while the numbers still looked plausible.
  assert.equal(after.pages[0].sourceId, "src-b");
  assert.equal(after.pages[0].index, 0);
  assert.equal(after.pages[1].index, 1);
});

test("an ACCEPTED judul's pages and cite are renumbered too", () => {
  /*
   * `AddedSection.pages` and `.cite` are what the sheet prints under the
   * heading ("dari SPLITBA.pdf hal 3/10") and what `Buka halaman` navigates to.
   * A stale number here sends the operator to a page that does not carry the
   * heading and tells them, in the document's own mono voice, that it does.
   */
  const run = twoBerkas(overlayWith([DITERIMA_B], []));

  const { run: after } = removeSource(run, "src-a");

  const moved = after.overlay.added.find((one) => one.id === DITERIMA_B.id);
  assert.deepEqual(moved?.pages, [2, 3]);
  assert.equal(moved?.cite?.pageIndex, 2);
  assert.equal(after.pages[2].sourceId, "src-b");
  assert.equal(after.pages[2].index, 2);
});

test("the whole overlay survives assertOverlay, so -1 never reaches storage", () => {
  /*
   * THE WRONG FIX WOULD PASS THE TWO TESTS ABOVE. Mapping every entry through
   * `next[]` unconditionally writes -1 for a page that is going, and
   * `assertPageList` refuses a negative index -- so the removal would throw on
   * the way to storage and the operator could not take the document out at all.
   * A run that cannot be written is a different failure, not a fix.
   */
  const run = twoBerkas(overlayWith([DITERIMA_A, DITERIMA_B], [USULAN_A, USULAN_B]));

  const { run: after } = removeSource(run, "src-a");

  assertOverlay(after.overlay);
  for (const entry of after.overlay.proposed) {
    for (const at of entry.fromPages) assert.ok(at >= 0);
  }
  for (const section of after.overlay.added) {
    for (const at of section.pages ?? []) assert.ok(at >= 0);
  }
});

test("an accepted judul whose berkas is gone STOPS CLAIMING PAGES, keeping its evidence question", () => {
  /*
   * `pages` and `cite` are optional metadata: they say "I was read out of these
   * pages". Once the berkas is gone there is no honest answer, and any number
   * written here would name a page of a DIFFERENT document. So both are
   * dropped and the judul stops claiming.
   *
   * THE JUDUL ITSELF STAYS, and so does its row. Dropping the whole
   * `AddedSection` would discard a name the operator adopted, which
   * `SectionLossError` refuses without an opt-in and which `removeDocument`
   * does not pass. Its EVIDENCE is handled where all evidence is handled --
   * `run.slots` -- and dropped there by the same rule as every other capture
   * found inside the removed berkas.
   */
  const held: SlotState = {
    key: DITERIMA_A.slots[0].id,
    label: "Halaman 1",
    status: "confirmed",
    origin: "human",
    zone: zoneOn(3),
  };
  const run = twoBerkas(overlayWith([DITERIMA_A], []), [held]);

  const { run: after, removedCaptureKeys, confirmedLost } = removeSource(run, "src-a");

  const orphaned = after.overlay.added.find((one) => one.id === DITERIMA_A.id);
  assert.ok(orphaned, "the operator's judul must survive the loss of its berkas");
  assert.equal(orphaned.title, DITERIMA_A.title);
  assert.equal(orphaned.pages, undefined);
  assert.equal(orphaned.cite, undefined);
  // `fromSourceId` is KEPT: it is how `provenanceOf` knows to print "the berkas
  // this was read from is no longer in this order" rather than inventing a name.
  assert.equal(orphaned.fromSourceId, "src-a");

  // And its evidence went the ordinary way, named to `putRun` like any other.
  const row = after.slots.find((slot) => slot.key === held.key);
  assert.equal(row?.zone, undefined);
  assert.equal(row?.status, "pending");
  assert.deepEqual(removedCaptureKeys, [held.key]);
  assert.equal(confirmedLost, 1);
});

test("a usulan whose berkas is gone keeps its numbers, because the panel finds it by berkas", () => {
  /*
   * NOT REMAPPED AND NOT DROPPED. `outstanding-panel.tsx` lists these by
   * `fromSourceId` against the sources this order still holds and offers only
   * "Bukan ini" -- so the numbers are never read again, and rewriting them
   * would make the row look answerable. Dropping the row instead would leave a
   * decision owed that nothing on screen mentions.
   */
  const run = twoBerkas(overlayWith([], [USULAN_A, USULAN_B]));

  const { run: after } = removeSource(run, "src-a");

  const orphan = after.overlay.proposed.find((entry) => entry.id === USULAN_A.id);
  assert.ok(orphan, "an orphaned usulan is listed, not hidden");
  assert.deepEqual(orphan.fromPages, USULAN_A.fromPages);
  assert.equal(orphan.cite.pageIndex, USULAN_A.cite.pageIndex);
  assert.equal(orphan.fromSourceId, "src-a");
});

test("removing the LAST berkas leaves no overlay entry pointing anywhere", () => {
  // Every page goes, so nothing can be remapped and nothing may be invented.
  const run = twoBerkas(overlayWith([DITERIMA_B], [USULAN_B]));

  const { run: after } = removeSource(run, "src-b");

  assert.equal(after.pages.length, 5);
  assert.equal(after.overlay.added[0].pages, undefined);
  assert.equal(after.overlay.added[0].cite, undefined);
  assert.deepEqual(after.overlay.proposed[0].fromPages, USULAN_B.fromPages);
  assertOverlay(after.overlay);
});

test("removing the LAST berkas of an order empties the pages and keeps the overlay legal", () => {
  const run = twoBerkas(overlayWith([DITERIMA_A, DITERIMA_B], [USULAN_A, USULAN_B]));

  const first = removeSource(run, "src-a").run;
  const second = removeSource(first, "src-b").run;

  assert.deepEqual(second.pages, []);
  assert.deepEqual(second.sources, []);
  assertOverlay(second.overlay);
  for (const section of second.overlay.added) {
    assert.equal(section.pages, undefined);
    assert.equal(section.cite, undefined);
  }
});

test("an added judul with no page claim at all is passed through by identity", () => {
  /*
   * A judul the operator TYPED (`add-section`) carries neither `pages` nor
   * `cite`: it was not read off anything. Rebuilding it here would be a copy
   * with nothing changed, and identity is what lets a React memo skip a section
   * whose heading did not move.
   */
  const typed: AddedSection = {
    id: "u:00000000-0000-4000-8000-0000000000c1",
    title: "Lampiran Harga",
    slots: [{ id: "u:00000000-0000-4000-8000-0000000000c2", label: "Halaman 1" }],
    origin: "human",
  };
  const run = twoBerkas(overlayWith([typed], []));

  const { run: after } = removeSource(run, "src-a");

  assert.equal(after.overlay.added[0], typed);
});

test("a removal that moves no overlay entry keeps the overlay object itself", () => {
  // Berkas B sits AFTER berkas A, so removing B moves nothing in front of it.
  const run = twoBerkas(overlayWith([DITERIMA_A], [USULAN_A]));

  const { run: after } = removeSource(run, "src-b");

  assert.equal(
    after.overlay,
    run.overlay,
    "nothing moved, so nothing should have been rebuilt",
  );
});

// ---------------------------------------------------------------------------
// 2. The rest of the module, pinned where the overlay work could disturb it
// ---------------------------------------------------------------------------

test("a zone in the surviving berkas moves, and one in the removed berkas does not", () => {
  const slots: SlotState[] = [
    { key: "kb.nomor", label: "Nomor", status: "confirmed", zone: zoneOn(2) },
    { key: "sp.tanggal", label: "Tanggal", status: "confirmed", zone: zoneOn(9) },
  ];
  const run = twoBerkas(emptyOverlay(AO_TEMPLATE), slots);

  const { run: after, removedPageIds } = removeSource(run, "src-a");

  assert.equal(removedPageIds.length, 5);
  assert.equal(
    after.slots.find((slot) => slot.key === "kb.nomor")?.zone,
    undefined,
    "evidence inside the removed berkas is dropped, never repointed",
  );
  assert.equal(after.slots.find((slot) => slot.key === "sp.tanggal")?.zone?.pageIndex, 4);
});

test("a berkas this order does not hold changes nothing, by identity", () => {
  const run = twoBerkas(overlayWith([DITERIMA_B], [USULAN_B]));

  const result = removeSource(run, "src-never-here");

  assert.equal(result.run, run);
  assert.deepEqual(result.removedPageIds, []);
  assert.deepEqual(result.removedCaptureKeys, []);
});

test("sourceRemovalCost reports the same numbers the removal produces", () => {
  const slots: SlotState[] = [
    { key: "kb.nomor", label: "Nomor", status: "confirmed", zone: zoneOn(1) },
    { key: "sp.tanggal", label: "Tanggal", status: "proposed", zone: zoneOn(4) },
  ];
  const run = twoBerkas(overlayWith([], [USULAN_B]), slots);

  const cost = sourceRemovalCost(run, "src-a");
  const done = removeSource(run, "src-a");

  assert.equal(cost.pages, done.removedPageIds.length);
  assert.equal(cost.captures, done.removedCaptureKeys.length);
  assert.equal(cost.confirmed, done.confirmedLost);
  assert.equal(cost.confirmed, 1);
});

test("withSourceAi writes one boolean and returns identity when it already says so", () => {
  const run = twoBerkas(emptyOverlay(AO_TEMPLATE));

  const fenced = withSourceAi(run, "src-a", false);
  assert.equal(fenced.sources[0].ai, false);
  assert.equal(fenced.sources[1].ai, undefined, "the other berkas is untouched");
  assert.equal(fenced.pages, run.pages, "nothing about a page changes");

  // Absent means dibaca AI, read through the same `?? true` default, so
  // re-selecting it on an untouched berkas writes nothing.
  assert.equal(withSourceAi(run, "src-a", true), run);
  assert.equal(withSourceAi(run, "src-never-here", false), run);
});

// ---------------------------------------------------------------------------
// Konfig Excel's citations are positions in `pages` too
// ---------------------------------------------------------------------------

/** One konfigurasi entry citing a run-global page, with a ruling already made. */
function isian(
  id: string,
  valueRef: string,
  pageIndex: number | null,
  decision: ConfigEntry["decision"] = "belum",
): ConfigEntry {
  return {
    field: {
      id,
      sheet: "Sheet1",
      label: "Bandwidth",
      labelRef: "C9",
      valueRef,
      excelValue: "10 Mbps",
    },
    verdict: "beda",
    documentValue: "172 Mbps",
    ...(pageIndex === null
      ? {}
      : { citation: { pageIndex, from: 0, to: 0, text: "172 Mbps" } }),
    decision,
  };
}

test("removing a berkas renumbers Konfig Excel's citations through the same map", () => {
  // The defect this pins was invisible without it: `removeSource` moved every
  // zone and every overlay page and left `ConfigCitation.pageIndex` alone, so
  // an operator checking a recommendation was shown a page from a different
  // document with the right berkas name over it.
  const run = twoBerkas(emptyOverlay(AO_TEMPLATE));
  run.konfigurasi = {
    entries: [isian("f1", "E9", 7), isian("f2", "E10", 14, "setuju")],
    researched: false,
  };

  const { run: next } = removeSource(run, "src-a");

  assert.equal(next.konfigurasi.entries[0].citation?.pageIndex, 2, "7 - 5 removed pages");
  assert.equal(next.konfigurasi.entries[1].citation?.pageIndex, 9, "14 - 5 removed pages");
  assert.equal(
    next.konfigurasi.entries[1].decision,
    "setuju",
    "the ruling is the operator's and an unrelated berkas leaving does not undo it",
  );
});

test("a citation whose page is gone is DROPPED rather than repointed, and keeps its verdict", () => {
  const run = twoBerkas(emptyOverlay(AO_TEMPLATE));
  run.konfigurasi = {
    entries: [isian("f1", "E9", 2, "setuju"), isian("f2", "E10", 9)],
    researched: true,
  };

  const { run: next } = removeSource(run, "src-a");

  const gone = next.konfigurasi.entries[0];
  assert.equal(gone.citation, undefined, "there is no page that took over from a deleted one");
  assert.equal(gone.verdict, "beda", "what was found is still what was found");
  assert.equal(gone.documentValue, "172 Mbps");
  assert.equal(gone.decision, "setuju", "and the ruling stands");
  assert.equal(next.konfigurasi.entries[1].citation?.pageIndex, 4, "9 - 5 removed pages");
  assert.equal(next.konfigurasi.researched, true, "the spent budget is not refilled by a removal");
});

test("a removal that moves no citation returns the konfigurasi object itself", () => {
  const run = twoBerkas(emptyOverlay(AO_TEMPLATE));
  const held = { entries: [isian("f1", "E9", null)], researched: false };
  run.konfigurasi = held;

  const { run: next } = removeSource(run, "src-b");

  assert.equal(
    next.konfigurasi,
    held,
    "identity, so an order that never reached Konfig Excel is not rewritten",
  );
});
