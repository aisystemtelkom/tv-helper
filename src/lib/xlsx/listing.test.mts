/**
 * WHAT THIS FILE PROTECTS: a listing that describes a layout the workbook does
 * not have, or describes less of the workbook than it claims to.
 *
 * `sheetListing` is the only picture of the operator's spreadsheet the model
 * ever sees, and every downstream address is validated against `Sheet.byRef`
 * rather than against this string -- so a wrong picture produces answers that
 * pass every validation there is and point at the wrong cells. There is no
 * second check behind it. The failures pinned here are the ones that would be
 * silent:
 *
 *  - two cells with an empty column between them rendered as neighbours, which
 *    erases "the values are two columns to the right of the labels" -- the
 *    whole content of the question for one of the three real layouts;
 *  - a hard line break inside a cell splitting one row of a row-per-line
 *    listing into two;
 *  - a long value cut without saying so, which makes the model compare the
 *    scans against a value the workbook does not hold;
 *  - a listing capped at `MAX_LISTING_CELLS` while `listingTruncated` reports
 *    full coverage, which is a comparison of a fraction of the workbook
 *    presented to an operator as a comparison of all of it.
 *
 * No model, no network, no IndexedDB: every function under test is pure, and
 * the sheets are hand-built so a test can state a layout in one literal.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { parseRef, formatRef, type Cell, type Sheet } from "./grid.ts";
import {
  MAX_CELL_TEXT,
  MAX_LISTING_CELLS,
  MAX_LISTING_MERGES,
  listingTruncated,
  listingTruncation,
  sheetListing,
} from "./listing.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A `Sheet` from a plain `{ ref: text }` literal, so a test can state a layout
 * the way a person reads one off a screen.
 *
 * Addresses are turned into coordinates by `parseRef`, never by a second copy
 * of the column arithmetic living in this file: a fixture that disagreed with
 * `grid.ts` about where `AN` is would make these tests pass against a listing
 * that is wrong, which is the one failure a test suite must not be able to
 * have.
 */
function sheet(
  name: string,
  values: Record<string, string>,
  extra: { merges?: string[]; kinds?: Record<string, Cell["kind"]> } = {},
): Sheet {
  const cells: Cell[] = Object.entries(values).map(([ref, text]) => {
    const { col, row } = parseRef(ref);
    return { ref, col, row, text, kind: extra.kinds?.[ref] ?? "text" };
  });
  cells.sort((a, b) => a.row - b.row || a.col - b.col);

  const rows = cells.reduce((max, c) => Math.max(max, c.row), 1);
  const cols = cells.reduce((max, c) => Math.max(max, c.col), 1);

  return {
    name,
    cells,
    byRef: new Map(cells.map((c) => [c.ref, c])),
    dimension: `A1:${formatRef(cols, rows)}`,
    rows,
    cols,
    merges: extra.merges ?? [],
  };
}

/** The body of a listing: everything below the blank line after the header. */
function body(listing: string): string[] {
  const lines = listing.split("\n");
  return lines.slice(lines.indexOf("") + 1);
}

/** The one body line that begins with `r<row>`, for asserting about a row. */
function row(listing: string, n: number): string {
  const found = body(listing).find((line) => line.startsWith(`r${n} `));
  assert.ok(found, `the listing has no row ${n}:\n${listing}`);
  return found;
}

// ---------------------------------------------------------------------------
// The three real layouts
// ---------------------------------------------------------------------------

test("layout 1, labels down one column and values in another: the listing keeps the two columns apart", () => {
  // The shape of the first real workbook, transcribed with fictional content:
  // a four-column header row, then a numbered row per field with the field
  // name in C and its value in E.
  const listing = sheetListing(
    sheet("Konfigurasi", {
      A1: "Nomor",
      B1: "Item I",
      C1: "Item II",
      D1: "Keterangan",
      E1: "Isi",
      A2: "1",
      C2: "Nama Pelanggan",
      E2: "BANK CONTOH NUSANTARA",
      A3: "2",
      C3: "Nama Proyek",
      E3: "PSB VPN IP KCP Contoh",
    }),
  );

  assert.equal(
    row(listing, 1),
    "r1 | A1: Nomor | B1: Item I | C1: Item II | D1: Keterangan | E1: Isi",
  );
  assert.equal(
    row(listing, 2),
    "r2 | A2: 1 | <B2 empty> | C2: Nama Pelanggan | <D2 empty> | E2: BANK CONTOH NUSANTARA",
  );
  assert.match(
    row(listing, 3),
    /C3: Nama Proyek \| <D3 empty> \| E3: PSB VPN IP KCP Contoh$/,
    "the label column and the value column must stay two columns apart on every row",
  );
});

test("layout 2, one data row per service: each row carries its own addresses and its date cells say they are dates", () => {
  const listing = sheetListing(
    sheet(
      "Order",
      {
        A1: "text",
        B1: "text",
        C1: "date",
        A2: "SID",
        B2: "Nama Pelanggan",
        C2: "Tanggal Mulai",
        A3: "1209990001",
        B3: "BANK CONTOH NUSANTARA",
        C3: "2026-08-20",
        A4: "1209990002",
        B4: "BANK CONTOH NUSANTARA",
        C4: "2026-08-21",
      },
      { kinds: { C3: "date", C4: "date" } },
    ),
  );

  assert.equal(row(listing, 2), "r2 | A2: SID | B2: Nama Pelanggan | C2: Tanggal Mulai");
  assert.equal(
    row(listing, 3),
    "r3 | A3: 1209990001 | B3: BANK CONTOH NUSANTARA | C3: 2026-08-20 (date)",
  );
  assert.ok(
    row(listing, 4).includes("A4: 1209990002"),
    "the second service's row must be addressable on its own, or a decision about one SID reads as a decision about the other",
  );
});

test("layout 3, transposed: a row label in B and field names running across E onward stay far apart", () => {
  const listing = sheetListing(
    sheet("Metro", {
      B1: "Nomor",
      E1: "1",
      F1: "2",
      B4: "Keterangan",
      E4: "SID",
      F4: "Nama Pelanggan",
      B5: "Isi",
      E5: "1209990001",
      F5: "BANK CONTOH NUSANTARA",
    }),
  );

  assert.equal(row(listing, 1), "r1 | B1: Nomor | <C1:D1 empty> | E1: 1 | F1: 2");
  assert.equal(
    row(listing, 4),
    "r4 | B4: Keterangan | <C4:D4 empty> | E4: SID | F4: Nama Pelanggan",
  );
  assert.ok(
    body(listing).includes("<rows 2-3 empty>"),
    `rows 2 and 3 are empty and saying so is what stops r1 and r4 reading as adjacent:\n${listing}`,
  );
});

// ---------------------------------------------------------------------------
// Column and row gaps
// ---------------------------------------------------------------------------

test("a row with A, then D, then AN does not read as three adjacent cells", () => {
  const listing = sheetListing(
    sheet("Lebar", { A9: "Nomor", D9: "Item II", AN9: "Keterangan" }),
  );

  assert.equal(
    row(listing, 9),
    "r9 | A9: Nomor | <B9:C9 empty> | D9: Item II | <E9:AM9 empty> | AN9: Keterangan",
  );
});

test("a single empty column is named by its own address, so a value cell nobody has filled can still be cited", () => {
  // `ConfigField.valueRef` is allowed to point at an EMPTY cell -- an empty
  // cell EPIC expects filled is exactly what Checkpoint 2 exists to catch --
  // and a model that has never been shown an address cannot answer with it.
  const listing = sheetListing(sheet("Kosong", { C4: "Alamat", E4: "" }));

  assert.equal(row(listing, 4), "r4 | C4: Alamat | <D4 empty> | E4: (blank)");
});

test("a single empty row is named in the singular and a run of them by range", () => {
  const one = sheetListing(sheet("Satu", { A1: "a", A3: "b" }));
  assert.ok(body(one).includes("<row 2 empty>"), one);

  const many = sheetListing(sheet("Banyak", { A1: "a", A7: "b" }));
  assert.ok(body(many).includes("<rows 2-6 empty>"), many);
});

test("no gap marker is emitted where there is no gap", () => {
  const listing = sheetListing(sheet("Rapat", { A1: "a", B1: "b", A2: "c", B2: "d" }));

  // Checked on the body rather than on the whole listing: the header's own
  // "N non-empty cells" carries the word, and a substring test over everything
  // would pass for the wrong reason on a listing that really had gaps in it.
  assert.ok(
    !body(listing).some((line) => line.includes("<")),
    `adjacent cells and consecutive rows must not be annotated:\n${listing}`,
  );
});

test("a row that stops short of the sheet's last column is padded out, so an unfilled value cell can still be cited", () => {
  // The first real workbook's layout is a label in C, a note in D and THE
  // VALUE IN E, its last column. A field nobody has filled yet has no E cell
  // at all, so without this the row would end at D7 and `E7` would be an
  // address the model was never shown -- which it would then have to invent.
  const listing = sheetListing(
    sheet("Konfigurasi", {
      C1: "Item II",
      D1: "Keterangan",
      E1: "Isi",
      C7: "Alamat",
      D7: "alamat instalasi",
    }),
  );

  assert.equal(row(listing, 7), "r7 | C7: Alamat | D7: alamat instalasi | <E7 empty>");
  assert.ok(
    !row(listing, 1).includes("<"),
    "a row that already reaches the last column gets no padding",
  );
});

test("no leading marker is emitted for a row that opens past column A", () => {
  // An address carries its own column, so `C3` has already said that A and B
  // are empty. A trailing run has no such anchor after it, which is the whole
  // asymmetry.
  const listing = sheetListing(sheet("Mulai", { A1: "a", C1: "c", C3: "x" }));

  assert.equal(row(listing, 3), "r3 | C3: x");
});

// ---------------------------------------------------------------------------
// Cell text
// ---------------------------------------------------------------------------

test("a hard line break inside a cell is flattened, so one row of the sheet stays one line of the listing", () => {
  const listing = sheetListing(
    sheet("Alamat", {
      C2: "Alamat",
      E2: "Jl. Contoh No. 1\nJakarta Pusat\r\n10110",
      C3: "Kota",
    }),
  );

  assert.equal(
    row(listing, 2),
    "r2 | C2: Alamat | <D2 empty> | E2: Jl. Contoh No. 1 Jakarta Pusat 10110",
  );
  assert.equal(
    body(listing).filter((line) => line.startsWith("r")).length,
    2,
    "a cell holding two line breaks must not turn one row into three",
  );
});

test("a tab, a non-breaking space and a run of spaces all collapse to one space", () => {
  const listing = sheetListing(
    sheet("Spasi", { A1: "Nama\tPelanggan    Utama" }),
  );

  assert.equal(row(listing, 1), "r1 | A1: Nama Pelanggan Utama");
});

test("a cell longer than MAX_CELL_TEXT is cut, and the cut says how much it took", () => {
  const long = "A".repeat(MAX_CELL_TEXT + 37);
  const listing = sheetListing(sheet("Panjang", { E9: long }));

  const line = row(listing, 9);
  assert.ok(
    line.includes(`... (+37 chars cut)`),
    `a silently shortened value is compared against the scans as if it were the whole value:\n${line}`,
  );
  assert.ok(
    line.includes("A".repeat(MAX_CELL_TEXT)),
    "the first MAX_CELL_TEXT characters must survive the cut",
  );
  assert.ok(
    !line.includes("A".repeat(MAX_CELL_TEXT + 1)),
    "nothing past MAX_CELL_TEXT characters may reach the listing",
  );
});

test("a cell exactly MAX_CELL_TEXT long is printed whole and unmarked", () => {
  const exact = "B".repeat(MAX_CELL_TEXT);
  const listing = sheetListing(sheet("Pas", { E9: exact }));

  assert.equal(row(listing, 9), `r9 | E9: ${exact}`);
});

test("the cut is measured after flattening, never before", () => {
  // 60 characters of text separated by 200 newlines flattens to 61 and must
  // not be reported as cut. A count taken on the raw string would mark a value
  // as shortened that reaches the listing whole.
  const padded = `${"C".repeat(30)}${"\n".repeat(200)}${"D".repeat(30)}`;
  const listing = sheetListing(sheet("Lipat", { A1: padded }));

  assert.equal(row(listing, 1), `r1 | A1: ${"C".repeat(30)} ${"D".repeat(30)}`);
  assert.ok(!listing.includes("chars cut"), listing);
});

test("a non-text cell says what kind it is, and a text cell is left unannotated", () => {
  const listing = sheetListing(
    sheet(
      "Jenis",
      { A1: "Nama", B1: "12", C1: "2026-08-20", D1: "TRUE", E1: "999" },
      { kinds: { B1: "number", C1: "date", D1: "boolean", E1: "formula" } },
    ),
  );

  assert.equal(
    row(listing, 1),
    "r1 | A1: Nama | B1: 12 (number) | C1: 2026-08-20 (date) | D1: TRUE (boolean) | E1: 999 (formula)",
  );
});

// ---------------------------------------------------------------------------
// Header, merges, empty sheet
// ---------------------------------------------------------------------------

test("the header names the sheet, its dimension and its merged ranges", () => {
  const listing = sheetListing(
    sheet("Konfigurasi", { A1: "Nomor", E2: "BANK CONTOH NUSANTARA" }, {
      merges: ["A1:C1", "A3:B3"],
    }),
  );

  const head = listing.split("\n");
  assert.equal(head[0], '--- sheet "Konfigurasi" ---');
  assert.equal(head[1], "dimension A1:E2 (2 rows x 5 columns), 2 non-empty cells");
  assert.equal(head[2], "merged: A1:C1, A3:B3");
  assert.equal(head[3], "", "a blank line separates the header from the rows");
});

test("a sheet that merges nothing says so, rather than omitting the line", () => {
  const listing = sheetListing(sheet("Polos", { A1: "Nomor" }));

  assert.ok(
    listing.includes("merged: none"),
    `an absent line cannot be told from "this listing does not report merges":\n${listing}`,
  );
});

test("a sheet with no non-empty cells says so, rather than rendering as silence", () => {
  const listing = sheetListing(sheet("Kosong", {}));

  assert.ok(
    body(listing).includes("(no non-empty cells)"),
    `"you handed over the wrong sheet" and "this tool is broken" must not look the same:\n${listing}`,
  );
});

// ---------------------------------------------------------------------------
// The caps, and the promise `listingTruncated` makes about them
// ---------------------------------------------------------------------------

/** `n` cells down column A, so a fixture can cross a cap cheaply. */
function tallSheet(n: number, merges: string[] = []): Sheet {
  const values: Record<string, string> = {};
  for (let i = 1; i <= n; i++) values[`A${i}`] = `isi ${i}`;
  return sheet("Besar", values, { merges });
}

test("a sheet inside both caps is listed whole, and listingTruncated says so", () => {
  const full = tallSheet(MAX_LISTING_CELLS);

  assert.equal(listingTruncated(full), false);
  const listing = sheetListing(full);
  assert.ok(!listing.includes("TRUNCATED"), "nothing was left out, so nothing may be claimed");
  assert.ok(listing.includes(`A${MAX_LISTING_CELLS}: isi ${MAX_LISTING_CELLS}`));
});

test("a sheet over MAX_LISTING_CELLS loses its LAST rows, says how many it kept, and names where it stopped", () => {
  const over = tallSheet(MAX_LISTING_CELLS + 5);

  assert.equal(listingTruncated(over), true);
  const listing = sheetListing(over);

  assert.ok(
    listing.includes(
      `<TRUNCATED: ${MAX_LISTING_CELLS} of ${MAX_LISTING_CELLS + 5} non-empty cells shown. ` +
        `Nothing after A${MAX_LISTING_CELLS} is listed.>`,
    ),
    `a cut listing must say what it cut:\n${listing.slice(-300)}`,
  );
  assert.ok(
    listing.includes(`A${MAX_LISTING_CELLS}: isi ${MAX_LISTING_CELLS}`),
    "the cells inside the cap are all kept",
  );
  assert.ok(
    !listing.includes(`A${MAX_LISTING_CELLS + 1}: `),
    "the cut takes the tail, so a reader knows where to look for what is missing",
  );
});

test("merges over their own cap are cut, counted, and reported by listingTruncated", () => {
  const many: string[] = [];
  for (let i = 1; i <= MAX_LISTING_MERGES + 3; i++) many.push(`A${i}:B${i}`);
  const wide = tallSheet(2, many);

  assert.equal(
    listingTruncated(wide),
    true,
    "a listing that describes less than the sheet is truncated, whichever cap did it",
  );
  const listing = sheetListing(wide);
  assert.ok(
    listing.includes(`(${MAX_LISTING_MERGES} of ${MAX_LISTING_MERGES + 3} shown)`),
    listing.split("\n")[2],
  );
});

test("listingTruncated agrees with the listing on every sheet it is asked about", () => {
  // The two are one claim split in two places, and the failure class is a
  // truncated listing reported as full coverage. So they are checked against
  // each other rather than each against a remembered number.
  for (const n of [0, 1, MAX_LISTING_CELLS - 1, MAX_LISTING_CELLS, MAX_LISTING_CELLS + 1]) {
    const s = tallSheet(n);
    assert.equal(
      listingTruncated(s),
      sheetListing(s).includes("<TRUNCATED:"),
      `listingTruncated and sheetListing disagree at ${n} cells`,
    );
  }
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test("the same sheet renders to the same string, always", () => {
  const values = {
    B1: "Nomor",
    E1: "1",
    F1: "2",
    B4: "Keterangan",
    E4: "SID",
    F4: "Nama Pelanggan",
    E5: "1209990001",
  };

  assert.equal(
    sheetListing(sheet("Metro", values)),
    sheetListing(sheet("Metro", values)),
    "a listing that varies between calls makes a cached model reply, a re-run and a diff meaningless",
  );
});

test("a sheet whose cells arrive out of order still renders row-major", () => {
  // `Sheet.cells` is documented row-major and `read.ts` emits it that way, but
  // this function is also handed sheets assembled by hand. A listing whose
  // rows arrive shuffled is a wrong picture of the layout that nothing
  // downstream could catch: every address in it still validates against
  // `byRef`.
  const ordered = sheet("Acak", { A1: "a", B1: "b", A2: "c", B2: "d" });
  const shuffled: Sheet = {
    ...ordered,
    cells: [ordered.cells[3], ordered.cells[1], ordered.cells[2], ordered.cells[0]],
  };

  assert.equal(sheetListing(shuffled), sheetListing(ordered));
  assert.equal(row(sheetListing(shuffled), 1), "r1 | A1: a | B1: b");
});

test("the address printed for a cell is the cell's own ref, which is the key byRef will be looked up with", () => {
  // Every address the model answers with is validated against `Sheet.byRef`,
  // never against this string. Printing a recomputed address would put a second
  // derivation between the listing and the check, and the two would agree on
  // every workbook anybody tested.
  const s = sheet("Kunci", { AH5: "Nama Pelanggan" });
  const listing = sheetListing(s);

  assert.ok(listing.includes("AH5: Nama Pelanggan"));
  assert.ok(s.byRef.has("AH5"), "the fixture's own ref must be the key");
});

test("listingTruncation names WHICH cap cut, so a caller cannot report the wrong one", () => {
  /*
   * Found by review. `listingTruncated` is an OR over two independent caps,
   * and both callers wrote their own sentence about why, each naming the CELL
   * cap because that is the likely arm. On a sheet whose cells all fit and
   * whose merges were cut, the prompt therefore told the model "the listing
   * below is cut short at 4000 cells" while the listing a few lines below it
   * honestly printed the merge count. A prompt contradicting its own evidence
   * is worse than either half alone.
   */
  const many: string[] = [];
  for (let i = 1; i <= MAX_LISTING_MERGES + 3; i++) many.push(`A${i}:B${i}`);

  const mergesOnly = tallSheet(2, many);
  const cells = listingTruncation(tallSheet(MAX_LISTING_CELLS + 5));
  const merges = listingTruncation(mergesOnly);
  const both = listingTruncation(tallSheet(MAX_LISTING_CELLS + 5, many));

  assert.equal(listingTruncation(tallSheet(2)), null, "an untruncated sheet has no cause");

  assert.match(cells ?? "", /non-empty cells/);
  assert.ok(!/merged ranges/.test(cells ?? ""), "the cells arm must not blame the merges");

  assert.match(merges ?? "", /merged ranges/);
  assert.ok(
    !/non-empty cells/.test(merges ?? ""),
    "THE DEFECT: a merges-only cut must not be reported as a cell cut",
  );

  assert.match(both ?? "", /non-empty cells/);
  assert.match(both ?? "", /merged ranges/);

  // And the boolean still answers the question it always answered.
  assert.equal(listingTruncated(mergesOnly), true);
  assert.equal(listingTruncated(tallSheet(2)), false);
});
