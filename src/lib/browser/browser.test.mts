/**
 * Tests for the browser runtime: the parts of it that can be reached without
 * a browser.
 *
 * Two groups, and the first exists because of a specific recorded bug.
 *
 * 1. RUNTIME DETECTION. `detectRuntime` used to read
 *    `typeof window === "undefined"` as "I am in Node". A browser Web Worker
 *    has no `window` either, and a Web Worker is exactly where this project
 *    does its page work, so the Node-only branches it guarded reached for a
 *    BARE `process` -- which a worker need not define, and an undefined
 *    identifier throws rather than evaluating to undefined.
 *
 *    Measured against the built worker chunk, Turbopack folds that check for a
 *    browser target and the wrong branch never survives to run, so the old code
 *    was correct by bundler constant-folding rather than by construction. These
 *    tests pin the construction. `node --test` cannot conjure a real Web
 *    Worker, which is why `detectRuntime` takes the global scope as an argument
 *    at all: the decision is checkable against a synthetic one instead of going
 *    unchecked.
 *
 *    THIS GROUP USED TO HAVE A SECOND HALF, about vendored tesseract asset
 *    paths having to be absolute because a blob: URL cannot resolve a
 *    root-relative specifier. Those tests are gone with the engine: scans are
 *    read by Cloud Vision on the server now, nothing is vendored into
 *    `public/`, and the browser fetches no OCR assets at all. `detectRuntime`
 *    itself survives in `src/lib/pipeline/runtime.ts` because `gemini-ocr.ts`
 *    still needs to know which runtime is encoding a PNG.
 *
 * 2. THE RUN MODEL. Ingest order, per-page progress, and the additive append
 *    that the dokumen tambahan loop stands on. IndexedDB and the Web Worker
 *    are absent here, so what is under test is the logic those two carry
 *    rather than the wiring; that split is why `ingest.ts` takes pdf.js and
 *    the canvas as arguments and why the append is its own function.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import type { PDFPageProxy } from "pdfjs-dist";

import { detectRuntime, type RuntimeScope } from "../pipeline/runtime.ts";
import type { CanvasFactory } from "../pipeline/render.ts";
import { ingestPdf, type IngestedPage, type PdfDocumentLike } from "./ingest.ts";
import {
  captureOrdinalOf,
  nextCaptureOrdinal,
  outstandingSlots,
  seedSlots,
  slotKeyOf,
  withAppendedPage,
  withDiscoveredCaptures,
  withoutCapture,
  withoutCapturesAfter,
  type BrowserRun,
  type SlotState,
  type StoredPage,
} from "./runtime.ts";
import { AO_TEMPLATE } from "../forms/template.ts";
import { continuationChecked, zoneFingerprint } from "./captures.ts";

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

test("seedSlots seeds ONE capture per bagian, and nothing declares a second", () => {
  // THE OPERATOR REPORT THIS FEATURE COMES FROM. `SlotDef.crops` used to say
  // the `KB (lanjutan)` ToP row holds two pictures, so this function made two
  // states up front and the sheet showed "ToP 1" and "ToP 2" with the second
  // permanently missing -- on a contract holding ONE ToP. The sample's two
  // pictures are one payment clause split by a page break, which is a fact
  // about that contract's page breaks and not about the form.
  const slots = seedSlots();
  const keys = slots.map((s) => s.key);

  assert.equal(new Set(keys).size, keys.length, "keys must be unique");
  // Every key is a template key VERBATIM. A `#n` here would mean something
  // seeded a capture nobody has looked for.
  for (const key of keys) {
    assert.equal(slotKeyOf(key), key, `${key} carries a capture ordinal`);
    assert.equal(captureOrdinalOf(key), 1);
  }

  const fillable = AO_TEMPLATE.sections
    .flatMap((section) => section.slots)
    .filter((slot) => slot.fillable);
  assert.equal(slots.length, fillable.length);
  assert.deepEqual(
    slots.map((s) => s.label),
    fillable.map((slot) => slot.label),
    "the label is the template's own, undecorated: captureLabel adds " +
      "(lanjutan) from the ordinal at render time",
  );
});

test("a discovered lanjutan is APPENDED, proposed, under a fresh ordinal", () => {
  const zone = {
    pageIndex: 3,
    box: { x: 0, y: 0, w: 10, h: 10 },
    lineRange: [0, 4] as [number, number],
  };
  const base: BrowserRun = {
    id: "run",
    createdAt: 0,
    sources: [],
    pages: [],
    slots: [
      { key: "kb.top", label: "ToP", status: "confirmed", zone },
      { key: "kb.nomor", label: "Nomor", status: "confirmed", zone },
    ],
  };

  const next = withDiscoveredCaptures(
    base,
    [{ after: "kb.top", zone: { ...zone, pageIndex: 4 }, text: "sambungan" }],
    ["kb.nomor"],
  );

  assert.equal(next.slots.length, 3);
  const added = next.slots[2];
  assert.equal(added.key, "kb.top#2");
  // Proposed, never confirmed. The confirming call was measured right three
  // times of four on bundle one, and the wrong one is a legible crop of the
  // NEXT clause under this bagian's label.
  assert.equal(added.status, "proposed");
  assert.equal(added.origin, "llm");
  // The template's own label, undecorated.
  assert.equal(added.label, "ToP");
  // The capture that was walked and found to end where it ends is stamped, so
  // the sheet can tell it from one nothing has looked past.
  assert.equal(continuationChecked(next.slots[1]), true);
  assert.equal(continuationChecked(next.slots[0]), false);
});

test("an answer whose parent lost its zone while the search ran is dropped", () => {
  // A pass is minutes of model calls. If the operator rejected the capture the
  // walk started from, its lanjutan is the continuation of nothing.
  const base: BrowserRun = {
    id: "run",
    createdAt: 0,
    sources: [],
    pages: [],
    slots: [{ key: "kb.top", label: "ToP", status: "outstanding" }],
  };
  const next = withDiscoveredCaptures(base, [
    {
      after: "kb.top",
      zone: { pageIndex: 4, box: { x: 0, y: 0, w: 1, h: 1 }, lineRange: [0, 1] },
      text: "sambungan",
    },
  ]);
  assert.equal(next.slots.length, 1);
});

test("an ordinal is never re-used after a lanjutan is removed", () => {
  // THE LABEL AND THE EXPORT'S PICTURE ORDER BOTH READ THE ORDINAL. Allocating
  // from the array length instead of from the high-water mark would hand a new
  // discovery an ordinal that is already spoken for, and rename a picture the
  // operator has already accepted.
  const keys = ["kb.top", "kb.top#2", "kb.top#3"];
  assert.equal(nextCaptureOrdinal(keys, "kb.top"), 4);
  assert.equal(nextCaptureOrdinal(["kb.top", "kb.top#3"], "kb.top"), 4);
  // A bagian with nothing at all still starts at 2: capture 1 is what
  // seedSlots makes, and a DISCOVERED capture is a continuation of one.
  assert.equal(nextCaptureOrdinal([], "kb.top"), 2);
});

test("rejecting a lanjutan removes it AND the tail found by walking past it", () => {
  // `#3` was discovered by asking what follows `#2`. If `#2` is not a lanjutan
  // of this bagian, `#3` is the continuation of something that was never here.
  const zone = {
    pageIndex: 1,
    box: { x: 0, y: 0, w: 1, h: 1 },
    lineRange: [0, 1] as [number, number],
  };
  const run: BrowserRun = {
    id: "run",
    createdAt: 0,
    sources: [],
    pages: [],
    slots: [
      { key: "kb.top", label: "ToP", status: "confirmed", zone },
      { key: "kb.top#2", label: "ToP", status: "proposed", zone },
      { key: "kb.top#3", label: "ToP", status: "proposed", zone },
      { key: "kb.nomor", label: "Nomor", status: "confirmed", zone },
    ],
  };

  const { run: next, removed } = withoutCapture(run, 1);
  assert.deepEqual(
    next.slots.map((s) => s.key),
    ["kb.top", "kb.nomor"],
  );
  // Handed back so `saveRun` can name them: a write that drops a zone-carrying
  // capture without saying so is refused.
  assert.deepEqual(removed.sort(), ["kb.top#2", "kb.top#3"]);

  // Capture 1 is never removed -- the template still asks for the bagian --
  // but its whole chain goes with it.
  const { run: cleared, removed: alsoRemoved } = withoutCapture(run, 0);
  assert.deepEqual(
    cleared.slots.map((s) => s.key),
    ["kb.top", "kb.nomor"],
  );
  assert.deepEqual(alsoRemoved.sort(), ["kb.top#2", "kb.top#3"]);
});

test("the same block is never appended twice, whatever asks for it", () => {
  // Every append takes a FRESH ordinal, so a repeated answer becomes a second
  // row holding the same picture: "(lanjutan 2)" beside an identical
  // "(lanjutan)", arriving `proposed` so it re-opens a bagian the operator had
  // settled, and stacked twice in one docx cell if accepted. Nothing else in
  // the tree dedupes, so the guard is here and it is on the ZONE.
  const zone = {
    pageIndex: 3,
    box: { x: 0, y: 0, w: 10, h: 10 },
    lineRange: [0, 4] as [number, number],
  };
  const next = { ...zone, pageIndex: 4 };
  const base: BrowserRun = {
    id: "run",
    createdAt: 0,
    sources: [],
    pages: [],
    slots: [{ key: "kb.top", label: "ToP", status: "confirmed", zone }],
  };

  const once = withDiscoveredCaptures(base, [
    { after: "kb.top", zone: next, text: "sambungan" },
  ]);
  assert.equal(once.slots.length, 2);

  // The same answer again -- a re-walk of a chain whose links were not all
  // stamped, or a run restored from an older store.
  const twice = withDiscoveredCaptures(once, [
    { after: "kb.top", zone: { ...next, box: { x: 1, y: 1, w: 9, h: 9 } }, text: "sambungan" },
  ]);
  assert.deepEqual(
    twice.slots.map((s) => s.key),
    ["kb.top", "kb.top#2"],
    "the box is re-derived from the lines, so page and lineRange decide",
  );

  // A DIFFERENT block still lands: this is a dedupe, not a cap.
  const third = withDiscoveredCaptures(twice, [
    { after: "kb.top", zone: { ...next, pageIndex: 5 }, text: "lanjutan lagi" },
  ]);
  assert.deepEqual(
    third.slots.map((s) => s.key),
    ["kb.top", "kb.top#2", "kb.top#3"],
  );
});

test("a lanjutan the walk already looked past arrives stamped", () => {
  // Link n's own continuation is link n+1, appended in the same call, so it
  // has been looked past. Leaving the middle of a chain unstamped is what made
  // the next Proses re-walk it and append the same evidence again.
  const zone = {
    pageIndex: 1,
    box: { x: 0, y: 0, w: 10, h: 10 },
    lineRange: [0, 4] as [number, number],
  };
  const base: BrowserRun = {
    id: "run",
    createdAt: 0,
    sources: [],
    pages: [],
    slots: [{ key: "kb.top", label: "ToP", status: "confirmed", zone }],
  };

  const grown = withDiscoveredCaptures(base, [
    {
      after: "kb.top",
      zone: { ...zone, pageIndex: 2 },
      text: "tengah",
      continuationChecked: true,
    },
    { after: "kb.top", zone: { ...zone, pageIndex: 3 }, text: "ujung" },
  ]);

  assert.deepEqual(
    grown.slots.map((s) => [s.key, continuationChecked(s)]),
    // `continuationChecked` is a predicate now, so an unstamped capture reads
    // false rather than undefined -- the point being that it answers the
    // question ("has anything looked past THIS rectangle") rather than
    // reporting whether a field happens to be set.
    [
      ["kb.top", false],
      ["kb.top#2", true],
      ["kb.top#3", false],
    ],
  );
});

test("a capture reopened while the search ran is not stamped as checked", () => {
  // The flag is a fact about ONE rectangle. A run re-read from storage may
  // have had that capture rejected or redrawn while the round was in flight,
  // and stamping it then records "we looked past this" about whatever fills it
  // next -- which no future Proses would ever look at, because the flag is
  // what `capturesToWalk` filters on.
  const base: BrowserRun = {
    id: "run",
    createdAt: 0,
    sources: [],
    pages: [],
    slots: [{ key: "kb.top", label: "ToP", status: "outstanding" }],
  };
  const next = withDiscoveredCaptures(base, [], ["kb.top"]);
  assert.equal(continuationChecked(next.slots[0]), false);
});

test("an answer does not re-open a bagian the operator emptied while it ran", () => {
  // `unfilled` is a decision made ON THE RECORD, and it keeps its zone, so the
  // parent-lost-its-zone check above does not see it. An appended `proposed`
  // lanjutan would drop the slot out of `decided` and block the export on a
  // question that was settled. `applyProposals` is documented and tested
  // against exactly this race on the other half of the answer.
  const zone = {
    pageIndex: 1,
    box: { x: 0, y: 0, w: 10, h: 10 },
    lineRange: [0, 4] as [number, number],
  };
  const base: BrowserRun = {
    id: "run",
    createdAt: 0,
    sources: [],
    pages: [],
    slots: [{ key: "kb.top", label: "ToP", status: "unfilled", zone }],
  };
  const next = withDiscoveredCaptures(base, [
    { after: "kb.top", zone: { ...zone, pageIndex: 2 }, text: "sambungan" },
  ]);
  assert.equal(next.slots.length, 1);
});

test("redrawing a lanjutan takes its tail but keeps the capture itself", () => {
  // "Gambar ulang" on `#2`: the operator says the lanjutan is here but not
  // shaped like that. `#3` was found by walking forward from the OLD `#2`, so
  // it is the continuation of a rectangle that no longer exists -- but `#2`
  // itself is evidence a human has just drawn, and rejecting it is a different
  // decision with a different button.
  const zone = {
    pageIndex: 1,
    box: { x: 0, y: 0, w: 1, h: 1 },
    lineRange: [0, 1] as [number, number],
  };
  const run: BrowserRun = {
    id: "run",
    createdAt: 0,
    sources: [],
    pages: [],
    slots: [
      { key: "kb.top", label: "ToP", status: "confirmed", zone },
      { key: "kb.top#2", label: "ToP", status: "confirmed", zone },
      { key: "kb.top#3", label: "ToP", status: "proposed", zone },
    ],
  };

  const { run: next, removed } = withoutCapturesAfter(run, 1);
  assert.deepEqual(
    next.slots.map((s) => s.key),
    ["kb.top", "kb.top#2"],
  );
  assert.deepEqual(removed, ["kb.top#3"]);

  // From capture 1 it means the whole chain, which is why `saveZone` calls it
  // ONLY for a redrawn lanjutan: redrawing the head is an extent correction,
  // not a reason to delete crops the operator has already accepted, and the
  // cleared `continuationChecked` sends the next Proses over it again anyway.
  const { removed: wholeChain } = withoutCapturesAfter(run, 0);
  assert.deepEqual(wholeChain.sort(), ["kb.top#2", "kb.top#3"]);
});

test("slotKeyOf leaves an ordinary key alone", () => {
  assert.equal(slotKeyOf("kb.nomor"), "kb.nomor");
  assert.equal(slotKeyOf("kbLanjutan.top#2"), "kbLanjutan.top");
});

test("captureOrdinalOf reads a bare key as capture 1", () => {
  assert.equal(captureOrdinalOf("kb.nomor"), 1);
  assert.equal(captureOrdinalOf("kbLanjutan.top#2"), 2);
  assert.equal(captureOrdinalOf("kbLanjutan.top#10"), 10);
  // A run stored under the old declared-count design keys its first capture
  // `#1`, which must still read as capture 1 rather than as a lanjutan.
  assert.equal(captureOrdinalOf("kbLanjutan.top#1"), 1);
  // A suffix that is not a number is not an ordinal.
  assert.equal(captureOrdinalOf("weird#key"), 1);
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

test("replacing a zone drops the continuation verdict, whoever writes it", () => {
  // THE INVARIANT THAT USED TO NEED REMEMBERING. Three places replace a
  // capture's zone -- a hand redraw, "Bukan ini", and a fresh proposal landing
  // through the ordinary tambahan loop -- and all three were found carrying a
  // verdict about a rectangle that no longer existed. The third needs no
  // unusual operator action at all, which is what made it the dangerous one.
  //
  // The fix is not three patches. The verdict NAMES the zone it was made
  // about, so a slot holding a different zone reads as unchecked without the
  // writer doing anything, and a fourth writer inherits the property for free.
  // This test is that fourth writer: a bare spread, no clearing, no knowledge
  // of the rule.
  const walked = { pageIndex: 1, box: { x: 0, y: 0, w: 9, h: 9 }, lineRange: [0, 4] as [number, number] };
  const checked = {
    key: "kb.top",
    label: "ToP",
    status: "confirmed" as const,
    zone: walked,
    continuationCheckedFor: zoneFingerprint(walked),
  };
  assert.equal(continuationChecked(checked), true);

  // A DIFFERENT RECTANGLE ON THE SAME PAGE. Written the naive way, which is
  // exactly how all three real writers do it.
  const redrawn = {
    ...checked,
    zone: { ...walked, lineRange: [0, 9] as [number, number] },
  };
  assert.equal(
    continuationChecked(redrawn),
    false,
    "a zone enlarged to the page bottom must not inherit `already looked past`",
  );

  // A different PAGE, which is what applyProposals can deliver on a later round.
  assert.equal(
    continuationChecked({ ...checked, zone: { ...walked, pageIndex: 7 } }),
    false,
  );

  // The zone cleared entirely, which is what "Bukan ini" does. There is no
  // rectangle left for a verdict to be about.
  assert.equal(continuationChecked({ ...checked, zone: undefined }), false);

  // And the identical rectangle still counts, or every re-render would re-walk
  // the whole run.
  assert.equal(continuationChecked({ ...checked, zone: { ...walked } }), true);
});
