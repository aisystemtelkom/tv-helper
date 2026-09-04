/**
 * The end-to-end generator: scanned PDFs in, a DOKUMEN VALIDASI docx and an
 * EPIC order-config xlsx out. This is the whole pipeline in one command --
 * render, OCR, classify, locate, crop, extract, verify, export -- with no UI
 * and no browser involved.
 *
 *   pnpm generate <bundle>.pdf [more.pdf ...] [--tambahan extra.pdf]...
 *                 [--out dir] [--jenis-order MO]
 *
 * Everything it knows about the target document comes from
 * `src/lib/forms/template.ts`. This file is wiring, not policy -- with one
 * exception it should not grow a second of: the header's JENIS ORDER cell,
 * which is resolved here because it is a property of the ORDER rather than of
 * the template (see the JENIS ORDER section).
 *
 * Five things here are load-bearing and easy to "simplify" back into bugs:
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
 * 5. IT DETECTS A CONTINUATION AND DELIBERATELY DOES NOT CROP ONE. Any
 *    section can run past a page bottom, so after the zones are found every
 *    capture is tested -- free, no model call -- for whether it ends at the
 *    last content line of its page. What fires is REPORTED, in the log and in
 *    the outstanding JSON, never cropped: extent needs a model call whose
 *    measured error is a legible crop of the NEXT clause, and this script has
 *    no operator to reject one. The operator UI, which does, gets the extent
 *    half of `src/lib/pipeline/continuation.ts`. The two paths therefore
 *    produce different docx files from the same bundle on purpose.
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
  OCR_MODEL_ID,
  THINKING_LEVEL,
  chatModel,
  isTransient,
  ocrModel,
  providerOptions,
} from "../src/lib/model.ts";
// The cost ledger, and why a run prints a TABLE rather than one total. The
// flat `calls/in/out` line this replaces was true and useless: it could not
// say which stage spent the money, so the question "what should I change"
// was answered by arithmetic on a remembered per-image figure -- which was
// wrong about the dominant stage by an order of magnitude, in AGENTS.md, for
// weeks. See src/lib/cost.ts.
import {
  STAGES,
  VISION_LEDGER_MODEL,
  emptyLedger,
  formatLedger,
  record as recordSpend,
  recordPages,
} from "../src/lib/cost.ts";
import { createReplyCache, fingerprintFor } from "./reply-cache.mjs";
import { classifyPages } from "../src/lib/pipeline/classify.ts";
import {
  outstandingHeaderFields,
  resolveJenisOrder,
} from "../src/lib/pipeline/jenis-order.ts";
import {
  OCR_PROMPT_VERSION,
  ocrPageCompletely,
  ocrPageWithGemini,
} from "../src/lib/pipeline/gemini-ocr.ts";
import { deriveIdsFromFilenames } from "../src/lib/pipeline/fields.ts";
// THE EXTRACTION WIRING NOW LIVES IN src/lib/pipeline/extract.ts, and is
// re-exported below so this file's tests and callers still find it here. It
// moved because `/api/extract` needs exactly this and cannot import a script:
// a second copy of NEVER_EXTRACTED, of the pool ranking or of the hint
// prepending is a copy that can silently disagree with this one, which is a
// blank cell in one deliverable and a plausible wrong value in the other
// (2026-09-03 findings, section 4).
import {
  DISAGREEING_DOCUMENTS_REASON,
  FIELD_DOC_TYPES,
  NEVER_EXTRACTED,
  NEVER_EXTRACTED_REASON,
  extractTextFields as extractTextFieldsWith,
  extractableFieldKeys,
  groupKeysByDocTypes,
  orderPaperworkDocTypes,
  poolForDocTypes,
  rankedPoolForDocTypes,
  remapCitedPageIndex,
  withFieldHints,
} from "../src/lib/pipeline/extract.ts";

// ANSWERED_BY_REQUEST_REASON is deliberately NOT re-exported here. It is the
// reason /api/extract gives for a key it did not search because the request
// already answered it, and this script has no equivalent state: a
// request-answered key is simply filled and drops out of outstandingFields.
// Importing a shared constant and ignoring it reads as wiring somebody
// started, so the route stays its only consumer.
export {
  DISAGREEING_DOCUMENTS_REASON,
  FIELD_DOC_TYPES,
  NEVER_EXTRACTED,
  NEVER_EXTRACTED_REASON,
  extractableFieldKeys,
  groupKeysByDocTypes,
  orderPaperworkDocTypes,
  poolForDocTypes,
  rankedPoolForDocTypes,
  remapCitedPageIndex,
  withFieldHints,
};
import { locateSlot, locateSlots } from "../src/lib/pipeline/locate.ts";
import {
  VISION_FEATURE,
  VISION_LANGUAGE_HINTS,
  VISION_MAPPING_VERSION,
  ocrPageWithVision,
} from "../src/lib/pipeline/vision-ocr.ts";
import {
  VISION_PAGE_PRICE_USD,
  annotateImage,
  isTransientVisionError,
} from "../src/lib/vision.ts";
// Detection only. `findContinuations` in that module also proposes the
// continuation's extent with a cheap next-page call; this script deliberately
// does not import it. See `continuationChecks` for the measured reason.
import {
  checkForContinuation,
  runningFurniture,
} from "../src/lib/pipeline/continuation.ts";
import {
  orderRequestFieldValues,
  readOrderRequestBuffer,
} from "../src/lib/pipeline/order-request.ts";
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
if (
  OCR_ENGINE !== "tesseract" &&
  OCR_ENGINE !== "gemini" &&
  OCR_ENGINE !== "vision"
) {
  throw new Error(
    `OCR_ENGINE=${OCR_ENGINE} is not an engine. Use "vision" (Cloud Vision, ` +
      `per-word boxes, $1.50/1000 pages), "gemini" (a vision model per page) ` +
      `or "tesseract" (local, no credential).`,
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
    ? `gemini:${OCR_MODEL_ID}:${OCR_PROMPT_VERSION}`
    : OCR_ENGINE === "vision"
      ? // Vision has no prompt, but it very much has a CONVERSION, and the
        // cache is only hazard-free for a fixed one. See VISION_MAPPING_VERSION.
        `vision:${VISION_MAPPING_VERSION}`
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
  process.env.OCR_CONCURRENCY ?? (OCR_ENGINE === "tesseract" ? 1 : 4),
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
 * The same spending, attributed to the stage that did it.
 *
 * Kept ALONGSIDE the flat `cost` totals above rather than replacing them,
 * because the flat line is what a reader greps for and the two disagreeing
 * would be worse than either alone. `assertLedgerAgrees` at the end of the run
 * checks they add up, so a call site that records to one and not the other is
 * a failed run rather than a quietly understated bill.
 */
const ledger = emptyLedger();

/**
 * Rupiah per dollar, for the second column of the cost table.
 *
 * A CONVENIENCE FOR READING, NOT AN EXCHANGE RATE THIS SCRIPT WARRANTS. The
 * bill that prompted the cost work arrived in rupiah while every price on the
 * vendor's page is in dollars, and converting in one's head is how a factor of
 * ten goes missing. Env-tunable because it is stale the day it is written, and
 * printed with the figure so the reader can see which rate produced it.
 */
const IDR_PER_USD = Number(process.env.IDR_PER_USD ?? 16_500);

/**
 * A development affordance, off by default, and the default is the point.
 *
 * AGENTS.md's rule stands: `pnpm generate` does not cache model replies,
 * because a stale verdict served silently is worse than paying again. What
 * `GENERATE_CACHE_MODEL=1` buys is the re-run loop -- iterating on the
 * exporters, the geometry or the report while the same eight questions about
 * the same unchanged pages are re-asked and re-billed every time. The
 * fingerprint carries the model id, the thinking level and the output cap, so
 * changing any of those misses the cache by construction rather than serving
 * the previous model's answers under the new model's banner. That is a real
 * defect in the gate harness's own cache; see scripts/reply-cache.mjs.
 */
const replyCache = createReplyCache({
  path: join(tmpdir(), "tv-helper-generate-reply-cache.json"),
  enabled: process.env.GENERATE_CACHE_MODEL === "1",
  force: FORCE_FRESH,
  fingerprint: fingerprintFor({
    modelId: MODEL_ID,
    thinkingLevel: THINKING_LEVEL,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  }),
  log: (line) => console.log(line),
});

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

async function askOnce(prompt, stage = "locate") {
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
  recordSpend(ledger, stage, MODEL_ID, {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    thoughts,
    cachedInput: usage.inputTokenDetails?.cacheReadTokens ?? 0,
  });

  // Same line /api/chat logs, for the same reason: every request costs money
  // and thought tokens bill at the output rate.
  console.log(
    `    [generate ${stage}] ${MODEL_ID} in=${usage.inputTokens ?? "?"} ` +
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
    // The OCR binding for whole-page recognition, the reasoning binding for
    // the crop-level verification pass. See `ocrModel` in src/lib/model.ts:
    // verify exists to catch the whole-page pass confabulating small print,
    // so re-reading with the cheaper model would weaken the guard against
    // exactly the mistake the cheaper model is likeliest to make.
    model: label === "ocr" ? ocrModel() : chatModel(),
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
  // `label` is already exactly the stage name for both image callers -- "ocr"
  // for whole-page recognition and "verify" for the crop-level second pass --
  // which is why this needs no mapping table.
  recordSpend(ledger, label, label === "ocr" ? OCR_MODEL_ID : MODEL_ID, {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    thoughts,
    cachedInput: usage.inputTokenDetails?.cacheReadTokens ?? 0,
  });

  console.log(
    `    [generate ${label}] ${label === "ocr" ? OCR_MODEL_ID : MODEL_ID} ` +
      `in=${usage.inputTokens ?? "?"} ` +
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

/**
 * A text ask, tagged with the stage that made it.
 *
 * The stage reaches two places: the cost ledger, so a run can say which stage
 * spent what, and the reply cache's key, so two stages that happened to send
 * an identical prompt could never serve each other's answer. Defaulting to
 * "locate" keeps the bare `ask` used as an injected dependency working, and
 * locate is the honest default because it is the only stage that calls this
 * more than twice.
 */
function askFor(stage) {
  return async function ask(prompt) {
    return replyCache.reply(stage, prompt, () =>
      withRetries("text", () => askOnce(prompt, stage)),
    );
  };
}

/**
 * The unlabelled ask, kept because it is passed by reference in several places
 * and because `extractTextFields`' signature takes an `askFn`. Records as
 * "locate"; every caller that is NOT locate now passes its own.
 */
const ask = askFor("locate");

/** The `AskImage` every OCR call in this script is injected with. */
async function askImage(prompt, image, schema, label = "ocr") {
  return withRetries("OCR", () => askImageOnce(prompt, image, schema, label));
}

// ---------------------------------------------------------------------------
// Arguments.
// ---------------------------------------------------------------------------

const USAGE = `Usage: pnpm generate <bundle.pdf> [more.pdf ...] [--tambahan <extra.pdf>]...
                    [--out <dir>] [--jenis-order <AO|MO|DO|...>]
                    [--request <order-request.xlsx>] [--service <SID|n>]
                    [--template <Form_Validasi.template.docx>]

Writes <ID EPIC>_DOKUMEN_VALIDASI.docx, <ID EPIC>_ORDER_Config.xlsx and
<ID EPIC>_OUTSTANDING.json into <dir> (default: out/, which is gitignored).

--template patches the operator's own stripped Form Validasi instead of
building a document from scratch, and it is the better of the two outputs by a
wide margin. Measured against the two human samples (2026-09-03 findings,
section 3), the constructed path ships no word/header1.xml and so no DOKUMEN
VALIDASI banner, no theme1.xml, an empty <w:docDefaults> with no Normal style
so the samples' Calibri-at-12pt falls back to Word's own default, and no
TableGrid style so its tables have no borders where all thirteen tables across
the two samples do. Produce the template with

    pnpm make:docx-template <Form_Validasi.docx>

which writes <name>.template.docx and <name>.template.json side by side; pass
the .docx here and the .json is read from beside it. There is deliberately no
template in the repo: the two sample forms share three section names out of
eleven and twelve, so no single one fits both orders, and everything derived
from documents/ is client material that must never be committed.

--request supplies the ORDER REQUEST: row 1 type hints, row 2 headers, one row
per SID. It is read FIRST, deterministically, with no OCR and no model call,
and every key it answers is then REMOVED from what the scans are searched for.
That is the whole point of it -- of the thirty-one filled value cells measured
across the two sample bundles, twelve to thirteen come from the request and
zero to one from the contract scans (2026-09-03 findings, section 2), so
searching a 29-page contract for them was asking the wrong corpus.

--service picks one service out of a multi-SID request, by SID or by 1-based
row order. Without it, a field every service agrees on ships and a field they
disagree on ships BLANK with both readings named, exactly as two disagreeing
documents do -- never the first row silently.

--jenis-order (or JENIS_ORDER in the environment) sets the header's JENIS ORDER
cell. Without it the run reads the value off the order request or off a printed
JENIS ORDER label in the documents, and where neither answers it ships the cell
BLANK and names it in the outstanding report. It is never defaulted: the value
is a workflow verb (AO = Activation, MO = Modify, DO = Delete), not a property
of the template, and a guessed one gets signed.

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
  let jenisOrder;
  let requestPath;
  let service;
  let templatePath;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--template") {
      const value = argv[++i];
      if (!value) throw new Error("--template needs a docx");
      templatePath = resolve(value);
    } else if (arg === "--request") {
      const value = argv[++i];
      if (!value) throw new Error("--request needs an xlsx");
      requestPath = resolve(value);
    } else if (arg === "--service") {
      const value = argv[++i];
      // Same guard as --jenis-order and for the same reason: nothing
      // downstream checks a service selector against the filesystem, so
      // `--service --out dir` would otherwise look for a service called
      // "--out" and fail with a message about SIDs.
      if (!value || value.startsWith("--") || value.trim() === "") {
        throw new Error("--service needs a SID or a row number");
      }
      service = value.trim();
    } else if (arg === "--out") {
      const value = argv[++i];
      if (!value) throw new Error("--out needs a directory");
      outDir = resolve(value);
    } else if (arg === "--jenis-order") {
      const value = argv[++i];
      // A value that is itself an option is a typo, not an order type, and
      // unlike --out and --tambahan there is no filesystem check downstream to
      // catch it: `--jenis-order --out dir` would otherwise print "--out" in
      // the header cell and complete successfully.
      if (!value || value.startsWith("--") || value.trim() === "") {
        throw new Error("--jenis-order needs a value");
      }
      jenisOrder = value.trim();
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
  if (requestPath !== undefined && !existsSync(requestPath)) {
    throw new Error(`no such file: ${requestPath}`);
  }
  // Both halves checked HERE rather than at the export, which is thousands of
  // model tokens and several minutes downstream. A run that is going to fail
  // for want of a manifest should fail before it starts paying.
  if (templatePath !== undefined) {
    if (!existsSync(templatePath)) throw new Error(`no such file: ${templatePath}`);
    const manifestPath = manifestPathFor(templatePath);
    if (!existsSync(manifestPath)) {
      throw new Error(
        `--template needs its manifest beside it: no such file: ${manifestPath}. ` +
          "Both files come out of `pnpm make:docx-template`; pass " +
          "the .template.docx it wrote and leave the .template.json next to it.",
      );
    }
  }
  // A selector with no request to select from is a typo the operator wants to
  // hear about now, not a run that silently ignores half of what they asked
  // for and searches the scans for everything.
  if (service !== undefined && requestPath === undefined) {
    throw new Error("--service needs --request");
  }
  return { rounds, outDir, jenisOrder, requestPath, service, templatePath };
}

/**
 * The anchor manifest that belongs to a `.template.docx`.
 *
 * `make-docx-template.mjs` writes the pair `<name>.template.docx` and
 * `<name>.template.json` side by side, so the manifest is derived rather than
 * asked for: a second flag is a second thing to get wrong, and a manifest
 * from a DIFFERENT form's template pairs positionally with this one's rows
 * and puts every crop in a plausible wrong place -- which `buildPatches`
 * catches by label only where the labels happen to differ.
 */
export function manifestPathFor(templatePath) {
  return templatePath.replace(/\.docx$/i, "") + ".json";
}

/**
 * Reads the pair `--template` names. Returns `undefined` when no template was
 * given, which is the constructed-document path.
 */
async function loadDocxTemplate(templatePath) {
  if (templatePath === undefined) return undefined;
  const manifestPath = manifestPathFor(templatePath);
  const docx = new Uint8Array(await readFile(templatePath));
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `${manifestPath} is not readable JSON: ` +
        `${error instanceof Error ? error.message : String(error)}. Re-run ` +
        "`pnpm make:docx-template` against the source form.",
    );
  }
  return { docx, manifest };
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
 * One page through the Cloud Vision path.
 *
 * Reuses `ocrPageCompletely` -- the PNG encode, the ink row profile and the
 * completeness check are all engine-agnostic and cost nothing -- but with
 * `attempts: 1`. That ladder re-sends an IDENTICAL image up to three times,
 * which is a recovery strategy against a generative model whose own sampling
 * can make the second read differ. Vision is a deterministic recogniser: a
 * short read is a short read, and asking again spends a second page charge to
 * be told the same thing.
 *
 * Transport failures ARE retried, one level down, around the annotate call
 * itself -- see `isTransientVisionError`, which is deliberately narrower than
 * the Gemini path's because an INVALID_ARGUMENT or a PERMISSION_DENIED will be
 * the same verdict every time.
 */
async function ocrPageWithVisionEngine(rendered, sourceName, pageInDoc) {
  pagesChecked += 1;
  const label = `${sourceName} page ${pageInDoc}`;
  const { lines, report, image } = await ocrPageCompletely(
    rendered,
    (png) =>
      ocrPageWithVision(
        png,
        { width: rendered.width, height: rendered.height },
        (img) =>
          withVisionRetries(() =>
            annotateImage(img, {
              feature: VISION_FEATURE,
              languageHints: VISION_LANGUAGE_HINTS,
            }),
          ),
      ),
    { label, attempts: 1 },
  );

  // Billed per PAGE, not per token, which is the whole reason this stage is
  // cheaper. The ledger carries it as a page charge so a run still prints one
  // cost table rather than two accounting systems.
  recordPages(ledger, "ocr", VISION_LEDGER_MODEL, 1, VISION_PAGE_PRICE_USD);
  cost.calls += 1;

  console.log(
    `    [generate ocr] ${label}: ` +
      `${(image.bytes.length / 1024 / 1024).toFixed(2)}MB png, ` +
      `${report.blocks} blocks -> ${report.segments} words -> ${report.lines} lines ` +
      `(interpolated=${report.interpolatedLines}, dropped=${report.droppedEntries}, ` +
      `chars=${report.transcribedChars}, cover=${report.verticalCoverage.toFixed(3)})`,
  );
  if (report.degraded) {
    console.warn(
      `    [generate ocr] DEGRADED page: ${report.reasons.join("; ")}`,
    );
  }

  // `lines` alone, matching `ocrPageWithModel`. The caller stores this
  // directly as the page's `lines`, so returning the {lines, report} pair
  // instead lands an object where an array belongs and fails one stage later
  // at `p.lines.slice`, with 29 pages already paid for.
  return lines;
}

/**
 * Transport-only retries for a deterministic recogniser.
 *
 * Six attempts with the same backoff `withRetries` uses, but gated on
 * `isTransientVisionError` rather than the Gemini predicate: a refusal about
 * THIS image is a verdict, and re-sending it is a second charge for the same
 * answer.
 */
async function withVisionRetries(attempt) {
  const attempts = 6;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
      if (!isTransientVisionError(err) || i === attempts - 1) throw err;
      const backoffMs = Math.min(5000 * 2 ** i, 60_000);
      console.log(
        `    [vision] transient (${err.status ?? err.name}), retrying in ` +
          `${backoffMs}ms: ${err.message}`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError;
}

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
                : OCR_ENGINE === "vision"
                ? await ocrPageWithVisionEngine(rendered, source.name, pageInDoc)
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
    const spans = await classifyPages(heads, askFor("classify"));

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

// `rankedPool` used to be defined here. It is now
// `rankedPoolForDocTypes` in src/lib/pipeline/extract.ts, imported above --
// renamed because `/api/propose` has a `rankedPoolForSlot` that ranks for one
// SlotDef and takes its arguments in a different order, and two functions
// called `rankedPool` with different signatures is a mix-up that would not be
// a type error in a .mjs file.

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

/**
 * The slot keys that already have a capture, so a further round can skip them.
 *
 * ONE ZONE PER SLOT, and `slotCropCount` -- which used to read `SlotDef.crops`
 * and answer 2 for the ToP row -- is gone with the declaration it read. A
 * template cannot know how many pictures a slot needs: the sample's two ToP
 * pictures are one payment clause split by a page break, and on another
 * contract that clause fits one page or runs to three. What a slot needs is
 * one capture, plus whatever `src/lib/pipeline/continuation.ts` DISCOVERS
 * running on from it.
 */
export function satisfiedSlotKeys(template, zones) {
  const found = new Set(zones.map((zone) => zone.key));
  const satisfied = new Set();
  for (const { slot } of templateSlots(template)) {
    if (!slot.fillable) continue;
    if (found.has(slot.key)) satisfied.add(slot.key);
  }
  return satisfied;
}

/**
 * Round N's zones folded into everything found so far.
 *
 * ADDITIVE, in the corrections note's sense (section 4): every earlier zone
 * survives untouched, and a later round can only ever ADD -- fill a slot that
 * was empty. A later round never replaces an earlier zone for the same key, so
 * supplying one more document cannot cost the operator a zone they had already
 * accepted.
 *
 * The `template` argument is gone with `SlotDef.crops`. It was only ever used
 * to look up a per-slot cap, and the cap is now one: a slot takes one capture,
 * and a continuation is not something a later ROUND supplies. A continuation
 * lives on the page after its own block, in the same document, and is found by
 * walking forward from the capture -- not by handing the tool another file.
 */
export function mergeZones(previous, next) {
  const merged = [...previous];
  const filled = new Set(previous.map((zone) => zone.key));
  for (const zone of next) {
    if (filled.has(zone.key)) continue;
    filled.add(zone.key);
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
  const found = new Set(zones.map((zone) => zone.key));

  const outstanding = [];
  for (const { section, slot } of templateSlots(template)) {
    if (!slot.fillable) continue;
    if (found.has(slot.key)) continue;
    // `found` and `required` are gone from this entry along with
    // `SlotDef.crops`. They existed to say "1 of 2 captures found", which was
    // a sentence about a count the FORM declared -- the very assertion the
    // operator's report retired, since nothing ever searched for that second
    // capture. A slot here has no capture at all. A slot that HAS one and may
    // still run onto the next page is a different entry, `kind: "continuation"`
    // below, produced by a search that actually happened.
    outstanding.push({
      kind: "slot",
      key: slot.key,
      label: slot.label,
      section: section.title,
      reason: reasons.get(slot.key) ?? "searched, not found",
    });
  }
  return outstanding;
}

/**
 * Every capture that runs off the bottom of its page, and every one that was
 * checked and does not.
 *
 * ## Why `pnpm generate` gets detection and NOT extent
 *
 * `src/lib/pipeline/continuation.ts` can also propose the continuation's line
 * range, with one cheap model call per link (~760 input tokens, 3.8% of a
 * locate call). This script deliberately does not make that call.
 *
 * Measured, on the four field slots the geometric filter fires on in bundle
 * one: three answers correct, and `KB / Detail` answered `continues: true,
 * lines 2-10` for a range that is the NEXT clause's own heading. That is a
 * legible crop of a real clause belonging to a different slot -- plausible
 * wrong evidence under the right label, which is the failure this project is
 * organised against. In the operator UI that answer is a proposal with Terima
 * and Bukan ini beside it. Here there is no operator: this script already
 * writes its three files unreviewed, so an autofilled continuation would go
 * straight into a signed docx. It gets the honest half.
 *
 * ## And "we looked and found none" is reported too
 *
 * Dropping the declared count trades "asserts a capture that may not exist"
 * for "may silently miss one that does", and the only thing that closes that
 * is recording that the search HAPPENED. A capture nobody checked must never
 * read the same as one that was checked and is complete, so every zone gets an
 * entry here -- `looksLikeContinuation` true or false.
 */
export function continuationChecks(template, zones, pages, check) {
  const defs = new Map(
    templateSlots(template).map(({ section, slot }) => [slot.key, { section, slot }]),
  );

  const checked = [];
  for (const zone of zones) {
    const entry = defs.get(zone.key);
    if (!entry) continue;
    const page = pages[zone.pageIndex];
    const verdict = check(zone, entry.section, entry.slot, page);
    // Resolved through the run's own page list rather than off `nextPage`
    // itself: `checkForContinuation` deals in `OcrPage`, which carries an
    // index and no filename, and the page a human opens is named by its
    // SOURCE and its number inside that source. Deriving that from the
    // CURRENT page's `pageInDoc` is the off-by-one this project keeps paying
    // for -- see the xlsx cell-note gotcha in AGENTS.md.
    const next = verdict.nextPage ? pages[verdict.nextPage.index] : null;
    checked.push({
      key: zone.key,
      label: entry.slot.label,
      section: entry.section.title,
      pageIndex: zone.pageIndex,
      sourceName: page.sourceName,
      pageInDoc: page.pageInDoc,
      looksLikeContinuation: verdict.looksLikeContinuation,
      verdict: verdict.verdict,
      reason: verdict.reason,
      nextPageIndex: next ? next.index : null,
      nextSourceName: next ? next.sourceName : null,
      nextPageInDoc: next ? next.pageInDoc : null,
    });
  }
  return checked;
}

/**
 * Did the geometric test SAY anything about this capture?
 *
 * "It ran" and "it answered" are different, and conflating them is the
 * wrong-and-quiet shape `/api/propose`'s `continuationChecked` flag was fixed
 * for. Two of stage 1's declines carry no information at all:
 * `whole-page-capture` (such a capture ends at its page's last content line BY
 * CONSTRUCTION) and `no-content-line`, which the module declines rather than
 * guesses at. Four of this template's twelve captures are whole-page, so
 * reporting those as "checked, no lanjutan" would put the affirmative on a
 * third of the packet's evidence with nothing having looked.
 */
export function continuationAnswered(entry) {
  return (
    entry.looksLikeContinuation ||
    entry.verdict === "above-last-content" ||
    entry.verdict === "no-next-page"
  );
}

/**
 * The subset of `continuationChecks` that belongs in the outstanding report:
 * a capture that looks cut off, with no crop to show for it.
 */
export function outstandingContinuations(checks) {
  return checks
    .filter((entry) => entry.looksLikeContinuation)
    .map((entry) => ({
      kind: "continuation",
      key: entry.key,
      label: entry.label,
      section: entry.section,
      reason:
        `${entry.reason}. This run does not crop a lanjutan: the extent has to ` +
        `be confirmed, and run page ${entry.nextPageIndex} is where to look ` +
        // 1-based, because `pageInDoc` is 0-based and a PDF reader is not.
        `(${entry.nextSourceName}, page ${entry.nextPageInDoc + 1} of that file)`,
    }));
}

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
 * Every value that was READ but has nowhere in this form to land.
 *
 * `buildXlsx` keys the values it is handed by `fieldKey` and walks
 * `template.xlsxRows`, so a value whose key names no row is simply never
 * written. That drop was silent in all three places an operator looks:
 * `main()` logged it as `layanan = "..." [request C3 "Layanan"]`, which reads
 * exactly like a shipped cell; `report.orderRequest.answered` listed it; and
 * `outstandingFields` walks `template.xlsxRows`, so a key with no row can
 * never appear there. Measured on a nine-column request: seven values read,
 * ONE cell filled. The report asserted the other six were handled and the
 * workbook did not carry them -- the deliverable looking complete while
 * missing content, which is the failure this project is organised against.
 *
 * `AO_TEMPLATE` declares four fieldKey-bearing rows and
 * `REQUEST_COLUMN_FIELD_KEYS` maps sixteen columns, so the gap is structural
 * rather than incidental: the rows are item 5 of the 2026-09-03 findings and
 * are deliberately not this change's work. Until they land, a value with
 * nowhere to go is a REPORTED gap.
 *
 * Deliberately general rather than checking only the request's keys. A
 * model-extracted key cannot reach here today, because `extractableFieldKeys`
 * derives what to search for from the template's own rows -- but that is an
 * invariant somewhere else, and this costs one pass over a list to stop
 * depending on it.
 */
export function unmappedFieldValues(template, values) {
  const rowKeys = new Set(
    template.xlsxRows.map((row) => row.fieldKey).filter(Boolean),
  );
  const outstanding = [];
  const seen = new Set();
  for (const value of values) {
    // A blanked conflict has nothing to lose: it was never going to fill a
    // cell, and it is already reported on its own CONFLICT line.
    if (value.conflict?.length) continue;
    if (String(value.value ?? "").trim() === "") continue;
    if (rowKeys.has(value.fieldKey) || seen.has(value.fieldKey)) continue;
    seen.add(value.fieldKey);
    const from = value.requestSource
      ? `the order request (${value.requestSource.column}, ` +
        `"${value.requestSource.header}")`
      : "the documents";
    outstanding.push({
      kind: "unmapped",
      key: value.fieldKey,
      label: value.fieldKey,
      reason:
        `read from ${from} as ${JSON.stringify(value.value)}, but the ` +
        `"${template.id}" form has no xlsx row for it, so the workbook does ` +
        "not carry it. The value is here and in the run log; keying it needs " +
        "a row in the form's xlsxRows.",
    });
  }
  return outstanding;
}

/**
 * One call for the whole pool, falling back to one call per slot if it fails.
 *
 * ## Why the fallback exists at all
 *
 * Consolidating seven questions into one call gives away a property that one
 * call per slot had for free: a failure could only ever cost the slot that
 * caused it. `searchRound`'s own comment made the argument -- by the time
 * locate runs, the pass has spent minutes of OCR and tens of thousands of
 * tokens, and throwing away six good crops because the seventh question was
 * unlucky is the wrong trade.
 *
 * `locateSlots` already rebuilds that isolation for a bad ANSWER: a malformed
 * range or an invented page fails its own entry and no other. What it cannot
 * rebuild is a failure of the CALL -- a 503, a timeout, an unparseable reply --
 * because there is one call and it either answered or it did not. That is what
 * this handles: on a call-level failure the pool is re-asked slot by slot, at
 * the old cost, which is exactly the price that was being paid before.
 *
 * So the cost profile is: the cheap path when it works, the old path when it
 * does not, and never worse than the old path. The fallback is expected to be
 * rare -- `ask` already retries transients with backoff before it throws.
 *
 * IT DOES NOT FALL BACK ON A BAD ANSWER, only on a throw. A reply that came
 * back and answered five of seven is a real answer about those five; re-asking
 * all seven individually would spend six calls to re-derive what is already
 * known and would let the two genuinely-absent slots cost a call each to say
 * so again.
 */
async function locatePoolWithFallback(questions, pool, ask, log) {
  try {
    return await locateSlots(questions, pool, ask);
  } catch (error) {
    log(
      `  the one-call pool search failed (${error.message}); falling back to ` +
        `${questions.length} individual call(s), which costs what this run ` +
        "used to cost and no more",
    );
  }

  const out = new Map();
  for (const question of questions) {
    try {
      const result = await locateSlot(question.label, question.hint, pool, ask);
      out.set(question.key, { ok: true, result });
    } catch (error) {
      out.set(question.key, { ok: false, reason: error.message });
    }
  }
  return out;
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
  locatePool,
  log = () => {},
}) {
  /** @type {{ key: string, pageIndex: number, box: object, lineRange: number[] }[]} */
  const zones = [];
  /** @type {Map<string, string>} slot key -> why it came back empty */
  const reasons = new Map();
  /** Every unsatisfied fillable TABLE slot, across all sections, so they can
   *  be grouped by pool below rather than searched one at a time. */
  const tableSlots = [];

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

    // NOT SEARCHED HERE. Table slots are collected across every section first
    // and then searched by POOL, because slots that share a pool share a
    // model call -- see the loop below `sections` for why that is the whole
    // point. Collecting rather than searching in place is what lets
    // `kb.nomor` (section "KB") and `kbLanjutan.detail` (section
    // "KB (lanjutan)") land in the same call: they carry the same docType and
    // so the same pool, and a per-section loop could never see that.
    for (const slot of fillable) {
      if (satisfied.has(slot.key)) continue;
      tableSlots.push({ section, slot });
    }
  }

  // ---- table slots, grouped by the pool they would each have searched ----
  //
  // THE SAVING IS THE WHOLE REASON THIS IS NOT A LOOP OVER SLOTS. Every
  // fillable table slot in AO_TEMPLATE carries `docType: "KB"`, so all seven
  // searched the same 29 pages and each call re-uploaded the same ~23k-token
  // listing: 160.7k input tokens a run, of which about 138k was six redundant
  // copies. Grouped, it is one call and ~23k.
  //
  // It matters more as documents grow, which is why it is worth the
  // restructure: `locate` is the only stage whose cost scales with SLOTS TIMES
  // PAGES rather than with pages alone, so it is the line that fails first
  // when an order arrives with sixty pages instead of twenty-nine.
  const byPool = new Map();
  for (const entry of tableSlots) {
    // The pool is a function of `slot.docType` alone (see
    // `rankedPoolForDocTypes`), so the docType IS the group identity. `null`
    // is a real group -- a slot with no preference gets an unranked pool --
    // and must not collide with a docType literally named "null".
    const poolKey = entry.slot.docType ?? "(no docType)";
    const group = byPool.get(poolKey);
    if (group) group.push(entry);
    else byPool.set(poolKey, [entry]);
  }

  for (const [, group] of byPool) {
    const { slot: first } = group[0];
    const pool = rankedPoolForDocTypes([first.docType], byType, pages);
    if (pool.length === 0) {
      for (const { slot } of group) {
        reasons.set(slot.key, "no pages were supplied to search");
      }
      continue;
    }

    const questions = group.map(({ section, slot }) => ({
      key: slot.key,
      label: slotSearchLabel(section, slot),
      hint: slot.hint,
    }));

    log(
      `  ${questions.length} slot(s) in one call over ${pool.length} pages: ` +
        questions.map((q) => q.key).join(", "),
    );

    // ONE POOL'S FAILURE COSTS THAT POOL, not the run, and the caller is
    // expected to have already tried per-slot as a fallback -- see
    // `locatePoolWithFallback`. The original per-slot argument is unchanged
    // and is now carried one level up: by this point the pass has spent
    // minutes of OCR and tens of thousands of tokens on work that succeeded,
    // and the deliverable is a document the operator finishes by hand anyway.
    let outcomes;
    try {
      outcomes = await locatePool(questions, pool, group);
    } catch (error) {
      log(`  pool search FAILED -- ${error.message}`);
      for (const { slot } of group) reasons.set(slot.key, error.message);
      continue;
    }

    for (const { slot } of group) {
      const outcome = outcomes.get(slot.key);
      // A caller that answers short is a bug in the caller, not a silent
      // absence: every requested key gets an outcome or the slot is reported
      // missing by name.
      if (!outcome) {
        reasons.set(slot.key, "the search returned no outcome for this slot");
        continue;
      }
      if (!outcome.ok) {
        log(`  ${slot.key}: ${outcome.reason}`);
        reasons.set(slot.key, outcome.reason);
        continue;
      }
      const found = outcome.result;
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

// FIELD_DOC_TYPES, orderPaperworkDocTypes, poolForDocTypes,
// remapCitedPageIndex, withFieldHints, groupKeysByDocTypes, NEVER_EXTRACTED
// and extractableFieldKeys all used to be defined here. They are now
// src/lib/pipeline/extract.ts, imported and re-exported at the top of this
// file, because `/api/extract` runs the identical wiring and a server route
// cannot import a script. Everything the history above records still applies
// to them; the comments moved with the code.

/**
 * `extractTextFields`, with this script's model call and this script's log.
 *
 * The body is `src/lib/pipeline/extract.ts`'s, shared with `/api/extract`.
 * This wrapper exists only to keep the CLI's positional signature (which
 * `scripts/test-pipeline.mjs` calls) and to bind the two things a shared
 * module must not know: which `ask` reaches the model, and where progress is
 * printed.
 */
export async function extractTextFields(
  template,
  byType,
  pages,
  askFn = ask,
  answered = new Set(),
) {
  return extractTextFieldsWith({
    template,
    byType,
    pages,
    ask: askFn,
    answered,
    log: (message) => console.log(message),
  });
}

// ---------------------------------------------------------------------------
// JENIS ORDER lives in src/lib/pipeline/jenis-order.ts.
//
// It moved there so the OPERATOR UI can call it: everything it does is pure,
// and a browser filling its JENIS ORDER field honestly is strictly better
// than one defaulting it. The CLI keeps the half that is genuinely its own --
// reading `--jenis-order` and the `JENIS_ORDER` environment variable -- and
// passes both in. See that module's header for the nine spellings the
// inference used to answer wrongly, including a blank printed option menu
// read as a confident AO.
// ---------------------------------------------------------------------------

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
  const {
    rounds,
    outDir,
    jenisOrder: jenisOrderFlag,
    requestPath,
    service,
    templatePath,
  } = parseArgs(process.argv.slice(2));

  // Read here, before a single page is rendered, for the same reason the order
  // request is: a template whose manifest is unreadable or whose sections do
  // not correspond to this form is a five-second fix, and finding that out at
  // the export step costs the whole run's OCR and model spend. `buildDocx`
  // checks the correspondence itself; this only proves the two files exist and
  // parse.
  const docxTemplate = await loadDocxTemplate(templatePath);

  console.log(`Model:  ${MODEL_TARGET}`);
  // Which of the two document paths this run takes, said out loud. The
  // constructed one is missing the header banner, the theme, the Normal style
  // and every table border (2026-09-03 findings, section 3), and the file it
  // produces does not say so.
  console.log(
    docxTemplate
      ? `docx:   patching ${basename(templatePath)}`
      : "docx:   constructed from the form (no --template; no header, theme, " +
          "Normal style or table borders)",
  );
  // Named on every run, because which engine read the pixels is the first
  // thing anyone comparing two runs' crops needs to know, and the deliverables
  // themselves do not say.
  console.log(`OCR:    ${OCR_ENGINE} (cache tag ${OCR_ENGINE_TAG})`);
  console.log(`OCR cache: ${OCR_CACHE_PATH}${FORCE_FRESH ? " (bypassed)" : ""}`);
  console.log();

  // -------------------------------------------------------------------------
  // THE ORDER REQUEST, READ FIRST AND READ DETERMINISTICALLY.
  //
  // Before the PDFs are even opened, for two separate reasons. It is the input
  // that answers most of the workbook -- twelve to thirteen of thirty-one
  // filled value cells across the two sample bundles, against zero to one from
  // the contract scans (2026-09-03 findings, section 2) -- and it is the only
  // input that can be wrong in a way a human fixes in five seconds. A
  // malformed request that surfaces after twenty minutes of OCR costs the
  // whole run; the same error thrown here costs nothing.
  //
  // Nothing in this block reaches the model, the network or a credential. That
  // is the property that makes the request worth preferring over a search:
  // a value here was READ OUT OF A CELL, not inferred from a picture of one.
  // -------------------------------------------------------------------------
  /** @type {import("../src/lib/pipeline/order-request.ts").OrderRequest | null} */
  let orderRequest = null;
  /** @type {import("../src/lib/pipeline/fields.ts").FieldValue[]} */
  let requestValues = [];
  if (requestPath) {
    orderRequest = await readOrderRequestBuffer(
      new Uint8Array(await readFile(requestPath)),
      basename(requestPath),
    );
    requestValues = orderRequestFieldValues(orderRequest, { service });

    console.log(
      `Order request: ${orderRequest.file} sheet "${orderRequest.sheet}", ` +
        `${orderRequest.services.length} service(s)` +
        (service ? `, --service ${service}` : ""),
    );
    for (const entry of orderRequest.services) {
      console.log(`  row ${entry.row}: SID ${entry.sid || "(none printed)"}`);
    }
    for (const value of requestValues) {
      if (value.conflict?.length) {
        console.log(
          `  ${value.fieldKey} = "" -- CONFLICT (${value.conflictReason}) between ` +
            value.conflict.map((v) => JSON.stringify(v)).join(" and "),
        );
        continue;
      }
      const where = value.requestSource;
      console.log(
        `  ${value.fieldKey} = ${JSON.stringify(value.value)} ` +
          `[${where.column}${where.rows.join("/")} ${JSON.stringify(where.header)}]`,
      );
    }
    // Reported, never silently dropped. A column this reader has no field key
    // for is either a layout it does not understand or a field the client
    // added, and both are things a human has to see -- an order request that
    // quietly contributes half of what it holds looks exactly like one that
    // contributed all of it.
    for (const column of orderRequest.unmapped) {
      console.warn(
        `  column ${column.column} ${JSON.stringify(column.header)} NOT READ: ${column.reason}`,
      );
    }
    if (orderRequest.jenisOrderReadings.length > 1) {
      console.warn(
        `  the request's services disagree on the order type ` +
          `(${orderRequest.jenisOrderReadings.join(" vs ")}); the JENIS ORDER ` +
          "cell falls through to the documents and then to blank",
      );
    }
    console.log();
  } else {
    // Said out loud, because the alternative reads identically to a run where
    // the request answered nothing. Bundle one legitimately has no request
    // file -- its request arrived as an email that is already a page of the
    // scan -- and that is a different situation from an operator forgetting
    // the flag.
    console.log(
      "Order request: none supplied (--request). Every backed key will be " +
        "searched for in the scans.\n",
    );
  }

  /**
   * The keys the request already answered, INCLUDING the ones it answered with
   * a blank because its services disagreed. A disagreement is still an answer:
   * the request is the authority for that field, and a scan search could only
   * ever supply one of the two readings without knowing there was a second.
   */
  const answeredByRequest = new Set(requestValues.map((value) => value.fieldKey));

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
      locatePool: (questions, pool) =>
        locatePoolWithFallback(questions, pool, ask, (line) => console.log(line)),
      log: (line) => console.log(line),
    });
    for (const [key, reason] of round.reasons) reasons.set(key, reason);
    zones = mergeZones(zones, round.zones);

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

  // -------------------------------------------------------------------------
  // Does any capture run off the bottom of its page?
  //
  // Free: no model call is made here at all. The furniture detector and the
  // geometric test are both pure functions of OCR text that is already in
  // memory, so this block costs a pass over the lines and nothing else.
  //
  // Scoped PER SOURCE DOCUMENT, which is what stops a chain crossing a file
  // boundary: the last page of the merged contract scan is not continued by
  // the first page of a separate SPLITBA scan, however adjacent their global
  // page numbers are. Pooling furniture per document matters for the same
  // reason -- pooled that way the 2-page SPLITBA correctly gets no footer
  // lines, where a run-wide pool would blur two documents' furniture together.
  // -------------------------------------------------------------------------
  console.log("Checking each capture for a lanjutan (continuation)...");
  /** @type {Map<number, object[]>} source index -> its pages, in page order */
  const documentPages = new Map();
  for (const page of pages) {
    const own = documentPages.get(page.source);
    if (own) own.push(page);
    else documentPages.set(page.source, [page]);
  }
  const furnitureBySource = new Map(
    [...documentPages].map(([sourceIndex, own]) => [
      sourceIndex,
      runningFurniture(own),
    ]),
  );
  const checks = continuationChecks(
    AO_TEMPLATE,
    zones,
    pages,
    (zone, section, _slot, page) =>
      checkForContinuation({
        zone,
        documentPages: documentPages.get(page.source),
        furniture: furnitureBySource.get(page.source),
        // The one thing that must not be defaulted. A whole-page capture ends
        // at its page's last content line BY CONSTRUCTION, so the test says
        // nothing about it -- three of the six false positives measured on
        // bundle one were exactly that.
        wholePageCapture: section.layout === "images",
      }),
  );
  // "CHECKED" MEANS THE TEST ANSWERED, NOT MERELY THAT IT RAN. Two of stage
  // 1's declines are non-answers: `whole-page-capture` (such a capture ends at
  // its page's last content line BY CONSTRUCTION, so the geometry says nothing
  // about it) and `no-content-line`. Printing those as "checked, no lanjutan"
  // is the same wrong-and-quiet `/api/propose`'s `continuationChecked` flag
  // was fixed for, and four of this template's twelve captures are whole-page.
  for (const entry of checks) {
    console.log(
      entry.looksLikeContinuation
        ? `  ${entry.key}: LANJUTAN LIKELY -- ${entry.reason}`
        : continuationAnswered(entry)
          ? `  ${entry.key}: checked, no lanjutan -- ${entry.reason}`
          : `  ${entry.key}: NOT CHECKED for a lanjutan -- ${entry.reason}`,
    );
  }
  const likely = checks.filter((entry) => entry.looksLikeContinuation).length;
  const unanswered = checks.filter(
    (entry) => !continuationAnswered(entry),
  ).length;
  // All three counted out loud. "0 of 12 look cut off" and "nothing was
  // checked" read identically otherwise, and an unchecked capture must never
  // look like a complete one.
  console.log(
    `  ${checks.length} capture(s) tested, ${likely} that may run onto the ` +
      `next page, ${unanswered} the test cannot say anything about` +
      (likely > 0
        ? ". None is cropped: each is in the outstanding report, naming the " +
          "page to look at.\n"
        : ".\n"),
  );

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
    values = await extractTextFields(
      AO_TEMPLATE,
      byType,
      pages,
      askFor("extract"),
      answeredByRequest,
    );
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

  // -------------------------------------------------------------------------
  // The request's answers join the run's values HERE, after verification, and
  // the position is load-bearing rather than incidental.
  //
  // `verifyCitedValues` re-reads a value from a picture of the lines it cites
  // and reports anything it cannot check in `report.unverified`, which the
  // summary prints as "shipped without a crop re-read". A request-supplied
  // value has no citation and no crop -- there is no page it came from -- so
  // passing it through that pass would add it to the UNVERIFIED list and tell
  // the operator that a value read straight out of a spreadsheet cell went
  // unchecked. That sentence is false, it appears in the one place the
  // operator is asked to judge how much of the workbook to trust, and it would
  // grow with every field the request answers, which is the direction this
  // whole change is pushing. Merging after the pass is what keeps it honest.
  //
  // The two lists cannot collide: `answeredByRequest` removed every key here
  // from what the model was asked for, so `values` holds no key `requestValues`
  // holds and no reconciliation is needed or possible. ASSERTED rather than
  // only stated, and the request goes LAST: every consumer (`buildXlsx`, the
  // `byKey` map the docx header is built from) keys these into a Map, which
  // keeps the LAST entry, so on a collision the model's guess would beat the
  // spreadsheet cell the paragraph above says is authoritative. Spreading the
  // request last makes the order and the stated authority agree whatever
  // happens upstream, and the assertion makes a collision a crash instead of
  // a silently-preferred value.
  // -------------------------------------------------------------------------
  const requestKeys = new Set(requestValues.map((value) => value.fieldKey));
  const collided = values
    .map((value) => value.fieldKey)
    .filter((key) => requestKeys.has(key));
  if (collided.length > 0) {
    throw new Error(
      `${collided.length} field(s) were answered by BOTH the order request ` +
        `and the document search: ${[...new Set(collided)].join(", ")}. ` +
        "`answeredByRequest` is supposed to remove every request-answered key " +
        "from what the model is asked for; one of the two lists is being built " +
        "from the wrong set of keys.",
    );
  }
  values = [...values, ...requestValues];

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
    // Where the value came from, said on the same line as the value. With two
    // input paths in the run this is no longer decoration: "which of these
    // cells did a model find in a scan, and which were read out of the
    // request" is the first thing an operator needs in order to know where to
    // look when one is wrong.
    const cite = value.source
      ? ` [page ${value.source.pageIndex}, lines ${value.source.lineRange.join("-")}]`
      : value.requestSource
        ? ` [request ${value.requestSource.column}${value.requestSource.rows.join("/")}]`
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
  // A request-supplied value is NOT uncited: `requestSource` names the file,
  // sheet, column and rows it was read from, and that note reaches the
  // workbook exactly as a citation does. Counting it here would report the
  // deterministic half of the run as the unchecked half.
  const shipped = values.filter((v) => !v.conflict?.length);
  const uncited = shipped.filter((v) => !v.source && !v.requestSource).length;
  if (uncited > 0) {
    console.log(`  ${uncited} of ${shipped.length} extracted value(s) carry no citation`);
  }

  // Warned per key, right under the value lines that look like shipped cells,
  // because that is where the misreading happens: `layanan = "..." [request
  // C3]` and a workbook with no layanan row read identically until now. See
  // `unmappedFieldValues`.
  const unmapped = unmappedFieldValues(AO_TEMPLATE, values);
  for (const entry of unmapped) {
    console.warn(
      `  ${entry.key} NOT IN THE WORKBOOK -- the "${AO_TEMPLATE.id}" form has ` +
        "no xlsx row for it; the value above goes nowhere",
    );
  }
  console.log();

  // `orderRequest` was parsed at the top of this function -- see the block
  // there. `resolveJenisOrder` reads only its `jenisOrder`, which is a plain
  // string and is blank whenever the request's services disagree, so a
  // disagreement falls through to the documents and then to a reported blank
  // rather than picking one of them.
  const jenisOrder = resolveJenisOrder({
    flag: jenisOrderFlag,
    env: process.env.JENIS_ORDER,
    orderRequest,
    pages,
  });
  // Printed on every run, blank included, because the header cell itself
  // cannot say where its value came from and this is the only place an
  // operator can see the difference between "told" and "inferred".
  console.log(
    `JENIS ORDER: ${jenisOrder.value === "" ? "(blank)" : jenisOrder.value} ` +
      `-- ${jenisOrder.detail}\n`,
  );

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
    // Blank in the sample by design.
    order: "",
    // Never the template's id. See the JENIS ORDER section above for why that
    // was wrong and what answers it now.
    jenisOrder: jenisOrder.value,
  };

  await mkdir(outDir, { recursive: true });
  const stem = idEpic || basename(rounds[0][0]).replace(/\.pdf$/i, "");
  const docxPath = join(outDir, `${stem}_DOKUMEN_VALIDASI.docx`);
  const xlsxPath = join(outDir, `${stem}_ORDER_Config.xlsx`);
  const reportPath = join(outDir, `${stem}_OUTSTANDING.json`);

  await writeFile(docxPath, await buildDocx(AO_TEMPLATE, header, filled, docxTemplate));
  await writeFile(xlsxPath, await buildXlsx(AO_TEMPLATE, values));

  // The structured outstanding report. Section 4 of the corrections note
  // wants "not found" to be a decision the operator makes on the record
  // rather than a silent gap, and a log line scrolls away: this file is what
  // a later UI reads to ask "is there a dokumen tambahan for these?", and
  // what a resumed run reads to know which zones it already has.
  const unmappedKeys = new Set(unmapped.map((entry) => entry.key));
  const slotsOutstanding = outstandingSlots(AO_TEMPLATE, zones, reasons);
  const fieldsOutstanding = outstandingFields(AO_TEMPLATE, values).map((field) =>
    extractionError ? { ...field, reason: extractionError } : field,
  );
  const report = {
    template: AO_TEMPLATE.id,
    generatedAt: new Date().toISOString(),
    // On the record even when it WAS resolved, because "AO" in the header is
    // no longer self-explanatory: it now means one of four different things
    // depending on who supplied it, and only this line says which.
    jenisOrder,
    // On the record because the report is what a later UI and a resumed run
    // read, and "which values did a model find and which were read out of a
    // spreadsheet" is not recoverable from the values alone. `unmapped` is
    // here for the same reason it is warned about in the log: a column nobody
    // has mapped yet is a standing gap, and a gap only in a scrolled-away log
    // line is a gap nobody acts on.
    orderRequest: orderRequest
      ? {
          file: orderRequest.file,
          sheet: orderRequest.sheet,
          service: service ?? null,
          services: orderRequest.services.map((entry) => ({
            row: entry.row,
            sid: entry.sid,
          })),
          // `answered` used to hold every key the request produced, including
          // the ones no xlsx row can carry, so the report asserted a field was
          // handled while the workbook had no such cell. Split, because those
          // are two different facts an operator acts on differently: one is
          // done, the other needs a row in the form.
          answered: requestValues
            .filter((value) => !value.conflict?.length)
            .map((value) => value.fieldKey)
            .filter((key) => !unmappedKeys.has(key)),
          dropped: requestValues
            .filter((value) => unmappedKeys.has(value.fieldKey))
            .map((value) => value.fieldKey),
          // Unmapped COLUMNS -- a header this reader has never seen -- which
          // is a different gap from `dropped` above: that one is a column we
          // read fine and have nowhere to put.
          unmapped: orderRequest.unmapped,
        }
      : null,
    documents: sources.map((source, index) => ({
      index,
      name: source.name,
      pages: source.doc.numPages,
    })),
    rounds: roundReports,
    zones: zones.map((zone) => {
      const checked = checks.find((entry) => entry.key === zone.key);
      return {
        key: zone.key,
        pageIndex: zone.pageIndex,
        sourceName: pages[zone.pageIndex].sourceName,
        pageInDoc: pages[zone.pageIndex].pageInDoc,
        lineRange: zone.lineRange,
        box: zone.box,
        // The checked-for-continuation stamp, on every zone including the ones
        // that came back "no". Without it a capture nobody looked at reads
        // exactly like a capture that was looked at and is complete, which is
        // the failure this half of the change introduces if it is skipped.
        continuation: checked
          ? {
              // Whether the test ANSWERED, not merely whether it ran: see
              // `continuationAnswered`. A whole-page capture reaches here
              // declined and unexamined, and `checked: true` on it would read
              // as "looked at, and complete".
              checked: continuationAnswered(checked),
              looksLikeContinuation: checked.looksLikeContinuation,
              verdict: checked.verdict,
              reason: checked.reason,
              nextPageIndex: checked.nextPageIndex,
            }
          : { checked: false },
      };
    }),
    outstanding: [
      ...slotsOutstanding,
      // A capture that runs off the bottom of its page is outstanding in the
      // same sense the others are: something the operator has to finish by
      // hand before the packet is complete.
      ...outstandingContinuations(checks),
      ...fieldsOutstanding,
      ...outstandingHeaderFields(jenisOrder),
      // A value that was read and has nowhere to land is outstanding in the
      // same sense the others are: something the operator has to do by hand
      // before the workbook is complete. A gap only in a scrolled-away log
      // line is a gap nobody acts on.
      ...unmapped,
    ],
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
      `OUTSTANDING (${report.outstanding.length}) -- each needs a dokumen tambahan, ` +
        "a manual zone selection, a look at the named next page (for a " +
        "[continuation] item), a flag (for a [header] item), or a row in " +
        "the form (for an [unmapped] one):",
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

  // THE TWO ACCOUNTINGS MUST AGREE, and this checks rather than trusting.
  // Every call site records to both the flat totals and the ledger, so a new
  // call site that records to one and forgets the other would otherwise
  // produce a per-stage table that silently omits it -- an understated bill
  // presented as an attributed one, which is worse than the flat line this
  // replaced. A mismatch is printed loudly and does not fail the run: the
  // deliverables are already written by this point, and a bookkeeping bug is
  // not a reason to withhold them.
  const attributed = STAGES.reduce(
    (acc, stage) => ({
      calls: acc.calls + ledger.stages[stage].calls,
      in: acc.in + ledger.stages[stage].input,
      out: acc.out + ledger.stages[stage].output,
    }),
    { calls: 0, in: 0, out: 0 },
  );
  if (
    attributed.calls !== cost.calls ||
    attributed.in !== cost.in ||
    attributed.out !== cost.out
  ) {
    console.warn(
      `  WARNING: the per-stage ledger does not match the flat totals ` +
        `(ledger ${attributed.calls} calls / in ${attributed.in} / out ` +
        `${attributed.out}, flat ${cost.calls} / ${cost.in} / ${cost.out}). ` +
        "A call site is recording to one and not the other; the table below " +
        "is incomplete.",
    );
  }

  console.log();
  console.log(formatLedger(ledger, { idrPerUsd: IDR_PER_USD }));
  console.log();
  console.log(replyCache.summary());
}

/**
 * An argument mistake deserves the usage text, not a stack trace.
 *
 * `has no service ` is matched on a substring rather than an anchor because
 * `selectServices` throws `<file> has no service "1234". It lists 2: ...` --
 * a good message, thrown before the PDFs are opened, that fell through to the
 * `pipeline failed:` branch and reached the operator as a console.error dump
 * of an Error object. A typo in a SID is the single likeliest --service
 * mistake and it was the one presented as a crash.
 */
const USAGE_ERRORS =
  /^(no PDF given|unknown option |--out needs|--tambahan needs|--jenis-order needs|--request needs|--service needs|--template needs|no such file: )|has no service /;

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
