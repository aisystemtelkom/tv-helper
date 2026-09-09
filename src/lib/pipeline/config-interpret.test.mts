/**
 * Offline tests for workbook interpretation: the stage that decides which
 * cells of an operator's order-configuration sheet are FIELDS.
 *
 * The failure class this protects is a field an operator rules on that the
 * workbook never asked for, and a recommendation aimed at a cell that is not
 * where the field lives. Both open cleanly and look complete: an invented
 * label reads as an ordinary row, and an edit written to the wrong address
 * comes back in a file Excel is perfectly happy with.
 *
 * No API call, no credential, no workbook on disk. `validateInterpretation` is
 * pure, so every rule is driven with a hand-built `Sheet` and a hand-built
 * reply; `interpretWorkbook` is driven with an `Ask` that returns a canned
 * string.
 *
 * EVERY STRING HERE IS INVENTED. The fictional set this repo uses is
 * LOP999001, 1-70000000001, BANK CONTOH NUSANTARA, PSB VPN IP KCP Contoh, SID
 * 1209990001, Budi Contoh, budi@contoh.example. The field names below are
 * generic Indonesian order-form furniture, not a client's workbook: this repo
 * is public.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { formatRef, parseRef, type Cell, type Sheet } from "../xlsx/grid.ts";
import { listingTruncated } from "../xlsx/listing.ts";
import {
  buildInterpretPrompt,
  interpretWorkbook,
  validateInterpretation,
} from "./config-interpret.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A sheet built out of the cells that are actually written, exactly as the
 * reader produces one: EMPTY CELLS ARE ABSENT. `extent` is how far the sheet
 * reaches beyond them, which is what makes an empty-but-legitimate `valueRef`
 * expressible at all.
 */
function sheet(
  name: string,
  written: Record<string, string>,
  extent?: { rows: number; cols: number },
): Sheet {
  const cells: Cell[] = Object.entries(written).map(([ref, text]) => {
    const { col, row } = parseRef(ref);
    return { ref, row, col, text, kind: "text" as const };
  });
  cells.sort((a, b) => a.row - b.row || a.col - b.col);

  const rows = extent?.rows ?? cells.reduce((n, c) => Math.max(n, c.row), 0);
  const cols = extent?.cols ?? cells.reduce((n, c) => Math.max(n, c.col), 0);

  return {
    name,
    cells,
    byRef: new Map(cells.map((cell) => [cell.ref, cell])),
    // `""` for a sheet with no non-empty cell, exactly as `read.ts` emits it.
    dimension: rows > 0 && cols > 0 ? `A1:${formatRef(cols, rows)}` : "",
    rows,
    cols,
    merges: [],
  };
}

/**
 * The first of the three real layouts, in miniature: field names down column
 * C, values in column E, and one value cell (E10) deliberately EMPTY.
 */
const DOWN_A_COLUMN = sheet(
  "Config",
  {
    C1: "Item I",
    E1: "Keterangan",
    C9: "Nama Pelanggan",
    E9: "BANK CONTOH NUSANTARA",
    C10: "Alamat Instalasi",
    C11: "Nama Proyek",
    E11: "PSB VPN IP KCP Contoh",
  },
  { rows: 35, cols: 5 },
);

/** A deterministic `mintId`, so a test can assert about the ids it produced. */
function minting() {
  let n = 0;
  return () => `f${(n += 1)}`;
}

/** An `Ask` that answers with one canned reply and records what it was sent. */
function asking(reply: unknown) {
  const prompts: string[] = [];
  const ask = async (prompt: string) => {
    prompts.push(prompt);
    return typeof reply === "string" ? reply : JSON.stringify(reply);
  };
  return { ask, prompts };
}

/** One well-formed entry, so a test only has to state what it is changing. */
function entry(over: Record<string, unknown> = {}) {
  return {
    label: "Nama Pelanggan",
    labelRef: "C9",
    valueRef: "E9",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test("a good reply becomes fields, with each value read out of the grid", () => {
  const read = validateInterpretation(
    DOWN_A_COLUMN,
    {
      fields: [
        entry(),
        { label: "Nama Proyek", labelRef: "C11", valueRef: "E11" },
      ],
    },
    minting(),
  );

  assert.deepEqual(read.unusable, []);
  assert.deepEqual(
    read.fields.map((field) => field.label),
    ["Nama Pelanggan", "Nama Proyek"],
  );
  // THE VALUE COMES OFF THE SHEET, NEVER OUT OF THE REPLY: the model is not
  // asked what a cell says, so a misread number cannot reach an operator.
  assert.equal(read.fields[0].excelValue, "BANK CONTOH NUSANTARA");
  assert.equal(read.fields[1].excelValue, "PSB VPN IP KCP Contoh");
  assert.equal(read.fields[0].sheet, "Config");
  assert.match(read.note, /2 field\(s\) read out of sheet "Config"/);
});

test("a value cell that is EMPTY is a field, not a reject", () => {
  // The single easiest rule here to tighten into a bug. C10's value cell E10
  // holds nothing, so the reader never emitted it and it is absent from
  // `byRef` -- and an empty cell EPIC expects filled is the entire reason
  // Checkpoint 2 exists.
  const read = validateInterpretation(
    DOWN_A_COLUMN,
    { fields: [{ label: "Alamat Instalasi", labelRef: "C10", valueRef: "E10" }] },
    minting(),
  );

  assert.deepEqual(read.unusable, []);
  assert.equal(read.fields.length, 1);
  assert.equal(read.fields[0].valueRef, "E10");
  assert.equal(
    read.fields[0].excelValue,
    "",
    "an empty cell is a real state, not a missing field",
  );
});

test("a label wrapped, cased and spaced differently is still the same label", () => {
  // Case and whitespace are packaging, exactly as they are for a judul title
  // in sections.ts. The cell is what the sheet prints; the reply is a slice of
  // it, and only a slice can ever pass.
  const spaced = sheet("Config", { B4: "NAMA   PELANGGAN\n(sesuai KTP)" }, {
    rows: 10,
    cols: 5,
  });
  const read = validateInterpretation(
    spaced,
    { fields: [{ label: "nama pelanggan", labelRef: "B4", valueRef: "C4" }] },
    minting(),
  );

  assert.deepEqual(read.unusable, []);
  assert.equal(read.fields.length, 1);
  assert.equal(
    read.fields[0].label,
    "nama pelanggan",
    "the model's own wording is stored, which the substring rule makes safe",
  );
});

// ---------------------------------------------------------------------------
// The anti-fabrication rule
// ---------------------------------------------------------------------------

test("a label that is not the text of the cell it cites is refused", () => {
  const read = validateInterpretation(
    DOWN_A_COLUMN,
    {
      fields: [
        // Plausible, absent from C9, and a field name the workbook never
        // asked for. Nothing downstream could catch one: the operator reads
        // the row, believes the sheet wants it, and rules on it.
        entry({ label: "Nama pelanggan yang berlangganan layanan" }),
      ],
    },
    minting(),
  );

  assert.deepEqual(read.fields, []);
  assert.equal(read.unusable.length, 1);
  assert.match(read.unusable[0].reason, /described rather than read/);
  assert.match(
    read.unusable[0].reason,
    /C9/,
    "the refusal must name the cell, so a person can go and look at it",
  );
});

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

test("a malformed labelRef and a malformed valueRef are each refused by name", () => {
  const read = validateInterpretation(
    DOWN_A_COLUMN,
    {
      fields: [
        entry({ labelRef: "C" }),
        entry({ valueRef: "9E" }),
        entry({ labelRef: "" }),
      ],
    },
    minting(),
  );

  assert.deepEqual(read.fields, []);
  assert.equal(read.unusable.length, 3);
  assert.match(read.unusable[0].reason, /labelRef "C" is not a cell address/);
  assert.match(read.unusable[1].reason, /valueRef "9E" is not a cell address/);
  assert.match(read.unusable[2].reason, /is not a cell address/);
});

test("a labelRef the sheet has no text at is refused, and says which of the two it is", () => {
  const read = validateInterpretation(
    DOWN_A_COLUMN,
    {
      // E10 is inside the sheet and empty; ZZ1 is outside it entirely. Two
      // different mistakes, so two different reasons: a deployer reading the
      // log can tell "the model cited a blank" from "the model invented an
      // address past the edge of the sheet".
      fields: [
        entry({ labelRef: "E10", valueRef: "E12" }),
        entry({ labelRef: "ZZ1", valueRef: "E12" }),
      ],
    },
    minting(),
  );

  assert.deepEqual(read.fields, []);
  assert.match(read.unusable[0].reason, /labelRef E10 is empty on sheet "Config"/);
  assert.match(read.unusable[1].reason, /labelRef ZZ1 is outside sheet "Config"/);
  assert.match(read.unusable[1].reason, /reach E35/);
});

test("a valueRef far outside the sheet is refused, though an empty one inside it is not", () => {
  const read = validateInterpretation(
    DOWN_A_COLUMN,
    {
      fields: [
        entry({ valueRef: "E200" }),
        { label: "Nama Proyek", labelRef: "C11", valueRef: "E12" },
      ],
    },
    minting(),
  );

  assert.equal(read.unusable.length, 1);
  assert.match(read.unusable[0].reason, /valueRef E200 is outside sheet "Config"/);
  assert.match(read.unusable[0].reason, /no cell to fill/);
  assert.equal(
    read.fields.length,
    1,
    "E12 is empty but inside the sheet, so it is a cell that can be filled",
  );
});

test("a whole blank data area is still fields, not twenty refusals", () => {
  /*
   * `Sheet.dimension` is the extent of the NON-EMPTY cells, so on a workbook
   * nobody has filled in yet the entire data area sits past it. Two of the
   * three real layouts put their data rows below the last row carrying text,
   * and a bound at the extent would refuse every field of them with "outside
   * the sheet" as the reason -- on a workbook whose only fault is being new.
   * `BLANK_MARGIN` is what stops that; this pins the case it was measured for.
   */
  const fresh = sheet("Layanan", {
    B2: "SID",
    C2: "Alamat Instalasi",
    D2: "Nama Proyek",
  });
  assert.equal(fresh.rows, 2, "nothing below the header row carries text");

  const read = validateInterpretation(
    fresh,
    {
      fields: [
        { label: "Alamat Instalasi", labelRef: "C2", valueRef: "C3" },
        { label: "Nama Proyek", labelRef: "D2", valueRef: "D4" },
      ],
    },
    minting(),
  );

  assert.deepEqual(read.unusable, []);
  assert.deepEqual(
    read.fields.map((field) => field.excelValue),
    ["", ""],
  );
});

test("a field whose value cell is its own name cell is refused", () => {
  const read = validateInterpretation(
    DOWN_A_COLUMN,
    { fields: [entry({ valueRef: "C9" })] },
    minting(),
  );

  assert.deepEqual(read.fields, []);
  assert.match(read.unusable[0].reason, /overwrite the field's own name/);
});

// ---------------------------------------------------------------------------
// Two fields, one cell
// ---------------------------------------------------------------------------

test("two fields claiming one valueRef: the second goes, the first stays", () => {
  /*
   * A DELIBERATE DEPARTURE FROM `refuseOverlaps` in sections.ts, which drops
   * BOTH members of an overlapping pair. There the model mis-segmented and
   * neither answer is evidence about the other. Here the two entries do not
   * disagree about anything -- they are one field named twice -- and dropping
   * both would leave E9 checked by nothing while the summary counted a full
   * sheet. What must not survive is the pair: two approved recommendations for
   * one address are two `CellEdit`s applied by arrival order.
   */
  const read = validateInterpretation(
    DOWN_A_COLUMN,
    {
      fields: [
        entry(),
        { label: "Nama Proyek", labelRef: "C11", valueRef: "E9" },
      ],
    },
    minting(),
  );

  assert.deepEqual(
    read.fields.map((field) => field.label),
    ["Nama Pelanggan"],
  );
  assert.equal(read.unusable.length, 1);
  assert.equal(read.unusable[0].label, "Nama Proyek");
  assert.match(read.unusable[0].reason, /already the value cell of "Nama Pelanggan"/);
});

test("a valueRef that is another field's labelRef is refused, and only the writer is", () => {
  /*
   * This is how the feature would quietly rename a field in the operator's own
   * workbook. `pendingEdits` turns an approved recommendation into a
   * `CellEdit`, `patchWorkbook` writes it, and the workbook comes back opening
   * cleanly with a scan's value standing where "Alamat Instalasi" used to be.
   *
   * The field being NAMED is unharmed, so it survives; only the one that would
   * do the writing goes. Asserted in reply order AND in the note count, because
   * a first-listed-wins rule would have picked the other one here.
   */
  const read = validateInterpretation(
    DOWN_A_COLUMN,
    {
      fields: [
        entry({ valueRef: "C10" }),
        { label: "Alamat Instalasi", labelRef: "C10", valueRef: "E10" },
      ],
    },
    minting(),
  );

  assert.deepEqual(
    read.fields.map((field) => field.label),
    ["Alamat Instalasi"],
  );
  assert.equal(read.unusable.length, 1);
  assert.equal(read.unusable[0].label, "Nama Pelanggan");
  assert.match(read.unusable[0].reason, /overwrite that field's name/);
});

test("the same rule holds when the model lists the two the other way round", () => {
  const read = validateInterpretation(
    DOWN_A_COLUMN,
    {
      fields: [
        { label: "Alamat Instalasi", labelRef: "C10", valueRef: "E10" },
        entry({ valueRef: "C10" }),
      ],
    },
    minting(),
  );

  assert.deepEqual(
    read.fields.map((field) => field.label),
    ["Alamat Instalasi"],
    "the answer must not depend on which of the two the model happened to list first",
  );
  assert.equal(read.unusable.length, 1);
});

// ---------------------------------------------------------------------------
// Malformed entries, and the line between an entry and a reply
// ---------------------------------------------------------------------------

test("a malformed entry is refused on its own, and the good ones beside it survive", () => {
  const read = validateInterpretation(
    DOWN_A_COLUMN,
    {
      fields: [
        { labelRef: "C9", valueRef: "E9" }, // no label at all
        { label: "Nama Pelanggan", labelRef: 9, valueRef: "E9" }, // wrong type
        { label: "", labelRef: "C9", valueRef: "E9" }, // empty label
        entry({ label: "Nama Proyek", labelRef: "C11", valueRef: "E11" }),
      ],
    },
    minting(),
  );

  // One fabricated or mistyped entry is no reason to lose the seventy-one
  // real fields of a transposed workbook.
  assert.deepEqual(
    read.fields.map((field) => field.label),
    ["Nama Proyek"],
  );
  assert.equal(read.unusable.length, 3);
  for (const one of read.unusable) {
    assert.match(one.reason, /the entry is not a field/);
  }
  assert.equal(
    read.unusable[0].label,
    "(the entry named no field)",
    "an entry with no label must still be reportable",
  );
  assert.equal(
    read.unusable[0].labelRef,
    "C9",
    "whatever the model did write is echoed back, so a person can see it",
  );
});

test("a reply that is not an object at all throws rather than answering empty", () => {
  // `extractJson`'s own line, and the one classifyPages and discoverSections
  // both draw. An empty answer here would read as "this workbook holds no
  // fields", which is a different and false statement.
  assert.throws(() => validateInterpretation(DOWN_A_COLUMN, "no fields", minting()));
  assert.throws(() => validateInterpretation(DOWN_A_COLUMN, null, minting()));
  assert.throws(() => validateInterpretation(DOWN_A_COLUMN, [entry()], minting()));
  assert.throws(() =>
    validateInterpretation(DOWN_A_COLUMN, { fields: "Nama Pelanggan" }, minting()),
  );
});

// ---------------------------------------------------------------------------
// Groups: which data row a field belongs to
// ---------------------------------------------------------------------------

test("a group is carried through, and a blank one is dropped rather than stored", () => {
  /*
   * Two of the three real workbooks carry one row per SERVICE: the same twenty
   * field names against two SIDs. Without `group` the operator meets "Alamat
   * Instalasi" twice with nothing to tell them apart, and a decision on one
   * reads as a decision on the other.
   *
   * `undefined` rather than `""` for a blank, so the key is absent exactly
   * when there is no row to name and a screen can branch on its presence.
   */
  const perService = sheet(
    "Layanan",
    {
      E4: "Alamat Instalasi",
      F4: "Nama Proyek",
      B5: "1209990001",
      B6: "1209990002",
    },
    { rows: 6, cols: 8 },
  );

  const read = validateInterpretation(
    perService,
    {
      fields: [
        { label: "Alamat Instalasi", labelRef: "E4", valueRef: "E5", group: " 1209990001 " },
        { label: "Alamat Instalasi", labelRef: "E4", valueRef: "E6", group: "1209990002" },
        { label: "Nama Proyek", labelRef: "F4", valueRef: "F5", group: "   " },
        { label: "Nama Proyek", labelRef: "F4", valueRef: "F6", group: null },
      ],
    },
    minting(),
  );

  assert.deepEqual(read.unusable, []);
  assert.deepEqual(
    read.fields.map((field) => field.group),
    ["1209990001", "1209990002", undefined, undefined],
  );
  assert.ok(
    !("group" in read.fields[2]),
    "a blank group must be absent, not an empty string a screen would print",
  );
  assert.ok(
    !("group" in read.fields[3]),
    "null is packaging for 'this sheet has one data row', not a group named null",
  );
  // Two fields may share a labelRef: in a header-row layout every service in
  // the column is named by the same header cell.
  assert.equal(read.fields[0].labelRef, read.fields[1].labelRef);
});

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

test("an id is minted only for a field that survives, so a refusal leaves no hole", () => {
  // `ConfigField.id` is the key every later decision hangs off. A refused
  // entry that consumed one would leave a gap in a counter-minted list and an
  // id no entry carries, which reads to a caller like a lost field.
  const read = validateInterpretation(
    DOWN_A_COLUMN,
    {
      fields: [
        entry(),
        entry({ label: "Alamat gedung baru" }), // refused: not the text at C9
        { label: "Nama Proyek", labelRef: "C11", valueRef: "E11" },
      ],
    },
    minting(),
  );

  assert.deepEqual(
    read.fields.map((field) => field.id),
    ["f1", "f2"],
  );
  assert.equal(read.unusable.length, 1);
});

// ---------------------------------------------------------------------------
// The note
// ---------------------------------------------------------------------------

test("the note tells the three empty-handed cases apart", () => {
  const nothingNamed = validateInterpretation(DOWN_A_COLUMN, { fields: [] }, minting());
  assert.deepEqual(nothingNamed.fields, []);
  assert.match(nothingNamed.note, /found no field/);

  const allRefused = validateInterpretation(
    DOWN_A_COLUMN,
    { fields: [entry({ label: "Alamat gedung baru" })] },
    minting(),
  );
  assert.match(allRefused.note, /named 1 field\(s\) and none of them could be checked/);
  assert.match(allRefused.note, /described rather than read/);

  const mixed = validateInterpretation(
    DOWN_A_COLUMN,
    { fields: [entry(), entry({ label: "Alamat gedung baru" })] },
    minting(),
  );
  assert.match(mixed.note, /1 field\(s\) read out of sheet "Config"/);
  assert.match(mixed.note, /1 refused/);
});

test("a listing cut short at MAX_LISTING_CELLS says so in the note", () => {
  // A caller reading "12 fields" has no way to know the model was shown two
  // thirds of the sheet. Neither array carries that fact, so the sentence does.
  const written: Record<string, string> = {};
  for (let row = 1; row <= 820; row += 1) {
    for (let col = 1; col <= 5; col += 1) {
      written[formatRef(col, row)] = `sel ${col}-${row}`;
    }
  }
  const big = sheet("Besar", written);
  assert.ok(
    listingTruncated(big),
    "a 4100-cell sheet must be past MAX_LISTING_CELLS for this test to mean anything",
  );

  const read = validateInterpretation(big, { fields: [] }, minting());
  assert.match(read.note, /cut short/);
  assert.match(read.note, /did not see the whole sheet/);
  assert.equal(
    read.note.split(". ").length,
    1,
    "the note is one sentence by contract; truncation is a clause on it",
  );
});

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

test("the question leads and the listing follows", () => {
  const prompt = buildInterpretPrompt(DOWN_A_COLUMN);
  const question = prompt.indexOf("List the fields this sheet holds");
  const listing = prompt.indexOf("Nama Pelanggan");
  assert.ok(question >= 0, "the prompt must ask its question");
  assert.ok(listing > 0, "the prompt must carry the sheet's own cells");
  assert.ok(
    question < listing,
    "the listing must not come before the question; see the prefix-cache note in locate.ts",
  );
});

test("the prompt names all three real layouts and refuses to assume one", () => {
  // "STRUKTUR EXCEL RANDOM" is the client's own instruction. A prompt that
  // describes one shape gets that shape answered back on a sheet built the
  // other way, with every address plausible and every field wrong.
  const prompt = buildInterpretPrompt(DOWN_A_COLUMN);
  assert.match(prompt, /THE LAYOUT IS UNKNOWN AND YOU MUST NOT ASSUME ONE/);
  assert.match(prompt, /field names down one column/);
  assert.match(prompt, /a header row of field names, with one data row per service/);
  assert.match(prompt, /transposed/);
});

test("the prompt demands real addresses, a verbatim label, and a group that is not an index", () => {
  const prompt = buildInterpretPrompt(DOWN_A_COLUMN);
  assert.match(prompt, /must be an address that appears in the listing/);
  assert.match(prompt, /copied verbatim from the cell at `labelRef`/);
  assert.match(prompt, /MAY be a cell that is\s+empty/);
  assert.match(prompt, /never an index/);
  assert.match(prompt, /Reply with JSON only/);
});

test("the prompt carries no real customer, project, quote or LOP identifier", () => {
  // This repo is public and the prompt ships in it. The worked example must
  // come out of the fictional set, not out of a client's workbook.
  const prompt = buildInterpretPrompt(sheet("Config", {}, { rows: 1, cols: 1 }));
  assert.match(prompt, /1209990001/, "the example group is the fictional SID");
  assert.doesNotMatch(prompt, /LOP2\d{5}/);
});

// ---------------------------------------------------------------------------
// The model-facing half
// ---------------------------------------------------------------------------

test("interpretWorkbook asks once, and reads the reply out of prose around it", async () => {
  const { ask, prompts } = asking(
    "Here is what I found:\n```json\n" +
      JSON.stringify({ fields: [entry()] }) +
      "\n```\nHope that helps.",
  );

  const read = await interpretWorkbook({
    sheet: DOWN_A_COLUMN,
    ask,
    mintId: minting(),
  });

  assert.equal(prompts.length, 1);
  assert.equal(read.fields.length, 1);
  assert.equal(read.fields[0].excelValue, "BANK CONTOH NUSANTARA");
});

test("a sheet with no non-empty cell buys a sentence, not a model call", async () => {
  let called = 0;
  const read = await interpretWorkbook({
    sheet: sheet("Kosong", {}),
    ask: async () => {
      called += 1;
      return "{}";
    },
    mintId: minting(),
  });

  assert.equal(called, 0, "there is nothing to ask about, so nothing is spent");
  assert.deepEqual(read.fields, []);
  assert.deepEqual(read.unusable, []);
  assert.match(read.note, /has no non-empty cell, so nothing was asked/);
});

test("a reply with no JSON in it throws rather than answering empty", async () => {
  const { ask } = asking("I could not read this workbook.");
  await assert.rejects(
    () => interpretWorkbook({ sheet: DOWN_A_COLUMN, ask, mintId: minting() }),
    /No JSON object/,
  );
});
