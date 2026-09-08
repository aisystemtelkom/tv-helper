/**
 * `pnpm probe:pages <file.pdf> [--from N] [--to N]`
 *
 * Runs the production ingest path -- `renderPageUpright`, `pageToPng`,
 * `ocrPageWithVision`, `inkRowProfile`, `checkPageCompleteness` -- over every
 * page of one PDF and prints the completeness verdict for each.
 *
 * WHY IT EXISTS: IT DOES NOT STOP AT THE FIRST FAILURE, and nothing else here
 * can do that. `ocrPageCompletely` throws on a page it reads short and the
 * ingest ends, so the app can only ever report its FIRST bad page -- which is
 * useless for the only question that matters about a threshold, which is how
 * the whole population sits around it. This walks every page and reports all
 * of them, so `MIN_INK_COVERAGE` and `MAX_UNCOVERED_INK_RUN_SHARE` can be
 * argued about with a distribution instead of an anecdote. See the "A page
 * read short" section of AGENTS.md for what it measured on bundle two.
 *
 * IT COSTS ONE CLOUD VISION PAGE CHARGE PER PAGE ($1.50 per 1,000) and reads
 * gitignored client material out of `documents/`, so it is run by hand, like
 * `pnpm measure:locate`, and never in CI.
 */

import { readFile } from "node:fs/promises";

import { createCanvas } from "@napi-rs/canvas";

import { DEFAULT_DPI, renderPageUpright } from "../src/lib/pipeline/render.ts";
import {
  pageToPng,
  inkRowProfile,
  checkPageCompleteness,
} from "../src/lib/pipeline/gemini-ocr.ts";
import {
  ocrPageWithVision,
  VISION_FEATURE,
  VISION_LANGUAGE_HINTS,
} from "../src/lib/pipeline/vision-ocr.ts";
import { annotateImage } from "../src/lib/vision.ts";

const nodeContext = (w, h) => createCanvas(w, h).getContext("2d");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const numberAfter = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : Number(args[i + 1]);
};
if (!file) {
  console.error("Usage: node scripts/probe-completeness.mjs <file.pdf>");
  process.exit(2);
}

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const doc = await pdfjs.getDocument({
  data: new Uint8Array(await readFile(file)),
  isEvalSupported: false,
}).promise;

const from = numberAfter("--from", 1);
const to = Math.min(numberAfter("--to", doc.numPages), doc.numPages);
console.log(`${file}: ${doc.numPages} pages, probing ${from}..${to}`);

const failures = [];
let checked = 0;

for (let n = from; n <= to; n++) {
  const started = Date.now();
  try {
    const page = await doc.getPage(n);
    const rendered = await renderPageUpright(page, DEFAULT_DPI, nodeContext);
    const png = await pageToPng(rendered);
    const { lines, report } = await ocrPageWithVision(
      png,
      { width: rendered.width, height: rendered.height },
      (img) =>
        annotateImage(img, {
          feature: VISION_FEATURE,
          languageHints: [...VISION_LANGUAGE_HINTS],
        }),
    );
    const completeness = checkPageCompleteness(lines, inkRowProfile(rendered));
    checked += 1;
    const mark = completeness.complete ? "ok  " : "FAIL";
    console.log(
      `${mark} p${String(n).padStart(3)} ${lines.length} lines, ` +
        `cover=${completeness.inkCoverage.toFixed(3)} ` +
        `run=${completeness.uncoveredInkRunShare.toFixed(3)} ` +
        `chars=${report.transcribedChars} ` +
        `${((Date.now() - started) / 1000).toFixed(1)}s` +
        (completeness.complete ? "" : `\n       ${completeness.shortfalls.join("; ")}`),
    );
    if (!completeness.complete) failures.push({ page: n, completeness });
  } catch (error) {
    console.log(`ERR  p${String(n).padStart(3)} ${error?.name}: ${error?.message}`);
    failures.push({ page: n, error: String(error?.message ?? error) });
  }
}

console.log(
  `\nchecked ${checked} page(s), ${failures.length} would have killed an ingest: ` +
    failures.map((f) => `p${f.page}`).join(", "),
);
