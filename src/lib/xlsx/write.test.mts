/**
 * WHAT THIS FILE PROTECTS: a workbook that opens cleanly and is wrong.
 *
 * `write.ts` amends the operator's own `.xlsx` in place, and every way it can
 * fail produces a file Excel opens without complaint: two rows numbered 9, two
 * cells addressed E9, a formula left behind that recomputes over the approved
 * value the instant the file is opened, a style index dropped so the amended
 * cell no longer looks like its column, a dimension that stops one column short
 * of a value somebody signed for. None of those raise anything anywhere. So
 * they are pinned here, one test each, in the terms of the file they would
 * produce.
 *
 * The regression at the bottom is the one with a scar behind it: an earlier
 * draft matched rows with a regular expression, missed the ones Excel writes
 * with extra whitespace in the start tag, and fell through to APPENDING a
 * second `<row r="9">` at the end of `<sheetData>`.
 *
 * No network, no API key, no model. Every workbook here is built with jszip in
 * the test itself, and every value is fictional: `LOP999001`,
 * `BANK CONTOH NUSANTARA`, `PSB VPN IP KCP Contoh`, `1209990001`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import {
  patchSheetXml,
  patchWorkbook,
  verifyPatchedSheet,
  WorkbookPatchError,
  type CellEdit,
} from "./write.ts";

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const MAIN_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const REL_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const PKG_REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const WORKSHEET_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";

/** One worksheet part, shaped the way Excel shapes one. */
function worksheet(sheetData: string, dimension: string | null = "A1:E35"): string {
  const dim = dimension === null ? "" : `<dimension ref="${dimension}"/>`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<worksheet ${MAIN_NS} ${REL_NS}>${dim}<sheetData>${sheetData}</sheetData></worksheet>`
  );
}

type SheetPart = { name: string; rid: string; part: string; xml: string };

/**
 * A minimal but real OOXML archive.
 *
 * `part` is given per sheet rather than derived, because one of the tests below
 * exists to prove that a sheet's name is resolved through the relationship it
 * declares and not by the number in its filename -- which is a real shape: one
 * of the three client workbooks holds a single sheet whose part is `sheet1.xml`
 * and whose `sheetId` is 3.
 */
async function archive(sheets: readonly SheetPart[], extras: Record<string, string> = {}) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      "</Types>",
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${PKG_REL_NS}>` +
      '<Relationship Id="rIdBook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${MAIN_NS} ${REL_NS}><sheets>` +
      sheets
        .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 3}" r:id="${s.rid}"/>`)
        .join("") +
      "</sheets></workbook>",
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${PKG_REL_NS}>` +
      sheets
        .map((s) => `<Relationship Id="${s.rid}" Type="${WORKSHEET_TYPE}" Target="${s.part}"/>`)
        .join("") +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>",
  );
  for (const s of sheets) zip.file(`xl/${s.part}`, s.xml);
  zip.file("xl/styles.xml", `<styleSheet ${MAIN_NS}/>`);
  zip.file("xl/sharedStrings.xml", `<sst ${MAIN_NS} count="1" uniqueCount="1"><si><t>x</t></si></sst>`);
  for (const [path, body] of Object.entries(extras)) zip.file(path, body);
  return zip.generateAsync({ type: "uint8array" });
}

/** One sheet named `Sheet1` at `worksheets/sheet1.xml`, the ordinary case. */
async function simpleArchive(sheetData: string, dimension: string | null = "A1:E35") {
  return archive([
    { name: "Sheet1", rid: "rId1", part: "worksheets/sheet1.xml", xml: worksheet(sheetData, dimension) },
  ]);
}

async function partOf(bytes: Uint8Array, path: string): Promise<string> {
  return partOfZip(await JSZip.loadAsync(bytes), path);
}

async function partOfZip(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (file === null) throw new Error(`${path} must be in the archive`);
  return file.async("string");
}

/* --- readers written independently of the module under test --------- */

function startTags(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}(?=[\\s/>])[^>]*>`, "g"))].map((m) => m[0]);
}

function attrOf(tag: string, name: string): string | null {
  const found = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return found === null ? null : found[1];
}

function rowIndexes(xml: string): number[] {
  return startTags(xml, "row").map((tag) => Number(attrOf(tag, "r")));
}

function cellRefs(xml: string): string[] {
  return startTags(xml, "c").map((tag) => attrOf(tag, "r") ?? "");
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const on = (ref: string, value: string): CellEdit => ({ sheet: "Sheet1", ref, value });

/* ------------------------------------------------------------------ *
 * Replacing a cell that is already there
 * ------------------------------------------------------------------ */

test("a replaced shared-string cell keeps its style index and stops claiming to be a shared string", () => {
  const before = worksheet('<row r="9" spans="1:5"><c r="E9" s="2" t="s"><v>64</v></c></row>');

  const after = patchSheetXml(before, [on("E9", "BANK CONTOH NUSANTARA")]);

  const cell = startTags(after, "c")[0];
  assert.equal(attrOf(cell, "s"), "2", "the cell's number format, font and borders live behind s");
  assert.equal(attrOf(cell, "t"), "inlineStr");
  assert.match(after, /<is><t xml:space="preserve">BANK CONTOH NUSANTARA<\/t><\/is>/);
  assert.equal(occurrences(after, "<v>64</v>"), 0, "the old shared-string index must be gone");
});

test("the shared string table is never rewritten, so its count stays true", async () => {
  const bytes = await simpleArchive('<row r="9"><c r="E9" s="2" t="s"><v>0</v></c></row>');
  const patched = await patchWorkbook(bytes, [on("E9", "PSB VPN IP KCP Contoh")]);

  assert.equal(
    await partOf(patched, "xl/sharedStrings.xml"),
    await partOf(bytes, "xl/sharedStrings.xml"),
    "an appended shared string would have to maintain count and uniqueCount, and a wrong one opens fine",
  );
});

test("a replaced formula cell loses its <f>, so Excel cannot recompute over the written value", () => {
  const before = worksheet(
    '<row r="4"><c r="B4" s="7"><f>SUM(B1:B3)</f><v>12</v></c></row>',
  );

  const after = patchSheetXml(before, [{ sheet: "Sheet1", ref: "B4", value: "1209990001" }]);

  assert.equal(occurrences(after, "<f>"), 0, "a surviving formula silently undoes the operator's approval");
  assert.equal(occurrences(after, "<v>"), 0);
  assert.equal(attrOf(startTags(after, "c")[0], "s"), "7");
  assert.match(after, /<t xml:space="preserve">1209990001<\/t>/);
});

test("replacing one cell leaves every other cell of its row exactly as it was", () => {
  const before = worksheet(
    '<row r="9" spans="1:5"><c r="C9" s="1" t="s"><v>14</v></c><c r="D9" s="1" t="s"><v>6</v></c><c r="E9" s="2" t="s"><v>64</v></c></row>',
  );

  const after = patchSheetXml(before, [on("E9", "Budi Contoh")]);

  assert.match(after, /<c r="C9" s="1" t="s"><v>14<\/v><\/c>/);
  assert.match(after, /<c r="D9" s="1" t="s"><v>6<\/v><\/c>/);
  assert.deepEqual(cellRefs(after), ["C9", "D9", "E9"]);
});

test("a value's & < > become text, not markup", () => {
  const before = worksheet('<row r="2"><c r="A2" s="1"/></row>');

  const after = patchSheetXml(before, [on("A2", 'Bandwidth < 10 & > 5 "x"')]);

  assert.match(after, /<t xml:space="preserve">Bandwidth &lt; 10 &amp; &gt; 5 "x"<\/t>/);
  // The verifier decodes it back, so a double-escape or a lost escape is caught
  // by the module itself; this only pins the shape written to disk.
  verifyPatchedSheet(after, "Sheet1", [on("A2", 'Bandwidth < 10 & > 5 "x"')]);
});

test("leading and trailing spaces in an approved value survive the round trip", () => {
  const before = worksheet('<row r="2"><c r="A2"/></row>');
  const after = patchSheetXml(before, [on("A2", "  Jl. Contoh No. 1  ")]);
  assert.match(after, /xml:space="preserve">  Jl\. Contoh No\. 1  </);
  verifyPatchedSheet(after, "Sheet1", [on("A2", "  Jl. Contoh No. 1  ")]);
});

/* ------------------------------------------------------------------ *
 * Creating a cell, and creating a row
 * ------------------------------------------------------------------ */

test("a cell created inside an existing row lands in column order", () => {
  const before = worksheet('<row r="9" spans="1:5"><c r="C9" s="1"/><c r="E9" s="2"/></row>');

  const after = patchSheetXml(before, [on("D9", "LOP999001")]);

  assert.deepEqual(
    cellRefs(after),
    ["C9", "D9", "E9"],
    "a cell appended after E9 is a sheet whose cells are out of order",
  );
  assert.equal(rowIndexes(after).length, 1, "no second row may appear");
});

test("a row's spans hint widens to cover a cell created outside it", () => {
  const before = worksheet('<row r="9" spans="1:5"><c r="C9" s="1"/></row>');
  const after = patchSheetXml(before, [on("H9", "1-70000000001")]);
  assert.equal(attrOf(startTags(after, "row")[0], "spans"), "1:8");
});

test("a row created for a cell lands in row order, not at the end of the sheet", () => {
  const before = worksheet(
    '<row r="4"><c r="A4"/></row><row r="9"><c r="A9"/></row><row r="30"><c r="A30"/></row>',
  );

  const after = patchSheetXml(before, [on("B12", "PSB VPN IP KCP Contoh")]);

  assert.deepEqual(rowIndexes(after), [4, 9, 12, 30]);
  assert.match(after, /<row r="12"><c r="B12" t="inlineStr">/);
});

test("a row created past the last row lands last, and one before the first lands first", () => {
  const before = worksheet('<row r="9"><c r="A9"/></row>');

  const after = patchSheetXml(before, [on("A2", "atas"), on("A40", "bawah")]);

  assert.deepEqual(rowIndexes(after), [2, 9, 40]);
});

test("cells created together in one new row are written in column order", () => {
  const before = worksheet('<row r="1"><c r="A1"/></row>');

  const after = patchSheetXml(before, [
    { sheet: "Sheet1", ref: "E5", value: "e" },
    { sheet: "Sheet1", ref: "B5", value: "b" },
    { sheet: "Sheet1", ref: "AA5", value: "aa" },
  ]);

  assert.deepEqual(cellRefs(after), ["A1", "B5", "E5", "AA5"]);
});

test("a self-closing <row/> is opened before a cell is written into it", () => {
  // Excel writes this for a row that carries a height or a style and no cells,
  // and a blank order template is full of them.
  const before = worksheet('<row r="6" ht="28.8" x14ac:dyDescent="0.3"/><row r="8"><c r="A8"/></row>');

  const after = patchSheetXml(before, [on("C6", "Budi Contoh")]);

  assert.equal(occurrences(after, "<row r=\"6\""), 1);
  assert.match(after, /<row r="6" ht="28\.8" x14ac:dyDescent="0\.3"><c r="C6" t="inlineStr">/);
  assert.equal(occurrences(after, "</row>"), 2, "the opened row must be closed exactly once");
  assert.deepEqual(rowIndexes(after), [6, 8]);
});

test("an empty <sheetData/> takes its first row", () => {
  const before =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<worksheet ${MAIN_NS}><dimension ref="A1"/><sheetData/></worksheet>`;

  const after = patchSheetXml(before, [on("C3", "LOP999001")]);

  assert.deepEqual(rowIndexes(after), [3]);
  assert.match(after, /<sheetData><row r="3">/);
  verifyPatchedSheet(after, "Sheet1", [on("C3", "LOP999001")]);
});

/* ------------------------------------------------------------------ *
 * The dimension
 * ------------------------------------------------------------------ */

test("the dimension grows to cover an address outside the old used range", () => {
  const before = worksheet('<row r="9"><c r="E9"/></row>', "A1:E35");

  const after = patchSheetXml(before, [on("H40", "1209990001")]);

  assert.equal(attrOf(startTags(after, "dimension")[0], "ref"), "A1:H40");
});

test("the dimension's top-left corner moves when an edit lands above and left of it", () => {
  const before = worksheet('<row r="9"><c r="E9"/></row>', "C5:E35");
  const after = patchSheetXml(before, [on("A2", "atas kiri")]);
  assert.equal(attrOf(startTags(after, "dimension")[0], "ref"), "A2:E35");
});

test("a single-cell dimension is read as a range and still grows", () => {
  const before = worksheet('<row r="1"><c r="A1"/></row>', "A1");
  const after = patchSheetXml(before, [on("C3", "x")]);
  assert.equal(attrOf(startTags(after, "dimension")[0], "ref"), "A1:C3");
});

test("a worksheet with no dimension is left without one, because absent is not a false claim", () => {
  const before = worksheet('<row r="1"><c r="A1"/></row>', null);
  const after = patchSheetXml(before, [on("C3", "x")]);
  assert.equal(startTags(after, "dimension").length, 0);
  verifyPatchedSheet(after, "Sheet1", [on("C3", "x")]);
});

/* ------------------------------------------------------------------ *
 * Sheet resolution and refusals
 * ------------------------------------------------------------------ */

test("an edit naming a sheet the workbook has not got is refused, and nothing is written", async () => {
  const bytes = await simpleArchive('<row r="9"><c r="E9"/></row>');

  await assert.rejects(
    () => patchWorkbook(bytes, [{ sheet: "Konfigurasi", ref: "E9", value: "x" }]),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookPatchError);
      assert.match(error.message, /no sheet named "Konfigurasi"/);
      assert.match(error.message, /"Sheet1"/, "the refusal must say what the workbook does have");
      return true;
    },
  );
});

test("a sheet name that differs only in case is refused, and the refusal says so", async () => {
  const bytes = await archive([
    { name: "metro-e", rid: "rId1", part: "worksheets/sheet1.xml", xml: worksheet('<row r="5"><c r="B5"/></row>') },
  ]);

  await assert.rejects(
    () => patchWorkbook(bytes, [{ sheet: "Metro-E", ref: "B5", value: "x" }]),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookPatchError);
      assert.match(error.message, /this workbook spells it "metro-e"/);
      return true;
    },
  );
});

test("a sheet name is resolved through its relationship, never by the number in the part's filename", async () => {
  // rId1 belongs to the SECOND sheet and points at sheet1.xml; the first sheet
  // lives in sheet9.xml. Anything that pairs the Nth sheet with sheetN.xml
  // writes the operator's value into the wrong sheet, in a file that opens.
  const bytes = await archive([
    { name: "Data", rid: "rId2", part: "worksheets/sheet9.xml", xml: worksheet('<row r="5"><c r="B5" s="3"/></row>') },
    { name: "Notes", rid: "rId1", part: "worksheets/sheet1.xml", xml: worksheet('<row r="5"><c r="B5" s="4"/></row>') },
  ]);

  const patched = await patchWorkbook(bytes, [{ sheet: "Data", ref: "B5", value: "LOP999001" }]);

  assert.match(await partOf(patched, "xl/worksheets/sheet9.xml"), /LOP999001/);
  assert.equal(
    await partOf(patched, "xl/worksheets/sheet1.xml"),
    await partOf(bytes, "xl/worksheets/sheet1.xml"),
    "the sheet that was not edited must come back untouched",
  );
});

test("two edits naming one address are refused rather than one of them silently winning", async () => {
  const bytes = await simpleArchive('<row r="9"><c r="E9"/></row>');

  await assert.rejects(
    () => patchWorkbook(bytes, [on("E9", "satu"), on("E9", "dua")]),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookPatchError);
      assert.match(error.message, /named by two edits at once/);
      return true;
    },
  );
});

test("a value carrying a control character is refused, because Excel would not open the file", async () => {
  const bytes = await simpleArchive('<row r="9"><c r="E9"/></row>');
  const withNul = `BANK CONTOH${String.fromCharCode(0)}NUSANTARA`;

  await assert.rejects(
    () => patchWorkbook(bytes, [on("E9", withNul)]),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookPatchError);
      assert.match(error.message, /control character/);
      return true;
    },
  );
});

test("a newline in a value is allowed, because a multi-line address is a real cell", () => {
  const before = worksheet('<row r="9"><c r="E9"/></row>');
  const value = "Jl. Contoh No. 1\nJakarta";
  const after = patchSheetXml(before, [on("E9", value)]);
  verifyPatchedSheet(after, "Sheet1", [on("E9", value)]);
});

test("an address past the end of a worksheet is refused", async () => {
  const bytes = await simpleArchive('<row r="9"><c r="E9"/></row>');

  await assert.rejects(
    () => patchWorkbook(bytes, [on("ZZZ1", "x")]),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookPatchError);
      assert.match(error.message, /past the end of a worksheet/);
      return true;
    },
  );
});

test("something that is not a cell address is refused with the address named", async () => {
  const bytes = await simpleArchive('<row r="9"><c r="E9"/></row>');

  await assert.rejects(
    () => patchWorkbook(bytes, [on("E", "x")]),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookPatchError);
      assert.match(error.message, /Sheet1!E is not a cell address/);
      return true;
    },
  );
});

/* ------------------------------------------------------------------ *
 * The archive around the sheet
 * ------------------------------------------------------------------ */

test("an empty edit list returns the caller's own bytes, un-rezipped", async () => {
  const bytes = await simpleArchive('<row r="9"><c r="E9"/></row>');
  const result = await patchWorkbook(bytes, []);
  assert.equal(result, bytes, "a workbook nobody edited must be the file it was");
});

test("every part other than the edited worksheet comes back with its content unchanged", async () => {
  const bytes = await archive(
    [{ name: "Sheet1", rid: "rId1", part: "worksheets/sheet1.xml", xml: worksheet('<row r="9"><c r="E9" s="2"/></row>') }],
    { "xl/printerSettings/printerSettings1.bin": "not xml at all", "docProps/app.xml": "<Properties/>" },
  );

  const patched = await patchWorkbook(bytes, [on("E9", "BANK CONTOH NUSANTARA")]);

  const before = await JSZip.loadAsync(bytes);
  const after = await JSZip.loadAsync(patched);
  assert.deepEqual(
    Object.keys(after.files).sort(),
    Object.keys(before.files).sort(),
    "no part may be added or dropped",
  );
  for (const name of Object.keys(before.files)) {
    if (name === "xl/worksheets/sheet1.xml" || before.files[name].dir) continue;
    assert.equal(
      await partOfZip(after, name),
      await partOfZip(before, name),
      `${name} must be what the operator handed over`,
    );
  }
});

test("a full patch through the archive lands the value where the address says", async () => {
  const bytes = await simpleArchive(
    '<row r="9" spans="1:5"><c r="C9" s="1" t="s"><v>0</v></c><c r="E9" s="2" t="s"><v>0</v></c></row>',
  );

  const patched = await patchWorkbook(bytes, [
    on("E9", "BANK CONTOH NUSANTARA"),
    on("E10", "PSB VPN IP KCP Contoh"),
  ]);

  const xml = await partOf(patched, "xl/worksheets/sheet1.xml");
  assert.deepEqual(rowIndexes(xml), [9, 10]);
  assert.deepEqual(cellRefs(xml), ["C9", "E9", "E10"]);
  assert.equal(attrOf(startTags(xml, "dimension")[0], "ref"), "A1:E35");
});

/* ------------------------------------------------------------------ *
 * THE REGRESSION: the duplicate row
 * ------------------------------------------------------------------ */

test("a row Excel wrote with awkward whitespace is patched in place, never duplicated", () => {
  // Every one of these start tags is legal, and a pattern written against
  // `<row r="9">` finds none of the last three. What a missed row cost the
  // first draft of this module was not a missed edit: it was an APPENDED
  // `<row r="9">` at the end of <sheetData>, and a workbook with two rows
  // numbered 9 that Excel opens and resolves however it likes.
  const before = worksheet(
    '<row r="4"><c r="A4"/></row>' +
      '<row  r="9"  spans="1:5" >  <c r="C9" s="1"/>  </row>' +
      "\n" +
      '<row\tr="12" ht="28.8"><c r="C12" s="1"/></row>' +
      '<row r="20" spans=\'1:5\'><c r="C20" s="1"/></row>',
  );

  const after = patchSheetXml(before, [
    on("E9", "BANK CONTOH NUSANTARA"),
    on("E12", "PSB VPN IP KCP Contoh"),
    on("E20", "1209990001"),
    on("E15", "1-70000000001"),
  ]);

  const rows = rowIndexes(after);
  assert.deepEqual(rows, [4, 9, 12, 15, 20], "rows must stay ordered and unique");
  assert.equal(new Set(rows).size, rows.length, "no row index may appear twice");

  const refs = cellRefs(after);
  assert.equal(new Set(refs).size, refs.length, "no address may appear twice");
  assert.deepEqual(refs, ["A4", "C9", "E9", "C12", "E12", "E15", "C20", "E20"]);

  // And the values actually landed, rather than the patch quietly doing nothing.
  assert.match(after, /<c r="E9" t="inlineStr"><is><t xml:space="preserve">BANK CONTOH NUSANTARA</);
  assert.match(after, /<c r="E20" t="inlineStr"><is><t xml:space="preserve">1209990001</);
});

test("the whitespace of a hand-formatted sheet survives, character for character", () => {
  // Excel writes no whitespace between rows, so this only ever matters for a
  // workbook somebody pretty-printed or produced from another tool. It is
  // pinned because a rebuild that drops it is a diff across the whole file, and
  // an operator comparing their upload against their download would be reading
  // a change on every line to find the four cells that actually moved.
  const before = worksheet('<row r="1">\n  <c r="A1" s="1"/>\n</row>\n<row r="3"><c r="A3"/></row>');

  const after = patchSheetXml(before, [on("B1", "x")]);

  assert.match(after, /<row r="1">\n {2}<c r="A1" s="1"\/>\n<c r="B1" t="inlineStr">/);
  assert.match(after, /<\/is><\/c><\/row>\n<row r="3"><c r="A3"\/><\/row>/);
});

/* ------------------------------------------------------------------ *
 * The verifier, driven directly against files it must refuse
 * ------------------------------------------------------------------ */

test("the verifier refuses a sheet with two rows of the same index", () => {
  const broken = worksheet(
    '<row r="9"><c r="E9" t="inlineStr"><is><t>satu</t></is></c></row>' +
      '<row r="9"><c r="E9" t="inlineStr"><is><t>dua</t></is></c></row>',
  );

  assert.throws(
    () => verifyPatchedSheet(broken, "Sheet1", [on("E9", "satu")]),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookPatchError);
      assert.match(error.message, /two rows numbered 9/);
      return true;
    },
  );
});

test("the verifier refuses rows that run backwards", () => {
  const broken = worksheet('<row r="12"><c r="A12"/></row><row r="9"><c r="A9"/></row>');

  assert.throws(
    () => verifyPatchedSheet(broken, "Sheet1", []),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookPatchError);
      assert.match(error.message, /out of order/);
      return true;
    },
  );
});

test("the verifier refuses a cell sitting in a row its own address does not name", () => {
  const broken = worksheet('<row r="9"><c r="E10" t="inlineStr"><is><t>x</t></is></c></row>');

  assert.throws(
    () => verifyPatchedSheet(broken, "Sheet1", [on("E10", "x")]),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookPatchError);
      assert.match(error.message, /holds E10 inside row 9/);
      return true;
    },
  );
});

test("the verifier refuses cells out of column order within a row", () => {
  const broken = worksheet('<row r="9"><c r="E9"/><c r="C9"/></row>');

  assert.throws(
    () => verifyPatchedSheet(broken, "Sheet1", []),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookPatchError);
      assert.match(error.message, /out of column order/);
      return true;
    },
  );
});

test("the verifier refuses a cell that still carries a formula", () => {
  const broken = worksheet(
    '<row r="4"><c r="B4" t="inlineStr"><f>SUM(B1:B3)</f><is><t>12</t></is></c></row>',
  );

  assert.throws(
    () => verifyPatchedSheet(broken, "Sheet1", [{ sheet: "Sheet1", ref: "B4", value: "12" }]),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookPatchError);
      assert.match(error.message, /still carries a formula/);
      return true;
    },
  );
});

test("the verifier refuses a cell whose text is not the value that was approved", () => {
  const patched = worksheet('<row r="9"><c r="E9" t="inlineStr"><is><t>salah</t></is></c></row>');

  assert.throws(
    () => verifyPatchedSheet(patched, "Sheet1", [on("E9", "benar")]),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookPatchError);
      assert.match(error.message, /reads "salah" after patching, not "benar"/);
      return true;
    },
  );
});

test("the verifier refuses an edited address that is not in the sheet at all", () => {
  const patched = worksheet('<row r="9"><c r="C9"/></row>');

  assert.throws(
    () => verifyPatchedSheet(patched, "Sheet1", [on("E9", "x")]),
    (error: unknown) => {
      assert.ok(error instanceof WorkbookPatchError);
      assert.match(error.message, /Sheet1!E9 was edited and is not in the patched sheet/);
      return true;
    },
  );
});

test("the verifier accepts what patchSheetXml produces, for every shape above at once", () => {
  const before = worksheet(
    '<row r="1"><c r="A1" s="1" t="s"><v>0</v></c></row>' +
      '<row  r="9"  spans="1:5" ><c r="C9" s="2"/></row>' +
      '<row r="14" ht="20"/>',
    "A1:E35",
  );
  const edits: CellEdit[] = [
    on("A1", "Nomor"),
    on("E9", "BANK CONTOH NUSANTARA"),
    on("B14", "1-70000000001"),
    on("H41", "1209990001"),
  ];

  const after = patchSheetXml(before, edits);

  verifyPatchedSheet(after, "Sheet1", edits);
  assert.deepEqual(rowIndexes(after), [1, 9, 14, 41]);
  assert.equal(attrOf(startTags(after, "dimension")[0], "ref"), "A1:H41");
});
