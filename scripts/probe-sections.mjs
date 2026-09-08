/**
 * `pnpm probe:sections <file.pdf> [more.pdf ...] [--from N] [--to N]`
 *
 * Runs the section-discovery stage over a whole bundle and prints EVERY span
 * it proposes: its page range, in run-global numbers and in its own file's
 * numbers, and the lines its title was read off, quoted. Nothing is cropped,
 * nothing is written, no deliverable is touched. It is a thing to read.
 *
 * WHY IT EXISTS: DISCOVERY SHIPS WITH NO GATE ROW, and that is deliberate
 * rather than an omission. `pnpm measure:locate` scores the locate step
 * against twelve human-authored crops, and three runs of an IDENTICAL locate
 * prompt scored 11, 9 and 11 on 2026-09-03 -- so a single run's total for a
 * brand new stage would be a measurement error dressed as evidence, and a
 * number in a table outlives every caveat written beside it. There is no
 * human-authored ground truth for "what judul does this bundle contain"
 * either: the two sample DOKUMEN VALIDASI packets are one person's answer for
 * one order each, and they share two headings out of about a dozen.
 *
 * So this is what stands in for a gate, and what it asks of you is different:
 * READ THE SPANS. A heading that is not the document's own words, a range that
 * stops one page short of a clause, a title cited to a line that says
 * something else -- those are visible here and invisible in a pass rate. In
 * the product the same job is done by a person pressing Terima on one usulan
 * at a time; this is that review, for a developer, over a whole bundle at
 * once.
 *
 * Do NOT quote a count from one run of this as a result. If you want to say
 * something about the stage, run it at least three times and compare the SETS
 * of headings, which is the same rule AGENTS.md states for the locate gate and
 * for the same measured reason.
 *
 * IT COSTS one Cloud Vision page charge per page not already in
 * `pnpm generate`'s OCR cache ($1.50 per 1,000), plus one model call per
 * document (a few thousand input tokens). It reads gitignored client material
 * out of `documents/`, so it is run by hand, like `pnpm measure:locate` and
 * `pnpm probe:pages`, and never in CI.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { createCanvas } from "@napi-rs/canvas";

// FIRST, deliberately: this loads .env.local into process.env, and
// src/lib/model.ts reads MODEL_ID and the cost settings at import time. A
// plain node script gets none of Next's env loading for free.
import "./env.mjs";

import { generateText } from "ai";

import {
  MAX_OUTPUT_TOKENS,
  MODEL_ID,
  MODEL_TARGET,
  chatModel,
  isTransient,
  providerOptions,
} from "../src/lib/model.ts";
import { DEFAULT_DPI, renderPageUpright } from "../src/lib/pipeline/render.ts";
import { ocrPageCompletely } from "../src/lib/pipeline/gemini-ocr.ts";
import {
  VISION_FEATURE,
  VISION_LANGUAGE_HINTS,
  ocrPageWithVision,
} from "../src/lib/pipeline/vision-ocr.ts";
import { annotateImage, isTransientVisionError } from "../src/lib/vision.ts";
// THE CONTRACT AND ITS VALIDATION COME FROM `pnpm generate`, not from a second
// copy here. A probe whose idea of the discovery stage's shape differed from
// the pipeline's would be measuring something the product does not do, which
// is worse than not measuring at all. The OCR cache key comes from there for
// the same reason and one more: sharing the key means a bundle read by either
// command is read once.
import {
  OCR_CACHE_PATH,
  OCR_ENGINE_TAG,
  loadDiscoverSections,
  ocrCacheKey,
} from "./generate.mjs";

const nodeContext = (w, h) => createCanvas(w, h).getContext("2d");

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const files = [];
let from = 1;
let to = Infinity;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--from") from = Number(argv[++i]);
  else if (arg === "--to") to = Number(argv[++i]);
  else if (arg.startsWith("--")) {
    console.error(`unknown option ${arg}`);
    process.exit(2);
  } else files.push(resolve(arg));
}

if (files.length === 0) {
  console.error(
    "Usage: node scripts/probe-sections.mjs <file.pdf> [more.pdf ...] " +
      "[--from N] [--to N]",
  );
  process.exit(2);
}
for (const file of files) {
  if (!existsSync(file)) {
    console.error(`no such file: ${file}`);
    process.exit(2);
  }
}
// A WINDOW IS A DIFFERENT DOCUMENT, so it may only be asked for when there is
// one document to be confused about. Applying one page range to several files
// would silently ask about a different slice of each.
if ((from !== 1 || to !== Infinity) && files.length > 1) {
  console.error("--from/--to take one PDF at a time: a window is not the bundle");
  process.exit(2);
}

/**
 * The engine this probe reads with, and the reason it refuses to be switched.
 *
 * `pnpm probe:pages` hardcodes Cloud Vision and so does this. What is NOT
 * optional is refusing to run under `OCR_ENGINE=gemini`: the OCR cache is
 * shared with `pnpm generate` and keyed by an engine tag, so reading with
 * Vision while the tag said Gemini would write Vision lines under a Gemini key
 * and serve them to every later Gemini run -- fast, cached and wrong, which is
 * the hardest kind of wrong to notice.
 */
const OCR_ENGINE = process.env.OCR_ENGINE ?? "vision";
if (OCR_ENGINE !== "vision") {
  console.error(
    `OCR_ENGINE=${OCR_ENGINE}: this probe reads with Cloud Vision, like ` +
      "`pnpm probe:pages`. It shares `pnpm generate`'s OCR cache, whose key " +
      "carries the engine, so it will not read with one engine under another " +
      "engine's tag. Unset OCR_ENGINE or set it to vision.",
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// The model, reached only through src/lib/model.ts.
//
// A SMALL ADAPTER OF ITS OWN, rather than `generate.mjs`'s `askFor`, and the
// duplication is deliberate for one reason: `askFor` records every call into
// that script's per-stage cost ledger, and the ledger has a closed union of
// stage names. A probe is not a stage of a run. What is shared is what MUST
// not diverge -- the discovery contract and its validation -- and what is
// copied is thirty lines of transport that this file prints its own totals
// for.
// ---------------------------------------------------------------------------

const cost = { calls: 0, in: 0, out: 0, thoughts: 0 };
const REQUEST_TIMEOUT_MS = Number(process.env.GENERATE_TIMEOUT_MS ?? 180_000);

async function askOnce(prompt) {
  const { text, usage, finishReason } = await generateText({
    model: chatModel(),
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    providerOptions,
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    maxRetries: 0,
  });

  const thoughts = usage.outputTokenDetails?.reasoningTokens ?? 0;
  cost.calls += 1;
  cost.in += usage.inputTokens ?? 0;
  cost.out += usage.outputTokens ?? 0;
  cost.thoughts += thoughts;
  console.log(
    `    [probe sections] ${MODEL_ID} in=${usage.inputTokens ?? "?"} ` +
      `out=${usage.outputTokens ?? "?"} (thoughts=${thoughts}) ` +
      `finish=${finishReason}`,
  );
  if (!text.trim()) {
    throw new Error(
      `${MODEL_TARGET} returned no text (finishReason=${finishReason}).`,
    );
  }
  return text;
}

/** Six attempts, same curve as the pipeline's: a 503 is not a result. */
async function withRetries(what, attempt, transient) {
  const attempts = 6;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (!transient(error) || i === attempts - 1) throw error;
      const backoffMs = Math.min(5000 * 2 ** i, 60_000);
      console.log(
        `    transient error on the ${what} call ` +
          `(${error.statusCode ?? error.status ?? error.name}), retrying in ` +
          `${backoffMs}ms: ${error.message}`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError;
}

const ask = (prompt) => withRetries("discovery", () => askOnce(prompt), isTransient);

// ---------------------------------------------------------------------------
// OCR, through the production path, sharing `pnpm generate`'s cache.
// ---------------------------------------------------------------------------

async function loadCache() {
  if (!existsSync(OCR_CACHE_PATH)) return {};
  try {
    return JSON.parse(await readFile(OCR_CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function ocrPage(rendered, label) {
  const { lines, report } = await ocrPageCompletely(
    rendered,
    (png) =>
      ocrPageWithVision(
        png,
        { width: rendered.width, height: rendered.height },
        (img) =>
          withRetries(
            "Vision",
            () =>
              annotateImage(img, {
                feature: VISION_FEATURE,
                languageHints: [...VISION_LANGUAGE_HINTS],
              }),
            isTransientVisionError,
          ),
      ),
    // ONE ATTEMPT. Vision is a deterministic recogniser, so re-sending an
    // identical image spends a second page charge to be told the same thing.
    // `scripts/generate.mjs` passes the same 1 for the same reason.
    { label, attempts: 1 },
  );
  return { lines, report };
}

// ---------------------------------------------------------------------------

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

console.log(`Model:  ${MODEL_TARGET}`);
console.log(`OCR:    ${OCR_ENGINE} (cache tag ${OCR_ENGINE_TAG})`);
console.log(`OCR cache: ${OCR_CACHE_PATH}`);
console.log();

const discoverSections = await loadDiscoverSections();
const cache = await loadCache();
let cacheDirty = false;

/** Every page of every file, appended in order: `pages[i].index === i`. */
const pages = [];
/** One entry per file, with the slice of `pages` it contributed. */
const documents = [];

for (const file of files) {
  const bytes = new Uint8Array(await readFile(file));
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false })
    .promise;

  const first = Math.max(1, from);
  const last = Math.min(to, doc.numPages);
  const windowed = first !== 1 || last !== doc.numPages;
  console.log(
    `${basename(file)}: ${doc.numPages} pages, reading ${first}..${last}` +
      (windowed
        ? " -- A WINDOW, NOT THE DOCUMENT: the stage answers about the pages " +
          "it is shown, so a span here is not a claim about the whole file"
        : ""),
  );

  const own = [];
  for (let n = first; n <= last; n++) {
    const pageInDoc = n - 1;
    const key = ocrCacheKey(hash, pageInDoc);
    let entry = cache[key];
    if (entry) {
      console.log(`  page ${pageInDoc}: cached OCR, ${entry.lines.length} lines`);
    } else {
      const started = Date.now();
      const page = await doc.getPage(n);
      try {
        const rendered = await renderPageUpright(page, DEFAULT_DPI, nodeContext);
        const { lines, report } = await ocrPage(
          rendered,
          `${basename(file)} page ${pageInDoc}`,
        );
        entry = { width: rendered.width, height: rendered.height, lines };
        cache[key] = entry;
        cacheDirty = true;
        console.log(
          `  page ${pageInDoc}: ${lines.length} lines, ` +
            `chars=${report.transcribedChars}, ` +
            `${((Date.now() - started) / 1000).toFixed(1)}s` +
            (report.degraded ? ` -- DEGRADED: ${report.reasons.join("; ")}` : ""),
        );
      } finally {
        page.cleanup();
      }
    }

    const stored = {
      source: documents.length,
      sourceName: basename(file),
      pageInDoc,
      index: pages.length,
      width: entry.width,
      height: entry.height,
      lines: entry.lines,
    };
    pages.push(stored);
    own.push(stored);
  }

  documents.push({ file, name: basename(file), pages: own });
  // Written after each document rather than at the end, so a run interrupted
  // half way through a 151-page bundle keeps what it paid for.
  if (cacheDirty) {
    await writeFile(OCR_CACHE_PATH, JSON.stringify(cache), "utf8");
    cacheDirty = false;
  }
}

console.log();

let totalSpans = 0;
let totalDropped = 0;

for (const berkas of documents) {
  console.log("=".repeat(72));
  console.log(`${berkas.name}: ${berkas.pages.length} page(s)`);
  console.log("=".repeat(72));

  let discovery;
  try {
    discovery = await discoverSections(berkas.pages, ask);
  } catch (error) {
    // A FAILED DOCUMENT IS NOT A FAILED PROBE. The next file's answer is
    // still worth having, and the whole point of this script is to see the
    // spread rather than to stop at the first thing that goes wrong -- the
    // same argument `scripts/probe-completeness.mjs` is built on.
    console.log(`  DISCOVERY FAILED: ${error?.name}: ${error?.message}\n`);
    continue;
  }

  totalSpans += discovery.sections.length;
  totalDropped += discovery.unusable.length;
  // The stage's own sentence about this berkas, printed whatever it says.
  // Three completely different situations produce an empty list and only this
  // line separates them; see `SectionDiscovery.note`.
  console.log(`  ${discovery.note}`);

  const byIndex = new Map(berkas.pages.map((page) => [page.index, page]));
  const covered = new Set();
  for (const section of discovery.sections) {
    const first = byIndex.get(section.cite.pageIndex);
    const last = byIndex.get(section.pages[section.pages.length - 1]);
    for (const p of section.pages) covered.add(p);
    console.log(
      `\n  "${section.title}"\n` +
        `    run pages ${section.pages[0]}-${section.pages[section.pages.length - 1]} ` +
        `(${berkas.name} pages ${first.pageInDoc + 1}-${last.pageInDoc + 1}, ` +
        `${section.pages.length} page(s))`,
    );
    // THE CITED LINES, QUOTED. This is the half a pass rate cannot show: the
    // title has to be the document's own heading, transcribed, and the only
    // way to see whether it is, is to read the lines it claims to come from
    // beside it. `discoverSections` checks that the title is a substring of
    // these lines; whether these lines are the HEADING is the judgement no
    // check can make and this probe exists to put in front of a person.
    const [from, to] = section.cite.lineRange;
    console.log(
      `    title read off page ${section.cite.pageIndex}, lines ${from}-${to}:`,
    );
    // By line NUMBER, not by array position, matching the stage's own lookup.
    const lines = new Map(first.lines.map((line) => [line.i, line.text]));
    for (let i = from; i <= to; i++) {
      console.log(`      ${String(i).padStart(3)} | ${lines.get(i) ?? "(no such line)"}`);
    }
  }

  if (discovery.unusable.length > 0) {
    console.log(`\n  ${discovery.unusable.length} refused by the stage:`);
    for (const entry of discovery.unusable) {
      console.log(`    - "${entry.title}": ${entry.reason}`);
    }
  }

  // GAPS ARE LEGAL HERE, unlike `classifyPages`' every-page-exactly-once rule,
  // because every span is confirmed by a person before it becomes evidence. A
  // page in no span is a page nobody proposed a heading for, which is a normal
  // answer and still worth counting: a document where most pages land nowhere
  // is telling you something about the stage or about the scan.
  const orphans = berkas.pages
    .filter((page) => !covered.has(page.index))
    .map((page) => page.pageInDoc + 1);
  console.log(
    `\n  ${discovery.sections.length} span(s), ${covered.size} of ` +
      `${berkas.pages.length} page(s) covered` +
      (orphans.length > 0 ? `, in no span: ${orphans.join(", ")}` : ""),
  );
  console.log();
}

console.log("=".repeat(72));
console.log(
  `${totalSpans} judul proposed across ${documents.length} document(s), ` +
    `${totalDropped} refused by the stage.`,
);
console.log(
  `cost: ${cost.calls} model call(s), in=${cost.in} out=${cost.out} ` +
    `thoughts=${cost.thoughts}`,
);
console.log(
  "Read the spans above before quoting any of these numbers. This stage has " +
    "no gate row, one run is not a measurement, and the question it answers " +
    "is whether each heading is the document's own words -- which is in the " +
    "quoted lines, not in the count.",
);
