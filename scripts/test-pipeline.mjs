import assert from "node:assert/strict";
import test from "node:test";
import { makePdf } from "./fixtures/pdf.mjs";

const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

test("makePdf produces a PDF pdf.js can open, with the requested rotation", async () => {
  const bytes = makePdf({
    width: 400,
    height: 200,
    rotate: 270,
    content: "0 0 0 rg 10 10 50 20 re f",
  });

  const doc = await getDocument({ data: bytes }).promise;
  assert.equal(doc.numPages, 1);

  const page = await doc.getPage(1);
  assert.equal(page.rotate, 270);
  assert.deepEqual(page.view, [0, 0, 400, 200]);
});

import { createCanvas } from "@napi-rs/canvas";
import { renderPageUpright } from "../src/lib/pipeline/render.ts";

const nodeContext = (w, h) => createCanvas(w, h).getContext("2d");

test("renderPageUpright swaps the axes for a 270-rotated page", async () => {
  // Landscape MediaBox, rotated to display as portrait, with a black bar
  // along the PDF-space bottom-left.
  const bytes = makePdf({
    width: 400,
    height: 200,
    rotate: 270,
    content: "0 0 0 rg 0 0 40 200 re f",
  });
  const doc = await getDocument({ data: bytes }).promise;
  const page = await doc.getPage(1);

  const out = await renderPageUpright(page, 72, nodeContext);

  // 270 rotation turns the 400x200 box into a 200x400 upright image.
  assert.equal(out.width, 200);
  assert.equal(out.height, 400);

  const pixel = (x, y) => out.data[(y * out.width + x) * 4];
  // /Rotate 270 maps the PDF-space LEFT edge to the BOTTOM of the upright
  // image. Measured: column x=100 is white for rows 0..359, black for 360..399.
  assert.ok(pixel(100, 390) < 40, "expected dark pixel near the bottom");
  assert.ok(pixel(100, 10) > 200, "expected light pixel near the top");
});

import {
  groupWordsIntoLines,
  unionBoxes,
  padBox,
  boxForLineRange,
} from "../src/lib/pipeline/geometry.ts";

const word = (text, x, y, w = 20, h = 10) => ({ text, box: { x, y, w, h } });

test("groupWordsIntoLines groups by vertical overlap, orders by x", () => {
  const lines = groupWordsIntoLines([
    word("world", 40, 10),
    word("Hello", 10, 12),
    word("second", 10, 60),
  ]);

  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "Hello world");
  assert.equal(lines[0].i, 0);
  assert.equal(lines[1].text, "second");
  assert.equal(lines[1].i, 1);
});

test("groupWordsIntoLines keeps near-baseline jitter on one line", () => {
  // Scanned text is never pixel-aligned; a 2px drift must not split a line.
  const lines = groupWordsIntoLines([word("a", 10, 10), word("b", 40, 12)]);
  assert.equal(lines.length, 1);
});

test("unionBoxes spans every input", () => {
  assert.deepEqual(
    unionBoxes([
      { x: 10, y: 10, w: 10, h: 10 },
      { x: 50, y: 30, w: 10, h: 10 },
    ]),
    { x: 10, y: 10, w: 50, h: 30 },
  );
});

test("padBox never escapes its bounds", () => {
  const bounds = { x: 0, y: 0, w: 100, h: 100 };
  assert.deepEqual(padBox({ x: 5, y: 5, w: 10, h: 10 }, 20, bounds), {
    x: 0,
    y: 0,
    w: 35,
    h: 35,
  });
});

test("boxForLineRange is inclusive of both endpoints", () => {
  const lines = groupWordsIntoLines([
    word("one", 10, 10),
    word("two", 10, 40),
    word("three", 10, 70),
  ]);
  const box = boxForLineRange(lines, 0, 1, 0, { x: 0, y: 0, w: 200, h: 200 });
  assert.deepEqual(box, { x: 10, y: 10, w: 20, h: 40 });
});

test("boxForLineRange throws on a reversed or out-of-range span", () => {
  const lines = groupWordsIntoLines([word("one", 10, 10)]);
  const bounds = { x: 0, y: 0, w: 200, h: 200 };
  assert.throws(() => boxForLineRange(lines, 1, 0, 0, bounds));
  assert.throws(() => boxForLineRange(lines, 0, 9, 0, bounds));
});

test("groupWordsIntoLines does not chain non-overlapping lines through a bridging word", () => {
  // A (y0-10) and C (y16-26) do not overlap at all; B (y8-18) overlaps both
  // by only 2px, well under half of any of their 10px heights. A tolerance
  // that compounds as a row grows would fuse all three into one line.
  const lines = groupWordsIntoLines([
    word("A", 10, 0, 20, 10),
    word("B", 40, 8, 20, 10),
    word("C", 70, 16, 20, 10),
  ]);
  assert.equal(lines.length, 3);
});

test("groupWordsIntoLines joins a tall ascender that half-overlaps the line band", () => {
  const lines = groupWordsIntoLines([
    word("T", 10, 95, 20, 20), // y95-115
    word("rest", 40, 100, 20, 10), // y100-110 band; overlap 10 >= 0.5*10
  ]);
  assert.equal(lines.length, 1);
});

test("groupWordsIntoLines joins a small comma sitting inside the line band", () => {
  const lines = groupWordsIntoLines([
    word("word", 10, 100, 20, 10), // y100-110 band
    word(",", 40, 106, 20, 4), // y106-110; overlap 4 >= 0.5*4
  ]);
  assert.equal(lines.length, 1);
});

test("padBox clamps a negative pad to a zero-size box instead of going negative", () => {
  const bounds = { x: 0, y: 0, w: 100, h: 100 };
  assert.deepEqual(padBox({ x: 10, y: 10, w: 4, h: 4 }, -10, bounds), {
    x: 20,
    y: 20,
    w: 0,
    h: 0,
  });
});

import { ocrToLines } from "../src/lib/pipeline/ocr.ts";

test("ocrToLines reads rendered text back with plausible boxes", async () => {
  const canvas = createCanvas(600, 200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 600, 200);
  ctx.fillStyle = "black";
  ctx.font = "48px sans-serif";
  ctx.fillText("PERJANJIAN", 20, 80);
  ctx.fillText("KERJASAMA", 20, 150);

  const rendered = {
    data: ctx.getImageData(0, 0, 600, 200).data,
    width: 600,
    height: 200,
  };

  // Explicit local paths, because BROWSER_ASSETS in ocr.ts is only applied
  // when `typeof window !== "undefined"`. An empty assets object under Node
  // would leave tesseract.js on its CDN defaults, which is exactly the
  // third-party fetch this project forbids -- and would make this test
  // silently depend on network access. `pnpm vendor:ocr` must have already
  // populated public/tesseract for this to read anything.
  //
  // cacheMethod: "none" because tesseract.js otherwise decompresses
  // eng.traineddata.gz once and writes the ~5MB result to process.cwd() as
  // eng.traineddata, then reads THAT on every later run. Without disabling
  // it, a second test run passes from that stray cache even if the vendored
  // langPath is broken or missing, which defeats the point of this test.
  const lines = await ocrToLines(rendered, "eng", {
    langPath: "./public/tesseract",
    gzip: true,
    cacheMethod: "none",
  });

  assert.ok(lines.length >= 2, `expected 2+ lines, got ${lines.length}`);
  const text = lines.map((l) => l.text).join(" ").toUpperCase();
  assert.ok(text.includes("PERJANJIAN"), `missing word in: ${text}`);
  // Boxes must be inside the image, or every downstream crop is wrong.
  for (const line of lines) {
    assert.ok(line.box.x >= 0 && line.box.x + line.box.w <= 600);
    assert.ok(line.box.y >= 0 && line.box.y + line.box.h <= 200);
  }
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ocrToWords } from "../src/lib/pipeline/ocr.ts";

test("ocrToWords times out with an actionable error instead of hanging when worker init cannot complete", async () => {
  // tesseract.js@7.0.0's own createWorker() swallows a loadLanguage failure
  // in a bare `.catch(() => {})` deep inside its init chain, so a bad
  // langPath does not reject -- it hangs forever with no error and no
  // exception. Reproduce that exact failure mode against a fresh, empty temp
  // directory rather than public/tesseract: a test that empties or mutates
  // the real vendored assets is fragile and could leave the repo broken if
  // it failed partway through.
  const dir = await mkdtemp(join(tmpdir(), "ocr-bad-langpath-"));
  const rendered = {
    data: new Uint8ClampedArray(4 * 4 * 4),
    width: 4,
    height: 4,
  };

  try {
    await assert.rejects(
      () =>
        ocrToWords(rendered, "eng", {
          langPath: dir,
          gzip: true,
          // Without this, a stray decompressed cache from an earlier test
          // run (see the cacheMethod note above) could satisfy the load
          // from process.cwd() and this bad langPath would never be
          // consulted at all, silently defeating the test.
          cacheMethod: "none",
          initTimeoutMs: 300,
        }),
      (err) => {
        assert.ok(err instanceof Error);
        // Actionable, not a bare "timeout": names the configured timeout,
        // that OCR assets/langPath are the likely cause, and the fix.
        assert.match(err.message, /300ms/);
        assert.match(err.message, /langPath/);
        assert.match(err.message, /pnpm vendor:ocr/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a timed-out init does not close a concurrent, healthy call's worker channel", async () => {
  // Regression test for a real bug: the leak guard above diffs
  // process._getActiveHandles() before/after ONE createWorker() call to
  // find the handle that call spawned. Without serialising worker init
  // (see initQueue/serialize in ocr.ts), a second call's worker can spawn
  // its own MessagePort while a first call's diff window is still open --
  // so a timing-out first call sees the second call's healthy handle as
  // "new" and closes it, hanging the second call forever even though
  // nothing was wrong with it.
  //
  // This is deterministic, not a timing race: ocrToWords() is called
  // synchronously here, back to back, with no await between the two calls.
  // ocr.ts's module-level init queue is a plain promise chain updated
  // synchronously on each call, so which call enters the queue first is
  // fixed by JS's single-threaded execution order, not by how fast either
  // worker actually spawns. The bad call is queued first and always
  // finishes (by timing out) before the good call's own init begins.
  const badDir = await mkdtemp(join(tmpdir(), "ocr-concurrent-bad-langpath-"));

  const tinyImage = { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 };

  const canvas = createCanvas(300, 100);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 300, 100);
  ctx.fillStyle = "black";
  ctx.font = "32px sans-serif";
  ctx.fillText("HELLO", 10, 60);
  const goodRendered = {
    data: ctx.getImageData(0, 0, 300, 100).data,
    width: 300,
    height: 100,
  };

  try {
    const badCall = ocrToWords(tinyImage, "eng", {
      langPath: badDir,
      gzip: true,
      cacheMethod: "none",
      initTimeoutMs: 50,
    });
    // Fired immediately, with no await in between: this call's init is
    // queued directly behind the bad call's, not run concurrently with it.
    const goodCall = ocrToWords(goodRendered, "eng", {
      langPath: "./public/tesseract",
      gzip: true,
      cacheMethod: "none",
    });

    const [badResult, goodResult] = await Promise.allSettled([badCall, goodCall]);

    assert.equal(badResult.status, "rejected");
    assert.match(badResult.reason.message, /did not settle within 50ms/);

    // The regression this guards against: if the bad call's timeout closed
    // the good call's MessagePort instead of its own, this would either
    // fail (goodResult rejected) or never get here at all (the process
    // would hang, per the original report).
    assert.equal(goodResult.status, "fulfilled");
    assert.ok(goodResult.value.length > 0, "expected the healthy call to recognize at least one word");
  } finally {
    await rm(badDir, { recursive: true, force: true });
  }
});

import { classifyPages, buildClassifyPrompt } from "../src/lib/pipeline/classify.ts";

const pages = [
  { index: 0, head: "PERJANJIAN KERJASAMA BERLANGGANAN" },
  { index: 1, head: "lanjutan pasal 2" },
  { index: 2, head: "SURAT PENUNJUKAN (SP)" },
];

test("buildClassifyPrompt sends text only, never an image", () => {
  const prompt = buildClassifyPrompt(pages);
  assert.ok(prompt.includes("PERJANJIAN KERJASAMA"));
  assert.ok(prompt.includes("page 0"));
  assert.ok(!/base64|image|data:/i.test(prompt));
});

test("classifyPages parses spans from the model reply", async () => {
  const ask = async () =>
    '```json\n{"spans":[{"docType":"KB","fromPage":0,"toPage":1},' +
    '{"docType":"SP","fromPage":2,"toPage":2}]}\n```';

  assert.deepEqual(await classifyPages(pages, ask), [
    { docType: "KB", fromPage: 0, toPage: 1 },
    { docType: "SP", fromPage: 2, toPage: 2 },
  ]);
});

test("classifyPages rejects a span outside the page range", async () => {
  const ask = async () => '{"spans":[{"docType":"KB","fromPage":0,"toPage":99}]}';
  await assert.rejects(() => classifyPages(pages, ask), /toPage/);
});

test("classifyPages rejects an unparseable reply", async () => {
  await assert.rejects(() => classifyPages(pages, async () => "no idea"));
});

test("classifyPages rejects overlapping spans", async () => {
  const ask = async () =>
    '{"spans":[{"docType":"KB","fromPage":0,"toPage":1},' +
    '{"docType":"SP","fromPage":1,"toPage":2}]}';
  await assert.rejects(() => classifyPages(pages, ask), /page 1 covered 2 times/);
});

test("classifyPages rejects duplicate spans", async () => {
  const ask = async () =>
    '{"spans":[{"docType":"KB","fromPage":0,"toPage":1},' +
    '{"docType":"KB","fromPage":0,"toPage":1}]}';
  await assert.rejects(
    () => classifyPages(pages, ask),
    /page 0 covered 2 times, page 1 covered 2 times/,
  );
});

test("classifyPages rejects a gap that orphans a page", async () => {
  const ask = async () =>
    '{"spans":[{"docType":"KB","fromPage":0,"toPage":0},' +
    '{"docType":"SP","fromPage":2,"toPage":2}]}';
  await assert.rejects(() => classifyPages(pages, ask), /page 1 not covered/);
});

test("classifyPages rejects an empty spans array", async () => {
  const ask = async () => '{"spans":[]}';
  await assert.rejects(
    () => classifyPages(pages, ask),
    /page 0 not covered, page 1 not covered, page 2 not covered/,
  );
});

import { locateSlot, buildLocatePrompt, CROP_PADDING_PX } from "../src/lib/pipeline/locate.ts";

const ocrPage = (index, texts) => ({
  index,
  width: 500,
  height: 500,
  lines: groupWordsIntoLines(
    texts.map((t, n) => ({ text: t, box: { x: 10, y: 10 + n * 30, w: 200, h: 20 } })),
  ),
});

const kbPage = ocrPage(0, [
  "PERJANJIAN KERJASAMA BERLANGGANAN",
  "Nomor : 04/0044-PKS/PFA-PM1",
  "Pada hari ini Jumat tanggal Dua Puluh Enam",
]);

test("buildLocatePrompt numbers every line and names the slot", () => {
  const prompt = buildLocatePrompt("Tanggal", "the date the contract was signed", [kbPage]);
  assert.ok(prompt.includes("Tanggal"));
  assert.ok(prompt.includes("the date the contract was signed"));
  assert.ok(prompt.includes("0: PERJANJIAN KERJASAMA BERLANGGANAN"));
  assert.ok(prompt.includes("2: Pada hari ini Jumat"));
});

test("locateSlot turns a line range into a padded box", async () => {
  const ask = async () =>
    '{"pageIndex":0,"from":2,"to":2,"confidence":"high"}';

  const result = await locateSlot("Tanggal", "the signing date", [kbPage], ask);

  assert.equal(result.zone.pageIndex, 0);
  assert.deepEqual(result.zone.lineRange, [2, 2]);
  assert.ok(result.text.includes("Pada hari ini Jumat"));
  // Line 2 sits at y=70 h=20; padding expands it symmetrically.
  assert.equal(result.zone.box.y, 70 - CROP_PADDING_PX);
  assert.equal(result.zone.box.h, 20 + CROP_PADDING_PX * 2);
});

test("locateSlot returns null when the model finds nothing", async () => {
  const ask = async () => '{"pageIndex":null,"from":null,"to":null,"confidence":"low"}';
  assert.equal(await locateSlot("MOM", "meeting minutes", [kbPage], ask), null);
});

test("locateSlot rejects a page index it was never given", async () => {
  const ask = async () => '{"pageIndex":7,"from":0,"to":0,"confidence":"high"}';
  await assert.rejects(() => locateSlot("Tanggal", "x", [kbPage], ask), /pageIndex/);
});

// Regression coverage for the task-7 finding: a pool whose first page is not
// page 0 (e.g. the Surat Penunjukan's [23, 24, 25, 26]) must still be
// labeled starting from "page 0" in the prompt, and a reply's pageIndex must
// map back to the page's true index, never be compared against it directly.

const farPage1 = ocrPage(23, ["SURAT PENUNJUKAN", "Nomor : 03/1802-3/PFA"]);
const farPage2 = ocrPage(24, ["Menerima dan menyetujui", "Dedy Mardhianto"]);

test("buildLocatePrompt numbers pages by position in the list, not by their true index", () => {
  const prompt = buildLocatePrompt("SP", "the appointment letter", [farPage1, farPage2]);
  assert.ok(prompt.includes("--- page 0 ---"));
  assert.ok(prompt.includes("--- page 1 ---"));
  assert.ok(!prompt.includes("--- page 23 ---"));
  assert.ok(!prompt.includes("--- page 24 ---"));
});

test("locateSlot maps a reply's list-position pageIndex back to the page's true index", async () => {
  const ask = async () => '{"pageIndex":0,"from":1,"to":1,"confidence":"high"}';
  const result = await locateSlot("SP", "the reference number", [farPage1, farPage2], ask);
  assert.equal(result.zone.pageIndex, 23);
  assert.deepEqual(result.zone.lineRange, [1, 1]);
});

test("locateSlot resolves a later list position to that page's true index", async () => {
  const ask = async () => '{"pageIndex":1,"from":1,"to":1,"confidence":"high"}';
  const result = await locateSlot("SP TTD", "the signature block", [farPage1, farPage2], ask);
  assert.equal(result.zone.pageIndex, 24);
  assert.deepEqual(result.zone.lineRange, [1, 1]);
});

import { AO_TEMPLATE } from "../src/lib/forms/template.ts";

test("AO template lists the sample's sections in order", () => {
  assert.deepEqual(
    AO_TEMPLATE.sections.map((s) => s.title),
    ["BA Permintaan", "SP", "KB", "KB (lanjutan)", "Konfigurasi (Excel dari EPIC)",
     "Konfigurasi", "Email", "MOM", "BA Splitting", "SBR Pricing", "BASO",
     "BA Penjelasan Order"],
  );
});

test("AO template keeps the sample's empty sections", () => {
  const splitting = AO_TEMPLATE.sections.find((s) => s.title === "BA Splitting");
  assert.deepEqual(
    splitting.slots.map((s) => s.label),
    ["Nomor", "Detail Kontrak", "Detail Splitting", "TTD Pejabat"],
  );
  assert.ok(splitting.slots.every((s) => !s.fillable));
});

test("exactly eleven slots are fillable from PDFs in v1", () => {
  const fillable = AO_TEMPLATE.sections.flatMap((s) =>
    s.slots.filter((x) => x.fillable),
  );
  assert.equal(fillable.length, 11);
});

test("the KB table splits in two as the sample does", () => {
  const kb = AO_TEMPLATE.sections.find((s) => s.title === "KB");
  const cont = AO_TEMPLATE.sections.find((s) => s.title === "KB (lanjutan)");
  assert.deepEqual(kb.slots.map((s) => s.label),
    ["Nomor", "Para Pihak", "Tanggal", "Jangka Waktu"]);
  assert.deepEqual(cont.slots.map((s) => s.label),
    ["Detail", "ToP", "TTD Pejabat"]);
});

test("the xlsx row list holds the sample's 34 data rows", () => {
  // The sample sheet is 35 rows: one header, then 34 data rows. The header is
  // emitted by the exporter, so the template carries data rows only.
  assert.equal(AO_TEMPLATE.xlsxRows.length, 34);
  assert.equal(AO_TEMPLATE.xlsxRows[0].itemI, "Lead");
  assert.equal(AO_TEMPLATE.xlsxRows[0].itemII, "Description");
  assert.equal(AO_TEMPLATE.xlsxRows[0].keterangan, "Isi");
});

test("EPIC-only xlsx rows carry no fieldKey, so nothing can fill them", () => {
  const byItemII = (name) =>
    AO_TEMPLATE.xlsxRows.find((r) => r.itemII === name);
  for (const name of ["Customer Account", "Billing Account", "Sales Team",
                      "LatLong"]) {
    assert.equal(byItemII(name).fieldKey, undefined, `${name} must stay blank`);
  }
});

// Task 8 fix round 1: the sample's KB (lanjutan) "ToP" row stacks two images
// (rId17 -> image9.png, rId18 -> image10.png) in a single table cell. A
// SlotDef with no crop count can only ever back one PNG per slot, so the
// exporter would silently drop the second capture. `crops` makes that
// multiplicity explicit and defaults to 1 so every other slot's meaning is
// unchanged.

const findSlot = (key) =>
  AO_TEMPLATE.sections.flatMap((s) => s.slots).find((s) => s.key === key);

test("kbLanjutan.top reports 2 crops, matching the sample's stacked images", () => {
  assert.equal(findSlot("kbLanjutan.top").crops, 2);
});

test("every other fillable slot reports 1 crop", () => {
  // crops is optional and defaults to 1 when absent -- reading through that
  // default (crops ?? 1) is the contract, not a literal field on every slot.
  const others = AO_TEMPLATE.sections
    .flatMap((s) => s.slots)
    .filter((s) => s.fillable && s.key !== "kbLanjutan.top");
  assert.ok(others.length > 0);
  for (const slot of others) {
    assert.equal(slot.crops ?? 1, 1, `${slot.key} should report 1 crop`);
  }
});

test("fillable slots total 12 crops across 11 slots", () => {
  const fillable = AO_TEMPLATE.sections.flatMap((s) =>
    s.slots.filter((x) => x.fillable),
  );
  assert.equal(fillable.length, 11);
  const totalCrops = fillable.reduce((sum, s) => sum + (s.crops ?? 1), 0);
  assert.equal(totalCrops, 12);
});

import JSZip from "jszip";
import { cropToPng } from "../src/lib/export/crop.ts";
import { buildDocx } from "../src/lib/export/docx.ts";

const AO_HEADER = {
  idEpic: "LOP999001",
  namaProyek: "PSB VPN IP KCP Contoh",
  quote: "1-70000000001",
  cc: "BANK CONTOH NUSANTARA",
  order: "",
  jenisOrder: "AO",
};

const documentXml = async (bytes) => {
  const zip = await JSZip.loadAsync(bytes);
  return await zip.file("word/document.xml").async("string");
};

/**
 * Splits on the row start tag only: `<w:trPr>` shares the `<w:tr` prefix, so
 * the delimiter has to demand a space or `>` after it.
 */
const tableRows = (xml) =>
  xml
    .split(/<w:tr[\s>]/)
    .slice(1)
    .map((chunk) => chunk.split("</w:tr>")[0]);

test("cropToPng extracts exactly the requested rectangle", async () => {
  const canvas = createCanvas(100, 100);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 100, 100);
  ctx.fillStyle = "black";
  ctx.fillRect(20, 20, 10, 10);

  const rendered = {
    data: ctx.getImageData(0, 0, 100, 100).data,
    width: 100,
    height: 100,
  };

  const png = await cropToPng(rendered, { x: 20, y: 20, w: 10, h: 10 });
  assert.ok(png.length > 0);
  // PNG magic, so a caller cannot mistake raw pixels for an encoded image.
  assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

  // IHDR carries width then height at bytes 16-23, so the encoded size is
  // checkable without a PNG decoder. Without this the test name's promise --
  // "exactly the requested rectangle" -- is not actually asserted, and a crop
  // that returned the whole page would still pass.
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(view.getUint32(16), 10);
  assert.equal(view.getUint32(20), 10);
});

test("cropToPng copies the requested pixels, not just the requested size", async () => {
  // Proven regression: reading column 0 instead of column x for every row
  // (i.e. `((y + row) * page.width) * 4` instead of `((y + row) *
  // page.width + x) * 4`) leaves every other assertion in this file green
  // -- the crop comes back correctly sized and completely wrong. Only
  // decoding actual pixels catches it.
  const canvas = createCanvas(100, 100);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 100, 100);
  ctx.fillStyle = "black";
  ctx.fillRect(20, 20, 10, 10);

  const rendered = {
    data: ctx.getImageData(0, 0, 100, 100).data,
    width: 100,
    height: 100,
  };

  const { inflateSync } = await import("node:zlib");
  const redAt = (png, w, x, y) => {
    let offset = 8;
    let idat;
    while (offset < png.length) {
      const length = new DataView(
        png.buffer,
        png.byteOffset + offset,
        4,
      ).getUint32(0);
      const type = String.fromCharCode(
        ...png.slice(offset + 4, offset + 8),
      );
      const dataStart = offset + 8;
      if (type === "IDAT") {
        idat = png.slice(dataStart, dataStart + length);
        break;
      }
      offset = dataStart + length + 4;
    }
    const raw = inflateSync(idat);
    const stride = w * 4 + 1;
    return raw[y * stride + 1 + x * 4];
  };

  // The crop of the black square must actually be black at its centre.
  const blackCrop = await cropToPng(rendered, { x: 20, y: 20, w: 10, h: 10 });
  assert.equal(redAt(blackCrop, 10, 5, 5), 0);

  // A crop of a known blank region of the same fixture must come back
  // white -- catches a crop that returns a fixed (e.g. column-0) rectangle
  // regardless of which box was requested.
  const whiteCrop = await cropToPng(rendered, { x: 60, y: 60, w: 10, h: 10 });
  assert.equal(redAt(whiteCrop, 10, 5, 5), 255);
});

test("cropToPng throws on a box that escapes the page", async () => {
  // geometry.padBox already clamps, so an out-of-bounds box here means a
  // caller skipped it. Reading past the row end would silently wrap onto the
  // next scanline and produce a sheared image instead of an error.
  const canvas = createCanvas(20, 20);
  const ctx = canvas.getContext("2d");
  const rendered = {
    data: ctx.getImageData(0, 0, 20, 20).data,
    width: 20,
    height: 20,
  };

  await assert.rejects(
    () => cropToPng(rendered, { x: 15, y: 0, w: 10, h: 10 }),
    /escapes page/,
  );
  await assert.rejects(
    () => cropToPng(rendered, { x: 0, y: 0, w: 0, h: 10 }),
    /empty crop/,
  );
});

test("buildDocx emits every section, including the empty ones", async () => {
  const bytes = await buildDocx(AO_TEMPLATE, AO_HEADER, []);

  const xml = await documentXml(bytes);

  for (const title of ["BA Permintaan", "SP", "KB", "MOM", "BASO",
                       "BA Penjelasan Order"]) {
    assert.ok(xml.includes(title), `missing section: ${title}`);
  }
  assert.ok(xml.includes("LOP999001"));
  // The quote number is a row label in the Konfigurasi table, not just header.
  assert.ok(xml.includes("1-70000000001"));
  // The literal token must not survive into the deliverable.
  assert.ok(!xml.includes("{{quote}}"));
});

test("buildDocx keeps a row for every unfilled table slot", async () => {
  // The six EPIC/spreadsheet slots and the BA Splitting / SBR Pricing rows
  // ship with an EMPTY right cell on purpose: that cell is where the operator
  // pastes. Dropping the row would ship a document that looks finished.
  const bytes = await buildDocx(AO_TEMPLATE, AO_HEADER, []);
  const xml = await documentXml(bytes);

  for (const label of ["SID", "Konfigurasi", "Price &amp; SA", "BW", "BA",
                       "Detail Kontrak", "Detail Splitting",
                       "Nomor dan tanggal (tidak ada)", "Diskon ke CC"]) {
    assert.ok(
      tableRows(xml).some((row) => row.includes(label)),
      `missing row: ${label}`,
    );
  }

  const tableSlots = AO_TEMPLATE.sections
    .filter((s) => s.layout === "table")
    .flatMap((s) => s.slots).length;
  // Three header rows plus one row per table slot, and nothing else.
  assert.equal(tableRows(xml).length, 3 + tableSlots);
  // Nothing was filled, so no picture may appear anywhere.
  assert.equal(xml.includes("<w:drawing>"), false);
});

test("buildDocx writes real png media parts at their true size", async () => {
  // Guards two defects the section test cannot see: a missing ImageRun `type`
  // silently produces word/media/<hash>.undefined, and a points-vs-pixels
  // mixup silently shrinks every crop to 75%.
  const canvas = createCanvas(600, 300);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 600, 300);
  const png = await cropToPng(
    { data: ctx.getImageData(0, 0, 600, 300).data, width: 600, height: 300 },
    { x: 0, y: 0, w: 600, h: 300 },
  );

  const bytes = await buildDocx(
    AO_TEMPLATE,
    { ...AO_HEADER, namaProyek: "P", cc: "C" },
    [{ key: "ba.permintaan", png, widthPx: 600, heightPx: 300 }],
  );

  const zip = await JSZip.loadAsync(bytes);
  const media = Object.keys(zip.files).filter(
    (f) => f.startsWith("word/media/") && !zip.files[f].dir,
  );
  assert.ok(media.length > 0, "no media part written");
  assert.ok(media.every((f) => f.endsWith(".png")), `bad media: ${media}`);

  const xml = await zip.file("word/document.xml").async("string");
  const cx = Number(xml.match(/<wp:extent cx="(\d+)"/)[1]);
  // 914400 EMU per inch. A 600px crop cut at 300 DPI is 2 inches wide.
  assert.equal(Math.round((cx / 914400) * 1000), 2000);
});

test("buildDocx sets the sample's own page size and margins", async () => {
  // The sample's word/document.xml sectPr, read directly out of
  // documents/Form_Validasi_LOP999001_1-70000000001-contohvpn (2).docx:
  // <w:pgSz w:w="11901" w:h="16817"/>
  // <w:pgMar w:top="873" w:right="907" w:bottom="941" w:left="1026" .../>
  // Without this the section inherits docx's own A4 default instead of the
  // document being reproduced.
  const xml = await documentXml(await buildDocx(AO_TEMPLATE, AO_HEADER, []));

  assert.match(xml, /<w:pgSz[^>]*\bw:w="11901"[^>]*\bw:h="16817"/);
  assert.match(
    xml,
    /<w:pgMar[^>]*\bw:top="873"[^>]*\bw:right="907"[^>]*\bw:bottom="941"[^>]*\bw:left="1026"/,
  );
});

test("buildDocx shrinks a crop wider than the usable column instead of letting Word clip it", async () => {
  // A whole-page capture at 300 DPI (2481x3507, true A4) renders past the
  // usable column -- 8.267in cut from an 8.267in-wide page, into a column
  // the sample's own 1026/907-twip margins narrow to about 6.92in. docx does
  // not shrink an oversized inline image, so the excess used to run off the
  // page. This asserts the fix rather than eyeballing a screenshot: the
  // extent must land at or under the usable column, and the crop's aspect
  // ratio must survive the scale-down.
  const canvas = createCanvas(10, 10);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 10, 10);
  const png = await cropToPng(
    { data: ctx.getImageData(0, 0, 10, 10).data, width: 10, height: 10 },
    { x: 0, y: 0, w: 10, h: 10 },
  );

  const widthPx = 2481;
  const heightPx = 3507;
  const bytes = await buildDocx(AO_TEMPLATE, AO_HEADER, [
    { key: "ba.permintaan", png, widthPx, heightPx },
  ]);

  const xml = await documentXml(bytes);
  const cx = Number(xml.match(/<wp:extent cx="(\d+)"/)[1]);
  const cy = Number(xml.match(/<wp:extent[^>]*cy="(\d+)"/)[1]);

  // 11901 - 1026 - 907 = 9968 twips = 6.9222...in usable column.
  const usableInches = (11901 - 1026 - 907) / 1440;
  assert.ok(
    cx / 914400 <= usableInches + 0.001,
    `cx ${cx} (${(cx / 914400).toFixed(3)}in) exceeds the ${usableInches.toFixed(3)}in usable column`,
  );
  // Scaled down, not just clamped to some arbitrary cap: a page this size at
  // 300 DPI would be 8.267in unscaled, well past the column, so the fix must
  // actually have fired.
  assert.ok(cx / 914400 < 8.267);
  // Aspect ratio preserved: cy/cx must still equal the crop's own
  // heightPx/widthPx, not an independently clamped height.
  const ratio = cy / cx;
  const expectedRatio = heightPx / widthPx;
  assert.ok(
    Math.abs(ratio - expectedRatio) < 1e-6,
    `aspect ratio drifted: got ${ratio}, expected ${expectedRatio}`,
  );
});

test("buildDocx stacks both of a slot's crops in that one cell", async () => {
  // kbLanjutan.top declares crops: 2 because the sample's ToP row stacks two
  // pictures in a single cell. Keying filled slots by name alone keeps only
  // one of them, which ships a document that looks complete and is missing
  // evidence.
  const solid = async (w, h) => {
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = h === 300 ? "white" : "black";
    ctx.fillRect(0, 0, w, h);
    return await cropToPng(
      { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h },
      { x: 0, y: 0, w, h },
    );
  };

  const bytes = await buildDocx(AO_TEMPLATE, AO_HEADER, [
    { key: "kbLanjutan.top", png: await solid(600, 300),
      widthPx: 600, heightPx: 300 },
    { key: "kbLanjutan.top", png: await solid(600, 150),
      widthPx: 600, heightPx: 150 },
  ]);

  const xml = await documentXml(bytes);
  const topRow = tableRows(xml).find((row) => row.includes(">ToP<"));
  assert.ok(topRow, "no ToP row in the document");

  assert.equal((topRow.match(/<w:drawing>/g) ?? []).length, 2);
  // Both crops, in the order they were supplied: 300px and 150px cut at
  // 300 DPI are one inch and half an inch.
  const heights = [...topRow.matchAll(/<wp:extent[^>]*cy="(\d+)"/g)].map((m) =>
    Number(m[1]),
  );
  assert.deepEqual(heights, [914400, 457200]);

  const zip = await JSZip.loadAsync(bytes);
  const media = Object.keys(zip.files).filter(
    (f) => f.startsWith("word/media/") && !zip.files[f].dir,
  );
  assert.equal(media.length, 2, `expected two media parts, got ${media}`);
});

test("buildDocx emits both SP pages as separate pictures", async () => {
  // An "images" section is one picture per slot, unlike the ToP cell, and SP
  // has two of them.
  const canvas = createCanvas(400, 200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 400, 200);
  const png = await cropToPng(
    { data: ctx.getImageData(0, 0, 400, 200).data, width: 400, height: 200 },
    { x: 0, y: 0, w: 400, h: 200 },
  );

  const xml = await documentXml(
    await buildDocx(AO_TEMPLATE, AO_HEADER, [
      { key: "sp.1", png, widthPx: 400, heightPx: 200 },
      { key: "sp.2", png, widthPx: 400, heightPx: 200 },
    ]),
  );

  // Both pictures land outside every table row: "images" sections are
  // paragraphs, not cells.
  assert.equal((xml.match(/<w:drawing>/g) ?? []).length, 2);
  for (const row of tableRows(xml)) {
    assert.equal(row.includes("<w:drawing>"), false);
  }
});

test("buildDocx omits a slotless table section instead of emitting an empty table", async () => {
  // A <w:tbl> with zero <w:tr> is schema-invalid and Word refuses the file.
  // The shipped AO template has no such section, but buildDocx takes a
  // Template, not this one template.
  const xml = await documentXml(
    await buildDocx(
      {
        id: "T",
        label: "T",
        sections: [{ title: "Kosong", layout: "table", slots: [] }],
        xlsxRows: [],
      },
      AO_HEADER,
      [],
    ),
  );

  assert.ok(xml.includes("Kosong"), "the heading still has to be emitted");
  // Only the header table.
  assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 1);
});

import {
  deriveIdsFromFilenames,
  extractFields,
} from "../src/lib/pipeline/fields.ts";

test("deriveIdsFromFilenames finds the LOP and quote ids", () => {
  assert.deepEqual(
    deriveIdsFromFilenames([
      "LOP999001_EXISTING_20240126_PKS_CONTOH_II_merged.pdf",
      "Form_Validasi_LOP999001_1-70000000001-contohvpn (2).docx",
    ]),
    { idEpic: "LOP999001", quote: "1-70000000001" },
  );
});

test("deriveIdsFromFilenames returns blanks rather than guessing", () => {
  assert.deepEqual(deriveIdsFromFilenames(["scan001.pdf"]), {
    idEpic: "",
    quote: "",
  });
});

test("extractFields keeps provenance and drops unbacked keys", async () => {
  const page = {
    index: 0,
    width: 500,
    height: 500,
    lines: groupWordsIntoLines([
      { text: "Nama", box: { x: 10, y: 10, w: 40, h: 12 } },
      { text: "Pelanggan", box: { x: 55, y: 10, w: 70, h: 12 } },
      { text: "PT", box: { x: 200, y: 10, w: 20, h: 12 } },
      { text: "BSI", box: { x: 225, y: 10, w: 30, h: 12 } },
    ]),
  };
  const ask = async () =>
    '{"values":[{"fieldKey":"cc","value":"PT BSI","pageIndex":0,"from":0,"to":0}]}';

  const values = await extractFields(["cc", "latLong"], [page], ask);

  assert.equal(values.length, 1);
  assert.equal(values[0].fieldKey, "cc");
  assert.deepEqual(values[0].source, { pageIndex: 0, lineRange: [0, 0] });
});

/** Two distinct OCR lines, so a reversed or out-of-range citation is
 * distinguishable from "the page doesn't have that many lines at all". */
function twoLinePage(index = 0) {
  return {
    index,
    width: 500,
    height: 500,
    lines: groupWordsIntoLines([
      { text: "Nama", box: { x: 10, y: 10, w: 40, h: 12 } },
      { text: "Pelanggan", box: { x: 55, y: 10, w: 70, h: 12 } },
      { text: "PT", box: { x: 10, y: 40, w: 20, h: 12 } },
      { text: "BSI", box: { x: 35, y: 40, w: 30, h: 12 } },
    ]),
  };
}

test("extractFields drops a citation to a page that was never offered, but keeps the value", async () => {
  // Only one page (position 0) is offered; the model cites position 5.
  const ask = async () =>
    '{"values":[{"fieldKey":"cc","value":"PT BSI","pageIndex":5,"from":0,"to":0}]}';

  const values = await extractFields(["cc"], [twoLinePage()], ask);

  assert.equal(values.length, 1);
  assert.equal(values[0].value, "PT BSI");
  assert.equal(values[0].source, undefined);
});

test("extractFields drops a reversed line range, but keeps the value", async () => {
  const ask = async () =>
    '{"values":[{"fieldKey":"cc","value":"PT BSI","pageIndex":0,"from":1,"to":0}]}';

  const values = await extractFields(["cc"], [twoLinePage()], ask);

  assert.equal(values.length, 1);
  assert.equal(values[0].value, "PT BSI");
  assert.equal(values[0].source, undefined);
});

test("extractFields drops a citation whose line range doesn't exist on the page, but keeps the value", async () => {
  // The page only has lines 0-1; the model cites up to line 5.
  const ask = async () =>
    '{"values":[{"fieldKey":"cc","value":"PT BSI","pageIndex":0,"from":0,"to":5}]}';

  const values = await extractFields(["cc"], [twoLinePage()], ask);

  assert.equal(values.length, 1);
  assert.equal(values[0].value, "PT BSI");
  assert.equal(values[0].source, undefined);
});

test("extractFields numbers its listing by position, not by the page's true document index", async () => {
  // page.index is the page's true index in the source bundle -- deep into a
  // multi-document pool, e.g. 23. The listing label for the only page
  // offered must still be "page 0", exactly locate.ts's convention: echoing
  // a caller-supplied true index back as the label is the precise ambiguity
  // that made the model answer one position off in an earlier task.
  const page = twoLinePage(23);
  let capturedPrompt;
  const ask = async (prompt) => {
    capturedPrompt = prompt;
    return '{"values":[{"fieldKey":"cc","value":"PT BSI","pageIndex":0,"from":0,"to":0}]}';
  };

  const values = await extractFields(["cc"], [page], ask);

  assert.ok(capturedPrompt.includes("--- page 0 ---"), capturedPrompt);
  assert.ok(!capturedPrompt.includes("--- page 23 ---"), capturedPrompt);
  // The returned citation stays position-based too: mapping position 0 back
  // to the page's true index (23) is the consumer's job, not this
  // function's -- see generate.mjs's extractTextFields.
  assert.deepEqual(values[0].source, { pageIndex: 0, lineRange: [0, 0] });
});

import { buildXlsx } from "../src/lib/export/xlsx.ts";
import exceljs from "exceljs";

test("buildXlsx fills only backed rows and cites their provenance", async () => {
  const bytes = await buildXlsx(AO_TEMPLATE, [
    { fieldKey: "alamat", value: "Jalan Kemanggisan Utama Raya No.49A",
      source: { pageIndex: 0, lineRange: [7, 9] } },
  ]);

  const wb = new exceljs.Workbook();
  await wb.xlsx.load(bytes);
  const sheet = wb.worksheets[0];

  // One header row plus the template's 34 data rows.
  assert.equal(sheet.rowCount, 35);

  let filled = 0;
  sheet.eachRow((row) => { if (row.getCell(5).value) filled += 1; });
  // Exactly the one backed value. Every other row, including the EPIC-only
  // ones, stays blank.
  assert.equal(filled, 1);

  const cell = sheet.getCell("E7");
  assert.ok(String(cell.value).includes("Kemanggisan"));
  assert.ok(JSON.stringify(cell.note ?? "").includes("lines 7-9"));
});

import {
  FIELD_DOC_TYPES,
  groupKeysByDocTypes,
  orderPaperworkDocTypes,
  poolForDocTypes,
  remapCitedPageIndex,
} from "./generate.mjs";

test("remapCitedPageIndex drops a citation to a pool position that was never offered", () => {
  const pool = [{ index: 23 }, { index: 24 }];

  // A position the pool actually holds maps back to that page's true index.
  assert.equal(remapCitedPageIndex(0, pool), 23);
  assert.equal(remapCitedPageIndex(1, pool), 24);

  // Position 5 doesn't exist in a two-element pool. The old
  // `pool[i]?.index ?? i` fallback returned 5 here -- the raw LOCAL position,
  // written into the workbook as if it were a bundle-global page number.
  assert.equal(remapCitedPageIndex(5, pool), undefined);
});

test("poolForDocTypes returns only the pages classified under the requested docTypes", () => {
  const byType = new Map([
    ["BAPermintaan", [3]],
    ["Email", [7]],
    ["SP", [1, 2]],
  ]);
  const pages = [];
  pages[1] = { index: 1 };
  pages[2] = { index: 2 };
  pages[3] = { index: 3 };
  pages[7] = { index: 7 };

  assert.deepEqual(
    poolForDocTypes(["BAPermintaan"], byType, pages).map((p) => p.index),
    [3],
  );
  assert.deepEqual(
    poolForDocTypes(["Email"], byType, pages).map((p) => p.index),
    [7],
  );
  // A union of docTypes merges and sorts by global index.
  assert.deepEqual(
    poolForDocTypes(["Email", "SP"], byType, pages).map((p) => p.index),
    [1, 2, 7],
  );
});

test("cc and alamat are restricted to BA Permintaan, and picContacts to Email", () => {
  // The wrong-customer bug: offering the printed Email thread's pages to
  // `cc`/`alamat` let the model match the email's own "Cc:" header line
  // instead of the customer name on the BA Permintaan.
  assert.deepEqual(FIELD_DOC_TYPES.cc, ["BAPermintaan"]);
  assert.deepEqual(FIELD_DOC_TYPES.alamat, ["BAPermintaan"]);
  assert.deepEqual(FIELD_DOC_TYPES.picContacts, ["Email"]);
});

test("groupKeysByDocTypes never gives cc/alamat the Email pool, or picContacts the BA Permintaan pool", () => {
  const defaultDocTypes = ["BAPermintaan", "SP", "Email"];
  const groups = groupKeysByDocTypes(
    ["namaProyek", "picContacts", "cc", "alamat"],
    defaultDocTypes,
  );
  const groupFor = (key) => groups.find((g) => g.keys.includes(key));

  assert.deepEqual(groupFor("cc").docTypes, ["BAPermintaan"]);
  assert.deepEqual(groupFor("alamat").docTypes, ["BAPermintaan"]);
  assert.deepEqual(groupFor("picContacts").docTypes, ["Email"]);
  assert.ok(!groupFor("cc").docTypes.includes("Email"));
  assert.ok(!groupFor("alamat").docTypes.includes("Email"));
  assert.ok(!groupFor("picContacts").docTypes.includes("BAPermintaan"));

  // namaProyek has no FIELD_DOC_TYPES entry and keeps the full default pool
  // -- a separate, known gap (it needs composing, not sourcing), not this
  // fix's scope. Dropping the Email page from its pool entirely would also
  // lose picContacts, which the sample confirms is exactly right off Email.
  assert.deepEqual(groupFor("namaProyek").docTypes, defaultDocTypes);
});

test("orderPaperworkDocTypes lists every layout:images fillable slot's docType", () => {
  assert.deepEqual(
    [...orderPaperworkDocTypes(AO_TEMPLATE)].sort(),
    ["BAPermintaan", "Email", "SP"].sort(),
  );
});

import { extractJson } from "../src/lib/pipeline/json.ts";

// extractJson was three byte-for-byte copies -- one private to classify.ts,
// one to locate.ts, one to fields.ts -- because the first was never exported.
// Hoisting it is only safe if the behaviour is pinned, because the failure it
// guards is silent: a copy that got fractionally more tolerant would hand a
// half-understood object to a Zod schema, which fills in what it can, and the
// run ships a plausible wrong rectangle or field value instead of throwing.

test("extractJson recovers JSON from the packaging models actually emit", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });

  // Prose on either side, which is the common case this exists for at all.
  assert.deepEqual(extractJson('Sure! Here it is: {"a":1} Hope that helps.'), {
    a: 1,
  });

  // A fenced block wins over the surrounding text, even when that text has
  // braces of its own -- with and without the `json` tag.
  assert.deepEqual(
    extractJson('note {ignored}\n```json\n{"a":1}\n```\ntrailing {junk}'),
    { a: 1 },
  );
  assert.deepEqual(extractJson('```\n{"a":1}\n```'), { a: 1 });

  // Nested braces: the span runs to the LAST `}`, not the first.
  assert.deepEqual(extractJson('{"a":{"b":2}}'), { a: { b: 2 } });

  // A brace inside a string value is not a delimiter. A first-balanced-object
  // scan stops at the `}` inside the string and silently truncates this one.
  assert.deepEqual(extractJson('{"a":"}{","b":1}'), { a: "}{", b: 1 });
});

test("extractJson throws rather than guessing on an ambiguous or truncated reply", () => {
  // Two objects side by side. Returning the first would be a guess about which
  // one the model meant; the whole span goes to JSON.parse, which rejects it.
  assert.throws(() => extractJson('{"a":1}\n{"b":2}'), SyntaxError);

  // Truncated mid-object: an opening brace and no closing one.
  assert.throws(() => extractJson('{"a":1'), /No JSON object in model reply/);

  // Nothing brace-shaped at all.
  assert.throws(
    () => extractJson("I could not find it."),
    /No JSON object in model reply/,
  );
  assert.throws(() => extractJson(""), /No JSON object in model reply/);

  // A closing brace before the opening one: the slice is empty, and an empty
  // string is not valid JSON either. Still a throw, never a silent `undefined`.
  assert.throws(() => extractJson('} {"a":1'), SyntaxError);
});

test("classifyPages, locateSlot and extractFields reject the same bad replies identically", async () => {
  // The drift guard the hoist exists for: one shared copy means a tolerance
  // cannot be loosened in one caller and not the others. Each of these three
  // entry points guards a different Zod schema, so this is the only place the
  // shared behaviour is observable from outside.
  const badReplies = [
    '{"spans":[', // truncated
    '{"a":1}\n{"b":2}', // two objects
    "I could not find it.", // no JSON
    '} {"a":1', // closing brace first
  ];

  for (const reply of badReplies) {
    const ask = async () => reply;
    await assert.rejects(() => classifyPages(pages, ask), `classifyPages: ${reply}`);
    await assert.rejects(
      () => locateSlot("Tanggal", "the signing date", [kbPage], ask),
      `locateSlot: ${reply}`,
    );
    await assert.rejects(
      () => extractFields(["cc"], [kbPage], ask),
      `extractFields: ${reply}`,
    );
  }
});

test("locateSlot orders the evidence text by line number, whatever order page.lines arrives in", async () => {
  // OcrPage.lines is a plain Line[] the caller supplies. groupWordsIntoLines
  // is the only producer today and emits them in `i` order, so filter-then-join
  // reads correctly by luck rather than by contract. A page assembled anywhere
  // else -- from a cache, a merge, a re-ordered subset -- breaks that luck
  // silently: the crop is still the right rectangle and the evidence text
  // beside it is scrambled, with nothing thrown to say so.
  const ordered = ocrPage(0, ["first line", "second line", "third line"]);
  const shuffledLines = [ordered.lines[2], ordered.lines[0], ordered.lines[1]];
  const shuffled = { ...ordered, lines: shuffledLines };

  const ask = async () => '{"pageIndex":0,"from":0,"to":2,"confidence":"high"}';
  const result = await locateSlot("Detail", "the block", [shuffled], ask);

  assert.equal(result.text, "first line\nsecond line\nthird line");

  // The rectangle was always order-independent (unionBoxes takes a min/max),
  // and must stay that way.
  const fromOrdered = await locateSlot("Detail", "the block", [ordered], ask);
  assert.deepEqual(result.zone.box, fromOrdered.zone.box);

  // Sorting a filtered copy, never the caller's own array.
  assert.deepEqual(shuffled.lines, shuffledLines);
  assert.deepEqual(
    shuffled.lines.map((l) => l.i),
    [2, 0, 1],
  );
});

// The compile-time half of this suite: type claims node cannot check, verified
// by `npx tsc --noEmit -p tsconfig.json`. Imported here so `pnpm test` runs its
// assertions too and the file cannot rot unnoticed.
import "./test-pipeline-types.ts";
