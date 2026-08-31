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

// ---------------------------------------------------------------------------
// Document-agnostic search, and the dokumen tambahan loop's headless
// foundation. See docs/superpowers/specs/
// 2026-08-31-corrections-and-document-agnostic.md sections 2 and 4.
// ---------------------------------------------------------------------------

import {
  inTemplateOrder,
  mergeZones,
  outstandingFields,
  outstandingSlots,
  parseArgs,
  rankedPool,
  satisfiedSlotKeys,
  searchRound,
  slotCropCount,
  templateSlots,
  withFieldHints,
} from "./generate.mjs";

/** A page carrying just what the search path reads off one. */
function fakePage(index, docName = "bundle.pdf") {
  return {
    index,
    source: 0,
    sourceName: docName,
    pageInDoc: index,
    width: 100,
    height: 200,
    lines: [{ i: 0, text: `page ${index}` }],
  };
}

/** Two sections, one of each layout, so a round exercises both branches. */
const TINY_TEMPLATE = {
  id: "TEST",
  label: "test",
  sections: [
    {
      title: "Whole pages",
      layout: "images",
      slots: [
        { key: "whole.1", label: "Whole 1", docType: "BAPermintaan",
          hint: "the whole request page", fillable: true },
        { key: "whole.2", label: "Whole 2", docType: "BAPermintaan",
          hint: "the second whole request page", fillable: true },
      ],
    },
    {
      title: "Fields",
      layout: "table",
      slots: [
        { key: "field.one", label: "One", docType: "KB", hint: "a", fillable: true },
        { key: "field.two", label: "Two", docType: "KB", hint: "b", fillable: true,
          crops: 2 },
        { key: "field.manual", label: "Manual", docType: null, hint: "c",
          fillable: false },
      ],
    },
  ],
  xlsxRows: [
    { nomor: 1, itemI: "Lead", itemII: "Description", fieldKey: "namaProyek" },
    { itemII: "Account", fieldKey: "cc" },
    { itemII: "Nothing a PDF backs" },
  ],
  fieldHints: { cc: "the customer, not an email header" },
};

const foundZone = (pageIndex) => ({
  zone: { pageIndex, box: { x: 0, y: 0, w: 10, h: 10 }, lineRange: [0, 0] },
  text: "x",
  confidence: "high",
});

test("rankedPool offers every page, with the preferred docType's pages first", () => {
  const pages = [0, 1, 2, 3].map((i) => fakePage(i));
  const byType = new Map([
    ["KB", [2, 3]],
    ["Email", [0]],
    ["BAPermintaan", [1]],
  ]);

  const pool = rankedPool(["KB"], byType, pages);

  // Ranked: the KB pages lead.
  assert.deepEqual(pool.slice(0, 2).map((p) => p.index), [2, 3]);
  // NOT narrowed: every page the round supplied is still in the pool. This is
  // the assertion that fails if the old docType filter is reintroduced -- the
  // filter is what shipped a wrong customer name, and its replacement is the
  // disambiguation in the hints, not a smaller pool.
  assert.deepEqual(
    [...pool].map((p) => p.index).sort((a, b) => a - b),
    [0, 1, 2, 3],
  );
});

test("rankedPool keeps every page when nothing was classified as the preferred type", () => {
  const pages = [0, 1].map((i) => fakePage(i));

  assert.deepEqual(
    rankedPool(["KB"], new Map(), pages).map((p) => p.index),
    [0, 1],
  );
  assert.deepEqual(
    rankedPool([null], new Map([["KB", [1]]]), pages).map((p) => p.index),
    [0, 1],
  );
});

test("searchRound offers a table slot every page, not just its docType's", async () => {
  const pages = [0, 1, 2].map((i) => fakePage(i));
  const byType = new Map([
    ["KB", [0]],
    ["Email", [1, 2]],
  ]);

  const seen = new Map();
  await searchRound({
    template: TINY_TEMPLATE,
    byType,
    pages,
    locate: async (slot, pool) => {
      seen.set(slot.key, pool.map((p) => p.index));
      return null;
    },
  });

  // Every page, KB first: the Email pages are still searchable for a KB slot.
  assert.deepEqual(seen.get("field.one"), [0, 1, 2]);
  assert.deepEqual(seen.get("field.two"), [0, 1, 2]);
});

test("searchRound reports outstanding slots as structured data, with reasons", async () => {
  const pages = [0].map((i) => fakePage(i));
  const byType = new Map([["KB", [0]]]);

  const { zones, reasons } = await searchRound({
    template: TINY_TEMPLATE,
    byType,
    pages,
    locate: async (slot) => {
      if (slot.key === "field.one") throw new Error("model exhausted its retries");
      return null;
    },
  });

  assert.deepEqual(zones, []);
  const outstanding = outstandingSlots(TINY_TEMPLATE, zones, reasons);

  // Structured, not a log line: key, label, section, counts and reason.
  assert.deepEqual(
    outstanding.map((o) => o.key).sort(),
    ["field.one", "field.two", "whole.1", "whole.2"],
  );
  for (const item of outstanding) {
    assert.equal(item.kind, "slot");
    assert.equal(typeof item.label, "string");
    assert.equal(typeof item.section, "string");
    assert.equal(item.found, 0);
    assert.ok(item.required >= 1);
    assert.ok(item.reason.length > 0);
  }

  const byKey = new Map(outstanding.map((o) => [o.key, o]));
  // The reason survives from the round that produced it, so an operator can
  // tell "the model found nothing" from "the call failed".
  assert.match(byKey.get("field.one").reason, /exhausted its retries/);
  assert.match(byKey.get("field.two").reason, /found no match/);
  // A whole-page slot whose page was never classified says which type is
  // missing rather than taking an arbitrary page.
  assert.match(byKey.get("whole.1").reason, /BAPermintaan/);
  // The non-fillable slot is not "outstanding" -- no PDF backs it at all.
  assert.equal(byKey.has("field.manual"), false);
});

test("searchRound skips slots an earlier round already satisfied", async () => {
  const pages = [0, 1].map((i) => fakePage(i));
  const byType = new Map([
    ["KB", [0]],
    ["BAPermintaan", [1]],
  ]);

  const asked = [];
  const { zones } = await searchRound({
    template: TINY_TEMPLATE,
    byType,
    pages,
    satisfied: new Set(["field.one", "whole.1"]),
    locate: async (slot) => {
      asked.push(slot.key);
      return foundZone(0);
    },
  });

  // The satisfied field slot costs no model call at all. That is the point:
  // a second document is searched only for what is still missing.
  assert.deepEqual(asked, ["field.two"]);
  assert.equal(zones.some((z) => z.key === "field.one"), false);

  // And the satisfied whole-page slot does not consume this round's first
  // BAPermintaan page: whole.2 takes it, because whole.1 was filled from an
  // earlier round's pages, not from these.
  const whole2 = zones.find((z) => z.key === "whole.2");
  assert.ok(whole2, "whole.2 should have taken the round's first BA page");
  assert.equal(whole2.pageIndex, 1);
});

test("mergeZones is additive: a later round never discards an earlier zone", () => {
  const round1 = [
    { key: "field.one", pageIndex: 3, box: {}, lineRange: [1, 2] },
    { key: "whole.1", pageIndex: 0, box: {}, lineRange: [0, 9] },
  ];
  // Round 2 proposes a different zone for a key round 1 already filled, plus
  // a genuinely new one.
  const round2 = [
    { key: "field.one", pageIndex: 99, box: {}, lineRange: [7, 8] },
    { key: "whole.2", pageIndex: 12, box: {}, lineRange: [0, 4] },
  ];

  const merged = mergeZones(round1, round2, TINY_TEMPLATE);

  // Every round-1 zone survives untouched...
  for (const zone of round1) assert.ok(merged.includes(zone));
  // ...the round-2 replacement for an already-filled single-crop slot is
  // dropped rather than overwriting it...
  assert.equal(merged.filter((z) => z.key === "field.one").length, 1);
  assert.equal(merged.find((z) => z.key === "field.one").pageIndex, 3);
  // ...and the new slot is added.
  assert.equal(merged.find((z) => z.key === "whole.2").pageIndex, 12);
});

test("mergeZones lets a later round supply the second crop of a two-crop slot", () => {
  const round1 = [{ key: "field.two", pageIndex: 1, box: {}, lineRange: [0, 1] }];
  const round2 = [{ key: "field.two", pageIndex: 5, box: {}, lineRange: [2, 3] }];
  const round3 = [{ key: "field.two", pageIndex: 9, box: {}, lineRange: [4, 5] }];

  const afterTwo = mergeZones(round1, round2, TINY_TEMPLATE);
  assert.deepEqual(afterTwo.map((z) => z.pageIndex), [1, 5]);

  // `crops: 2` is the cap, so a third round adds nothing more.
  const afterThree = mergeZones(afterTwo, round3, TINY_TEMPLATE);
  assert.deepEqual(afterThree.map((z) => z.pageIndex), [1, 5]);
});

test("satisfiedSlotKeys counts against crops, not against 'has any zone'", () => {
  const one = [{ key: "field.two", pageIndex: 1 }];
  assert.equal(satisfiedSlotKeys(TINY_TEMPLATE, one).has("field.two"), false);

  const two = [...one, { key: "field.two", pageIndex: 2 }];
  assert.equal(satisfiedSlotKeys(TINY_TEMPLATE, two).has("field.two"), true);

  // A single-crop slot is satisfied by one zone.
  assert.equal(
    satisfiedSlotKeys(TINY_TEMPLATE, [{ key: "field.one", pageIndex: 0 }]).has(
      "field.one",
    ),
    true,
  );
});

test("outstandingSlots names a half-filled two-crop slot instead of calling it done", () => {
  const zones = [
    { key: "field.one", pageIndex: 0 },
    { key: "field.two", pageIndex: 1 },
    { key: "whole.1", pageIndex: 2 },
    { key: "whole.2", pageIndex: 3 },
  ];

  const outstanding = outstandingSlots(TINY_TEMPLATE, zones);

  assert.deepEqual(outstanding.map((o) => o.key), ["field.two"]);
  assert.equal(outstanding[0].found, 1);
  assert.equal(outstanding[0].required, 2);
  assert.match(outstanding[0].reason, /1 of 2/);
});

test("outstandingFields names every backed xlsx row that came back blank", () => {
  const outstanding = outstandingFields(TINY_TEMPLATE, [
    { fieldKey: "cc", value: "BANK CONTOH NUSANTARA" },
    { fieldKey: "namaProyek", value: "   " },
  ]);

  // A whitespace-only value is blank: the workbook cell would look empty and
  // an empty cell nobody tried to fill is indistinguishable from one where
  // the evidence does not exist.
  assert.deepEqual(outstanding.map((o) => o.key), ["namaProyek"]);
  assert.equal(outstanding[0].kind, "field");
});

test("inTemplateOrder sorts by template position and keeps discovery order per key", () => {
  const zones = [
    { key: "field.two", pageIndex: 10 },
    { key: "whole.2", pageIndex: 1 },
    { key: "field.two", pageIndex: 20 },
    { key: "whole.1", pageIndex: 0 },
  ];

  assert.deepEqual(
    inTemplateOrder(zones, TINY_TEMPLATE).map((z) => [z.key, z.pageIndex]),
    [
      ["whole.1", 0],
      ["whole.2", 1],
      // Both of field.two's crops, still in the order they were found: that
      // order is the stacking order buildDocx renders.
      ["field.two", 10],
      ["field.two", 20],
    ],
  );
});

test("two rounds are additive end to end: round 2 fills only what round 1 missed", async () => {
  const template = TINY_TEMPLATE;
  const byType = new Map();
  let zones = [];
  const reasons = new Map();
  const asked = [];

  // Round 1: one BA page and one KB page. field.one is found; field.two is
  // not; whole.2 has no second BA page.
  const round1Pages = [fakePage(0, "bundle.pdf"), fakePage(1, "bundle.pdf")];
  byType.set("BAPermintaan", [0]);
  byType.set("KB", [1]);

  const r1 = await searchRound({
    template,
    byType,
    pages: round1Pages,
    satisfied: satisfiedSlotKeys(template, zones),
    locate: async (slot) => {
      asked.push(`r1:${slot.key}`);
      return slot.key === "field.one" ? foundZone(1) : null;
    },
  });
  for (const [key, reason] of r1.reasons) reasons.set(key, reason);
  zones = mergeZones(zones, r1.zones, template);

  assert.deepEqual(asked, ["r1:field.one", "r1:field.two"]);
  assert.deepEqual(
    outstandingSlots(template, zones, reasons).map((o) => o.key).sort(),
    ["field.two", "whole.2"],
  );

  // Round 2: the dokumen tambahan, one more BA page. It is searched only for
  // the outstanding slots.
  const round2Pages = [fakePage(2, "tambahan.pdf")];
  byType.set("BAPermintaan", [0, 2]);

  const r2 = await searchRound({
    template,
    byType,
    pages: round2Pages,
    satisfied: satisfiedSlotKeys(template, zones),
    locate: async (slot) => {
      asked.push(`r2:${slot.key}`);
      return foundZone(2);
    },
  });
  for (const [key, reason] of r2.reasons) reasons.set(key, reason);
  zones = mergeZones(zones, r2.zones, template);

  // field.one was already satisfied, so round 2 never re-asked for it.
  assert.deepEqual(asked, ["r1:field.one", "r1:field.two", "r2:field.two"]);

  // Round 1's zone is still there, and the new page filled the rest.
  const byKey = new Map(zones.map((z) => [z.key, z]));
  assert.equal(byKey.get("field.one").pageIndex, 1, "round 1's zone survived");
  assert.equal(byKey.get("whole.1").pageIndex, 0);
  assert.equal(byKey.get("whole.2").pageIndex, 2);

  // field.two still needs its second crop, and says so.
  assert.deepEqual(
    outstandingSlots(template, zones, reasons).map((o) => o.key),
    ["field.two"],
  );
});

test("withFieldHints puts each key's definition in front of the prompt", async () => {
  let sent;
  const ask = async (prompt) => {
    sent = prompt;
    return "ok";
  };

  const wrapped = withFieldHints(ask, ["cc", "unknownKey"], TINY_TEMPLATE.fieldHints);
  assert.equal(await wrapped("Extract these fields.\nFields: cc, unknownKey"), "ok");

  assert.match(sent, /FIELD DEFINITIONS/);
  assert.match(sent, /cc: the customer, not an email header/);
  // The original prompt is preserved verbatim: this wraps fields.ts's prompt,
  // it does not rewrite it.
  assert.ok(sent.endsWith("Extract these fields.\nFields: cc, unknownKey"));
  // A key with no definition contributes no line.
  assert.equal(sent.includes("unknownKey:"), false);

  // Nothing described means the original ask is handed back untouched, so an
  // undescribed group costs no wrapper and no prompt text.
  assert.equal(withFieldHints(ask, ["unknownKey"], TINY_TEMPLATE.fieldHints), ask);
});

test("parseArgs opens a new round per --tambahan and keeps the initial bundle together", () => {
  // parseArgs checks that every path exists before returning, so these are
  // real committed files rather than invented .pdf names. It never opens
  // them, and nothing here depends on their contents.
  const { rounds } = parseArgs([
    "package.json",
    "tsconfig.json",
    "--tambahan",
    "README.md",
    "--tambahan",
    "AGENTS.md",
    "--out",
    "somewhere",
  ]);

  assert.equal(rounds.length, 3);
  assert.deepEqual(rounds.map((r) => r.length), [2, 1, 1]);
  assert.ok(rounds[0][0].endsWith("package.json"));
  assert.ok(rounds[1][0].endsWith("README.md"));
  assert.ok(rounds[2][0].endsWith("AGENTS.md"));

  assert.throws(() => parseArgs([]), /no PDF given/);
  assert.throws(
    () => parseArgs(["package.json", "--tambahan"]),
    /--tambahan needs a PDF/,
  );
  assert.throws(
    () => parseArgs(["package.json", "--tambahan", "nope.pdf"]),
    /no such file/,
  );
});

test("every AO slot searched by the model carries a hint that rules something out", () => {
  // The pool is no longer narrowed by docType, so a hint is all that keeps a
  // table slot from matching a look-alike elsewhere in the bundle. A hint
  // that only restates the label is what the 2026-08-31 note calls "thin
  // enough to match the wrong thing anywhere in a bundle".
  const searched = templateSlots(AO_TEMPLATE)
    .filter(({ section, slot }) => section.layout === "table" && slot.fillable)
    .map(({ slot }) => slot);

  assert.ok(searched.length > 0);
  for (const slot of searched) {
    assert.ok(
      /\bnot\b/i.test(slot.hint),
      `${slot.key}'s hint names nothing it is not: ${slot.hint}`,
    );
    assert.ok(slot.hint.length > 60, `${slot.key}'s hint is too thin: ${slot.hint}`);
  }
});

test("AO_TEMPLATE.fieldHints tell cc apart from an email header, and namaProyek from the contract title", () => {
  const { fieldHints } = AO_TEMPLATE;

  // Every backed xlsx row has a definition; a key without one reaches the
  // model as its bare name, which is the state that shipped a wrong customer.
  const backed = [
    ...new Set(AO_TEMPLATE.xlsxRows.map((row) => row.fieldKey).filter(Boolean)),
  ];
  for (const key of backed) {
    assert.ok(fieldHints[key], `${key} has no fieldHint`);
  }

  // The two disambiguations the corrections note calls for by name.
  assert.match(fieldHints.cc, /\bCc\b/);
  assert.match(fieldHints.cc, /email header/i);
  assert.match(fieldHints.namaProyek, /Surat Penunjukan/);

  // And no real client identifier leaked into a committed file while writing
  // them -- the repo is public.
  for (const hint of Object.values(fieldHints)) {
    assert.equal(/LOP\d|1-7\d{9}|SYARIAH|Slipi|Kemanggisan/i.test(hint), false);
  }
});

test("every fillable AO slot declares a crop count a round can report against", () => {
  for (const { slot } of templateSlots(AO_TEMPLATE)) {
    assert.ok(slotCropCount(slot) >= 1, `${slot.key} has a crop count below 1`);
  }
});
