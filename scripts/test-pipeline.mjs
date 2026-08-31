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
