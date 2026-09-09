/**
 * Unit tests for the attachment converters.
 *
 * These run in Node against the real library, so a breaking upgrade of
 * mammoth fails here rather than in the browser. PDF rasterization is covered
 * in scripts/test-pipeline.mjs instead, using @napi-rs/canvas as the Node-side
 * canvas.
 */
import assert from "node:assert/strict";
import test from "node:test";
import mammothPkg from "mammoth";

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
