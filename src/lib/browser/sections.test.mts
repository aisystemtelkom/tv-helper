/**
 * Tests for the SECTION-EDIT ENGINE: `src/lib/browser/sections.ts` and the
 * `editSections` binding in `src/lib/browser/runtime.ts`.
 *
 * ## What is actually at risk here
 *
 * `run.overlay` is the ONLY place an operator's naming work exists, and
 * `run.slots` is the only place a discovered capture exists. A section edit
 * touches both lists at once, which makes it the one operation in this codebase
 * that can trip all three of `putRun`'s content guards -- and every one of
 * those guards refuses rather than repairs, so an engine that computes the
 * wrong opt-in does not lose data, it stops the operator working with a
 * sentence about revisions they cannot act on.
 *
 * The failures these pin, in the order they would be met:
 *
 *   - a rename that rebuilt `run.slots` to carry the new label, arriving at
 *     storage shaped exactly like the rebuild-from-template write
 *     `CaptureLossError` exists to refuse;
 *   - a judul removed without its states, leaving ORPHANS -- and an orphan
 *     carrying a zone BLOCKS the export from a row the outstanding panel draws
 *     with no button (`stateIndex: -1`), so the remedy is unreachable;
 *   - a judul added or restored WITHOUT seeding its bagian, which produces that
 *     same buttonless blocking row on the happy path of the feature;
 *   - a whole-page capture accepted over a page with no OCR lines, citing line
 *     0 of a page that has none, under a picture a validator signs.
 *
 * ## fake-indexeddb
 *
 * Most of this file is pure and needs no storage at all. The last section
 * drives the REAL `putRun`/`appendPage` through `editSections`, because the
 * whole reason an edit is a value rather than a run is a revision race, and a
 * race is not something a pure test can have. See `persistence.test.mts` for
 * why the fake is a spec implementation rather than a hand-rolled Map.
 */

import { emptyConfigCheck, emptyEpicCheck } from "../config/types.ts";
import "fake-indexeddb/auto";

import assert from "node:assert/strict";
import test from "node:test";

import {
  OverlayError,
  emptyOverlay,
  resolveTemplate,
  type ProposedSection,
} from "../forms/overlay.ts";
import { AO_TEMPLATE } from "../forms/template.ts";
import {
  CaptureLossError,
  appendPage,
  getRun,
  putRun,
  StaleRunWriteError,
  type RunMeta,
} from "../storage/runs.ts";
import { applySectionEdit, type MintId } from "./sections.ts";
import { editSections, saveRun, seedSlots } from "./runtime.ts";
import type { BrowserRun, StoredPage } from "./types.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let counter = 0;
const runId = (name: string) => `sections-${name}-${(counter += 1)}`;

/**
 * A deterministic `mintId`.
 *
 * The real one is `crypto.randomUUID()`, which is exactly what a test cannot
 * assert against. The shape still has to be a legal `NodeId`: `u:`-prefixed so
 * it cannot collide with a declared id, and free of `#` so `slotKeyOf` cannot
 * read part of it as a capture ordinal.
 */
function mintIds(): MintId {
  let n = 0;
  return () => `u:00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`;
}

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
        words: [{ text: "page", box: { x: 100, y: 200, w: 200, h: 40 } }],
      },
      {
        i: 1,
        text: "BANK CONTOH NUSANTARA",
        box: { x: 100, y: 260, w: 900, h: 40 },
        words: [{ text: "BANK", box: { x: 100, y: 260, w: 200, h: 40 } }],
      },
    ],
  };
}

const ZONE = {
  pageIndex: 0,
  box: { x: 120, y: 240, w: 800, h: 90 },
  lineRange: [0, 1] as [number, number],
};

const LANJUTAN_ZONE = {
  pageIndex: 1,
  box: { x: 120, y: 300, w: 800, h: 200 },
  lineRange: [0, 1] as [number, number],
};

/**
 * A run seeded exactly as production seeds one, with a confirmed crop and a
 * discovered lanjutan under `kb.nomor`.
 *
 * BOTH CARRY A ZONE, which is what makes the removal tests mean anything: only
 * a zone-carrying state needs naming in `putRun`'s `removing`, and the lanjutan
 * is the one a key-only sweep would miss.
 */
function runWithEvidence(id: string): BrowserRun {
  const seeded = seedSlots(AO_TEMPLATE).map((slot) =>
    slot.key === "kb.nomor"
      ? {
          ...slot,
          status: "confirmed" as const,
          origin: "human" as const,
          text: "Nomor: 1-70000000001",
          zone: ZONE,
        }
      : slot,
  );
  return {
    id,
    createdAt: 1_700_000_000_000,
    rev: 0,
    sources: [
      { id: "src-a", name: "LOP999001_BUNDLE.pdf", pageCount: 3, digest: "d-a" },
    ],
    pages: [page("p0", "src-a", 0), page("p1", "src-a", 1), page("p2", "src-a", 2)],
    slots: [
      ...seeded,
      {
        key: "kb.nomor#2",
        label: "Nomor",
        status: "confirmed",
        origin: "llm",
        text: "sambungan pasal",
        zone: LANJUTAN_ZONE,
      },
    ],
    overlay: emptyOverlay(AO_TEMPLATE),
    konfigurasi: emptyConfigCheck(),
    epic: emptyEpicCheck(),
  };
}

/** One usulan the model made out of the bundle, spanning two pages. */
const PROPOSAL: ProposedSection = {
  id: "u:00000000-0000-4000-8000-0000000000b1",
  title: "Berita Acara Uji Terima",
  fromSourceId: "src-a",
  fromPages: [1, 2],
  cite: { pageIndex: 1, lineRange: [0, 1] },
};

function runWithProposal(id: string): BrowserRun {
  const base = runWithEvidence(id);
  return {
    ...base,
    overlay: { ...base.overlay, proposed: [PROPOSAL] },
  };
}

/** The section ids the packet actually renders, in order. */
function renderedIds(run: BrowserRun): string[] {
  return resolveTemplate(AO_TEMPLATE, run.overlay).sections.map((s) => s.id);
}

// ---------------------------------------------------------------------------
// 1. Renaming touches no evidence
// ---------------------------------------------------------------------------

test("a rename writes the overlay and NOTHING else, so no guard can fire", () => {
  /*
   * THE PROOF RATHER THAN THE REASSURANCE. `CaptureLossError`'s entire input is
   * `slot.key` and `slot.zone` -- `putRun` builds a map from the incoming slots
   * and compares each stored zone-carrier against it -- so a write whose
   * `run.slots` is the STORED ARRAY ITSELF gives that guard nothing to find.
   *
   * The alternative design is the obvious one: copy the new label onto every
   * matching `SlotState`. It looks like a rename and arrives at storage shaped
   * like a rebuild from the template, which is the exact write that guard was
   * added for.
   */
  const run = runWithEvidence(runId("rename"));

  const result = applySectionEdit(run, {
    tag: "rename-section",
    id: "kb",
    title: "PKS Induk",
  });

  assert.deepEqual(result.removing, []);
  assert.deepEqual(result.removingSections, []);
  assert.equal(result.run.slots, run.slots, "a rename must not rebuild the slots");
  assert.deepEqual(result.run.slots, run.slots);
  assert.equal(result.run.pages, run.pages);
  assert.equal(result.run.overlay.sections.kb.title, "PKS Induk");

  // And the operator's word is what the packet is headed with.
  const section = resolveTemplate(AO_TEMPLATE, result.run.overlay).sections.find(
    (s) => s.id === "kb",
  );
  assert.equal(section?.title, "PKS Induk");
  // The FROZEN half is untouched: `ask.title` is what the measurement gate's
  // question is composed from, and no operator edit may move it.
  assert.equal(section?.ask.title, "KB");
});

test("renaming a bagian writes a slot patch and leaves its captures alone", () => {
  const run = runWithEvidence(runId("rename-slot"));

  const result = applySectionEdit(run, {
    tag: "rename-slot",
    id: "kb.nomor",
    label: "No. PKS",
  });

  assert.deepEqual(result.removing, []);
  assert.deepEqual(result.removingSections, []);
  assert.equal(result.run.slots, run.slots);
  assert.equal(result.run.overlay.slots["kb.nomor"].label, "No. PKS");

  const slot = resolveTemplate(AO_TEMPLATE, result.run.overlay)
    .sections.find((s) => s.id === "kb")
    ?.slots.find((s) => s.key === "kb.nomor");
  assert.equal(slot?.label, "No. PKS");
  // `ask.label` is the model's name for the row and is seeded once, then
  // frozen. This is the whole reason `SlotAsk` was split out of `SlotDef`.
  assert.equal(slot?.ask.label, "Nomor");
});

test("an ADDED judul is renamed in place, never through a patch", () => {
  /*
   * ONE ID, ONE HOME. `assertOverlay` refuses an overlay whose `sections`
   * names an added id at all, so writing a patch here would not merely be
   * untidy: the very next save would throw, and the operator's rename would be
   * lost behind an error about an id collision.
   */
  const run = runWithEvidence(runId("rename-added"));
  const added = applySectionEdit(
    run,
    { tag: "add-section", title: "Lampiran Harga" },
    mintIds(),
  );
  const id = added.run.overlay.added[0].id;

  const renamed = applySectionEdit(added.run, {
    tag: "rename-section",
    id,
    title: "Lampiran Harga (revisi)",
  });

  assert.equal(renamed.run.overlay.added[0].title, "Lampiran Harga (revisi)");
  assert.equal(
    id in renamed.run.overlay.sections,
    false,
    "an added judul must not grow a second spelling of its title",
  );
  assert.deepEqual(renamed.removingSections, []);
});

test("a blank heading is refused, and an unknown id is refused", () => {
  const run = runWithEvidence(runId("rename-refuse"));

  assert.throws(
    () => applySectionEdit(run, { tag: "rename-section", id: "kb", title: "   " }),
    OverlayError,
  );
  assert.throws(
    () =>
      applySectionEdit(run, {
        tag: "rename-section",
        id: "not-a-judul",
        title: "Apa pun",
      }),
    /no judul with id/,
  );
  assert.throws(
    () => applySectionEdit(run, { tag: "rename-slot", id: "kb.tidakAda", label: "X" }),
    /no bagian with key/,
  );
});

// ---------------------------------------------------------------------------
// 2. Moving, and rearranging the whole packet
// ---------------------------------------------------------------------------

test("moving a judul writes an order and touches no state", () => {
  const run = runWithEvidence(runId("move"));

  const moved = applySectionEdit(run, {
    tag: "move-section",
    id: "kb-lanjutan",
    by: -1,
  });

  assert.deepEqual(moved.removing, []);
  assert.deepEqual(moved.removingSections, []);
  assert.equal(moved.run.slots, run.slots);
  assert.deepEqual(renderedIds(moved.run).slice(0, 3), [
    "kb-lanjutan",
    "kb",
    "konfigurasi-epic",
  ]);
});

test("a move skips a hidden judul, and the hidden one keeps its place", () => {
  /*
   * A removed judul stays in the stored order so that restoring it puts it back
   * where the operator left it. Swapping with it would therefore be a button
   * that appears to do nothing: the packet is unchanged, because the neighbour
   * is not in it.
   */
  const run = runWithEvidence(runId("move-hidden"));
  const hidden = applySectionEdit(run, {
    tag: "remove-section",
    id: "kb-lanjutan",
    // `kb-lanjutan` holds seeded bagian but no zone in this fixture, so the
    // removal owes no opt-in. See the `removing` tests below.
  });
  assert.deepEqual(renderedIds(hidden.run).slice(0, 2), ["kb", "konfigurasi-epic"]);

  const moved = applySectionEdit(hidden.run, {
    tag: "move-section",
    id: "konfigurasi-epic",
    by: -1,
  });
  assert.deepEqual(renderedIds(moved.run).slice(0, 2), ["konfigurasi-epic", "kb"]);

  // And `kb-lanjutan` comes back between them, where it was, rather than at the
  // bottom of the packet -- which is what an order written from the RESOLVED
  // list would have produced.
  const restored = applySectionEdit(moved.run, {
    tag: "restore-section",
    id: "kb-lanjutan",
  });
  assert.deepEqual(renderedIds(restored.run).slice(0, 3), [
    "konfigurasi-epic",
    "kb-lanjutan",
    "kb",
  ]);
});

test("moving past the end of the packet changes nothing, by identity", () => {
  const run = runWithEvidence(runId("move-edge"));
  // `kb` is the first judul in the packet, so there is nowhere above it to go.
  const first = applySectionEdit(run, { tag: "move-section", id: "kb", by: -1 });

  // IDENTITY, not an equal copy: `editSections` skips the write on it, so a
  // press that did nothing does not advance the revision and refuse whatever
  // the screen is holding.
  assert.equal(first.run, run);
  assert.deepEqual(first.removing, []);
  assert.deepEqual(first.removingSections, []);
});

test("a reorder rewrites the whole packet at once and touches no state", () => {
  const run = runWithEvidence(runId("reorder"));
  assert.deepEqual(renderedIds(run), [
    "kb",
    "kb-lanjutan",
    "konfigurasi-epic",
    "konfigurasi",
  ]);

  const moved = applySectionEdit(run, {
    tag: "reorder-sections",
    ids: ["konfigurasi", "kb", "konfigurasi-epic", "kb-lanjutan"],
  });

  assert.deepEqual(renderedIds(moved.run), [
    "konfigurasi",
    "kb",
    "konfigurasi-epic",
    "kb-lanjutan",
  ]);
  // A rearrangement is a name-level edit, exactly as a rename and a move are:
  // the evidence array passes through by reference, so `CaptureLossError` has
  // nothing to find and neither opt-in is spent.
  assert.deepEqual(moved.removing, []);
  assert.deepEqual(moved.removingSections, []);
  assert.equal(moved.run.slots, run.slots);
  assert.equal(moved.run.pages, run.pages);
});

test("a reorder splices into the VISIBLE positions, and a hidden judul keeps its place", () => {
  /*
   * The same property `move-section` has, tested the same way round: a removed
   * judul keeps its stored POSITION so that "Kembalikan" puts it back where the
   * operator left it. The screen can neither show nor submit a hidden judul, so
   * an arrangement written out as the whole order would drop every hidden id
   * from it -- and `ordered()` appends what an order does not name, so the next
   * restore would land at the bottom of the packet instead.
   */
  const run = runWithEvidence(runId("reorder-hidden"));
  const hidden = applySectionEdit(run, { tag: "remove-section", id: "kb-lanjutan" });
  assert.deepEqual(renderedIds(hidden.run), [
    "kb",
    "konfigurasi-epic",
    "konfigurasi",
  ]);

  const moved = applySectionEdit(hidden.run, {
    tag: "reorder-sections",
    ids: ["konfigurasi", "konfigurasi-epic", "kb"],
  });

  assert.deepEqual(renderedIds(moved.run), [
    "konfigurasi",
    "konfigurasi-epic",
    "kb",
  ]);
  // THE STORED ORDER STILL NAMES THE HIDDEN JUDUL, at the index it already
  // held: the three submitted ids took the three visible positions and index 1
  // was not one of them.
  assert.deepEqual(moved.run.overlay.order, [
    "konfigurasi",
    "kb-lanjutan",
    "konfigurasi-epic",
    "kb",
  ]);

  const restored = applySectionEdit(moved.run, {
    tag: "restore-section",
    id: "kb-lanjutan",
  });
  assert.deepEqual(renderedIds(restored.run), [
    "konfigurasi",
    "kb-lanjutan",
    "konfigurasi-epic",
    "kb",
  ]);
});

test("a reorder that FORGETS a judul is refused rather than quietly appended", () => {
  /*
   * THE FAILURE THIS EDIT EXISTS TO REFUSE. `ordered()` appends whatever an
   * order does not name -- deliberately, so that a forgotten id is never a
   * deleted judul -- which means a short arrangement throws nothing, loses
   * nothing, and ships the omitted heading at the BOTTOM of a packet that opens
   * cleanly.
   */
  const run = runWithEvidence(runId("reorder-short"));

  assert.throws(
    () =>
      applySectionEdit(run, {
        tag: "reorder-sections",
        ids: ["kb", "kb-lanjutan", "konfigurasi-epic"],
      }),
    (error: unknown) => {
      assert.ok(error instanceof OverlayError);
      assert.match(error.message, /does not name "konfigurasi"/);
      return true;
    },
  );

  // And nothing was written on the way to refusing.
  assert.equal(run.overlay.order, undefined);
  assert.deepEqual(renderedIds(run), [
    "kb",
    "kb-lanjutan",
    "konfigurasi-epic",
    "konfigurasi",
  ]);
});

test("a reorder naming a judul this order does not print is refused, hidden or unknown", () => {
  const run = runWithEvidence(runId("reorder-unknown"));

  assert.throws(
    () =>
      applySectionEdit(run, {
        tag: "reorder-sections",
        ids: ["kb", "kb-lanjutan", "konfigurasi-epic", "u:never-existed"],
      }),
    /is not a judul this order prints/,
  );

  // A HIDDEN judul gets its own sentence: the id is real, and the remedy is to
  // restore it rather than to correct a typo.
  const hidden = applySectionEdit(run, { tag: "remove-section", id: "kb-lanjutan" });
  assert.throws(
    () =>
      applySectionEdit(hidden.run, {
        tag: "reorder-sections",
        ids: ["kb", "kb-lanjutan", "konfigurasi-epic", "konfigurasi"],
      }),
    /this order is hiding/,
  );
});

test("a reorder naming one judul twice is refused", () => {
  /*
   * The other half of the permutation rule, and the same silence: the resolver
   * places the first mention and ignores the second, so one heading moves, one
   * stays, and the packet reads as if the drag half worked.
   */
  const run = runWithEvidence(runId("reorder-duplicate"));

  assert.throws(
    () =>
      applySectionEdit(run, {
        tag: "reorder-sections",
        ids: ["kb", "kb", "kb-lanjutan", "konfigurasi-epic"],
      }),
    (error: unknown) => {
      assert.ok(error instanceof OverlayError);
      assert.match(error.message, /names "kb" a second time/);
      return true;
    },
  );
});

test("a reorder that changes nothing returns the run by identity", () => {
  const run = runWithEvidence(runId("reorder-noop"));

  // A drag that ended where it started. `editSections` skips the write on
  // identity, so this must not advance the revision and refuse whatever the
  // screen is holding.
  const same = applySectionEdit(run, {
    tag: "reorder-sections",
    ids: ["kb", "kb-lanjutan", "konfigurasi-epic", "konfigurasi"],
  });

  assert.equal(same.run, run);
  assert.deepEqual(same.removing, []);
  assert.deepEqual(same.removingSections, []);
});

test("the arrangement the SCREEN hands back is a permutation this edit accepts, hidden judul and all", () => {
  /*
   * THE CONTRACT BETWEEN `SusunanJudul` AND THIS EDIT, pinned in the one place
   * that can hold both ends of it.
   *
   * `susunanRows` (`src/lib/ui/headings.ts`) builds the list the shell hands
   * the component out of `template.sections`, which is
   * `resolveTemplate(AO_TEMPLATE, run.overlay).sections` -- exactly what
   * `renderedIds` is, and `ui.test.mts` drives that builder through this same
   * edit. The component then hands that list back permuted.
   * `reorderSections` computes its OWN idea of the visible judul, out of
   * `fullOrder` filtered by `isVisible`, and REFUSES anything that is not a
   * permutation of it. Those are two separate derivations of one list, in two
   * files, agreeing by nothing but construction: if they ever disagree, every
   * drag on the happy path is refused in front of an operator.
   *
   * So this drives the round trip over the hardest overlay available -- a judul
   * the operator ADDED, one they HID in the middle of the packet, and an
   * arrangement already stored from an earlier move -- rather than over the
   * unedited base, where the two derivations cannot differ.
   *
   * AND IT PINS WHAT THE HIDDEN JUDUL MAY NOT DO. `overlay.order` carries
   * hidden ids and the screen can neither see nor submit one, so a reorder is
   * spliced into the visible positions. The hidden judul must come out of that
   * neither moved, nor dropped, nor back in the packet.
   */
  const seeded = runWithEvidence(runId("reorder-contract"));
  const mint = mintIds();

  const added = applySectionEdit(
    seeded,
    { tag: "add-section", title: "Berita Acara Uji Terima" },
    mint,
  ).run;
  const addedId = added.overlay.added[0].id;

  // HIDDEN IN THE MIDDLE OF THE PACKET, not at its end: a splice that wrote the
  // submitted list out as the whole order would be indistinguishable from a
  // correct one if the only hidden id sat past the last visible position.
  const hidden = applySectionEdit(added, {
    tag: "remove-section",
    id: "kb-lanjutan",
  }).run;

  // AND AN ARRANGEMENT ALREADY STORED, so this reorder is rewriting an order
  // rather than writing the first one.
  const arranged = applySectionEdit(hidden, {
    tag: "move-section",
    id: "konfigurasi",
    by: -1,
  }).run;

  const before = arranged.overlay.order ?? [];
  assert.deepEqual(before, [
    "kb",
    "kb-lanjutan",
    "konfigurasi",
    "konfigurasi-epic",
    addedId,
  ]);

  // What the screen draws, and therefore what it hands back.
  const onScreen = renderedIds(arranged);
  assert.deepEqual(onScreen, ["kb", "konfigurasi", "konfigurasi-epic", addedId]);

  // A DRAG THAT ENDED WHERE IT STARTED. The component refuses to call at all,
  // and this is the second net under that: identity, so `editSections` skips
  // the write instead of advancing the revision for nothing.
  assert.equal(
    applySectionEdit(arranged, { tag: "reorder-sections", ids: onScreen }).run,
    arranged,
  );

  const wanted = [addedId, "konfigurasi-epic", "kb", "konfigurasi"];
  const moved = applySectionEdit(arranged, {
    tag: "reorder-sections",
    ids: wanted,
  });

  // The packet now prints exactly what was dragged, in that order.
  assert.deepEqual(renderedIds(moved.run), wanted);

  const after = moved.run.overlay.order ?? [];
  // NOTHING GAINED AND NOTHING LOST: the stored order is the same multiset of
  // ids it was, so the hidden judul was neither dropped nor duplicated.
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.deepEqual(
    after.filter((id) => id === "kb-lanjutan"),
    ["kb-lanjutan"],
  );
  // NOT MOVED: it keeps the index it already held, because the four submitted
  // ids took the four VISIBLE positions and index 1 was not one of them.
  assert.equal(after.indexOf("kb-lanjutan"), before.indexOf("kb-lanjutan"));
  // NOT RESURRECTED: the tombstone is untouched and the packet is still four
  // judul long.
  assert.equal(moved.run.overlay.sections["kb-lanjutan"]?.removed, true);
  assert.ok(!renderedIds(moved.run).includes("kb-lanjutan"));

  // A NAME-LEVEL EDIT, so none of `putRun`'s content guards is owed anything:
  // the evidence and the pages pass through BY REFERENCE, and nothing the
  // operator authored is discarded.
  assert.deepEqual(moved.removing, []);
  assert.deepEqual(moved.removingSections, []);
  assert.equal(moved.run.slots, arranged.slots);
  assert.equal(moved.run.pages, arranged.pages);
  assert.deepEqual(moved.run.overlay.added, arranged.overlay.added);

  // And "Kembalikan" still puts it back where the operator left it.
  const restored = applySectionEdit(moved.run, {
    tag: "restore-section",
    id: "kb-lanjutan",
  });
  assert.deepEqual(renderedIds(restored.run), [
    addedId,
    "kb-lanjutan",
    "konfigurasi-epic",
    "kb",
    "konfigurasi",
  ]);
});

// ---------------------------------------------------------------------------
// 3. Removing a judul takes its states with it
// ---------------------------------------------------------------------------

test("removing a judul drops every state under it and NAMES the ones with a crop", () => {
  const run = runWithEvidence(runId("remove"));

  const result = applySectionEdit(run, { tag: "remove-section", id: "kb" });

  // The judul is gone from the packet, but the form still declares it, so it is
  // tombstoned rather than forgotten.
  assert.equal(renderedIds(result.run).includes("kb"), false);
  assert.equal(result.run.overlay.sections.kb.removed, true);

  // EVERY state under it, the discovered lanjutan included. Leaving `kb.nomor#2`
  // behind would make it an orphan carrying a zone, which blocks the export
  // from a row the outstanding panel renders with no button.
  const keys = result.run.slots.map((s) => s.key);
  for (const gone of ["kb.nomor", "kb.nomor#2", "kb.paraPihak", "kb.tanggal", "kb.jangkaWaktu"]) {
    assert.equal(keys.includes(gone), false, `${gone} must go with its judul`);
  }
  // Other judul are untouched.
  assert.ok(keys.includes("kbLanjutan.top"));
  assert.ok(keys.includes("kbLanjutan.ttdPejabat"));

  // ONLY THE ZONE-CARRIERS ARE NAMED, which is precisely `CaptureLossError`'s
  // own test: a capture nobody found evidence for costs nothing to re-seed, and
  // naming it would spend the opt-in on nothing.
  assert.deepEqual(result.removing.slice().sort(), ["kb.nomor", "kb.nomor#2"]);
  // A base judul's tombstone discards no authored name, so nothing is owed here.
  assert.deepEqual(result.removingSections, []);
});

test("removing an ADDED judul names its id, because that name existed nowhere else", () => {
  const run = runWithEvidence(runId("remove-added"));
  const added = applySectionEdit(
    run,
    { tag: "add-section", title: "Lampiran Harga" },
    mintIds(),
  );
  const id = added.run.overlay.added[0].id;
  const slotId = added.run.overlay.added[0].slots[0].id;

  const removed = applySectionEdit(added.run, { tag: "remove-section", id });

  assert.deepEqual(removed.run.overlay.added, []);
  assert.equal(
    removed.run.slots.some((slot) => slot.key === slotId),
    false,
    "the added bagian's state must go with the judul, or it is an orphan",
  );
  // The judul the operator typed is authored work, and this write discards it.
  // `SectionLossError` refuses the write without this opt-in.
  assert.deepEqual(removed.removingSections, [id]);
  // The seeded state carried no zone, so there is no potongan to confirm.
  assert.deepEqual(removed.removing, []);
});

test("a renamed judul keeps the operator's word across remove and restore", () => {
  const run = runWithEvidence(runId("remove-keeps-name"));
  const renamed = applySectionEdit(run, {
    tag: "rename-section",
    id: "kb",
    title: "PKS Induk",
  });
  const removed = applySectionEdit(renamed.run, { tag: "remove-section", id: "kb" });

  // The title patch survives the tombstone, so nothing authored is discarded
  // and the removal owes no `removingSections` entry.
  assert.equal(removed.run.overlay.sections.kb.title, "PKS Induk");
  assert.deepEqual(removed.removingSections, []);

  const restored = applySectionEdit(removed.run, { tag: "restore-section", id: "kb" });
  const section = resolveTemplate(AO_TEMPLATE, restored.run.overlay).sections.find(
    (s) => s.id === "kb",
  );
  assert.equal(section?.title, "PKS Induk", "restoring must not revert their word");
});

test("removing a judul that is not in this order is refused, not ignored", () => {
  const run = runWithEvidence(runId("remove-unknown"));
  assert.throws(
    () => applySectionEdit(run, { tag: "remove-section", id: "u:never-existed" }),
    /no judul with id/,
  );
});

// ---------------------------------------------------------------------------
// 3b. The number the operator agreed to lose is the number that may be lost
// ---------------------------------------------------------------------------

test("remove-section REFUSES when the stored order would drop more potongan than were agreed", () => {
  /*
   * THE CONFIRMATION IS COMPUTED FROM ONE RUN AND APPLIED TO ANOTHER, and that
   * gap is minutes wide.
   *
   * `sectionRemovalCost` runs against the `BrowserRun` React is holding.
   * `editSections` re-reads inside the run lock and applies the edit to
   * whatever is STORED -- which is the whole point of an edit being a value,
   * and is also what makes the count stale. `ingestDocument` advances the
   * revision once per page across a 151-page document, and a Proses behind it
   * can attach potongan to any judul while the operator is reading the dialog.
   *
   * The visible shape on screen: `judul.tsx` skips the dialog entirely when
   * `cost.captures === 0`, so a judul that gained a confirmed crop during a
   * long ingest is deleted on one press, with no question asked, taking
   * evidence the operator was never told about. Everything downstream reports
   * success -- the revision is current, every page is carried, and `removing`
   * names the very captures being dropped, so `CaptureLossError` is satisfied
   * BY THE WRITE ITSELF.
   *
   * So the agreed number rides on the edit. Losing FEWER than agreed is fine
   * (the operator already said yes to more); losing MORE has to be asked again.
   */
  const run = runWithEvidence(runId("remove-stale-count"));

  // What the stored order actually holds under `kb`: two zone-carrying
  // captures, one of them a discovered lanjutan.
  const honest = applySectionEdit(run, { tag: "remove-section", id: "kb" });
  assert.deepEqual(honest.removing.slice().sort(), ["kb.nomor", "kb.nomor#2"]);

  // The press that asked nothing, because the screen's copy of the run had no
  // potongan under this judul yet.
  assert.throws(
    () =>
      applySectionEdit(run, {
        tag: "remove-section",
        id: "kb",
        droppingCaptures: 0,
      }),
    (error: unknown) => {
      assert.ok(error instanceof OverlayError);
      // BOTH COUNTS, because a refusal that names only one of them cannot be
      // turned into a sentence telling the operator what changed.
      assert.match(error.message, /\b0\b/);
      assert.match(error.message, /\b2\b/);
      // A distinct name, so the shell can print a Bahasa sentence for it
      // rather than falling through to "penyimpanan menolak tulisan terakhir",
      // which names the wrong cause.
      assert.equal(error.name, "CaptureCountChangedError");
      return true;
    },
  );

  // Nothing half-applied: the judul is still in the packet with its evidence.
  assert.ok(renderedIds(run).includes("kb"));
  assert.ok(run.slots.some((slot) => slot.key === "kb.nomor#2"));
});

test("the agreed number lets the removal through, and so does a larger one", () => {
  const run = runWithEvidence(runId("remove-agreed-count"));

  const agreed = applySectionEdit(run, {
    tag: "remove-section",
    id: "kb",
    droppingCaptures: 2,
  });
  assert.deepEqual(agreed.removing.slice().sort(), ["kb.nomor", "kb.nomor#2"]);
  assert.equal(renderedIds(agreed.run).includes("kb"), false);

  // FEWER THAN AGREED IS NOT A REFUSAL. The operator said yes to losing three;
  // losing two is the same decision with a smaller cost, and stopping them
  // would refuse a removal nobody objects to -- which happens whenever a
  // "Bukan ini" lands between the question and the answer.
  const fewer = applySectionEdit(run, {
    tag: "remove-section",
    id: "kb",
    droppingCaptures: 3,
  });
  assert.equal(fewer.removing.length, 2);
});

test("an omitted count is not a waiver, it is the caller not asking", () => {
  /*
   * `sectionRemovalCost` in `src/lib/ui/headings.ts` performs the real edit to
   * COUNT what it would drop, and that call must not be refused by the guard
   * it exists to feed. So absent means "no number was agreed", which is a
   * different statement from "zero were agreed" -- and the screens are the
   * ones that must pass the figure they showed.
   */
  const run = runWithEvidence(runId("remove-no-count"));

  const result = applySectionEdit(run, { tag: "remove-section", id: "kb" });
  assert.equal(result.removing.length, 2);

  // And zero agreed against zero held is not a refusal either: a judul whose
  // bagian carry no evidence is exactly the press `judul.tsx` performs with no
  // dialog, and it must keep working.
  const empty = applySectionEdit(run, {
    tag: "remove-section",
    id: "kb-lanjutan",
    droppingCaptures: 0,
  });
  assert.deepEqual(empty.removing, []);
  assert.equal(renderedIds(empty.run).includes("kb-lanjutan"), false);
});

// ---------------------------------------------------------------------------
// 4. Restoring re-seeds, because a judul with no rows blocks the export
// ---------------------------------------------------------------------------

test("restoring a base judul brings it back AND re-seeds its bagian as pending", () => {
  /*
   * THE RE-SEED IS THE OPERATION, not a tidy-up after it. `blockingItems`
   * pushes a blocking `kind: "pending"` with `stateIndex: -1` for a fillable
   * slot holding ZERO captures, and a `-1` index is a row the outstanding panel
   * deliberately draws WITH NO BUTTON. A judul restored without its rows would
   * block the export behind a control that does not exist.
   */
  const run = runWithEvidence(runId("restore"));
  const removed = applySectionEdit(run, { tag: "remove-section", id: "kb" });
  const restored = applySectionEdit(removed.run, { tag: "restore-section", id: "kb" });

  assert.ok(renderedIds(restored.run).includes("kb"));
  assert.equal("kb" in restored.run.overlay.sections, false, "the tombstone is lifted");

  const kb = restored.run.slots.filter((slot) => slot.key.startsWith("kb."));
  assert.deepEqual(
    kb.map((slot) => slot.key).sort(),
    ["kb.jangkaWaktu", "kb.nomor", "kb.paraPihak", "kb.tanggal"],
    "the template key VERBATIM, capture 1 wearing no ordinal, as seedSlots keys them",
  );
  for (const slot of kb) {
    assert.equal(slot.status, "pending");
    assert.equal(slot.zone, undefined);
  }
  // The lanjutan is NOT re-seeded: a continuation is discovered, never
  // declared, and inventing a `#2` row here is the operator report this whole
  // design came from ("ToP 1 and ToP 2, the second permanently missing").
  assert.equal(
    restored.run.slots.some((slot) => slot.key === "kb.nomor#2"),
    false,
  );

  // AN ADDITION IS NOT A LOSS: it names nothing in either list.
  assert.deepEqual(restored.removing, []);
  assert.deepEqual(restored.removingSections, []);
});

test("a re-seeded bagian carries the operator's own label", () => {
  const run = runWithEvidence(runId("restore-label"));
  const renamed = applySectionEdit(run, {
    tag: "rename-slot",
    id: "kb.nomor",
    label: "No. PKS",
  });
  const removed = applySectionEdit(renamed.run, { tag: "remove-section", id: "kb" });
  const restored = applySectionEdit(removed.run, { tag: "restore-section", id: "kb" });

  const seeded = restored.run.slots.find((slot) => slot.key === "kb.nomor");
  assert.equal(seeded?.label, "No. PKS");
});

test("restoring an added judul is refused: there is no tombstone to lift", () => {
  const run = runWithEvidence(runId("restore-added"));
  assert.throws(
    () =>
      applySectionEdit(run, {
        tag: "restore-section",
        id: "u:00000000-0000-4000-8000-000000000001",
      }),
    /no judul with id/,
  );
});

// ---------------------------------------------------------------------------
// 5. Adding a judul seeds its state in the same breath
// ---------------------------------------------------------------------------

test("add-section SEEDS a pending state, or the export blocks behind a buttonless row", () => {
  /*
   * `blockingItems` pushes `{ kind: "pending", stateIndex: -1 }` for a fillable
   * slot with zero captures, and the outstanding panel renders a `-1` row with
   * no button because there is no capture on the sheet to point at. Without
   * this seed, adding a judul would block the export with no way to unblock it,
   * on the main path of the feature that adds one.
   */
  const run = runWithEvidence(runId("add"));

  const result = applySectionEdit(
    run,
    { tag: "add-section", title: "Lampiran Harga" },
    mintIds(),
  );

  const section = result.run.overlay.added[0];
  assert.equal(section.title, "Lampiran Harga");
  assert.equal(section.origin, "human");
  assert.equal(section.slots.length, 1, "one bagian, never none");
  assert.equal(section.slots[0].label, "Halaman 1");

  const state = result.run.slots.find((slot) => slot.key === section.slots[0].id);
  assert.ok(state, "the added bagian must have a SlotState of its own");
  assert.equal(state.status, "pending");
  assert.equal(state.label, "Halaman 1");

  // The key is the SLOT'S NODE ID, because that is what `resolveAdded` makes
  // the resolved `SlotDef.key`. Anything else is a state the form has no row
  // for, which is an orphan under a judul the operator just added.
  const resolved = resolveTemplate(AO_TEMPLATE, result.run.overlay).sections.find(
    (s) => s.id === section.id,
  );
  assert.equal(resolved?.slots[0].key, section.slots[0].id);
  assert.equal(resolved?.layout, "images", "an added judul is always whole-page");
  assert.equal(resolved?.slots[0].pageOrdinal, 0);

  assert.deepEqual(result.removing, []);
  assert.deepEqual(result.removingSections, []);
});

test("add-section refuses a blank title before it mints anything", () => {
  const run = runWithEvidence(runId("add-blank"));
  assert.throws(() => applySectionEdit(run, { tag: "add-section", title: "  " }), OverlayError);
  assert.throws(
    () => applySectionEdit(run, { tag: "add-section", title: "Judul", slotLabel: "" }),
    OverlayError,
  );
});

test("two added judul do not collide, and both survive assertOverlay", () => {
  const mint = mintIds();
  const run = runWithEvidence(runId("add-twice"));
  const one = applySectionEdit(run, { tag: "add-section", title: "Lampiran A" }, mint);
  const two = applySectionEdit(one.run, { tag: "add-section", title: "Lampiran B" }, mint);

  assert.equal(two.run.overlay.added.length, 2);
  assert.notEqual(two.run.overlay.added[0].id, two.run.overlay.added[1].id);
  assert.equal(two.run.slots.filter((s) => s.status === "pending" && s.key.startsWith("u:")).length, 2);
});

// ---------------------------------------------------------------------------
// 6. Usulan: recorded, accepted, rejected
// ---------------------------------------------------------------------------

test("record-proposals replaces one berkas's answers and marks it asked", () => {
  const run = runWithEvidence(runId("record"));

  const first = applySectionEdit(run, {
    tag: "record-proposals",
    sourceId: "src-a",
    sections: [PROPOSAL],
  });
  assert.equal(first.run.overlay.proposed.length, 1);
  assert.equal(first.run.sources[0].sectionsAskedFor, true);

  // ASKED AGAIN, SAME ANSWER. Appending would show the operator each heading
  // twice; replacing is what makes pressing Proses again idempotent.
  const again = applySectionEdit(first.run, {
    tag: "record-proposals",
    sourceId: "src-a",
    sections: [PROPOSAL],
  });
  assert.equal(again.run.overlay.proposed.length, 1);
  assert.deepEqual(again.removing, []);
  assert.deepEqual(again.removingSections, []);

  // A usulan is not authorship: dropping one owes no opt-in, which is the same
  // line `CaptureLossError` draws between a zone-carrying state and an empty
  // one, one level up.
  const cleared = applySectionEdit(again.run, {
    tag: "record-proposals",
    sourceId: "src-a",
    sections: [],
  });
  assert.deepEqual(cleared.run.overlay.proposed, []);
  assert.deepEqual(cleared.removingSections, []);
});

test("record-proposals refuses an unknown berkas and a mis-filed entry", () => {
  const run = runWithEvidence(runId("record-refuse"));

  assert.throws(
    () =>
      applySectionEdit(run, {
        tag: "record-proposals",
        sourceId: "src-never-here",
        sections: [],
      }),
    /holds no berkas/,
  );
  // Filed under the wrong berkas, it would survive the next recording of its
  // own and be replaced by an unrelated one -- a heading attributed to a
  // document it was not read from, with a `cite` into that document's pages.
  assert.throws(
    () =>
      applySectionEdit(run, {
        tag: "record-proposals",
        sourceId: "src-a",
        sections: [{ ...PROPOSAL, fromSourceId: "src-b" }],
      }),
    /fromSourceId/,
  );
});

test("accept-proposal seeds ONE capture per page, with the page's own whole-page zone", () => {
  const run = runWithProposal(runId("accept"));

  const result = applySectionEdit(run, { tag: "accept-proposal", id: PROPOSAL.id }, mintIds());

  // Moved out of `proposed`, which is the only path from a suggestion to a
  // deliverable: `resolveTemplate` does not read that array at all.
  assert.deepEqual(result.run.overlay.proposed, []);
  const section = result.run.overlay.added[0];
  assert.equal(section.title, PROPOSAL.title);
  assert.equal(section.origin, "llm", "provenance is carried, never inferred");
  assert.equal(section.fromSourceId, "src-a");
  assert.deepEqual(section.pages, [1, 2]);
  assert.deepEqual(section.cite, PROPOSAL.cite);

  // FRESH IDS. The proposal's id named a suggestion; these name rows in this
  // order's form, and there was never a proposal id for the second page.
  assert.equal(section.slots.length, 2);
  assert.notEqual(section.id, PROPOSAL.id);
  assert.deepEqual(section.slots.map((s) => s.label), ["Halaman 1", "Halaman 2"]);

  const states = section.slots.map((slot) =>
    result.run.slots.find((state) => state.key === slot.id),
  );
  assert.equal(states.length, 2);
  states.forEach((state, at) => {
    assert.ok(state, "every added bagian needs a state, or it blocks the export");
    assert.equal(state.status, "proposed", "a person agreed the judul exists, not the picture");
    assert.equal(state.origin, "llm");
    // THE PAGE INDEX IS READ FROM `fromPages`, which are RUN-GLOBAL positions in
    // `run.pages`. `StoredPage.index` restarts at 0 for every berkas, so using
    // it would crop every page of the second document out of the first -- quiet,
    // because the first document reviews correctly.
    assert.equal(state.zone?.pageIndex, PROPOSAL.fromPages[at]);
    assert.deepEqual(state.zone?.box, { x: 0, y: 0, w: 2480, h: 3507 });
    assert.deepEqual(state.zone?.lineRange, [0, 1]);
    assert.match(state.text ?? "", /BANK CONTOH NUSANTARA/);
  });

  assert.deepEqual(result.removing, []);
  assert.deepEqual(result.removingSections, []);
});

test("accept-proposal REFUSES a span whose page has no OCR lines", () => {
  /*
   * A whole-page citation is written from the array length, so a page with no
   * lines would be cited as line 0 of a page that has none: a false sumber
   * under a picture in a packet a validator signs. There is no honest range to
   * write instead -- `Zone.lineRange` is two required numbers -- so the span is
   * refused whole. Accepting the rest and skipping the page would be worse: a
   * judul that silently ships one page short is the missing evidence this
   * project is organised against.
   */
  const base = runWithProposal(runId("accept-lineless"));
  const lineless: BrowserRun = {
    ...base,
    pages: base.pages.map((p, at) => (at === 1 ? { ...p, lines: [] } : p)),
  };

  assert.throws(
    () => applySectionEdit(lineless, { tag: "accept-proposal", id: PROPOSAL.id }, mintIds()),
    (error: unknown) => {
      assert.ok(error instanceof OverlayError);
      assert.match(error.message, /no OCR lines/);
      return true;
    },
  );

  // Nothing half-applied: the usulan is still there to rule on.
  assert.deepEqual(lineless.overlay.proposed, [PROPOSAL]);
});

test("accept-proposal refuses a page the order does not hold", () => {
  const base = runWithProposal(runId("accept-outofrange"));
  const run: BrowserRun = {
    ...base,
    overlay: {
      ...base.overlay,
      proposed: [{ ...PROPOSAL, fromPages: [1, 99] }],
    },
  };

  assert.throws(
    () => applySectionEdit(run, { tag: "accept-proposal", id: PROPOSAL.id }, mintIds()),
    /names page 99/,
  );
});

test("accept-proposal REFUSES a usulan whose pages a judul already captures", () => {
  /*
   * "CARI JUDUL LAGI" ASKS THE SAME QUESTION AND GETS THE SAME ANSWER.
   *
   * `record-proposals` replaces one berkas's entries, and discovery is
   * stateless: it re-reads the whole berkas and names every heading on it,
   * including the ones the operator has ALREADY ACCEPTED. Those live in
   * `overlay.added` by then, which discovery has never seen. Accepting the
   * repeat files the same pages a second time under a second heading -- so the
   * packet carries the identical picture twice, under two headings, and reads
   * as more evidence rather than as the same evidence.
   *
   * The usulan here is hand-placed rather than re-recorded, because
   * `record-proposals` now drops it on the way in (see the next test). This is
   * the backstop under that: a usulan filed BEFORE the accept is already
   * stored, and nothing re-screens it.
   */
  const mint = mintIds();
  const base = runWithProposal(runId("accept-duplicate"));
  const accepted = applySectionEdit(
    base,
    { tag: "accept-proposal", id: PROPOSAL.id },
    mint,
  );
  const judul = accepted.run.overlay.added[0];
  assert.deepEqual(judul.pages, [1, 2]);

  const again: ProposedSection = {
    ...PROPOSAL,
    id: "u:00000000-0000-4000-8000-0000000000c9",
  };
  const stale: BrowserRun = {
    ...accepted.run,
    overlay: { ...accepted.run.overlay, proposed: [again] },
  };

  assert.throws(
    () => applySectionEdit(stale, { tag: "accept-proposal", id: again.id }, mint),
    (error: unknown) => {
      assert.ok(error instanceof OverlayError);
      // NAMES THE JUDUL THAT ALREADY HOLDS THEM, because "this is a duplicate"
      // is only actionable if the operator can find the original on the sheet.
      assert.match(error.message, /Berita Acara Uji Terima/);
      return true;
    },
  );

  // Nothing half-applied: one judul, its two bagian, and the usulan still
  // sitting there for "Bukan ini".
  assert.equal(stale.overlay.added.length, 1);
  assert.equal(stale.overlay.proposed.length, 1);
});

test("record-proposals drops an incoming usulan whose span is already a judul", () => {
  /*
   * THE DECISION WAS ALREADY MADE, so the row is not a decision owed. Showing
   * it again would put an amber count on the panel for work that is finished,
   * and `--mark` stops being read the moment it appears over nothing.
   *
   * Dropped rather than refused: the reply is otherwise perfectly good, and one
   * repeated heading is no reason to throw away the three new ones beside it.
   */
  const mint = mintIds();
  const base = runWithProposal(runId("record-duplicate"));
  const accepted = applySectionEdit(
    base,
    { tag: "accept-proposal", id: PROPOSAL.id },
    mint,
  );

  const repeat: ProposedSection = {
    ...PROPOSAL,
    id: "u:00000000-0000-4000-8000-0000000000d1",
  };
  const fresh: ProposedSection = {
    id: "u:00000000-0000-4000-8000-0000000000d2",
    title: "SURAT PENUNJUKAN",
    fromSourceId: "src-a",
    fromPages: [0],
    cite: { pageIndex: 0, lineRange: [0, 0] },
  };

  const recorded = applySectionEdit(accepted.run, {
    tag: "record-proposals",
    sourceId: "src-a",
    sections: [repeat, fresh],
  });

  assert.deepEqual(
    recorded.run.overlay.proposed.map((entry) => entry.id),
    [fresh.id],
    "a heading the operator already adopted is not a decision owed",
  );
  // The cost gate is still set: the question WAS put to this berkas, whatever
  // survived the screening.
  assert.equal(recorded.run.sources[0].sectionsAskedFor, true);
});

test("a usulan that only PARTLY overlaps an accepted judul is still offered", () => {
  /*
   * FULLY CLAIMED, NOT OVERLAPPING, and the difference is deliberate. A span
   * that shares one page with an accepted judul and adds three of its own is a
   * different finding about the document, and the operator is the one who can
   * tell a re-segmentation from a duplicate. Refusing it here would silently
   * delete a heading nobody has ruled on; the duplicate this guard exists for
   * is the exact repeat, which is what "Cari judul lagi" produces.
   */
  const mint = mintIds();
  const base = runWithProposal(runId("accept-partial"));
  const accepted = applySectionEdit(
    base,
    { tag: "accept-proposal", id: PROPOSAL.id },
    mint,
  );

  const wider: ProposedSection = {
    ...PROPOSAL,
    id: "u:00000000-0000-4000-8000-0000000000e1",
    title: "Lampiran daftar layanan",
    fromPages: [0, 1],
    cite: { pageIndex: 0, lineRange: [0, 1] },
  };

  const recorded = applySectionEdit(accepted.run, {
    tag: "record-proposals",
    sourceId: "src-a",
    sections: [wider],
  });
  assert.equal(recorded.run.overlay.proposed.length, 1);

  const taken = applySectionEdit(
    recorded.run,
    { tag: "accept-proposal", id: wider.id },
    mint,
  );
  assert.equal(taken.run.overlay.added.length, 2);
});

test("reject-proposal removes it and names nothing", () => {
  const run = runWithProposal(runId("reject"));

  const result = applySectionEdit(run, { tag: "reject-proposal", id: PROPOSAL.id });

  assert.deepEqual(result.run.overlay.proposed, []);
  assert.equal(result.run.slots, run.slots, "a usulan has no state to drop");
  assert.deepEqual(result.removing, []);
  assert.deepEqual(result.removingSections, []);

  // Ruling on it twice is loud rather than silent: the row is gone from the
  // panel, so a second answer is about something that is not there.
  assert.throws(
    () => applySectionEdit(result.run, { tag: "reject-proposal", id: PROPOSAL.id }),
    /no usulan with id/,
  );
  assert.throws(
    () => applySectionEdit(result.run, { tag: "accept-proposal", id: PROPOSAL.id }),
    /no usulan with id/,
  );
});

// ---------------------------------------------------------------------------
// 7. Applied twice is not applied twice
// ---------------------------------------------------------------------------

test("an edit applied twice is not double-applied", () => {
  /*
   * Two tabs, or one double click. The second apply must not report a second
   * `removing` list naming keys that are already gone (an opt-in spent on
   * nothing), must not seed a second row under a key that already has one (two
   * states with one key make one of them permanently unaddressable, since every
   * screen and `putRun`'s own map key by it), and must not move a judul twice.
   */
  const run = runWithEvidence(runId("twice"));

  const once = applySectionEdit(run, { tag: "remove-section", id: "kb" });
  const twice = applySectionEdit(once.run, { tag: "remove-section", id: "kb" });
  assert.equal(twice.run, once.run, "the second removal changes nothing, by identity");
  assert.deepEqual(twice.removing, [], "and names no capture that is already gone");
  assert.deepEqual(twice.removingSections, []);

  const back = applySectionEdit(twice.run, { tag: "restore-section", id: "kb" });
  const backAgain = applySectionEdit(back.run, { tag: "restore-section", id: "kb" });
  assert.equal(backAgain.run, back.run);
  assert.deepEqual(
    back.run.slots.map((s) => s.key),
    backAgain.run.slots.map((s) => s.key),
    "restoring twice must not seed a second row under the same key",
  );
  const nomor = backAgain.run.slots.filter((s) => s.key === "kb.nomor");
  assert.equal(nomor.length, 1);
});

test("no edit mutates the run it was given", () => {
  const run = runWithEvidence(runId("immutable"));
  const before = JSON.stringify(run);

  applySectionEdit(run, { tag: "rename-section", id: "kb", title: "PKS Induk" });
  applySectionEdit(run, { tag: "remove-section", id: "kb" });
  applySectionEdit(run, { tag: "add-section", title: "Lampiran" }, mintIds());
  applySectionEdit(run, { tag: "move-section", id: "kb", by: 1 });
  applySectionEdit(
    run,
    { tag: "record-proposals", sourceId: "src-a", sections: [PROPOSAL] },
  );

  // The stored run is read inside the lock and handed to `putRun`; a caller
  // that mutated in place would have written half the edit before the guards
  // ran, and a refusal would leave the object it refused already changed.
  assert.equal(JSON.stringify(run), before);
});

// ---------------------------------------------------------------------------
// 8. End to end, through the real putRun
// ---------------------------------------------------------------------------

test("a rename survives a CONCURRENT ingest, which the obvious API cannot", async () => {
  /*
   * THE REASON AN EDIT IS A VALUE AND NOT A RUN, executed rather than argued.
   *
   * `ingestDocument` holds the run lock for minutes over a long document and
   * advances the revision once per page. A screen holding a `BrowserRun` while
   * that runs is many revisions stale, so the obvious `saveRun({ ...run,
   * overlay: next })` is REFUSED -- the operator would be told the order
   * changed underneath them for renaming a heading, and lose the rename.
   *
   * `editSections` reads what is stored inside the lock and applies the edit to
   * THAT, which turns a refused write into a queued one. The other half is
   * `appendPage`, which takes the run's small half from storage rather than
   * from its (minutes-old) caller, so the next page of the ingest does not
   * write the pre-rename overlay back over the top.
   */
  const id = runId("e2e");
  await putRun(runWithEvidence(id));

  // What React is holding: one revision, three pages, no rename.
  const held = await getRun(id);
  assert.ok(held);
  assert.equal(held.rev, 1);

  // The ingest starts and writes a page. Its own meta carries the arrays as
  // they were when it started, which is exactly the shape `ingestDocument`
  // builds.
  const midIngest: RunMeta = {
    id: held.id,
    createdAt: held.createdAt,
    rev: held.rev,
    sources: [...held.sources, { id: "src-b", name: "TAMBAHAN.pdf", pageCount: 2 }],
    slots: held.slots,
    overlay: held.overlay,
    konfigurasi: emptyConfigCheck(),
    epic: emptyEpicCheck(),
  };
  const afterFirstPage = await appendPage(midIngest, page("b0", "src-b", 0), 3);

  // THE OBVIOUS API, REFUSED. This is what the screen would have done.
  await assert.rejects(
    () => saveRun({ ...held, overlay: { ...held.overlay, sections: { kb: { title: "PKS Induk" } } } }),
    StaleRunWriteError,
  );

  // The edit as a VALUE goes through, against what is stored.
  const renamed = await editSections(id, {
    tag: "rename-section",
    id: "kb",
    title: "PKS Induk",
  });
  assert.equal(renamed.overlay.sections.kb.title, "PKS Induk");
  assert.equal(renamed.pages.length, 4, "the ingest's page is still there");

  // The ingest carries on from its own (now stale-overlaid) meta, at the
  // revision the rename left behind.
  await appendPage(
    { ...midIngest, sources: afterFirstPage.sources, rev: renamed.rev },
    page("b1", "src-b", 1),
    4,
  );

  const stored = await getRun(id);
  assert.ok(stored);
  assert.equal(
    stored.overlay.sections.kb.title,
    "PKS Induk",
    "the rename must survive the page the ingest wrote after it",
  );
  assert.deepEqual(
    stored.pages.map((p) => p.id),
    ["p0", "p1", "p2", "b0", "b1"],
  );
  // And every capture is where it was: a rename is not a rebuild.
  assert.deepEqual(stored.slots.find((s) => s.key === "kb.nomor")?.zone, ZONE);
  assert.deepEqual(stored.slots.find((s) => s.key === "kb.nomor#2")?.zone, LANJUTAN_ZONE);
});

test("editSections removes a judul through the real guards, in one write", async () => {
  /*
   * Removing a judul trips BOTH content guards at once: it drops zone-carrying
   * captures (`CaptureLossError`) and, for an added judul, discards a name the
   * operator authored (`SectionLossError`). The engine computes both opt-ins,
   * so this write goes through -- and the same write with either one withheld
   * is refused, which is the half that proves the opt-ins are load-bearing
   * rather than decorative.
   */
  const id = runId("e2e-remove");
  const stored = await putRun(runWithEvidence(id));

  // FIRST, the same shortening assembled by hand and saved without the opt-in.
  // Refused, which is what makes the opt-in load-bearing rather than
  // decorative -- and refused at the CORRECT revision, with every page present.
  await assert.rejects(
    () => saveRun({ ...stored, slots: stored.slots.filter((s) => !s.key.startsWith("kb.")) }),
    (error: unknown) => {
      assert.ok(error instanceof CaptureLossError);
      assert.deepEqual(error.missing.slice().sort(), ["kb.nomor", "kb.nomor#2"]);
      return true;
    },
  );

  // Then the same removal through the engine, which computes both opt-ins.
  const after = await editSections(id, { tag: "remove-section", id: "kb" });
  assert.equal(after.overlay.sections.kb.removed, true);
  assert.equal(
    after.slots.some((slot) => slot.key.startsWith("kb.")),
    false,
  );

  const reread = await getRun(id);
  assert.equal(reread?.slots.some((slot) => slot.key === "kb.nomor#2"), false);
  assert.equal(reread?.pages.length, 3, "removing a judul touches no page");
});

test("editSections adds a judul and stores its seeded row", async () => {
  const id = runId("e2e-add");
  await putRun(runWithEvidence(id));

  const after = await editSections(id, { tag: "add-section", title: "Lampiran Harga" });

  const section = after.overlay.added[0];
  const stored = await getRun(id);
  assert.ok(stored);
  assert.equal(stored.overlay.added[0].title, "Lampiran Harga");
  const state = stored.slots.find((slot) => slot.key === section.slots[0].id);
  assert.ok(state, "the seeded row must reach the device, not just the return value");
  assert.equal(state.status, "pending");
});

test("editSections on a run that is gone says so in Bahasa, and writes nothing", async () => {
  await assert.rejects(
    () => editSections("sections-never-stored", { tag: "add-section", title: "Lampiran" }),
    /tidak ada lagi/,
  );
});

test("a no-op edit does not advance the revision", async () => {
  const id = runId("e2e-noop");
  const stored = await putRun(runWithEvidence(id));

  const after = await editSections(id, { tag: "move-section", id: "kb", by: -1 });

  // A press that did nothing must not advance the revision: doing so would
  // refuse whatever the screen is holding, for no change at all.
  assert.equal(after.rev, stored.rev);
});
