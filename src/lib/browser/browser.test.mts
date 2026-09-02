/**
 * Tests for the browser runtime: the parts of it that can be reached without
 * a browser.
 *
 * Three groups, and the first two exist because of a specific recorded bug.
 *
 * 1. RUNTIME DETECTION. `src/lib/pipeline/ocr.ts` used to read
 *    `typeof window === "undefined"` as "I am in Node". A browser Web Worker
 *    has no `window` either, and a Web Worker is exactly where this project
 *    now runs OCR, so on the face of it the vendored tesseract asset paths
 *    were skipped there and tesseract.js kept its own jsdelivr defaults for
 *    the worker script, the wasm core and the language data -- an unapproved
 *    third party in the browser's request path, shipping while looking
 *    correct, because OCR still works when the CDN answers. Measured against
 *    the built worker chunk, Turbopack folds that check for a browser target
 *    and the branch never survives to run, so the old code was correct by
 *    bundler constant-folding rather than by construction. These tests pin
 *    the construction. `node --test` cannot conjure a real Web Worker, which
 *    is why `detectRuntime` and `ocrAssetsFor` take the global scope as an
 *    argument at all: the decision is checkable against a synthetic one
 *    instead of going unchecked.
 *
 * 2. ASSET PATHS ARE ABSOLUTE. tesseract.js only resolves a relative path to
 *    an absolute URL when `document` exists, and inside a worker it hands the
 *    raw string to a Blob-URL worker whose body is `importScripts(path)`. A
 *    blob: URL has an opaque path, so a root-relative specifier cannot be
 *    resolved against it at all. The test below asserts that fact directly.
 *
 * 3. THE RUN MODEL. Ingest order, per-page progress, and the additive append
 *    that the dokumen tambahan loop stands on. IndexedDB and the Web Worker
 *    are absent here, so what is under test is the logic those two carry
 *    rather than the wiring; that split is why `ingest.ts` takes pdf.js and
 *    the canvas as arguments and why the append is its own function.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import type { PDFPageProxy } from "pdfjs-dist";

import {
  detectRuntime,
  ocrAssetsFor,
  type RuntimeScope,
} from "../pipeline/ocr.ts";
import type { CanvasFactory } from "../pipeline/render.ts";
import { ingestPdf, type IngestedPage, type PdfDocumentLike } from "./ingest.ts";
import {
  outstandingSlots,
  seedSlots,
  slotKeyOf,
  withAppendedPage,
  type BrowserRun,
  type SlotState,
  type StoredPage,
} from "./runtime.ts";
import { AO_TEMPLATE } from "../forms/template.ts";

const nodeContext: CanvasFactory = (w, h) => createCanvas(w, h).getContext("2d");

// ---------------------------------------------------------------------------
// 1. Runtime detection
// ---------------------------------------------------------------------------

/** What a browser Web Worker's global scope looks like to this code. */
const workerScope: RuntimeScope = {
  importScripts: () => {},
  WorkerGlobalScope: function WorkerGlobalScope() {},
  location: { origin: "https://tv-helper.example" },
};

/** A browser main thread. */
const windowScope: RuntimeScope = {
  document: {},
  window: {},
  location: { origin: "https://tv-helper.example" },
};

const realNodeScope: RuntimeScope = { process: { versions: { node: "24.14.0" } } };

test("a Web Worker is a browser, even though it has no window", () => {
  // The trap, stated as an assertion: the old check would have called this
  // Node, because `window` is undefined here exactly as it is under Node.
  assert.equal(typeof workerScope.window, "undefined");
  assert.equal(detectRuntime(workerScope), "browser");
});

test("detectRuntime recognises the main thread, Node, and neither", () => {
  assert.equal(detectRuntime(windowScope), "browser");
  assert.equal(detectRuntime(realNodeScope), "node");

  // A bundler's `process` shim defines `versions` as an empty object. Reading
  // that as Node is how a browser bundle would take the Node branch.
  assert.equal(detectRuntime({ process: { versions: {} } }), "browser");

  // Unknown runtime falls to "browser" on purpose: that pins the local asset
  // paths, so an unrecognised environment 404s loudly instead of quietly
  // fetching from a CDN.
  assert.equal(detectRuntime({}), "browser");
});

test("detectRuntime called with no argument reports this process as Node", () => {
  assert.equal(detectRuntime(), "node");
});

// ---------------------------------------------------------------------------
// 2. Vendored OCR assets
// ---------------------------------------------------------------------------

test("a Web Worker is given the vendored asset paths, not tesseract's CDN", () => {
  const assets = ocrAssetsFor(workerScope);

  // The regression in one line: an empty object here means tesseract.js keeps
  // its own defaults, and its own defaults are cdn.jsdelivr.net.
  assert.notDeepEqual(assets, {});

  assert.equal(
    assets.workerPath,
    "https://tv-helper.example/tesseract/worker.min.js",
  );
  assert.equal(assets.corePath, "https://tv-helper.example/tesseract/");
  assert.equal(assets.langPath, "https://tv-helper.example/tesseract/");

  for (const value of Object.values(assets)) {
    assert.doesNotMatch(
      String(value),
      /cdn|jsdelivr|unpkg/i,
      "OCR assets must be served by this app and nothing else",
    );
  }
});

test("the worker's asset paths are absolute, because a blob: URL cannot resolve a relative one", () => {
  const assets = ocrAssetsFor(workerScope);

  // tesseract.js spawns its worker from a Blob URL whose whole body is
  // `importScripts("<workerPath>")`, and it skips its own path resolution
  // inside a worker. This is what a root-relative path would be asked to do
  // there, and it throws:
  assert.throws(
    () => new URL("/tesseract/worker.min.js", "blob:https://tv-helper.example/abc"),
    /Invalid URL/,
  );

  // An absolute one needs no base at all.
  assert.equal(
    new URL(assets.workerPath!).href,
    "https://tv-helper.example/tesseract/worker.min.js",
  );
});

test("Node gets no asset paths, so its callers' local paths still win", () => {
  assert.deepEqual(ocrAssetsFor(realNodeScope), {});
});

test("an opaque origin falls back to a relative path rather than 'null/...'", () => {
  // A sandboxed context serialises its origin as the literal string "null".
  const assets = ocrAssetsFor({ importScripts: () => {}, location: { origin: "null" } });
  assert.equal(assets.workerPath, "/tesseract/worker.min.js");
  assert.equal(assets.langPath, "/tesseract/");
});

// ---------------------------------------------------------------------------
// 3a. CanvasFactory accepts an OffscreenCanvas context
// ---------------------------------------------------------------------------

test("CanvasFactory accepts every 2D context this project actually renders on", () => {
  // `npx tsc --noEmit` is the real assertion here; the runtime checks below
  // only keep node --test aware that it ran.
  //
  // When `CanvasFactory` said `CanvasRenderingContext2D`, neither of these
  // compiled. An OffscreenCanvasRenderingContext2D -- the browser's only
  // option inside a Web Worker -- is missing `getContextAttributes` and
  // `drawFocusIfNeeded`; @napi-rs/canvas's SKRSContext2D, which every Node
  // caller passes, is missing `drawFocusIfNeeded` and returns its own
  // ImageData. The Node half went unnoticed for as long as it did because
  // `scripts/*.mjs` are JavaScript and `checkJs` is off, so no call site was
  // ever checked against the declared type.
  const offscreen: CanvasFactory = () =>
    undefined as unknown as OffscreenCanvasRenderingContext2D;
  const dom: CanvasFactory = () =>
    undefined as unknown as CanvasRenderingContext2D;
  const node: CanvasFactory = nodeContext;

  assert.equal(typeof offscreen, "function");
  assert.equal(typeof dom, "function");
  assert.equal(typeof node, "function");
});

// ---------------------------------------------------------------------------
// 3b. The ingest loop
// ---------------------------------------------------------------------------

/**
 * A stand-in for pdf.js.
 *
 * Faked rather than driven through a real multi-page PDF because what is
 * under test is this loop's own bookkeeping -- page order, numbering,
 * progress, and the promise that nothing accumulates -- and a fake is the
 * only way to observe `cleanup()` and `destroy()` at all. Real pdf.js
 * rendering, including the `/Rotate 270` these scans carry, is covered by
 * `scripts/test-pipeline.mjs`.
 */
function fakeDocument(sizes: { w: number; h: number }[]) {
  const events: string[] = [];

  const document: PdfDocumentLike = {
    numPages: sizes.length,
    async getPage(pageNumber) {
      events.push(`getPage:${pageNumber}`);
      const { w, h } = sizes[pageNumber - 1];
      return {
        getViewport: ({ scale }: { scale: number }) => ({
          width: w * scale,
          height: h * scale,
        }),
        render: () => {
          events.push(`render:${pageNumber}`);
          return { promise: Promise.resolve() };
        },
        cleanup: () => {
          events.push(`cleanup:${pageNumber}`);
          return true;
        },
      } as unknown as PDFPageProxy;
    },
    async destroy() {
      events.push("destroy");
    },
  };

  return { document, events };
}

test("ingestPdf walks every page in order and reports progress per page", async () => {
  const { document, events } = fakeDocument([
    { w: 200, h: 100 },
    { w: 200, h: 100 },
    { w: 100, h: 200 },
  ]);

  const seen: { page: IngestedPage; done: number; total: number }[] = [];

  const pageCount = await ingestPdf(
    {
      loadDocument: async () => document,
      makeContext: nodeContext,
      dpi: 72,
      // At 1 the pool degenerates to the loop this used to be, and the exact
      // event sequence below is the assertion that it degenerates EXACTLY:
      // one page rendered, OCR'd, released and freed before the next is even
      // fetched. The default is 4; the ordering test after this one is what
      // covers that.
      concurrency: 1,
      ocr: async (rendered) => {
        events.push(`ocr:${rendered.width}x${rendered.height}`);
        return [
          {
            i: 0,
            text: "line",
            box: { x: 0, y: 0, w: 10, h: 10 },
            words: [{ text: "line", box: { x: 0, y: 0, w: 10, h: 10 } }],
          },
        ];
      },
    },
    (page, done, total) => {
      events.push(`onPage:${page.index}`);
      seen.push({ page, done, total });
    },
  );

  assert.equal(pageCount, 3);

  // 0-based within the document, in document order.
  assert.deepEqual(
    seen.map((s) => s.page.index),
    [0, 1, 2],
  );
  // Progress counts pages, 1-based, against a total known from the start --
  // so a UI can show "3 of 29" on the very first page rather than after it.
  assert.deepEqual(
    seen.map((s) => [s.done, s.total]),
    [
      [1, 3],
      [2, 3],
      [3, 3],
    ],
  );

  // The rendered size reaches the result, at the requested DPI.
  assert.deepEqual(
    seen.map((s) => [s.page.widthPx, s.page.heightPx]),
    [
      [200, 100],
      [200, 100],
      [100, 200],
    ],
  );

  // Strictly one page at a time, and every page released. Holding pages would
  // cost a gigabyte on a real 29-page bundle: 2480x3507 RGBA is about 33MB.
  //
  // `cleanup` now comes BEFORE `onPage` rather than after it. The page proxy
  // is dropped the moment its lines are back, because the release step is
  // outside the page's lifetime entirely -- it has to be, since under
  // concurrency the page being released is usually not the page that just
  // finished. Nothing downstream reads the proxy after OCR, and holding it
  // across a persist that can take as long as it likes is the one thing worth
  // not doing.
  assert.deepEqual(events, [
    "getPage:1",
    "render:1",
    "ocr:200x100",
    "cleanup:1",
    "onPage:0",
    "getPage:2",
    "render:2",
    "ocr:200x100",
    "cleanup:2",
    "onPage:1",
    "getPage:3",
    "render:3",
    "ocr:100x200",
    "cleanup:3",
    "onPage:2",
    "destroy",
  ]);
});

test("ingestPdf releases pages in ascending index even when OCR finishes backwards", async () => {
  // THE WRONG-PAGE TEST, and the reason it is stated in this shape.
  //
  // This used to assert `inFlight === 1` around a strictly serial loop, which
  // a concurrent pool could be made to pass by simply never overlapping the
  // work. That would test nothing: the hazard is not overlapping callbacks,
  // it is ARRIVAL ORDER. The caller persists inside onPage, `runtime.ts`
  // appends each page to the end of `run.pages` in arrival order, and
  // `Zone.pageIndex` is a position in that array -- so one page released out
  // of turn repoints every zone in the run at a different scan and ships a
  // docx that opens fine with a crop of the wrong page in it.
  //
  // So the fake OCR finishes the pages BACKWARDS -- the last page first, page
  // 0 dead last -- which is the arrival order that would break everything,
  // and the assertions are that onPage still sees 0..5 in order, that two
  // calls never overlap, and that the pool really did run pages in parallel.
  // Without that last check a serial implementation would pass silently.
  const pageCount = 6;
  const concurrency = 3;
  const { document } = fakeDocument(
    Array.from({ length: pageCount }, () => ({ w: 10, h: 10 })),
  );

  let started = 0;
  let ocrInFlight = 0;
  let maxOcrInFlight = 0;
  let onPageInFlight = 0;
  const released: { index: number; done: number; total: number }[] = [];

  await ingestPdf(
    {
      loadDocument: async () => document,
      makeContext: nodeContext,
      dpi: 72,
      concurrency,
      ocr: async () => {
        // The later the page, the sooner its OCR answers. Timers rather than
        // resolved promises because a microtask-only fake would drain in
        // start order and never exercise the buffer at all.
        const pageNumber = started++;
        ocrInFlight += 1;
        maxOcrInFlight = Math.max(maxOcrInFlight, ocrInFlight);
        await new Promise((resolve) =>
          setTimeout(resolve, (pageCount - pageNumber) * 10),
        );
        ocrInFlight -= 1;
        return [];
      },
    },
    async (page, done, total) => {
      onPageInFlight += 1;
      assert.equal(onPageInFlight, 1, "two onPage callbacks overlapped");
      // A real caller writes to IndexedDB here, which takes as long as it
      // takes; releasing the next page underneath that write is the failure
      // this await stands in for.
      await new Promise((resolve) => setTimeout(resolve, 5));
      released.push({ index: page.index, done, total });
      onPageInFlight -= 1;
    },
  );

  assert.deepEqual(
    released.map((r) => r.index),
    [0, 1, 2, 3, 4, 5],
    "pages must be released in ascending index, whatever order OCR answers in",
  );

  // Progress counts released pages, so it stays 1:1 with what the caller has
  // actually been handed rather than with how much work has finished.
  assert.deepEqual(
    released.map((r) => [r.done, r.total]),
    [
      [1, 6],
      [2, 6],
      [3, 6],
      [4, 6],
      [5, 6],
      [6, 6],
    ],
  );

  assert.equal(
    maxOcrInFlight,
    concurrency,
    "the pool must actually run pages in parallel, or this test proves nothing",
  );
});

test("a page that fails takes the ingest with it and releases no page past the gap", async () => {
  // Page 1 fails while 2 and 3 succeed. They must NOT be released: releasing
  // them would leave `run.pages` holding page 0, page 2 and page 3 at
  // positions 0, 1 and 2, which is the silent repointing in its purest form.
  const { document, events } = fakeDocument(
    Array.from({ length: 4 }, () => ({ w: 10, h: 10 })),
  );

  let started = 0;
  const released: number[] = [];

  await assert.rejects(
    ingestPdf(
      {
        loadDocument: async () => document,
        makeContext: nodeContext,
        dpi: 72,
        concurrency: 4,
        ocr: async () => {
          const pageNumber = started++;
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (pageNumber === 1) throw new Error("OCR blew up on page 1");
          return [];
        },
      },
      (page) => {
        released.push(page.index);
      },
    ),
    /OCR blew up on page 1/,
  );

  assert.ok(
    released.every((index, position) => index === position),
    `released pages must stay a prefix of the document, got ${released.join(",")}`,
  );
  assert.ok(!released.includes(2), "a page after the gap must not be released");

  // Every page that was opened is still released, and so is the document:
  // an in-flight render must not be torn down under a failure elsewhere.
  for (let pageNumber = 1; pageNumber <= started; pageNumber++) {
    assert.ok(
      events.includes(`cleanup:${pageNumber}`),
      `page ${pageNumber} was never cleaned up`,
    );
  }
  assert.ok(events.includes("destroy"));
});

test("ingestPdf releases the document even when a page fails", async () => {
  const { document, events } = fakeDocument([{ w: 10, h: 10 }]);

  await assert.rejects(
    ingestPdf(
      {
        loadDocument: async () => document,
        makeContext: nodeContext,
        dpi: 72,
        ocr: async () => {
          throw new Error("OCR blew up");
        },
      },
      () => {},
    ),
    /OCR blew up/,
  );

  assert.ok(events.includes("cleanup:1"), "the page must still be released");
  assert.ok(events.includes("destroy"), "the document must still be released");
});

// ---------------------------------------------------------------------------
// 3c. Slots
// ---------------------------------------------------------------------------

test("seedSlots covers every fillable slot and no unfillable one", () => {
  const slots = seedSlots();
  const keys = new Set(slots.map((s) => slotKeyOf(s.key)));

  for (const section of AO_TEMPLATE.sections) {
    for (const slot of section.slots) {
      assert.equal(
        keys.has(slot.key),
        slot.fillable,
        `${slot.key} should ${slot.fillable ? "" : "not "}be seeded`,
      );
    }
  }

  assert.ok(slots.every((s) => s.status === "pending"));
  assert.ok(slots.every((s) => s.zone === undefined));
});

test("a slot that holds two captures is seeded twice, under distinct keys", () => {
  // The sample's `KB (lanjutan)` ToP row stacks two pictures cut from two
  // different pages. `SlotState.zone` holds one zone, so one state per slot
  // would ship a document that looks complete and is missing a capture.
  const multi = AO_TEMPLATE.sections
    .flatMap((section) => section.slots)
    .filter((slot) => slot.fillable && (slot.crops ?? 1) > 1);

  assert.ok(multi.length > 0, "the fixture assumes a multi-capture slot exists");

  const slots = seedSlots();
  for (const slot of multi) {
    const states = slots.filter((s) => slotKeyOf(s.key) === slot.key);
    assert.equal(states.length, slot.crops);
    assert.equal(new Set(states.map((s) => s.key)).size, states.length);
    // The label carries the ordinal, so an operator sees which capture it is.
    assert.deepEqual(
      states.map((s) => s.label),
      Array.from({ length: slot.crops! }, (_, n) => `${slot.label} (${n + 1})`),
    );
  }
});

test("slotKeyOf leaves an ordinary key alone", () => {
  assert.equal(slotKeyOf("kb.nomor"), "kb.nomor");
  assert.equal(slotKeyOf("kbLanjutan.top#2"), "kbLanjutan.top");
});

test("outstandingSlots reports only what was searched and not found", () => {
  const state = (key: string, status: SlotState["status"]): SlotState => ({
    key,
    label: key,
    status,
  });

  const run = {
    slots: [
      state("a", "pending"),
      state("b", "outstanding"),
      state("c", "confirmed"),
      state("d", "proposed"),
      state("e", "unfilled"),
      state("f", "outstanding"),
    ],
  } as BrowserRun;

  // "pending" is excluded deliberately: a slot nobody has looked for yet is
  // not missing evidence, and asking the operator for a dokumen tambahan to
  // cover it would be asking about work that has not been done.
  assert.deepEqual(
    outstandingSlots(run).map((s) => s.key),
    ["b", "f"],
  );
});

// ---------------------------------------------------------------------------
// 3d. The additive append
// ---------------------------------------------------------------------------

const page = (id: string, sourceId: string, index: number): StoredPage => ({
  id,
  sourceId,
  index,
  widthPx: 2480,
  heightPx: 3507,
  lines: [],
});

test("appending a dokumen tambahan's page keeps every earlier page and zone", () => {
  const confirmed: SlotState = {
    key: "kb.nomor",
    label: "Nomor",
    status: "confirmed",
    origin: "human",
    zone: {
      pageIndex: 1,
      box: { x: 10, y: 20, w: 100, h: 40 },
      lineRange: [7, 8],
    },
  };

  const before: BrowserRun = {
    id: "run-1",
    createdAt: 1,
    sources: [
      { id: "src-a", name: "bundle.pdf", pageCount: 2 },
      { id: "src-b", name: "tambahan.pdf", pageCount: 0 },
    ],
    pages: [page("p0", "src-a", 0), page("p1", "src-a", 1)],
    slots: [confirmed, { key: "kb.tanggal", label: "Tanggal", status: "outstanding" }],
  };

  const after = withAppendedPage(before, page("p2", "src-b", 0), 3);

  // Appended at the end. The confirmed zone's pageIndex of 1 still names the
  // same page it named before -- this is the whole reason the array is
  // append-only.
  assert.deepEqual(
    after.pages.map((p) => p.id),
    ["p0", "p1", "p2"],
  );
  assert.deepEqual(after.pages[1], before.pages[1]);

  // Slots are untouched: a later document can never cost the operator a zone
  // they already accepted.
  assert.deepEqual(after.slots, before.slots);
  assert.equal(after.slots[0].zone!.pageIndex, 1);

  // Only the new document's page count moves, and it records the document's
  // own length rather than how far the ingest has got, so an interrupted run
  // still says how long the file is.
  assert.deepEqual(after.sources, [
    { id: "src-a", name: "bundle.pdf", pageCount: 2 },
    { id: "src-b", name: "tambahan.pdf", pageCount: 3 },
  ]);

  // And the input is not mutated: the caller keeps a usable snapshot to
  // persist, which is what makes per-page writes safe.
  assert.equal(before.pages.length, 2);
  assert.equal(before.sources[1].pageCount, 0);
});

test("appending never renumbers the pages a zone already points at", () => {
  let run: BrowserRun = {
    id: "run-2",
    createdAt: 1,
    sources: [{ id: "src-a", name: "a.pdf", pageCount: 2 }],
    pages: [page("p0", "src-a", 0), page("p1", "src-a", 1)],
    slots: [],
  };

  const positionOfP1 = run.pages.findIndex((p) => p.id === "p1");

  run = { ...run, sources: [...run.sources, { id: "src-b", name: "b.pdf", pageCount: 0 }] };
  run = withAppendedPage(run, page("p2", "src-b", 0), 2);
  run = withAppendedPage(run, page("p3", "src-b", 1), 2);

  assert.equal(run.pages.findIndex((p) => p.id === "p1"), positionOfP1);
  // A second document's pages carry their own within-document numbering; the
  // run-global number is the array position. Confusing the two sends a
  // reviewer to the wrong document.
  assert.deepEqual(
    run.pages.map((p) => [p.sourceId, p.index]),
    [
      ["src-a", 0],
      ["src-a", 1],
      ["src-b", 0],
      ["src-b", 1],
    ],
  );
});
