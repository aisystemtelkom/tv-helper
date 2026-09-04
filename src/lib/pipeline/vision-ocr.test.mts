/**
 * The Cloud Vision mapping's tests.
 *
 * No network, no credential, no SDK: `linesFromVisionResponse` takes a parsed
 * response object, so every case here is a fixture. What they protect is the
 * step where an external API's shape becomes the geometry a crop is cut from,
 * and the assertions are weighted towards the ways that can go WRONG WITHOUT
 * THROWING -- an omitted zero read as `undefined`, a rotated quadrilateral read
 * as a rectangle, a dropped word that nothing counts. Each of those produces a
 * box that is merely in the wrong place, and a crop in the wrong place is this
 * project's expensive failure.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  VISION_FEATURE,
  VISION_LANGUAGE_HINTS,
  VISION_MAPPING_VERSION,
  linesFromVisionResponse,
  wordsFromVisionResponse,
} from "./vision-ocr.ts";

const PAGE = { width: 2480, height: 3507 };

/**
 * A word at a given box, as Vision spells one.
 *
 * `break` defaults to SPACE because that is what Vision reports between
 * ordinary words. Pass "" for a word Vision reported with NO trailing space --
 * which is what it does between a token and its adjacent punctuation, and the
 * case that shipped two blank cells before `hasTrailingSpace` existed.
 */
function word(
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  brk: string = "SPACE",
) {
  const symbols = [...text].map((c) => ({ text: c }));
  if (brk && symbols.length > 0) {
    (symbols[symbols.length - 1] as Record<string, unknown>).property = {
      detectedBreak: { type: brk },
    };
  }
  return {
    symbols,
    boundingBox: {
      vertices: [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ],
    },
  };
}

function response(words: unknown[]) {
  return {
    fullTextAnnotation: {
      pages: [{ blocks: [{ paragraphs: [{ words }] }] }],
    },
  };
}

test("words become measured lines, grouped by row", () => {
  const res = response([
    word("PERJANJIAN", 100, 200, 300, 40),
    word("KERJASAMA", 420, 200, 280, 40),
    word("Nomor", 100, 300, 150, 36),
  ]);

  const { lines, report } = linesFromVisionResponse(res, PAGE);

  assert.equal(lines.length, 2, "two rows of words make two lines");
  assert.equal(lines[0].text, "PERJANJIAN KERJASAMA");
  assert.equal(lines[1].text, "Nomor");
  // The union of the two word boxes, not one of them.
  assert.equal(lines[0].box.x, 100);
  assert.equal(lines[0].box.w, 600);
  for (const line of lines) assert.equal(line.origin, "measured");
  assert.equal(report.interpolatedLines, 0);
  assert.equal(report.droppedEntries, 0);
});

test("AN OMITTED ZERO IS READ AS ZERO, not as undefined", () => {
  // THE SINGLE MOST LIKELY WAY THIS MAPPING GOES SILENTLY WRONG. Vision's
  // protobuf-JSON encoding omits a field whose value is 0, so a word flush
  // against the left margin arrives as {"y": 412} with no `x` at all. Reading
  // `v.x` gives undefined, `Math.min` gives NaN, and a NaN box does not throw
  // -- it propagates into a crop rectangle and comes out as a picture of
  // nothing, or of somewhere else.
  const res = {
    fullTextAnnotation: {
      pages: [
        {
          blocks: [
            {
              paragraphs: [
                {
                  words: [
                    {
                      symbols: [{ text: "A" }],
                      boundingBox: {
                        vertices: [
                          { y: 400 }, // x omitted: it is 0
                          { x: 120, y: 400 },
                          { x: 120, y: 440 },
                          { y: 440 }, // x omitted again
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const { lines } = linesFromVisionResponse(res, PAGE);
  assert.equal(lines.length, 1);
  const box = lines[0].box;
  for (const [name, value] of Object.entries(box)) {
    assert.ok(Number.isFinite(value), `box.${name} is ${value}, not a finite number`);
  }
  assert.equal(box.x, 0);
  assert.equal(box.w, 120);
});

test("a rotated word becomes the rectangle that CONTAINS it", () => {
  // A boundingBox is a polygon and is only a rectangle when the text is
  // upright. Reading vertices[0] and vertices[2] as opposite corners would
  // give a box that is too small and offset; the honest conversion of a
  // quadrilateral, for a pipeline that crops rectangles, is its bounding box.
  const res = response([
    {
      symbols: [{ text: "X" }],
      boundingBox: {
        vertices: [
          { x: 100, y: 210 },
          { x: 300, y: 200 },
          { x: 310, y: 260 },
          { x: 110, y: 270 },
        ],
      },
    },
  ]);

  const { lines } = linesFromVisionResponse(res, PAGE);
  assert.equal(lines[0].box.x, 100);
  assert.equal(lines[0].box.y, 200);
  assert.equal(lines[0].box.x + lines[0].box.w, 310);
  assert.equal(lines[0].box.y + lines[0].box.h, 270);
});

test("an unusable word is DROPPED AND COUNTED, never passed on", () => {
  // Silently skipping is how a page reads short without anything saying so.
  // `droppedEntries` is printed in the per-page table for exactly this.
  const res = response([
    word("good", 100, 200, 200, 40),
    { symbols: [], boundingBox: { vertices: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }] } },
    { symbols: [{ text: "z" }], boundingBox: { vertices: [] } },
    // Zero-area: no position a crop could use, and it would drag a row's
    // union rectangle out to reach it.
    { symbols: [{ text: "q" }], boundingBox: { vertices: [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }] } },
  ]);

  const { lines, report } = linesFromVisionResponse(res, PAGE);
  assert.equal(report.droppedEntries, 3);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "good");
});

test("an empty or malformed response yields no lines and does not throw", () => {
  // A page genuinely can be blank, and a caller that threw here would fail a
  // 29-page ingest on one empty separator sheet. The completeness guard
  // upstream is what decides whether a blank page is legitimate.
  for (const res of [
    {},
    null,
    { fullTextAnnotation: null },
    { fullTextAnnotation: { pages: [] } },
    { fullTextAnnotation: { pages: [{ blocks: [] }] } },
    { error: { code: 3, message: "bad image" } },
  ]) {
    const { lines, report } = linesFromVisionResponse(res, PAGE);
    assert.equal(lines.length, 0);
    assert.equal(report.lines, 0);
    assert.equal(report.interpolatedLines, 0);
  }
});

test("line numbering is contiguous from zero", () => {
  // `lines[k].i === k` is relied on in at least three places -- the whole-page
  // citation written from the array LENGTH but read back by line NUMBER, in
  // scripts/generate.mjs, src/app/api/propose/handler.ts and the gate. A
  // mapping that numbered lines any other way would make those citations name
  // different text than their rectangle covers.
  const res = response([
    word("a", 100, 500, 80, 30),
    word("b", 100, 200, 80, 30),
    word("c", 100, 350, 80, 30),
  ]);
  const { lines } = linesFromVisionResponse(res, PAGE);
  assert.equal(lines.length, 3);
  lines.forEach((line, k) => assert.equal(line.i, k));
  // And in reading order down the page, not in the order Vision listed them.
  assert.deepEqual(lines.map((l) => l.text), ["b", "c", "a"]);
});

test("words are read across every block and paragraph, not just the first", () => {
  const res = {
    fullTextAnnotation: {
      pages: [
        {
          blocks: [
            { paragraphs: [{ words: [word("one", 100, 200, 80, 30)] }] },
            {
              paragraphs: [
                { words: [word("two", 100, 300, 80, 30)] },
                { words: [word("three", 100, 400, 80, 30)] },
              ],
            },
          ],
        },
      ],
    },
  };
  const { lines, report } = linesFromVisionResponse(res, PAGE);
  assert.equal(report.blocks, 2);
  assert.equal(report.segments, 3, "segments counts words for this engine");
  assert.deepEqual(lines.map((l) => l.text), ["one", "two", "three"]);
});

test("the report carries the fields the per-page table and compare-ocr read", () => {
  // compare-ocr.mjs parses the printed table by column, and the gate prints
  // the same fields for both engines. A missing one silently drops this engine
  // out of the comparison that has to judge it.
  const res = response([word("hello", 100, 200, 200, 40)]);
  const { report } = linesFromVisionResponse(res, PAGE);
  for (const field of [
    "blocks",
    "segments",
    "lines",
    "interpolatedLines",
    "droppedEntries",
    "transcribedChars",
    "verticalCoverage",
    "medianLineHeight",
    "collapsedBlocks",
    "lineDensityRatio",
    "degraded",
    "reasons",
  ]) {
    assert.ok(field in report, `report is missing ${field}`);
  }
  assert.equal(report.transcribedChars, 5);
  assert.ok(report.verticalCoverage > 0 && report.verticalCoverage < 1);
});

test("the request constants are the ones the spike measured", () => {
  // TEXT_DETECTION returns a flat list with no block/paragraph/word tree, so
  // it would silently lose the word boxes this whole migration is for.
  assert.equal(VISION_FEATURE, "DOCUMENT_TEXT_DETECTION");
  assert.deepEqual([...VISION_LANGUAGE_HINTS], ["id", "en"]);
  assert.match(VISION_MAPPING_VERSION, /^v\d+$/);
});

test("wordsFromVisionResponse is exported and returns boxes, for the gate", () => {
  const { words, blocks, dropped } = wordsFromVisionResponse(
    response([word("x", 10, 20, 30, 40)]),
  );
  assert.equal(blocks, 1);
  assert.equal(dropped, 0);
  assert.deepEqual(words[0].box, { x: 10, y: 20, w: 30, h: 40 });
});

test("PUNCTUATION IS GLUED to its token, because Vision segments it separately", () => {
  // THE DEFECT THIS EXISTS TO STOP, measured on the real bundle rather than
  // imagined. Vision returns "(", "08115810308" and ")" as three words, and
  // joining every word with a space produced "M.Arief ( 08115810308 )". The
  // crop-level verification pass then compared that against a crop read of the
  // same region, found them different, and blanked the cell. Two good values
  // -- `alamat` and `picContacts` -- shipped empty that way.
  const res = response([
    word("M.Arief", 100, 200, 200, 30),
    word("(", 310, 200, 12, 30, ""),
    word("08115810308", 325, 200, 250, 30, ""),
    word(")", 580, 200, 12, 30, "SPACE"),
    word("Agung", 620, 200, 120, 30),
  ]);

  const { lines } = linesFromVisionResponse(res, PAGE);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "M.Arief (08115810308) Agung");
});

test("a glued run keeps a box that covers ALL of its parts", () => {
  // The merged word's box is the union, not the first fragment's. A crop cut
  // from the first fragment alone would show "(" and nothing else.
  const res = response([
    word("RT", 100, 200, 40, 30, ""),
    word("/", 145, 200, 10, 30, ""),
    word("RW", 160, 200, 40, 30, "SPACE"),
  ]);
  const { lines } = linesFromVisionResponse(res, PAGE);
  assert.equal(lines[0].text, "RT/RW");
  assert.equal(lines[0].box.x, 100);
  assert.equal(lines[0].box.x + lines[0].box.w, 200);
});

test("a break that ends a LINE does not glue across the line", () => {
  // HYPHEN and LINE_BREAK both end a visual line. Treating them as "no space"
  // would glue a line's ending to the next line's start; treating them as a
  // space would be wrong too. Geometry decides line membership, so all these
  // must do is not merge across rows.
  const res = response([
    word("first", 100, 200, 120, 30, "LINE_BREAK"),
    word("second", 100, 300, 140, 30, "SPACE"),
  ]);
  const { lines } = linesFromVisionResponse(res, PAGE);
  assert.deepEqual(lines.map((l) => l.text), ["first", "second"]);
});
