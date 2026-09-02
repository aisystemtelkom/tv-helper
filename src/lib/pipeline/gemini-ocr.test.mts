/**
 * `gemini-ocr.ts`: the reply-to-`Line[]` conversion, and the producer contract
 * `assertLinesWellFormed` states.
 *
 * ENTIRELY OFFLINE. Every case here drives `linesFromGeminiReply` with a
 * fixture reply STRING, so no credential, no network and no model are
 * involved. `pnpm test` makes no API calls today, and OCR becoming a model
 * reply is not a licence to change that -- a suite that needs a key is a suite
 * that stops being run.
 *
 * Every string in these fixtures is invented. The fictional set this repo uses
 * throughout is LOP999001, 1-70000000001, BANK CONTOH NUSANTARA and
 * PSB VPN IP KCP Contoh; nothing here is lifted from `documents/`, which is
 * real client material in a public repo.
 *
 * What these protect is the thing a human validator signs. A box scaled by one
 * factor instead of two, a paragraph's bands assigned one printed line off, or
 * two side-by-side headings swapping line number between runs each produce a
 * document that opens fine and carries the wrong evidence.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { encodePng } from "../export/png.ts";
import { assertLinesWellFormed, type Line } from "./geometry.ts";
import {
  IncompletePageError,
  checkPageCompleteness,
  inkRowProfile,
  linesFromGeminiReply,
  ocrPageCompletely,
  pageGeometry,
  pngDimensions,
  repairDoubledKeys,
  type ImageInput,
  type RecognizePage,
} from "./gemini-ocr.ts";
import type { RenderedPage } from "./render.ts";

/** A deliberately non-square page, so a single scale factor cannot pass. */
const W = 400;
const H = 1000;

type Entry = {
  box_2d: unknown;
  text?: string;
  text_content?: string;
  label?: string;
};

function reply(entries: Entry[]): string {
  return JSON.stringify({ lines: entries });
}

test("a box_2d converts with two independent scale factors", () => {
  // 0-1000 normalized, [ymin, xmin, ymax, xmax]. On a 400x1000 page:
  //   x = 250/1000 * 400 = 100      w = (750-250)/1000 * 400 = 200
  //   y = 100/1000 * 1000 = 100     h = (200-100)/1000 * 1000 = 100
  // A single scalar would put x and w at 100 and 500 (page width used for
  // both axes) or 25 and 50 (page height used for both) -- a clean, complete
  // looking picture of the wrong part of the page.
  const { lines, report } = linesFromGeminiReply(
    reply([{ box_2d: [100, 250, 200, 750], text: "BANK CONTOH NUSANTARA" }]),
    W,
    H,
  );

  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].box, { x: 100, y: 100, w: 200, h: 100 });
  assert.equal(lines[0].text, "BANK CONTOH NUSANTARA");
  assert.equal(lines[0].origin, "measured");
  assert.equal(report.interpolatedLines, 0);
  assert.equal(report.degraded, false);
});

test("a three-line block splits into bands whose union is the original box", () => {
  const box = { x: 40, y: 300, w: 360, h: 150 };
  const { lines, report } = linesFromGeminiReply(
    reply([
      {
        // 300..450 of 1000 tall -> y 300, h 150. 100..1000 of 1000 wide on a
        // 400px page -> x 40, w 360. Three bands of 50px, which is the shape a
        // real three-line paragraph has: a band about two of its own character
        // widths tall. Making it 100px tall for the same 26-character lines
        // would be a paragraph-sized rectangle per printed line, and
        // `COLLAPSED_TEXT_ASPECT` would rightly say so.
        box_2d: [300, 100, 450, 1000],
        text: "Nomor Kesepakatan: LOP999001\nNomor Quote: 1-70000000001\nProyek: PSB VPN IP KCP Contoh",
      },
    ]),
    W,
    H,
  );

  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.map((l) => l.text),
    [
      "Nomor Kesepakatan: LOP999001",
      "Nomor Quote: 1-70000000001",
      "Proyek: PSB VPN IP KCP Contoh",
    ],
  );
  // Top to bottom, contiguous, and summing to exactly the block's own box.
  assert.deepEqual(
    lines.map((l) => l.box),
    [
      { x: 40, y: 300, w: 360, h: 50 },
      { x: 40, y: 350, w: 360, h: 50 },
      { x: 40, y: 400, w: 360, h: 50 },
    ],
  );
  assert.equal(lines[0].box.y, box.y);
  assert.equal(
    lines[2].box.y + lines[2].box.h,
    box.y + box.h,
    "interpolation redistributes a measured rectangle, it never adds area",
  );
  // Every one of them is a slice, not a returned box, and says so.
  assert.deepEqual(
    lines.map((l) => l.origin),
    ["interpolated", "interpolated", "interpolated"],
  );
  assert.equal(report.blocks, 1);
  assert.equal(report.segments, 3);
  assert.equal(report.interpolatedLines, 3);
  // Three of three lines interpolated, and the report says so as a NUMBER and
  // raises nothing. The old "over half this page's lines are sliced" alarm was
  // deleted on measurement: it fired on 21 of the gate bundle's 29 pages,
  // healthy ones included, and stayed silent on both pages that were genuinely
  // under-read. An alarm that fires on the majority of healthy inputs is not an
  // alarm, and this assertion is what stops it being reinstated by feel.
  assert.equal(report.degraded, false);
  assert.deepEqual(report.reasons, []);
});

test("a blank segment keeps the surviving segments on their own bands", () => {
  // The whole reason bands are assigned before blanks are dropped: dropping
  // first would put "Kepada" on band 0 and this line on band 1, one printed
  // line above where it is.
  const { lines } = linesFromGeminiReply(
    reply([
      {
        box_2d: [0, 0, 300, 1000],
        text: "Kepada\n\nBANK CONTOH NUSANTARA",
      },
    ]),
    W,
    H,
  );

  assert.deepEqual(
    lines.map((l) => ({ text: l.text, y: l.box.y, h: l.box.h })),
    [
      { text: "Kepada", y: 0, h: 100 },
      { text: "BANK CONTOH NUSANTARA", y: 200, h: 100 },
    ],
  );
});

test("an edge newline is not a printed line and must not consume a band", () => {
  // The mirror image of the case above, and the reasoning runs the OTHER way.
  // An interior blank IS a printed line and must hold its band; a leading or
  // trailing newline is a stray in the transcription, and the model's box
  // bounds ink, so there is no band above the first glyph or below the last
  // one for it to occupy.
  //
  // Counting it splits the block into one band too many and shifts every line
  // in it up by an accumulating fraction of a line -- and nothing throws: the
  // bands stay finite, on-page, contiguous and plausibly placed, so the docx
  // gets a picture that opens fine and shows the line above the one its
  // citation names.
  const threeLines = [
    "Nomor Kesepakatan: LOP999001",
    "Nomor Quote: 1-70000000001",
    "Proyek: PSB VPN IP KCP Contoh",
  ].join("\n");
  const want = [
    { y: 300, h: 100 },
    { y: 400, h: 100 },
    { y: 500, h: 100 },
  ];

  for (const text of [
    threeLines,
    `${threeLines}\n`,
    `\n${threeLines}`,
    `\r\n${threeLines}\r\n`,
  ]) {
    const { lines, report } = linesFromGeminiReply(
      reply([{ box_2d: [300, 100, 600, 900], text }]),
      W,
      H,
    );
    const where = JSON.stringify(text.slice(0, 4));
    assert.equal(lines.length, 3, `three printed lines, whatever pads them (${where})`);
    assert.deepEqual(
      lines.map((l) => ({ y: l.box.y, h: l.box.h })),
      want,
      `an edge newline must not shift the bands (${where})`,
    );
    assert.equal(report.segments, 3);
  }
});

test("a trailing newline on a single-line entry does not halve its box", () => {
  // The worst version of the same defect. One trailing newline made this a
  // two-band block: the line kept the TOP half of the rectangle the model
  // measured, so the crop clipped the bottom of every glyph -- and reported
  // itself as "interpolated", putting the plate's "sliced, not measured" chip
  // on a box that was measured.
  for (const text of [
    "BANK CONTOH NUSANTARA",
    "BANK CONTOH NUSANTARA\n",
    "\nBANK CONTOH NUSANTARA",
  ]) {
    const { lines, report } = linesFromGeminiReply(
      reply([{ box_2d: [100, 250, 200, 750], text }]),
      W,
      H,
    );
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].box, { x: 100, y: 100, w: 200, h: 100 });
    assert.equal(lines[0].text, "BANK CONTOH NUSANTARA");
    assert.equal(lines[0].origin, "measured");
    assert.equal(report.interpolatedLines, 0);
  }
});

test("an entry that transcribed to nothing contributes no line and is not a box failure", () => {
  // Skipped rather than counted against the convention guard: an empty
  // transcription says nothing about the coordinate convention, and counting
  // it would fire the guard on a page of empty stamp outlines.
  const { lines, report } = linesFromGeminiReply(
    reply([
      { box_2d: [100, 100, 140, 400], text: "LOP999001" },
      { box_2d: [200, 100, 240, 400], text: "   \n\n  " },
    ]),
    W,
    H,
  );

  assert.deepEqual(lines.map((l) => l.text), ["LOP999001"]);
  assert.equal(report.droppedEntries, 0);
  assert.equal(report.blocks, 2);
});

test("the doubled key gemini-3.5-flash really emits is repaired, not thrown on", () => {
  // MEASURED, on a synthetic page, with this module's own OCR_PROMPT: the
  // model welds its object-detection format onto the asked-for key and emits
  //   {"box_2d": [...], "label": "text": "..."}
  // which is a JSON syntax error, so `extractJson` took the whole page -- and
  // with it the run -- down on the first real reply. It arrived on 5 of 8
  // whole-page calls across four prompt variants, so it is the common case.
  // Rewording the prompt does not displace it; see `repairDoubledKeys`.
  const welded = [
    '{"lines": [',
    '  {"box_2d": [100, 250, 140, 750], "text": "BERITA ACARA PERMINTAAN ORDER"},',
    '  {"box_2d": [200, 250, 240, 750], "label": "text": "Nama Pelanggan : BANK CONTOH NUSANTARA"},',
    '  {"box_2d": [300, 250, 340, 750], "label": "text": "Nomor Quote : 1-70000000001"}',
    "]}",
  ].join("\n");

  const { lines, report } = linesFromGeminiReply(welded, W, H);
  assert.equal(report.droppedEntries, 0);
  assert.deepEqual(
    lines.map((l) => l.text),
    [
      "BERITA ACARA PERMINTAAN ORDER",
      "Nama Pelanggan : BANK CONTOH NUSANTARA",
      "Nomor Quote : 1-70000000001",
    ],
  );
});

test("a clean `label` key is accepted, and a label VALUE is never mistaken for one", () => {
  // The model follows whichever key the prompt names but reaches for `label`
  // on its own often enough to be worth accepting outright.
  const { lines } = linesFromGeminiReply(
    reply([{ box_2d: [100, 250, 140, 750], label: "LOP999001" } as never]),
    W,
    H,
  );
  assert.deepEqual(lines.map((l) => l.text), ["LOP999001"]);

  // The repair keys on a quoted string FOLLOWED BY A COLON, so a legitimate
  // transcription -- including one with a colon inside it -- is untouched.
  // Getting this wrong would silently delete a real key and its value.
  assert.equal(
    repairDoubledKeys('{"label": "Nomor LOP: LOP999001"}'),
    '{"label": "Nomor LOP: LOP999001"}',
  );
  assert.equal(
    repairDoubledKeys('{"label": "ok", "text": "v"}'),
    '{"label": "ok", "text": "v"}',
  );
});

test("the produced lines satisfy the whole drop-in contract", () => {
  const { lines } = linesFromGeminiReply(
    reply([
      { box_2d: [40, 100, 70, 900], text: "BERITA ACARA PERMINTAAN ORDER" },
      { box_2d: [120, 100, 150, 400], text: "Nomor" },
      { box_2d: [120, 500, 150, 900], text: "LOP999001" },
      {
        box_2d: [200, 100, 320, 900],
        text: "Pelanggan: BANK CONTOH NUSANTARA\nQuote: 1-70000000001\nProyek: PSB VPN IP KCP Contoh",
      },
      { box_2d: [900, 400, 930, 600], text: "Halaman 1 dari 2" },
    ]),
    W,
    H,
  );

  // Dense, 0-based, equal to the array position -- what boxForLineRange's
  // count check and the three `lineRange: [0, lines.length - 1]` sites need.
  lines.forEach((line, k) => assert.equal(line.i, k));

  // Array order is reading order.
  for (let k = 1; k < lines.length; k++) {
    assert.ok(
      lines[k].box.y >= lines[k - 1].box.y,
      `lines[${k}] is above lines[${k - 1}]`,
    );
  }

  for (const line of lines) {
    const { x, y, w, h } = line.box;
    assert.ok([x, y, w, h].every(Number.isFinite), "box must be finite");
    assert.ok(w > 0 && h > 0, "box must have area");
    assert.ok(x >= 0 && y >= 0 && x + w <= W && y + h <= H, "box must be on-page");
  }

  // The same rules, from the function that states them for every producer.
  assertLinesWellFormed(lines, W, H);
});

test("two entries at one y merge into one line in x order, whatever order the reply listed them", () => {
  // The measured defect this fixes: two side-by-side BA-form headings swapped
  // index between two identical runs, so a stored citation changed meaning on
  // re-export. Both entries land in the same overlap row and are ordered by x.
  const left = { box_2d: [100, 50, 140, 300], text: "BANK CONTOH NUSANTARA" };
  const right = { box_2d: [100, 500, 140, 800], text: "LOP999001" };

  const forward = linesFromGeminiReply(reply([left, right]), W, H).lines;
  const reversed = linesFromGeminiReply(reply([right, left]), W, H).lines;

  assert.equal(forward.length, 1);
  assert.equal(forward[0].text, "BANK CONTOH NUSANTARA LOP999001");
  assert.deepEqual(reversed, forward);
});

test("a fenced reply parses", () => {
  const fenced = [
    "Here is the page:",
    "```json",
    reply([{ box_2d: [10, 20, 60, 400], text: "PSB VPN IP KCP Contoh" }]),
    "```",
  ].join("\n");

  const { lines } = linesFromGeminiReply(fenced, W, H);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "PSB VPN IP KCP Contoh");
});

test("a reversed range, a non-finite coordinate and an off-page box are dropped and counted", () => {
  const { lines, report } = linesFromGeminiReply(
    reply([
      { box_2d: [100, 100, 140, 400], text: "BANK CONTOH NUSANTARA" },
      // ymax below ymin.
      { box_2d: [300, 100, 200, 400], text: "reversed" },
      // 1e999 is legal JSON and parses to Infinity, which is how a non-finite
      // coordinate actually arrives -- a literal NaN would not survive
      // JSON.parse at all.
      { box_2d: [400, 100, 1e999, 400], text: "not finite" },
      // Entirely below the page once scaled.
      { box_2d: [1100, 100, 1200, 400], text: "off the page" },
      { box_2d: [500, 100, 540, 400], text: "LOP999001" },
    ]),
    W,
    H,
  );

  assert.equal(report.blocks, 5);
  assert.equal(report.droppedEntries, 3);
  assert.equal(report.degraded, true);
  assert.match(report.reasons.join(" "), /3 of 5 entries failed box validation/);
  assert.deepEqual(
    lines.map((l) => l.text),
    ["BANK CONTOH NUSANTARA", "LOP999001"],
  );
});

test("a reply in pixel coordinates throws instead of returning a few survivors", () => {
  // A real A4 scan at the pipeline's 300 DPI, which is the page this failure
  // mode was reasoned about on. A model answering in raw pixels puts almost
  // every box below y=1000, and scaling those as if they were 0-1000 throws
  // them off the bottom of the page, where they collapse to zero height.
  //
  // The two entries near the top of the page DO survive, and that is exactly
  // why this has to throw rather than return them: a page that quietly came
  // back with the first two lines of a form reads downstream as a sparse scan,
  // not as an engine speaking a different coordinate convention.
  const scanW = 2480;
  const scanH = 3507;
  const pixels: Entry[] = [
    { box_2d: [200, 300, 240, 2100], text: "BERITA ACARA PERMINTAAN ORDER" },
    { box_2d: [700, 300, 740, 1000], text: "Nomor" },
    { box_2d: [1200, 300, 1240, 2100], text: "LOP999001" },
    { box_2d: [1700, 300, 1740, 2100], text: "BANK CONTOH NUSANTARA" },
    { box_2d: [2200, 300, 2240, 2100], text: "1-70000000001" },
    { box_2d: [2700, 300, 2740, 2100], text: "PSB VPN IP KCP Contoh" },
    { box_2d: [3000, 1000, 3040, 1500], text: "Halaman 1 dari 2" },
    { box_2d: [3300, 300, 3340, 2100], text: "Dokumen validasi" },
  ];

  assert.throws(
    () => linesFromGeminiReply(reply(pixels), scanW, scanH),
    /failed box validation/,
  );
});

test("a truncated reply throws", () => {
  const truncated =
    '{"lines":[{"box_2d":[100,100,140,400],"text":"BANK CONTOH NUSANTARA"},{"box_2d":[200,100,24';

  assert.throws(() => linesFromGeminiReply(truncated, W, H));
});

test("the image's dimensions are read back out of its own IHDR", async () => {
  const png = await encodePng(new Uint8ClampedArray(7 * 3 * 4), 7, 3);
  assert.deepEqual(pngDimensions(png), { width: 7, height: 3 });

  assert.throws(() => pngDimensions(new Uint8Array(24)), /signature/);
  assert.throws(() => pngDimensions(png.subarray(0, 20)), /shorter than/);
});

function lineAt(i: number, y: number, box?: Partial<Line["box"]>): Line {
  const full = { x: 10, y, w: 100, h: 20, ...box };
  return { i, text: `line ${i}`, box: full, words: [{ text: `line ${i}`, box: full }] };
}

test("assertLinesWellFormed rejects every way a producer can go quietly wrong", () => {
  assert.doesNotThrow(() =>
    assertLinesWellFormed([lineAt(0, 10), lineAt(1, 40), lineAt(2, 40)], W, H),
  );

  // A gap in `i`: boxForLineRange would throw on some ranges and the three
  // `[0, lines.length - 1]` sites would cite the wrong text on all of them.
  assert.throws(
    () => assertLinesWellFormed([lineAt(0, 10), lineAt(2, 40)], W, H),
    /lines\[1\]\.i is 2, not 1/,
  );

  // Numbered from 1 rather than 0: dense, ordered, and still wrong.
  assert.throws(
    () => assertLinesWellFormed([lineAt(1, 10), lineAt(2, 40)], W, H),
    /lines\[0\]\.i is 1, not 0/,
  );

  assert.throws(
    () => assertLinesWellFormed([lineAt(0, 10, { w: 500 })], W, H),
    /escapes the 400x1000 page/,
  );

  assert.throws(
    () => assertLinesWellFormed([lineAt(0, 10, { h: Number.NaN })], W, H),
    /is not finite/,
  );

  assert.throws(
    () => assertLinesWellFormed([lineAt(0, 10, { h: 0 })], W, H),
    /no area/,
  );

  assert.throws(
    () => assertLinesWellFormed([lineAt(0, 400), lineAt(1, 100)], W, H),
    /array order is reading order/,
  );
});

// --- Two malformations measured on a real page, after the suite was first
// written. Both took a whole page down; both are one entry's problem.

test("a box_2d that arrives as a STRING drops that entry, not the page", () => {
  // Measured on a real 300 DPI contract page: one entry of 24 came back with
  // box_2d as a string, and `z.array(...)` in the schema rejected the whole
  // reply for it. Twenty-three good lines discarded over one bad entry is the
  // opposite of the packaging/content split this module documents.
  const { lines, report } = linesFromGeminiReply(
    reply([
      { box_2d: [100, 250, 200, 750], text: "BANK CONTOH NUSANTARA" },
      { box_2d: "[300, 250, 400, 750]", text: "LOP999001" },
      { box_2d: [500, 250, 600, 750], text: "1-70000000001" },
    ]),
    W,
    H,
  );
  assert.equal(lines.length, 2, "the two well-formed entries survive");
  assert.equal(report.droppedEntries, 1);
  assert.deepEqual(
    lines.map((l) => l.text),
    ["BANK CONTOH NUSANTARA", "1-70000000001"],
  );
  // Still a dense, ordered, on-page set after the drop.
  assertLinesWellFormed(lines, W, H);
});

test("text_content is accepted, and text wins over label", () => {
  // Gemini substitutes `text_content` wholesale on some pages, and emits
  // `label` ALONGSIDE it carrying a short region name rather than the
  // transcription. Taking `label` first would replace a line of text with the
  // word "footer".
  const { lines } = linesFromGeminiReply(
    reply([
      { box_2d: [100, 250, 200, 750], text_content: "PSB VPN IP KCP Contoh" },
      { box_2d: [300, 250, 400, 750], label: "footer", text: "LOP999001" },
      { box_2d: [500, 250, 600, 750], label: "BANK CONTOH NUSANTARA" },
    ]),
    W,
    H,
  );
  assert.deepEqual(
    lines.map((l) => l.text),
    ["PSB VPN IP KCP Contoh", "LOP999001", "BANK CONTOH NUSANTARA"],
  );
});

test("an entry with no transcription key at all still throws for the reply", () => {
  // Widening to three spellings must not widen what is ACCEPTED: an entry
  // carrying none of them is a packaging failure, not one entry's content.
  // A page that quietly came back with fewer lines is the failure this module
  // exists to refuse, so this stays a throw for the whole reply rather than
  // joining the drop-and-count path that a bad BOX takes.
  assert.throws(
    () =>
      linesFromGeminiReply(
        reply([{ box_2d: [100, 250, 200, 750] }]),
        W,
        H,
      ),
    /text_content/,
  );
});

// --- The two silent under-read modes, measured on the 2026-09-02 gate run and
// invisible to everything that existed before it.
//
// Both pages that came back materially incomplete did so with
// `finishReason=STOP`, zero dropped entries, output far under the 16384 cap and
// no flag anywhere. The other 27 pages read at 0.94x to 1.32x tesseract's
// character volume, median 1.03x -- Gemini normally reads MORE than tesseract,
// which is exactly what makes a short read hard to see.
//
// Every fixture below is arithmetic on invented content: `ordinaryLine` is a
// 300x20 box carrying 19 characters, so a page of them has one median line
// height and one density, and a deviation from either is a number this suite
// can state exactly rather than approximately.

/** A 300x20 box at 19 ink characters, the "normal printed line" of these tests. */
function ordinaryLine(k: number): Entry {
  const top = 60 * k + 10;
  return { box_2d: [top, 250, top + 20, 1000], text: "BANK CONTOH NUSANTARA" };
}

test("a healthy page raises nothing, and says how much it read and how far down", () => {
  const { report } = linesFromGeminiReply(
    reply(Array.from({ length: 14 }, (_, k) => ordinaryLine(k))),
    W,
    H,
  );

  assert.equal(report.lines, 14);
  assert.equal(report.collapsedBlocks, 0);
  assert.equal(report.degraded, false);
  assert.deepEqual(report.reasons, []);

  // 14 lines of 19 ink characters. Whitespace is not transcription.
  assert.equal(report.transcribedChars, 14 * 19);
  // The lowest returned box bottom, over the page height: 60*13 + 10 + 20 of
  // 1000. This is the number that separated `merged:19` (0.514) from the 27
  // healthy pages of the gate bundle (0.94-0.99), and nothing else did.
  assert.equal(report.verticalCoverage, 0.81);
  assert.equal(report.medianLineHeight, 20);
  // Every line prints at the same density, so the page prints at that density.
  assert.ok(Math.abs(report.lineDensityRatio - 1) < 1e-9);
});

test("collapsed blocks are counted: a paragraph-sized box holding one printed line", () => {
  // MECHANISM (b), and the one that currently reads as completely clean. The
  // returned text carries no newline, so `printedSegments` sees one segment,
  // `bandsFor` never splits it, and the line is tagged "measured" -- leaving
  // `droppedEntries` and `interpolatedLines` both at zero while the other four
  // printed lines of that paragraph are simply gone. Measured: 6 such boxes on
  // `splitba:0`, 10 on `merged:20`, 0 or 1 on every healthy page.
  //
  // These two carry 64 characters each, enough that the page's DENSITY stays
  // ordinary (0.84 of a normal line's) -- which is the real `merged:20`, whose
  // ten collapsed blocks carry 179 to 448 characters apiece and whose density
  // came in the highest in the bundle. A count of collapsed blocks is the only
  // thing that sees it.
  const paragraph =
    "PSB VPN IP KCP Contoh untuk BANK CONTOH NUSANTARA di Jakarta nomor LOP999001";
  const { report } = linesFromGeminiReply(
    reply([
      ...Array.from({ length: 10 }, (_, k) => ordinaryLine(k)),
      { box_2d: [600, 250, 700, 1000], text: paragraph },
      { box_2d: [740, 250, 840, 1000], text: paragraph },
    ]),
    W,
    H,
  );

  assert.equal(report.lines, 12);
  assert.equal(report.medianLineHeight, 20);
  // 5x the median line height, one printed segment each.
  assert.equal(report.collapsedBlocks, 2);
  // Nothing else noticed. That is the whole point of counting these.
  assert.equal(report.interpolatedLines, 0);
  assert.equal(report.droppedEntries, 0);
  assert.ok(report.lineDensityRatio > 0.7, "the page still prints densely");

  assert.equal(report.degraded, true);
  assert.equal(report.reasons.length, 1);
  assert.match(report.reasons[0], /collapsed blocks: 2 of 12 lines/);
});

test("a thin page is caught by density even when the collapsed count is not reached", () => {
  // One paragraph-sized box, under the alarm's count of two, carrying nine
  // characters where a normal line of that area would carry several hundred.
  // The count lets it through; the page-shaped view does not. Neither metric
  // subsumes the other, which is why both exist.
  const { report } = linesFromGeminiReply(
    reply([
      ...Array.from({ length: 10 }, (_, k) => ordinaryLine(k)),
      { box_2d: [600, 250, 900, 1000], text: "LOP999001" },
    ]),
    W,
    H,
  );

  assert.equal(report.lines, 11);
  assert.equal(report.collapsedBlocks, 1, "one, so the count alarm stays quiet");
  assert.ok(
    report.lineDensityRatio < 0.7,
    `expected a thin page, measured ${report.lineDensityRatio}`,
  );

  assert.equal(report.degraded, true);
  assert.equal(report.reasons.length, 1);
  assert.match(report.reasons[0], /^thin page: 199 characters/);
});

test("the median-based alarms stay quiet below the line count a median needs", () => {
  // Seven lines, two of them five times the median height and the page at 0.40
  // of a normal line's density. Both of the alarms that compare a line against
  // its own page's median are withheld, because a median over seven lines
  // describes nothing. The measurements are still reported.
  //
  // Neither box is collapsed by the ABSOLUTE rule: 100px tall and 300px wide
  // carrying nine characters is 3 of its own character widths, under the 4 that
  // says a paragraph was swallowed. A short label in a tallish box is a real
  // shape, and the aspect rule is deliberately blind to it.
  const { report } = linesFromGeminiReply(
    reply([
      ...Array.from({ length: 5 }, (_, k) => ordinaryLine(k)),
      { box_2d: [320, 250, 420, 1000], text: "LOP999001" },
      { box_2d: [460, 250, 560, 1000], text: "LOP999002" },
    ]),
    W,
    H,
  );

  assert.equal(report.lines, 7);
  assert.equal(report.collapsedBlocks, 0);
  assert.ok(report.lineDensityRatio < 0.7);
  assert.equal(report.degraded, false);
  assert.deepEqual(report.reasons, []);
});

test("a short page full of paragraph boxes still raises the collapse alarm", () => {
  // THE SUPPRESSION USED TO BE ANTI-CORRELATED WITH SEVERITY: below eight lines
  // every alarm in this module was withheld, and the worse an under-read is the
  // fewer lines survive to be judged. A whole page returning six paragraph-sized
  // boxes carrying one printed line each, plus a footer, reported nothing at all
  // -- no collapsed blocks, no thin page, and a perfect ink coverage if the
  // footer's box reached the bottom.
  //
  // The aspect rule needs no page median, so it fires on exactly that shape.
  const paragraph =
    "PSB VPN IP KCP Contoh untuk BANK CONTOH NUSANTARA di Jakarta nomor LOP999001";
  const { report } = linesFromGeminiReply(
    reply([
      ...Array.from({ length: 6 }, (_, k) => ({
        box_2d: [120 * k + 10, 250, 120 * k + 110, 1000],
        text: paragraph,
      })),
      { box_2d: [960, 250, 980, 1000], text: "LOP999001" },
    ]),
    W,
    H,
  );

  assert.equal(report.lines, 7);
  assert.equal(report.collapsedBlocks, 6);
  assert.equal(report.degraded, true);
  assert.match(report.reasons[0], /collapsed blocks: 6 of 7 lines/);
});

test("a page-wide collapse is caught, where the page's own median cancels", () => {
  // THE CASE A SELF-REFERENTIAL ALARM CANNOT SEE. Every paragraph on this page
  // came back as one line inside its own paragraph-sized box, so the median
  // line height IS the collapsed height and not one line is over twice it. The
  // density ratio cancels the same way: its reference band is 0.6x-1.6x that
  // same median, so it is measuring the defect against itself and reads 1.000.
  //
  // `splitba:0` was caught only because its collapse hit a minority of its
  // lines, 6 of 27. The failure has no obligation to be a minority.
  const paragraph =
    "PSB VPN IP KCP Contoh untuk BANK CONTOH NUSANTARA di Jakarta nomor LOP999001";
  const { report } = linesFromGeminiReply(
    reply(
      Array.from({ length: 9 }, (_, k) => ({
        box_2d: [110 * k + 10, 250, 110 * k + 110, 1000],
        text: paragraph,
      })),
    ),
    W,
    H,
  );

  assert.equal(report.lines, 9);
  assert.equal(report.medianLineHeight, 100, "the median IS the collapsed box");
  assert.ok(
    Math.abs(report.lineDensityRatio - 1) < 1e-9,
    "and the density ratio is 1 by construction",
  );
  // The absolute rule is the only thing left standing, and it stands.
  assert.equal(report.collapsedBlocks, 9);
  assert.equal(report.degraded, true);
});

test("a partial collapse counts, even though its bands are interpolated", () => {
  // The collapse rule used to require `origin === "measured"`, which excused by
  // TYPE rather than by measurement the case where a paragraph came back
  // carrying two of its five printed lines: the box splits into two bands, each
  // tagged "interpolated", each just as oversized and just as short of the
  // paragraph it claims.
  const twoOfFive =
    "PSB VPN IP KCP Contoh untuk BANK CONTOH NUSANTARA\ndi Jakarta nomor LOP999001";
  const { report, lines } = linesFromGeminiReply(
    reply([
      ...Array.from({ length: 10 }, (_, k) => ordinaryLine(k)),
      { box_2d: [600, 250, 800, 1000], text: twoOfFive },
      { box_2d: [820, 250, 1000, 1000], text: twoOfFive },
    ]),
    W,
    H,
  );

  assert.equal(report.interpolatedLines, 4);
  assert.ok(
    lines.slice(10).every((l) => l.origin === "interpolated"),
    "every band of a multi-line block is interpolated",
  );
  assert.equal(report.collapsedBlocks, 4);
  assert.equal(report.degraded, true);
  assert.match(report.reasons[0], /collapsed blocks: 4 of 14 lines/);
});

test("lines with no recorded origin are never counted as collapsed blocks", () => {
  // `Line.origin` is optional because runs ingested before this migration, and
  // every line tesseract ever produced, carry none at all. Undefined must read
  // as "not recorded", never as "measured" -- otherwise the harness's recompute
  // over a tesseract bundle would invent collapsed blocks out of a field that
  // engine never had.
  //
  // This also pins the entry point `scripts/measure-locate.mjs` uses: it calls
  // `pageGeometry` over the `Line[]` already sitting in its OCR cache, which is
  // what lets a cached gate re-run flag these pages for no model calls at all.
  const paragraph =
    "PSB VPN IP KCP Contoh untuk BANK CONTOH NUSANTARA di Jakarta nomor LOP999001";
  const { lines } = linesFromGeminiReply(
    reply([
      ...Array.from({ length: 10 }, (_, k) => ordinaryLine(k)),
      { box_2d: [600, 250, 700, 1000], text: paragraph },
      { box_2d: [740, 250, 840, 1000], text: paragraph },
    ]),
    W,
    H,
  );

  const withOrigin = pageGeometry(lines, H);
  assert.equal(withOrigin.collapsedBlocks, 2);

  const stripped = lines.map((l) => ({
    i: l.i,
    text: l.text,
    box: l.box,
    words: l.words,
  }));
  const withoutOrigin = pageGeometry(stripped, H);
  assert.equal(withoutOrigin.collapsedBlocks, 0);
  assert.deepEqual(withoutOrigin.reasons, []);
  // Everything that does not depend on `origin` is measured either way.
  assert.equal(withoutOrigin.transcribedChars, withOrigin.transcribedChars);
  assert.equal(withoutOrigin.verticalCoverage, withOrigin.verticalCoverage);
});

// --- The completeness assertion: the one check in this module that looks at
// pixels, and the only one that can see the mode where a page simply STOPS.
//
// `merged:19` returned 21 lines whose lowest box bottom was y=1803 of a 3507px
// page while the paper carried print down to y=3345. Nothing else noticed:
// finishReason was STOP, no entry was dropped, the output was far under the
// 16384 cap, and the text it DID return was dense enough to score a perfectly
// ordinary 0.865 on the thin-page ratio.
//
// These fixtures are synthetic RGBA rather than a real page, which is what
// keeps them offline: `pageToPng` encodes in-process through `encodePng` in
// Node, and `recognize` is a fake. No credential, no network, no model.

/** A white page with alpha 255 everywhere, the way `renderPageUpright` leaves it. */
function whitePage(width: number, height: number): RenderedPage {
  return {
    data: new Uint8ClampedArray(width * height * 4).fill(255),
    width,
    height,
  };
}

/** Paints `pixels` black pixels into row `y`, starting at x=0. */
function paintInk(page: RenderedPage, y: number, pixels: number): void {
  for (let x = 0; x < pixels; x++) {
    const i = (y * page.width + x) * 4;
    page.data[i] = 0;
    page.data[i + 1] = 0;
    page.data[i + 2] = 0;
    page.data[i + 3] = 255;
  }
}

const PAGE_W = 200;
const PAGE_H = 1000;

/** A page printed at the top and again at the bottom, ink last at y=950. */
function printedPage(): RenderedPage {
  const page = whitePage(PAGE_W, PAGE_H);
  for (let y = 100; y <= 110; y++) paintInk(page, y, 40);
  for (let y = 940; y <= 950; y++) paintInk(page, y, 40);
  return page;
}

/** Reads only the heading: boxes stop at y=120 against ink to y=950. */
const SHORT_REPLY = reply([
  { box_2d: [100, 100, 120, 900], text: "BANK CONTOH NUSANTARA" },
]);

/** Reads the footer too: boxes reach y=950. */
const COMPLETE_REPLY = reply([
  { box_2d: [100, 100, 120, 900], text: "BANK CONTOH NUSANTARA" },
  { box_2d: [930, 100, 950, 900], text: "LOP999001" },
]);

function recognizeWith(replies: string[]): {
  recognize: RecognizePage;
  images: ImageInput[];
} {
  const images: ImageInput[] = [];
  let call = 0;
  const recognize: RecognizePage = async (image) => {
    images.push(image);
    const text = replies[Math.min(call, replies.length - 1)];
    call++;
    return linesFromGeminiReply(text, PAGE_W, PAGE_H);
  };
  return { recognize, images };
}

test("inkRowProfile finds the bottom of the print, not the bottom of the paper", () => {
  const page = printedPage();
  const profile = inkRowProfile(page);
  assert.equal(profile.inkBottomY, 950);
  assert.equal(profile.height, PAGE_H);
  // Every printed row, and only those: the profile is what lets the check see
  // ink the boxes skipped rather than only ink below them.
  assert.equal(profile.rows[100], 1);
  assert.equal(profile.rows[950], 1);
  assert.equal(profile.rows[500], 0);
  assert.equal(
    profile.rows.reduce((n: number, v: number) => n + v, 0),
    22,
    "eleven rows of heading and eleven of footer",
  );
  // A page with nothing on it has no ink extent to be short of. -1 rather than
  // 0, so `checkPageCompleteness` can tell "no ink" from "ink in row 0".
  assert.equal(inkRowProfile(whitePage(PAGE_W, PAGE_H)).inkBottomY, -1);
});

test("a couple of stray dark pixels are speckle, not a row of print", () => {
  // MEASURED on the gate bundle: requiring only one ink pixel drops the healthy
  // minimum from 0.985 to 0.972, because a single dark speck below the last
  // real glyph counts as a whole row of print. Three does not, and neither does
  // eight or twenty -- so the constant sits at the small end of the flat part
  // of that curve, where the error costs a wasted retry rather than a missed
  // short page.
  const speckled = whitePage(PAGE_W, PAGE_H);
  for (let y = 100; y <= 110; y++) paintInk(speckled, y, 40);
  paintInk(speckled, 990, 2);
  assert.equal(inkRowProfile(speckled).inkBottomY, 110);

  paintInk(speckled, 990, 3);
  assert.equal(inkRowProfile(speckled).inkBottomY, 990);
});

test("an unpainted pixel is not ink, so a synthetic page reads as blank", () => {
  // `renderPageUpright` fills the page white before drawing, so this never
  // arises on a real page. It arises the moment anybody builds a page in a
  // test: a zeroed RGBA buffer is black AND fully transparent, and reading it
  // as ink would make every such page fail the assertion for no reason.
  const unpainted: RenderedPage = {
    data: new Uint8ClampedArray(PAGE_W * PAGE_H * 4),
    width: PAGE_W,
    height: PAGE_H,
  };
  const profile = inkRowProfile(unpainted);
  assert.equal(profile.inkBottomY, -1);
  assert.equal(checkPageCompleteness([], profile).complete, true);
});

test("a truncated body is caught even when the running footer came back", () => {
  // THE CASE A BOTTOM-EDGE RATIO CANNOT SEE, and the reason this check walks a
  // row profile rather than reducing the page to `max(box.y + box.h)`.
  //
  // The page is printed from y=100 to y=500 and again at its footer, y=940-950.
  // The model returned the first two body lines and the footer, and nothing in
  // between. Its lowest box bottom is therefore the page's own last ink row, so
  // the ratio reads a perfect 1.000 -- complete, degraded false, no reasons --
  // on a page that lost four fifths of its text.
  //
  // That is not a contrived shape: a running footer is the single most likely
  // fragment to survive a truncation, which is why `trimRunningFooter`,
  // `MAX_FOOTER_LINES` and `FOOTER_GAP_MULTIPLE` exist at all. `merged:19` was
  // caught by the coin landing the other way.
  const page = whitePage(PAGE_W, PAGE_H);
  for (let y = 100; y <= 500; y++) paintInk(page, y, 40);
  for (let y = 940; y <= 950; y++) paintInk(page, y, 40);
  const profile = inkRowProfile(page);

  const { lines } = linesFromGeminiReply(
    reply([
      { box_2d: [100, 100, 140, 900], text: "BANK CONTOH NUSANTARA" },
      { box_2d: [930, 100, 950, 900], text: "LOP999001" },
    ]),
    PAGE_W,
    PAGE_H,
  );
  const completeness = checkPageCompleteness(lines, profile);

  // The ratio is satisfied -- one box at the bottom is all it ever asked for.
  assert.equal(completeness.boxBottomY, 950);
  assert.equal(completeness.inkBottomY, 950);
  assert.ok(completeness.inkCoverage > 0.99);
  // The profile is not: rows 140 to 500 carry print no box covers.
  assert.equal(completeness.uncoveredInkRun, 361);
  assert.ok(completeness.uncoveredInkRunShare > 0.06);
  assert.equal(completeness.complete, false);
  assert.equal(completeness.shortfalls.length, 1);
  assert.match(completeness.shortfalls[0], /no returned box covers/);
});

test("a hole in the middle of a page is caught, not only a short bottom", () => {
  // The same rule, without the truncation: the boxes reach the bottom of the
  // ink and skip a block in the middle. No bottom-edge ratio can see this at
  // all, whatever it is set to.
  const page = whitePage(PAGE_W, PAGE_H);
  for (let y = 100; y <= 110; y++) paintInk(page, y, 40);
  for (let y = 400; y <= 600; y++) paintInk(page, y, 40);
  for (let y = 940; y <= 950; y++) paintInk(page, y, 40);
  const profile = inkRowProfile(page);

  const { lines } = linesFromGeminiReply(
    reply([
      { box_2d: [100, 100, 120, 900], text: "BANK CONTOH NUSANTARA" },
      { box_2d: [930, 100, 950, 900], text: "LOP999001" },
    ]),
    PAGE_W,
    PAGE_H,
  );
  const completeness = checkPageCompleteness(lines, profile);

  assert.ok(completeness.inkCoverage > 0.99, "the ratio says nothing here");
  assert.equal(completeness.uncoveredInkRun, 201);
  assert.equal(completeness.complete, false);
});

test("blank paper between printed lines does not break an uncovered run", () => {
  // A truncated body of ordinary line-spaced text leaves uncovered ink in
  // stripes, not in a block. Breaking a run on blank paper would reduce every
  // run to one line's height and this rule would measure nothing: measured over
  // the gate bundle, breaking on blanks puts the truncated page at 471px and
  // bridging them puts it at 1095px, against the same healthy maximum of 88px.
  const page = whitePage(PAGE_W, PAGE_H);
  for (let line = 0; line < 10; line++) {
    for (let y = 200 + line * 40; y <= 210 + line * 40; y++) paintInk(page, y, 40);
  }
  const profile = inkRowProfile(page);

  // Nothing was returned at all, so every one of those 110 ink rows is
  // uncovered -- and they are what the run counts, blanks bridged.
  const completeness = checkPageCompleteness([], profile);
  assert.equal(completeness.uncoveredInkRun, 110);
  assert.equal(completeness.complete, false);
});

test("a page whose boxes stop above the ink fails, loudly, after its retries", async () => {
  const page = printedPage();
  const { recognize, images } = recognizeWith([SHORT_REPLY]);
  const short: number[] = [];

  await assert.rejects(
    () =>
      ocrPageCompletely(page, recognize, {
        label: "merged page 19",
        attempts: 3,
        onShort: (s) => short.push(s.attempt),
      }),
    (error: unknown) => {
      assert.ok(error instanceof IncompletePageError);
      assert.equal(error.attempts, 3);
      assert.equal(error.completeness.boxBottomY, 120);
      assert.equal(error.completeness.inkBottomY, 950);
      // 120 / 951, well under MIN_INK_COVERAGE.
      assert.ok(error.completeness.inkCoverage < 0.2);
      assert.equal(error.completeness.complete, false);
      // The message has to name the page and say what was measured: this is
      // the only thing an operator sees, and "OCR failed" would send them
      // looking at the credential.
      assert.match(error.message, /merged page 19/);
      assert.match(error.message, /y=120/);
      assert.match(error.message, /y=950/);
      return true;
    },
  );

  // Every attempt was spent, every one was reported, and NOTHING was returned.
  // A short page must never reach the pipeline quietly -- the same rule as
  // /api/ocr's no-200-with-zero-lines.
  assert.deepEqual(short, [1, 2, 3]);
  assert.equal(images.length, 3);
  // The PNG is encoded once and the same bytes are re-sent. Re-encoding would
  // cost a second pass over the RGBA and quietly change what is being retried.
  assert.equal(images[0], images[1]);
  assert.equal(images[1], images[2]);
});

test("a page whose boxes reach the ink passes on the first attempt", async () => {
  const page = printedPage();
  const { recognize, images } = recognizeWith([COMPLETE_REPLY]);
  let fired = 0;

  const result = await ocrPageCompletely(page, recognize, {
    onShort: () => fired++,
  });

  assert.equal(fired, 0);
  assert.equal(images.length, 1);
  assert.equal(result.attempt, 1);
  assert.equal(result.lines.length, 2);
  assert.equal(result.completeness.boxBottomY, 950);
  assert.equal(result.completeness.inkBottomY, 950);
  // 950 / 951. A ratio at or slightly above 1 is normal: a text box routinely
  // ends a pixel or two past the last row carrying ink, which is why this is a
  // lower bound and not an equality.
  assert.ok(result.completeness.inkCoverage > 0.99);
  assert.equal(result.completeness.complete, true);
  // The measurement rides along on the report, so a run log and a cached gate
  // entry both carry what the pixels said. It is optional on `OcrReport`
  // precisely because `/api/ocr` cannot fill it in.
  assert.equal(result.report.inkCoverage, result.completeness.inkCoverage);
});

test("a short read once, then a complete one, recovers and is counted", async () => {
  // The retry is the whole point of the guard: a false positive costs an image
  // call, and only costs the RUN if every attempt comes back short. Whether a
  // re-read actually recovers a truncated page in the wild is untested -- it
  // re-sends the identical bytes with the identical prompt, so only the model's
  // own sampling can make it differ, and the named fallback is tiling -- but
  // the path that would recover one is pinned here.
  const page = printedPage();
  const { recognize, images } = recognizeWith([SHORT_REPLY, COMPLETE_REPLY]);
  const short: number[] = [];

  const result = await ocrPageCompletely(page, recognize, {
    onShort: (s) => short.push(s.lines),
  });

  // Fired once, on the first attempt, and reported what it saw -- one line
  // where the second attempt found two.
  assert.deepEqual(short, [1]);
  assert.equal(images.length, 2);
  assert.equal(result.attempt, 2);
  assert.equal(result.lines.length, 2);
  assert.equal(result.completeness.complete, true);
  assert.equal(result.lines[1].text, "LOP999001");
});
