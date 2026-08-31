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
