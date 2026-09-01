/**
 * Tests for the ON-DEVICE STORAGE LAYER: `src/lib/storage/runs.ts` and the
 * part of `src/lib/browser/runtime.ts` that writes through it.
 *
 * ## Why this file exists
 *
 * Everything a validation run holds -- the OCR of every page, the zones an
 * operator confirmed -- lives in IndexedDB on the operator's machine and
 * nowhere else. There is no server copy to fall back on, by design: documents
 * do not leave the device. So a storage bug here is not a bug that can be
 * repaired from a backup; it is evidence gone. Until this file existed the
 * whole layer had no executable coverage at all, which is how the defect
 * below survived being described accurately in a comment.
 *
 * ## The defect these tests pin
 *
 * `putRun` replaced a run wholesale and deleted any stored page the incoming
 * run did not carry. A `BrowserRun` read before a long ingest does not carry
 * the pages that ingest appended -- so saving it deleted them, resolved
 * successfully, and left a run that still opened and still looked complete.
 * Minutes of OCR, gone, with no error anywhere. The old code named the hazard
 * in a comment and told callers to re-read; the UI holds a run in React state
 * for as long as the operator is looking at it, so discipline was never going
 * to be enough. `saveRun` now refuses a write that is behind.
 *
 * ## fake-indexeddb, and why a real one is not an option
 *
 * `node --test` has no IndexedDB: it is a browser storage API, and this
 * module deliberately runs only in a tab or a Web Worker. These tests install
 * `fake-indexeddb/auto` (devDependency, test-only -- it never reaches the
 * browser bundle, so the "the browser talks to nothing but this app"
 * constraint is untouched). It is a spec implementation rather than a stub,
 * which is the point: the revision check below is a read and a write INSIDE
 * ONE readwrite transaction, and a hand-rolled Map would model neither the
 * transaction nor the auto-commit that makes that check meaningful. A test
 * that passes against a fake weaker than the real API is the same
 * wrong-and-quiet failure as the code it is testing.
 *
 * ## One database, many run ids
 *
 * `runs.ts` memoises its connection in a module-level variable, so there is
 * no supported way to hand it a fresh database between tests. Every test
 * therefore works under its own run id and asserts about that run only.
 */

import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

import {
  appendPage,
  getPage,
  getRun,
  getSource,
  listRunMeta,
  putRun,
  putSource,
  deleteRun,
  PageLossError,
  StaleRunWriteError,
  type RunMeta,
} from "../storage/runs.ts";
import { createRun, loadRun, outstandingSlots, saveRun } from "./runtime.ts";
import type { BrowserRun, SlotState, StoredPage } from "./types.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let counter = 0;
const runId = (name: string) => `test-${name}-${(counter += 1)}`;

/**
 * A page with real-looking OCR geometry.
 *
 * `id` is taken rather than generated so a test can choose ids whose sort
 * order DISAGREES with insertion order -- which is the only way to catch a
 * `pages` array that comes back reordered.
 */
function page(id: string, sourceId: string, index: number): StoredPage {
  return {
    id,
    sourceId,
    index,
    widthPx: 2480,
    heightPx: 3507,
    lines: [
      {
        i: 0,
        text: `page ${index} line 0`,
        box: { x: 100, y: 200, w: 900, h: 40 },
        words: [
          { text: "page", box: { x: 100, y: 200, w: 200, h: 40 } },
          { text: `${index}`, box: { x: 320, y: 200, w: 60, h: 40 } },
        ],
      },
    ],
  };
}

const confirmedSlot: SlotState = {
  key: "kb.nomor",
  label: "Nomor",
  status: "confirmed",
  origin: "human",
  text: "Nomor: LOP999001",
  zone: {
    pageIndex: 1,
    box: { x: 120, y: 240, w: 800, h: 90 },
    lineRange: [3, 5],
  },
};

/** A run as the runtime would build it, at revision 0: never stored. */
function freshRun(id: string, pages: StoredPage[] = []): BrowserRun {
  return {
    id,
    createdAt: 1_700_000_000_000,
    rev: 0,
    sources: [{ id: "src-a", name: "LOP999001_BUNDLE.pdf", pageCount: pages.length }],
    pages,
    slots: [
      confirmedSlot,
      { key: "kb.tanggal", label: "Tanggal", status: "outstanding" },
      { key: "sp.ttd", label: "TTD Pejabat", status: "pending" },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. A run survives a round trip
// ---------------------------------------------------------------------------

test("a run survives a round trip: pages, OCR lines and confirmed zones come back whole", async () => {
  const id = runId("roundtrip");
  // Ids chosen so ALPHABETICAL order is the reverse of page order. IndexedDB
  // returns index matches in key order, so a `loadRun` that forgot to sort by
  // the stored `order` column would hand these back backwards -- and since a
  // Zone's pageIndex is a position in this array, every confirmed zone would
  // silently point at a different page.
  const pages = [page("zzz", "src-a", 0), page("mmm", "src-a", 1), page("aaa", "src-a", 2)];

  const saved = await putRun(freshRun(id, pages));
  const loaded = await getRun(id);

  assert.ok(loaded, "the run must be readable after it is written");
  assert.equal(loaded.id, id);
  assert.equal(loaded.createdAt, 1_700_000_000_000);

  // Page order is insertion order, not key order.
  assert.deepEqual(
    loaded.pages.map((p) => p.id),
    ["zzz", "mmm", "aaa"],
  );
  // ...and each page comes back with its within-document number and its OCR
  // geometry intact, down to the word boxes a crop is cut from.
  assert.deepEqual(loaded.pages, pages);

  // The operator's confirmed zone survives byte for byte. This is the thing
  // the deliverable is cut from; a zone that comes back subtly different is a
  // crop of the wrong rectangle on a document somebody signs.
  assert.deepEqual(loaded.slots, freshRun(id).slots);
  assert.deepEqual(loaded.slots[0].zone, confirmedSlot.zone);

  // Storage stamps the revision it wrote, and hands the writer the same one.
  assert.equal(saved.rev, 1);
  assert.equal(loaded.rev, 1);
});

test("listRunMeta lists a run without dragging its pages along", async () => {
  const id = runId("meta");
  await putRun(freshRun(id, [page("p0", "src-a", 0), page("p1", "src-a", 1)]));

  const rows = await listRunMeta();
  const mine = rows.find((row) => row.id === id);

  assert.ok(mine, "the run must appear in the listing");
  // `listRuns` reads every run on the device. A bundle is 29 pages of OCR
  // lines, so a meta row that carried them would turn opening the run list
  // into loading every run ever made.
  assert.equal("pages" in mine, false);
  assert.deepEqual(mine.sources, [
    { id: "src-a", name: "LOP999001_BUNDLE.pdf", pageCount: 2 },
  ]);
});

test("outstandingSlots on a run read back from storage reports only outstanding", async () => {
  const id = runId("outstanding");
  await putRun(freshRun(id));

  const loaded = await loadRun(id);
  assert.ok(loaded);

  // The fixture holds one confirmed, one outstanding and one pending slot.
  // "pending" means nobody has looked yet, and offering it as missing
  // evidence would ask the operator to supply a dokumen tambahan for work
  // that has not been done -- and, at the end of a run, would let an
  // unsearched slot ship as a considered blank.
  assert.deepEqual(
    outstandingSlots(loaded).map((slot) => slot.key),
    ["kb.tanggal"],
  );
  assert.equal(
    outstandingSlots(loaded).some((slot) => slot.status === "pending"),
    false,
  );
});

test("deleteRun takes the pages and the PDF bytes with it", async () => {
  const id = runId("delete");
  await putRun(freshRun(id, [page("d0", "src-a", 0)]));
  await putSource({
    id: "src-a",
    runId: id,
    name: "LOP999001_BUNDLE.pdf",
    bytes: new ArrayBuffer(8),
  });

  await deleteRun(id);

  assert.equal(await getRun(id), null);
  // Orphans are the reason this matters: a page record with no run is
  // unreachable through `getRun` and still occupies the origin's quota, and
  // a 29-page bundle's PDFs are tens of megabytes. Quota exhaustion surfaces
  // as a failed write on some LATER run the operator does care about.
  assert.equal(await getPage("d0"), null);
  assert.equal(await getSource("src-a"), null);
});

// ---------------------------------------------------------------------------
// 2. Ingesting a further document is additive
// ---------------------------------------------------------------------------

/**
 * The persistence half of `ingestDocument`, with the Web Worker taken out.
 *
 * The real function renders and OCRs in a worker and writes each page as it
 * finishes; neither the worker nor pdf.js exists under `node --test`. What is
 * reproduced here is exactly the sequence of WRITES it performs -- one
 * `putRun` to record the new source, then one `appendPage` per page, each
 * carrying the revision the last one left behind -- because that sequence is
 * what the storage layer has to survive.
 */
async function ingestPages(
  start: RunMeta,
  sourceId: string,
  name: string,
  pages: StoredPage[],
  firstOrder: number,
  between?: (pageNumber: number) => Promise<void>,
): Promise<RunMeta> {
  // Annotated, not inferred: `putRun` hands back a whole `BrowserRun` and
  // `appendPage` hands back only the meta, so an inferred `BrowserRun` here
  // would not accept the loop's own result.
  let meta: RunMeta = await putRun({
    ...start,
    sources: [...start.sources, { id: sourceId, name, pageCount: pages.length }],
    // Read back rather than carried in: `putRun` is a whole-run write, so it
    // has to be given every page already stored. Handing it the caller's
    // (page-less) meta is precisely the stale write the tests below are about.
    pages: (await getRun(start.id))?.pages ?? [],
  });

  for (const [n, p] of pages.entries()) {
    meta = await appendPage(meta, p, firstOrder + n);
    if (between) await between(n);
  }
  return meta;
}

test("ingesting a second document appends, and discards no confirmed zone", async () => {
  const id = runId("additive");
  const first = [page("a0", "src-a", 0), page("a1", "src-a", 1)];
  await putRun(freshRun(id, first));

  const before = await getRun(id);
  assert.ok(before);
  const positionOfA1 = before.pages.findIndex((p) => p.id === "a1");

  await ingestPages(
    before,
    "src-b",
    "TAMBAHAN.pdf",
    [page("b0", "src-b", 0), page("b1", "src-b", 1)],
    before.pages.length,
  );

  const after = await getRun(id);
  assert.ok(after);

  // APPENDED. Earlier pages keep their positions, which is the whole reason
  // the array is append-only: a zone's pageIndex is a position in it.
  assert.deepEqual(
    after.pages.map((p) => p.id),
    ["a0", "a1", "b0", "b1"],
  );
  assert.equal(after.pages.findIndex((p) => p.id === "a1"), positionOfA1);
  assert.deepEqual(after.pages.slice(0, 2), first);

  // The operator's confirmed zone is untouched, and still points at the page
  // it pointed at before the second document arrived.
  const confirmed = after.slots.find((s) => s.key === "kb.nomor");
  assert.deepEqual(confirmed, confirmedSlot);
  assert.equal(after.pages[confirmed!.zone!.pageIndex].id, "a1");

  // Each document keeps its OWN 0-based page numbering; the run-global number
  // is the array position. Confusing the two sends a reviewer to the wrong
  // document for every page after the first source file.
  assert.deepEqual(
    after.pages.map((p) => [p.sourceId, p.index]),
    [
      ["src-a", 0],
      ["src-a", 1],
      ["src-b", 0],
      ["src-b", 1],
    ],
  );
  assert.deepEqual(
    after.sources.map((s) => s.id),
    ["src-a", "src-b"],
  );
});

// ---------------------------------------------------------------------------
// 3. A stale write is refused, loudly
// ---------------------------------------------------------------------------

test("a saveRun captured before an ingest is REFUSED, and the ingest's pages survive", async () => {
  const id = runId("stale");
  await putRun(freshRun(id, [page("s0", "src-a", 0)]));

  // The UI loads the run and holds it in React state while the operator works.
  const held = await loadRun(id);
  assert.ok(held);
  assert.equal(held.pages.length, 1);

  // An ingest runs underneath for what would be minutes on a real bundle.
  await ingestPages(
    held,
    "src-b",
    "TAMBAHAN.pdf",
    [page("s1", "src-b", 0), page("s2", "src-b", 1), page("s3", "src-b", 2)],
    1,
  );

  // The operator now accepts a zone. `{ ...held, slots }` is the natural
  // edit, and `held` still carries exactly the one page it was read with.
  const edit: BrowserRun = {
    ...held,
    slots: held.slots.map((s) =>
      s.key === "kb.tanggal" ? { ...s, status: "confirmed" as const } : s,
    ),
  };

  // THE DEFECT. This used to resolve successfully and delete pages s1, s2 and
  // s3 on the way.
  //
  // The outcome is checked before the error is, deliberately. Asserting the
  // throw first would make this test report "missing expected rejection"
  // against the broken code, which describes the missing guard rather than
  // the harm; what the guard is FOR is that three pages of OCR are still on
  // the device afterwards. Against the old implementation the assertion below
  // is the one that fires, and it says so.
  let refusal: unknown;
  await saveRun(edit).catch((error: unknown) => {
    refusal = error;
  });

  const after = await getRun(id);
  assert.ok(after);
  assert.deepEqual(
    after.pages.map((p) => p.id),
    ["s0", "s1", "s2", "s3"],
    "every page the ingest wrote must still be stored",
  );
  // And the refused edit was not applied either: a refusal changes nothing.
  assert.equal(after.slots.find((s) => s.key === "kb.tanggal")?.status, "outstanding");

  // Refused LOUDLY. Silently ignoring the write would keep the pages and lose
  // the operator's edit instead, which is the same class of failure wearing
  // different clothes.
  assert.ok(refusal instanceof StaleRunWriteError, "the stale save must throw");
  assert.equal(refusal.runId, id);
  assert.equal(refusal.expected, 1);
  assert.equal(refusal.actual, 5); // 1 create + 1 source + 3 pages
  assert.match(refusal.message, /moved on/);
});

test("a stale save INTERLEAVED with the ingest is refused without stopping it", async () => {
  const id = runId("interleave");
  await putRun(freshRun(id, [page("i0", "src-a", 0)]));

  const held = await loadRun(id);
  assert.ok(held);

  const refusals: StaleRunWriteError[] = [];

  // The save is attempted from inside the ingest, between two page writes --
  // the ordering a real tab produces when the operator clicks while OCR is
  // running. It must be refused, and the ingest must carry on regardless.
  await ingestPages(
    held,
    "src-b",
    "TAMBAHAN.pdf",
    [page("i1", "src-b", 0), page("i2", "src-b", 1), page("i3", "src-b", 2)],
    1,
    async (pageNumber) => {
      if (pageNumber !== 0) return;
      await assert.rejects(
        () => saveRun({ ...held, slots: [] }),
        (error: unknown) => {
          refusals.push(error as StaleRunWriteError);
          return error instanceof StaleRunWriteError;
        },
      );
    },
  );

  assert.equal(refusals.length, 1);

  const after = await getRun(id);
  assert.ok(after);
  assert.deepEqual(
    after.pages.map((p) => p.id),
    ["i0", "i1", "i2", "i3"],
    "the ingest must finish all three pages after the refused save",
  );
  // `slots: []` was the stale write's payload. It must not have landed.
  assert.equal(after.slots.length, 3);
});

test("the run saveRun hands back is the one to keep, so consecutive edits work", async () => {
  const id = runId("chain");
  await putRun(freshRun(id, [page("c0", "src-a", 0)]));

  let current = await loadRun(id);
  assert.ok(current);

  // Three edits in a row, each saving what the last save returned. This is
  // the ordinary path, and a revision check that made it fail would be worse
  // than the bug it fixes.
  for (const label of ["one", "two", "three"]) {
    current = await saveRun({
      ...current,
      slots: [{ key: "kb.nomor", label, status: "confirmed" }],
    });
  }

  assert.equal(current.rev, 4);
  const loaded = await getRun(id);
  assert.equal(loaded?.slots[0].label, "three");
  assert.equal(loaded?.rev, 4);

  // Saving a revision that has already been superseded is refused even though
  // this writer is the one that superseded it.
  await assert.rejects(
    () => saveRun({ ...current, rev: 2, slots: [] }),
    StaleRunWriteError,
  );
});

test("a write that would drop a stored page is refused even at the right revision", async () => {
  const id = runId("pageloss");
  const saved = await putRun(
    freshRun(id, [page("g0", "src-a", 0), page("g1", "src-a", 1), page("g2", "src-a", 2)]),
  );

  // Current revision, correct in every other way, and simply not carrying one
  // of the pages -- a caller that filtered its own array by mistake. There is
  // no such thing as a legitimate single-page removal: a zone's pageIndex is
  // a position in this array, so dropping the middle page repoints every zone
  // after it at the wrong document.
  await assert.rejects(
    () => saveRun({ ...saved, pages: saved.pages.filter((p) => p.id !== "g1") }),
    (error: unknown) => {
      assert.ok(error instanceof PageLossError);
      assert.deepEqual(error.missing, ["g1"]);
      return true;
    },
  );

  const after = await getRun(id);
  assert.deepEqual(
    after?.pages.map((p) => p.id),
    ["g0", "g1", "g2"],
  );
});

test("a save cannot resurrect a deleted run", async () => {
  const id = runId("resurrect");
  const saved = await putRun(freshRun(id, [page("r0", "src-a", 0)]));

  // Another tab -- or this operator, on the run list -- deletes it.
  await deleteRun(id);

  // The screen still holding the run saves. Writing it back would recreate a
  // run the operator deleted, minus every page, and report success.
  await assert.rejects(
    () => saveRun({ ...saved, slots: [] }),
    (error: unknown) => {
      assert.ok(error instanceof StaleRunWriteError);
      assert.equal(error.actual, null);
      assert.match(error.message, /resurrect/);
      return true;
    },
  );

  assert.equal(await getRun(id), null);
});

test("createRun refuses to flatten a run that already exists under that id", async () => {
  const id = runId("collide");
  await createRun(id);
  const first = await loadRun(id);
  assert.ok(first);

  await putRun({ ...first, slots: [{ key: "k", label: "kept", status: "confirmed" }] });

  // A second createRun on the same id is a fresh, empty run at revision 0.
  // Accepting it would wipe the slots above without a word.
  await assert.rejects(() => createRun(id), StaleRunWriteError);

  const after = await loadRun(id);
  assert.equal(after?.slots.length, 1);
  assert.equal(after?.slots[0].label, "kept");
});

test("appendPage refuses a page for a run that is not stored", async () => {
  // An append with nothing to append to means the caller's ordering is wrong.
  // Creating the run here instead would hide that and leave a run whose
  // sources list does not mention the document its pages came from.
  const id = runId("orphan");
  await assert.rejects(
    () =>
      appendPage(
        { id, createdAt: 1, rev: 0, sources: [], slots: [] },
        page("o0", "src-a", 0),
        0,
      ),
    StaleRunWriteError,
  );
  assert.equal(await getPage("o0"), null);
});
