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
  /**
   * Milliseconds to wait for worker initialisation (spawn, wasm core load,
   * language load, init) before giving up. See createWorkerWithTimeout for
   * why this exists: tesseract.js's own init chain can hang here forever
   * instead of rejecting. Defaults to DEFAULT_INIT_TIMEOUT_MS.
   */
  initTimeoutMs?: number;
};

const BROWSER_ASSETS: Required<Pick<OcrAssets, "workerPath" | "corePath" | "langPath">> = {
  workerPath: "/tesseract/worker.min.js",
  corePath: "/tesseract/",
  langPath: "/tesseract/",
};

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
 * at all: it showed exactly one leaked handle (a `MessagePort`), and nothing
 * else in this codebase depends on it.
 */
type HandleLike = { close?: () => void; unref?: () => void };
function activeHandles(): HandleLike[] {
  const proc = process as unknown as { _getActiveHandles?: () => HandleLike[] };
  return proc._getActiveHandles?.() ?? [];
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
 * This wraps ONLY worker initialisation, not recognition. Page recognition
 * on a 300 DPI scan can legitimately take many seconds, so a timeout there
 * would be a different tradeoff; this timeout exists solely to turn the
 * specific init-hang above into an actionable error instead of a stall.
 */
async function createWorkerWithTimeout(
  lang: string,
  options: Parameters<typeof createWorker>[2],
  timeoutMs: number,
): ReturnType<typeof createWorker> {
  const isNode = typeof window === "undefined";
  const handlesBeforeSpawn = isNode ? new Set(activeHandles()) : null;

  const pending = createWorker(lang, 1, options);

  // Best-effort leak guard for the case where createWorker() merely takes
  // longer than our timeout rather than being genuinely stuck: if it
  // resolves later anyway, terminate the now-unwanted worker instead of
  // leaking it for the rest of the process's life.
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
      // reject below. Diffing the handle list before/after isolates just
      // what this specific call spawned (nothing else in the process is
      // touched), and closing it (not merely unref-ing -- verified by
      // reproduction that unref alone was NOT enough to let the process
      // exit, close was) lets this process exit normally. Node tears down
      // worker threads along with their parent on exit, so this does not
      // leave an orphaned OS thread outliving this process.
      if (handlesBeforeSpawn) {
        for (const handle of activeHandles()) {
          if (handlesBeforeSpawn.has(handle)) continue;
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
      ...(typeof window === "undefined" ? {} : BROWSER_ASSETS),
      ...assetPaths,
    },
    initTimeoutMs,
  );
  try {
    // tesseract.js has no raw-pixel path. It writes the bytes to a virtual
    // file and calls SetImageFile, which needs a decodable header, so raw
    // RGBA silently becomes a zero-length buffer and errors.
    const image = Buffer.from(await encodePng(page.data, page.width, page.height));
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
