# Headless Document Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a bundle of scanned PDFs into a DOKUMEN VALIDASI docx and an EPIC config xlsx from the command line, with no UI and no auth, and prove on real documents that the localization approach works before anything is built on top of it.

**Architecture:** Six stages, all pure functions or thin wrappers over one library each: render a PDF page upright at 300 DPI, OCR it to words with pixel boxes, group words into numbered lines, ask the model which lines answer a slot, union those lines' boxes into a crop rectangle, write the crops into a docx and the values into an xlsx. The model never returns coordinates. It returns line numbers, and the geometry comes from OCR, so rectangles are exact by construction.

**Tech Stack:** Node 24, TypeScript 5, pnpm 10.33.0, `pdfjs-dist@6.2.108` (already present), `tesseract.js@7.0.0`, `docx@9.7.1`, `exceljs@4.4.0` (already present), `zod@4` (already present), `@napi-rs/canvas@1.0.8` (devDependency, Node-side rendering only).

**Spec:** `docs/superpowers/specs/2026-08-30-dokumen-validasi-design.md`

## Global Constraints

- **Never add `xlsx` (SheetJS).** Frozen at 0.18.5 with two unpatched HIGH advisories. Use `exceljs`.
- **pdf.js keeps its bundled worker.** `GlobalWorkerOptions.workerSrc` is set from the installed package. The library default fetches from a CDN, which puts an unapproved third party in the browser's request path.
- **Self-host the tesseract wasm and `ind.traineddata`.** Same rule, same reason. `tesseract.js` fetches both from a CDN by default.
- **Never name a script `setup` in `package.json`.** `pnpm setup` is a reserved built-in that silently shadows the package script.
- **Real client documents are never committed.** `documents/` and `test-docs/` stay gitignored. Every automated test uses synthetic fixtures. The real bundle is used only by the measurement harness in Task 7, which is run by hand.
- **`src/lib/model.ts` is the only file that knows how the model is reached.** Pipeline modules take an injected `ask` function and must not import a provider SDK.
- **Cross-platform.** Must run on macOS arm64 and Windows x64. `@napi-rs/canvas` ships prebuilds for both and is a devDependency only, so it never enters the production image.
- **`src/components/*` is vendored** by `assistant-ui init`. Do not hand-edit. This plan does not touch it.
- Boxes are always `{ x, y, w, h }` in **upright page pixels**. Rotation is resolved once, at render time, and never again.
- **Every relative value import between `.ts` modules carries an explicit `.ts` extension**, and `tsconfig.json` sets `allowImportingTsExtensions: true`. Node 24 strips types but does not rewrite specifiers and does not guess extensions, so an extensionless value import throws `ERR_MODULE_NOT_FOUND` at link time. `.js` does not work either. Type-only imports are erased before resolution and would survive without it, which is exactly why this stays invisible until the first cross-module value import.
- **Run `npx tsc --noEmit -p tsconfig.json` alongside the tests.** `node --test` strips types without checking them, so a type error passes every test in this plan and only surfaces at `pnpm build`.

---

### Task 1: Minimal PDF builder for fixtures

Every later task needs a PDF with known geometry that is legal to commit. Hand-writing one is impossible because the xref table holds byte offsets, so this builds them programmatically.

**Files:**
- Create: `scripts/fixtures/pdf.mjs`
- Create: `scripts/test-pipeline.mjs`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: nothing
- Produces: `makePdf({ width, height, rotate, content }) -> Uint8Array`, where `width`/`height` are MediaBox points, `rotate` is 0/90/180/270, and `content` is a raw PDF content-stream string.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-pipeline.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test-pipeline.mjs`
Expected: FAIL with `Cannot find module './fixtures/pdf.mjs'`

- [ ] **Step 3: Write minimal implementation**

Create `scripts/fixtures/pdf.mjs`:

```js
/**
 * Assembles a one-page PDF with a correct xref table.
 *
 * Fixtures must be synthetic because real client documents are never
 * committed, and they must be built rather than checked in as bytes so the
 * geometry a test asserts on is visible in the test itself.
 */
const encoder = new TextEncoder();

export function makePdf({ width, height, rotate = 0, content = "" }) {
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${width} ${height}]` +
      `/Rotate ${rotate}/Contents 4 0 R/Resources<<>>>>`,
    `<</Length ${encoder.encode(content).length}>>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.7\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`;

  return encoder.encode(pdf);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/test-pipeline.mjs`
Expected: PASS, 1 test

- [ ] **Step 5: Wire the test into `pnpm test` and commit**

In `package.json`, change the `test` script so both files run:

```json
"test": "node --test scripts/test-converters.mjs scripts/test-pipeline.mjs"
```

```bash
git add scripts/fixtures/pdf.mjs scripts/test-pipeline.mjs package.json
git commit -m "test: add a synthetic PDF builder for pipeline fixtures"
```

---

### Task 2: Upright page rendering

The real scans set `/Rotate 270`, so the stored bitmap is sideways. Everything downstream assumes upright pixels, and this is the only place rotation is handled.

**Files:**
- Create: `src/lib/pipeline/render.ts`
- Modify: `scripts/test-pipeline.mjs`
- Modify: `package.json` (add `@napi-rs/canvas` devDependency)

**Interfaces:**
- Consumes: `makePdf` from Task 1.
- Produces:
  - `type Box = { x: number; y: number; w: number; h: number }`
  - `type RenderedPage = { data: Uint8ClampedArray; width: number; height: number }`
  - `type CanvasFactory = (w: number, h: number) => CanvasRenderingContext2D`
  - `const DEFAULT_DPI = 300`
  - `async function renderPageUpright(page, dpi, makeContext): Promise<RenderedPage>`

- [ ] **Step 1: Add the Node-side canvas**

```bash
pnpm add -D @napi-rs/canvas@1.0.8
```

This is a devDependency on purpose. The browser renders with `OffscreenCanvas`; only tests and the measurement harness need a canvas in Node. It ships prebuilds for `darwin-arm64` and `win32-x64-msvc`, so it satisfies the cross-platform constraint without a build toolchain.

Note this deliberately reverses the comment at the top of `scripts/test-converters.mjs` that says rasterization is not covered in Node because it needs a canvas. Update that comment to point here.

- [ ] **Step 2: Write the failing test**

Append to `scripts/test-pipeline.mjs`:

```js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test scripts/test-pipeline.mjs`
Expected: FAIL, cannot resolve `../src/lib/pipeline/render.ts`

- [ ] **Step 4: Write minimal implementation**

Create `src/lib/pipeline/render.ts`:

```ts
import type { PDFPageProxy } from "pdfjs-dist";

export type Box = { x: number; y: number; w: number; h: number };

export type RenderedPage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

/**
 * Supplied by the caller so the browser can pass an OffscreenCanvas context
 * and Node can pass @napi-rs/canvas, without this module importing either.
 */
export type CanvasFactory = (
  width: number,
  height: number,
) => CanvasRenderingContext2D;

/**
 * The scans measure ~3507x2480 across an A4 landscape MediaBox, which is
 * about 300 DPI. Rendering below that throws away the small print the whole
 * product exists to read.
 */
export const DEFAULT_DPI = 300;

/**
 * `getViewport` applies the page's own /Rotate, so every box downstream is in
 * upright pixels and no other module has to think about rotation again.
 */
export async function renderPageUpright(
  page: PDFPageProxy,
  dpi: number = DEFAULT_DPI,
  makeContext: CanvasFactory,
): Promise<RenderedPage> {
  const viewport = page.getViewport({ scale: dpi / 72 });
  const width = Math.round(viewport.width);
  const height = Math.round(viewport.height);

  const context = makeContext(width, height);
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);

  // `canvas: null` is required, not cosmetic. In pdfjs-dist 6.x `canvas` is a
  // required RenderParameters property, and the library only honors the
  // supplied `canvasContext` when `canvas` is falsy. Omitting it fails tsc.
  await page.render({ canvas: null, canvasContext: context, viewport }).promise;

  return { data: context.getImageData(0, 0, width, height).data, width, height };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test scripts/test-pipeline.mjs`
Expected: PASS, 2 tests

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/render.ts scripts/test-pipeline.mjs scripts/test-converters.mjs package.json pnpm-lock.yaml
git commit -m "feat: render PDF pages upright at 300 DPI, honoring /Rotate"
```

---

### Task 3: Line geometry

This is the arithmetic the spec calls out as the code most likely to be silently wrong. It is pure, so it gets tested hard and in isolation.

**Files:**
- Create: `src/lib/pipeline/geometry.ts`
- Modify: `scripts/test-pipeline.mjs`
- Modify: `tsconfig.json` (`allowImportingTsExtensions`)

**Interfaces:**
- Consumes: `Box` from `src/lib/pipeline/render.ts`.
- Produces:
  - `type Word = { text: string; box: Box }`
  - `type Line = { i: number; text: string; box: Box; words: Word[] }`
  - `function groupWordsIntoLines(words: Word[], yTolerance?: number): Line[]`
  - `function unionBoxes(boxes: Box[]): Box`
  - `function padBox(box: Box, pad: number, bounds: Box): Box`
  - `function boxForLineRange(lines: Line[], from: number, to: number, pad: number, bounds: Box): Box`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-pipeline.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/test-pipeline.mjs`
Expected: FAIL, cannot resolve `../src/lib/pipeline/geometry.ts`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/pipeline/geometry.ts`:

```ts
import type { Box } from "./render";

export type Word = { text: string; box: Box };
export type Line = { i: number; text: string; box: Box; words: Word[] };

export function unionBoxes(boxes: Box[]): Box {
  if (boxes.length === 0) throw new Error("unionBoxes needs at least one box");
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Clamped, because a crop that runs off the page throws in the encoder. The
 * `Math.max(0, ...)` on the dimensions matters for the same reason: a negative
 * pad larger than half the box would otherwise invert it and emit exactly the
 * malformed rectangle this function exists to prevent.
 */
export function padBox(box: Box, pad: number, bounds: Box): Box {
  const x = Math.max(bounds.x, box.x - pad);
  const y = Math.max(bounds.y, box.y - pad);
  const right = Math.min(bounds.x + bounds.w, box.x + box.w + pad);
  const bottom = Math.min(bounds.y + bounds.h, box.y + box.h + pad);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

/**
 * Groups by vertical overlap rather than exact y, because scanned text is
 * never pixel-aligned and a two-pixel drift must not split a line in half.
 *
 * The test is directional on purpose: a word joins a row when its span
 * overlaps the row's by `yTolerance` of THE WORD'S OWN height. An earlier
 * version compared the word's centre against the row's already-expanded span
 * with slack scaled by that grown height, so both the band and the tolerance
 * grew as words were absorbed. Three lines overlapping only their neighbours
 * by 2px chained into one. That is not a cosmetic bug: `Line.i` is the
 * addressing scheme the model cites, so fusing lines deletes them from its
 * vocabulary and silently widens every crop that references them.
 */
export function groupWordsIntoLines(words: Word[], yTolerance = 0.5): Line[] {
  const rows: Word[][] = [];

  for (const w of [...words].sort((a, b) => a.box.y - b.box.y)) {
    const wordTop = w.box.y;
    const wordBottom = w.box.y + w.box.h;
    const row = rows.find((r) => {
      const rowTop = Math.min(...r.map((x) => x.box.y));
      const rowBottom = Math.max(...r.map((x) => x.box.y + x.box.h));
      const overlap =
        Math.min(wordBottom, rowBottom) - Math.max(wordTop, rowTop);
      return overlap >= yTolerance * w.box.h;
    });
    if (row) row.push(w);
    else rows.push([w]);
  }

  return rows.map((row, i) => {
    const ordered = [...row].sort((a, b) => a.box.x - b.box.x);
    return {
      i,
      text: ordered.map((w) => w.text).join(" "),
      box: unionBoxes(ordered.map((w) => w.box)),
      words: ordered,
    };
  });
}

/**
 * Inclusive of both endpoints, because the model is asked for "lines 7 to 8"
 * and a reader checking the citation counts both.
 */
export function boxForLineRange(
  lines: Line[],
  from: number,
  to: number,
  pad: number,
  bounds: Box,
): Box {
  if (from > to) throw new Error(`line range reversed: ${from} > ${to}`);
  const picked = lines.filter((l) => l.i >= from && l.i <= to);
  if (picked.length !== to - from + 1) {
    throw new Error(`lines ${from}-${to} are not all present on this page`);
  }
  return padBox(unionBoxes(picked.map((l) => l.box)), pad, bounds);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test-pipeline.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Allow `.ts` import specifiers, before any module imports another**

Tasks 1 to 3 pass without this because every cross-module import so far is `import type`, which is erased before resolution. Task 4 is the first module to import a *value* from another module, and it fails hard without both halves of this change.

Node 24 strips types but does not rewrite specifiers, and its ESM resolver does no extension guessing, so an extensionless relative import throws `ERR_MODULE_NOT_FOUND` at link time. Writing `./geometry.js` does not work either. Every relative **value** import between these modules must carry an explicit `.ts`:

```ts
import { groupWordsIntoLines, type Line, type Word } from "./geometry.ts";
```

That alone then breaks `tsc`, because this repo's tsconfig uses `moduleResolution: "bundler"` without the matching flag. Add to `tsconfig.json` `compilerOptions`, which is legal here because `noEmit: true` is already set:

```json
"allowImportingTsExtensions": true
```

Verify both halves before moving on:

```bash
npx tsc --noEmit -p tsconfig.json
node --test scripts/test-pipeline.mjs
```

Expected: no type errors, and tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/geometry.ts scripts/test-pipeline.mjs tsconfig.json
git commit -m "feat: line grouping, box union, padding, and line-range crops"
```

---

### Task 4: OCR to words

**Files:**
- Create: `src/lib/pipeline/ocr.ts`
- Create: `src/lib/export/png.ts` (moved forward from Task 9; OCR needs encoded images)
- Create: `scripts/vendor-ocr.mjs`
- Modify: `scripts/png.mjs` (import the shared encoder instead of duplicating it)
- Modify: `scripts/test-pipeline.mjs`
- Modify: `package.json`, `.gitignore`
- Create: `public/tesseract/.gitkeep`

**Interfaces:**
- Consumes: `RenderedPage` from Task 2, `Word` and `Line` from Task 3.
- Produces:
  - `type OcrAssets = { workerPath?: string; corePath?: string; langPath?: string }`
  - `async function ocrToWords(page: RenderedPage, lang: string, assets: OcrAssets): Promise<Word[]>`
  - `async function ocrToLines(page: RenderedPage, lang: string, assets: OcrAssets): Promise<Line[]>`

- [ ] **Step 1: Add the dependencies, including the language data**

```bash
pnpm add tesseract.js@7.0.0 @tesseract.js-data/ind @tesseract.js-data/eng
```

**The language data packages are not optional.** No `.traineddata` ships inside `tesseract.js` or `tesseract.js-core`; the library downloads it from a CDN at runtime. Since this project forbids that, the data has to come from somewhere, and `@tesseract.js-data/*` is that somewhere. `ind` is what production uses; `eng` is what this task's test uses.

The traineddata lives in a `4.0.0_best_int` subdirectory of each data package, which is the variant OEM 1 (`LSTM_ONLY`) loads, and it ships gzipped.

- [ ] **Step 2: Create the PNG encoder, which OCR needs before Task 9 does**

Create `src/lib/export/png.ts` exporting `encodePng(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array`, using `node:zlib` `deflateSync` in Node and `CompressionStream("deflate")` in the browser. `scripts/png.mjs` already holds the CRC and chunk-writing helpers, so lift them here and have the script import from this module rather than keeping two copies. Do not add `sharp` or `pngjs`.

This module was originally scheduled for Task 9. It moves here because `tesseract.js` cannot accept raw pixels, so OCR needs a PNG encoder before anything else does.

Copy the wasm core and language data into `public/tesseract/` as a `prebuild` step so an upgrade cannot silently revert to the CDN:

In `package.json`, add:

```json
"vendor:ocr": "node scripts/vendor-ocr.mjs",
"prebuild": "pnpm vendor:ocr"
```

Do **not** call this script `setup`. `pnpm setup` is a reserved built-in that silently shadows package scripts.

- [ ] **Step 3: Write the failing test**

Append to `scripts/test-pipeline.mjs`:

```js
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

  const lines = await ocrToLines(rendered, "eng", {});

  assert.ok(lines.length >= 2, `expected 2+ lines, got ${lines.length}`);
  const text = lines.map((l) => l.text).join(" ").toUpperCase();
  assert.ok(text.includes("PERJANJIAN"), `missing word in: ${text}`);
  // Boxes must be inside the image, or every downstream crop is wrong.
  for (const line of lines) {
    assert.ok(line.box.x >= 0 && line.box.x + line.box.w <= 600);
    assert.ok(line.box.y >= 0 && line.box.y + line.box.h <= 200);
  }
});
```

This is the one loose test in the plan. It asserts that OCR runs and returns in-bounds geometry, not that it is accurate. Accuracy is measured against real documents in Task 7, because synthetic rendered text does not resemble a 300 DPI scan.

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test scripts/test-pipeline.mjs`
Expected: FAIL, cannot resolve `../src/lib/pipeline/ocr.ts`

- [ ] **Step 5: Write minimal implementation**

Create `src/lib/pipeline/ocr.ts`:

```ts
import { createWorker } from "tesseract.js";
import type { RenderedPage } from "./render.ts";
import { groupWordsIntoLines, type Line, type Word } from "./geometry.ts";
import { encodePng } from "../export/png.ts";

/**
 * Paths are explicit because tesseract.js defaults to a CDN for its wasm core
 * and language data. That would put an unapproved third party in the
 * browser's request path, the same reason pdf.js keeps its bundled worker.
 * `scripts/vendor-ocr.mjs` copies these into public/tesseract at prebuild.
 */
export type OcrAssets = {
  workerPath?: string;
  corePath?: string;
  langPath?: string;
};

const BROWSER_ASSETS: Required<OcrAssets> = {
  workerPath: "/tesseract/worker.min.js",
  corePath: "/tesseract/",
  langPath: "/tesseract/",
};

export async function ocrToWords(
  page: RenderedPage,
  lang = "ind",
  assets: OcrAssets = {},
): Promise<Word[]> {
  const worker = await createWorker(lang, 1, {
    // Without this, a recognition failure is rethrown on a MessagePort tick
    // with no handler, which kills the whole process instead of rejecting.
    // The `finally` below would never run and the stack would not name this
    // function, so debugging starts from nothing.
    errorHandler: () => {},
    // gzip:true because @tesseract.js-data ships .traineddata.gz and the
    // vendoring step keeps it compressed. This must agree with what
    // scripts/vendor-ocr.mjs writes, or the fetch 404s.
    gzip: true,
    ...(typeof window === "undefined" ? {} : BROWSER_ASSETS),
    ...assets,
  });
  try {
    // tesseract.js has no raw-pixel path. It writes the bytes to a virtual
    // file and calls SetImageFile, which needs a decodable header, so raw
    // RGBA silently becomes a zero-length buffer and errors.
    const image = Buffer.from(encodePng(page.data, page.width, page.height));
    const { data } = await worker.recognize(image, {}, { blocks: true });

    const words: Word[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          for (const w of line.words ?? []) {
            if (!w.text.trim()) continue;
            words.push({
              text: w.text,
              box: {
                x: w.bbox.x0,
                y: w.bbox.y0,
                w: w.bbox.x1 - w.bbox.x0,
                h: w.bbox.y1 - w.bbox.y0,
              },
            });
          }
        }
      }
    }
    return words;
  } finally {
    await worker.terminate();
  }
}

export async function ocrToLines(
  page: RenderedPage,
  lang = "ind",
  assets: OcrAssets = {},
): Promise<Line[]> {
  return groupWordsIntoLines(await ocrToWords(page, lang, assets));
}
```

- [ ] **Step 6: Write the vendoring script**

Create `scripts/vendor-ocr.mjs`:

```js
/**
 * Copies the tesseract worker, wasm core, and language data out of
 * node_modules into public/, so the browser fetches them from this app rather
 * than from a CDN. Runs at prebuild so an upgrade cannot silently revert to
 * the CDN default.
 *
 * Paths are resolved, never assumed. Under pnpm nothing is hoisted to a flat
 * node_modules/, so node_modules/tesseract.js-core does not exist and a
 * hard-coded path silently copies nothing.
 */
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { repoRoot } from "./env.mjs";

const require = createRequire(import.meta.url);
const pkgDir = (spec, from = require) =>
  dirname(from.resolve(`${spec}/package.json`));

const out = join(repoRoot, "public", "tesseract");
await mkdir(out, { recursive: true });

// tesseract.js-core is a dependency OF tesseract.js, so resolve it through
// tesseract.js's own resolution root rather than from this script's.
const tesseractDir = pkgDir("tesseract.js");
const coreDir = pkgDir(
  "tesseract.js-core",
  createRequire(require.resolve("tesseract.js/package.json")),
);

let wasm = 0;
let data = 0;

for (const dir of [join(tesseractDir, "dist"), coreDir]) {
  for (const name of await readdir(dir)) {
    if (!/\.(js|wasm)$/.test(name)) continue;
    await copyFile(join(dir, name), join(out, name));
    if (name.endsWith(".wasm")) wasm += 1;
  }
}

// The traineddata ships only in @tesseract.js-data/*, under the variant that
// OEM 1 (LSTM_ONLY) loads, and it ships gzipped. ocr.ts sets gzip:true to match.
for (const lang of ["ind", "eng"]) {
  const file = `${lang}.traineddata.gz`;
  await copyFile(
    join(pkgDir(`@tesseract.js-data/${lang}`), "4.0.0_best_int", file),
    join(out, file),
  );
  data += 1;
}

// Guard on the asset CLASSES that matter, not on a total. A count-based guard
// passes while copying only JavaScript, leaving the CDN fallback in place for
// exactly the two things this rule exists to keep local.
if (wasm === 0 || data === 0) {
  throw new Error(
    `Vendored ${wasm} wasm and ${data} traineddata file(s). Both must be ` +
      "non-zero or the browser falls back to the CDN, which breaks the " +
      "zero-external-hosts guarantee.",
  );
}
console.log(`Vendored ${wasm} wasm and ${data} traineddata file(s).`);
```

The thrown error is the point, and so is what it counts. The original version of this script guarded on a total file count, which would have passed happily while copying nothing but JavaScript and leaving both the wasm and the language data coming from a CDN.

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test scripts/test-pipeline.mjs`
Expected: PASS, 9 tests. Slower than the others, but it reads the vendored language data from disk rather than downloading anything.

- [ ] **Step 8: Commit**

```bash
git add src/lib/export/png.ts src/lib/pipeline/ocr.ts scripts/vendor-ocr.mjs scripts/png.mjs scripts/test-pipeline.mjs package.json pnpm-lock.yaml .gitignore public/tesseract/.gitkeep
git commit -m "feat: OCR rendered pages to words and lines with self-hosted assets"
```

Gitignore the vendored payload itself. `public/tesseract/*` is build output regenerated by `prebuild`, and the wasm plus two language files are several megabytes of binary that would otherwise land in every diff:

```gitignore
/public/tesseract/*
!/public/tesseract/.gitkeep
```

---

### Task 5: Page classification from OCR text

**Files:**
- Create: `src/lib/pipeline/classify.ts`
- Modify: `scripts/test-pipeline.mjs`

**Interfaces:**
- Consumes: `Line` from Task 3.
- Produces:
  - `type DocType = "KB" | "SP" | "BAPermintaan" | "Email" | "Unknown"`
  - `type Span = { docType: DocType; fromPage: number; toPage: number }`
  - `type Ask = (prompt: string) => Promise<string>`
  - `function buildClassifyPrompt(pages: { index: number; head: string }[]): string`
  - `async function classifyPages(pages, ask: Ask): Promise<Span[]>`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-pipeline.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/test-pipeline.mjs`
Expected: FAIL, cannot resolve `../src/lib/pipeline/classify.ts`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/pipeline/classify.ts`:

```ts
import { z } from "zod";

export type DocType = "KB" | "SP" | "BAPermintaan" | "Email" | "Unknown";
export type Span = { docType: DocType; fromPage: number; toPage: number };

/** Injected so this module never imports a provider SDK. */
export type Ask = (prompt: string) => Promise<string>;

const DOC_TYPES = ["KB", "SP", "BAPermintaan", "Email", "Unknown"] as const;

const Reply = z.object({
  spans: z.array(
    z.object({
      docType: z.enum(DOC_TYPES),
      fromPage: z.number().int().min(0),
      toPage: z.number().int().min(0),
    }),
  ),
});

/** How many characters of each page the model sees. Headings live at the top. */
const HEAD_CHARS = 400;

export function buildClassifyPrompt(
  pages: { index: number; head: string }[],
): string {
  const listing = pages
    .map((p) => `page ${p.index}: ${p.head.slice(0, HEAD_CHARS)}`)
    .join("\n");

  return [
    "You are segmenting a bundle of scanned Indonesian telecom order documents.",
    "Each page's opening text is given. Group consecutive pages into spans by",
    "document type. Every page must fall in exactly one span.",
    "",
    "Types:",
    "  KB           Perjanjian Kerjasama Berlangganan, the subscription contract",
    "  SP           Surat Penunjukan, the appointment letter",
    "  BAPermintaan Berita Acara Permintaan Order",
    "  Email        a printed email thread",
    "  Unknown      anything else",
    "",
    "A document may repeat; emit each occurrence as its own span.",
    'Reply with JSON only: {"spans":[{"docType":"KB","fromPage":0,"toPage":22}]}',
    "",
    listing,
  ].join("\n");
}

/** Models wrap JSON in prose or fences often enough that this is not optional. */
function extractJson(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : reply;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`No JSON object in model reply: ${reply.slice(0, 200)}`);
  }
  return JSON.parse(body.slice(start, end + 1));
}

export async function classifyPages(
  pages: { index: number; head: string }[],
  ask: Ask,
): Promise<Span[]> {
  const parsed = Reply.parse(extractJson(await ask(buildClassifyPrompt(pages))));
  const last = pages.length - 1;

  for (const span of parsed.spans) {
    if (span.fromPage > span.toPage) {
      throw new Error(`span reversed: ${span.fromPage} > ${span.toPage}`);
    }
    if (span.toPage > last) {
      throw new Error(`span toPage ${span.toPage} exceeds last page ${last}`);
    }
  }
  return parsed.spans;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test-pipeline.mjs`
Expected: PASS, 13 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/classify.ts scripts/test-pipeline.mjs
git commit -m "feat: classify bundle pages into document spans from OCR text"
```

---

### Task 6: Locate a slot as a line range

**Files:**
- Create: `src/lib/pipeline/locate.ts`
- Modify: `scripts/test-pipeline.mjs`

**Interfaces:**
- Consumes: `Line` from Task 3, `Box` from Task 2, `boxForLineRange` from Task 3, `Ask` from Task 5.
- Produces:
  - `type OcrPage = { index: number; width: number; height: number; lines: Line[] }`
  - `type Zone = { pageIndex: number; box: Box; lineRange: [number, number] }`
  - `type LocateResult = { zone: Zone; text: string; confidence: "high" | "low" } | null`
  - `const CROP_PADDING_PX = 12`
  - `function buildLocatePrompt(slotLabel: string, hint: string, pages: OcrPage[]): string`
  - `async function locateSlot(slotLabel, hint, pages, ask): Promise<LocateResult>`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-pipeline.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/test-pipeline.mjs`
Expected: FAIL, cannot resolve `../src/lib/pipeline/locate.ts`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/pipeline/locate.ts`:

```ts
import { z } from "zod";
import type { Box } from "./render.ts";
import { boxForLineRange, type Line } from "./geometry.ts";
import type { Ask } from "./classify.ts";

export type OcrPage = {
  index: number;
  width: number;
  height: number;
  lines: Line[];
};

export type Zone = {
  pageIndex: number;
  box: Box;
  lineRange: [number, number];
};

export type LocateResult = {
  zone: Zone;
  text: string;
  confidence: "high" | "low";
} | null;

/**
 * A crop flush against the glyphs looks clipped once it is a picture in a
 * Word table. Twelve pixels at 300 DPI is about 1mm of white space.
 */
export const CROP_PADDING_PX = 12;

const Reply = z.object({
  pageIndex: z.number().int().min(0).nullable(),
  from: z.number().int().min(0).nullable(),
  to: z.number().int().min(0).nullable(),
  confidence: z.enum(["high", "low"]),
});

function extractJson(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : reply;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`No JSON object in model reply: ${reply.slice(0, 200)}`);
  }
  return JSON.parse(body.slice(start, end + 1));
}

export function buildLocatePrompt(
  slotLabel: string,
  hint: string,
  pages: OcrPage[],
): string {
  const listing = pages
    .map(
      (p) =>
        `--- page ${p.index} ---\n` +
        p.lines.map((l) => `${l.i}: ${l.text}`).join("\n"),
    )
    .join("\n\n");

  return [
    `Find the section of this document that answers the field "${slotLabel}".`,
    `What that field means: ${hint}`,
    "",
    "The pages below are OCR text with every line numbered. Choose the",
    "smallest contiguous run of lines that a reader would accept as proof of",
    "this field. Include the label line when there is one. Do not include",
    "unrelated paragraphs above or below.",
    "",
    'Reply with JSON only: {"pageIndex":0,"from":7,"to":8,"confidence":"high"}',
    'If no page contains it, reply {"pageIndex":null,"from":null,"to":null,',
    '"confidence":"low"}.',
    "",
    listing,
  ].join("\n");
}

export async function locateSlot(
  slotLabel: string,
  hint: string,
  pages: OcrPage[],
  ask: Ask,
): Promise<LocateResult> {
  const reply = Reply.parse(
    extractJson(await ask(buildLocatePrompt(slotLabel, hint, pages))),
  );

  if (reply.pageIndex === null || reply.from === null || reply.to === null) {
    return null;
  }

  const page = pages.find((p) => p.index === reply.pageIndex);
  if (!page) {
    throw new Error(`model returned pageIndex ${reply.pageIndex}, not offered`);
  }

  const bounds: Box = { x: 0, y: 0, w: page.width, h: page.height };
  const box = boxForLineRange(
    page.lines,
    reply.from,
    reply.to,
    CROP_PADDING_PX,
    bounds,
  );

  return {
    zone: { pageIndex: page.index, box, lineRange: [reply.from, reply.to] },
    text: page.lines
      .filter((l) => l.i >= reply.from! && l.i <= reply.to!)
      .map((l) => l.text)
      .join("\n"),
    confidence: reply.confidence,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test-pipeline.mjs`
Expected: PASS, 17 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/locate.ts scripts/test-pipeline.mjs
git commit -m "feat: locate a slot as a line range and turn it into a crop box"
```

---

### Task 7: The measurement gate

**This task decides whether the rest of the plan survives.** It is the first task that touches real documents, and its output is a number, not a feature. Tasks 1 through 6 exist only to make it runnable; the spec's instruction that measurement comes "before any UI" is satisfied here, before a single screen is built.

**Files:**
- Create: `scripts/measure-locate.mjs`
- Modify: `package.json`
- Delete: `scripts/_probe-extract.mjs`

**Interfaces:**
- Consumes: everything from Tasks 2 through 6, plus `src/lib/model.ts` for a real `ask`.
- Produces: a scored report on stdout. No exported API.

- [ ] **Step 1: Write the harness**

Create `scripts/measure-locate.mjs`. Ground truth is the eleven crops in the sample docx, whose source pages were traced during design. Encode the expectation as text the crop must contain, since a rectangle comparison against a human's freehand drag would fail on padding alone:

```js
/**
 * Scores the locate step against the eleven human-authored crops in the
 * sample DOKUMEN VALIDASI. Run by hand: it reads gitignored client documents
 * and calls the real model.
 *
 * A slot passes when the model lands on the right page and the lines it chose
 * contain the expected phrase, with no more than two extra lines. That
 * tolerates the difference between a computed union and a human's drag while
 * still failing a crop that misses a line or swallows half a page.
 */
const GROUND_TRUTH = [
  { slot: "KB / Nomor", doc: "merged", page: 0,
    hint: "the contract number of the Perjanjian Kerjasama",
    expect: "04/0044-PKS" },
  { slot: "KB / Para Pihak", doc: "merged", page: 0,
    hint: "the two parties entering the agreement",
    expect: "BANK SYARIAH INDONESIA" },
  { slot: "KB / Tanggal", doc: "merged", page: 0,
    hint: "the date the agreement was signed",
    expect: "Pada hari ini" },
  // Remaining eight rows are filled in during Step 2 from the real bundle.
];
```

- [ ] **Step 2: Complete the ground truth**

Open `documents/Form_Validasi_LOP285120_1-72989090591-bsivpn (2).docx`, read each of the eleven PDF-sourced crops, and add a row per crop with a phrase unique to it. Provenance established during design:

| Slot | Source | Page (0-based) |
| --- | --- | --- |
| BA Permintaan | SPLITBA | 0 |
| Email | SPLITBA | 1 |
| SP (2 crops) | merged | 23 to 26 |
| KB Nomor, Para Pihak, Tanggal, Jangka Waktu, Detail, ToP, TTD Pejabat | merged | within 0 to 22 |

Only the four KB slots beyond page 0 need their page found by reading the sample crops against the bundle.

- [ ] **Step 3: Run the gate**

```bash
pnpm measure:locate
```

Add to `package.json`:

```json
"measure:locate": "node scripts/measure-locate.mjs"
```

Expected output: one line per slot reading `PASS` or `FAIL` with the page and line range chosen, then a total.

- [ ] **Step 4: Decide, and record the decision**

- **Nine or more of eleven pass.** The design holds. Append the scores to the spec under "Measurement gate" and continue to Task 8.
- **Fewer than nine pass.** Stop. Do not start Task 8. Record which slots failed and whether the failures cluster in one document type, which points at the prompt, or scatter across all eleven, which points at the approach. Return to the spec's rejected alternative, asking the model for normalized boxes directly, and re-plan from there.

Record the outcome either way. A gate whose result is not written down stops being a gate.

- [ ] **Step 5: Commit**

```bash
git add scripts/measure-locate.mjs package.json docs/superpowers/specs/2026-08-30-dokumen-validasi-design.md
git commit -m "test: score locate against the eleven ground-truth crops"
```

There was a design-time probe at `scripts/_probe-extract.mjs` that pulled page bitmaps out of a PDF without a canvas, which Task 2 supersedes. It was never committed, so in this worktree there is nothing to delete. If you are working in a checkout where it does exist, `git rm` it as part of this commit; otherwise ignore it. Do not create it in order to delete it.

---

### Task 8: Template configuration

**Files:**
- Create: `src/lib/forms/template.ts`
- Modify: `scripts/test-pipeline.mjs`

**Interfaces:**
- Consumes: `DocType` from Task 5.
- Produces:
  - `type SlotDef = { key: string; label: string; docType: DocType | null; hint: string; fillable: boolean }`
  - `type SectionDef = { title: string; slots: SlotDef[]; layout: "images" | "table" }`
  - `type XlsxRowDef = { nomor?: number; itemI?: string; itemII?: string; keterangan?: "Isi" | "Pilih" | "Klik"; fieldKey?: string }`
  - `type Template = { id: string; label: string; sections: SectionDef[]; xlsxRows: XlsxRowDef[] }`
  - `const AO_TEMPLATE: Template`

- [ ] **Step 1: Write the failing tests**

The point of these assertions is that the default transcribes the sample document rather than improving on it.

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/test-pipeline.mjs`
Expected: FAIL, cannot resolve `../src/lib/forms/template.ts`

- [ ] **Step 3: Transcribe the template**

Create `src/lib/forms/template.ts`. Transcribe from the sample document, including its oddities. Two to preserve deliberately: the `Konfigurasi` section's first row is labelled with the quote number itself, so its label is the token `{{quote}}`; and the `SBR Pricing` section's first row reads `Nomor dan tanggal (tidak ada)` with the parenthetical intact.

Sections and their rows, in document order:

| Section | Layout | Rows | Fillable in v1 |
| --- | --- | --- | --- |
| BA Permintaan | images | one unlabelled slot | yes |
| SP | images | two unlabelled slots | yes |
| KB | table | Nomor, Para Pihak, Tanggal, Jangka Waktu | yes |
| KB (lanjutan) | table | Detail, ToP, TTD Pejabat | yes |
| Konfigurasi (Excel dari EPIC) | table | SID, Konfigurasi | no |
| Konfigurasi | table | `{{quote}}`, Price & SA, BW, BA | no |
| Email | images | one unlabelled slot | yes |
| MOM | images | none | no |
| BA Splitting | table | Nomor, Detail Kontrak, Detail Splitting, TTD Pejabat | no |
| SBR Pricing | table | Nomor dan tanggal (tidak ada), Diskon ke CC, TTD Pejabat | no |
| BASO | images | none | no |
| BA Penjelasan Order | images | none | no |

That is 1 + 2 + 4 + 3 + 1 = 11 fillable slots, matching the test.

The 34 `xlsxRows` transcribe the sample workbook's 34 data rows, which are sheet rows 2 through 35; the header row is emitted by the exporter, not stored in the template. Give a `fieldKey` only to rows a PDF can back; leave it undefined on the EPIC-only rows (Customer Account, Billing Account, Sales Team, LatLong), which keeps them blank in the export by construction rather than by a later check.

One trap the sample sets: the service address appears **twice**, on sheet row 7 (`Quote / Field Name`) and again on sheet row 12 (`Service Account`). Only the first carries `fieldKey: "alamat"`. Giving it to both makes Task 11's `assert.equal(filled, 1)` see 2, and more importantly double-fills a value the operator only confirmed once.

Write it in this shape, so the types the later tasks import are unambiguous:

```ts
import type { DocType } from "../pipeline/classify";

export type SlotDef = {
  key: string;
  label: string;
  docType: DocType | null;
  hint: string;
  fillable: boolean;
};

export type SectionDef = {
  title: string;
  layout: "images" | "table";
  slots: SlotDef[];
};

export type XlsxRowDef = {
  nomor?: number;
  itemI?: string;
  itemII?: string;
  keterangan?: "Isi" | "Pilih" | "Klik";
  /** Undefined means no PDF can back this row, so it stays blank. */
  fieldKey?: string;
};

export type Template = {
  id: string;
  label: string;
  sections: SectionDef[];
  xlsxRows: XlsxRowDef[];
};

export const AO_TEMPLATE: Template = {
  id: "AO",
  label: "DOKUMEN VALIDASI",
  sections: [
    {
      title: "BA Permintaan",
      layout: "images",
      slots: [
        {
          key: "ba.permintaan",
          label: "BA Permintaan",
          docType: "BAPermintaan",
          hint: "the whole Berita Acara Permintaan Order page",
          fillable: true,
        },
      ],
    },
    {
      title: "KB",
      layout: "table",
      slots: [
        {
          key: "kb.nomor",
          label: "Nomor",
          docType: "KB",
          hint: "the contract number of the Perjanjian Kerjasama",
          fillable: true,
        },
        // Para Pihak, Tanggal, Jangka Waktu follow the same shape.
      ],
    },
    {
      title: "MOM",
      layout: "images",
      slots: [],
    },
    // ...remaining sections from the table above, in order.
  ],
  xlsxRows: [
    { nomor: 1, itemI: "Lead", itemII: "Description", keterangan: "Isi",
      fieldKey: "namaProyek" },
    { itemII: "Contact Last Name", keterangan: "Pilih", fieldKey: "picContacts" },
    { itemII: "Account", keterangan: "Isi", fieldKey: "cc" },
    // ...31 more, EPIC-only rows carrying no fieldKey.
  ],
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test-pipeline.mjs`
Expected: PASS, 23 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/forms/template.ts scripts/test-pipeline.mjs
git commit -m "feat: transcribe the AO DOKUMEN VALIDASI template as config"
```

---

### Task 9: Crop extraction and the docx exporter

**Files:**
- Create: `src/lib/export/crop.ts`
- Create: `src/lib/export/docx.ts`
- Modify: `scripts/test-pipeline.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `RenderedPage` and `Box` from Task 2, `Zone` from Task 6, `Template` from Task 8.
- Produces:
  - `function cropToPng(page: RenderedPage, box: Box): Uint8Array`
  - `type FilledSlot = { key: string; png: Uint8Array; widthPx: number; heightPx: number }`
  - `type HeaderFields = { idEpic: string; namaProyek: string; quote: string; cc: string; order: string; jenisOrder: string }`
  - `async function buildDocx(template, header: HeaderFields, filled: FilledSlot[]): Promise<Uint8Array>`

- [ ] **Step 1: Add the dependency**

```bash
pnpm add docx@9.7.1
```

Audited 2026-08-30 with `docx@9.7.1`, `tesseract.js@7.0.0`, and `@google-cloud/firestore@9.0.0`: zero vulnerabilities at every severity. Re-run `npm audit` before bumping any of them.

- [ ] **Step 2: Write the failing tests**

```js
import { cropToPng } from "../src/lib/export/crop.ts";
import { buildDocx } from "../src/lib/export/docx.ts";
import JSZip from "jszip";

test("cropToPng extracts exactly the requested rectangle", () => {
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

  const png = cropToPng(rendered, { x: 20, y: 20, w: 10, h: 10 });
  assert.ok(png.length > 0);
  // PNG magic, so a caller cannot mistake raw pixels for an encoded image.
  assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test("buildDocx emits every section, including the empty ones", async () => {
  const bytes = await buildDocx(
    AO_TEMPLATE,
    { idEpic: "LOP285120", namaProyek: "PSB VPN IP KCP Jakarta Slipi",
      quote: "1-72989090591", cc: "BANK SYARIAH INDONESIA",
      order: "", jenisOrder: "AO" },
    [],
  );

  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml").async("string");

  for (const title of ["BA Permintaan", "SP", "KB", "MOM", "BASO",
                       "BA Penjelasan Order"]) {
    assert.ok(xml.includes(title), `missing section: ${title}`);
  }
  assert.ok(xml.includes("LOP285120"));
  // The quote number is a row label in the Konfigurasi table, not just header.
  assert.ok(xml.includes("1-72989090591"));
});

test("buildDocx writes real png media parts at their true size", async () => {
  // Guards two defects the section test cannot see: a missing ImageRun `type`
  // silently produces word/media/<hash>.undefined, and a points-vs-pixels
  // mixup silently shrinks every crop to 75%.
  const canvas = createCanvas(600, 300);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 600, 300);
  const png = cropToPng(
    { data: ctx.getImageData(0, 0, 600, 300).data, width: 600, height: 300 },
    { x: 0, y: 0, w: 600, h: 300 },
  );

  const bytes = await buildDocx(
    AO_TEMPLATE,
    { idEpic: "LOP285120", namaProyek: "P", quote: "1-72989090591",
      cc: "C", order: "", jenisOrder: "AO" },
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
```

`jszip` is already a devDependency, so reading the output back needs no new package.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test scripts/test-pipeline.mjs`
Expected: FAIL, cannot resolve `../src/lib/export/crop.ts`

- [ ] **Step 4: Implement the crop**

`src/lib/export/png.ts` already exists: it was created in Task 4, because `tesseract.js` needs encoded images and so needed it first.

Create `src/lib/export/crop.ts`:

```ts
import type { Box, RenderedPage } from "../pipeline/render.ts";
import { encodePng } from "./png.ts";

/**
 * Copies the sub-rectangle out of the page's RGBA buffer row by row. Boxes
 * arrive from geometry.ts already clamped to the page, so an out-of-bounds
 * box here means a caller skipped padBox and is a bug worth throwing on.
 */
export function cropToPng(page: RenderedPage, box: Box): Uint8Array {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const w = Math.round(box.w);
  const h = Math.round(box.h);

  if (x < 0 || y < 0 || x + w > page.width || y + h > page.height) {
    throw new Error(
      `crop ${x},${y} ${w}x${h} escapes page ${page.width}x${page.height}`,
    );
  }
  if (w <= 0 || h <= 0) throw new Error(`empty crop ${w}x${h}`);

  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * page.width + x) * 4;
    out.set(page.data.subarray(from, from + w * 4), row * w * 4);
  }
  return encodePng(out, w, h);
}
```

- [ ] **Step 5: Implement the docx**

Create `src/lib/export/docx.ts`. The walk is the whole design; the styling follows the sample.

```ts
import {
  Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell,
  ImageRun, WidthType,
} from "docx";
import type { Template, SectionDef } from "../forms/template";

export type FilledSlot = {
  key: string;
  png: Uint8Array;
  widthPx: number;
  heightPx: number;
};

export type HeaderFields = {
  idEpic: string; namaProyek: string; quote: string;
  cc: string; order: string; jenisOrder: string;
};

/**
 * docx sizes images in PIXELS AT 96 DPI (9525 EMU each), not points. Crops are
 * cut at 300 DPI, so converting to points instead renders every image at 75%
 * of its true size, which looks plausible and is wrong.
 */
const CROP_DPI = 300;
const DOCX_PX_PER_INCH = 96;
const toDocxPx = (px: number) => (px / CROP_DPI) * DOCX_PX_PER_INCH;

function imageParagraph(slot: FilledSlot): Paragraph {
  return new Paragraph({
    children: [
      new ImageRun({
        // Required in docx v9. Omitting it writes word/media/<hash>.undefined,
        // which has no content type and makes Word refuse the file.
        type: "png",
        data: slot.png,
        transformation: {
          width: toDocxPx(slot.widthPx),
          height: toDocxPx(slot.heightPx),
        },
      }),
    ],
  });
}

function renderSection(
  section: SectionDef,
  filled: Map<string, FilledSlot>,
): (Paragraph | Table)[] {
  const heading = new Paragraph({
    text: section.title,
    heading: HeadingLevel.HEADING_2,
  });

  if (section.layout === "images") {
    const images = section.slots
      .map((s) => filled.get(s.key))
      .filter((s): s is FilledSlot => Boolean(s))
      .map(imageParagraph);
    // An empty section still emits its heading: the sample ships MOM, BASO,
    // and BA Penjelasan Order empty, and the operator fills them by hand.
    return [heading, ...images];
  }

  return [
    heading,
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: section.slots.map((slotDef) => {
        const slot = filled.get(slotDef.key);
        return new TableRow({
          children: [
            new TableCell({ children: [new Paragraph(slotDef.label)] }),
            new TableCell({
              // A deliberately empty cell is the deliverable for the six
              // EPIC and xlsx slots. Do not omit the row.
              children: [slot ? imageParagraph(slot) : new Paragraph("")],
            }),
          ],
        });
      }),
    }),
  ];
}

export async function buildDocx(
  template: Template,
  header: HeaderFields,
  filled: FilledSlot[],
): Promise<Uint8Array> {
  const byKey = new Map(filled.map((s) => [s.key, s]));

  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      ["ID EPIC :", header.idEpic, "NAMA Proyek :", header.namaProyek],
      ["QUOTE :", header.quote, "CC :", header.cc],
      ["ORDER :", header.order, "JENIS ORDER :", header.jenisOrder],
    ].map(
      (cells) =>
        new TableRow({
          children: cells.map(
            (text) => new TableCell({ children: [new Paragraph(text)] }),
          ),
        }),
    ),
  });

  const doc = new Document({
    title: template.label,
    sections: [
      {
        children: [
          headerTable,
          ...template.sections.flatMap((s) =>
            renderSection(
              // The Konfigurasi table labels one row with the quote number.
              {
                ...s,
                slots: s.slots.map((x) => ({
                  ...x,
                  label: x.label.replace("{{quote}}", header.quote),
                })),
              },
              byKey,
            ),
          ),
        ],
      },
    ],
  });

  return new Uint8Array(await Packer.toBuffer(doc));
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test scripts/test-pipeline.mjs`
Expected: PASS, 26 tests

- [ ] **Step 7: Commit**

```bash
git add src/lib/export/crop.ts src/lib/export/docx.ts scripts/test-pipeline.mjs package.json pnpm-lock.yaml
git commit -m "feat: crop zones to PNG and build the DOKUMEN VALIDASI docx"
```

---

### Task 10: Header fields and text extraction

The docx header table and the xlsx values are the same job: named text pulled out of the documents. Nothing so far produces either, and `buildDocx` in Task 9 already requires `HeaderFields`.

**Files:**
- Create: `src/lib/pipeline/fields.ts`
- Modify: `scripts/test-pipeline.mjs`

**Interfaces:**
- Consumes: `OcrPage` from Task 6, `Ask` from Task 5, `HeaderFields` from Task 9.
- Produces:
  - `type FieldValue = { fieldKey: string; value: string; source?: { pageIndex: number; lineRange: [number, number] } }`
  - `function deriveIdsFromFilenames(names: string[]): { idEpic: string; quote: string }`
  - `async function extractFields(keys: string[], pages: OcrPage[], ask: Ask): Promise<FieldValue[]>`

- [ ] **Step 1: Write the failing tests**

```js
import { deriveIdsFromFilenames, extractFields } from "../src/lib/pipeline/fields.ts";

test("deriveIdsFromFilenames finds the LOP and quote ids", () => {
  assert.deepEqual(
    deriveIdsFromFilenames([
      "LOP285120_EXISTING_20240126_PKS_BSI_II_merged.pdf",
      "Form_Validasi_LOP285120_1-72989090591-bsivpn (2).docx",
    ]),
    { idEpic: "LOP285120", quote: "1-72989090591" },
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
    index: 0, width: 500, height: 500,
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
```

The second test is the one that matters. A filename heuristic that invents an ID is worse than one that returns nothing, because the spec says these are prefilled guesses the operator confirms, and a blank field asks to be confirmed while a wrong one does not.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/test-pipeline.mjs`
Expected: FAIL, cannot resolve `../src/lib/pipeline/fields.ts`

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/pipeline/fields.ts`:

```ts
import { z } from "zod";
import type { Ask } from "./classify";
import type { OcrPage } from "./locate";

export type FieldValue = {
  fieldKey: string;
  value: string;
  source?: { pageIndex: number; lineRange: [number, number] };
};

/**
 * Filenames carry the two ids reliably enough to prefill, and not reliably
 * enough to trust. Returning "" rather than a guess is deliberate: the
 * operator confirms every header field, and a blank invites that while a
 * plausible wrong value does not.
 */
export function deriveIdsFromFilenames(names: string[]): {
  idEpic: string;
  quote: string;
} {
  const joined = names.join(" ");
  // No \b anchors: "_" is a word character, so \bLOP\d+\b never matches
  // inside LOP285120_EXISTING_... which is exactly the shape of these names.
  return {
    idEpic: joined.match(/LOP\d{4,}/)?.[0] ?? "",
    quote: joined.match(/\d-\d{9,}/)?.[0] ?? "",
  };
}

const Reply = z.object({
  values: z.array(
    z.object({
      fieldKey: z.string(),
      value: z.string(),
      pageIndex: z.number().int().min(0).nullable(),
      from: z.number().int().min(0).nullable(),
      to: z.number().int().min(0).nullable(),
    }),
  ),
});

function extractJson(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : reply;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`No JSON object in model reply: ${reply.slice(0, 200)}`);
  }
  return JSON.parse(body.slice(start, end + 1));
}

export async function extractFields(
  keys: string[],
  pages: OcrPage[],
  ask: Ask,
): Promise<FieldValue[]> {
  const listing = pages
    .map(
      (p) =>
        `--- page ${p.index} ---\n` +
        p.lines.map((l) => `${l.i}: ${l.text}`).join("\n"),
    )
    .join("\n\n");

  const prompt = [
    "Extract these fields from the numbered OCR lines below.",
    `Fields: ${keys.join(", ")}`,
    "",
    "Report only fields the text actually contains. Omit anything you would",
    "have to infer. For each one, cite the page and line range it came from.",
    'Reply with JSON only: {"values":[{"fieldKey":"cc","value":"PT X",',
    '"pageIndex":0,"from":3,"to":3}]}',
    "",
    listing,
  ].join("\n");

  const parsed = Reply.parse(extractJson(await ask(prompt)));

  return parsed.values
    .filter((v) => keys.includes(v.fieldKey) && v.value.trim() !== "")
    .map((v) => ({
      fieldKey: v.fieldKey,
      value: v.value,
      source:
        v.pageIndex !== null && v.from !== null && v.to !== null
          ? { pageIndex: v.pageIndex, lineRange: [v.from, v.to] as [number, number] }
          : undefined,
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/test-pipeline.mjs`
Expected: PASS, 29 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/fields.ts scripts/test-pipeline.mjs
git commit -m "feat: derive header ids from filenames and extract cited field values"
```

---

### Task 11: The xlsx exporter and the end-to-end script

**Files:**
- Create: `src/lib/export/xlsx.ts`
- Create: `scripts/generate.mjs`
- Modify: `scripts/test-pipeline.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Template` from Task 8, `FieldValue` from Task 10, `buildDocx` and `FilledSlot` from Task 9.
- Produces:
  - `async function buildXlsx(template: Template, values: FieldValue[]): Promise<Uint8Array>`

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/test-pipeline.mjs`
Expected: FAIL, cannot resolve `../src/lib/export/xlsx.ts`

- [ ] **Step 3: Implement the exporter**

Create `src/lib/export/xlsx.ts`. Use `exceljs`, never `xlsx`.

```ts
import exceljs from "exceljs";
import type { Template } from "../forms/template";
import type { FieldValue } from "../pipeline/fields";

/**
 * Rows carrying no fieldKey are the EPIC-only ones (Customer Account,
 * Billing Account, Sales Team, LatLong). They stay blank by construction,
 * because nothing can match them, rather than by a check someone can delete.
 */
export async function buildXlsx(
  template: Template,
  values: FieldValue[],
): Promise<Uint8Array> {
  const byKey = new Map(values.map((v) => [v.fieldKey, v]));

  const workbook = new exceljs.Workbook();
  const sheet = workbook.addWorksheet("Order Config");

  sheet.addRow(["Nomor", "Item I", "Item II", "Keterangan", ""]);

  for (const row of template.xlsxRows) {
    const value = row.fieldKey ? byKey.get(row.fieldKey) : undefined;
    const added = sheet.addRow([
      row.nomor ?? "",
      row.itemI ?? "",
      row.itemII ?? "",
      row.keterangan ?? "",
      value?.value ?? "",
    ]);

    if (value?.source) {
      const [from, to] = value.source.lineRange;
      // Provenance travels with the value, so a reviewer can check the claim
      // without rerunning anything.
      added.getCell(5).note =
        `page ${value.source.pageIndex}, lines ${from}-${to}`;
    }
  }

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
```

- [ ] **Step 4: Write the end-to-end script**

Create `scripts/generate.mjs`, wiring render, OCR, classify, locate, and both exporters into one command that takes PDF paths and writes both files. Use the real `ask` from `src/lib/model.ts`. Log `in=`, `out=`, `thoughts=`, `total=` per model call, matching what `/api/chat` already does, so cost stays visible in the log rather than on an invoice.

Add to `package.json`:

```json
"generate": "node scripts/generate.mjs"
```

- [ ] **Step 5: Run it against the real bundle**

```bash
pnpm generate documents/LOP285120_EXISTING_20240126_PKS_BSI_II_merged.pdf documents/LOP285120_SPLITBA_BAP_C_Tel_17582_PSB_KCP_Slipi_REV3.pdf
```

Open both outputs. Compare the docx against the sample side by side. This is the deliverable of the whole plan: the same document, generated.

- [ ] **Step 6: Run the full suite and commit**

Run: `node --test scripts/test-converters.mjs scripts/test-pipeline.mjs`
Expected: PASS, 30 tests in `test-pipeline.mjs` plus the existing converter tests

```bash
git add src/lib/export/xlsx.ts scripts/generate.mjs scripts/test-pipeline.mjs package.json
git commit -m "feat: build the EPIC config xlsx and wire the end-to-end generator"
```

---

## What this plan does not cover

- **The operator UI.** Contact sheet, zone editor, IndexedDB persistence. Plan B, and it depends on Task 7 passing.
- **Deployment and auth.** Cloud Run, Auth.js, the Firestore allowlist, the Dockerfile. Plan C, independent of this plan and doable in parallel.
- **The signature-block vision fallback.** `TTD Pejabat` is the one slot the spec expects OCR line-picking to struggle with. Task 7 will show whether it does. If it fails there and the other ten pass, add the fallback in Plan B alongside the manual-draw path, since a human drawing one box per run is an acceptable v1 answer.
- **`AGENTS.md` updates.** The spec lists seven rules to add. Land them with Plan C, when the deployment facts they describe are real.
