/**
 * Which runtime is this code executing in, decided positively.
 *
 * Extracted from `src/lib/pipeline/ocr.ts` when the tesseract engine was
 * removed. It lived there only because that is where it was first needed, and
 * `gemini-ocr.ts` already carried a comment saying exactly that; nothing about
 * it is specific to an OCR engine, and the module that consumed it is gone.
 *
 * ## NEVER INFER THE RUNTIME FROM `window`
 *
 * `typeof window === "undefined"` used to stand in for "I am in Node" here. It
 * is false inside a browser Web Worker, where `window` is also undefined, and
 * a Web Worker is exactly where this project does its page work in the browser
 * (`src/lib/browser/pipeline.worker.ts`). The Node-only branches it guarded
 * reached for a BARE `process`, which a worker need not define at all -- and a
 * bare undefined identifier throws a ReferenceError rather than evaluating to
 * undefined. It now goes through `globalThis` and demands a real
 * `versions.node`.
 *
 * The historical version of that note claimed the mistake also sent the
 * browser to a CDN for OCR assets. BE PRECISE: read back out of the emitted
 * worker chunk, Turbopack FOLDS `typeof window === "undefined"` to false for a
 * browser target and inlines the browser branch, so under this bundler the
 * local paths were passed anyway. The old code was correct BY BUNDLER
 * CONSTANT-FOLDING rather than by construction -- true only while whatever
 * builds this keeps folding it. That distinction is worth keeping even now
 * that the assets it protected are gone, because the shape of the error
 * (correct by accident, in a way no test would catch) is the one this project
 * keeps meeting.
 *
 * Positive detection, in this order:
 *   - anything browser-shaped -- a DOM `document`, or a worker's
 *     `importScripts`/`WorkerGlobalScope` -- is a browser, main thread and
 *     worker alike;
 *   - otherwise a real `process.versions.node` string is Node (a bundler's
 *     `process` shim defines `versions` as `{}`, so it does not qualify);
 *   - otherwise "browser", deliberately, as the safe default for a runtime
 *     nobody recognised.
 */

/**
 * The globals this module inspects to decide which runtime it is in.
 *
 * Taken as an argument rather than read straight off `globalThis` so the
 * decision is a pure function a test can pin against a SYNTHETIC Web Worker
 * scope. `node --test` cannot conjure a real one, and the distinction below is
 * precisely the one this code used to get wrong, so "it is only checkable in a
 * browser" would have meant "it is not checked".
 */
export type RuntimeScope = {
  process?: { versions?: { node?: string } };
  document?: unknown;
  window?: unknown;
  importScripts?: unknown;
  WorkerGlobalScope?: unknown;
  location?: { origin?: string };
};

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
