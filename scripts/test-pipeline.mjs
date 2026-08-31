import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
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
