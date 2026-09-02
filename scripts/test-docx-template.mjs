/**
 * The template-driven docx path: `scripts/make-docx-template.mjs` strips a
 * human-authored Form Validasi to a patchable template plus an anchor
 * manifest, and `buildDocx` patches that instead of constructing a document.
 *
 * Everything here runs against a SYNTHETIC form built in-process. The two
 * real forms live in the gitignored `documents/`, they are client material
 * that must never be committed, and `pnpm test` must not depend on a file a
 * fresh clone does not have. The synthetic form is not invented freely
 * either: every shape in it was read out of the bundle-one sample first --
 * the four-cell header table, the numbered ListParagraph headings, a whole-
 * page-capture section whose pictures are plain indented paragraphs, TWO
 * tables under ONE heading (which `AO_TEMPLATE` names "KB" and "KB
 * (lanjutan)"), a row that stacks two pictures in one cell, a table row
 * labelled with the order's own quote number, an unlabelled trailing row,
 * and a SELF-CLOSING `<w:hyperlink r:id=.../>` in a header value cell.
 *
 * The last of those is a regression test with a scar. Treating it as a
 * wrapper -- looking for a `</w:hyperlink>` that is not there -- produced an
 * edit range that started one character before its own start, and applied
 * back to front it swallowed the placeholder inserted after it. The CC cell
 * came out with the customer's name correctly removed and no `{{header.cc}}`
 * to put anything back, and nothing said so: the count of placeholders was
 * simply 33 where it should have been 34.
 */

import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { createCanvas } from "@napi-rs/canvas";
import { patchDetector } from "docx";
import { makeDocxTemplate } from "./make-docx-template.mjs";
import { buildDocx, TEMPLATE_MANIFEST_VERSION } from "../src/lib/export/docx.ts";
import { cropToPng } from "../src/lib/export/crop.ts";

// -------------------------------------------------------------------------
// A synthetic Form Validasi
// -------------------------------------------------------------------------

/**
 * Identifiers that stand in for the previous order's real ones. The point of
 * the header-cell scrub is that NONE of these may survive into the template,
 * so the tests below assert their absence by name.
 */
const OLD = {
  idEpic: "LOP999002",
  namaProyek: "Proyek Lama Contoh",
  quote: "1-70000000002",
  cc: "BANK LAMA CONTOH",
  jenisOrder: "MO",
};

const run = (text, { bold = false } = {}) =>
  `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;

const para = (children, { style = "", numId = 0 } = {}) => {
  const props =
    style || numId
      ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}` +
        `${numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>` : ""}</w:pPr>`
      : "";
  return `<w:p>${props}${children}</w:p>`;
};

const drawingRun = (relId) =>
  `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0">` +
  `<wp:extent cx="914400" cy="914400"/><a:graphic><a:graphicData><pic:pic>` +
  `<pic:blipFill><a:blip r:embed="${relId}"/></pic:blipFill></pic:pic>` +
  `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

const cell = (paragraphs, widthTwips) =>
  `<w:tc><w:tcPr><w:tcW w:w="${widthTwips}" w:type="dxa"/></w:tcPr>${paragraphs}</w:tc>`;

const row = (cells) => `<w:tr>${cells.join("")}</w:tr>`;

const table = (rows) =>
  `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>${rows.join("")}</w:tbl>`;

const heading = (text) => para(run(text), { style: "ListParagraph", numId: 6 });
const spacer = () => para("", { style: "ListParagraph" });

function sourceDocumentXml() {
  const headerTable = table([
    row([
      cell(para(run("ID EPIC :")), 1176),
      cell(para(run(OLD.idEpic, { bold: true })), 1938),
      cell(para(run("NAMA Proyek :")), 1984),
      cell(para(run(OLD.namaProyek, { bold: true })), 5174),
    ]),
    row([
      cell(para(run("QUOTE :")), 1176),
      cell(para(run(OLD.quote, { bold: true })), 1938),
      cell(para(run("CC :")), 1984),
      // The measured shape from the sample: a bookmark, the customer name,
      // then a SELF-CLOSING hyperlink pointing at that customer's record on
      // an internal host.
      cell(
        para(
          `<w:bookmarkStart w:id="0" w:name="customer_id"/>${run(OLD.cc, { bold: true })}` +
            `<w:hyperlink r:id="rId4" w:anchor="id=946" w:history="1"/>` +
            `<w:bookmarkEnd w:id="0"/>`,
        ),
        5174,
      ),
    ]),
    row([
      cell(para(run("ORDER :")), 1176),
      cell(para(""), 1938),
      cell(para(run("JENIS ORDER :")), 1984),
      cell(para(run(OLD.jenisOrder, { bold: true })), 5174),
    ]),
  ]);

  const alpha = [
    heading("Alpha"),
    para(drawingRun("rId5"), { style: "ListParagraph" }),
    spacer(),
    spacer(),
    para(""),
  ].join("");

  // Two tables under ONE heading, the sample's KB shape.
  const beta = [
    heading("Beta"),
    table([
      row([cell(para(run("Nomor")), 1000), cell(para(drawingRun("rId5")), 2880)]),
      row([
        cell(para(run("ToP")), 1000),
        // Two pictures in one cell, in two paragraphs, exactly as the
        // sample's ToP row stacks them.
        cell(
          para("") + para(drawingRun("rId5")) + para(drawingRun("rId5")) + para(""),
          2880,
        ),
      ]),
    ]),
    para(""),
    table([row([cell(para(run("Detail")), 1000), cell(para(""), 2880)])]),
  ].join("");

  const gamma = [
    heading("Gamma"),
    table([
      // Labelled with the order's own quote number: per-order data, not
      // boilerplate.
      row([cell(para(run(OLD.quote)), 1000), cell(para(""), 8292)]),
      row([cell(para(run("Lainnya")), 1000), cell(para(""), 8292)]),
      // The sample's SBR Pricing table carries a trailing unlabelled row the
      // form does not transcribe.
      row([cell(para(""), 1000), cell(para(""), 8292)]),
    ]),
  ].join("");

  const sectPr =
    `<w:sectPr><w:headerReference w:type="default" r:id="rId3"/>` +
    `<w:pgSz w:w="11901" w:h="16817"/>` +
    `<w:pgMar w:top="873" w:right="907" w:bottom="941" w:left="1026"/></w:sectPr>`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document ` +
    `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<w:body>${para("")}${headerTable}${alpha}${beta}${gamma}${sectPr}</w:body></w:document>`
  );
}

const HEADER_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:p><w:r><w:t>DOKUMEN VALIDASI</w:t></w:r></w:p></w:hdr>`;

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/>` +
  `<w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>` +
  `</w:styles>`;

const CORE_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<cp:coreProperties ` +
  `xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
  `xmlns:dc="http://purl.org/dc/elements/1.1/">` +
  `<dc:title>DOKUMEN VALIDASI</dc:title>` +
  `<dc:creator>Nama Orang Contoh</dc:creator>` +
  `<cp:lastModifiedBy>Nama Orang Contoh</cp:lastModifiedBy>` +
  `</cp:coreProperties>`;

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const DOCUMENT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>` +
  `<Relationship Id="rId3" Type="${REL}/header" Target="header1.xml"/>` +
  `<Relationship Id="rId4" Type="${REL}/hyperlink" Target="http://10.0.0.1/web" TargetMode="External"/>` +
  `<Relationship Id="rId5" Type="${REL}/image" Target="media/image1.png"/>` +
  `</Relationships>`;

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Default Extension="png" ContentType="image/png"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

async function syntheticForm({ documentXml } = {}) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("word/document.xml", documentXml ?? sourceDocumentXml());
  zip.file("word/_rels/document.xml.rels", DOCUMENT_RELS);
  zip.file("word/header1.xml", HEADER_XML);
  zip.file("word/styles.xml", STYLES_XML);
  zip.file("word/media/image1.png", new Uint8Array([137, 80, 78, 71, 0, 0, 0, 0]));
  zip.file("docProps/core.xml", CORE_XML);
  return await zip.generateAsync({ type: "uint8array" });
}

/** The `Template` that this synthetic form is the human authoring of. */
const slot = (key, label, extra = {}) => ({
  key,
  label,
  docType: null,
  hint: `test slot ${key}`,
  fillable: true,
  ...extra,
});

const FORM = {
  id: "TEST",
  label: "DOKUMEN VALIDASI",
  sections: [
    { title: "Alpha", layout: "images", slots: [slot("alpha.1", "Alpha")] },
    {
      title: "Beta",
      layout: "table",
      slots: [slot("beta.nomor", "Nomor"), slot("beta.top", "ToP", { crops: 2 })],
    },
    {
      // The continuation table under the Beta heading, named the way
      // `AO_TEMPLATE` names the KB one.
      title: "Beta (lanjutan)",
      layout: "table",
      slots: [slot("betaLanjutan.detail", "Detail")],
    },
    {
      title: "Gamma",
      layout: "table",
      slots: [slot("gamma.quote", "{{quote}}"), slot("gamma.lainnya", "Lainnya")],
    },
  ],
  xlsxRows: [],
  fieldHints: {},
};

const HEADER = {
  idEpic: "LOP999001",
  namaProyek: "PSB VPN IP KCP Contoh",
  quote: "1-70000000001",
  cc: "BANK CONTOH NUSANTARA",
  order: "",
  jenisOrder: "AO",
};

const partText = async (bytes, path) =>
  await (await JSZip.loadAsync(bytes)).file(path).async("string");

const pngOf = async (w, h) => {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, w, h);
  return await cropToPng(
    { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h },
    { x: 0, y: 0, w, h },
  );
};

const crop = async (key, widthPx, heightPx) => ({
  key,
  png: await pngOf(widthPx, heightPx),
  widthPx,
  heightPx,
});

const tableRowsOf = (xml) =>
  xml
    .split(/<w:tr[\s>]/)
    .slice(1)
    .map((chunk) => chunk.split("</w:tr>")[0]);

// -------------------------------------------------------------------------
// The prep script
// -------------------------------------------------------------------------

test("makeDocxTemplate strips every picture and its relationships", async () => {
  const { docx, manifest, stats } = await makeDocxTemplate(await syntheticForm());
  assert.equal(stats.imageRuns, 4);
  assert.equal(stats.droppedImages, 1);

  const zip = await JSZip.loadAsync(docx);
  assert.equal(
    Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && !zip.files[f].dir)
      .length,
    0,
    "media parts survived",
  );

  const xml = await zip.file("word/document.xml").async("string");
  assert.equal(xml.includes("<w:drawing>"), false);
  assert.equal(xml.includes("<w:hyperlink"), false);

  const rels = await zip.file("word/_rels/document.xml.rels").async("string");
  assert.equal(rels.includes("/image"), false);
  assert.equal(rels.includes("/hyperlink"), false);
  // The header relationship is not an image or a link and must stay: it is
  // what points the sectPr at the DOKUMEN VALIDASI banner.
  assert.ok(rels.includes("/header"));
  assert.equal(manifest.version, TEMPLATE_MANIFEST_VERSION);
});

test("makeDocxTemplate leaves the parts that carry the document's look untouched", async () => {
  const source = await syntheticForm();
  const { docx } = await makeDocxTemplate(source);
  for (const part of ["word/header1.xml", "word/styles.xml"]) {
    assert.equal(
      await partText(docx, part),
      await partText(source, part),
      `${part} was rewritten`,
    );
  }
  // dc:title stays: the sample's header banner is a content control BOUND to
  // it (`w:dataBinding w:xpath="/ns1:coreProperties[1]/ns0:title[1]"`), so
  // scrubbing the title blanks the banner in every patched document.
  const core = await partText(docx, "docProps/core.xml");
  assert.ok(core.includes("<dc:title>DOKUMEN VALIDASI</dc:title>"));
  assert.ok(core.includes("<dc:creator></dc:creator>"));
  assert.ok(core.includes("<cp:lastModifiedBy></cp:lastModifiedBy>"));
  assert.equal(core.includes("Nama Orang Contoh"), false);
});

test("makeDocxTemplate scrubs the previous order's identifiers out of the header cells", async () => {
  const { docx, manifest } = await makeDocxTemplate(await syntheticForm());
  const xml = await partText(docx, "word/document.xml");

  for (const [field, value] of Object.entries(OLD)) {
    assert.equal(xml.includes(value), false, `${field} survived as "${value}"`);
  }
  for (const field of ["idEpic", "namaProyek", "quote", "cc", "order", "jenisOrder"]) {
    assert.equal(manifest.header[field], `header.${field}`);
    assert.ok(xml.includes(`{{header.${field}}}`), `no anchor for ${field}`);
  }

  // The CC cell is the one that carries a SELF-CLOSING <w:hyperlink/>, and
  // mishandling it once deleted the placeholder along with the link.
  assert.ok(xml.includes("{{header.cc}}"));

  // The value runs keep their <w:rPr>. Drop it and the patched value renders
  // in the document default instead of the form's own bold, which is a
  // quieter version of the "the font isn't right" complaint.
  const ccRun = xml.match(/<w:r>(?:(?!<\/w:r>)[\s\S])*\{\{header\.cc\}\}[\s\S]*?<\/w:r>/);
  assert.ok(ccRun, "no run around {{header.cc}}");
  assert.ok(ccRun[0].includes("<w:b/>"), "the run's formatting was dropped");
});

test("makeDocxTemplate emits one single-run placeholder per anchor", async () => {
  const { docx } = await makeDocxTemplate(await syntheticForm());
  const xml = await partText(docx, "word/document.xml");
  // Word splits typed text across runs on rsid boundaries and docx's patcher
  // matches inside one <w:t>, so a split placeholder never matches and ships
  // as literal "{{...}}" text.
  assert.ok(xml.includes(`<w:r><w:t xml:space="preserve">{{s0.images}}</w:t></w:r>`));

  const detected = await patchDetector({ data: docx });
  // Six header cells, one images anchor, two + one + three table rows, and
  // the quote row's own label anchor.
  assert.equal(new Set(detected).size, 6 + 1 + 2 + 1 + 3 + 1);
});

test("makeDocxTemplate reads a cell width whatever order its attributes are in", async () => {
  // XML does not order attributes, and the first version of this read one
  // regex over both -- `w:w` then `w:type` -- so a producer writing them the
  // other way round yielded null. Null is not loud: the cap falls back to the
  // page column, which is the width that lets an inline picture widen its
  // table off the page, so a template from such a producer silently lost the
  // guard entirely.
  const swapped = sourceDocumentXml().replace(
    /<w:tcW w:w="(\d+)" w:type="dxa"\/>/g,
    '<w:tcW w:type="dxa" w:w="$1"/>',
  );
  assert.ok(swapped.includes('<w:tcW w:type="dxa" w:w="2880"/>'), "fixture unchanged");

  const { manifest } = await makeDocxTemplate(await syntheticForm({ documentXml: swapped }));
  const beta = manifest.sections.find((section) => section.heading === "Beta");
  assert.deepEqual(
    beta.rows.map((r) => r.cellWidthTwips),
    [2880, 2880],
  );
});

test("makeDocxTemplate's manifest describes the form it was built from", async () => {
  const { manifest } = await makeDocxTemplate(await syntheticForm());

  assert.deepEqual(
    manifest.sections.map((s) => [s.heading, s.layout, s.continuation]),
    [
      ["Alpha", "images", false],
      ["Beta", "table", false],
      // Two tables under one heading: the second cannot be told apart by its
      // heading text, which is why the manifest marks it.
      ["Beta", "table", true],
      ["Gamma", "table", false],
    ],
  );
  assert.equal(manifest.sections[0].paragraphs, 3);
  assert.deepEqual(
    manifest.sections[1].rows.map((r) => r.label),
    ["Nomor", "ToP"],
  );
  // A row labelled with the order's own quote number becomes a placeholder
  // of its own and is recorded the way the form spells it.
  assert.equal(manifest.sections[3].rows[0].label, "{{quote}}");
  assert.equal(manifest.sections[3].rows[0].labelKey, "s3.r0.label");
  assert.equal(manifest.sections[3].rows[2].label, "");
  assert.equal(manifest.sections[1].rows[0].cellWidthTwips, 2880);
  assert.deepEqual(manifest.page, {
    widthTwips: 11901,
    heightTwips: 16817,
    marginTwips: { top: 873, right: 907, bottom: 941, left: 1026 },
  });
});

// -------------------------------------------------------------------------
// buildDocx against that template
// -------------------------------------------------------------------------

const buildAgainstTemplate = async (filled, overrides = {}) => {
  const { docx, manifest } = await makeDocxTemplate(await syntheticForm());
  return await buildDocx(FORM, HEADER, filled, {
    docx: overrides.docx ?? docx,
    manifest: overrides.manifest ?? manifest,
  });
};

test("buildDocx patches the template and keeps its header, styles and page setup", async () => {
  const source = await syntheticForm();
  const out = await buildAgainstTemplate([await crop("alpha.1", 600, 300)]);

  for (const part of ["word/header1.xml", "word/styles.xml"]) {
    assert.equal(
      await partText(out, part),
      await partText(source, part),
      `${part} did not survive patching`,
    );
  }
  const xml = await partText(out, "word/document.xml");
  assert.ok(xml.includes("<w:headerReference"), "the sectPr lost its header");
  assert.match(xml, /<w:pgSz[^>]*\bw:w="11901"[^>]*\bw:h="16817"/);

  // Every header field is the RUN's value, and none of the template order's.
  for (const value of [HEADER.idEpic, HEADER.namaProyek, HEADER.quote, HEADER.cc]) {
    assert.ok(xml.includes(value), `header value missing: ${value}`);
  }
  for (const value of Object.values(OLD)) {
    assert.equal(xml.includes(value), false, `template order leaked: ${value}`);
  }
  // The Gamma table's quote-numbered row label is this order's quote.
  assert.ok(
    tableRowsOf(xml).some(
      (r) => r.includes(HEADER.quote) && r.includes("{{") === false,
    ),
  );
});

test("buildDocx leaves no placeholder text anywhere in the deliverable", async () => {
  // The whole reason this path needs guarding: docx renders an unmatched
  // placeholder as the literal text "{{key}}", in a cell a validator signs.
  const out = await buildAgainstTemplate([await crop("beta.nomor", 600, 300)]);
  assert.deepEqual(await patchDetector({ data: out }), []);
  assert.equal((await partText(out, "word/document.xml")).includes("{{"), false);
});

test("buildDocx stacks both of a two-capture slot's crops in that one cell", async () => {
  // The ToP row stacks two pictures in a single cell. Keying by slot name
  // alone keeps one of them and ships a document that looks complete and is
  // missing evidence.
  const out = await buildAgainstTemplate([
    await crop("beta.top", 500, 300),
    await crop("beta.top", 500, 150),
  ]);
  const xml = await partText(out, "word/document.xml");
  const topRow = tableRowsOf(xml).find((r) => r.includes(">ToP<"));
  assert.ok(topRow, "no ToP row in the output");
  assert.equal((topRow.match(/<w:drawing>/g) ?? []).length, 2);
  // A <w:br/> between them, not a second paragraph: PatchType.PARAGRAPH is
  // what keeps the cell paragraph's own <w:pPr>.
  assert.equal((topRow.match(/<w:br\/>/g) ?? []).length, 1);

  const heights = [...topRow.matchAll(/<wp:extent[^>]*cy="(\d+)"/g)].map((m) =>
    Number(m[1]),
  );
  // 300px and 150px cut at 300 DPI are one inch and half an inch, and both
  // are 1.67in wide -- inside the 1.85in the 2880-twip cell leaves once its
  // two 108-twip margins come off -- so nothing is scaled.
  assert.deepEqual(heights, [914400, 457200]);
});

test("buildDocx caps a crop to its own table cell, not just to the page column", async () => {
  // An inline picture wider than its cell widens the table instead of being
  // shrunk, pushing it off the page. The Beta value cell declares 2880 twips
  // (2.00in) inside a 9968-twip (6.92in) text column, so a 3in crop has to
  // come out inside it with its aspect ratio intact.
  //
  // AND THE MARGINS COME OFF FIRST. `w:tcW` is the cell's TOTAL width, and a
  // picture is laid out inside the margins, so capping at the declared 2.00in
  // still overflowed the content box by Word's two default 108-twip margins
  // and widened the table -- the symptom the cap exists to prevent. 2880 -
  // 216 = 2664 twips = 1.85in.
  const out = await buildAgainstTemplate([await crop("beta.nomor", 900, 450)]);
  const xml = await partText(out, "word/document.xml");
  const nomorRow = tableRowsOf(xml).find((r) => r.includes(">Nomor<"));
  const cx = Number(nomorRow.match(/<wp:extent cx="(\d+)"/)[1]);
  const cy = Number(nomorRow.match(/<wp:extent[^>]*cy="(\d+)"/)[1]);
  assert.equal(cx, Math.round(1.85 * 914400));
  assert.ok(
    Math.abs(cy / cx - 450 / 900) < 1e-6,
    `aspect ratio drifted: ${cy / cx}`,
  );
});

test("buildDocx caps a whole-page capture to the template's own text column", async () => {
  // 2481x3507 is a true A4 page rendered at 300 DPI: 8.267in wide, against
  // the 6.9222in column the template's own pgSz/pgMar leave.
  const out = await buildAgainstTemplate([await crop("alpha.1", 2481, 3507)]);
  const xml = await partText(out, "word/document.xml");
  const cx = Number(xml.match(/<wp:extent cx="(\d+)"/)[1]);
  const usableInches = (11901 - 1026 - 907) / 1440;
  assert.ok(
    cx / 914400 <= usableInches + 0.001,
    `${(cx / 914400).toFixed(3)}in exceeds the ${usableInches.toFixed(3)}in column`,
  );
  assert.ok(cx / 914400 > usableInches - 0.01, "it was scaled further than needed");
});

test("buildDocx leaves an unfilled row and an untranscribed row blank, not missing", async () => {
  // A deliberately empty cell is the deliverable, and the Gamma table's
  // third row is one the form does not transcribe at all.
  const out = await buildAgainstTemplate([]);
  const xml = await partText(out, "word/document.xml");
  assert.equal(xml.includes("<w:drawing>"), false);
  assert.equal(xml.includes("{{"), false);
  // Three rows in Gamma, four in the header table, three in the two Beta
  // tables: every row still there.
  assert.equal(tableRowsOf(xml).length, 3 + 2 + 1 + 3);
});

// -------------------------------------------------------------------------
// The guards. Both of the failures below are silent in docx by default.
// -------------------------------------------------------------------------

test("buildDocx refuses a manifest anchor the template docx does not contain", async () => {
  // docx accepts a patch key it cannot find without a word, so the crop is
  // simply never placed and the document looks finished with a piece of
  // evidence missing.
  const { docx, manifest } = await makeDocxTemplate(await syntheticForm());
  manifest.sections[1].rows[0].key = "s1.r0.moved";
  await assert.rejects(
    () => buildDocx(FORM, HEADER, [], { docx, manifest }),
    /not in the template docx: s1\.r0\.moved/,
  );
});

test("buildDocx refuses a template placeholder no patch covers", async () => {
  // docx leaves such a placeholder in the output as literal "{{orphan}}"
  // text. Injected here rather than reached by a manifest edit, because a
  // manifest edit trips the other guard first.
  const { docx, manifest } = await makeDocxTemplate(await syntheticForm());
  const zip = await JSZip.loadAsync(docx);
  const xml = await zip.file("word/document.xml").async("string");
  zip.file(
    "word/document.xml",
    xml.replace("</w:body>", `${para(`<w:r><w:t>{{orphan}}</w:t></w:r>`)}</w:body>`),
  );
  const injected = await zip.generateAsync({ type: "uint8array" });

  await assert.rejects(
    () => buildDocx(FORM, HEADER, [], { docx: injected, manifest }),
    /have no patch: orphan/,
  );
});

test("buildDocx refuses a template whose sections do not line up with the form", async () => {
  const { docx, manifest } = await makeDocxTemplate(await syntheticForm());
  manifest.sections.pop();
  await assert.rejects(
    () => buildDocx(FORM, HEADER, [], { docx, manifest }),
    /3 sections and the "TEST" form declares 4/,
  );
});

test("buildDocx refuses a row whose label disagrees with the form's", async () => {
  // Rows are paired by position, so one row inserted or removed upstream
  // would put every crop after it one row off -- and open cleanly in Word.
  const { docx, manifest } = await makeDocxTemplate(await syntheticForm());
  manifest.sections[1].rows[0].label = "Nomer";
  await assert.rejects(
    () => buildDocx(FORM, HEADER, [], { docx, manifest }),
    /the form calls it "Nomor" and the template's row reads "Nomer"/,
  );
});

test("buildDocx refuses a template heading that is not this form's section", async () => {
  const { docx, manifest } = await makeDocxTemplate(await syntheticForm());
  manifest.sections[0].heading = "BA Permintaan";
  await assert.rejects(
    () => buildDocx(FORM, HEADER, [], { docx, manifest }),
    /the template's heading here reads "BA Permintaan"/,
  );
});

test("buildDocx refuses a crop whose key names no slot in the form", async () => {
  // A crop that goes nowhere is missing evidence in a document that looks
  // complete -- the same failure SlotDef.crops exists to prevent.
  const stray = await crop("alpha.2", 600, 300);
  await assert.rejects(
    () => buildAgainstTemplate([stray]),
    /name no slot in the "TEST" form and would go nowhere: alpha\.2/,
  );
});

test("buildDocx refuses a manifest written by a different version of the prep script", async () => {
  const { docx, manifest } = await makeDocxTemplate(await syntheticForm());
  manifest.version = TEMPLATE_MANIFEST_VERSION + 1;
  await assert.rejects(
    () => buildDocx(FORM, HEADER, [], { docx, manifest }),
    /manifest is version \d+; this build reads version/,
  );
});

test("buildDocx without a template still builds the document it always did", async () => {
  // The operator UI calls the three-argument form, and there is no
  // committable template to give it. This pins that the added parameter is
  // optional in fact and not only in type.
  const out = await buildDocx(FORM, HEADER, [await crop("alpha.1", 600, 300)]);
  const xml = await partText(out, "word/document.xml");
  assert.ok(xml.includes("Alpha"));
  assert.ok(xml.includes(HEADER.idEpic));
  assert.equal((xml.match(/<w:drawing>/g) ?? []).length, 1);
});
