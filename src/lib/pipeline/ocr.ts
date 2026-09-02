import { createWorker } from "tesseract.js";
import type { RenderedPage } from "./render.ts";
import { groupWordsIntoLines, type Line, type Word } from "./geometry.ts";
import { encodePng } from "../export/png.ts";

/** tesseract.js's own `Partial<WorkerOptions>`, taken off `createWorker`'s
 * signature rather than imported: the interface lives inside a `declare
 * namespace Tesseract` block that the package does not re-export by name. */
type TesseractWorkerOptions = NonNullable<Parameters<typeof createWorker>[2]>;

/**
 * Everything `ocrToWords` hands to `createWorker`, plus this module's own
 * `initTimeoutMs`.
 *
 * Paths are the reason this type exists: tesseract.js defaults to a CDN for
 * its wasm core and language data, which would put an unapproved third party
 * in the browser's request path -- the same reason pdf.js keeps its bundled
 * worker. `scripts/vendor-ocr.mjs` copies those assets into public/tesseract
 * at prebuild, and `langPath`/`corePath`/`workerPath` point at them.
 *
 * But paths were never all this accepted. `ocrToWords` spreads the whole
 * object into the worker options, so `gzip`, `cacheMethod` and the rest have
 * always been forwarded -- every .mjs caller in scripts/ passes
 * `gzip: true, cacheMethod: "none"` and always has. Declaring only the three
 * paths made this type a lie that only a *typed* caller could trip over,
 * which is the worst way round: the untyped callers worked and a TypeScript
 * one would have been told, wrongly, that the option does not exist.
 *
 * `errorHandler` is the one option deliberately withheld. ocr.ts installs its
 * own (see the call site) because tesseract.js otherwise rethrows a
 * recognition failure on a MessagePort tick with no handler and takes the
 * whole process down; the caller's value would win the spread and silently
 * re-arm that. Nothing in this repo passes one, so nothing loses a capability
 * it was using.
 */
export type OcrAssets = Omit<TesseractWorkerOptions, "errorHandler"> & {
  /**
   * Milliseconds to wait for worker initialisation (spawn, wasm core load,
   * language load, init) before giving up. See createWorkerWithTimeout for
   * why this exists: tesseract.js's own init chain can hang here forever
   * instead of rejecting. Defaults to DEFAULT_INIT_TIMEOUT_MS.
   */
  initTimeoutMs?: number;
};

/**
 * The globals this module inspects to decide which runtime it is in.
 *
 * Taken as an argument rather than read straight off `globalThis` so the
 * decision is a pure function a test can pin against a SYNTHETIC Web Worker
 * scope. `node --test` cannot conjure a real one, and the distinction below
 * is precisely the one this file used to get wrong, so "it is only checkable
 * in a browser" would have meant "it is not checked".
 */
export type RuntimeScope = {
  process?: { versions?: { node?: string } };
  document?: unknown;
  window?: unknown;
  importScripts?: unknown;
  WorkerGlobalScope?: unknown;
  location?: { origin?: string };
};

/**
 * NEVER INFER THE RUNTIME FROM `window`.
 *
 * `typeof window === "undefined"` used to stand in for "I am in Node" here.
 * It is false inside a browser Web Worker, where `window` is also undefined,
 * and a Web Worker is exactly where this project runs OCR in the browser
 * (`src/lib/browser/pipeline.worker.ts`). What it put at risk:
 *
 *   a. the Node-only leak guard below reached for a BARE `process`, which a
 *      worker need not define at all -- and a bare undefined identifier
 *      throws a ReferenceError rather than evaluating to undefined. It now
 *      goes through `globalThis` and demands a real `versions.node`.
 *   b. the vendored asset paths were meant to be skipped under Node and
 *      applied in a browser. Skipping them leaves tesseract.js on its OWN
 *      defaults, which are `https://cdn.jsdelivr.net/...` for the worker
 *      script, the wasm core AND the language data -- the unapproved third
 *      party in the browser's request path that this project forbids, and one
 *      that ships looking perfectly correct because OCR still works when the
 *      CDN answers.
 *
 * BE PRECISE ABOUT (b), because it is worth less alarm and more care than the
 * note that recorded it. Built and read back out of the emitted worker chunk,
 * Turbopack FOLDS `typeof window === "undefined"` to false for a browser
 * target and inlines the browser branch, so under this bundler the vendored
 * paths would in fact have been passed and no CDN fetch would have happened.
 * The old code was correct BY BUNDLER CONSTANT-FOLDING rather than by
 * construction -- true only while whatever builds this keeps folding it, and
 * silently a CDN fetch the moment it does not. What was genuinely broken in a
 * worker regardless of the bundler is the SHAPE of those paths; see
 * `vendoredAssets` below.
 *
 * Positive detection, in this order:
 *   - anything browser-shaped -- a DOM `document`, or a worker's
 *     `importScripts`/`WorkerGlobalScope` -- is a browser, main thread and
 *     worker alike;
 *   - otherwise a real `process.versions.node` string is Node (a bundler's
 *     `process` shim defines `versions` as `{}`, so it does not qualify);
 *   - otherwise "browser", deliberately, because that is the SAFE default: it
 *     pins the local asset paths, so an unrecognised runtime fails loudly on
 *     a 404 rather than quietly reaching a CDN.
 */
export function detectRuntime(
  scope: RuntimeScope = globalThis as RuntimeScope,
): "node" | "browser" {
  if (
    typeof scope.document !== "undefined" ||
    typeof scope.importScripts === "function" ||
    typeof scope.WorkerGlobalScope !== "undefined"
  ) {
    return "browser";
  }
  return typeof scope.process?.versions?.node === "string" ? "node" : "browser";
}

type VendoredAssets = Required<
  Pick<OcrAssets, "workerPath" | "corePath" | "langPath">
>;

/**
 * The vendored OCR assets, written into `public/tesseract` by
 * `scripts/vendor-ocr.mjs` at prebuild and served by this app.
 *
 * ABSOLUTE where an origin is available, and that is load-bearing rather than
 * tidiness -- it is the half of the Web Worker problem that no bundler
 * happens to paper over.
 *
 * tesseract.js resolves a relative path to an absolute URL only when its own
 * `getEnvironment('type') === 'browser'`, which is to say only when
 * `document` exists (read `src/utils/resolvePaths.js` in the package). Inside
 * a Web Worker its environment is `'webworker'` and that resolution is
 * SKIPPED, so the raw string travels on to `spawnWorker`, which by default
 * builds a Blob-URL worker whose entire body is
 * `importScripts("<workerPath>")`. A `blob:` URL has an opaque path, and the
 * WHATWG URL parser rejects resolving a root-relative specifier against one
 * outright -- `new URL("/tesseract/worker.min.js", "blob:https://host/uuid")`
 * throws, which the test suite pins. Whether a particular browser applies
 * that to `importScripts` inside a blob worker is not something a Node test
 * can settle, and that is the point: an absolute URL removes the question
 * instead of betting on the answer. It is also exactly what tesseract.js
 * would have computed for us on the main thread.
 */
function vendoredAssets(scope: RuntimeScope): VendoredAssets {
  const origin = scope.location?.origin ?? "";
  // An opaque origin serialises as the literal string "null", and a
  // "null/tesseract/..." URL is worse than the relative path it replaced, so
  // only a real http(s) origin is used.
  const prefix = /^https?:\/\//.test(origin)
    ? `${origin}/tesseract/`
    : "/tesseract/";
  return {
    workerPath: `${prefix}worker.min.js`,
    corePath: prefix,
    langPath: prefix,
  };
}

/**
 * The asset paths for the current runtime: none under Node (callers there
 * pass their own local paths, and `scripts/vendor-ocr.mjs` output is read off
 * disk), the vendored URLs in any browser context.
 *
 * Exported so a test can assert what a Web Worker scope gets, which is the
 * only way to prove the CDN fallback is shut.
 */
export function ocrAssetsFor(
  scope: RuntimeScope = globalThis as RuntimeScope,
): Partial<VendoredAssets> {
  return detectRuntime(scope) === "node" ? {} : vendoredAssets(scope);
}

/**
 * Reading ~3MB of gzipped traineddata and ~2.8MB of wasm core off local disk
 * takes a few seconds even on slow hardware. 30s leaves wide headroom above
 * that so a genuinely slow machine is never mistaken for the failure this
 * timeout exists to catch.
 */
const DEFAULT_INIT_TIMEOUT_MS = 30_000;

/**
 * `process._getActiveHandles` is an undocumented Node internal (no
 * `@types/node` declaration), used below purely as a last-resort leak guard.
 * Reproducing the hang and inspecting this list is how the fix was verified
 * at all: it showed exactly one leaked handle, a `MessagePort`.
 */
type HandleLike = {
  constructor?: { name?: string };
  close?: () => void;
  unref?: () => void;
};

/**
 * Reached through `globalThis`, never as a bare `process` identifier: in a
 * browser Web Worker there may be no such binding at all, and a bare
 * reference would throw a ReferenceError rather than evaluating to
 * `undefined`. Returns nothing unless `process.versions.node` is a real
 * string, so a bundler's `process` shim (which defines `versions` as `{}`)
 * cannot smuggle a browser into the Node-only branch.
 */
function nodeProcess(
  scope: RuntimeScope = globalThis as RuntimeScope,
): { _getActiveHandles?: () => HandleLike[] } | undefined {
  const proc = scope.process as
    | ({ versions?: { node?: string } } & {
        _getActiveHandles?: () => HandleLike[];
      })
    | undefined;
  return typeof proc?.versions?.node === "string" ? proc : undefined;
}

function activeHandles(): HandleLike[] {
  return nodeProcess()?._getActiveHandles?.() ?? [];
}

/**
 * Serializes worker initialisation: at most one createWorker() call is ever
 * in flight at a time.
 *
 * This is required for the leak guard in createWorkerInitAttempt to be
 * safe, not just tidy. That guard diffs process._getActiveHandles() before
 * and after a single createWorker() call to find the specific handle that
 * call spawned. Without serialisation, a second call's worker can spawn its
 * own MessagePort while a first call's diff window is still open; the first
 * call then sees that unrelated, healthy MessagePort as "new," and if the
 * first call times out, it closes the second call's channel instead of its
 * own -- hanging a perfectly healthy concurrent call forever. Reproduced and
 * confirmed by review: a bad-langPath call with a short initTimeoutMs
 * running concurrently with a good call against the real vendored assets
 * made the good call hang too.
 *
 * Bounded, not a deadlock risk: a stuck call still releases the queue on its
 * own timeoutMs, so the worst case is queued delay, never an infinite wait.
 * Cost: measured init time is 143-187ms, so serialising even Task 7's 28
 * pages adds roughly five seconds against per-page recognition, which
 * dominates total runtime regardless.
 */
let initQueue: Promise<void> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = initQueue.then(fn, fn);
  initQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * tesseract.js@7.0.0's own createWorker() has a defect: its internal init
 * chain --
 *
 *   loadInternal().then(loadLanguageInternal).then(initializeInternal)
 *     .then(workerResResolve).catch(() => {})
 *
 * -- ends in a bare `.catch(() => {})`. If loadLanguageInternal rejects (a
 * missing or misconfigured langPath/corePath is the near-universal cause),
 * that rejection is swallowed and workerResResolve is never called. The
 * promise createWorker() returns then neither resolves nor rejects: it hangs
 * forever, silently, with no exception and no log line. Confirmed by reading
 * tesseract.js's source and by reproducing the hang against a langPath
 * pointing at an empty directory.
 *
 * Wraps ONLY worker initialisation, not recognition. Page recognition on a
 * 300 DPI scan can legitimately take many seconds, so a timeout there would
 * be a different tradeoff; this timeout exists solely to turn the specific
 * init-hang above into an actionable error instead of a stall.
 *
 * Runs through serialize() -- see its comment for why running concurrently
 * with another call is not safe here.
 */
async function createWorkerWithTimeout(
  lang: string,
  options: Parameters<typeof createWorker>[2],
  timeoutMs: number,
): ReturnType<typeof createWorker> {
  return serialize(() => createWorkerInitAttempt(lang, options, timeoutMs));
}

async function createWorkerInitAttempt(
  lang: string,
  options: Parameters<typeof createWorker>[2],
  timeoutMs: number,
): ReturnType<typeof createWorker> {
  // `detectRuntime()`, never `typeof window` -- see its comment. A Web
  // Worker has no `window` either, and diffing handles there would have meant
  // touching `process` in a runtime that need not define it.
  const isNode = detectRuntime() === "node";
  // Snapshot taken on every call, not only ones that end up timing out --
  // at this point we do not yet know whether this call will time out, and
  // the diff below only means anything if it spans exactly this call's own
  // spawn.
  const handlesBeforeSpawn = isNode ? new Set(activeHandles()) : null;

  const pending = createWorker(lang, 1, options);

  // Best-effort guard for the case where createWorker() merely takes longer
  // than our timeout rather than being genuinely stuck: if it resolves
  // later anyway, terminate the now-unwanted worker instead of leaking it
  // for the rest of the process's life.
  let timedOut = false;
  pending.then(
    (worker) => {
      if (timedOut) void worker.terminate();
    },
    () => {},
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;

      // Best-effort leak guard for the genuine-hang case above. createWorker()
      // never gives us a handle to the worker it already spawned, so
      // tesseract.js's own `.terminate()` is unreachable here -- but the
      // spawned worker thread's communication channel is a real Node handle
      // that keeps this process's event loop alive on its own, even after we
      // reject below. Diffing the handle list before/after (made safe only
      // by serialize() above) isolates just what THIS call spawned.
      //
      // Only ever close a MessagePort, never any other handle type.
      // process._getActiveHandles() returns every active handle in the
      // process -- sockets, file streams, anything else the app has open --
      // and closing one of those instead would be a far worse bug than the
      // leak this guards against. MessagePort is the specific type this fix
      // was verified against (unref() alone was tried first and was NOT
      // enough to let the process exit; close() was).
      if (handlesBeforeSpawn) {
        for (const handle of activeHandles()) {
          if (handlesBeforeSpawn.has(handle)) continue;
          if (handle?.constructor?.name !== "MessagePort") continue;
          try {
            if (handle.close) handle.close();
            else handle.unref?.();
          } catch {
            // Best effort: a handle that errors on close is no worse off
            // than one we never touched.
          }
        }
      }

      reject(
        new Error(
          `tesseract.js createWorker("${lang}") did not settle within ${timeoutMs}ms. ` +
            "tesseract.js's own worker-init chain swallows a language-load " +
            "failure instead of rejecting, so this almost always means the " +
            "vendored OCR assets are missing or OcrAssets.langPath/corePath/" +
            "workerPath is misconfigured -- not that recognition is merely " +
            "slow. Run `pnpm vendor:ocr` to (re)generate public/tesseract, " +
            "then check the configured asset paths point at it.",
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Turns rendered RGBA pixels into something `worker.recognize` accepts.
 *
 * tesseract.js has no raw-pixel entry point: it writes the bytes to a virtual
 * file and calls `SetImageFile`, which needs a decodable image header, so raw
 * RGBA silently becomes a zero-length buffer and errors.
 *
 * Node encodes the PNG in-process with `src/lib/export/png.ts` and wraps it
 * in a `Buffer`, which is the type tesseract.js's Node `loadImage` expects.
 *
 * The browser hands tesseract.js an `OffscreenCanvas` instead, which its
 * browser `loadImage` special-cases by calling `convertToBlob()` (see that
 * library's `src/worker/browser/loadImage.js`). That is the browser's own
 * native PNG encoder, so no JavaScript encoder runs at all -- against a
 * 2480x3507 page, `encodePng` otherwise means a pure-JS CRC32 and row-filter
 * pass over 35MB, per page, on top of the compression.
 *
 * NOT because the Node branch would crash here: checked against the built
 * worker chunk, Turbopack resolves `Buffer` to its polyfill rather than
 * leaving a bare global, so that line would have run. It is the wrong tool in
 * the browser, not a landmine.
 */
async function toRecognizableImage(page: RenderedPage): Promise<Buffer | OffscreenCanvas> {
  if (detectRuntime() === "node") {
    return Buffer.from(await encodePng(page.data, page.width, page.height));
  }

  if (typeof OffscreenCanvas === "undefined") {
    throw new Error(
      "OCR in the browser needs OffscreenCanvas, which this browser does not " +
        "expose. Rendering and recognition both run in a Web Worker, where a " +
        "DOM <canvas> is unreachable.",
    );
  }

  const canvas = new OffscreenCanvas(page.width, page.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("OffscreenCanvas gave no 2D context.");
  // `RenderedPage.data` is declared as a bare `Uint8ClampedArray`, which TS
  // widens to `ArrayBufferLike`, while `ImageData` insists on `ArrayBuffer`.
  // Every RenderedPage in this codebase comes from `getImageData().data`,
  // which is always ArrayBuffer-backed, so this narrows a fact that already
  // holds rather than asserting a new one.
  const pixels = page.data as Uint8ClampedArray<ArrayBuffer>;
  context.putImageData(new ImageData(pixels, page.width, page.height), 0, 0);
  return canvas;
}

export async function ocrToWords(
  page: RenderedPage,
  lang = "ind",
  assets: OcrAssets = {},
): Promise<Word[]> {
  const { initTimeoutMs = DEFAULT_INIT_TIMEOUT_MS, ...assetPaths } = assets;
  const worker = await createWorkerWithTimeout(
    lang,
    {
      // Without this, a recognition failure is rethrown on a MessagePort tick
      // with no handler, which kills the whole process instead of rejecting.
      // The `finally` below would never run and the stack would not name this
      // function, so debugging starts from nothing.
      errorHandler: () => {},
      // gzip:true because @tesseract.js-data ships .traineddata.gz and the
      // vendoring step keeps it compressed. This must agree with what
      // scripts/vendor-ocr.mjs writes, or the fetch 404s.
      gzip: true,
      ...ocrAssetsFor(),
      ...assetPaths,
    },
    initTimeoutMs,
  );
  try {
    const image = await toRecognizableImage(page);
    const { data } = await worker.recognize(image, {}, { blocks: true });

    const words: Word[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          for (const w of line.words ?? []) {
            if (!w.text.trim()) continue;
            const box = {
              x: w.bbox.x0,
              y: w.bbox.y0,
              w: w.bbox.x1 - w.bbox.x0,
              h: w.bbox.y1 - w.bbox.y0,
            };
            // TESSERACT EMITS DEGENERATE BOXES on speckle -- `x1 === x0`, so a
            // zero-width word -- and this producer used to pass them straight
            // through. If such a word is alone on its row, `groupWordsIntoLines`
            // unions it into a zero-area LINE, which is invisible to
            // `linesTouchedBy` (an operator's drag over it cites nothing) and
            // which `assertLinesWellFormed` now refuses at `/api/propose`'s body
            // parser -- rejecting the whole 29-page request over one speck.
            //
            // Dropped rather than clamped, because a word with no area has no
            // ink to cite and inventing a pixel of height would be geometry the
            // engine never measured. This is the producer half of the contract
            // `assertLinesWellFormed` states: the Gemini producer asserts it and
            // this one must satisfy it too, or the two are held to different
            // rules by the same boundary.
            if (!Number.isFinite(box.w) || !Number.isFinite(box.h)) continue;
            if (box.w <= 0 || box.h <= 0) continue;
            words.push({ text: w.text, box });
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
