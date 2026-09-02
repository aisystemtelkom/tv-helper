/**
 * The end-to-end generator: scanned PDFs in, a DOKUMEN VALIDASI docx and an
 * EPIC order-config xlsx out. This is the whole pipeline in one command --
 * render, OCR, classify, locate, crop, extract, verify, export -- with no UI
 * and no browser involved.
 *
 *   pnpm generate <bundle>.pdf [more.pdf ...] [--tambahan extra.pdf]... [--out dir]
 *
 * Everything it knows about the target document comes from
 * `src/lib/forms/template.ts`. This file is wiring, not policy.
 *
 * Four things here are load-bearing and easy to "simplify" back into bugs:
 *
 * 1. IT ROUTES ON `section.layout`. A `layout: "images"` section is a
 *    WHOLE-PAGE capture -- a human filling the sample screenshots the entire
 *    page -- so the page is taken directly and NO model call is made. Asking
 *    the model to find a whole page inside that page is a category error, and
 *    it is exactly how those slots failed the Task 7 measurement gate: it
 *    returned a plausible-looking fragment every time. Routing them around
 *    the model took the gate from 6/12 to 9/12. Only `layout: "table"` slots
 *    go through `locateSlot`.
 *
 * 2. IT REACHES THE MODEL ONLY THROUGH `src/lib/model.ts`. `ask` below is an
 *    adapter over `chatModel()` and the vendor-neutral `ai` package, sending
 *    the same `providerOptions` and output cap `/api/chat` sends, and logging
 *    the same `in= out= (thoughts=) total=` line so cost shows up in this log
 *    rather than on an invoice a month later. No provider SDK is imported
 *    here, and none should be.
 *
 * 3. THE SEARCH IS DOCUMENT-AGNOSTIC. `classify.ts`'s spans ORDER a slot's
 *    pool -- likeliest document first -- and never shorten it. The same slot
 *    list is searched across whatever documents are supplied, with no
 *    assumption about which document carries which field (2026-08-31
 *    corrections note, section 2). This replaced a hard `docType` filter that
 *    existed for a real reason: on an unnarrowed pool the customer name
 *    matched the printed email's own `Cc:` header and both deliverables
 *    shipped a WRONG CUSTOMER. What holds that bug down now is the
 *    disambiguation in `SlotDef.hint` and `Template.fieldHints`, not a
 *    smaller haystack -- weaken those and the bug comes back quietly.
 *
 * 4. A RUN IS ADDITIVE ACROSS ROUNDS. The positional PDFs are round 1. Each
 *    `--tambahan` is a further round: the operator answering "yes, another
 *    document exists" for the slots round 1 left outstanding. A later round
 *    searches only what is still missing and can never discard a zone an
 *    earlier round found (corrections note, section 4). The UI for that
 *    conversation is a later plan's; this is the headless capability under
 *    it, and the CLI shape is provisional.
 *
 * OCR runs on one of two engines, chosen by `OCR_ENGINE` (default
 * "tesseract"; "gemini" sends each rendered page to the model as an image).
 * The flag exists so a run on one engine can be diffed crop-by-crop against a
 * run on the other; it is deliberately a SCRIPT flag only, never a browser
 * one, because a runtime engine switch in the worker would let two geometry
 * sources mix inside one bundle.
 *
 * OCR results are cached in the system temp directory, keyed by the source
 * file's content hash plus page, DPI AND ENGINE, because OCR-ing 29 300-DPI
 * scans takes minutes (and, on Gemini, money) and is a pure function of the
 * pixels for a fixed engine. The engine tag is not decoration: content
 * addressing alone made this cache hazard-free only while there was one
 * engine, and without the tag the same bytes would hit a tesseract-written
 * entry forever on a Gemini run -- which would look both fast AND correct,
 * the most convincing possible false positive. Model replies are deliberately
 * NOT cached: unlike a transcription they are not a pure function of their
 * input, and a stale verdict served silently is worse than paying again.
 * Set GENERATE_FORCE=1 to bypass the OCR cache.
 *
 * Every value bound for an xlsx cell is then RE-READ from a picture of the
 * lines it cites, and a disagreement blanks the cell with both readings
 * recorded instead of picking a winner (`src/lib/pipeline/verify.ts`;
 * GENERATE_VERIFY=0 turns it off for a controlled A/B). It exists because
 * Gemini confabulates small print confidently and repeatably at whole-page
 * resolution while reading the same region perfectly as a crop. What it does
 * NOT do is check that a crop shows the right region -- it compares text to
 * text, so a picture of the wrong place agrees with itself. Only
 * `pnpm measure:locate` measures where a zone landed.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

// First, and deliberately: importing this loads .env.local into process.env,
// and src/lib/model.ts reads MODEL_ID and the cost settings at import time.
// ESM evaluates static imports in declaration order, so this one must stay
// above the model import for `pnpm generate` to see the same settings the app
// sees. A plain node script gets none of Next's env loading for free.
import { repoRoot } from "./env.mjs";

import { generateObject, generateText, jsonSchema } from "ai";

import { AO_TEMPLATE } from "../src/lib/forms/template.ts";
import {
  MAX_OUTPUT_TOKENS,
  MODEL_ID,
  MODEL_TARGET,
  OCR_MAX_OUTPUT_TOKENS,
  chatModel,
  isTransient,
  providerOptions,
} from "../src/lib/model.ts";
import { classifyPages } from "../src/lib/pipeline/classify.ts";
import {
  OCR_PROMPT_VERSION,
  ocrPageCompletely,
  ocrPageWithGemini,
} from "../src/lib/pipeline/gemini-ocr.ts";
import {
  deriveIdsFromFilenames,
  extractFields,
  reconcileFieldValues,
} from "../src/lib/pipeline/fields.ts";
import { locateSlot } from "../src/lib/pipeline/locate.ts";
import { ocrToLines } from "../src/lib/pipeline/ocr.ts";
import { verifyCitedValues } from "../src/lib/pipeline/verify.ts";
import { DEFAULT_DPI, renderPageUpright } from "../src/lib/pipeline/render.ts";
import { cropToPng } from "../src/lib/export/crop.ts";
import { buildDocx } from "../src/lib/export/docx.ts";
import { buildXlsx } from "../src/lib/export/xlsx.ts";

// pdf.js ships an ESM legacy build for Node; the same entry point every other
// script and test in this repo uses.
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

const TESSERACT_ASSETS = join(repoRoot, "public", "tesseract");
const OCR_CACHE_PATH = join(tmpdir(), "tv-helper-generate-ocr-cache.json");
const FORCE_FRESH = process.env.GENERATE_FORCE === "1";

/**
 * The crop-level second pass, on unless `GENERATE_VERIFY=0` turns it off.
 *
 * On by default because it is the mitigation for the one measured failure this
 * migration introduces -- confident, deterministic, invisible confabulation of
 * small print at whole-page resolution -- and it costs about fifteen small
 * calls a run. See `src/lib/pipeline/verify.ts`, and read its opening lines
 * before quoting it as a correctness guarantee: it verifies VALUES, NOT CROPS.
 *
 * The switch exists for the controlled A/B this migration is judged on. A
 * tesseract run and a Gemini run are diffed value by value, and a pass that
 * blanks a cell on either side is a second variable moving in that diff. Turn
 * it off to isolate the engine; leave it on for anything a validator sees.
 */
const VERIFY_VALUES = process.env.GENERATE_VERIFY !== "0";

/**
 * Which engine reads the pixels. Two scripts have this flag -- this one and
 * `pnpm measure:locate` -- and nothing else does. The browser gets no runtime
 * switch on purpose: mixing two engines' geometry inside one bundle is the
 * wrong-and-quiet shape this project is organised against, and a browser
 * revert is reverting the commit.
 *
 * An unknown value THROWS rather than falling back to the default. `gemeni`,
 * `Gemini` or `gemini ` would otherwise run the whole bundle on tesseract
 * while the operator believed they were measuring the model -- a silent
 * answer to a question nobody asked.
 */
const OCR_ENGINE = process.env.OCR_ENGINE ?? "tesseract";
if (OCR_ENGINE !== "tesseract" && OCR_ENGINE !== "gemini") {
  throw new Error(
    `OCR_ENGINE=${OCR_ENGINE} is not an engine. Use "tesseract" (default) or "gemini".`,
  );
}

/**
 * Everything the cached text depends on, beyond the pixels themselves.
 *
 * The key used to be `${hash}:${dpi}:${page}` and that was genuinely
 * hazard-free while tesseract was the only engine: different pixels, different
 * key, and nothing else could change the answer. The moment the engine became
 * a variable that stopped being true. An untagged key would serve
 * tesseract-written lines to a Gemini run for as long as the temp file
 * survives, and the run would print cache hits, finish in seconds and produce
 * a plausible deliverable -- fast AND correct-looking, which is the hardest
 * kind of wrong to notice.
 *
 * The model id is in the tag because a different model is a different reader
 * of the same page, and `OCR_PROMPT_VERSION` is in it so that changing the
 * prompt by a word invalidates every entry by construction rather than by
 * somebody remembering to. `GENERATE_FORCE=1` still bypasses the lot.
 */
const OCR_ENGINE_TAG =
  OCR_ENGINE === "gemini"
    ? `gemini:${MODEL_ID}:${OCR_PROMPT_VERSION}`
    : "tesseract";

/**
 * How many pages this script reads at once. Engine-dependent by default, and
 * the difference is the point.
 *
 * On Gemini a page is a network round trip: the run spends nearly all of its
 * wall clock waiting, so four in flight is four times the throughput for no
 * extra CPU. 4 is the figure the migration probe measured its ~3.6s/page of
 * model time at, and it matches `DEFAULT_CONCURRENCY` in
 * `src/lib/browser/ingest.ts` so the two paths are comparable.
 *
 * On tesseract it stays 1. That engine is local wasm and already CPU-bound
 * (measured at ~4.1s/page in Node), so a pool buys much less than it costs --
 * and, more importantly, every tesseract run in this project is a BASELINE
 * that a Gemini run is diffed against. Changing the tesseract path's timing
 * and its peak memory in the same commit as the engine's would make that diff
 * uninterpretable, which is the one thing the whole measurement sequence is
 * organised to avoid. `OCR_CONCURRENCY=4` on the command line overrides it for
 * anyone who wants to measure that separately.
 *
 * Whatever the number, pages are APPENDED in page order; see `ocrEveryPage`.
 */
const OCR_CONCURRENCY = Number(
  process.env.OCR_CONCURRENCY ?? (OCR_ENGINE === "gemini" ? 4 : 1),
);
if (!Number.isInteger(OCR_CONCURRENCY) || OCR_CONCURRENCY < 1) {
  throw new Error(
    `OCR_CONCURRENCY=${process.env.OCR_CONCURRENCY} is not a page count. ` +
      "Give it a whole number of pages, 1 or more.",
  );
}

/** @napi-rs/canvas is the Node side of render.ts's injected CanvasFactory. */
const nodeContext = (w, h) => createCanvas(w, h).getContext("2d");

// ---------------------------------------------------------------------------
// The model, reached only through src/lib/model.ts.
// ---------------------------------------------------------------------------

const cost = { calls: 0, in: 0, out: 0, thoughts: 0, total: 0 };

/**
 * How often the page-completeness assertion fired, how many pages a re-read
 * then rescued, and -- the one that stops the other two from lying -- how many
 * pages the check actually ran on.
 *
 * COUNTED AND PRINTED BECAUSE A GUARD THAT NEVER FIRES IS UNTESTED, NOT
 * UNNECESSARY. The defect it watches for is intermittent -- roughly 7% of
 * whole-page reads came back materially short on 2026-09-02 -- so a run whose
 * log says nothing at all about it is indistinguishable from a run with the
 * check accidentally disabled.
 *
 * `pagesChecked` exists because 0 short reads of 0 checked pages reads exactly
 * like a clean bill of health and is not one. The assertion runs only where a
 * page is actually read: a cache hit never reaches `ocrPageWithModel`, and the
 * cache entry stores `{width, height, lines}` with no completeness in it, so a
 * re-export of an already-OCR'd bundle checks nothing at all. Under tesseract
 * it never runs either.
 */
let shortReads = 0;
let recoveredPages = 0;
let pagesChecked = 0;
let pagesTotal = 0;

/**
 * A ceiling on one call, not a budget. A locate prompt carries every page of
 * one document type as OCR text -- 17k input tokens for this bundle's KB --
 * and legitimately takes tens of seconds, but `generateText` has no timeout of
 * its own, so without this a stalled connection hangs the run silently. `ask`
 * counts an abort as transient, so a stall costs a retry rather than the run.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.GENERATE_TIMEOUT_MS ?? 180_000);

async function askOnce(prompt) {
  const { text, usage, finishReason } = await generateText({
    model: chatModel(),
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    providerOptions,
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    // Retries are handled by the loop below instead, so a 503 storm is one
    // visible backoff sequence in this log rather than two nested ones.
    maxRetries: 0,
  });

  const thoughts = usage.outputTokenDetails?.reasoningTokens ?? 0;
  cost.calls += 1;
  cost.in += usage.inputTokens ?? 0;
  cost.out += usage.outputTokens ?? 0;
  cost.thoughts += thoughts;
  cost.total += usage.totalTokens ?? 0;

  // Same line /api/chat logs, for the same reason: every request costs money
  // and thought tokens bill at the output rate.
  console.log(
    `    [generate] ${MODEL_ID} in=${usage.inputTokens ?? "?"} ` +
      `out=${usage.outputTokens ?? "?"} (thoughts=${thoughts}) ` +
      `total=${usage.totalTokens ?? "?"} finish=${finishReason}`,
  );

  if (finishReason === "length") {
    console.warn(
      `    [generate] hit the ${MAX_OUTPUT_TOKENS}-token output cap; the reply is ` +
        "truncated. Raise GEMINI_MAX_OUTPUT_TOKENS if this is legitimate.",
    );
  }
  if (!text.trim()) {
    throw new Error(
      `${MODEL_TARGET} returned no text (finishReason=${finishReason}). An empty ` +
        "reply with an uncapped thinking budget usually means thinking spent the " +
        "whole output allowance; GEMINI_THINKING_LEVEL is the knob.",
    );
  }
  return text;
}

/**
 * One OCR call: a page image in, the model's raw reply out.
 *
 * The same `generateText` shape `askOnce` sends -- same provider options, same
 * per-call timeout, same `maxRetries: 0` so the backoff below is the only one
 * in the log -- with two deliberate differences.
 *
 * 1. `OCR_MAX_OUTPUT_TOKENS`, not `MAX_OUTPUT_TOKENS`. The global 4096 is a
 *    runaway guard for four-field JSON verdicts and stays that; a dense 300
 *    DPI page was measured emitting 2554 output tokens of line list, so OCR
 *    gets its own ceiling rather than raising everyone's.
 * 2. ANY `finishReason` OTHER THAN `"stop"` THROWS, where the text path only
 *    warns. That asymmetry is the whole point: a truncated locate reply fails
 *    to parse loudly, so a warning is enough, but a short line list is still
 *    valid JSON with fewer lines in it -- a silently short page, whose missing
 *    lines are invisible to everything downstream, and which is then written
 *    to the OCR cache and served on every subsequent run.
 *
 *    THE CONDITION IS `!== "stop"`, NOT `=== "length"`, and the difference is
 *    load-bearing rather than pedantic. `length` is only the truncation this
 *    was first written for; a `RECITATION` finish (measured arriving on 1 of 3
 *    identical calls of one real contract page) and a content-filter finish
 *    both map to reasons like `"other"` or `"content-filter"` and can carry
 *    PARTIAL text. Nothing downstream can tell a short page from a sparse one.
 *    `/api/ocr`'s route and the gate harness both spell it `!== "stop"`; the
 *    three call sites must agree or a reader will assume they do.
 *
 * `image.bytes` goes on the wire as-is, as a `file` part rather than the
 * `image` part the AI SDK deprecated in v7: the two were measured sending the
 * identical request (same reply, same 1091 input tokens for the same PNG), but
 * `image` logs a DeprecationWarning, and 29 of those a run is exactly the
 * noise a real warning hides in.
 *
 * `providerOptions` carries `mediaResolution`, which used to cost the
 * validator nothing because this script sent no images at all; on this path it
 * is the dominant cost lever -- roughly 1110 input tokens per page at HIGH,
 * flat, whatever the page's pixel dimensions.
 *
 * `label` only tags the log line. Two callers send images -- whole-page OCR and
 * the crop-level verification pass -- and an invoice-sized run of identical
 * `[generate ocr]` lines that is really two different jobs is a small lie in
 * the one place cost is meant to be visible.
 */
async function askImageOnce(prompt, image, schema, label = "ocr") {
  // `generateObject`, not `generateText`, and the difference is not stylistic.
  // It forwards the schema to Gemini as `responseSchema`, which CONSTRAINS
  // generation rather than describing the wanted shape in prose. Measured on
  // four real 300 DPI pages with the same prompt: unconstrained, 0 of 4
  // replies were parseable JSON (a doubled key, a stringified box_2d, a third
  // key spelling, and a bare syntax error mid-array); constrained, 4 of 4 with
  // keys exactly {box_2d, text}.
  //
  // The object is stringified straight back, because `AskImage` is
  // `=> Promise<string>` and `linesFromGeminiReply` owns the parse. Keeping
  // the parse in one place is what lets the convention guard and the
  // drop-and-count live at a single seam rather than at every call site.
  const { object, usage, finishReason } = await generateObject({
    model: chatModel(),
    schema: jsonSchema(schema),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "file", data: image.bytes, mediaType: image.mediaType },
        ],
      },
    ],
    maxOutputTokens: OCR_MAX_OUTPUT_TOKENS,
    providerOptions,
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    maxRetries: 0,
  });
  const text = JSON.stringify(object);

  const thoughts = usage.outputTokenDetails?.reasoningTokens ?? 0;
  cost.calls += 1;
  cost.in += usage.inputTokens ?? 0;
  cost.out += usage.outputTokens ?? 0;
  cost.thoughts += thoughts;
  cost.total += usage.totalTokens ?? 0;

  console.log(
    `    [generate ${label}] ${MODEL_ID} in=${usage.inputTokens ?? "?"} ` +
      `out=${usage.outputTokens ?? "?"} (thoughts=${thoughts}) ` +
      `total=${usage.totalTokens ?? "?"} finish=${finishReason}`,
  );

  if (finishReason !== "stop") {
    throw new Error(
      `OCR stopped with finishReason="${finishReason}" and was not parsed. ` +
        (finishReason === "length"
          ? `It hit the ${OCR_MAX_OUTPUT_TOKENS}-token output cap, so this page's ` +
            "line list is cut off part-way down the page. Raise " +
            "GEMINI_OCR_MAX_OUTPUT_TOKENS if the page is legitimately this dense."
          : "A reply that stopped for any reason other than finishing -- " +
            "recitation, a content filter, or an unmapped provider reason -- can " +
            "carry PARTIAL text, which is valid JSON with fewer lines in it.") +
        " It is refused rather than parsed: a short line list reads downstream " +
        "as a sparse page, nothing else in this run would catch it, and it " +
        "would then be written to the OCR cache and served on every re-run.",
    );
  }
  if (!text.trim()) {
    throw new Error(
      `${MODEL_TARGET} returned no text for an OCR call (finishReason=${finishReason}). ` +
        "An empty reply with an uncapped thinking budget usually means thinking " +
        "spent the whole output allowance; GEMINI_THINKING_LEVEL is the knob.",
    );
  }
  return text;
}

/**
 * Six attempts with a long backoff, not the SDK's default two. AGENTS.md
 * records intermittent 503s from Gemini, and Task 7's measurement run lost
 * three slots outright to them -- scoring an availability blip as a pipeline
 * failure is the one wrong answer this script must not give. The backoff is
 * longer than a chat request would justify because a full run is minutes of
 * OCR and six figures of tokens: waiting a minute beats redoing all of it.
 *
 * What counts as transient is `isTransient` in src/lib/model.ts, which reads
 * the error OBJECT rather than its message -- it used to live here, and it
 * moved to the provider boundary because reading provider error shapes is
 * what that file is for and because the OCR route needs the same rule. Its
 * docstring carries the 100k-token run a message-matching version cost.
 *
 * Shared by the text and image calls rather than copied, so there is one
 * attempt count and one backoff curve to reason about: an OCR page is worth
 * MORE retries than a slot, not fewer, because a page that gives up takes the
 * whole run with it.
 */
async function withRetries(what, attempt) {
  const attempts = 6;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || i === attempts - 1) throw err;
      const backoffMs = Math.min(5000 * 2 ** i, 60_000);
      console.log(
        `    [generate] transient error on the ${what} call ` +
          `(${err.statusCode ?? err.name}), retrying in ${backoffMs}ms: ${err.message}`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError;
}

async function ask(prompt) {
  return withRetries("text", () => askOnce(prompt));
}

/** The `AskImage` every OCR call in this script is injected with. */
async function askImage(prompt, image, schema, label = "ocr") {
  return withRetries("OCR", () => askImageOnce(prompt, image, schema, label));
}

// ---------------------------------------------------------------------------
// Arguments.
// ---------------------------------------------------------------------------

const USAGE = `Usage: pnpm generate <bundle.pdf> [more.pdf ...] [--tambahan <extra.pdf>]...
                    [--out <dir>]

Writes <ID EPIC>_DOKUMEN_VALIDASI.docx, <ID EPIC>_ORDER_Config.xlsx and
<ID EPIC>_OUTSTANDING.json into <dir> (default: out/, which is gitignored).

Every positional PDF is round 1: the whole slot list is searched across all of
them, with no assumption about which document carries what. Each --tambahan
opens a further round -- the "dokumen tambahan" an operator supplies when a
round left slots outstanding -- and that round searches the new document for
ONLY the slots still missing. Zones found earlier are never re-searched and
never discarded. The JSON names every slot still outstanding at the end, so a
blank cell in the deliverable is a recorded decision rather than a silent gap.`;

/**
 * Rounds, not a flat PDF list: `rounds[0]` is the initial bundle and each
 * `--tambahan` appends a round of its own. One PDF per `--tambahan` because
 * that is what the operator conversation looks like ("is there another
 * document?" is asked one document at a time); pass the flag twice for two.
 * Provisional -- section 4 of the corrections note gives the UI to a later
 * plan, and this shape exists to prove the headless capability under it.
 */
export function parseArgs(argv) {
  /** @type {string[][]} */
  const rounds = [[]];
  let outDir = join(repoRoot, "out");

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      const value = argv[++i];
      if (!value) throw new Error("--out needs a directory");
      outDir = resolve(value);
    } else if (arg === "--tambahan") {
      const value = argv[++i];
      if (!value) throw new Error("--tambahan needs a PDF");
      rounds.push([resolve(value)]);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      rounds[0].push(resolve(arg));
    }
  }

  if (rounds[0].length === 0) throw new Error("no PDF given");
  for (const round of rounds) {
    for (const p of round) {
      if (!existsSync(p)) throw new Error(`no such file: ${p}`);
    }
  }
  return { rounds, outDir };
}

// ---------------------------------------------------------------------------
// OCR cache. Keyed by the file's own content hash, not its path or mtime, so
// the same bundle under a different name reuses the same work and an edited
// file never serves a stale page -- and by the engine that wrote the entry, so
// switching engines cannot serve one engine's text to the other's run. See
// OCR_ENGINE_TAG above for why that second half is not optional.
// ---------------------------------------------------------------------------

async function loadCache() {
  if (!existsSync(OCR_CACHE_PATH)) return {};
  try {
    return JSON.parse(await readFile(OCR_CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  await writeFile(OCR_CACHE_PATH, JSON.stringify(cache), "utf8");
}

// ---------------------------------------------------------------------------
// Pass 1: render every page and OCR it, keeping only the text geometry.
//
// The pixels are dropped on purpose. A 300 DPI A4 scan is ~35MB of RGBA, so
// holding 29 of them would cost a gigabyte to serve the dozen crops that
// actually get cut. Pass 2 re-renders only the pages a slot landed on.
// ---------------------------------------------------------------------------

/**
 * One page through the Gemini OCR path: encode, ask, convert, report.
 *
 * The conversion itself lives in `src/lib/pipeline/gemini-ocr.ts` and is
 * shared verbatim with `/api/ocr`, so the browser and this script cannot drift
 * into two different readings of the same reply. All this adds is the log line
 * the operator judges the run by.
 *
 * `interpolated` is worth printing per page rather than only in aggregate.
 * Gemini returns paragraph BLOCKS, not visual lines, so per-line boxes inside
 * a multi-line block are sliced arithmetically rather than measured. A page or
 * two of that is the expected case; a run where nearly every line is
 * interpolated has quietly become "trust the model's block box with a 12px
 * pad", which is a different design from the one that was measured, and the
 * printed counts are how anybody would notice.
 *
 * THE COMPLETENESS ASSERTION RUNS HERE, and this is one of the three places it
 * can: `rendered` is the RGBA `renderPageUpright` just produced, so the page's
 * own ink extent is one pass away with no decoder and no second render.
 * `/api/ocr` deliberately gets no pixels -- it receives a PNG and returns lines
 * -- and the device is also the only side that can re-request a page, which is
 * what the retry does. See `ocrPageCompletely` for the two properties that make
 * an assertion acceptable here where a second segmentation engine is not.
 */
async function ocrPageWithModel(rendered, sourceName, pageInDoc) {
  pagesChecked += 1;
  const { lines, report, completeness, attempt, image } = await ocrPageCompletely(
    rendered,
    (png) => ocrPageWithGemini(png, askImage),
    {
      label: `${sourceName} page ${pageInDoc}`,
      onShort: (short) => {
        shortReads += 1;
        console.warn(
          `    [generate ocr] SHORT READ ${sourceName} page ${pageInDoc}, ` +
            `attempt ${short.attempt} of ${short.attempts}: ${short.lines} lines ` +
            `-- ${short.completeness.shortfalls.join("; ")}. Re-reading the ` +
            // Named, not implied: the re-read sends the same bytes with the
            // same prompt, so nothing but the model's own sampling can make it
            // differ. See `ocrPageCompletely`.
            "IDENTICAL page image.",
        );
      },
    },
  );
  if (attempt > 1) recoveredPages += 1;

  console.log(
    `    [generate ocr] ${sourceName} page ${pageInDoc}: ` +
      `${(image.bytes.length / 1024 / 1024).toFixed(2)}MB png, ` +
      `${report.blocks} blocks -> ${report.segments} bands -> ${report.lines} lines ` +
      `(interpolated=${report.interpolatedLines}, dropped=${report.droppedEntries}, ` +
      // The two numbers a short page shows up in, printed while the run is
      // still going rather than only in a post-mortem. `chars` and `cover` are
      // what separated the two silently-truncated pages of the 2026-09-02 gate
      // run from the 27 healthy ones: one covered 0.514 of its page height, the
      // other collapsed six paragraphs into their first lines. Neither raised
      // anything anywhere else.
      `chars=${report.transcribedChars}, cover=${report.verticalCoverage.toFixed(3)}, ` +
      // `ink` is the assertion's own number: the same boxes measured against
      // this page's real ink rather than against the paper. `cover` cannot tell
      // a short read from a page with a wide bottom margin; `ink` can, which is
      // the whole reason it is worth a pass over the RGBA.
      `ink=${completeness.inkCoverage.toFixed(3)}, ` +
      // The other half of the assertion, and the half a footer cannot fake:
      // `ink` is a max over the boxes, so one box near the page bottom
      // satisfies it however little else came back. `uncovered` is the most ink
      // the boxes skipped in one stretch of the page.
      `uncovered=${(100 * completeness.uncoveredInkRunShare).toFixed(1)}%, ` +
      `collapsed=${report.collapsedBlocks})`,
  );
  if (report.degraded) {
    // Not fatal: `linesFromGeminiReply` throws outright when enough entries
    // fail validation to mean the reply is in the wrong coordinate convention.
    // What reaches here is a page that converted, with something about it worth
    // a human's attention before its crops are signed.
    console.warn(
      `    [generate ocr] DEGRADED page: ${report.reasons.join("; ")}`,
    );
  }
  return lines;
}

/**
 * Appends this round's pages to the run's global page list and returns just
 * the ones it added.
 *
 * The list is global and append-only across rounds on purpose: a zone's
 * `pageIndex` is an index into it, so a document arriving in round 3 must not
 * renumber the pages round 1's zones already point at. `index` therefore
 * always equals the page's position in `pages`, which several helpers below
 * rely on.
 *
 * WHICH IS WHY THE POOL BELOW BUFFERS. Up to `OCR_CONCURRENCY` pages are read
 * at once, and they finish in whatever order the model answers -- but they are
 * pushed onto `pages` strictly in page order, because the push order IS the
 * global page number. A page appended out of turn does not produce a
 * mis-ordered list; it gives some other page's number to this one, and every
 * zone, crop, citation and xlsx note that names a page number afterwards names
 * the wrong page while looking entirely normal. Same reasoning, same shape, as
 * `src/lib/browser/ingest.ts`; the two loops are deliberately alike.
 *
 * The cache write happens in that same ordered step rather than inside a
 * worker, so concurrent pages cannot interleave two `writeFile`s of the whole
 * cache object onto one path and leave truncated JSON behind.
 */
async function ocrEveryPage(sources, sourceIndexes, cache, pages) {
  const added = [];

  for (const sourceIndex of sourceIndexes) {
    const source = sources[sourceIndex];
    const total = source.doc.numPages;
    const concurrency = Math.max(1, Math.min(OCR_CONCURRENCY, total));

    /** Finished pages waiting for their turn, keyed by page-in-document. */
    const ready = new Map();
    /** The next page-in-document that may be appended. */
    let nextToAppend = 0;

    // One chain, so the appends -- and the cache writes and log lines that go
    // with them -- happen one at a time and in page order.
    let appends = Promise.resolve();
    function appendWhatIsReady() {
      appends = appends.then(async () => {
        for (;;) {
          const done = ready.get(nextToAppend);
          if (!done) return;
          const pageInDoc = nextToAppend;
          ready.delete(pageInDoc);
          nextToAppend += 1;

          if (done.fresh) {
            cache[done.key] = done.entry;
            await saveCache(cache);
            console.log(
              `  ${source.name} page ${pageInDoc}: ` +
                `${done.entry.width}x${done.entry.height}, ` +
                `${done.entry.lines.length} lines, ` +
                `${(done.elapsedMs / 1000).toFixed(1)}s`,
            );
          } else {
            console.log(
              `  ${source.name} page ${pageInDoc}: cached OCR, ` +
                `${done.entry.lines.length} lines`,
            );
          }

          const page = {
            source: sourceIndex,
            sourceName: source.name,
            pageInDoc,
            index: pages.length, // the global page number every zone refers to
            width: done.entry.width,
            height: done.entry.height,
            lines: done.entry.lines,
          };
          pages.push(page);
          added.push(page);
        }
      });
      return appends;
    }

    // A shared cursor rather than a slice per worker: a cached page costs
    // nothing and a fresh one costs seconds, so a fixed split would leave
    // workers idle behind whichever one drew the uncached pages.
    let nextToStart = 0;
    let failure;

    async function worker() {
      while (failure === undefined) {
        const pageInDoc = nextToStart;
        if (pageInDoc >= total) return;
        nextToStart += 1;
        pagesTotal += 1;

        const key = `${source.hash}:${DEFAULT_DPI}:${pageInDoc}:${OCR_ENGINE_TAG}`;
        const cached = FORCE_FRESH ? undefined : cache[key];

        if (cached) {
          ready.set(pageInDoc, { key, entry: cached, fresh: false });
        } else {
          const started = Date.now();
          const page = await source.doc.getPage(pageInDoc + 1); // pdf.js is 1-based
          try {
            const rendered = await renderPageUpright(
              page,
              DEFAULT_DPI,
              nodeContext,
            );
            const lines =
              OCR_ENGINE === "gemini"
                ? await ocrPageWithModel(rendered, source.name, pageInDoc)
                : await ocrToLines(rendered, "ind", {
                    langPath: TESSERACT_ASSETS,
                    gzip: true,
                    // Without this tesseract.js decompresses the vendored
                    // .traineddata.gz into process.cwd() and leaves it there.
                    cacheMethod: "none",
                  });
            ready.set(pageInDoc, {
              key,
              entry: { width: rendered.width, height: rendered.height, lines },
              fresh: true,
              elapsedMs: Date.now() - started,
            });
          } finally {
            // pdf.js caches the page's operator list and its decoded images on
            // the proxy, and `source.doc` stays open for the whole run, so
            // without this the bundle's pixels accumulate inside pdf.js for
            // pass 2 to sit on top of.
            page.cleanup();
          }
        }

        await appendWhatIsReady();
      }
    }

    // `allSettled`, not `all`: `all` would return while other pages are still
    // rendering, and the next source's pages would then be appended alongside
    // stragglers from this one.
    const settled = await Promise.allSettled(
      Array.from({ length: concurrency }, async () => {
        try {
          await worker();
        } catch (error) {
          failure ??= error;
          throw error;
        }
      }),
    );
    const rejected = settled.find((result) => result.status === "rejected");
    if (rejected) throw rejected.reason;
  }

  return added;
}

// ---------------------------------------------------------------------------
// Classification, one call per source document.
//
// Per document rather than one call over the concatenation, because a span is
// a run of pages within ONE file: a span crossing a file boundary is never a
// legitimate answer, and classifyPages' own "every page covered exactly once"
// check is more useful when it is scoped to a document a person can open.
// ---------------------------------------------------------------------------

/** How much of a page classify sees. Headings live at the top; it slices to 400. */
const HEAD_LINES = 12;

async function classifyEverything(sources, sourceIndexes, pages, byType) {
  for (const sourceIndex of sourceIndexes) {
    const source = sources[sourceIndex];
    const own = pages.filter((p) => p.source === sourceIndex);
    const heads = own.map((p, position) => ({
      index: position,
      head: p.lines
        .slice(0, HEAD_LINES)
        .map((l) => l.text)
        .join(" "),
    }));

    console.log(`  classifying ${source.name} (${own.length} pages)...`);
    const spans = await classifyPages(heads, ask);

    for (const span of spans) {
      const list = byType.get(span.docType) ?? [];
      for (let p = span.fromPage; p <= span.toPage; p++) {
        list.push(own[p].index);
      }
      byType.set(span.docType, list);
      console.log(
        `    ${source.name} pages ${span.fromPage}-${span.toPage} -> ${span.docType}`,
      );
    }
  }

  for (const list of byType.values()) list.sort((a, b) => a - b);
  return byType;
}

// ---------------------------------------------------------------------------
// Planning: one zone per crop the docx needs.
//
// A search round is offered EVERY page it has, never a subset. `classify.ts`
// still runs, and its spans still matter -- they decide the ORDER a slot's
// pages are shown in, likeliest document first -- but they can no longer
// remove a page from the pool. That is the 2026-08-31 corrections note's
// central instruction (section 2, "The tool is DOCUMENT-AGNOSTIC"), and it is
// what makes the same slot list work on a bundle whose documents arrive in a
// different order, split across different files, or with a document type this
// pipeline has never seen.
//
// The narrowing it replaces existed to fix a live wrong-and-quiet defect, so
// the replacement has to carry that weight: read `SlotDef.hint` and
// `Template.fieldHints` in src/lib/forms/template.ts before touching either.
// ---------------------------------------------------------------------------

/**
 * A round's pages as an array indexed by global page index -- the shape
 * `poolForDocTypes` documents for its third argument. Sparse when the round
 * holds only some of the run's pages, which is exactly the case from round 2
 * on, so every read of it is filtered for holes.
 */
function pagesByIndex(pages) {
  const byIndex = [];
  for (const page of pages) byIndex[page.index] = page;
  return byIndex;
}

/**
 * The pool a search is offered: EVERY candidate page, with the ones
 * classify.ts labelled with a preferred docType moved to the front.
 *
 * Nothing is dropped, and that is the entire point -- this is the function
 * that replaced `poolFor(byType, pages, slot.docType)`, which returned only
 * the matching pages and so decided in advance which document could possibly
 * answer a slot. Reintroducing a filter here (an early `return head`, a
 * `.slice`, "the tail is only noise") re-narrows the pool and quietly
 * restores the assumption the tool is supposed to have dropped.
 */
export function rankedPool(preferredDocTypes, byType, candidates) {
  const preferred = new Set();
  for (const docType of preferredDocTypes ?? []) {
    if (!docType) continue;
    for (const index of byType.get(docType) ?? []) preferred.add(index);
  }
  const head = [];
  const tail = [];
  for (const page of candidates) {
    (preferred.has(page.index) ? head : tail).push(page);
  }
  return [...head, ...tail];
}

/**
 * The name a slot is searched by: the document its section is about, then its
 * own row label.
 *
 * The row label alone is what the docx prints, and on its own it is often
 * meaningless as a question -- "Detail", "Nomor", "ToP". That was survivable
 * while a slot only ever saw its own document's pages; on a whole-bundle pool
 * it is not, because half a dozen documents have a Nomor and a Tanggal.
 * Measured on the gate: asked as "ToP", the payment slot answered with the
 * remittance-account page; asked as "KB / ToP" it answered with the payment
 * clause, which is the page the sample's first capture comes from.
 *
 * The `(lanjutan)` suffix is dropped because it is a LAYOUT fact, not a
 * document name: the sample splits the KB checklist across two tables and
 * titles the second one "continued". Also measured: `KB (lanjutan) / Detail`
 * returned the clause title but dropped the `Pasal 5` line above it that the
 * human's crop starts at, where plain `KB / Detail` kept it. Anything else in
 * a section title is part of the question and stays.
 */
export function slotSearchLabel(section, slot) {
  const document = section.title.replace(/\s*\(lanjutan\)\s*$/i, "");
  return `${document} / ${slot.label}`;
}

/** Every slot in the template, paired with the section that holds it. */
export function templateSlots(template) {
  return template.sections.flatMap((section) =>
    section.slots.map((slot) => ({ section, slot })),
  );
}

/** How many captures a slot needs before it counts as filled. See SlotDef.crops. */
export function slotCropCount(slot) {
  return slot.crops ?? 1;
}

/**
 * The slot keys that already have every capture they need, so a further round
 * can skip them.
 *
 * Counted against `crops` rather than "has at least one zone" because the
 * sample's ToP row stacks two pictures cut from two different pages: one zone
 * is a partly-filled slot, not a filled one, and treating it as filled is how
 * a document that looks complete ships missing evidence.
 */
export function satisfiedSlotKeys(template, zones) {
  const counts = new Map();
  for (const zone of zones) {
    counts.set(zone.key, (counts.get(zone.key) ?? 0) + 1);
  }
  const satisfied = new Set();
  for (const { slot } of templateSlots(template)) {
    if (!slot.fillable) continue;
    if ((counts.get(slot.key) ?? 0) >= slotCropCount(slot)) satisfied.add(slot.key);
  }
  return satisfied;
}

/**
 * Round N's zones folded into everything found so far.
 *
 * ADDITIVE, in the corrections note's sense (section 4): every earlier zone
 * survives untouched, and a later round can only ever ADD -- fill a slot that
 * was empty, or supply the second capture of a two-crop slot. A later round
 * never replaces an earlier zone for the same key, so supplying one more
 * document cannot cost the operator a zone they had already accepted.
 */
export function mergeZones(previous, next, template) {
  const cap = new Map();
  for (const { slot } of templateSlots(template)) {
    cap.set(slot.key, slotCropCount(slot));
  }

  const counts = new Map();
  const merged = [];
  for (const zone of previous) {
    counts.set(zone.key, (counts.get(zone.key) ?? 0) + 1);
    merged.push(zone);
  }
  for (const zone of next) {
    const used = counts.get(zone.key) ?? 0;
    if (used >= (cap.get(zone.key) ?? 1)) continue;
    counts.set(zone.key, used + 1);
    merged.push(zone);
  }
  return merged;
}

/**
 * Zones sorted into template order, ties broken by discovery order.
 *
 * `buildDocx` groups crops by key and renders a key's crops in the order it
 * receives them, so the discovery-order tiebreak is what keeps a two-crop
 * slot stacked round 1 first. The template-order sort keeps `cutCrops`'
 * position bookkeeping legible when rounds interleave.
 */
export function inTemplateOrder(zones, template) {
  const rank = new Map();
  templateSlots(template).forEach(({ slot }, position) => rank.set(slot.key, position));
  const last = rank.size;
  return zones
    .map((zone, discovered) => ({ zone, discovered }))
    .sort(
      (a, b) =>
        (rank.get(a.zone.key) ?? last) - (rank.get(b.zone.key) ?? last) ||
        a.discovered - b.discovered,
    )
    .map((entry) => entry.zone);
}

/**
 * Every fillable slot that still lacks a capture, as structured data.
 *
 * Structured, not a log line, because section 4 of the corrections note turns
 * "not found" into a decision the operator makes on the record: the caller
 * writes this to disk, and a later UI reads it to ask "is there a dokumen
 * tambahan for these?" and to offer manual zone selection for the ones the
 * operator answers no to. A validation document with an unexplained empty
 * cell is indistinguishable from one where the evidence does not exist.
 */
export function outstandingSlots(template, zones, reasons = new Map()) {
  const counts = new Map();
  for (const zone of zones) {
    counts.set(zone.key, (counts.get(zone.key) ?? 0) + 1);
  }

  const outstanding = [];
  for (const { section, slot } of templateSlots(template)) {
    if (!slot.fillable) continue;
    const found = counts.get(slot.key) ?? 0;
    const required = slotCropCount(slot);
    if (found >= required) continue;
    // A partly-filled slot leads with its count, not with the last round's
    // message. Measured on the two-round run: `kbLanjutan.top` held one of
    // its two captures from round 1, round 2 searched the tambahan and found
    // no second one, and the stored reason alone read "the model found no
    // match" -- which says, wrongly, that the slot is empty. The counts were
    // right beside it and the sentence still contradicted them.
    const partial = `${found} of ${required} captures found`;
    const last = reasons.get(slot.key);
    outstanding.push({
      kind: "slot",
      key: slot.key,
      label: slot.label,
      section: section.title,
      found,
      required,
      reason:
        found === 0
          ? (last ?? "searched, not found")
          : last
            ? `${partial}; the last search added none (${last})`
            : partial,
    });
  }
  return outstanding;
}

/** The default `conflictReason`: what a conflict means when the entry does not
 * say, which is `reconcileFieldValues`' own case. */
const DISAGREEING_DOCUMENTS_REASON =
  "found more than once and the answers disagree";

/**
 * Every xlsx row a PDF is supposed to back that came back without a value.
 *
 * Same argument as `outstandingSlots`, one deliverable over: a blank cell in
 * the workbook and a cell nobody tried to fill look identical to a reviewer.
 */
export function outstandingFields(template, values) {
  const filled = new Set(
    values
      .filter((value) => String(value.value ?? "").trim() !== "")
      .map((value) => value.fieldKey),
  );

  // A key blanked because two readings disagreed is outstanding for a reason
  // nobody could guess from "searched, not found". Naming both readings here
  // is what lets the operator settle it without rerunning the pipeline.
  //
  // There are two producers of a conflict and they mean different things:
  // `reconcileFieldValues` blanks a key two DOCUMENTS answered differently,
  // and `verifyCitedValues` blanks one whose crop re-read disagreed with the
  // page reading -- found once, read twice. The entry carries its own
  // `conflictReason` when it is not the first case, because printing "found
  // more than once" over the second one is a false statement beside a blank
  // cell, which the operator would act on and could not check.
  const conflicts = new Map(
    values
      .filter((value) => value.conflict?.length)
      .map((value) => [value.fieldKey, value]),
  );

  const outstanding = [];
  const seen = new Set();
  for (const row of template.xlsxRows) {
    if (!row.fieldKey || seen.has(row.fieldKey)) continue;
    seen.add(row.fieldKey);
    if (filled.has(row.fieldKey)) continue;
    const conflict = conflicts.get(row.fieldKey);
    outstanding.push({
      kind: "field",
      key: row.fieldKey,
      label: row.itemII ?? row.itemI ?? row.fieldKey,
      reason: NEVER_EXTRACTED.has(row.fieldKey)
        ? NEVER_EXTRACTED_REASON
        : conflict
          ? `${conflict.conflictReason ?? DISAGREEING_DOCUMENTS_REASON} (${conflict.conflict
              .map((value) => JSON.stringify(value))
              .join(" vs ")}); ships blank until the operator picks one`
          : "searched, not found",
    });
  }
  return outstanding;
}

/**
 * One search round: every unsatisfied slot, searched across every page this
 * round supplies.
 *
 * `locate` is injected -- `(slot, pool) => Promise<LocateResult|null>` -- so
 * the round's bookkeeping (what gets skipped, what is reported outstanding,
 * how a failure is recorded) is testable without a model credential. The CLI
 * passes an adapter over `locateSlot`.
 */
export async function searchRound({
  template,
  byType,
  pages,
  satisfied = new Set(),
  locate,
  log = () => {},
}) {
  /** @type {{ key: string, pageIndex: number, box: object, lineRange: number[] }[]} */
  const zones = [];
  /** @type {Map<string, string>} slot key -> why it came back empty */
  const reasons = new Map();

  for (const section of template.sections) {
    // `s.fillable` alone, not `s.fillable && s.docType`: docType is a ranking
    // preference now, and a slot without one is a slot with no preference,
    // not a slot to skip.
    const fillable = section.slots.filter((s) => s.fillable);

    if (section.layout === "images") {
      // Whole-page captures. No model call is made here at all -- see this
      // file's header comment for why that is the design and not a shortcut.
      // Consecutive slots in one section take consecutive pages of that
      // document, which is what "SP" and "SP (lanjutan)" mean.
      //
      // This branch is not a search, so there is no pool to widen: what it
      // needs is "which of these pages IS the Surat Penunjukan", which is the
      // question classify.ts answers, over every page of every supplied file.
      // Ranking cannot help here and would actively hurt -- taking an
      // arbitrary unclassified page when no page was classified as the wanted
      // type is precisely the plausible-wrong-evidence failure this project
      // is most afraid of. A slot with no candidate is reported outstanding
      // instead, which is what hands it to the tambahan loop.
      const byIndex = pagesByIndex(pages);
      const taken = new Map();
      for (const slot of fillable) {
        if (satisfied.has(slot.key)) continue;

        // `byType` is the whole run's classification, so this is filtered
        // back down to the pages THIS round supplied.
        const candidates = poolForDocTypes(
          slot.docType ? [slot.docType] : [],
          byType,
          byIndex,
        ).filter(Boolean);
        const position = taken.get(slot.docType) ?? 0;
        const page = candidates[position];

        if (!page) {
          reasons.set(
            slot.key,
            slot.docType
              ? `no ${slot.docType} page ${position} among the ${pages.length} pages searched`
              : "whole-page slot with no document type to identify its page",
          );
          continue;
        }
        // Advanced only on a real assignment, so a slot already filled by an
        // earlier round does not consume a page of THIS round's pool: when
        // round 1 filled sp.1 and left sp.2 outstanding, sp.2 must take the
        // first SP page the tambahan supplies, not its second.
        taken.set(slot.docType, position + 1);

        log(
          `  ${slot.key}: whole page ${page.index} ` +
            `(${sourceLabel(page)}), no model call`,
        );
        // THE RANGE IS WRITTEN FROM THE ARRAY LENGTH BUT READ BY LINE NUMBER,
        // which only agrees while `lines[k].i === k`. This script never calls
        // `assertLinesWellFormed`, and `boxForLineRange` -- which would throw
        // on the count -- is never called for a whole-page capture, so this
        // one comparison is the ONLY thing standing between a differently
        // numbered page and a citation that quietly names different text than
        // the picture above it shows. Same guard as `wholePageZone` in
        // src/app/api/propose/handler.ts.
        const last = page.lines.length - 1;
        if (last >= 0 && page.lines[last].i !== last) {
          throw new Error(
            `page ${page.index} (${sourceLabel(page)}) has its last line ` +
              `numbered ${page.lines[last].i}, not ${last}: a whole-page ` +
              "citation is written from the array length",
          );
        }
        zones.push({
          key: slot.key,
          pageIndex: page.index,
          box: { x: 0, y: 0, w: page.width, h: page.height },
          lineRange: [0, Math.max(0, last)],
        });
      }
      continue;
    }

    for (const slot of fillable) {
      if (satisfied.has(slot.key)) continue;

      const pool = rankedPool([slot.docType], byType, pages);
      if (pool.length === 0) {
        reasons.set(slot.key, "no pages were supplied to search");
        continue;
      }

      log(`  ${slot.key}: locating in ${pool.length} pages...`);

      // One slot's failure costs that slot, not the run. By this point the
      // pass has spent minutes of OCR and tens of thousands of tokens on the
      // slots that already succeeded, and the deliverable is a document the
      // operator finishes by hand anyway -- throwing away nine good crops
      // because the tenth call exhausted its retries is the wrong trade. The
      // slot is named in the outstanding report instead.
      let found;
      try {
        found = await locate(slot, pool, section);
      } catch (error) {
        log(`  ${slot.key}: FAILED -- ${error.message}`);
        reasons.set(slot.key, error.message);
        continue;
      }

      if (!found) {
        reasons.set(slot.key, "the model found no match");
        continue;
      }

      const [from, to] = found.zone.lineRange;
      log(
        `  ${slot.key}: page ${found.zone.pageIndex} lines ${from}-${to} ` +
          `(${found.confidence} confidence)`,
      );
      zones.push({
        key: slot.key,
        pageIndex: found.zone.pageIndex,
        box: found.zone.box,
        lineRange: found.zone.lineRange,
      });
    }
  }

  // Only this round's own zones and its own reasons. What is OUTSTANDING is
  // deliberately not computed here: it is a property of everything found so
  // far, not of one round, and a round that legitimately skipped a slot
  // another round already filled must not report it missing.
  return { zones, reasons };
}

// ---------------------------------------------------------------------------
// Pass 2: cut the crops. One page is rendered at a time and dropped before the
// next, so peak memory is a single page rather than all of them.
// ---------------------------------------------------------------------------

async function cutCrops(zones, pages, sources) {
  // Written back by position, not pushed, so the result keeps template order.
  // That order is the stacking order for a slot that holds more than one crop.
  const filled = new Array(zones.length);

  const byPage = new Map();
  zones.forEach((zone, position) => {
    const list = byPage.get(zone.pageIndex) ?? [];
    list.push({ zone, position });
    byPage.set(zone.pageIndex, list);
  });

  for (const pageIndex of [...byPage.keys()].sort((a, b) => a - b)) {
    const meta = pages[pageIndex];
    const page = await sources[meta.source].doc.getPage(meta.pageInDoc + 1);
    const rendered = await renderPageUpright(page, DEFAULT_DPI, nodeContext);

    for (const { zone, position } of byPage.get(pageIndex)) {
      const widthPx = Math.round(zone.box.w);
      const heightPx = Math.round(zone.box.h);
      // The dimensions the box was MEASURED against, which are not necessarily
      // the ones it is being applied to: `rendered` above is a PASS 2
      // re-render, while the zone was computed on pass 1's pixels or served
      // from the OCR cache. Both use DEFAULT_DPI today, so this agrees; the
      // point is that a DPI or `/Rotate` drift between the two passes would
      // otherwise produce a clean picture of a region nobody chose, with
      // nothing downstream able to tell.
      const png = await cropToPng(rendered, zone.box, {
        width: meta.width,
        height: meta.height,
      });
      filled[position] = { key: zone.key, png, widthPx, heightPx };
      console.log(
        `  ${zone.key}: page ${pageIndex}, ${widthPx}x${heightPx}px, ` +
          `${(png.length / 1024).toFixed(0)}KB`,
      );
    }
  }

  return filled;
}

// ---------------------------------------------------------------------------
// Text extraction for the xlsx and the docx header.
//
// HISTORY, because the shape here only makes sense with it. Each key's pool
// used to be narrowed twice over: to the pages the `layout: "images"`
// sections capture (the order paperwork -- BA Permintaan, SP, the email
// thread -- with the KB contract dropped outright), and then again per key by
// FIELD_DOC_TYPES. The second narrowing fixed a live defect: `cc` and
// `alamat` both name the customer, and offering the printed email thread let
// the model match the email's OWN "Cc:" header line instead of the customer
// named on the BA Permintaan, so both deliverables shipped a wrong customer.
//
// Both narrowings are gone (2026-08-31 corrections note, section 2): every
// key is now offered every page of every supplied document. FIELD_DOC_TYPES
// survives with the same entries and a different job -- it now RANKS a key's
// pages, putting its likeliest document first, and removes nothing. What
// stops the wrong-customer bug coming back is `Template.fieldHints`, which
// gives the model a definition of `cc` that rules out email headers and
// distribution lists explicitly. That is the note's resolution in one line:
// better disambiguation, not narrower pools.
//
// The cost is real and worth stating: three key groups times the whole
// bundle's OCR text, instead of three small pools. Grouping is kept anyway,
// because the groups now differ by ORDER and order is the only steer
// classification is still allowed to give.
//
// Each group's pool is renumbered 0..n-1 before being handed to the model
// and mapped back afterwards. extractFields numbers its listing by POSITION
// in what it was given, never by a page's true index (its own header comment
// documents the measured reason, the same one locate.ts documents): a
// citation's `pageIndex` is therefore that pool's position, not a
// bundle-global page number. remapCitedPageIndex maps it back to the page's
// true `.index` -- and drops the citation outright, rather than falling back
// to the raw local position, when the model cites a position the pool
// doesn't hold. A silent fallback there would write that local number into
// the workbook as if it were a true page number: a citation that looks valid
// and points at the wrong page.
// ---------------------------------------------------------------------------

/**
 * The docTypes a fieldKey's value is MOST LIKELY to sit in -- the pages put
 * at the front of its pool, never the only pages in it.
 *
 * The entries are unchanged from when this was a filter, and the name is kept
 * for the same reason; what changed is that `rankedPool` consumes it instead
 * of `poolForDocTypes`, so a key absent here simply gets an unranked pool
 * rather than a different (smaller) one. Every key sees every page either way.
 */
export const FIELD_DOC_TYPES = {
  cc: ["BAPermintaan"],
  alamat: ["BAPermintaan"],
  picContacts: ["Email"],
};

/** The docTypes every `layout: "images"` fillable slot captures -- the pages
 * a key with no FIELD_DOC_TYPES entry is shown first. */
export function orderPaperworkDocTypes(template) {
  const set = new Set();
  for (const section of template.sections) {
    if (section.layout !== "images") continue;
    for (const slot of section.slots) {
      if (slot.fillable && slot.docType) set.add(slot.docType);
    }
  }
  return [...set];
}

/**
 * The classified pages for a set of docTypes, ascending by global index. Pure
 * and side-effect free, so it is testable without a model call.
 */
export function poolForDocTypes(docTypes, byType, pages) {
  const wanted = new Set();
  for (const docType of docTypes) {
    for (const index of byType.get(docType) ?? []) wanted.add(index);
  }
  return [...wanted].sort((a, b) => a - b).map((i) => pages[i]);
}

/**
 * Maps a citation's pool POSITION back to that page's true document index.
 * Returns undefined -- drop the citation -- when the position is not one the
 * pool actually holds, instead of the old `pool[i]?.index ?? i` fallback,
 * which wrote the raw local position into the workbook as a bundle-global
 * page number whenever the model cited a position outside the pool.
 */
export function remapCitedPageIndex(poolPosition, pool) {
  return pool[poolPosition]?.index;
}

/**
 * Wraps an `ask` so the extraction prompt carries each key's definition.
 *
 * `extractFields` is handed bare key names and builds its prompt from them,
 * which makes "cc" the entire description of the field -- the thinnest hint
 * in the pipeline, and the one that lost to the printed email's own `Cc:`
 * header when the pool stopped being narrowed. The definitions live in
 * `Template.fieldHints`; this is how they reach the model.
 *
 * It PREPENDS rather than splicing into the prompt on purpose. The prompt is
 * `src/lib/pipeline/fields.ts`'s to build, and matching against its interior
 * ("insert after the `Fields:` line") would make this quietly stop working
 * the next time that file is reworded -- quietly, because the call would
 * still succeed and the model would still answer, just without the
 * disambiguation that keeps the customer name right.
 *
 * Returns `ask` unchanged when nothing is described, so a key with no entry
 * costs no wrapper and no prompt text.
 */
export function withFieldHints(ask, keys, fieldHints) {
  const described = keys.filter((key) => fieldHints?.[key]);
  if (described.length === 0) return ask;

  const block = [
    "FIELD DEFINITIONS. These define the fields requested below. Where a",
    "definition and the field's short name disagree, the definition wins, and",
    "text a definition rules out is not an acceptable answer even when it",
    "looks like a match.",
    ...described.map((key) => `  ${key}: ${fieldHints[key]}`),
    "",
  ].join("\n");

  return (prompt) => ask(`${block}\n${prompt}`);
}

/** Groups fieldKeys by the docType set that ranks their pool, so keys with the
 * same ranking cost one extraction call instead of one apiece. */
export function groupKeysByDocTypes(keys, defaultDocTypes) {
  const groups = new Map();
  for (const key of keys) {
    const docTypes = FIELD_DOC_TYPES[key] ?? defaultDocTypes;
    const signature = docTypes.join("|");
    const group = groups.get(signature);
    if (group) group.keys.push(key);
    else groups.set(signature, { docTypes, keys: [key] });
  }
  return [...groups.values()];
}

/**
 * Keys deliberately not sent to the model at all, whatever the template says.
 *
 * `namaProyek` is in this set and ships BLANK. It reaches the two most-read
 * cells in the deliverables -- the `NAMA Proyek :` cell in the docx header
 * table and its xlsx row -- and on the full pool it reliably answered with
 * the Surat Penunjukan's subject line: the master contract's scope title, not
 * this order's project name. That wrong value carried a citation that
 * *passed* validation, so it read as sourced evidence rather than a guess
 * (task-11 finding 3).
 *
 * IT WAS BRIEFLY RE-ENABLED and is reverted here. The case for re-enabling
 * was that `AO_TEMPLATE.fieldHints.namaProyek` now rules out the agreement
 * title and the appointment letter's subject by name, and one manual run on
 * the sample bundle showed it no longer answering with the master contract.
 * That same run recorded the answer as the request email's own subject line,
 * "not the wording the human-authored sample uses for the same field" -- by
 * its own account not the right value. A key whose best recorded evidence is
 * "differently wrong" does not clear the bar for a cell a validator signs.
 *
 * The bar for taking it back out of this set is a reproducible run that
 * yields the sample's own project name, not an argument that the hint is
 * better. Until then a blank invites the operator to fill it in, and a
 * plausible wrong value does not. `outstandingFields` reports it by name
 * with the reason below, so blank is never silent.
 */
export const NEVER_EXTRACTED = new Set(["namaProyek"]);

/** Why a NEVER_EXTRACTED key is blank, for the run's outstanding list. The
 * generic "searched, not found" would be a false statement about it: nothing
 * searched for it at all. */
const NEVER_EXTRACTED_REASON =
  "deliberately not extracted; the operator fills this in (see NEVER_EXTRACTED)";

/**
 * The backed xlsx keys a run actually asks the model for: every fieldKey the
 * template declares, minus `NEVER_EXTRACTED`. Exported so the exclusion is
 * testable end of chain rather than asserted about a Set nothing reads --
 * silently dropping this filter is exactly how the blank cell would turn back
 * into a plausible wrong one.
 */
export function extractableFieldKeys(template) {
  return [
    ...new Set(
      template.xlsxRows
        .map((row) => row.fieldKey)
        .filter((key) => key && !NEVER_EXTRACTED.has(key)),
    ),
  ];
}

/**
 * `askFn` is injected, defaulting to the real model, for the same reason
 * `searchRound` injects `locate`: it makes the whole wiring -- ranking,
 * grouping, hint prepending, citation remapping -- exercisable without a
 * credential. The wrong-customer regression lived in this wiring, not in
 * `extractFields`, so a test that composes the pieces itself would not have
 * caught it.
 *
 * THE RETURNED LIST HOLDS AT MOST ONE ENTRY PER fieldKey. This is the one
 * point where every answer to a key converges -- a model reply that cites the
 * same field twice, two key groups that both answer it, and the documents of
 * every round, since extraction runs once over the whole run's pages after
 * the last tambahan round rather than per round. `reconcileFieldValues` is
 * therefore applied here and nowhere else, and it is what makes two spellings
 * of one answer stop counting as a disagreement (`Bank Contoh Nusantara` and
 * `PT Bank Contoh Nusantara Tbk` are one answer, not two). Drop the call and
 * the duplicates come back, to be resolved by array order inside whichever
 * exporter builds its Map last.
 */
export async function extractTextFields(template, byType, pages, askFn = ask) {
  const keys = extractableFieldKeys(template);
  const defaultDocTypes = orderPaperworkDocTypes(template);

  const values = [];
  for (const group of groupKeysByDocTypes(keys, defaultDocTypes)) {
    // Every page, ranked -- see this section's header comment. `pages` is the
    // whole run's page list, so a key can be answered by a document that
    // arrived in a later round.
    const pool = rankedPool(group.docTypes, byType, pages);
    if (pool.length === 0) {
      console.log(`  no pages to search; skipping ${group.keys.join(", ")}`);
      continue;
    }

    console.log(
      `  extracting ${group.keys.join(", ")} from ${pool.length} pages ` +
        `(${group.docTypes.join("/")} first)...`,
    );

    const renumbered = pool.map((page, position) => ({ ...page, index: position }));
    const found = await extractFields(
      group.keys,
      renumbered,
      withFieldHints(askFn, group.keys, template.fieldHints),
    );

    for (const value of found) {
      if (!value.source) {
        values.push(value);
        continue;
      }
      // Same lookup remapCitedPageIndex makes internally, kept here too so
      // the xlsx note can name the page's own file and page number instead
      // of this run's bundle-global index (task-11 finding 2) -- that global
      // index sent a reviewer to the wrong document for every page after the
      // first source file.
      const page = pool[value.source.pageIndex];
      const pageIndex = remapCitedPageIndex(value.source.pageIndex, pool);
      values.push(
        pageIndex === undefined
          ? { fieldKey: value.fieldKey, value: value.value }
          : {
              ...value,
              source: {
                ...value.source,
                pageIndex,
                sourceName: page.sourceName,
                pageInDoc: page.pageInDoc,
              },
            },
      );
    }
  }

  return reconcileFieldValues(values);
}

// ---------------------------------------------------------------------------

function sourceLabel(page) {
  return `${page.sourceName} p${page.pageInDoc}`;
}

/**
 * Opens this round's PDFs, appends them to the run's source list and returns
 * the indexes it added. Append-only for the same reason `pages` is: a zone
 * remembers `pages[i].source`, so a later round must not renumber sources.
 */
async function openSources(paths, sources) {
  const added = [];
  for (const path of paths) {
    const bytes = new Uint8Array(await readFile(path));
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    // pdf.js takes ownership of the buffer it is given, so hash first.
    const doc = await getDocument({ data: bytes }).promise;
    added.push(sources.length);
    sources.push({ path, name: basename(path), hash, doc });
    console.log(`${basename(path)}: ${doc.numPages} pages`);
  }
  return added;
}

async function main() {
  const { rounds, outDir } = parseArgs(process.argv.slice(2));

  console.log(`Model:  ${MODEL_TARGET}`);
  // Named on every run, because which engine read the pixels is the first
  // thing anyone comparing two runs' crops needs to know, and the deliverables
  // themselves do not say.
  console.log(`OCR:    ${OCR_ENGINE} (cache tag ${OCR_ENGINE_TAG})`);
  console.log(`OCR cache: ${OCR_CACHE_PATH}${FORCE_FRESH ? " (bypassed)" : ""}`);
  console.log();

  const cache = await loadCache();
  /** Every source and page seen so far, across every round. Append-only. */
  const sources = [];
  const pages = [];
  /** @type {Map<string, number[]>} docType -> global page indexes, in order */
  const byType = new Map();
  /** Everything found so far. Rounds add to this; nothing removes from it. */
  let zones = [];
  /** @type {Map<string, string>} slot key -> the newest reason it came back empty */
  const reasons = new Map();
  const roundReports = [];

  for (const [roundIndex, paths] of rounds.entries()) {
    console.log("=".repeat(72));
    console.log(
      `ROUND ${roundIndex + 1} of ${rounds.length}` +
        (roundIndex === 0 ? " (initial bundle)" : " (dokumen tambahan)"),
    );
    console.log("=".repeat(72));

    const sourceIndexes = await openSources(paths, sources);
    console.log();

    console.log("OCR (cached pages are skipped)...");
    const roundPages = await ocrEveryPage(sources, sourceIndexes, cache, pages);
    console.log(
      `OCR complete: ${roundPages.length} new page(s), ${pages.length} in total.\n`,
    );

    console.log("Classifying...");
    await classifyEverything(sources, sourceIndexes, pages, byType);
    console.log();

    // Only what is still missing. Round 1 has nothing satisfied and so
    // searches every slot; a later round searches the new document for the
    // outstanding slots alone -- which is both what the operator asked for
    // ("search it for only the outstanding slots") and what keeps the cost of
    // a fourth document proportional to what it can still answer.
    const satisfied = satisfiedSlotKeys(AO_TEMPLATE, zones);
    if (satisfied.size > 0) {
      console.log(
        `Skipping ${satisfied.size} slot(s) an earlier round already filled.`,
      );
    }

    console.log("Planning zones...");
    const round = await searchRound({
      template: AO_TEMPLATE,
      byType,
      pages: roundPages,
      satisfied,
      locate: (slot, pool, section) =>
        locateSlot(slotSearchLabel(section, slot), slot.hint, pool, ask),
      log: (line) => console.log(line),
    });
    for (const [key, reason] of round.reasons) reasons.set(key, reason);
    zones = mergeZones(zones, round.zones, AO_TEMPLATE);

    const after = outstandingSlots(AO_TEMPLATE, zones, reasons);
    roundReports.push({
      round: roundIndex + 1,
      documents: paths.map((p) => basename(p)),
      pagesAdded: roundPages.length,
      filledThisRound: round.zones.map((zone) => zone.key),
      outstandingAfter: after.map((slot) => slot.key),
    });
    console.log(
      `\nAfter round ${roundIndex + 1}: ${zones.length} zone(s) found, ` +
        `${after.length} slot(s) outstanding.\n`,
    );
  }

  // Rounds can interleave, so put the zones back into template order before
  // cutting -- see inTemplateOrder for what depends on it.
  zones = inTemplateOrder(zones, AO_TEMPLATE);

  console.log("Cutting crops...");
  const filled = await cutCrops(zones, pages, sources);
  console.log();

  console.log("Extracting text fields...");
  // Same trade as a failed slot, one step later: the crops are already cut and
  // both files are written below, so a failure here costs the xlsx's values and
  // the docx's header text, not the run. It is said plainly in the summary.
  let values = [];
  let extractionError;
  try {
    values = await extractTextFields(AO_TEMPLATE, byType, pages);
  } catch (error) {
    console.warn(`  extraction FAILED -- ${error.message}`);
    extractionError = error.message;
  }

  // -------------------------------------------------------------------------
  // The crop-level second pass, between extraction and the exporters.
  //
  // Every value that carries a validated citation is re-read from a picture of
  // the very lines it cites, and a disagreement blanks the cell with both
  // readings recorded rather than picking a winner. The whole argument, the
  // probe numbers behind it, and -- read this part -- the plain statement that
  // it verifies VALUES AND NOT CROPS live in src/lib/pipeline/verify.ts. A
  // crop of the wrong region, re-read perfectly, agrees with itself; only
  // `pnpm measure:locate` catches that, and this pass never makes the gate
  // optional.
  //
  // It runs before the log loop below on purpose, so a cell blanked here is
  // reported by the same CONFLICT line as one blanked by reconciliation and
  // there is exactly one place a reader has to look for "why is this empty".
  // -------------------------------------------------------------------------
  /** @type {{ fieldKey: string, reason: string }[]} */
  let unverified = [];
  if (!VERIFY_VALUES) {
    console.log("Crop verification is OFF (GENERATE_VERIFY=0).\n");
  } else if (values.some((v) => v.source && !v.conflict?.length)) {
    console.log("Verifying cited values against a re-read of their crops...");
    const verified = await verifyCitedValues(values, pages, {
      // Pass 2's re-render, once per distinct cited page. `verifyCitedValues`
      // groups by page and holds one at a time, for the same reason the OCR
      // pass drops its pixels: 33MB of RGBA each.
      renderPage: async (pageIndex) => {
        const meta = pages[pageIndex];
        const page = await sources[meta.source].doc.getPage(meta.pageInDoc + 1);
        return await renderPageUpright(page, DEFAULT_DPI, nodeContext);
      },
      ask: (prompt, image, schema) => askImage(prompt, image, schema, "verify"),
      log: (line) => console.log(line),
    });
    values = verified.values;
    unverified = verified.report.unverified;
    console.log(
      `  ${verified.report.checked} checked, ${verified.report.agreed} agreed, ` +
        `${verified.report.disagreed} blanked on disagreement, ` +
        `${unverified.length} not verified`,
    );
    // Loud, per value. An unverified value ships exactly as it would have
    // before this pass existed -- an unreachable model is not evidence that a
    // value is wrong -- so the only thing standing between it and a validator
    // is this line and the summary count below.
    for (const entry of unverified) {
      console.warn(`  ${entry.fieldKey} NOT VERIFIED -- ${entry.reason}`);
    }
    console.log();
  }

  for (const value of values) {
    // A key two readings answered incompatibly ships blank with both readings
    // named, so the operator sees a decision that was NOT made rather than an
    // arbitrary winner. Two things produce that: reconcileFieldValues, when
    // two documents disagree, and verifyCitedValues, when a crop re-read
    // disagrees with the page reading. The entry says which.
    if (value.conflict?.length) {
      console.log(
        `  ${value.fieldKey} = "" -- CONFLICT (` +
          `${value.conflictReason ?? "found more than once and the answers disagree"}` +
          `) between ${value.conflict.map((v) => JSON.stringify(v)).join(" and ")}; ` +
          "shipping blank",
      );
      continue;
    }
    const cite = value.source
      ? ` [page ${value.source.pageIndex}, lines ${value.source.lineRange.join("-")}]`
      : " [no citation]";
    console.log(`  ${value.fieldKey} = ${JSON.stringify(value.value)}${cite}`);
  }
  // A value can arrive uncited either because the model never offered a
  // citation or because extractFields dropped one that failed validation (a
  // hallucinated page, a reversed range, a line the cited page doesn't have)
  // -- either way the operator should see the count, since an uncited value
  // in the xlsx has nothing to check it against.
  // A blanked conflict is not an uncited value -- it has nothing to cite --
  // and counting it as one would overstate how much of the workbook is
  // unchecked while understating the conflict, which was already reported
  // above on its own line.
  const shipped = values.filter((v) => !v.conflict?.length);
  const uncited = shipped.filter((v) => !v.source).length;
  if (uncited > 0) {
    console.log(`  ${uncited} of ${shipped.length} extracted value(s) carry no citation`);
  }
  console.log();

  const { idEpic, quote } = deriveIdsFromFilenames(sources.map((s) => s.name));
  // Safe as a Map only because `extractTextFields` reconciled the list first:
  // a Map keeps the LAST entry per key, so on a list that still held two
  // spellings of one answer this line would pick between them by array
  // position and say nothing about it.
  const byKey = new Map(values.map((v) => [v.fieldKey, v.value]));
  const header = {
    idEpic,
    namaProyek: byKey.get("namaProyek") ?? "",
    quote,
    cc: byKey.get("cc") ?? "",
    // Blank in the sample by design, and the operator picks the template, so
    // the template's own id is the honest answer for JENIS ORDER.
    order: "",
    jenisOrder: AO_TEMPLATE.id,
  };

  await mkdir(outDir, { recursive: true });
  const stem = idEpic || basename(rounds[0][0]).replace(/\.pdf$/i, "");
  const docxPath = join(outDir, `${stem}_DOKUMEN_VALIDASI.docx`);
  const xlsxPath = join(outDir, `${stem}_ORDER_Config.xlsx`);
  const reportPath = join(outDir, `${stem}_OUTSTANDING.json`);

  await writeFile(docxPath, await buildDocx(AO_TEMPLATE, header, filled));
  await writeFile(xlsxPath, await buildXlsx(AO_TEMPLATE, values));

  // The structured outstanding report. Section 4 of the corrections note
  // wants "not found" to be a decision the operator makes on the record
  // rather than a silent gap, and a log line scrolls away: this file is what
  // a later UI reads to ask "is there a dokumen tambahan for these?", and
  // what a resumed run reads to know which zones it already has.
  const slotsOutstanding = outstandingSlots(AO_TEMPLATE, zones, reasons);
  const fieldsOutstanding = outstandingFields(AO_TEMPLATE, values).map((field) =>
    extractionError ? { ...field, reason: extractionError } : field,
  );
  const report = {
    template: AO_TEMPLATE.id,
    generatedAt: new Date().toISOString(),
    documents: sources.map((source, index) => ({
      index,
      name: source.name,
      pages: source.doc.numPages,
    })),
    rounds: roundReports,
    zones: zones.map((zone) => ({
      key: zone.key,
      pageIndex: zone.pageIndex,
      sourceName: pages[zone.pageIndex].sourceName,
      pageInDoc: pages[zone.pageIndex].pageInDoc,
      lineRange: zone.lineRange,
      box: zone.box,
    })),
    outstanding: [...slotsOutstanding, ...fieldsOutstanding],
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("=".repeat(72));
  console.log(`docx: ${docxPath}`);
  console.log(`xlsx: ${xlsxPath}`);
  console.log(`outstanding: ${reportPath}`);
  console.log();
  console.log("Page numbers cited above and in the xlsx comments are this run's");
  console.log("global page numbers:");
  for (const [sourceIndex, source] of sources.entries()) {
    const own = pages.filter((p) => p.source === sourceIndex);
    console.log(
      `  ${own[0].index}-${own[own.length - 1].index}: ${source.name} pages ` +
        `0-${own.length - 1}`,
    );
  }
  console.log();
  console.log(`crops: ${filled.length} cut, ${values.length} text fields extracted`);
  if (unverified.length > 0) {
    // Repeated down here because the per-value warnings are thousands of lines
    // up by now, and "how much of this workbook was never checked" is a thing
    // the operator has to see before signing rather than scroll back for.
    console.log(
      `UNVERIFIED (${unverified.length}) -- shipped without a crop re-read: ` +
        unverified.map((entry) => entry.fieldKey).join(", "),
    );
  }

  if (report.outstanding.length > 0) {
    console.log(
      `OUTSTANDING (${report.outstanding.length}) -- each needs a dokumen tambahan ` +
        "or a manual zone selection:",
    );
    for (const item of report.outstanding) {
      console.log(`  - [${item.kind}] ${item.key} (${item.label}): ${item.reason}`);
    }
    console.log("Supply another document with --tambahan <file.pdf> to search it");
    console.log("for these alone; zones already found are kept.");
  } else {
    console.log("Nothing outstanding: every backed slot and field was filled.");
  }

  // Printed unconditionally, including the zeros, and the denominator is
  // printed with them. See `pagesChecked`: "0 short reads" over 0 checked pages
  // is a fully cached run saying nothing, and it used to read identically to a
  // clean one.
  console.log(
    `page completeness: ${pagesChecked} of ${pagesTotal} page(s) checked ` +
      `against their own ink (the rest came from the OCR cache or from ` +
      `tesseract, which this check does not cover), ${shortReads} short ` +
      `read(s), ${recoveredPages} page(s) recovered by a re-read`,
  );

  console.log(
    `cost: ${cost.calls} model calls, in=${cost.in} out=${cost.out} ` +
      `thoughts=${cost.thoughts} total=${cost.total}`,
  );
}

/** An argument mistake deserves the usage text, not a stack trace. */
const USAGE_ERRORS =
  /^(no PDF given|unknown option |--out needs|--tambahan needs|no such file: )/;

// Guarded so the test suite can import this file's pure helpers (e.g.
// poolForDocTypes, remapCitedPageIndex) without running the whole CLI --
// `main()` needs a PDF argument and a live model credential, neither of
// which a unit test has.
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error) => {
    if (USAGE_ERRORS.test(error.message)) {
      console.error(`\n${error.message}\n\n${USAGE}`);
    } else {
      console.error(`\n${MODEL_TARGET} pipeline failed:`);
      console.error(error);
    }
    process.exitCode = 1;
  });
}
