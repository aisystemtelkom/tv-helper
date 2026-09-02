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

import {
  locateSlot,
  buildLocatePrompt,
  CROP_PADDING_PX,
  trimRunningFooter,
  FOOTER_GAP_MULTIPLE,
  MAX_FOOTER_LINES,
} from "../src/lib/pipeline/locate.ts";

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

// ---------------------------------------------------------------------------
// trimRunningFooter: the running-page-footer defect.
//
// The prompt tells the model to stop at "the next heading, the next unrelated
// section, or the end of the page". A running footer is none of those, so the
// model ends its block on one, and because the footer sits at the very bottom
// of the page the resulting rectangle stretches down the whole blank remainder.
// Measured on the sample bundle before this trim existed, `KB / TTD Pejabat`
// produced a 9.11in crop of a 1.98in signature block.
//
// These build Line objects directly rather than going through
// groupWordsIntoLines, because the point is the geometry -- some of the cases
// below (every line sharing one y) cannot be expressed as words that the
// grouper would keep as separate lines at all.
// ---------------------------------------------------------------------------

const lineAt = (i, y, text = `line ${i}`, h = 20) => ({
  i,
  text,
  box: { x: 10, y, w: 200, h },
  words: [{ text, box: { x: 10, y, w: 200, h } }],
});

/** A body block on a 50px pitch, then a footer far below it. */
const bodyThenFooter = [
  lineAt(0, 100),
  lineAt(1, 150),
  lineAt(2, 200),
  lineAt(3, 250),
  lineAt(4, 3200, "Page 19 of 23"),
];

test("trimRunningFooter drops a trailing line separated by a huge gap", () => {
  // Pitches are 50,50,50,2950; the median is 50, so the last gap is 59x -- far
  // past FOOTER_GAP_MULTIPLE.
  assert.deepEqual(trimRunningFooter(bodyThenFooter, 0, 4), [0, 3]);
});

test("trimRunningFooter leaves ordinary paragraph spacing alone", () => {
  // A blank line's worth of extra leading is nothing like a footer gap.
  const spaced = [lineAt(0, 100), lineAt(1, 150), lineAt(2, 200), lineAt(3, 340)];
  assert.deepEqual(trimRunningFooter(spaced, 0, 3), [0, 3]);
});

test("trimRunningFooter's threshold is a multiple of the block's OWN pitch", () => {
  // The same shape at a different scale must behave identically -- that is the
  // whole reason the rule is a ratio and not a page-position band. A gap just
  // under the threshold survives at both scales; just over is cut at both.
  for (const pitch of [10, 50, 400]) {
    const under = [
      lineAt(0, 0),
      lineAt(1, pitch),
      lineAt(2, 2 * pitch),
      lineAt(3, 2 * pitch + pitch * (FOOTER_GAP_MULTIPLE - 1)),
    ];
    assert.deepEqual(trimRunningFooter(under, 0, 3), [0, 3], `pitch ${pitch} under`);

    const over = [
      lineAt(0, 0),
      lineAt(1, pitch),
      lineAt(2, 2 * pitch),
      lineAt(3, 2 * pitch),
      lineAt(4, 2 * pitch + pitch * (FOOTER_GAP_MULTIPLE + 1)),
    ];
    assert.deepEqual(trimRunningFooter(over, 0, 4), [0, 3], `pitch ${pitch} over`);
  }
});

test("trimRunningFooter cuts a footer that OCR split into two lines", () => {
  // Both footer lines sit close together, so the oversized gap is the one
  // ABOVE the first of them -- a rule that only ever dropped the final line
  // would leave the first footer line, and the crop would still run to the
  // bottom of the page.
  const twoLineFooter = [
    lineAt(0, 100),
    lineAt(1, 150),
    lineAt(2, 200),
    lineAt(3, 250),
    lineAt(4, 3200, "initials"),
    lineAt(5, 3240, "Page 19 of 23"),
  ];
  assert.deepEqual(trimRunningFooter(twoLineFooter, 0, 5), [0, 3]);
});

test("trimRunningFooter declines when the range is too short to have a pitch", () => {
  // Three lines give two gaps, and a median of two numbers that includes the
  // outlier under test is not a measurement of anything.
  const three = [lineAt(0, 100), lineAt(1, 150), lineAt(2, 3200)];
  assert.deepEqual(trimRunningFooter(three, 0, 2), [0, 2]);
});

test("trimRunningFooter declines when the cut would leave too few lines", () => {
  // The gap here is enormous, but keeping only two lines would mean trimming
  // on the strength of a pitch measured from a single gap.
  const topHeavy = [lineAt(0, 100), lineAt(1, 150), lineAt(2, 3000), lineAt(3, 3050)];
  assert.deepEqual(trimRunningFooter(topHeavy, 0, 3), [0, 3]);
});

test("trimRunningFooter declines on a degenerate block with no pitch at all", () => {
  // One row of a table that OCR split into several boxes at the same y has no
  // line pitch to be a multiple of. Dividing by it would yield Infinity and
  // trim a block that has no footer in it.
  const sameY = [lineAt(0, 100), lineAt(1, 100), lineAt(2, 100), lineAt(3, 100)];
  assert.deepEqual(trimRunningFooter(sameY, 0, 3), [0, 3]);
});

test("trimRunningFooter reads lines by number, not by array order", () => {
  const shuffled = [
    bodyThenFooter[4],
    bodyThenFooter[1],
    bodyThenFooter[3],
    bodyThenFooter[0],
    bodyThenFooter[2],
  ];
  assert.deepEqual(trimRunningFooter(shuffled, 0, 4), [0, 3]);
  // And it must not reorder the caller's own array while doing it.
  assert.deepEqual(
    shuffled.map((l) => l.i),
    [4, 1, 3, 0, 2],
  );
});

test("trimRunningFooter refuses to delete a whole block below a wide gap", () => {
  // The defect this guards: the gap test says "something separate starts
  // here", not "a footer starts here". Below the gap is a price total, a
  // heading and five lines of conditions -- the shape of the sample bundle's
  // own page 23, whose widest gap has SEVEN lines under it. Trimming there
  // would drop the total a validator is signing off, and would look like a
  // clean trim: a shorter crop with a matching line range and transcript.
  //
  // The figures and references below are fictional. This file is tracked and
  // the bundle these shapes were measured on is not publishable.
  const blockBelowGap = [
    lineAt(0, 100),
    lineAt(1, 150),
    lineAt(2, 200),
    lineAt(3, 250),
    // 2600px below the last body line, on a 50px pitch: 52x, far past the
    // threshold. The gap is not what makes this safe -- the size is.
    lineAt(4, 2850, "TOTAL 999.000.000"),
    lineAt(5, 2900, "Ketentuan:"),
    lineAt(6, 2950, "a. Harga sudah termasuk PPN"),
    lineAt(7, 3000, "b. Harga instalasi one time charge"),
    lineAt(8, 3050, "c. Masa berlaku 30 hari"),
    lineAt(9, 3100, "d. Pembayaran sesuai ketentuan"),
    lineAt(10, 3150, "e. Harga belum termasuk perangkat"),
  ];
  assert.equal(blockBelowGap.length - 4, 7, "seven lines below the gap");
  assert.deepEqual(trimRunningFooter(blockBelowGap, 0, 10), [0, 10]);
});

test("trimRunningFooter's bound is on how much it deletes, not on the gap", () => {
  // Same gap, same ratio, same everything except the number of lines under
  // it: at the cap it still trims, one line past the cap it declines. That
  // boundary is the whole content of MAX_FOOTER_LINES, so it is asserted
  // rather than inferred from the two shapes above.
  const withTail = (tailLines) => {
    const lines = [lineAt(0, 0), lineAt(1, 50), lineAt(2, 100), lineAt(3, 150)];
    for (let n = 0; n < tailLines; n++) {
      lines.push(lineAt(4 + n, 3000 + n * 50, `tail ${n}`));
    }
    return lines;
  };

  const atCap = withTail(MAX_FOOTER_LINES);
  assert.deepEqual(
    trimRunningFooter(atCap, 0, atCap.length - 1),
    [0, 3],
    `${MAX_FOOTER_LINES} trailing lines is still a footer`,
  );

  const overCap = withTail(MAX_FOOTER_LINES + 1);
  assert.deepEqual(
    trimRunningFooter(overCap, 0, overCap.length - 1),
    [0, overCap.length - 1],
    `${MAX_FOOTER_LINES + 1} trailing lines is no longer a footer`,
  );
});

test("trimRunningFooter still cuts the footer sizes actually measured", () => {
  // One line (the contract pages' initialling strip) and two (the letter
  // pages' reference line plus "Page 2 of 2") are the only footer sizes this
  // bundle demonstrates. The cap must not have moved either of them.
  const body = [lineAt(0, 100), lineAt(1, 150), lineAt(2, 200), lineAt(3, 250)];
  assert.deepEqual(
    trimRunningFooter([...body, lineAt(4, 3216, "Penyedia | Page 20 of 23")], 0, 4),
    [0, 3],
  );
  assert.deepEqual(
    trimRunningFooter(
      [...body, lineAt(4, 3357, "SP No. LOP999001"), lineAt(5, 3401, "Page 2 of 2")],
      0,
      5,
    ),
    [0, 3],
  );
});

test("trimRunningFooter only considers the range it was given", () => {
  // A footer outside [from,to] is not the trim's business, and a range that
  // stops short of it must come back untouched.
  assert.deepEqual(trimRunningFooter(bodyThenFooter, 0, 3), [0, 3]);
});

test("locateSlot's box, lineRange and text all reflect the trim", async () => {
  // The failure this guards against is the wrong-and-quiet one: a rectangle
  // that no longer includes the footer while the citation and the transcript
  // beside it still claim it does. All three must agree.
  const page = { index: 5, width: 500, height: 4000, lines: bodyThenFooter };
  const ask = async () => '{"pageIndex":0,"from":0,"to":4,"confidence":"high"}';

  const result = await locateSlot("TTD", "the signature block", [page], ask);

  assert.deepEqual(result.zone.lineRange, [0, 3]);
  assert.ok(!result.text.includes("Page 19 of 23"));
  assert.equal(result.text, "line 0\nline 1\nline 2\nline 3");
  // Lines 0-3 span y=100 to y=270, padded by CROP_PADDING_PX.
  assert.equal(result.zone.box.y, 100 - CROP_PADDING_PX);
  assert.equal(result.zone.box.h, 170 + CROP_PADDING_PX * 2);
});

test("locateSlot still raises on a malformed range rather than silently trimming it", () => {
  // trimRunningFooter must hand a reversed range straight back, so the error
  // boxForLineRange has always raised is still the error a caller sees.
  const page = { index: 0, width: 500, height: 4000, lines: bodyThenFooter };
  const ask = async () => '{"pageIndex":0,"from":3,"to":1,"confidence":"high"}';
  return assert.rejects(
    () => locateSlot("TTD", "x", [page], ask),
    /line range reversed/,
  );
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

test("cropToPng throws on a NaN box instead of encoding an empty picture", async () => {
  // MEASURED, not theorised. Both guards above are comparisons, and NaN loses
  // every comparison: `w <= 0` is false, `x + w > page.width` is false. A NaN
  // box therefore reached `new Uint8ClampedArray(NaN * NaN * 4)`, which is a
  // ZERO-LENGTH buffer, copied no rows, and returned a valid 65-byte PNG whose
  // IHDR said 0x0. The docx opened, the cell held a picture, and there was
  // nothing in it -- a validation packet that looks complete and carries no
  // evidence is the exact failure this project is organised against.
  const canvas = createCanvas(20, 20);
  const ctx = canvas.getContext("2d");
  const rendered = {
    data: ctx.getImageData(0, 0, 20, 20).data,
    width: 20,
    height: 20,
  };

  for (const box of [
    { x: NaN, y: NaN, w: NaN, h: NaN },
    { x: 0, y: 0, w: NaN, h: 10 },
    { x: 0, y: Infinity, w: 10, h: 10 },
  ]) {
    await assert.rejects(() => cropToPng(rendered, box), /not finite/);
  }
});

test("cropToPng refuses a page that is not the size the box was measured on", async () => {
  // The browser stores OCR lines, never pixels, so a crop is cut from a SECOND
  // render of the same PDF page. A re-render at another DPI produces a
  // perfectly good picture of the wrong region and nothing downstream can
  // tell. `expect` is the size the zone was measured against.
  const canvas = createCanvas(20, 20);
  const ctx = canvas.getContext("2d");
  const rendered = {
    data: ctx.getImageData(0, 0, 20, 20).data,
    width: 20,
    height: 20,
  };

  await assert.rejects(
    () => cropToPng(rendered, { x: 0, y: 0, w: 10, h: 10 }, { width: 40, height: 40 }),
    /different ruler/,
  );
  // The agreeing case still cuts, so the guard cannot be satisfied by never
  // passing `expect`.
  const png = await cropToPng(
    rendered,
    { x: 0, y: 0, w: 10, h: 10 },
    { width: 20, height: 20 },
  );
  assert.ok(png.length > 0);
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
      { text: "BANK", box: { x: 200, y: 10, w: 40, h: 12 } },
      { text: "CONTOH", box: { x: 245, y: 10, w: 55, h: 12 } },
      { text: "NUSANTARA", box: { x: 305, y: 10, w: 80, h: 12 } },
    ]),
  };
  const ask = async () =>
    '{"values":[{"fieldKey":"cc","value":"BANK CONTOH NUSANTARA","pageIndex":0,"from":0,"to":0}]}';

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
      { text: "BANK", box: { x: 10, y: 40, w: 40, h: 12 } },
      { text: "CONTOH", box: { x: 55, y: 40, w: 55, h: 12 } },
      { text: "NUSANTARA", box: { x: 115, y: 40, w: 80, h: 12 } },
    ]),
  };
}

test("extractFields drops a citation to a page that was never offered, but keeps the value", async () => {
  // Only one page (position 0) is offered; the model cites position 5.
  const ask = async () =>
    '{"values":[{"fieldKey":"cc","value":"BANK CONTOH NUSANTARA","pageIndex":5,"from":0,"to":0}]}';

  const values = await extractFields(["cc"], [twoLinePage()], ask);

  assert.equal(values.length, 1);
  assert.equal(values[0].value, "BANK CONTOH NUSANTARA");
  assert.equal(values[0].source, undefined);
});

test("extractFields drops a reversed line range, but keeps the value", async () => {
  const ask = async () =>
    '{"values":[{"fieldKey":"cc","value":"BANK CONTOH NUSANTARA","pageIndex":0,"from":1,"to":0}]}';

  const values = await extractFields(["cc"], [twoLinePage()], ask);

  assert.equal(values.length, 1);
  assert.equal(values[0].value, "BANK CONTOH NUSANTARA");
  assert.equal(values[0].source, undefined);
});

test("extractFields drops a citation whose line range doesn't exist on the page, but keeps the value", async () => {
  // The page only has lines 0-1; the model cites up to line 5.
  const ask = async () =>
    '{"values":[{"fieldKey":"cc","value":"BANK CONTOH NUSANTARA","pageIndex":0,"from":0,"to":5}]}';

  const values = await extractFields(["cc"], [twoLinePage()], ask);

  assert.equal(values.length, 1);
  assert.equal(values[0].value, "BANK CONTOH NUSANTARA");
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
    return '{"values":[{"fieldKey":"cc","value":"BANK CONTOH NUSANTARA","pageIndex":0,"from":0,"to":0}]}';
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
    { fieldKey: "alamat", value: "Jalan Contoh Nusantara Raya No.1",
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
  assert.ok(String(cell.value).includes("Contoh Nusantara"));
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
// ---------------------------------------------------------------------------
// Document-agnostic search, and the dokumen tambahan loop's headless
// foundation. See docs/superpowers/specs/
// 2026-08-31-corrections-and-document-agnostic.md sections 2 and 4.
// ---------------------------------------------------------------------------

import {
  NEVER_EXTRACTED,
  extractTextFields,
  extractableFieldKeys,
  inTemplateOrder,
  mergeZones,
  outstandingFields,
  outstandingSlots,
  parseArgs,
  rankedPoolForDocTypes,
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

test("rankedPoolForDocTypes offers every page, with the preferred docType's pages first", () => {
  const pages = [0, 1, 2, 3].map((i) => fakePage(i));
  const byType = new Map([
    ["KB", [2, 3]],
    ["Email", [0]],
    ["BAPermintaan", [1]],
  ]);

  const pool = rankedPoolForDocTypes(["KB"], byType, pages);

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

test("rankedPoolForDocTypes keeps every page when nothing was classified as the preferred type", () => {
  const pages = [0, 1].map((i) => fakePage(i));

  assert.deepEqual(
    rankedPoolForDocTypes(["KB"], new Map(), pages).map((p) => p.index),
    [0, 1],
  );
  assert.deepEqual(
    rankedPoolForDocTypes([null], new Map([["KB", [1]]]), pages).map((p) => p.index),
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

test("a partly-filled slot's reason leads with its count, not the last round's message", () => {
  // Measured on the real two-round run: kbLanjutan.top held one of its two
  // captures from round 1, round 2 searched the tambahan for the second and
  // found none, and the reason read "the model found no match" -- which says
  // the slot is empty, next to a found:1 that says it is not.
  const zones = [
    { key: "field.one", pageIndex: 0 },
    { key: "field.two", pageIndex: 1 },
    { key: "whole.1", pageIndex: 2 },
    { key: "whole.2", pageIndex: 3 },
  ];
  const reasons = new Map([["field.two", "the model found no match"]]);

  const [item] = outstandingSlots(TINY_TEMPLATE, zones, reasons);

  assert.equal(item.found, 1);
  assert.match(item.reason, /^1 of 2 captures found/);
  // The round's own message is kept, but as the tail rather than the claim.
  assert.match(item.reason, /the model found no match/);

  // A slot with nothing at all still leads with what went wrong.
  const empty = outstandingSlots(TINY_TEMPLATE, [], reasons).find(
    (o) => o.key === "field.two",
  );
  assert.equal(empty.reason, "the model found no match");
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

// ---------------------------------------------------------------------------
// The wrong-customer regression, made repeatable.
//
// WHAT HAPPENED. `cc` was offered a pool that included the printed email
// thread, and the model answered with the organisation on the email's own
// `Cc:` header instead of the subscriber named on the order request. A wrong
// customer name shipped in both deliverables. The mitigation at the time was
// to narrow `cc`'s pool to the BA Permintaan pages. The document-agnostic
// correction (2026-08-31, §2) removed that narrowing on purpose and replaced
// it with a `fieldHints.cc` definition that rules email headers out -- a
// replacement evidenced by one manual run, which is not a guard.
//
// WHAT THESE TWO TESTS PROVE. That both candidates still reach the model in
// ONE pool, and that the same prompt still tells it the email-header
// candidate is not an acceptable answer. Delete `withFieldHints` from the
// extraction path, empty `AO_TEMPLATE.fieldHints.cc`, or weaken it until it
// no longer rules the header out, and the first test fails.
//
// WHAT THEY CANNOT PROVE. That the real model obeys the definition. Only
// `pnpm measure:locate` and a real `pnpm generate` run say that. The thing
// that regressed silently was the disambiguation reaching the prompt at all,
// and that is what is guarded here -- for free, and without a flake.
//
// The names are fictional, per the repo rule: this file is public.
// ---------------------------------------------------------------------------

/** The subscriber named on the order request. The right answer. */
const RIGHT_CUSTOMER = "BANK CONTOH NUSANTARA";
/** The organisation on the printed email's own `Cc:` header. The wrong one. */
const WRONG_CUSTOMER = "PT CONTOH DISTRIBUSI NUSANTARA";

/** An order request naming its subscriber, and a printed email whose `Cc:`
 * header names somebody else. Both in one pool, which is the condition that
 * produced the bug. */
function wrongCustomerPool() {
  const page = (index, docName, texts) => ({
    index,
    source: 0,
    sourceName: docName,
    pageInDoc: index,
    width: 1000,
    height: 1000,
    lines: texts.map((text, i) => ({
      i,
      text,
      box: { x: 10, y: 10 + i * 20, w: 900, h: 14 },
      words: [{ text, box: { x: 10, y: 10 + i * 20, w: 900, h: 14 } }],
    })),
  });

  return [
    page(0, "splitba.pdf", [
      "BERITA ACARA PERMINTAAN ORDER",
      `Nama Pelanggan : ${RIGHT_CUSTOMER}`,
      "Tipe Permintaan : PSB VPN IP KCP Contoh",
    ]),
    page(1, "splitba.pdf", [
      "From: Rina Contoh <rina@contoh.example>",
      "To: Panitia Pengadaan",
      `Cc: ${WRONG_CUSTOMER}`,
      "Subject: Permintaan PSB VPN IP KCP Contoh",
    ]),
  ];
}

/** Both pages classified, so `rankedPoolForDocTypes` reorders rather than filters -- the
 * document-agnostic shape, where the Email page is still in `cc`'s pool. */
const WRONG_CUSTOMER_BY_TYPE = new Map([
  ["BAPermintaan", [0]],
  ["Email", [1]],
]);

/** A template with exactly one backed field, `cc`, carrying the production
 * hint, so the run asks one question and the answer is unambiguous. */
const CC_ONLY_TEMPLATE = {
  sections: [
    {
      title: "BA Permintaan",
      layout: "images",
      slots: [{ key: "ba.1", label: "BA", fillable: true, docType: "BAPermintaan" }],
    },
  ],
  xlsxRows: [{ nomor: 1, itemI: "Customer", itemII: "Name", fieldKey: "cc" }],
  fieldHints: { cc: AO_TEMPLATE.fieldHints.cc },
};

/**
 * A stand-in for the model that fails the way the real one failed: given
 * nothing but the key name `cc`, the line literally labelled `Cc:` is the
 * best match in the pool, and that is the answer that shipped. It reads the
 * prompt instead of ignoring it, and picks the subscriber line instead once
 * the prompt carries a definition of `cc` that rules an email header out.
 *
 * `withFieldHints` emits one `  <key>: <definition>` line per described key,
 * so the definition is matched as a single line here.
 */
function ccStub(record) {
  return async (prompt) => {
    record.prompt = prompt;
    const definition = prompt.match(/^ {2}cc: (.*)$/m)?.[1] ?? "";
    const rulesOutEmailHeaders =
      /\b(not|never)\b/i.test(definition) && /email header/i.test(definition);
    record.rulesOutEmailHeaders = rulesOutEmailHeaders;

    return rulesOutEmailHeaders
      ? `{"values":[{"fieldKey":"cc","value":"${RIGHT_CUSTOMER}","pageIndex":0,"from":1,"to":1}]}`
      : `{"values":[{"fieldKey":"cc","value":"${WRONG_CUSTOMER}","pageIndex":1,"from":2,"to":2}]}`;
  };
}

test("cc extraction does not return the email Cc: header when both candidates share a pool", async () => {
  const pages = wrongCustomerPool();
  const record = {};

  // The production path, not a hand-composed one: extractTextFields ranks the
  // pool, groups the keys, prepends the hints and remaps the citation.
  const values = await extractTextFields(
    CC_ONLY_TEMPLATE,
    WRONG_CUSTOMER_BY_TYPE,
    pages,
    ccStub(record),
  );

  // Both candidates were genuinely offered: the wrong one is in the listing,
  // so this is the pool that produced the bug and not a narrowed one.
  assert.ok(
    record.prompt.includes(`Cc: ${WRONG_CUSTOMER}`),
    "the email Cc: header must be in the pool for this to be the real case",
  );
  assert.ok(record.prompt.includes(`Nama Pelanggan : ${RIGHT_CUSTOMER}`));

  // And the definition that rules it out travelled in the same prompt.
  assert.ok(record.rulesOutEmailHeaders, record.prompt.slice(0, 400));

  assert.equal(values.length, 1);
  assert.equal(values[0].value, RIGHT_CUSTOMER);
  assert.notEqual(values[0].value, WRONG_CUSTOMER);
  // Cited to the order request page, not to the email page, and named by the
  // file a reviewer opens.
  assert.equal(values[0].source.pageIndex, 0);
  assert.deepEqual(values[0].source.lineRange, [1, 1]);
  assert.equal(values[0].source.sourceName, "splitba.pdf");
  assert.equal(values[0].source.pageInDoc, 0);
});

test("without the cc definition the same pool yields the email header value", async () => {
  // The negative control. A guard that cannot fail is not a guard: this is
  // the pre-fix state -- the bare key name `cc` and nothing else -- and it
  // reproduces the wrong customer, which is what makes the test above mean
  // something.
  const pages = wrongCustomerPool();
  const record = {};

  const values = await extractTextFields(
    { ...CC_ONLY_TEMPLATE, fieldHints: {} },
    WRONG_CUSTOMER_BY_TYPE,
    pages,
    ccStub(record),
  );

  assert.equal(record.rulesOutEmailHeaders, false);
  assert.equal(values[0].value, WRONG_CUSTOMER);
  assert.equal(values[0].source.pageIndex, 1);
  assert.deepEqual(values[0].source.lineRange, [2, 2]);
});

test("namaProyek is never sent to the model, and its blank says why", () => {
  // Reverted mitigation (task brief item 1). On the full pool it answered
  // with the master contract's scope title, carrying a citation that PASSED
  // validation, in the docx header's `NAMA Proyek :` cell and its xlsx row.
  // A blank invites the operator to fill it in; a plausible wrong value does
  // not. Re-enabling needs a reproducible run that yields the right value.
  assert.ok(NEVER_EXTRACTED.has("namaProyek"));

  // The exclusion has to reach the key list a run actually asks for, not just
  // sit in a Set.
  const asked = extractableFieldKeys(AO_TEMPLATE);
  assert.equal(asked.includes("namaProyek"), false);
  // Every other backed key is still asked for: this excludes one key, not the
  // extraction step.
  assert.ok(asked.includes("cc"));
  assert.ok(asked.length > 1);

  // And the operator's outstanding list gives a reason that is true of it.
  // "searched, not found" would be a false statement: nothing searched.
  const outstanding = outstandingFields(AO_TEMPLATE, []);
  const namaProyek = outstanding.find((o) => o.key === "namaProyek");
  assert.ok(namaProyek, "namaProyek must be reported outstanding, not silently blank");
  assert.match(namaProyek.reason, /deliberately not extracted/);
  assert.equal(
    outstanding.find((o) => o.key === "cc").reason,
    "searched, not found",
  );
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
  // them -- the repo is public, and a hint is written while looking straight
  // at the client's own paperwork, which is exactly when an example gets
  // copied out of it.
  //
  // The checks are STRUCTURAL rather than a list of the client's own strings:
  // spelling those out here would put them in the public repo itself, which
  // is the thing being prevented. An EPIC id, a quote number, or any long run
  // of digits (an account, a phone, a rekening) is what a leak looks like.
  for (const hint of Object.values(fieldHints)) {
    assert.equal(/\bLOP\s*\d/i.test(hint), false, hint);
    assert.equal(/\b\d-\d{9,}\b/.test(hint), false, hint);
    assert.equal(/\d{6,}/.test(hint), false, hint);
  }
});

test("every fillable AO slot declares a crop count a round can report against", () => {
  for (const { slot } of templateSlots(AO_TEMPLATE)) {
    assert.ok(slotCropCount(slot) >= 1, `${slot.key} has a crop count below 1`);
  }
});

// ---------------------------------------------------------------------------
// Abbreviations.
//
// These documents abbreviate constantly and inconsistently: one organisation
// appears in full, shortened, and as initials inside a single bundle, and a
// document type is headed in full on one page and cited by its initials on
// the next. A tool that compares those as plain strings reports a field
// missing that it actually found, and reports two documents in conflict when
// they agree.
//
// THE TEST THAT MATTERS MOST IN THIS SECTION IS THE NEGATIVE ONE. An
// over-eager matcher that fuses two customers is worse than no matcher at
// all: the deliverable still opens, still looks complete, and now carries
// somebody else's name. Every widening of these rules has to leave
// "similar but distinct entities do not match" passing.
// ---------------------------------------------------------------------------

import {
  DOMAIN_ABBREVIATIONS,
  acronymOf,
  canonicalEntity,
  sameEntity,
  stripCorporateForms,
} from "../src/lib/pipeline/abbrev.ts";

test("stripCorporateForms drops the designators the scans wrap a name in", () => {
  // The two wrappers the bundle actually prints, in the casing it prints them.
  assert.equal(
    stripCorporateForms("PT BANK CONTOH NUSANTARA TBK"),
    "bank contoh nusantara",
  );
  assert.equal(
    stripCorporateForms(
      "PERUSAHAAN PERSEROAN (PERSERO) PT TELEKOMUNIKASI CONTOH TBK",
    ),
    "telekomunikasi contoh",
  );
  // Punctuated and mixed-case forms are the same designators.
  assert.equal(
    stripCorporateForms("PT. Bank Contoh Nusantara, Tbk."),
    "bank contoh nusantara",
  );
  assert.equal(stripCorporateForms("CV Contoh Nusantara"), "contoh nusantara");
  assert.equal(stripCorporateForms("UD Contoh Nusantara"), "contoh nusantara");
});

test("stripCorporateForms leaves a name that only looks like a designator alone", () => {
  // `Perusahaan` and `Perseroan` are ordinary words that begin real names.
  // Only the fixed pair is a designator, so a name starting with one of them
  // keeps it -- otherwise acronymOf would return the wrong initials for it.
  assert.equal(
    stripCorporateForms("Perusahaan Listrik Contoh"),
    "perusahaan listrik contoh",
  );
  // A designator in the MIDDLE is part of the name, not a wrapper on it.
  assert.equal(stripCorporateForms("Anak PT Contoh"), "anak pt contoh");
  // And a value made of nothing but designators keeps its own text rather
  // than collapsing to "", which would make every such value compare equal
  // to every other one.
  assert.equal(stripCorporateForms("PT Tbk"), "pt tbk");
});

test("acronymOf takes the initials of the words that carry identity", () => {
  assert.equal(acronymOf("Bank Contoh Nusantara"), "BCN");
  // The corporate wrapper contributes no letter: the same organisation must
  // yield the same initials however the page that names it dressed it up.
  assert.equal(acronymOf("PT Bank Contoh Nusantara Tbk"), "BCN");
  assert.equal(acronymOf("PT. BANK CONTOH NUSANTARA, TBK."), "BCN");
  // Stopwords carry no identity either.
  assert.equal(acronymOf("Perjanjian Kerja Sama"), "PKS");
  assert.equal(acronymOf("Kantor Contoh dan Nusantara"), "KCN");
  assert.equal(acronymOf(""), "");
});

test("sameEntity matches through all three equivalence routes", () => {
  // 1. Equal once case, spacing and punctuation are folded.
  assert.ok(
    sameEntity("PT. Bank Contoh Nusantara, Tbk.", "PT BANK CONTOH NUSANTARA TBK"),
  );
  assert.ok(sameEntity("Bank  Contoh   Nusantara", "bank contoh nusantara"));
  // ...including across the corporate wrapper, which is the form the
  // human-authored validation form writes and the scans do not.
  assert.ok(sameEntity("BANK CONTOH NUSANTARA", "PT BANK CONTOH NUSANTARA TBK"));

  // 2. One side written as the other's initials.
  assert.ok(sameEntity("BCN", "Bank Contoh Nusantara"));
  assert.ok(sameEntity("PT Bank Contoh Nusantara Tbk", "BCN"));

  // 3. One contains the other, once the designators are stripped.
  assert.ok(
    sameEntity("Bank Contoh Nusantara", "PT Bank Contoh Nusantara Kantor Pusat Tbk"),
  );
});

test("sameEntity resolves a domain abbreviation to its expansion, both ways", () => {
  assert.ok(sameEntity("PKS", "Perjanjian Kerja Sama"));
  assert.ok(sameEntity("Perjanjian Kerja Sama", "PKS"));
  // The scans write the agreement as one word on its own cover page and as
  // two words elsewhere. Both name the same document type.
  assert.ok(sameEntity("PKS", "PERJANJIAN KERJASAMA"));
  assert.ok(sameEntity("SP", "Surat Penunjukan"));
  assert.ok(sameEntity("BA", "Berita Acara"));
  // Not derivable from the letters, which is why the table exists at all.
  assert.ok(sameEntity("PSB", "Pasang Baru"));
  assert.ok(sameEntity("TTD", "Tanda Tangan"));
  assert.ok(sameEntity("ToP", "Term of Payment"));
});

test("sameEntity refuses two similar but distinct entities", () => {
  // THE CASE THIS WHOLE MODULE IS JUDGED ON. Two different organisations
  // sharing a generic first word are not one organisation, and fusing them
  // would put the wrong customer in a document a validator signs.
  assert.equal(
    sameEntity("PT Bank Contoh Nusantara Tbk", "PT Bank Contoh Sejahtera Tbk"),
    false,
  );
  assert.equal(sameEntity("Bank Contoh Nusantara", "Bank Contoh Sejahtera"), false);
  // Nor does one's acronym match the other.
  assert.equal(sameEntity("BCN", "PT Bank Contoh Sejahtera Tbk"), false);

  // The shared head alone stands for neither of them: a single generic word
  // must never be treated as the whole name.
  assert.equal(sameEntity("Bank", "Bank Contoh Nusantara"), false);
  assert.equal(sameEntity("PT", "PT Bank Contoh Nusantara Tbk"), false);

  // Two DIFFERENT full names that happen to share initials stay different.
  // Neither is written as an abbreviation, so neither is an acronym of the
  // other -- the coincidence is invisible and must stay that way.
  assert.equal(sameEntity("Bank Contoh Nusantara", "Badan Cadangan Nasional"), false);

  // A word that is short and happens to equal the initials of a phrase it is
  // part of is that word, not an abbreviation of the phrase.
  assert.equal(sameEntity("BANK", "Bank Anak Nusantara Kontraktor"), false);

  // Contained words must line up as a contiguous run, not merely appear.
  assert.equal(sameEntity("Bank Nusantara", "Bank Contoh Nusantara"), false);

  // A blank matches nothing, including another blank: finding nothing twice
  // is not agreement, and treating it as agreement would settle a field as
  // though it had been confirmed.
  assert.equal(sameEntity("", "Bank Contoh Nusantara"), false);
  assert.equal(sameEntity("", ""), false);
  assert.equal(sameEntity("   ", "  "), false);
});

test("canonicalEntity ships the fullest spelling, never the initials", () => {
  // An operator reading the finished document can shorten a complete name;
  // they cannot restore words the tool dropped without reopening the scan.
  assert.equal(
    canonicalEntity(["BCN", "Bank Contoh Nusantara"]),
    "Bank Contoh Nusantara",
  );
  assert.equal(
    canonicalEntity(["Bank Contoh Nusantara", "PT Bank Contoh Nusantara Tbk"]),
    "PT Bank Contoh Nusantara Tbk",
  );
  // Order does not decide it; how much of the name survives does.
  assert.equal(
    canonicalEntity(["PT Bank Contoh Nusantara Tbk", "BCN"]),
    "PT Bank Contoh Nusantara Tbk",
  );
  // A tie on significant words falls to raw length, then to the first value
  // given, so the caller's own ordering (round 1 before round 2) decides when
  // nothing else does.
  assert.equal(canonicalEntity(["Contoh Satu", "Contoh Satuan"]), "Contoh Satuan");
  assert.equal(canonicalEntity(["Contoh Satu", "Contoh Dua"]), "Contoh Satu");
  // Blanks are not candidates.
  assert.equal(
    canonicalEntity(["", "  ", "Bank Contoh Nusantara"]),
    "Bank Contoh Nusantara",
  );
  assert.equal(canonicalEntity([]), "");
  assert.equal(canonicalEntity(["", "   "]), "");
});

test("DOMAIN_ABBREVIATIONS covers the bundle's vocabulary and carries no identifiers", () => {
  // The vocabulary the brief names, all of it generic to the domain.
  for (const key of [
    "PKS", "BA", "BAP", "SP", "SPH", "TTD", "TOP", "MRC", "NRC", "OTC",
    "PSB", "KCP", "SID", "LOP", "VPN", "MPLS", "AO", "MO", "DO",
  ]) {
    assert.ok(DOMAIN_ABBREVIATIONS[key], `${key} has no expansion`);
  }

  // The order verbs are workflow verbs, not billing periods -- the error the
  // 2026-08-31 corrections note exists to correct.
  assert.equal(DOMAIN_ABBREVIATIONS.AO, "Activation Order");
  assert.equal(DOMAIN_ABBREVIATIONS.MO, "Modify Order");
  assert.equal(DOMAIN_ABBREVIATIONS.DO, "Delete Order");

  // NOTHING CUSTOMER-SPECIFIC MAY ENTER THIS TABLE. A customer's initials are
  // derived at runtime by acronymOf from whatever the document prints; this
  // repo is public and has leaked a real identifier before. The checks are
  // structural for the same reason the fieldHints leak test's are: listing
  // the client's own strings here would put them in the public repo.
  for (const [key, expansion] of Object.entries(DOMAIN_ABBREVIATIONS)) {
    assert.match(key, /^[A-Z]{2,6}$/, `${key} is not a plain uppercase acronym`);
    assert.equal(/\d/.test(expansion), false, `${key} expands to digits: ${expansion}`);
    assert.equal(/\bLOP\s*\d/i.test(expansion), false, expansion);
    // An expansion is a few words of vocabulary, not a name and address.
    assert.ok(expansion.split(" ").length <= 5, `${key} expands too far: ${expansion}`);
  }
});

// ---------------------------------------------------------------------------
// Duplicate fieldKeys, and the conflict that must not be settled silently.
// ---------------------------------------------------------------------------

import { reconcileFieldValues } from "../src/lib/pipeline/fields.ts";

test("reconcileFieldValues collapses two spellings of one answer into the fullest", () => {
  // The recorded finding: nothing upstream promised one entry per fieldKey,
  // both entries survived, and the exporters' `new Map(...)` then kept
  // whichever came last -- silently, with the other spelling never mentioned.
  const reconciled = reconcileFieldValues([
    { fieldKey: "cc", value: "BCN", source: { pageIndex: 0, lineRange: [1, 1] } },
    {
      fieldKey: "cc",
      value: "PT BANK CONTOH NUSANTARA TBK",
      source: { pageIndex: 4, lineRange: [7, 9] },
    },
  ]);

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].value, "PT BANK CONTOH NUSANTARA TBK");
  assert.equal(reconciled[0].conflict, undefined);
  // The citation follows the spelling that ships. Keeping the first entry's
  // citation would produce a note naming lines that spell the name a
  // different way: valid on every check, and no support for the cell.
  assert.deepEqual(reconciled[0].source, { pageIndex: 4, lineRange: [7, 9] });
});

test("reconcileFieldValues keeps one entry per key, in first-seen order", () => {
  const reconciled = reconcileFieldValues([
    { fieldKey: "cc", value: "Bank Contoh Nusantara" },
    { fieldKey: "alamat", value: "Jalan Contoh No.1" },
    { fieldKey: "cc", value: "Bank Contoh Nusantara" },
  ]);

  assert.deepEqual(
    reconciled.map((v) => v.fieldKey),
    ["cc", "alamat"],
  );
});

test("reconcileFieldValues blanks a real disagreement instead of picking one", () => {
  // Two different customers is not a spelling difference. Shipping either
  // would be a coin toss printed as evidence, so the cell goes blank and both
  // candidates are named for the operator.
  const reconciled = reconcileFieldValues([
    {
      fieldKey: "cc",
      value: "Bank Contoh Nusantara",
      source: { pageIndex: 0, lineRange: [1, 1] },
    },
    {
      fieldKey: "cc",
      value: "Bank Contoh Sejahtera",
      source: { pageIndex: 9, lineRange: [2, 2] },
    },
  ]);

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].value, "");
  assert.deepEqual(reconciled[0].conflict, [
    "Bank Contoh Nusantara",
    "Bank Contoh Sejahtera",
  ]);
  // No citation either: there is nothing to cite for a value that is not
  // being shipped, and a note here would read as evidence for a blank.
  assert.equal(reconciled[0].source, undefined);
});

test("reconcileFieldValues keeps an unanswered key, so it still reports outstanding", () => {
  const reconciled = reconcileFieldValues([{ fieldKey: "cc", value: "" }]);
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].value, "");
  assert.equal(reconciled[0].conflict, undefined);
});

test("outstandingFields says a conflicted key was found twice, not 'not found'", () => {
  // "searched, not found" would be a false statement about a key that was
  // found twice, and false in the direction that hides work the operator
  // needs to do.
  const outstanding = outstandingFields(AO_TEMPLATE, [
    {
      fieldKey: "cc",
      value: "",
      conflict: ["Bank Contoh Nusantara", "Bank Contoh Sejahtera"],
    },
  ]);

  const cc = outstanding.find((o) => o.key === "cc");
  assert.ok(cc, "a blanked conflict must still be reported outstanding");
  assert.match(cc.reason, /disagree/);
  assert.match(cc.reason, /Bank Contoh Nusantara/);
  assert.match(cc.reason, /Bank Contoh Sejahtera/);

  // Every other blank key keeps the reason it had.
  assert.equal(
    outstanding.find((o) => o.key === "alamat").reason,
    "searched, not found",
  );
});

test("extractTextFields reconciles, so a model answering cc twice cannot ship both", async () => {
  // The production path. A model reply is free to cite the same field twice,
  // and this is the single point where every answer to a key converges --
  // across key groups and across every tambahan round, since extraction runs
  // once over the whole run's pages after the last round. Drop
  // reconcileFieldValues from it and the duplicates reach the exporters, to
  // be settled by array order inside whichever builds its Map last.
  const pages = [fakePage(0), fakePage(1)];
  const byType = new Map([["BAPermintaan", [0, 1]]]);
  const ask = async () =>
    '{"values":[' +
    '{"fieldKey":"cc","value":"BCN","pageIndex":0,"from":0,"to":0},' +
    '{"fieldKey":"cc","value":"PT Bank Contoh Nusantara Tbk","pageIndex":1,"from":0,"to":0}' +
    "]}";

  const values = await extractTextFields(
    { ...TINY_TEMPLATE, xlsxRows: [{ itemII: "Account", fieldKey: "cc" }] },
    byType,
    pages,
    ask,
  );

  assert.equal(values.length, 1);
  assert.equal(values[0].value, "PT Bank Contoh Nusantara Tbk");
  // And the citation belongs to the page that prints the spelling that ships.
  assert.equal(values[0].source.pageIndex, 1);
});

test("the extraction prompt tells the model these documents abbreviate", async () => {
  // A real accuracy win that costs a handful of tokens: told nothing, a model
  // treats a short form and its expansion as different answers and returns
  // whichever it saw first. The last clause is the load-bearing one -- "give
  // the fullest form" alone invites expanding an abbreviation the text never
  // expands, which would put an unsourced name in a cell that carries a
  // citation.
  let sent;
  const ask = async (prompt) => {
    sent = prompt;
    return '{"values":[]}';
  };

  await extractFields(["cc"], [twoLinePage()], ask);

  assert.match(sent, /abbreviate/i);
  assert.match(sent, /FULLEST form/);
  // The prompt is hard-wrapped, so the sentence spans a newline.
  assert.match(sent, /Never expand an abbreviation the text\s+does not expand/);
});

// ---------------------------------------------------------------------------
// Containment, fenced to name-like values.
//
// `sameEntity`'s containment rule -- "one value's words appear as a
// contiguous run inside the other's" -- was applied to every value of every
// kind, and `reconcileFieldValues` runs it over every fieldKey. So it did not
// only merge `Bank Contoh Nusantara` into `PT Bank Contoh Nusantara Kantor
// Pusat Tbk`, which is what it was argued for. It also declared
// `1-70000000001` and `1-70000000001-2` to be one quote, and `Rp 5.000.000`
// and `Rp 5.000.000.000` to be one price -- and because `sameEntity` is what
// decides whether a field is SETTLED or in CONFLICT, the loser was recorded
// nowhere at all. One of two different numbers shipped into a document a
// validator signs, with nothing anywhere saying there had been two.
//
// Containment now requires both sides to be NAME-LIKE: at least two
// identity-bearing words, none of which carries a digit. The tests below are
// the negative half of that, and they matter more than the positive half.
// ---------------------------------------------------------------------------

import { isNameLike } from "../src/lib/pipeline/abbrev.ts";

test("sameEntity refuses to fuse two numerically different values", () => {
  // Quote numbers. One is a strict prefix of the other, which is exactly what
  // containment used to accept.
  assert.equal(sameEntity("1-70000000001", "1-70000000001-2"), false);
  assert.equal(sameEntity("1-70000000001-2", "1-70000000001"), false);
  // ...and a bare id inside a labelled one is not the same id either.
  assert.equal(sameEntity("1-70000000001", "Quote 1-70000000001"), false);

  // Money. These differ by a factor of a thousand and share every word of the
  // shorter one.
  assert.equal(sameEntity("Rp 5.000.000", "Rp 5.000.000.000"), false);
  assert.equal(sameEntity("100 000 000", "100 000 000 000"), false);

  // Account numbers, where a prefix is a different account.
  assert.equal(sameEntity("1234 5678", "1234 5678 90"), false);

  // Bandwidth and term: the number is the whole answer, and the extra word
  // changes which line it describes.
  assert.equal(sameEntity("10 Mbps", "10 Mbps Backup"), false);
  assert.equal(sameEntity("30 Hari", "30 Hari Kalender"), false);

  // An address and the subnet cut out of it. The template's unbacked rows
  // include `MPLS VPN IP Address`, so this is a fieldKey away from being live.
  assert.equal(sameEntity("10.20.30.0", "10.20.30.0/24"), false);
});

test("reconcileFieldValues reports two different quote numbers as a conflict", () => {
  // The end-to-end consequence, at the function the deliverables read from.
  // Before the fence this returned ONE entry carrying `1-70000000001-2`, with
  // `conflict` undefined: the other quote number existed nowhere in the
  // output, and both exporters would have printed the survivor as settled.
  const reconciled = reconcileFieldValues([
    {
      fieldKey: "quote",
      value: "1-70000000001",
      source: { pageIndex: 0, lineRange: [1, 1] },
    },
    {
      fieldKey: "quote",
      value: "1-70000000001-2",
      source: { pageIndex: 3, lineRange: [4, 4] },
    },
  ]);

  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].value, "");
  assert.deepEqual(reconciled[0].conflict, ["1-70000000001", "1-70000000001-2"]);
  assert.equal(reconciled[0].source, undefined);
});

test("the fence leaves the name case containment was argued for intact", () => {
  // The whole point of containment, and it still holds: a name written with
  // its corporate wrapper and its branch is the same organisation as the bare
  // name. Narrowing the rule must not cost this.
  assert.ok(
    sameEntity("Bank Contoh Nusantara", "PT Bank Contoh Nusantara Kantor Pusat Tbk"),
  );

  // Routes 1 to 3 were never restricted and are unaffected by the fence, even
  // though none of these values is name-like on its own.
  assert.ok(sameEntity("1-70000000001", "1-70000000001"));
  assert.ok(sameEntity("LOP999001", "lop999001"));
  assert.ok(sameEntity("PKS", "Perjanjian Kerja Sama"));
  assert.ok(sameEntity("BCN", "Bank Contoh Nusantara"));
});

test("isNameLike admits names and refuses anything whose identity is a number", () => {
  assert.equal(isNameLike("Bank Contoh Nusantara"), true);
  // The corporate wrapper contributes nothing, so what is left must still be
  // two words: `PT Contoh Tbk` is one word of identity dressed up.
  assert.equal(isNameLike("PT Bank Contoh Nusantara Tbk"), true);
  assert.equal(isNameLike("PT Contoh Tbk"), false);
  assert.equal(isNameLike("Contoh"), false);
  assert.equal(isNameLike(""), false);

  // A digit ANYWHERE in an identity-bearing word disqualifies the value. That
  // takes street addresses with it -- deliberately: an address whose two
  // spellings differ only in how much of the locality they print now comes
  // back as a conflict the operator settles in one edit, instead of a merge
  // nobody is told about.
  assert.equal(isNameLike("1-70000000001"), false);
  assert.equal(isNameLike("Rp 5.000.000"), false);
  assert.equal(isNameLike("10 Mbps"), false);
  assert.equal(isNameLike("Jl Contoh No 1 RT 002 RW 003"), false);
});

// ---------------------------------------------------------------------------
// JENIS ORDER.
//
// `scripts/generate.mjs` used to ship `jenisOrder: AO_TEMPLATE.id`, so every
// run put "AO" in a header cell a validator signs. The second client bundle
// (2026-09-03 findings, section 1) is an MO. These tests pin the two halves of
// the fix: the preference order between real sources, and the refusal to
// invent one when none of them answers.
// ---------------------------------------------------------------------------

import {
  jenisOrderCandidates,
  outstandingHeaderFields,
  resolveJenisOrder,
} from "../src/lib/pipeline/jenis-order.ts";

/** A page carrying only what the JENIS ORDER scan reads off one. */
function textPage(texts, sourceName = "bundle.pdf", pageInDoc = 0) {
  return {
    sourceName,
    pageInDoc,
    lines: texts.map((text, i) => ({ i, text })),
  };
}

test("resolveJenisOrder never defaults, and says so in a sentence an operator can act on", () => {
  const nothing = resolveJenisOrder({});
  // The whole point. "AO" here is the shipped bug.
  assert.equal(nothing.value, "");
  assert.equal(nothing.origin, "none");
  assert.match(nothing.detail, /--jenis-order/);

  // And a blank cell is reported by name rather than shipping silently: it has
  // no fieldKey and no crop, so neither outstandingFields nor outstandingSlots
  // can see it.
  const reported = outstandingHeaderFields(nothing);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].kind, "header");
  assert.equal(reported[0].key, "jenisOrder");
  assert.equal(reported[0].reason, nothing.detail);

  // A resolved cell is not outstanding.
  assert.deepEqual(
    outstandingHeaderFields({ value: "MO", origin: "flag", detail: "" }),
    [],
  );
});

test("resolveJenisOrder prefers the operator, then the order request, then the documents", () => {
  const pages = [textPage(["JENIS ORDER : AO"])];
  const orderRequest = { jenisOrder: "DO" };

  // Every source present: the flag wins, because it is the only one the
  // operator can be told out of band.
  assert.equal(
    resolveJenisOrder({ flag: "MO", env: "RO", orderRequest, pages }).value,
    "MO",
  );
  assert.equal(
    resolveJenisOrder({ env: "RO", orderRequest, pages }).value,
    "RO",
  );
  const fromRequest = resolveJenisOrder({ orderRequest, pages });
  assert.equal(fromRequest.value, "DO");
  assert.equal(fromRequest.origin, "order-request");

  // The documents answer only when nothing better did, and the answer carries
  // the page and line it was read off -- an inferred header cell nobody can
  // check is worth less than a blank one.
  const inferred = resolveJenisOrder({ pages });
  assert.equal(inferred.value, "AO");
  assert.equal(inferred.origin, "documents");
  // p1, not p0: `pageInDoc` is a 0-based index and the LABEL is a page
  // number, because an operator holding the paper counts from one. See
  // `sourceLabel` for why the field stays an index.
  assert.match(inferred.detail, /bundle\.pdf p1 line 0/);

  // An empty or whitespace-only override is not an answer, so it falls through
  // instead of shipping a blank cell that claims to have been set by hand.
  assert.equal(resolveJenisOrder({ flag: "   ", env: "", pages }).value, "AO");
});

test("resolveJenisOrder blanks a JENIS ORDER two documents disagree about", () => {
  const pages = [
    textPage(["JENIS ORDER : MO"], "renewal.pdf"),
    textPage(["Jenis Order: AO"], "base-agreement.pdf", 4),
  ];

  // A renewal's base agreement naming the ORIGINAL activation reads exactly
  // like an answer. Picking either one is the failure this project is
  // organised against, so both are named and the cell ships blank.
  const conflict = resolveJenisOrder({ pages });
  assert.equal(conflict.value, "");
  assert.equal(conflict.origin, "conflict");
  assert.match(conflict.detail, /MO on renewal\.pdf p1/);
  assert.match(conflict.detail, /AO on base-agreement\.pdf p5/);
  assert.equal(outstandingHeaderFields(conflict).length, 1);

  // The same value printed twice is one answer, not a disagreement.
  assert.equal(
    resolveJenisOrder({
      pages: [textPage(["JENIS ORDER : MO"]), textPage(["Jenis order MO"])],
    }).value,
    "MO",
  );
});

test("jenisOrderCandidates refuses a printed list of options and reports what it saw", () => {
  // A blank form's menu. Taking its first token would fill the cell with "AO"
  // on every bundle regardless of the order -- the same confidently-wrong
  // shape as the hard-coded line, sourced from a document instead.
  for (const menu of [
    "JENIS ORDER : AO / MO / DO",
    "Jenis Order: AO/MO/DO",
    "JENIS ORDER : AO, MO, DO",
    // EVERY SEPARATOR, not just punctuation. The first guard here matched `/`,
    // `|` and `,` immediately after the first code, so it recognised the menu
    // under one punctuation class out of several: all five spellings below
    // resolved to a confident {value:"AO", origin:"documents"} carrying a page
    // and line citation that made it read as verified. The first is what an
    // unticked tick-box row OCRs to, which is the case the guard's own
    // docstring says it exists for.
    "JENIS ORDER    AO    MO    DO",
    "JENIS ORDER : AO   MO   DO",
    "Jenis Order : AO ( ) MO ( ) DO ( )",
    "JENIS ORDER : AO - MO - DO",
    "JENIS ORDER : AO atau MO",
  ]) {
    const [candidate] = jenisOrderCandidates([textPage([menu])]);
    assert.equal(candidate.value, "", menu);
    assert.ok(candidate.raw.startsWith("AO"), menu);
  }

  // ... and the operator is told the label was there and what stood beside it,
  // which is what turns a blank cell into a question answerable in one look.
  const seen = resolveJenisOrder({
    pages: [textPage(["JENIS ORDER : AO / MO / DO"])],
  });
  assert.equal(seen.value, "");
  assert.match(seen.detail, /label was found/);
  assert.match(seen.detail, /AO \/ MO \/ DO/);

  // A label with nothing beside it is not a candidate at all.
  assert.deepEqual(jenisOrderCandidates([textPage(["JENIS ORDER :"])]), []);
  assert.deepEqual(jenisOrderCandidates([textPage(["ID EPIC : LOP999001"])]), []);
});

test("jenisOrderCandidates reads the spellings the two bundles actually print", () => {
  const read = (text) => jenisOrderCandidates([textPage([text])])[0]?.value;

  assert.equal(read("JENIS ORDER : MO"), "MO");
  assert.equal(read("Jenis Order MO"), "MO");
  assert.equal(read("JENISORDER: mo"), "MO");
  // Bundle two's order request spells the label with a parenthetical. Without
  // that branch the value beside it fails the code shape and is thrown away.
  assert.equal(read("Jenis order (yang diminta) MO"), "MO");
  // A code followed by its expansion is still that code.
  assert.equal(read("JENIS ORDER : MO (Modify Order)"), "MO");
  // The code set is open, so an unfamiliar one is read rather than dropped:
  // a closed list would silently blank a real order type. Two or three
  // upper-case letters is the shape of an abbreviation, which is as much as
  // can be checked without one.
  assert.equal(read("JENIS ORDER : RO"), "RO");
  assert.equal(read("JENIS ORDER MO"), "MO");
  assert.equal(read("Jenis order (yang diminta) : MO"), "MO");
  assert.equal(read("JENIS ORDER : AO (Activation Order)"), "AO");
});

test("jenisOrderCandidates refuses an ordinary heading that happens to carry the label", () => {
  const read = (text) => jenisOrderCandidates([textPage([text])])[0]?.value;

  // `JENIS_ORDER_CODE` accepts any two-to-four letter word, so before the
  // shape and trailer guards each of these put an Indonesian conjunction or
  // adjective in a header cell a validator signs -- with origin "documents"
  // and a page-and-line citation, and reported outstanding nowhere, because
  // `outstandingHeaderFields` returns [] whenever the value is non-empty.
  // Measured then: "DAN", "YANG", "YANG", "BARU" in that order.
  assert.equal(read("JENIS ORDER DAN LAYANAN"), "");
  assert.equal(read("JENIS ORDER YANG DIMINTA"), "");
  assert.equal(read("Jenis order yang diminta"), "");
  assert.equal(read("Jenis Order Baru"), "");

  // The spec quotes bundle two's request column as "Jenis order (yang
  // diminta)"; the same wording WITHOUT the parentheses is prose, so the
  // value after it ships blank-and-asked rather than as "YANG". A real MO is
  // lost here, and that is the trade: the operator sees the raw text in the
  // outstanding report and answers with one flag, where the old behaviour
  // shipped a conjunction nobody was ever asked about.
  const prose = resolveJenisOrder({
    pages: [textPage(["Jenis Order yang diminta : MO"])],
  });
  assert.equal(prose.value, "");
  assert.match(prose.detail, /label was found/);
  assert.match(prose.detail, /yang diminta : MO/);
  assert.equal(outstandingHeaderFields(prose).length, 1);

  // And the second-order cost of the old behaviour: a prose false positive
  // anywhere in the bundle turned a correctly-read MO into a disagreement and
  // blanked a cell that was right. It now reads MO.
  assert.equal(
    resolveJenisOrder({
      pages: [
        textPage(["Jenis order yang diminta"], "request.pdf"),
        textPage(["JENIS ORDER : MO"], "form.pdf"),
      ],
    }).value,
    "MO",
  );
});

test("parseArgs takes --jenis-order and refuses a value that is another option", () => {
  assert.equal(parseArgs(["package.json"]).jenisOrder, undefined);
  assert.equal(
    parseArgs(["package.json", "--jenis-order", " MO "]).jenisOrder,
    "MO",
  );

  // `--jenis-order --out dir` has no filesystem check to catch it downstream:
  // unguarded it would print "--out" in the header cell and exit 0.
  assert.throws(
    () => parseArgs(["package.json", "--jenis-order", "--out", "somewhere"]),
    /--jenis-order needs a value/,
  );
  assert.throws(
    () => parseArgs(["package.json", "--jenis-order"]),
    /--jenis-order needs a value/,
  );
});

// ---------------------------------------------------------------------------
// A VALUE WITH NOWHERE TO LAND.
//
// `buildXlsx` keys values by fieldKey and walks `template.xlsxRows`, so a key
// with no row is simply never written. `AO_TEMPLATE` declares four
// fieldKey-bearing rows; `REQUEST_COLUMN_FIELD_KEYS` maps sixteen columns. The
// drop used to be silent in all three places an operator looks, while the run
// log and `report.orderRequest.answered` both presented the key as answered.
// ---------------------------------------------------------------------------

import { unmappedFieldValues } from "./generate.mjs";

const requestValue = (fieldKey, value) => ({
  fieldKey,
  value,
  requestSource: {
    file: "request.xlsx",
    sheet: "Sheet1",
    rows: [3],
    column: "K",
    header: "Term of Payment",
  },
});

test("unmappedFieldValues names exactly the values the workbook cannot carry", async () => {
  const values = [
    // Backed by an xlsxRow in AO_TEMPLATE, so it lands and is not reported.
    requestValue("alamat", "Jl Contoh 1"),
    // No row anywhere in the form. Measured before this guard: the run logged
    // it as a shipped value, listed it under orderRequest.answered, and the
    // workbook carried no such cell.
    requestValue("termOfPayment", "Monthly postpaid"),
    requestValue("bandwidth", "172 Mbps"),
  ];

  const outstanding = unmappedFieldValues(AO_TEMPLATE, values);
  assert.deepEqual(
    outstanding.map((entry) => entry.key),
    ["termOfPayment", "bandwidth"],
  );
  assert.equal(outstanding[0].kind, "unmapped");
  // The reason has to carry the value itself: the workbook does not, so this
  // report is the only place the operator can read what was found.
  assert.match(outstanding[0].reason, /Monthly postpaid/);
  assert.match(outstanding[0].reason, /no xlsx row/);
  // And where it came from, so they know which input to fix.
  assert.match(outstanding[0].reason, /order request \(K, "Term of Payment"\)/);

  // The claim is measured against the exporter rather than asserted: every
  // key this function does NOT report is a key that reaches column E, and
  // every key it does report reaches no cell at all.
  const workbook = new exceljs.Workbook();
  await workbook.xlsx.load(await buildXlsx(AO_TEMPLATE, values));
  const columnE = [];
  workbook.getWorksheet("Order Config").eachRow((row) => {
    const text = String(row.getCell(5).value ?? "");
    if (text !== "") columnE.push(text);
  });
  assert.ok(columnE.includes("Jl Contoh 1"));
  assert.ok(!columnE.includes("Monthly postpaid"));
  assert.ok(!columnE.includes("172 Mbps"));
});

test("unmappedFieldValues reports nothing for a blank or a blanked conflict", () => {
  // A blanked conflict was never going to fill a cell and is already reported
  // on its own CONFLICT line; counting it here would report one gap twice and
  // as the wrong kind.
  assert.deepEqual(
    unmappedFieldValues(AO_TEMPLATE, [
      { fieldKey: "termOfPayment", value: "", conflict: ["a", "b"] },
      { fieldKey: "bandwidth", value: "   " },
    ]),
    [],
  );

  // One entry per key, not one per value: a key answered by two rows of a
  // multi-service request is one gap.
  const twice = unmappedFieldValues(AO_TEMPLATE, [
    requestValue("layanan", "METRO E"),
    requestValue("layanan", "METRO E"),
  ]);
  assert.equal(twice.length, 1);
});

// ---------------------------------------------------------------------------
// --template: the docx path that keeps the form's header, theme, Normal style
// and table borders (2026-09-03 findings, section 3).
// ---------------------------------------------------------------------------

import { manifestPathFor } from "./generate.mjs";

test("parseArgs takes --template and finds its manifest beside it", () => {
  assert.equal(parseArgs(["package.json"]).templatePath, undefined);

  // The manifest is DERIVED, never asked for separately: a second flag is a
  // second thing to get wrong, and a manifest from a different form's
  // template pairs positionally with this one's rows.
  assert.equal(
    manifestPathFor("/x/Form_Validasi.template.docx"),
    "/x/Form_Validasi.template.json",
  );
  assert.equal(manifestPathFor("/x/Form.template.DOCX"), "/x/Form.template.json");

  // Both halves are checked at parse time rather than at the export, which is
  // thousands of model tokens and several minutes downstream.
  assert.throws(
    () => parseArgs(["package.json", "--template", "no-such-form.template.docx"]),
    /no such file: /,
  );
  // package.json exists, so this gets past the docx check and fails on the
  // manifest -- which is the message that has to say where the file goes.
  assert.throws(
    () => parseArgs(["package.json", "--template", "package.json"]),
    /--template needs its manifest beside it/,
  );
  assert.throws(
    () => parseArgs(["package.json", "--template"]),
    /--template needs a docx/,
  );
});
