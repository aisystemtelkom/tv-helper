/**
 * Tests for the template overlay: a run's edits stored as a diff, and the pure
 * resolver that turns base + diff back into an ordinary `Template`.
 *
 * Three groups, and each exists because of a specific way this could go quietly
 * wrong rather than loudly.
 *
 * 1. IDENTITY. `resolveTemplate` hands back the base OBJECT, not a copy, when
 *    the overlay changes nothing. That is what makes every run stored before
 *    overlays existed behave exactly as it did, and it is asserted with `===`
 *    rather than `deepEqual` because a deep-equal copy would pass a
 *    correctness test while quietly re-rendering the whole packet on every
 *    keystroke.
 *
 * 2. THE FENCE. An overlay may rename, remove, reorder and add whole-page
 *    bagian. It may not express a prompt. Two halves: `assertOverlay` refuses
 *    an `ask`/`hint`/`docType`/`layout`/`pageOrdinal`/`fillable` key at any
 *    depth, and the resolver is shown a pile of simultaneous edits and asked to
 *    prove that EVERY resolved slot's `ask` is still deep-equal to the base's.
 *    The second half is the one that matters: a fence with a hole in it looks
 *    exactly like a fence, and only the output can say.
 *
 * 3. PROPOSALS GO NOWHERE. `overlay.proposed` is read by nothing in the
 *    resolver, so a heading the model invented cannot reach the exporter. The
 *    strongest available statement of that is that an overlay carrying nothing
 *    but proposals resolves to the base BY IDENTITY: not filtered out later,
 *    never looked at.
 *
 * The base used here is a small hand-built fixture rather than `AO_TEMPLATE`,
 * so the assertions can name their own slots and stay readable when the real
 * template is corrected. `AO_TEMPLATE` itself is checked at the end, where what
 * is under test is the real form's shape rather than the resolver's behaviour.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { AO_TEMPLATE, type SectionDef, type SlotDef, type Template } from "./template.ts";
import {
  ADDED_SECTION_ASK,
  ADDED_SLOT_ASK,
  OVERLAY_VERSION,
  OverlayError,
  addedSectionOf,
  assertNodeId,
  assertOverlay,
  emptyOverlay,
  fingerprintOf,
  isEmpty,
  isSearchable,
  resolveTemplate,
  type TemplateOverlay,
} from "./overlay.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A three-section stand-in for the real form: one table section with two
 * fillable slots, one images section, and one that ships empty. Small enough to
 * assert over exhaustively, shaped exactly like `AO_TEMPLATE`.
 */
function baseTemplate(): Template {
  return {
    id: "AO",
    label: "DOKUMEN VALIDASI",
    sections: [
      {
        id: "kb",
        title: "KB",
        layout: "table",
        ask: { title: "KB" },
        slots: [
          {
            key: "kb.nomor",
            label: "Nomor",
            docType: "KB",
            ask: {
              label: "Nomor",
              hint: "the contract number of the Perjanjian Kerjasama itself",
            },
            catatan: {
              adalah: "Nomor Perjanjian Kerjasama itu sendiri.",
              bukan: "Bukan nomor surat pengantar.",
            },
            fillable: true,
          },
          {
            key: "kb.tanggal",
            label: "Tanggal",
            docType: "KB",
            ask: {
              label: "Tanggal",
              hint: "the date the Perjanjian Kerjasama was signed",
            },
            fillable: true,
          },
        ],
      },
      {
        id: "email",
        title: "Email",
        layout: "images",
        ask: { title: "Email" },
        slots: [
          {
            key: "email.1",
            label: "Email",
            docType: "Email",
            ask: { label: "Email", hint: "the whole printed email thread page" },
            fillable: true,
            pageOrdinal: 0,
          },
        ],
      },
      {
        id: "mom",
        title: "MOM",
        layout: "images",
        ask: { title: "MOM" },
        slots: [],
      },
    ],
    xlsxRows: [
      { nomor: 1, itemI: "Lead", itemII: "Description", keterangan: "Isi",
        fieldKey: "namaProyek" },
    ],
    fieldHints: { namaProyek: "The name of THIS order's work." },
    fieldLists: new Set(["picContacts"]),
  };
}

/** A well-formed overlay as it arrives off the wire: plain data, no types. */
function wire(): Record<string, unknown> {
  return {
    version: OVERLAY_VERSION,
    base: "AO",
    baseFingerprint: "deadbeef",
    sections: {},
    slots: {},
    added: [],
    proposed: [],
  };
}

function withPatches(
  base: Template,
  patch: Partial<TemplateOverlay>,
): TemplateOverlay {
  return { ...emptyOverlay(base), ...patch };
}

function sectionById(template: Template, id: string): SectionDef {
  const found = template.sections.find((section) => section.id === id);
  assert.ok(found, `no section "${id}" in the resolved template`);
  return found;
}

function slotByKey(template: Template, key: string): SlotDef {
  for (const section of template.sections) {
    for (const slot of section.slots) if (slot.key === key) return slot;
  }
  throw new Error(`no slot "${key}" in the resolved template`);
}

function titles(template: Template): string[] {
  return template.sections.map((section) => section.title);
}

// ---------------------------------------------------------------------------
// 1. Identity
// ---------------------------------------------------------------------------

test("no overlay and an empty overlay both resolve to the base BY IDENTITY", () => {
  const base = baseTemplate();
  const empty = emptyOverlay(base);

  assert.equal(isEmpty(empty), true);
  // `===`, deliberately. A structurally identical copy would satisfy every
  // other assertion in this file and still cost a full re-render per keystroke
  // in a UI that memoises on the resolved template.
  assert.equal(resolveTemplate(base, undefined), base);
  assert.equal(resolveTemplate(base, empty), base);
});

test("emptyOverlay records the base id and its fingerprint", () => {
  const base = baseTemplate();
  const empty = emptyOverlay(base);

  assert.equal(empty.version, OVERLAY_VERSION);
  assert.equal(empty.base, "AO");
  assert.equal(empty.baseFingerprint, fingerprintOf(base));
  assert.deepEqual(empty.sections, {});
  assert.deepEqual(empty.slots, {});
  assert.deepEqual(empty.added, []);
  assert.deepEqual(empty.proposed, []);
});

test("an overlay against another form is refused, even when it is empty", () => {
  const base = baseTemplate();
  const foreign = withPatches(base, { base: "MO" });

  // Loud, and BEFORE the empty short-circuit. The quiet version resolves every
  // patch against a template that declares none of its ids, hands back an
  // unedited form and shows the operator a packet with their renames missing.
  assert.throws(() => resolveTemplate(base, foreign), OverlayError);
});

test("a fingerprint mismatch does NOT refuse to resolve", () => {
  const base = baseTemplate();
  const drifted = withPatches(base, {
    baseFingerprint: "00000000",
    sections: { kb: { title: "PKS" } },
  });

  // The fingerprint is a drift signal a caller may warn on, not a gate. Refusing
  // here would strand every stored run behind any change to the compile-time
  // template, and the resolver is already safe against drift: it looks every
  // patch up by name.
  assert.equal(sectionById(resolveTemplate(base, drifted), "kb").title, "PKS");
});

// ---------------------------------------------------------------------------
// 2. Renames, removals, additions, order
// ---------------------------------------------------------------------------

test("a rename replaces the title and leaves everything else alone", () => {
  const base = baseTemplate();
  const resolved = resolveTemplate(
    base,
    withPatches(base, {
      sections: { kb: { title: "Perjanjian Kerjasama" } },
      slots: { "kb.nomor": { label: "No. PKS" } },
    }),
  );

  assert.equal(sectionById(resolved, "kb").title, "Perjanjian Kerjasama");
  assert.equal(slotByKey(resolved, "kb.nomor").label, "No. PKS");
  // The base object itself is untouched: the resolver copies, it does not edit.
  assert.equal(sectionById(base, "kb").title, "KB");
  assert.equal(slotByKey(base, "kb.nomor").label, "Nomor");
  // Everything the patch did not name keeps its own title, and the untouched
  // sections come back as the SAME objects.
  assert.equal(sectionById(resolved, "email"), sectionById(base, "email"));
  assert.equal(sectionById(resolved, "mom"), sectionById(base, "mom"));
});

test("a patched catatan replaces the operator's note and nothing else", () => {
  const base = baseTemplate();
  const resolved = resolveTemplate(
    base,
    withPatches(base, {
      slots: {
        "kb.nomor": {
          catatan: { adalah: "Nomor kontrak induk.", bukan: "Bukan nomor SP." },
        },
      },
    }),
  );

  const slot = slotByKey(resolved, "kb.nomor");
  assert.deepEqual(slot.catatan, {
    adalah: "Nomor kontrak induk.",
    bukan: "Bukan nomor SP.",
  });
  assert.equal(slot.label, "Nomor");
  assert.deepEqual(slot.ask, slotByKey(base, "kb.nomor").ask);
});

test("THE FENCE: no combination of edits moves a single ask", () => {
  // The point of this test is the ARBITRARINESS of the edits. Every lever the
  // overlay has is pulled at once -- rename a section, rename a slot, rewrite a
  // catatan, remove a slot, remove a section, add a bagian, reorder the lot --
  // and then every surviving base slot is checked against the base it came
  // from. A hole in the fence looks exactly like a fence until something reads
  // the output.
  const base = baseTemplate();
  const resolved = resolveTemplate(
    base,
    withPatches(base, {
      sections: {
        kb: { title: "Perjanjian Kerjasama" },
        mom: { removed: true },
      },
      slots: {
        "kb.nomor": { label: "No. PKS", catatan: { adalah: "Nomor kontrak." } },
        "kb.tanggal": { removed: true },
        "email.1": { label: "Cetakan email" },
      },
      added: [
        {
          id: "u:lampiran",
          title: "Lampiran Teknis",
          origin: "human",
          slots: [{ id: "u:lampiran.1", label: "Halaman 1" }],
        },
      ],
      order: ["email", "u:lampiran", "kb"],
    }),
  );

  for (const section of resolved.sections) {
    for (const slot of section.slots) {
      if (slot.added) {
        // An added slot's ask is the fixed tombstone, shared by every added
        // slot in the app, and it carries none of the operator's typing.
        assert.deepEqual(slot.ask, ADDED_SLOT_ASK);
        assert.equal(slot.ask.hint.includes("Lampiran"), false);
        assert.equal(slot.ask.hint.includes("Halaman"), false);
        continue;
      }
      // Every base slot's question is byte-for-byte the one the gate measured.
      assert.deepEqual(slot.ask, slotByKey(base, slot.key).ask);
      assert.deepEqual(slot.docType, slotByKey(base, slot.key).docType);
      assert.equal(slot.fillable, slotByKey(base, slot.key).fillable);
    }
    if (section.added) {
      assert.deepEqual(section.ask, ADDED_SECTION_ASK);
      continue;
    }
    assert.deepEqual(section.ask, sectionById(base, section.id).ask);
    assert.equal(section.layout, sectionById(base, section.id).layout);
  }

  // And the edits themselves all landed.
  assert.deepEqual(titles(resolved), ["Email", "Lampiran Teknis", "Perjanjian Kerjasama"]);
  assert.equal(slotByKey(resolved, "kb.nomor").label, "No. PKS");
  assert.equal(slotByKey(resolved, "email.1").label, "Cetakan email");
  assert.deepEqual(
    sectionById(resolved, "kb").slots.map((slot) => slot.key),
    ["kb.nomor"],
  );
});

test("a removed section takes its slots with it", () => {
  const base = baseTemplate();
  const resolved = resolveTemplate(
    base,
    withPatches(base, { sections: { kb: { removed: true } } }),
  );

  assert.deepEqual(titles(resolved), ["Email", "MOM"]);
  assert.throws(() => slotByKey(resolved, "kb.nomor"));
  assert.throws(() => slotByKey(resolved, "kb.tanggal"));
  // And a slot that no longer exists cannot be searched for, so it can never
  // come back as "tidak ditemukan" against a bagian the operator deleted.
  assert.equal(isSearchable(resolved, "kb.nomor"), false);
});

test("a removed slot leaves its section standing", () => {
  const base = baseTemplate();
  const resolved = resolveTemplate(
    base,
    withPatches(base, { slots: { "kb.nomor": { removed: true } } }),
  );

  assert.deepEqual(titles(resolved), ["KB", "Email", "MOM"]);
  assert.deepEqual(
    sectionById(resolved, "kb").slots.map((slot) => slot.key),
    ["kb.tanggal"],
  );
});

test("an added bagian is images, fillable, marked added, and never searched", () => {
  const base = baseTemplate();
  const resolved = resolveTemplate(
    base,
    withPatches(base, {
      added: [
        {
          id: "u:lampiran",
          title: "Lampiran Teknis",
          origin: "llm",
          fromSourceId: "doc-2",
          cite: { pageIndex: 4, lineRange: [2, 9] },
          pages: [4, 5],
          slots: [
            { id: "u:lampiran.1", label: "Halaman 1" },
            { id: "u:lampiran.2", label: "Halaman 2" },
          ],
        },
      ],
    }),
  );

  const section = sectionById(resolved, "u:lampiran");
  assert.equal(section.title, "Lampiran Teknis");
  // ALWAYS images. There is no field on AddedSection that could say otherwise,
  // and this is the assertion that makes the absence mean something: a table
  // bagian would be a slot the model is asked to locate with no measured hint
  // behind it.
  assert.equal(section.layout, "images");
  assert.deepEqual(section.added, {
    id: "u:lampiran",
    origin: "llm",
    fromSourceId: "doc-2",
  });
  assert.deepEqual(section.ask, ADDED_SECTION_ASK);

  assert.deepEqual(
    section.slots.map((slot) => [slot.key, slot.label, slot.pageOrdinal]),
    [
      ["u:lampiran.1", "Halaman 1", 0],
      ["u:lampiran.2", "Halaman 2", 1],
    ],
  );
  for (const slot of section.slots) {
    assert.equal(slot.fillable, true);
    assert.equal(slot.docType, null);
    assert.deepEqual(slot.added, { id: slot.key, origin: "llm" });
    // The whole reason `isSearchable` exists: the search is never asked about
    // an added bagian, so there is no negative answer to report about it.
    assert.equal(isSearchable(resolved, slot.key), false);
    assert.equal(addedSectionOf(resolved, slot.key), section);
  }
});

test("an added bagian read off nothing carries no fromSourceId key at all", () => {
  const base = baseTemplate();
  const resolved = resolveTemplate(
    base,
    withPatches(base, {
      added: [
        { id: "u:extra", title: "Tambahan", origin: "human", slots: [] },
      ],
    }),
  );

  const section = sectionById(resolved, "u:extra");
  assert.deepEqual(section.added, { id: "u:extra", origin: "human" });
  assert.equal("fromSourceId" in (section.added ?? {}), false);
});

test("ONE ID, ONE HOME: an added bagian is edited in place, never patched", () => {
  const base = baseTemplate();

  // Renaming an added bagian means rewriting its own entry, and the rename
  // lands the same way a base rename does.
  const renamed = resolveTemplate(
    base,
    withPatches(base, {
      added: [
        {
          id: "u:lampiran",
          title: "Lampiran (revisi)",
          origin: "human",
          slots: [
            { id: "u:lampiran.1", label: "Muka surat 1" },
            { id: "u:lampiran.2", label: "Halaman 2" },
          ],
        },
      ],
    }),
  );
  const section = sectionById(renamed, "u:lampiran");
  assert.equal(section.title, "Lampiran (revisi)");
  assert.deepEqual(
    section.slots.map((slot) => [slot.key, slot.label, slot.pageOrdinal]),
    [
      ["u:lampiran.1", "Muka surat 1", 0],
      ["u:lampiran.2", "Halaman 2", 1],
    ],
  );

  // And the second spelling is refused at the door rather than being applied
  // or, worse, ignored. Two homes for one title is two values that can
  // disagree, and nothing on screen would say which one the docx printed.
  assert.throws(
    () =>
      assertOverlay({
        ...wire(),
        sections: { "u:lampiran": { title: "Lampiran (revisi)" } },
        added: [
          { id: "u:lampiran", title: "Lampiran", origin: "human", slots: [] },
        ],
      }),
    OverlayError,
  );
  assert.throws(
    () =>
      assertOverlay({
        ...wire(),
        slots: { "u:lampiran.1": { label: "Muka surat 1" } },
        added: [
          {
            id: "u:lampiran",
            title: "Lampiran",
            origin: "human",
            slots: [{ id: "u:lampiran.1", label: "Halaman 1" }],
          },
        ],
      }),
    OverlayError,
  );
});

test("an added bagian is removed by dropping its entry, not by a tombstone", () => {
  const base = baseTemplate();
  const resolved = resolveTemplate(base, withPatches(base, { added: [] }));

  assert.deepEqual(titles(resolved), ["KB", "Email", "MOM"]);
  // Removal is the whole entry going away, in the manner of `withoutCapture`.
  // A `removed: true` patch pointing at an added id would be the second home
  // this design refuses, so it is a wire error rather than a second spelling.
  assert.throws(
    () =>
      assertOverlay({
        ...wire(),
        sections: { "u:lampiran": { removed: true } },
        added: [
          { id: "u:lampiran", title: "Lampiran", origin: "human", slots: [] },
        ],
      }),
    OverlayError,
  );
});

test("order reorders, forgets nothing, and ignores an id naming nothing", () => {
  const base = baseTemplate();

  // "mom" is missing from the order and "u:ghost" names nothing.
  const resolved = resolveTemplate(
    base,
    withPatches(base, { order: ["u:ghost", "email", "kb"] }),
  );

  // A section an order forgot MUST still render: removal has its own explicit
  // spelling, and a silently dropped section is a missing page of evidence in a
  // packet that opens fine.
  assert.deepEqual(titles(resolved), ["Email", "KB", "MOM"]);
});

test("order places an added bagian among the base's own sections", () => {
  const base = baseTemplate();
  const resolved = resolveTemplate(
    base,
    withPatches(base, {
      added: [
        { id: "u:lampiran", title: "Lampiran Teknis", origin: "human", slots: [] },
      ],
      order: ["u:lampiran", "kb"],
    }),
  );

  assert.deepEqual(titles(resolved), ["Lampiran Teknis", "KB", "Email", "MOM"]);
});

test("the xlsx half of the template passes through untouched", () => {
  const base = baseTemplate();
  const resolved = resolveTemplate(
    base,
    withPatches(base, {
      sections: { kb: { removed: true } },
      slots: { "email.1": { label: "Cetakan email" } },
    }),
  );

  // By identity: no operator edit can blank an xlsx cell, move a field hint the
  // gate scores, or change which keys hold a list.
  assert.equal(resolved.xlsxRows, base.xlsxRows);
  assert.equal(resolved.fieldHints, base.fieldHints);
  assert.equal(resolved.fieldLists, base.fieldLists);
  assert.equal(resolved.id, base.id);
  assert.equal(resolved.label, base.label);
});

// ---------------------------------------------------------------------------
// 3. Proposals go nowhere
// ---------------------------------------------------------------------------

test("an overlay carrying only proposals resolves to the base BY IDENTITY", () => {
  const base = baseTemplate();
  const proposals = withPatches(base, {
    proposed: [
      {
        id: "u:proposed",
        title: "Lampiran Teknis",
        fromSourceId: "doc-2",
        fromPages: [4, 5],
        cite: { pageIndex: 4, lineRange: [2, 9] },
      },
    ],
  });

  // The strongest available statement of the rule: not "it is filtered out
  // downstream" but "the resolver never looked at it". Accepting a proposal is
  // what moves it into `added`, and that is a human act.
  assert.equal(isEmpty(proposals), true);
  assert.equal(resolveTemplate(base, proposals), base);
});

test("a proposal alongside a real addition still reaches nothing", () => {
  const base = baseTemplate();
  const resolved = resolveTemplate(
    base,
    withPatches(base, {
      added: [
        { id: "u:accepted", title: "Diterima", origin: "llm", slots: [] },
      ],
      proposed: [
        {
          id: "u:pending",
          title: "Belum diterima",
          fromSourceId: "doc-2",
          fromPages: [7],
          cite: { pageIndex: 7, lineRange: [0, 3] },
        },
      ],
    }),
  );

  assert.deepEqual(titles(resolved), ["KB", "Email", "MOM", "Diterima"]);
  assert.equal(
    resolved.sections.some((section) => section.id === "u:pending"),
    false,
  );
});

// ---------------------------------------------------------------------------
// 4. isSearchable and addedSectionOf
// ---------------------------------------------------------------------------

test("isSearchable is true for a base slot, ordinal or not", () => {
  const base = baseTemplate();

  assert.equal(isSearchable(base, "kb.nomor"), true);
  // A `SlotState.key` may carry a capture ordinal; the template knows only the
  // bare key, so the ordinal is stripped before the lookup.
  assert.equal(isSearchable(base, "kb.nomor#2"), true);
  assert.equal(isSearchable(base, "kb.nomor#7"), true);
});

test("isSearchable is false for a key the template does not declare", () => {
  const base = baseTemplate();

  assert.equal(isSearchable(base, "kb.tidakAda"), false);
  assert.equal(isSearchable(base, ""), false);
});

test("addedSectionOf answers null for a base slot and for an unknown key", () => {
  const base = baseTemplate();

  assert.equal(addedSectionOf(base, "kb.nomor"), null);
  assert.equal(addedSectionOf(base, "kb.tidakAda"), null);
});

// ---------------------------------------------------------------------------
// 5. fingerprintOf
// ---------------------------------------------------------------------------

test("fingerprintOf is stable, blind to reordering, and sees a key change", () => {
  const base = baseTemplate();
  assert.equal(fingerprintOf(base), fingerprintOf(baseTemplate()));

  // Blind to a pure reorder of the base ON PURPOSE: `overlay.order` addresses
  // sections by id, so reordering the compile-time template invalidates nothing
  // an overlay stored.
  const reordered = baseTemplate();
  reordered.sections.reverse();
  assert.equal(fingerprintOf(reordered), fingerprintOf(base));

  // But drift in the ids or keys themselves is exactly what it is for.
  const renamedSlot = baseTemplate();
  renamedSlot.sections[0].slots[0].key = "kb.nomorKontrak";
  assert.notEqual(fingerprintOf(renamedSlot), fingerprintOf(base));

  const renamedSection = baseTemplate();
  renamedSection.sections[0].id = "pks";
  assert.notEqual(fingerprintOf(renamedSection), fingerprintOf(base));

  // A DISPLAY title moving is not drift: the fingerprint reads ids and keys.
  const retitled = baseTemplate();
  retitled.sections[0].title = "Perjanjian Kerjasama";
  assert.equal(fingerprintOf(retitled), fingerprintOf(base));

  // Eight lowercase hex digits, so it is safe in a log line and in a key.
  assert.match(fingerprintOf(base), /^[0-9a-f]{8}$/);
});

// ---------------------------------------------------------------------------
// 6. assertNodeId
// ---------------------------------------------------------------------------

test("assertNodeId accepts a declared id and a minted one", () => {
  assert.doesNotThrow(() => assertNodeId("kb"));
  assert.doesNotThrow(() => assertNodeId("kb.nomor"));
  assert.doesNotThrow(() => assertNodeId("u:0b2f1c4e"));
});

test("assertNodeId refuses an id carrying the capture separator", () => {
  // Not style: `slotKeyOf` splits a capture key on the LAST "#", so an added
  // slot whose id carried one would be read as capture N of another slot and
  // its crop would be filed under a heading it does not belong to.
  assert.throws(() => assertNodeId("u:lampiran#2"), OverlayError);
  assert.throws(() => assertNodeId("#"), OverlayError);
});

test("assertNodeId refuses an empty id and an oversized one", () => {
  assert.throws(() => assertNodeId(""), OverlayError);
  assert.throws(() => assertNodeId(`u:${"x".repeat(210)}`), OverlayError);
  assert.doesNotThrow(() => assertNodeId("x".repeat(200)));
});

// ---------------------------------------------------------------------------
// 7. assertOverlay, the wire guard
// ---------------------------------------------------------------------------

test("assertOverlay accepts a well-formed overlay", () => {
  // THE NEGATIVE CONTROL, and it is not decoration: a guard that threw on
  // everything would pass every rejection test below it.
  assert.doesNotThrow(() => assertOverlay(wire()));

  const loaded = {
    ...wire(),
    sections: { kb: { title: "Perjanjian Kerjasama" }, mom: { removed: true } },
    slots: {
      "kb.nomor": {
        label: "No. PKS",
        catatan: { adalah: "Nomor kontrak.", bukan: "Bukan nomor SP." },
      },
      "kb.tanggal": { removed: true },
    },
    added: [
      {
        id: "u:lampiran",
        title: "Lampiran Teknis",
        origin: "llm",
        fromSourceId: "doc-2",
        cite: { pageIndex: 4, lineRange: [2, 9] },
        pages: [4, 5],
        slots: [{ id: "u:lampiran.1", label: "Halaman 1" }],
      },
    ],
    proposed: [
      {
        id: "u:pending",
        title: "Berita Acara Uji Terima",
        fromSourceId: "doc-3",
        fromPages: [11],
        cite: { pageIndex: 11, lineRange: [0, 4] },
      },
    ],
    order: ["email", "u:lampiran", "kb"],
  };
  assert.doesNotThrow(() => assertOverlay(loaded));
});

test("assertOverlay refuses a value that is not an object", () => {
  assert.throws(() => assertOverlay(null), OverlayError);
  assert.throws(() => assertOverlay("{}"), OverlayError);
  assert.throws(() => assertOverlay(7), OverlayError);
  assert.throws(() => assertOverlay([]), OverlayError);
});

test("assertOverlay refuses a version it does not understand", () => {
  assert.throws(() => assertOverlay({ ...wire(), version: 2 }), OverlayError);
  const noVersion = wire();
  delete noVersion.version;
  assert.throws(() => assertOverlay(noVersion), OverlayError);
});

test("assertOverlay refuses a missing base", () => {
  const missing = wire();
  delete missing.base;
  assert.throws(() => assertOverlay(missing), OverlayError);
  assert.throws(() => assertOverlay({ ...wire(), base: "" }), OverlayError);
  assert.throws(() => assertOverlay({ ...wire(), base: 1 }), OverlayError);
});

test("assertOverlay refuses a missing baseFingerprint", () => {
  const missing = wire();
  delete missing.baseFingerprint;
  assert.throws(() => assertOverlay(missing), OverlayError);
});

test("assertOverlay refuses an id containing the capture separator", () => {
  assert.throws(
    () => assertOverlay({ ...wire(), sections: { "kb#2": { title: "KB" } } }),
    OverlayError,
  );
  assert.throws(
    () => assertOverlay({ ...wire(), slots: { "kb.nomor#2": { label: "No." } } }),
    OverlayError,
  );
  assert.throws(
    () =>
      assertOverlay({
        ...wire(),
        added: [{ id: "u:a#1", title: "Lampiran", origin: "human", slots: [] }],
      }),
    OverlayError,
  );
  assert.throws(
    () =>
      assertOverlay({
        ...wire(),
        added: [
          {
            id: "u:a",
            title: "Lampiran",
            origin: "human",
            slots: [{ id: "u:a.1#2", label: "Halaman 1" }],
          },
        ],
      }),
    OverlayError,
  );
});

test("assertOverlay refuses an empty title", () => {
  assert.throws(
    () => assertOverlay({ ...wire(), sections: { kb: { title: "" } } }),
    OverlayError,
  );
  // Whitespace is empty too: a heading of spaces prints as a gap in the packet
  // that an operator cannot tell from a section that failed to render.
  assert.throws(
    () => assertOverlay({ ...wire(), sections: { kb: { title: "   " } } }),
    OverlayError,
  );
  assert.throws(
    () =>
      assertOverlay({
        ...wire(),
        added: [{ id: "u:a", title: "", origin: "human", slots: [] }],
      }),
    OverlayError,
  );
});

test("assertOverlay refuses a title over 200 characters", () => {
  const long = "x".repeat(201);
  assert.throws(
    () => assertOverlay({ ...wire(), sections: { kb: { title: long } } }),
    OverlayError,
  );
  assert.throws(
    () => assertOverlay({ ...wire(), slots: { "kb.nomor": { label: long } } }),
    OverlayError,
  );
  assert.doesNotThrow(() =>
    assertOverlay({ ...wire(), sections: { kb: { title: "x".repeat(200) } } }),
  );
});

test("assertOverlay refuses a duplicate id across sections and added", () => {
  assert.throws(
    () =>
      assertOverlay({
        ...wire(),
        sections: { "u:lampiran": { title: "Lampiran" } },
        added: [
          { id: "u:lampiran", title: "Lampiran", origin: "human", slots: [] },
        ],
      }),
    OverlayError,
  );
  // Two added bagian claiming one id.
  assert.throws(
    () =>
      assertOverlay({
        ...wire(),
        added: [
          { id: "u:a", title: "Satu", origin: "human", slots: [] },
          { id: "u:a", title: "Dua", origin: "human", slots: [] },
        ],
      }),
    OverlayError,
  );
  // Two added slots claiming one id, across two different bagian.
  assert.throws(
    () =>
      assertOverlay({
        ...wire(),
        added: [
          {
            id: "u:a",
            title: "Satu",
            origin: "human",
            slots: [{ id: "u:shared", label: "Halaman 1" }],
          },
          {
            id: "u:b",
            title: "Dua",
            origin: "human",
            slots: [{ id: "u:shared", label: "Halaman 1" }],
          },
        ],
      }),
    OverlayError,
  );
  // A proposal naming a section that already exists.
  assert.throws(
    () =>
      assertOverlay({
        ...wire(),
        added: [{ id: "u:a", title: "Satu", origin: "human", slots: [] }],
        proposed: [
          {
            id: "u:a",
            title: "Satu",
            fromSourceId: "doc-2",
            fromPages: [1],
            cite: { pageIndex: 1, lineRange: [0, 2] },
          },
        ],
      }),
    OverlayError,
  );
});

test("assertOverlay refuses an order with duplicates", () => {
  assert.throws(
    () => assertOverlay({ ...wire(), order: ["kb", "email", "kb"] }),
    OverlayError,
  );
  assert.throws(
    () => assertOverlay({ ...wire(), order: "kb" }),
    OverlayError,
  );
  // An id naming nothing is NOT a wire error: the resolver ignores it, because
  // a stored order outlives the section it named the moment the base drops one.
  assert.doesNotThrow(() =>
    assertOverlay({ ...wire(), order: ["u:ghost", "kb"] }),
  );
});

test("assertOverlay refuses a non-array added and a non-array proposed", () => {
  assert.throws(() => assertOverlay({ ...wire(), added: {} }), OverlayError);
  assert.throws(() => assertOverlay({ ...wire(), added: null }), OverlayError);
  assert.throws(() => assertOverlay({ ...wire(), proposed: {} }), OverlayError);
  assert.throws(() => assertOverlay({ ...wire(), proposed: "" }), OverlayError);
});

test("assertOverlay refuses sections and slots that are not patch objects", () => {
  // An array is not a record of patches: its keys are indexes, so every patch
  // would be filed under an id that names nothing and every edit would vanish.
  assert.throws(() => assertOverlay({ ...wire(), slots: [] }), OverlayError);
  assert.throws(() => assertOverlay({ ...wire(), sections: [] }), OverlayError);
  assert.throws(() => assertOverlay({ ...wire(), sections: null }), OverlayError);
  assert.throws(
    () => assertOverlay({ ...wire(), sections: { kb: "Perjanjian" } }),
    OverlayError,
  );
});

test("assertOverlay refuses a removed flag that is not exactly true", () => {
  assert.throws(
    () => assertOverlay({ ...wire(), sections: { kb: { removed: false } } }),
    OverlayError,
  );
  assert.throws(
    () => assertOverlay({ ...wire(), slots: { "kb.nomor": { removed: 1 } } }),
    OverlayError,
  );
});

test("assertOverlay refuses a reversed or negative citation", () => {
  const cited = (cite: unknown) => ({
    ...wire(),
    proposed: [
      {
        id: "u:p",
        title: "Lampiran",
        fromSourceId: "doc-2",
        fromPages: [4],
        cite,
      },
    ],
  });

  assert.throws(
    () => assertOverlay(cited({ pageIndex: 4, lineRange: [9, 2] })),
    OverlayError,
  );
  assert.throws(
    () => assertOverlay(cited({ pageIndex: -1, lineRange: [2, 9] })),
    OverlayError,
  );
  assert.throws(
    () => assertOverlay(cited({ pageIndex: 4, lineRange: [2] })),
    OverlayError,
  );
  assert.doesNotThrow(() =>
    assertOverlay(cited({ pageIndex: 4, lineRange: [2, 9] })),
  );
});

test("assertOverlay refuses an origin that is neither human nor llm", () => {
  assert.throws(
    () =>
      assertOverlay({
        ...wire(),
        added: [{ id: "u:a", title: "Lampiran", origin: "auto", slots: [] }],
      }),
    OverlayError,
  );
});

// THE FENCE, one test per fenced key, each planting it at a different depth.
// Six tests rather than one loop body with six asserts, so a hole in the fence
// names the key it let through.
for (const key of ["ask", "hint", "docType", "layout", "pageOrdinal", "fillable"]) {
  test(`assertOverlay refuses "${key}" at the top level`, () => {
    assert.throws(
      () => assertOverlay({ ...wire(), [key]: "anything" }),
      OverlayError,
    );
  });

  test(`assertOverlay refuses "${key}" nested inside an added slot`, () => {
    // Depth five: overlay.added[0].slots[0].<key>. The walk is recursive
    // precisely because the fence has to hold against the shape nobody thought
    // of, not only against the fields this module happens to name.
    assert.throws(
      () =>
        assertOverlay({
          ...wire(),
          added: [
            {
              id: "u:a",
              title: "Lampiran",
              origin: "human",
              slots: [{ id: "u:a.1", label: "Halaman 1", [key]: "anything" }],
            },
          ],
        }),
      OverlayError,
    );
  });

  test(`assertOverlay refuses "${key}" nested inside a catatan`, () => {
    assert.throws(
      () =>
        assertOverlay({
          ...wire(),
          slots: {
            "kb.nomor": {
              catatan: { adalah: "Nomor kontrak.", [key]: "anything" },
            },
          },
        }),
      OverlayError,
    );
  });
}

test("the fence does not fire on a legitimate overlay", () => {
  // Stated separately from the accept test above because the six rejection
  // tests are only meaningful if the same shapes pass without the fenced key.
  assert.doesNotThrow(() =>
    assertOverlay({
      ...wire(),
      slots: { "kb.nomor": { catatan: { adalah: "Nomor kontrak." } } },
      added: [
        {
          id: "u:a",
          title: "Lampiran",
          origin: "human",
          slots: [{ id: "u:a.1", label: "Halaman 1" }],
        },
      ],
    }),
  );
});

test("assertOverlay refuses a cycle rather than hanging on one", () => {
  const cyclic = wire();
  const loop: Record<string, unknown> = { id: "u:a" };
  loop.self = loop;
  cyclic.sections = { kb: loop };
  assert.throws(() => assertOverlay(cyclic), OverlayError);
});

// ---------------------------------------------------------------------------
// 8. The real form
// ---------------------------------------------------------------------------

test("AO_TEMPLATE resolves to itself under an empty overlay", () => {
  assert.equal(resolveTemplate(AO_TEMPLATE, undefined), AO_TEMPLATE);
  assert.equal(
    resolveTemplate(AO_TEMPLATE, emptyOverlay(AO_TEMPLATE)),
    AO_TEMPLATE,
  );
});

test("AO_TEMPLATE's ids are unique, separator-free, and none is marked added", () => {
  const sectionIds = new Set<string>();
  const slotKeys = new Set<string>();

  for (const section of AO_TEMPLATE.sections) {
    assert.doesNotThrow(
      () => assertNodeId(section.id),
      `section "${section.title}" has an id an overlay could not patch`,
    );
    assert.equal(sectionIds.has(section.id), false, `duplicate id ${section.id}`);
    sectionIds.add(section.id);
    // `added === undefined` means "this bagian is the form". A base section
    // carrying it would make every added-bagian check answer wrong.
    assert.equal(section.added, undefined);

    for (const slot of section.slots) {
      assert.doesNotThrow(() => assertNodeId(slot.key));
      assert.equal(slotKeys.has(slot.key), false, `duplicate key ${slot.key}`);
      slotKeys.add(slot.key);
      assert.equal(slot.added, undefined);
      // Every base slot is searchable in principle, which is what makes
      // `isSearchable` answering false a statement about an ADDED bagian.
      assert.equal(isSearchable(AO_TEMPLATE, slot.key), true);
      assert.equal(addedSectionOf(AO_TEMPLATE, slot.key), null);
    }
  }
});

test("a rename of a real section moves no question the gate measured", () => {
  const overlay = withPatches(AO_TEMPLATE, {
    sections: { kb: { title: "PKS" } },
    slots: { "kb.nomor": { label: "No. PKS" } },
  });
  const resolved = resolveTemplate(AO_TEMPLATE, overlay);

  assert.equal(sectionById(resolved, "kb").title, "PKS");
  assert.equal(slotByKey(resolved, "kb.nomor").label, "No. PKS");
  for (const section of resolved.sections) {
    assert.deepEqual(section.ask, sectionById(AO_TEMPLATE, section.id).ask);
    for (const slot of section.slots) {
      assert.deepEqual(slot.ask, slotByKey(AO_TEMPLATE, slot.key).ask);
    }
  }
});
