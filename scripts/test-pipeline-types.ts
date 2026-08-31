/**
 * The type-level half of the pipeline's test suite.
 *
 * Some of what these modules promise is a promise to the *compiler*, and node
 * cannot check it: `node --test` strips the annotations and runs the JavaScript
 * underneath, so a type that has drifted away from what the code accepts still
 * passes every runtime assertion in test-pipeline.mjs. `npx tsc --noEmit -p
 * tsconfig.json` is what checks this file, and tsconfig's `**\/*.ts` include
 * already picks it up, so it is covered by a gate that already has to pass.
 *
 * It is written as .ts (not .mts/.mjs) for that reason, and imported from
 * scripts/test-pipeline.mjs so `pnpm test` still executes it -- that run proves
 * the file is wired in and its imports resolve, while tsc proves the actual
 * claim. Both matter: a type test nobody compiles is not a test.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { OcrAssets } from "../src/lib/pipeline/ocr.ts";

/**
 * The assertion here is the annotation, not the body.
 *
 * `ocrToWords` destructures `initTimeoutMs` off its `assets` argument and
 * spreads *everything else* into `createWorker`'s options, so it has always
 * accepted and forwarded the whole tesseract.js worker-options bag. Every
 * caller in scripts/ passes `gzip` and `cacheMethod` and always has. But
 * `OcrAssets` used to declare only workerPath/corePath/langPath, which made
 * this exact object literal an excess-property error -- the untyped .mjs
 * callers worked and a TypeScript one would have been told, wrongly, that the
 * option does not exist. Narrowing `OcrAssets` back to paths fails `tsc` here.
 */
const NODE_OCR_ASSETS: OcrAssets = {
  langPath: "./public/tesseract",
  gzip: true,
  cacheMethod: "none",
  initTimeoutMs: 300,
};

/**
 * `errorHandler` is the one worker option `OcrAssets` deliberately withholds:
 * ocr.ts installs its own, and a caller's would win the spread and re-arm the
 * unhandled-rethrow that kills the process. `@ts-expect-error` is itself the
 * assertion -- tsc fails this file if the line ever stops being an error,
 * which is exactly the regression worth catching.
 */
// @ts-expect-error errorHandler is intentionally not part of OcrAssets.
const REJECTED_OCR_ASSETS: OcrAssets = { errorHandler: () => {} };

test("OcrAssets covers the worker options ocrToWords really forwards", () => {
  // Runtime is incidental here; these keep the values used, and prove the
  // module loaded, while tsc above does the real work.
  assert.equal(NODE_OCR_ASSETS.gzip, true);
  assert.equal(NODE_OCR_ASSETS.cacheMethod, "none");
  assert.equal(NODE_OCR_ASSETS.langPath, "./public/tesseract");
  assert.equal(NODE_OCR_ASSETS.initTimeoutMs, 300);
  assert.ok(REJECTED_OCR_ASSETS);
});
