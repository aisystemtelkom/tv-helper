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
  linesFromGeminiReply,
  pngDimensions,
  repairDoubledKeys,
} from "./gemini-ocr.ts";

/** A deliberately non-square page, so a single scale factor cannot pass. */
const W = 400;
const H = 1000;

type Entry = { box_2d: unknown[]; text?: string; label?: string };

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
  const box = { x: 40, y: 300, w: 320, h: 300 };
  const { lines, report } = linesFromGeminiReply(
    reply([
      {
        // 300..600 of 1000 tall -> y 300, h 300. 100..900 of 1000 wide on a
        // 400px page -> x 40, w 320.
        box_2d: [300, 100, 600, 900],
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
      { x: 40, y: 300, w: 320, h: 100 },
      { x: 40, y: 400, w: 320, h: 100 },
      { x: 40, y: 500, w: 320, h: 100 },
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
  // Three of three lines interpolated is over the alarm share, so the report
  // says so rather than letting it be discovered on an invoice's worth of runs.
  assert.equal(report.degraded, true);
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

test("an entry with neither a text nor a label transcription throws for the whole reply", () => {
  // The one place widening the schema must not widen what is accepted: an
  // entry with a box and no transcription is a packaging failure, and a page
  // that quietly came back with fewer lines is the failure this module exists
  // to refuse.
  assert.throws(
    () => linesFromGeminiReply(reply([{ box_2d: [100, 250, 140, 750] } as never]), W, H),
    /has neither a .*text.* nor a .*label.* transcription/,
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
