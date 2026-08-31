/**
 * Unit tests for the attachment converters.
 *
 * These run in Node against the real libraries, so a breaking upgrade of
 * exceljs or mammoth fails here rather than in the browser. PDF rasterization
 * is covered in scripts/test-pipeline.mjs instead, using @napi-rs/canvas as
 * the Node-side canvas.
 */
import assert from "node:assert/strict";
import test from "node:test";
import exceljs from "exceljs";
import mammothPkg from "mammoth";

const { Workbook } = exceljs;

test("exceljs reads a workbook back as rows", async () => {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Invoices");
  sheet.addRow(["item", "qty", "price"]);
  sheet.addRow(["router", 2, 450000]);
  sheet.addRow(["modem", 1, 300000]);

  const buffer = await workbook.xlsx.writeBuffer();

  const reloaded = new Workbook();
  await reloaded.xlsx.load(buffer);

  const rows = [];
  reloaded.getWorksheet("Invoices").eachRow({ includeEmpty: false }, (row) => {
    rows.push(row.values.slice(1).join(","));
  });

  assert.equal(rows.length, 3, "all three rows survive the round trip");
  assert.equal(rows[0], "item,qty,price");
  assert.equal(rows[1], "router,2,450000");
});

test("exceljs surfaces formula results, not formula source", async () => {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("Totals");
  sheet.getCell("A1").value = { formula: "SUM(1,2)", result: 3 };

  const buffer = await workbook.xlsx.writeBuffer();
  const reloaded = new Workbook();
  await reloaded.xlsx.load(buffer);

  const cell = reloaded.getWorksheet("Totals").getCell("A1").value;
  assert.equal(
    typeof cell === "object" ? cell.result : cell,
    3,
    "a formula cell exposes its computed result",
  );
});

test("mammoth extracts text from a docx", async () => {
  // Minimal valid .docx: a zip with the two parts Word requires.
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.folder("_rels").file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.folder("word").file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>Contract reference TV-2026-88</w:t></w:r></w:p></w:body>
</w:document>`,
  );

  // mammoth's Node build reads `buffer`; its browser build reads `arrayBuffer`
  // (see mammoth/browser/unzip.js). src/lib/attachments/office.ts is the
  // browser path, so it correctly passes `arrayBuffer` instead.
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const { value } = await (mammothPkg.default ?? mammothPkg).extractRawText({
    buffer,
  });

  assert.match(value, /Contract reference TV-2026-88/);
});
