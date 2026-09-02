/**
 * Offline tests for the order-request reader. No API calls, no credential, no
 * PDF, and -- the point of the module -- nothing that could need any of them:
 * the reader is deterministic, so the fixture is a workbook this file builds
 * in memory with exceljs and reads straight back.
 *
 * Every string here is invented. The fictional set this repo uses is
 * LOP999001, 1-70000000001, BANK CONTOH NUSANTARA, PSB VPN IP KCP Contoh, and
 * nothing may be lifted out of `documents/`: this is a public repo. The COLUMN
 * NAMES are not client data -- they are a long-lived Telkom blank's headers --
 * and they are reproduced exactly because the whole reader turns on matching
 * them.
 */

import assert from "node:assert/strict";
import test from "node:test";
import exceljs from "exceljs";

import { buildXlsx } from "../export/xlsx.ts";
import { reconcileFieldValues } from "./fields.ts";
import {
  cellText,
  columnLetter,
  gridFromWorksheet,
  normalizeHeader,
  orderRequestFieldValues,
  parseOrderRequestGrid,
  readOrderRequestBuffer,
  selectServices,
  type OrderRequestGrid,
} from "./order-request.ts";

// ---------------------------------------------------------------------------
// Fixtures. Bundle two's shape: row 1 type hints, row 2 headers, one row per
// SID, two SIDs agreeing on everything except their own SID and address.
// ---------------------------------------------------------------------------

const HINTS = [
  "(number)",
  "(text)",
  "(text)",
  "(text)--tidak mandatory",
  "(text)",
  "(text)",
  "(text)",
  "(number)",
  "(number)",
  "(text)",
  "(text)",
  "(date)--tidak mandatory",
  "(date)--tidak mandatory",
  "(text)",
  "(text)",
  "(text)",
];

const HEADERS = [
  "SID",
  "Jenis order (yang diminta)",
  "Layanan",
  "Agreement Name Baru",
  "Last Order",
  "BW baru",
  "Alamat Baru",
  "Harga OTC Baru",
  "Harga Bulanan Baru",
  "Akun Baru",
  "Term of Payment",
  "Start Date  (DD/MM/YY)",
  "End Date  (DD/MM/YY)",
  "Keterangan",
  "Nama PIC dan PIC",
  "Email",
];

function serviceRow(sid: string, alamat: string): string[] {
  return [
    sid,
    "MO",
    "VPN IP",
    "",
    "1-70000000001",
    "10 Mbps",
    alamat,
    "0",
    "1000000",
    "",
    "Recc",
    "21/08/2026",
    "20/08/2029",
    "PSB VPN IP KCP Contoh",
    "Sdr. Contoh +62 800-0000-0000",
    "kontak@contoh.example",
  ];
}

function grid(rows: string[][] = [serviceRow("9000000001", "Jalan Contoh No.1")]) {
  return {
    file: "LOP999001-request.xlsx",
    sheet: "Sheet1",
    rows: [HINTS, HEADERS, ...rows],
  } satisfies OrderRequestGrid;
}

const TWO_SERVICES = grid([
  serviceRow("9000000001", "Jalan Contoh No.1"),
  serviceRow("9000000002", "Jalan Contoh No.2"),
]);

// ---------------------------------------------------------------------------
// Header normalisation and column letters.
// ---------------------------------------------------------------------------

test("normalizeHeader drops the client's parentheticals and the trailing 'baru'", () => {
  assert.equal(normalizeHeader("Jenis order (yang diminta)"), "jenis order");
  assert.equal(normalizeHeader("Start Date  (DD/MM/YY)"), "start date");
  assert.equal(normalizeHeader("BW baru"), "bw");
  assert.equal(normalizeHeader("Alamat Baru"), "alamat");
  assert.equal(normalizeHeader("Harga OTC Baru"), "harga otc");
  assert.equal(normalizeHeader("Nama PIC dan PIC"), "nama pic dan pic");
});

test("columnLetter numbers columns the way Excel does", () => {
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
  assert.equal(columnLetter(27), "AB");
  assert.equal(columnLetter(51), "AZ");
  assert.equal(columnLetter(52), "BA");
});

// ---------------------------------------------------------------------------
// cellText. The date case is the one that matters: a contract date one day out
// depending on the machine's timezone is the failure this project is
// organised against, and it would never reproduce for whoever reported it.
// ---------------------------------------------------------------------------

test("cellText formats a date from its UTC components, four-digit year", () => {
  // Midnight UTC is what exceljs hands back for a date cell. Read with local
  // getters this is the 20th anywhere west of Greenwich.
  assert.equal(cellText(new Date(Date.UTC(2026, 7, 21))), "21/08/2026");
  assert.equal(cellText(new Date(Date.UTC(2029, 7, 20))), "20/08/2029");
  assert.equal(cellText(new Date(Date.UTC(2026, 0, 5))), "05/01/2026");
});

test("cellText carries numbers, rich text, formulas and blanks verbatim", () => {
  assert.equal(cellText(1000000), "1000000");
  assert.equal(cellText(120341172.5), "120341172.5");
  assert.equal(cellText(null), "");
  assert.equal(cellText(undefined), "");
  assert.equal(cellText("  BANK CONTOH NUSANTARA  "), "BANK CONTOH NUSANTARA");
  assert.equal(
    cellText({ richText: [{ text: "BANK " }, { text: "CONTOH" }] }),
    "BANK CONTOH",
  );
  assert.equal(cellText({ formula: "A1*2", result: 42 }), "42");
  assert.equal(cellText({ text: "kontak@contoh.example", hyperlink: "mailto:x" }), "kontak@contoh.example");
  // An error token in a cell is worse than a blank: the blank gets named in
  // the outstanding report, `#REF!` gets pasted into EPIC.
  assert.equal(cellText({ error: "#REF!" }), "");
});

// ---------------------------------------------------------------------------
// The grid parser.
// ---------------------------------------------------------------------------

test("parseOrderRequestGrid reads one service per row from row 3 down", () => {
  const request = parseOrderRequestGrid(TWO_SERVICES);

  assert.equal(request.file, "LOP999001-request.xlsx");
  assert.equal(request.services.length, 2);
  // Worksheet rows, 1-based, as Excel numbers them -- so an operator can open
  // the file and look at the row the note names.
  assert.deepEqual(
    request.services.map((service) => service.row),
    [3, 4],
  );
  assert.deepEqual(
    request.services.map((service) => service.sid),
    ["9000000001", "9000000002"],
  );
  assert.equal(request.unmapped.length, 0);
});

test("parseOrderRequestGrid carries row 1's type hint without acting on it", () => {
  const request = parseOrderRequestGrid(grid());
  const bandwidth = request.services[0].cells.find((c) => c.fieldKey === "bandwidth");
  assert.equal(bandwidth?.hint, "(text)");
  // "(number)" on the OTC column does not coerce anything: the text is the
  // text. Translating "10 Mbps" to 10 is the operator's job, not this file's.
  const otc = request.services[0].cells.find((c) => c.fieldKey === "hargaOtc");
  assert.equal(otc?.hint, "(number)");
  assert.equal(otc?.text, "0");
  assert.equal(bandwidth?.text, "10 Mbps");
});

test("parseOrderRequestGrid agrees a jenis order across services, or blanks it", () => {
  const agreed = parseOrderRequestGrid(TWO_SERVICES);
  assert.equal(agreed.jenisOrder, "MO");
  assert.deepEqual(agreed.jenisOrderReadings, ["MO"]);

  const rows = [
    serviceRow("9000000001", "Jalan Contoh No.1"),
    serviceRow("9000000002", "Jalan Contoh No.2"),
  ];
  rows[1][1] = "DO";
  const split = parseOrderRequestGrid(grid(rows));
  // Blank, never a pick. `resolveJenisOrder` then falls through to the
  // documents and finally to a cell it reports by name.
  assert.equal(split.jenisOrder, "");
  assert.deepEqual(split.jenisOrderReadings, ["MO", "DO"]);
});

test("parseOrderRequestGrid reports a column it has no field key for", () => {
  const headers = [...HEADERS, "Kolom Yang Belum Dikenal"];
  const row = [...serviceRow("9000000001", "Jalan Contoh No.1"), "sesuatu"];
  const request = parseOrderRequestGrid({
    file: "LOP999001-request.xlsx",
    sheet: "Sheet1",
    rows: [HINTS, headers, row],
  });

  assert.deepEqual(
    request.unmapped.map((column) => ({ column: column.column, header: column.header })),
    [{ column: "Q", header: "Kolom Yang Belum Dikenal" }],
  );
  // Reported, and NOT turned into a field. A guessed mapping is the one thing
  // worse than an unread column.
  assert.ok(
    request.services[0].cells.every((cell) => cell.text !== "sesuatu"),
    "an unmapped column must not reach a field value",
  );
});

test("parseOrderRequestGrid reports a headerless column that carries data", () => {
  const row = [...serviceRow("9000000001", "Jalan Contoh No.1"), "orphan"];
  const request = parseOrderRequestGrid({
    file: "LOP999001-request.xlsx",
    sheet: "Sheet1",
    rows: [HINTS, HEADERS, row],
  });
  assert.deepEqual(request.unmapped, [
    {
      column: "Q",
      header: "",
      reason: "the column carries data but row 2 gives it no header",
    },
  ]);
});

test("parseOrderRequestGrid refuses a sheet whose row 2 is not headers", () => {
  assert.throws(
    () =>
      parseOrderRequestGrid({
        file: "not-a-request.xlsx",
        sheet: "Sheet1",
        rows: [["a"], ["b"], ["c"]],
      }),
    /no readable order-request headers on row 2/,
  );
});

test("parseOrderRequestGrid skips a wholly empty row rather than inventing a service", () => {
  const request = parseOrderRequestGrid(
    grid([serviceRow("9000000001", "Jalan Contoh No.1"), HEADERS.map(() => "")]),
  );
  assert.equal(request.services.length, 1);
});

// ---------------------------------------------------------------------------
// The two mappings that are deliberately NOT the obvious ones.
// ---------------------------------------------------------------------------

test("'Last Order' is lastOrder, never quote", () => {
  const values = orderRequestFieldValues(parseOrderRequestGrid(grid()));
  const keys = values.map((value) => value.fieldKey);
  // The column holds a quote-shaped number belonging to the order being
  // superseded. Mapped to `quote` it would overwrite THIS order's quote --
  // derived from the filenames -- with the previous one's, in a well-formed
  // looking cell.
  assert.ok(keys.includes("lastOrder"));
  assert.ok(!keys.includes("quote"));
  assert.equal(
    values.find((value) => value.fieldKey === "lastOrder")?.value,
    "1-70000000001",
  );
});

test("'Akun Baru' is akunBaru, never cc", () => {
  const rows = [serviceRow("9000000001", "Jalan Contoh No.1")];
  rows[0][9] = "BANK CONTOH NUSANTARA";
  const values = orderRequestFieldValues(parseOrderRequestGrid(grid(rows)));
  const keys = values.map((value) => value.fieldKey);
  // `cc` has already shipped a wrong customer name in both deliverables once.
  // The one real request we have leaves this column empty in every row, so
  // there is no evidence at all about what it holds.
  assert.ok(keys.includes("akunBaru"));
  assert.ok(!keys.includes("cc"));
});

// ---------------------------------------------------------------------------
// Field values, and the multi-service rule.
// ---------------------------------------------------------------------------

test("a single service's values carry a request citation naming file, column and row", () => {
  const values = orderRequestFieldValues(parseOrderRequestGrid(grid()));
  const alamat = values.find((value) => value.fieldKey === "alamat");

  assert.equal(alamat?.value, "Jalan Contoh No.1");
  assert.deepEqual(alamat?.requestSource, {
    file: "LOP999001-request.xlsx",
    sheet: "Sheet1",
    rows: [3],
    column: "G",
    header: "Alamat Baru",
  });
  // Not a citation: there is no page and no line range, and inventing either
  // would be exactly the false citation `citedSource` exists to prevent.
  assert.equal(alamat?.source, undefined);
});

test("sid and jenisOrder are not handed out as field values", () => {
  const keys = orderRequestFieldValues(parseOrderRequestGrid(TWO_SERVICES)).map(
    (value) => value.fieldKey,
  );
  // sid is the service's identity, so agreeing it across services would
  // manufacture a conflict on every multi-service request; jenisOrder is a
  // header cell with its own resolution order in resolveJenisOrder.
  assert.ok(!keys.includes("sid"));
  assert.ok(!keys.includes("jenisOrder"));
});

test("two services that agree ship one value citing both rows", () => {
  const values = orderRequestFieldValues(parseOrderRequestGrid(TWO_SERVICES));
  const bandwidth = values.find((value) => value.fieldKey === "bandwidth");
  assert.equal(bandwidth?.value, "10 Mbps");
  assert.deepEqual(bandwidth?.requestSource?.rows, [3, 4]);
});

test("two services that disagree blank the cell and name both readings", () => {
  const values = orderRequestFieldValues(parseOrderRequestGrid(TWO_SERVICES));
  const alamat = values.find((value) => value.fieldKey === "alamat");

  // Never row 1 silently. Both addresses are real; a workbook carrying one of
  // them with no record of the other is the wrong-and-quiet shape exactly.
  assert.equal(alamat?.value, "");
  assert.deepEqual(alamat?.conflict, ["Jalan Contoh No.1", "Jalan Contoh No.2"]);
  assert.match(alamat?.conflictReason ?? "", /rows 3, 4/);
  assert.match(alamat?.conflictReason ?? "", /--service/);
  assert.equal(alamat?.requestSource, undefined);
});

test("--service takes one service, and the disagreement goes away", () => {
  const request = parseOrderRequestGrid(TWO_SERVICES);
  const values = orderRequestFieldValues(request, { service: "9000000002" });
  const alamat = values.find((value) => value.fieldKey === "alamat");
  assert.equal(alamat?.value, "Jalan Contoh No.2");
  assert.deepEqual(alamat?.requestSource?.rows, [4]);
  assert.equal(alamat?.conflict, undefined);
});

test("selectServices matches a SID before a row ordinal", () => {
  // Both are digit strings, and a SID is the more specific identity: an
  // operator typing a SID must not get "the Nth row" instead.
  const numericSid = parseOrderRequestGrid(
    grid([serviceRow("2", "Jalan Contoh No.1"), serviceRow("9000000002", "Jalan Contoh No.2")]),
  );
  assert.deepEqual(
    selectServices(numericSid, "2").map((service) => service.sid),
    ["2"],
  );
  // With no SID matching, the same string is the 1-based row ordinal.
  const request = parseOrderRequestGrid(TWO_SERVICES);
  assert.deepEqual(
    selectServices(request, "2").map((service) => service.sid),
    ["9000000002"],
  );
  assert.deepEqual(selectServices(request).length, 2);
});

test("selectServices refuses a selector nothing matches, listing what there is", () => {
  const request = parseOrderRequestGrid(TWO_SERVICES);
  assert.throws(() => selectServices(request, "9000000009"), /has no service/);
  assert.throws(() => selectServices(request, "9"), /1 = 9000000001, 2 = 9000000002/);
});

// ---------------------------------------------------------------------------
// The exceljs edge: a real workbook, built here and read straight back.
// ---------------------------------------------------------------------------

async function requestWorkbookBytes(options: { sheets?: string[] } = {}) {
  const workbook = new exceljs.Workbook();
  for (const name of options.sheets ?? ["Sheet1"]) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(HINTS);
    sheet.addRow(HEADERS);
    const row = serviceRow("9000000001", "Jalan Contoh No.1");
    // Written as the types Excel really stores, not as strings: a date cell
    // and two number cells, which is what makes `cellText` load-bearing.
    sheet.addRow([
      ...row.slice(0, 7),
      0,
      1000000,
      row[9],
      row[10],
      new Date(Date.UTC(2026, 7, 21)),
      new Date(Date.UTC(2029, 7, 20)),
      ...row.slice(13),
    ]);
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

test("readOrderRequestBuffer reads a real workbook, dates and numbers included", async () => {
  const request = await readOrderRequestBuffer(
    await requestWorkbookBytes(),
    "LOP999001-request.xlsx",
  );

  assert.equal(request.services.length, 1);
  const values = orderRequestFieldValues(request);
  const byKey = new Map(values.map((value) => [value.fieldKey, value.value]));
  assert.equal(byKey.get("startDate"), "21/08/2026");
  assert.equal(byKey.get("endDate"), "20/08/2029");
  assert.equal(byKey.get("hargaBulanan"), "1000000");
  assert.equal(byKey.get("hargaOtc"), "0");
  assert.equal(byKey.get("termOfPayment"), "Recc");
  assert.equal(request.jenisOrder, "MO");
});

test("readOrderRequestBuffer refuses to pick between worksheets", async () => {
  await assert.rejects(
    readOrderRequestBuffer(
      await requestWorkbookBytes({ sheets: ["Sheet1", "Sheet2"] }),
      "LOP999001-request.xlsx",
    ),
    /has 2 worksheets/,
  );
});

test("gridFromWorksheet returns a rectangular grid of text", async () => {
  const workbook = new exceljs.Workbook();
  await workbook.xlsx.load(
    (await requestWorkbookBytes()).buffer.slice(0) as ArrayBuffer,
  );
  const read = gridFromWorksheet(workbook.worksheets[0], "LOP999001-request.xlsx");
  assert.equal(read.sheet, "Sheet1");
  assert.equal(read.rows.length, 3);
  const widths = new Set(read.rows.map((row) => row.length));
  assert.equal(widths.size, 1, "every row must be the same width");
});

// ---------------------------------------------------------------------------
// The provenance has to survive the rest of the pipeline.
// ---------------------------------------------------------------------------

test("reconcileFieldValues keeps a requestSource", () => {
  const [value] = reconcileFieldValues(
    orderRequestFieldValues(parseOrderRequestGrid(grid())).filter(
      (entry) => entry.fieldKey === "alamat",
    ),
  );
  // It rebuilds entries field by field rather than spreading them, so every
  // field worth keeping has to be named there. A value that came through
  // without its provenance ships a cell whose note says nothing.
  assert.deepEqual(value.requestSource?.rows, [3]);
  assert.equal(value.value, "Jalan Contoh No.1");
});

test("buildXlsx writes a request-supplied value's note naming the cell it came from", async () => {
  // Cast rather than a full Template literal: this test cares about one column
  // of one row, and the docx section list is another module's business.
  const template = {
    id: "test",
    xlsxRows: [{ nomor: 1, itemI: "Quote", itemII: "Field Name", fieldKey: "alamat" }],
  } as unknown as Parameters<typeof buildXlsx>[0];

  const values = orderRequestFieldValues(parseOrderRequestGrid(grid()));
  const bytes = await buildXlsx(
    template,
    values.filter((value) => value.fieldKey === "alamat"),
  );

  const workbook = new exceljs.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(0) as ArrayBuffer);
  const cell = workbook.worksheets[0].getRow(2).getCell(5);
  assert.equal(cell.value, "Jalan Contoh No.1");
  const note = typeof cell.note === "string" ? cell.note : cell.note?.texts?.map((t) => t.text).join("");
  assert.equal(
    note,
    'LOP999001-request.xlsx sheet "Sheet1", row 3, column G (Alamat Baru)',
  );
});
