/**
 * WHAT THIS FILE PROTECTS: a workbook that reads as complete and is wrong.
 *
 * Everything Konfig Excel does rests on `readWorkbook` having reported what is
 * actually in the operator's file. A sheet silently dropped, a rich-text label
 * truncated at its first run, a date serial handed over as the number 46255 --
 * none of those crash, and every one of them ends as a recommendation to
 * overwrite a correct cell, or as a field reported absent from documents that
 * contain it. So the assertions below are mostly about the QUIET failures, and
 * several of them pin a defect the format itself invites:
 *
 *  - `xl/worksheets/sheet1.xml` is not where a sheet necessarily lives, and
 *    the third real client workbook names its only sheet `metro-e`.
 *  - `<cellStyleXfs>` also holds `<xf>` elements; reading it as `<cellXfs>`
 *    shifts every style index by one and turns a date column into numbers.
 *  - `[Red]#,##0` contains a `d`, and a naive date sniff calls it a date.
 *  - Excel believes 1900 was a leap year, so serial 60 is a day that never
 *    existed and everything above it is offset by one.
 *  - A patcher whose cell-matching fails appends a SECOND `<row r="9">`. The
 *    reader must keep both, or `write.ts` cannot count them and catch it.
 *
 * Every workbook here is built in-process with jszip. Nothing reads
 * `documents/`, which is gitignored client material, so the suite passes on a
 * fresh clone with no network and no key.
 */

import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import { colToNumber, formatRef, isCellRef, numberToCol, parseRef } from "./grid.ts";
import { WorkbookUnreadable, readWorkbook } from "./read.ts";

// ---------------------------------------------------------------------------
// Fixtures: the smallest OOXML that is still a real workbook
// ---------------------------------------------------------------------------

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const WORKSHEET_REL = `${REL_NS}/worksheet`;

type SheetSpec = {
  name: string;
  relId: string;
  /** The part path, deliberately never assumed to be `sheet1.xml`. */
  target: string;
  /** The `<sheetData>` children. */
  rows: string;
  /** Anything after `</sheetData>`: `<mergeCells>`, and nothing else so far. */
  tail?: string;
  /** A declared `<dimension>`, to prove the reader computes its own. */
  dimension?: string;
};

type Build = {
  sheets: SheetSpec[];
  /** `<si>` bodies, in shared-string index order. */
  shared?: string[];
  styles?: string;
  date1904?: boolean;
  /** Relationship ids to leave out of the rels part. */
  dropRels?: string[];
  /** Part paths to declare in rels and then not write. */
  dropParts?: string[];
};

function sheetPart(spec: SheetSpec): string {
  const dimension = spec.dimension ? `<dimension ref="${spec.dimension}"/>` : "";
  return `${DECL}<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">${dimension}<sheetData>${spec.rows}</sheetData>${spec.tail ?? ""}</worksheet>`;
}

function workbookPart(build: Build): string {
  const pr = build.date1904 ? '<workbookPr date1904="1"/>' : "<workbookPr/>";
  const sheets = build.sheets
    .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="${sheet.relId}"/>`)
    .join("");
  return `${DECL}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">${pr}<sheets>${sheets}</sheets></workbook>`;
}

function relsPart(build: Build): string {
  const dropped = new Set(build.dropRels ?? []);
  const entries = build.sheets
    .filter((sheet) => !dropped.has(sheet.relId))
    .map((sheet) => `<Relationship Id="${sheet.relId}" Type="${WORKSHEET_REL}" Target="${sheet.target}"/>`)
    .join("");
  return `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}<Relationship Id="rIdStyles" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;
}

function sharedPart(items: string[]): string {
  return `${DECL}<sst xmlns="${MAIN_NS}" count="${items.length}" uniqueCount="${items.length}">${items
    .map((body) => `<si>${body}</si>`)
    .join("")}</sst>`;
}

async function pack(parts: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, body] of Object.entries(parts)) zip.file(path, body);
  return zip.generateAsync({ type: "uint8array" });
}

async function build(spec: Build): Promise<Uint8Array> {
  const skipped = new Set(spec.dropParts ?? []);
  const parts: Record<string, string> = {
    "[Content_Types].xml": `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "xl/workbook.xml": workbookPart(spec),
    "xl/_rels/workbook.xml.rels": relsPart(spec),
  };
  for (const sheet of spec.sheets) {
    const path = `xl/${sheet.target}`;
    if (!skipped.has(sheet.target)) parts[path] = sheetPart(sheet);
  }
  if (spec.shared) parts["xl/sharedStrings.xml"] = sharedPart(spec.shared);
  if (spec.styles) parts["xl/styles.xml"] = spec.styles;
  return pack(parts);
}

/**
 * A styles part exercising all four ways a cell format decides the question.
 *
 * `<cellStyleXfs>` is written FIRST and holds an `<xf>` of its own, so a reader
 * that scans the file for `<xf>` instead of slicing `<cellXfs>` gets every
 * index shifted by one and this fixture's date cells come back as numbers.
 *
 * Index 4 redefines built-in id 14 -- a date id -- as `[Red]#,##0`. It pins
 * both halves of the precedence rule: an explicit `<numFmt>` wins over the
 * built-in table, and a `[Red]` colour section's `d` is not a date token.
 */
const STYLES = `${DECL}<styleSheet xmlns="${MAIN_NS}">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="[$-13809]dd/mm/yyyy;@"/>
    <numFmt numFmtId="165" formatCode="_-&quot;Rp&quot;* #,##0.00_-;\\-&quot;Rp&quot;* #,##0.00_-;_-&quot;Rp&quot;* &quot;-&quot;??_-;_-@_-"/>
    <numFmt numFmtId="14" formatCode="[Red]#,##0"/>
  </numFmts>
  <cellStyleXfs count="1"><xf numFmtId="15" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="15" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`;

/** The one sheet most tests need, so each test writes only its own rows. */
async function oneSheet(rows: string, extra: Partial<Build> = {}): Promise<Uint8Array> {
  return build({
    sheets: [{ name: "Sheet1", relId: "rId1", target: "worksheets/sheet1.xml", rows }],
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// grid.ts
// ---------------------------------------------------------------------------

test("column math is bijective base-26, so it stays right past Z where a transposed workbook lives", () => {
  assert.equal(colToNumber("A"), 1);
  assert.equal(colToNumber("Z"), 26);
  assert.equal(
    colToNumber("AA"),
    27,
    "AA is 27, not 26: there is no zero digit in this numbering and an ordinary base-26 conversion is off by one from here on",
  );
  assert.equal(colToNumber("AN"), 40, "the transposed client workbook runs its field names out to AN");
  assert.equal(colToNumber("AZ"), 52);
  assert.equal(colToNumber("BA"), 53);
  assert.equal(colToNumber("ZZ"), 702);
  assert.equal(colToNumber("AAA"), 703);
  assert.equal(colToNumber("XFD"), 16384, "Excel's own last column");

  for (let n = 1; n <= 16384; n += 1) {
    assert.equal(colToNumber(numberToCol(n)), n, `numberToCol/colToNumber must round trip at ${n}`);
  }
});

test("a malformed address throws rather than resolving to a cell that exists", () => {
  assert.deepEqual(parseRef("E9"), { col: 5, row: 9 });
  assert.deepEqual(parseRef("AN8"), { col: 40, row: 8 });

  for (const junk of ["", "E", "9", "e9", "E9x", "E 9", "$E$9", "E9:E12", "Sheet1!E9", "ABCD1", "A12345678"]) {
    assert.throws(() => parseRef(junk), /not a cell address/, `parseRef must refuse ${JSON.stringify(junk)}`);
  }
  assert.throws(() => parseRef("A0"), /1-based/, "A0 matches the address shape and is still not a cell");
  assert.throws(() => colToNumber("a"), /not a column/);
  assert.throws(() => numberToCol(0), /1-based/);
  assert.throws(() => formatRef(5, 0), /1-based/);
});

test("formatRef and parseRef are inverses, and isCellRef answers the same question without throwing", () => {
  assert.equal(formatRef(5, 9), "E9");
  assert.equal(formatRef(40, 8), "AN8");
  assert.equal(formatRef(27, 1), "AA1");

  assert.ok(isCellRef("E9"));
  assert.ok(isCellRef("AN8"));
  for (const junk of [undefined, null, 9, {}, ["E9"], "E9:E12", "A0", "e9", ""]) {
    assert.equal(isCellRef(junk), false, `isCellRef must reject ${JSON.stringify(junk)} and not throw`);
  }
});

// ---------------------------------------------------------------------------
// Sheet resolution
// ---------------------------------------------------------------------------

test("sheets are resolved through the rels part, so a workbook whose parts were never renumbered still reads", async () => {
  const bytes = await build({
    sheets: [
      // Neither the order of the ids nor the part names line up with the sheet
      // order. Excel leaves both like this after a sheet is deleted.
      { name: "metro-e", relId: "rId7", target: "worksheets/sheet7.xml", rows: '<row r="1"><c r="A1" t="inlineStr"><is><t>metro</t></is></c></row>' },
      { name: "Sheet1", relId: "rId2", target: "worksheets/sheet2.xml", rows: '<row r="1"><c r="A1" t="inlineStr"><is><t>satu</t></is></c></row>' },
    ],
  });

  const workbook = await readWorkbook(bytes);

  assert.deepEqual(workbook.sheetNames, ["metro-e", "Sheet1"], "sheets come back in workbook order, not part order");
  assert.equal(workbook.sheets[0].byRef.get("A1")?.text, "metro");
  assert.equal(
    workbook.sheets[1].byRef.get("A1")?.text,
    "satu",
    "assuming sheet1.xml would have read the wrong sheet here, in a file that opens perfectly",
  );
});

test("a relationship target that walks out of xl/ and back in still resolves", async () => {
  const bytes = await build({
    sheets: [{ name: "Sheet1", relId: "rId1", target: "../xl/worksheets/sheet1.xml", rows: '<row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row>' }],
  });
  const workbook = await readWorkbook(bytes);
  assert.equal(workbook.sheets[0].byRef.get("A1")?.text, "ok");
});

// ---------------------------------------------------------------------------
// Cell values
// ---------------------------------------------------------------------------

test("a rich-text shared string comes back whole, because a truncated label passes a substring check while naming the wrong thing", async () => {
  const bytes = await oneSheet('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>', {
    shared: [
      "<r><rPr><b/></rPr><t>PSB VPN </t></r><r><t>IP KCP Contoh</t></r>",
      '<t xml:space="preserve">Budi  Contoh</t><rPh sb="0" eb="4"><t>ABAIKAN</t></rPh>',
    ],
  });

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.equal(sheet.byRef.get("A1")?.text, "PSB VPN IP KCP Contoh", "every run of one string is concatenated");
  assert.equal(
    sheet.byRef.get("B1")?.text,
    "Budi  Contoh",
    "a phonetic <rPh> reading is not part of the string, and internal spacing survives",
  );
});

test("inline strings, formula results, booleans and error literals each render as what a person reads", async () => {
  const bytes = await oneSheet(
    '<row r="1">' +
      '<c r="A1" t="inlineStr"><is><t>inline</t></is></c>' +
      '<c r="B1"><f>A2*2</f><v>84</v></c>' +
      '<c r="C1" t="str"><f>CONCATENATE(A1,"!")</f><v>inline!</v></c>' +
      '<c r="D1" t="b"><v>1</v></c>' +
      '<c r="E1" t="b"><v>0</v></c>' +
      '<c r="F1" t="e"><v>#REF!</v></c>' +
      "</row>",
  );

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.deepEqual(
    { text: sheet.byRef.get("A1")?.text, kind: sheet.byRef.get("A1")?.kind },
    { text: "inline", kind: "text" },
  );
  assert.deepEqual(
    { text: sheet.byRef.get("B1")?.text, kind: sheet.byRef.get("B1")?.kind },
    { text: "84", kind: "formula" },
    "a cell carrying an <f> is a formula whatever its cached value looks like: overwriting it destroys a computation",
  );
  assert.equal(sheet.byRef.get("C1")?.kind, "formula");
  assert.equal(sheet.byRef.get("C1")?.text, "inline!");
  assert.deepEqual(
    { text: sheet.byRef.get("D1")?.text, raw: sheet.byRef.get("D1")?.raw },
    { text: "TRUE", raw: "1" },
  );
  assert.equal(sheet.byRef.get("E1")?.text, "FALSE", "a stored 0 is FALSE, not an empty cell");
  assert.equal(sheet.byRef.get("F1")?.text, "#REF!");
});

test("an empty cell is skipped and a literal zero is kept, because they are different answers", async () => {
  const bytes = await oneSheet(
    '<row r="1">' +
      '<c r="A1" s="0"/>' +
      '<c r="B1" t="inlineStr"><is><t>   </t></is></c>' +
      '<c r="C1"><v>0</v></c>' +
      '<c r="D1" t="inlineStr"><is><t>  nol  </t></is></c>' +
      "</row>",
    { styles: STYLES },
  );

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.equal(sheet.byRef.has("A1"), false, "a styled but valueless cell holds nothing");
  assert.equal(sheet.byRef.has("B1"), false, "whitespace is not a value");
  assert.equal(sheet.byRef.get("C1")?.text, "0", "a literal 0 is an answer somebody entered");
  assert.equal(sheet.byRef.get("D1")?.text, "nol", "only the ends are trimmed");
  assert.deepEqual(sheet.cells.map((cell) => cell.ref), ["C1", "D1"]);
});

test("a number renders without exponent notation and without the float noise a spreadsheet's own arithmetic leaves", async () => {
  const bytes = await oneSheet(
    '<row r="1">' +
      "<c r=\"A1\"><v>0.30000000000000004</v></c>" +
      "<c r=\"B1\"><v>1.0000000000000002</v></c>" +
      "<c r=\"C1\"><v>1e21</v></c>" +
      "<c r=\"D1\"><v>0.0000001</v></c>" +
      "<c r=\"E1\"><v>-1234.5</v></c>" +
      "<c r=\"F1\"><v>1209990001</v></c>" +
      "</row>",
  );

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.equal(
    sheet.byRef.get("A1")?.text,
    "0.3",
    "0.1 + 0.2 stored by a spreadsheet must not be compared against a scan as 0.30000000000000004",
  );
  assert.equal(sheet.byRef.get("A1")?.raw, "0.30000000000000004", "the stored form survives in raw");
  assert.equal(sheet.byRef.get("B1")?.text, "1");
  assert.equal(sheet.byRef.get("C1")?.text, "1000000000000000000000", "no exponent, at any magnitude");
  assert.equal(sheet.byRef.get("D1")?.text, "0.0000001");
  assert.equal(sheet.byRef.get("E1")?.text, "-1234.5");
  assert.deepEqual(
    { text: sheet.byRef.get("F1")?.text, raw: sheet.byRef.get("F1")?.raw },
    { text: "1209990001", raw: undefined },
    "raw is absent when it would only repeat text",
  );
});

test("XML entities are unescaped with &amp; LAST, so a cell quoting an entity does not come back as markup", async () => {
  const bytes = await oneSheet(
    '<row r="1">' +
      "<c r=\"A1\" t=\"inlineStr\"><is><t>&amp;lt;tidak diubah&amp;gt;</t></is></c>" +
      "<c r=\"B1\" t=\"inlineStr\"><is><t>a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;</t></is></c>" +
      "<c r=\"C1\" t=\"inlineStr\"><is><t>&#66;udi &#x43;ontoh</t></is></c>" +
      "</row>",
  );

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.equal(
    sheet.byRef.get("A1")?.text,
    "&lt;tidak diubah&gt;",
    "unescaping &amp; first would turn this cell's own text into markup",
  );
  assert.equal(sheet.byRef.get("B1")?.text, "a & b <c> \"d\" 'e'");
  assert.equal(sheet.byRef.get("C1")?.text, "Budi Contoh", "numeric references, decimal and hex");
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

test("a date serial renders as a date through a built-in numFmt and through a custom formatCode alike", async () => {
  const bytes = await oneSheet(
    '<row r="1">' +
      '<c r="A1" s="1"><v>45658</v></c>' +
      '<c r="B1" s="2"><v>45658</v></c>' +
      '<c r="C1" s="0"><v>45658</v></c>' +
      '<c r="D1" s="3"><v>45658</v></c>' +
      '<c r="E1" s="4"><v>45658</v></c>' +
      "</row>",
    { styles: STYLES },
  );

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.deepEqual(
    { text: sheet.byRef.get("A1")?.text, raw: sheet.byRef.get("A1")?.raw, kind: sheet.byRef.get("A1")?.kind },
    { text: "01/01/2025", raw: "45658", kind: "date" },
    "built-in numFmt 15 is a date, and reading <cellStyleXfs> as <cellXfs> would shift this index",
  );
  assert.equal(sheet.byRef.get("B1")?.text, "01/01/2025", "custom [$-13809]dd/mm/yyyy is a date");
  assert.equal(sheet.byRef.get("C1")?.text, "45658", "General is not a date");
  assert.equal(
    sheet.byRef.get("D1")?.text,
    "45658",
    'a Rupiah accounting code contains no unquoted date token: its "Rp" is a quoted literal',
  );
  assert.equal(
    sheet.byRef.get("E1")?.text,
    "45658",
    "an explicit <numFmt> redefining built-in id 14 wins over the built-in table, and [Red]'s d is not a date token",
  );
  assert.equal(sheet.byRef.get("E1")?.kind, "number");
});

test("the 1900 leap-year bug is reproduced, because a one-day error reads like a transcription difference", async () => {
  const bytes = await oneSheet(
    '<row r="1">' +
      '<c r="A1" s="1"><v>1</v></c>' +
      '<c r="B1" s="1"><v>59</v></c>' +
      '<c r="C1" s="1"><v>60</v></c>' +
      '<c r="D1" s="1"><v>61</v></c>' +
      "</row>",
    { styles: STYLES },
  );

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.equal(sheet.byRef.get("A1")?.text, "01/01/1900", "serial 1 is 1 January 1900");
  assert.equal(sheet.byRef.get("B1")?.text, "28/02/1900");
  assert.equal(
    sheet.byRef.get("C1")?.text,
    "29/02/1900",
    "serial 60 is the day that never existed, and Excel shows it; the job here is to show what the operator's own sheet shows",
  );
  assert.equal(
    sheet.byRef.get("D1")?.text,
    "01/03/1900",
    "everything above 60 is offset by one, which is the whole bug",
  );
});

test("a value that cannot be a calendar date falls back to its number rather than inventing one", async () => {
  const bytes = await oneSheet(
    '<row r="1">' +
      '<c r="A1" s="1"><v>0.5</v></c>' +
      '<c r="B1" s="1"><v>0</v></c>' +
      '<c r="C1" s="1"><v>3000000</v></c>' +
      "</row>",
    { styles: STYLES },
  );

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.equal(sheet.byRef.get("A1")?.text, "0.5", "a serial below 1 is a time of day, not a date");
  assert.equal(sheet.byRef.get("A1")?.kind, "number");
  assert.equal(sheet.byRef.get("B1")?.text, "0");
  assert.equal(sheet.byRef.get("C1")?.text, "3000000", "past 9999-12-31 Excel itself shows ####, never a year 40000");
});

test("date1904 is honoured, so a workbook saved on the other epoch is not read four years early", async () => {
  const bytes = await oneSheet(
    '<row r="1"><c r="A1" s="1"><v>0</v></c><c r="B1" s="1"><v>1</v></c></row>',
    { styles: STYLES, date1904: true },
  );

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.equal(sheet.byRef.get("A1")?.text, "01/01/1904", "serial 0 IS a date in the 1904 system");
  assert.equal(sheet.byRef.get("B1")?.text, "02/01/1904", "and there is no phantom leap day to skip");
});

// ---------------------------------------------------------------------------
// Sheet shape
// ---------------------------------------------------------------------------

test("merges come back verbatim and the extent is computed from the cells, not from the declared dimension", async () => {
  const bytes = await build({
    sheets: [
      {
        name: "Sheet1",
        relId: "rId1",
        target: "worksheets/sheet1.xml",
        // A producer is free to overstate <dimension>; advertising addresses
        // the listing cannot show would invite the model to name one.
        dimension: "A1:ZZ999",
        rows:
          '<row r="1"><c r="A1" t="inlineStr"><is><t>judul</t></is></c></row>' +
          '<row r="8"><c r="AN8" t="inlineStr"><is><t>ujung</t></is></c></row>',
        tail: '<mergeCells count="2"><mergeCell ref="A1:A4"/><mergeCell ref="B1:C1"/></mergeCells>',
      },
    ],
  });

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.deepEqual(sheet.merges, ["A1:A4", "B1:C1"]);
  assert.equal(sheet.dimension, "A1:AN8", "computed from what was actually read");
  assert.equal(sheet.rows, 8);
  assert.equal(sheet.cols, 40, "AN is column 40");
});

test("cells come back row-major, and a cell with no r attribute is counted rather than dropped", async () => {
  const bytes = await oneSheet(
    '<row r="2"><c r="C2" t="inlineStr"><is><t>c2</t></is></c><c r="A2" t="inlineStr"><is><t>a2</t></is></c></row>' +
      '<row r="1"><c t="inlineStr"><is><t>a1</t></is></c><c t="inlineStr"><is><t>b1</t></is></c></row>',
  );

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.deepEqual(
    sheet.cells.map((cell) => cell.ref),
    ["A1", "B1", "A2", "C2"],
    "row-major regardless of the order the file wrote them",
  );
  assert.equal(
    sheet.byRef.get("B1")?.text,
    "b1",
    "position is implied when r is absent; skipping such a cell would be a value that silently is not there",
  );
});

test("an empty sheet reports no extent instead of claiming a cell exists", async () => {
  const sheet = (await readWorkbook(await oneSheet(""))).sheets[0];

  assert.deepEqual(sheet.cells, []);
  assert.equal(sheet.dimension, "");
  assert.equal(sheet.rows, 0);
  assert.equal(sheet.cols, 0);
});

test("a duplicated address is preserved twice, which is the only way write.ts can catch an appended row", async () => {
  // Exactly the corruption a naive patcher produces when its cell-matching
  // regex misses: the original row stays put and a second <row r="9"> carrying
  // a second E9 is appended. Excel opens it and shows one of them.
  const bytes = await oneSheet(
    '<row r="9"><c r="E9" t="inlineStr"><is><t>lama</t></is></c></row>' +
      '<row r="9"><c r="E9" t="inlineStr"><is><t>baru</t></is></c></row>',
  );

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.equal(
    sheet.cells.filter((cell) => cell.ref === "E9").length,
    2,
    "folding duplicates together here would hide the corruption from the patcher's own verification",
  );
  assert.equal(
    sheet.byRef.get("E9")?.text,
    "lama",
    "byRef holds the FIRST occurrence, so an appended duplicate fails a value check too and not only a count",
  );
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("a file that is not a zip is refused by name, not parsed into an empty workbook", async () => {
  await assert.rejects(
    () => readWorkbook(new TextEncoder().encode("Nomor,Item I,Item II\n1,a,b\n")),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookUnreadable);
      assert.match(error.message, /not a zip archive/);
      return true;
    },
  );
});

test("a zip with no xl/workbook.xml is refused, and the message says what it looked for", async () => {
  const bytes = await pack({ "[Content_Types].xml": `${DECL}<Types/>`, "docProps/app.xml": `${DECL}<Properties/>` });

  await assert.rejects(
    () => readWorkbook(bytes),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookUnreadable);
      assert.match(error.message, /xl\/workbook\.xml/);
      return true;
    },
  );
});

test("a workbook declaring no sheets is refused rather than returning an empty list a caller reads as an empty file", async () => {
  const bytes = await pack({
    "xl/workbook.xml": `${DECL}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${DECL}<Relationships/>`,
  });

  await assert.rejects(() => readWorkbook(bytes), /declares no sheets/);
});

test("a sheet whose relationship is missing stops the whole workbook, because a dropped sheet reads as fields that are not there", async () => {
  const bytes = await build({
    sheets: [
      { name: "Sheet1", relId: "rId1", target: "worksheets/sheet1.xml", rows: "" },
      { name: "metro-e", relId: "rId9", target: "worksheets/sheet9.xml", rows: "" },
    ],
    dropRels: ["rId9"],
  });

  await assert.rejects(
    () => readWorkbook(bytes),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookUnreadable);
      assert.match(error.message, /"metro-e"/, "the refusal names the sheet the operator can see");
      assert.match(error.message, /"rId9"/);
      return true;
    },
  );
});

test("a relationship pointing at a part the archive does not contain is refused by path", async () => {
  const bytes = await build({
    sheets: [{ name: "Sheet1", relId: "rId1", target: "worksheets/sheet1.xml", rows: "" }],
    dropParts: ["worksheets/sheet1.xml"],
  });

  await assert.rejects(
    () => readWorkbook(bytes),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookUnreadable);
      assert.match(error.message, /xl\/worksheets\/sheet1\.xml/);
      return true;
    },
  );
});

test("a shared-string index the table does not have drops the cell instead of showing a blank beside a promise of a value", async () => {
  const bytes = await oneSheet('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>7</v></c></row>', {
    shared: ["<t>ada</t>"],
  });

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.equal(sheet.byRef.get("A1")?.text, "ada");
  assert.equal(sheet.byRef.has("B1"), false);
});

test("a shared-string cell with no stored value is EMPTY, not shared string zero", async () => {
  // The sharpest edge in the reader, found by review and fixed. `elementBody`
  // answers `""` for a self-closing `<v/>`, and `Number("")` is 0, so without
  // the guard both cells below resolve to the FIRST entry of the shared table:
  // another cell's text, standing in a cell that is actually empty, with
  // nothing anywhere looking wrong. An empty text-formatted cell is ordinary
  // in these workbooks, and it is exactly the cell Konfig Excel exists to
  // offer a value for -- so reading it as already holding one is the whole
  // failure.
  const bytes = await oneSheet(
    '<row r="1">' +
      '<c r="A1" t="s"><v>0</v></c>' +
      '<c r="B1" t="s"><v/></c>' +
      '<c r="C1" t="s"/>' +
      '<c r="D1" t="s"><v> </v></c>' +
      '<c r="E1" t="b"><v/></c>' +
      "</row>",
    { shared: ["<t>BANK CONTOH NUSANTARA</t>", "<t>kedua</t>"] },
  );

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.equal(sheet.byRef.get("A1")?.text, "BANK CONTOH NUSANTARA", "a real index still reads");
  assert.equal(sheet.byRef.has("B1"), false, "a self-closing <v/> is not index 0");
  assert.equal(sheet.byRef.has("C1"), false, "no <v> at all is not index 0 either");
  assert.equal(sheet.byRef.has("D1"), false, "and neither is a whitespace-only one");
  assert.equal(sheet.byRef.has("E1"), false, "a valueless boolean cell is empty, not FALSE");
  assert.deepEqual(sheet.cells.map((cell) => cell.ref), ["A1"]);
});

test("a percent cell shows the percentage, because the stored number is not the shown number", async () => {
  /*
   * Found by review, and confirmed against the sample bundle's OWN
   * configuration workbook: `E29` holds 0.995 under built-in format 10
   * (`0.00%`) beside the label `MPLS VPN IP SLG`, and Excel shows 99.50%.
   * Read as a bare number the operator is shown 0.995 for a value their file
   * does not display, and the comparison against a scan reading "99,5%"
   * recommends overwriting a cell that was right.
   *
   * Percent is the only common format where the stored and displayed values
   * are different NUMBERS. Currency is deliberately left alone below: `Rp` is
   * decoration, and rendering it would put a symbol into a value that is then
   * compared against a scan and written back as text.
   */
  const styles = `${DECL}<styleSheet xmlns="${MAIN_NS}">
  <numFmts count="2">
    <numFmt numFmtId="180" formatCode="0.0&quot;%&quot;"/>
    <numFmt numFmtId="181" formatCode="#,##0.0%"/>
  </numFmts>
  <cellXfs count="6">
    <xf numFmtId="0"/>
    <xf numFmtId="9"/>
    <xf numFmtId="10"/>
    <xf numFmtId="180"/>
    <xf numFmtId="181"/>
    <xf numFmtId="44"/>
  </cellXfs>
</styleSheet>`;

  const bytes = await oneSheet(
    '<row r="1">' +
      '<c r="A1" s="0"><v>0.995</v></c>' +
      '<c r="B1" s="1"><v>0.995</v></c>' +
      '<c r="C1" s="2"><v>0.995</v></c>' +
      '<c r="D1" s="3"><v>0.995</v></c>' +
      '<c r="E1" s="4"><v>0.5</v></c>' +
      '<c r="F1" s="5"><v>120341172.5</v></c>' +
      "</row>",
    { styles },
  );

  const sheet = (await readWorkbook(bytes)).sheets[0];

  assert.equal(sheet.byRef.get("A1")?.text, "0.995", "an unstyled number is untouched");
  assert.equal(sheet.byRef.get("B1")?.text, "99.5%", "built-in 9 is 0%");
  assert.equal(sheet.byRef.get("C1")?.text, "99.5%", "built-in 10 is 0.00%");
  assert.equal(
    sheet.byRef.get("D1")?.text,
    "0.995",
    'a QUOTED "%" is a printed character, not Excel\'s multiply-by-100 marker',
  );
  assert.equal(sheet.byRef.get("E1")?.text, "50%", "a custom code with an unquoted % counts");
  assert.equal(
    sheet.byRef.get("F1")?.text,
    "120341172.5",
    "currency decorates a number without changing it, so it is left alone",
  );
  assert.equal(
    sheet.byRef.get("C1")?.raw,
    "0.995",
    "the stored fraction survives, so nothing downstream has lost the real number",
  );
});
