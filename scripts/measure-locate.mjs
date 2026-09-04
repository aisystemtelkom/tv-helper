/**
 * Scores the locate step (Task 6, src/lib/pipeline/locate.ts) against the
 * human-authored crops in the sample DOKUMEN VALIDASI docx. Run by hand: it
 * reads gitignored client documents in documents/ and calls the real model.
 * See .superpowers/sdd/2026-08-30-pipeline-headless/task-7-brief.md.
 *
 * A slot passes when it lands on an expected page and its chosen line range
 * CONTAINS every OCR line whose text appears in the ground-truth crop, with
 * overshoot capped proportionally: a range more than twice the required line
 * count is rejected, and so is one that runs the whole page when the crop
 * does not.
 *
 * A FIELD SLOT ALSO HAS TO BE THE RIGHT SIZE ON THE PAGE, capped at twice the
 * human crop's height (`INFLATION_MULTIPLE`, added 2026-09-03). That number
 * was printed and not scored until a measured overcapture landed exactly ON
 * the line-count cap and passed: see the constant's own comment for the
 * measurement and for why whole-document slots stay exempt.
 *
 * That rule replaces "at most two extra lines", which the 2026-08-30 design
 * stated as though it were a requirement and which the 2026-08-31 corrections
 * note (section 3) records as invented, with no data behind it. Cross-checked
 * against the sample, the twelve human-authored crops run from 2 lines to 43:
 *
 *   image6  2   image4  9   image11  9   image10 15   image7 18   image3 21
 *   image9  27  image5 28   image2  34   image8  34   image1 35   image17 43
 *
 * A fixed +2 is therefore a 100% overshoot budget on the smallest crop and 5%
 * on the largest -- it measures nothing consistent, and it failed
 * `KB / Para Pihak` (+4) and `KB / TTD Pejabat` (+7) even though both
 * proposals contained every required line. A proportional cap catches a
 * genuine runaway (half the page returned for a two-line field) while
 * matching how a person actually crops.
 *
 * "The ground-truth crop's own OCR text" is not a hand-picked
 * phrase -- it is produced by OCR-ing each of the twelve crop PNGs
 * (word/media/imageN.png inside the sample docx) with whichever engine
 * `OCR_ENGINE` selects, the same one that read the full pages, so the
 * comparison is real text against
 * real text, from the same OCR engine, not a human's guess at a
 * "representative" substring. See the normalisation/matching comment above
 * `lineAppearsInCrop` below for exactly how OCR variance between the two
 * renderings (crop screenshot vs. full-page scan) is tolerated. This is a
 * *stricter* rule than an earlier version of this script that matched a
 * single hand-picked phrase per slot -- it requires covering the whole crop,
 * not hitting one substring -- see task-7-report.md for why that phrase
 * proxy was replaced and what changed as a result.
 *
 * WHAT THIS GATE NOW MEASURES, and why it changed with the pipeline. Each
 * slot used to be offered only the pages of its own document type -- the KB
 * slots saw the 23 contract pages and nothing else. The 2026-08-31
 * corrections note (section 2) retires that narrowing: the tool is
 * document-agnostic, so every slot is searched across every page of every
 * supplied document. This harness follows, and offers all 29 pages of the
 * bundle to every field slot. A gate that kept the old narrow pools would
 * have gone on passing while the shipping pipeline searched something else
 * entirely.
 *
 * It also asks with the PRODUCTION label and hint. Where a ground-truth row
 * names a slot in `src/lib/forms/template.ts`, its `label` and `hint` are
 * read from there rather than restated here, so strengthening a hint to keep
 * it winning on a whole-bundle pool is a change this gate scores. Only
 * `KB / ToP (2)` keeps a hint of its own: the template holds ToP as one
 * `crops: 2` slot with one hint, and the sample's second capture is a
 * different region on a different page.
 *
 * THIS SCRIPT DOES NOT GO THROUGH src/lib/model.ts, and that is a known gap
 * rather than a design choice. It was written on a branch that predated the
 * Gemini migration, when model.ts still exported a local-Ollama chatModel and
 * there was no Ollama server to reach; it therefore calls the Gemini REST
 * surface directly with plain fetch. (An earlier version of this comment
 * still described that pre-migration model.ts as the current state. It has
 * not been true since the Gemini migration merged: model.ts exports a
 * Gemini-backed `chatModel()` now, and scripts/generate.mjs uses it.)
 *
 * No provider SDK is imported here, so the boundary rule is not broken, and
 * scripts/smoke.mjs takes the same posture deliberately -- a broken model.ts
 * must not invalidate the check. The consequence to know is the other
 * direction: THIS GATE CAN PASS WHILE src/lib/model.ts IS BROKEN, and this
 * script's own env defaults can drift from the app's. Check both before
 * reading a gate result as a statement about the app.
 *
 * WHICH OCR ENGINE THIS SCORES. `OCR_ENGINE` selects it, defaulting to
 * "tesseract"; `OCR_ENGINE=gemini` runs `ocrPageWithGemini` instead, on BOTH
 * sides of the comparison -- the 29 full pages and the twelve ground-truth
 * crops. Moving only one side was considered and rejected: it would compare
 * Gemini page geometry against tesseract crop text through
 * `findRequiredLineRange`'s 25%-of-signature fuzzy tolerance, which is tuned
 * for a different engine's error modes, and a miss there would be reported as
 * a note about OCR rather than as a regression. A diagnostic that hides the
 * thing being measured is worse than no comparison. "Real text against real
 * text from the same engine", below, is the entire reason these numbers mean
 * anything, and it is a property of the pair, not of either side.
 *
 * That warning was written before the same failure happened for real, so read
 * it as history rather than as a caution: on 2026-09-02 a same-engine miss was
 * reported as "(OCR-quality issue, not necessarily a locate failure)" and three
 * readers took the parenthetical at its word. `describeNoWindow` replaced it
 * with the ratio that settles it -- see there.
 *
 * Three on-disk caches make iteration cheap. They used to be asymmetric in a
 * way that could silently fake a result; they are not any more, and the fix
 * was structural rather than a louder warning:
 *  - Model-reply cache (tmpdir): keyed by slot name plus a sha256 of the
 *    exact prompt sent, so it only ever serves a reply to the identical
 *    question. Safe by construction across an engine change too: new OCR text
 *    means a new prompt, which misses. Re-running to tweak scoring math
 *    re-spends nothing.
 *  - OCR cache (tmpdir): rendering+OCR-ing 29 full 300 DPI pages is slow (many
 *    minutes under tesseract, real money under Gemini). Keyed by the
 *    document's role, the sha256 OF ITS BYTES, the 0-based page index and the
 *    engine tag.
 *  - Crop OCR cache (tmpdir): keyed by the sample docx's own content hash, the
 *    image name inside it, and the same engine tag.
 *
 * MEASURE_LOCATE_FORCE=1 now bypasses ALL THREE. It used to be consulted only
 * in `makeCachedAsk`.
 *
 * Why that mattered enough to change. Both OCR caches were keyed on a role
 * string ("merged:0", "splitba:1") that depended on neither the bytes, the
 * filename, nor the engine, and both returned a hit unconditionally. So
 * re-exporting a document silently scored its new pages against the old OCR --
 * and, once the engine became a variable, running the gate on Gemini with
 * either file present would have scored Gemini's proposals against TESSERACT's
 * line numbering, on both sides, and printed a plausible total. The run looks
 * entirely normal. AGENTS.md's standing mitigation for this was "delete the
 * temp cache files by hand", which is a hazard that requires remembering, and
 * that is not a mitigation. Every key now carries everything its entry depends
 * on, so a stale entry is unhittable rather than merely undesirable. All three
 * paths and the engine tag are printed when the run starts.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { default: JSZip } = await import("jszip");
import { renderPageUpright } from "../src/lib/pipeline/render.ts";
import {
  MAX_UNCOVERED_INK_RUN_SHARE,
  MIN_INK_COVERAGE,
  ocrPageCompletely,
  ocrPageWithGemini,
  pageGeometry,
  pageToPng,
  OCR_PROMPT_VERSION,
} from "../src/lib/pipeline/gemini-ocr.ts";
import {
  VISION_FEATURE,
  VISION_LANGUAGE_HINTS,
  VISION_MAPPING_VERSION,
  ocrPageWithVision,
} from "../src/lib/pipeline/vision-ocr.ts";
import { annotateImage } from "../src/lib/vision.ts";
import {
  locateSlots,
  CROP_PADDING_PX,
  FOOTER_GAP_MULTIPLE,
  MAX_FOOTER_LINES,
} from "../src/lib/pipeline/locate.ts";
import { boxForLineRange } from "../src/lib/pipeline/geometry.ts";
import {
  findContinuations,
  runningFurniture,
} from "../src/lib/pipeline/continuation.ts";
import { AO_TEMPLATE } from "../src/lib/forms/template.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = join(REPO_ROOT, "documents");

/**
 * `documents/` is gitignored real client material (task-11 finding 5), so
 * its exact filenames -- revision suffix, work-order number and all -- must
 * not be hardcoded into a committed file. Globbing the directory instead
 * also means this script keeps working if the bundle is re-exported under a
 * slightly different name, which the previous exact-match hardcoding did
 * not survive.
 *
 * The bundle holds exactly two PDFs: the short SPLITBA scan (its own name
 * always contains "splitba", case-insensitively) and the long merged scan
 * (everything else). Throws with the directory listing on any other shape
 * rather than guessing which PDF is which.
 */
function findBundlePdfs(dir) {
  const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  const splitba = pdfs.find((f) => /splitba/i.test(f));
  const merged = pdfs.find((f) => f !== splitba);
  if (pdfs.length !== 2 || !splitba || !merged) {
    throw new Error(
      `expected exactly two PDFs under ${dir} -- one matching /splitba/i, ` +
        `one other -- found: ${pdfs.join(", ") || "(none)"}`,
    );
  }
  return { merged: join(dir, merged), splitba: join(dir, splitba) };
}

/** The one sample DOKUMEN VALIDASI docx the bundle's ground truth is scored
 * against. See findBundlePdfs above for why this globs rather than names it. */
function findSampleDocx(dir) {
  const docxs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".docx"));
  if (docxs.length !== 1) {
    throw new Error(
      `expected exactly one .docx under ${dir}, found ${docxs.length}: ` +
        `${docxs.join(", ") || "(none)"}`,
    );
  }
  return join(dir, docxs[0]);
}

const PDFS = findBundlePdfs(DOCS_DIR);
const DOCX_PATH = findSampleDocx(DOCS_DIR);

const nodeContext = (w, h) => createCanvas(w, h).getContext("2d");

// ---------------------------------------------------------------------------
// .env.local loader. Not scripts/env.mjs -- that file (in this worktree)
// configures the local Ollama server and knows nothing about Gemini. This is
// the same handful of lines scripts/smoke.mjs would need for the same reason.
// ---------------------------------------------------------------------------

function loadDotEnvLocal() {
  const path = join(REPO_ROOT, ".env.local");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
loadDotEnvLocal();

// ---------------------------------------------------------------------------
// Gemini `ask`: (prompt: string) => Promise<string>, matching the `Ask` type
// classify.ts/locate.ts already define. Text only, and that is still true of
// every one of the 12 locate calls this harness scores: `Ask` has no image
// parameter, and locate.ts has no image-fallback parameter at all yet.
//
// `askImage` below is the one image-carrying call, and it is the OCR stage
// only -- the same split `src/lib/pipeline/gemini-ocr.ts` draws by declaring
// `AskImage` in its own file rather than beside `Ask`. Reading a page costs an
// image; deciding which lines of it answer a slot does not.
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const MODEL_ID = process.env.MODEL_ID ?? "gemini-3.5-flash";
// The OCR binding, mirroring src/lib/model.ts's OCR_MODEL_ID. Declared here
// rather than imported because this harness deliberately reads its own env and
// does not go through the provider boundary (see this file's header). It is in
// OCR_ENGINE_TAG below, so pointing OCR at a cheaper model re-OCRs the bundle
// instead of scoring the new model's locate against the old model's page text.
// Mirrors src/lib/model.ts's DEFAULT_OCR_MODEL_ID. It is NOT MODEL_ID: the OCR
// binding and the reasoning binding were measured separately and did not come
// out the same model, and a gate that defaulted OCR to MODEL_ID would stop
// measuring what production actually runs.
const OCR_MODEL_ID = process.env.OCR_MODEL_ID ?? "gemini-3.8-flash";
const THINKING_LEVEL = (process.env.GEMINI_THINKING_LEVEL ?? "low").toUpperCase();
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 2048);

/**
 * The OCR-scoped output cap, read straight from the environment rather than
 * imported from `src/lib/model.ts` -- see the file header for why this harness
 * deliberately does not go through the provider boundary, and for the
 * consequence (this script's defaults can drift from the app's; check both).
 * The default matches `model.ts`'s `OCR_MAX_OUTPUT_TOKENS`.
 *
 * It is separate from MAX_OUTPUT_TOKENS above because the two calls are not
 * the same shape: a locate reply is a four-field JSON verdict, where 2048 is a
 * real runaway guard, while a dense 300 DPI page's line list was measured at
 * 2554 output tokens and would be truncated by it.
 */
const OCR_MAX_OUTPUT_TOKENS = Number(
  process.env.GEMINI_OCR_MAX_OUTPUT_TOKENS ?? 16384,
);

/**
 * Which OCR engine both sides of the comparison use. See the file header:
 * moving one side alone would score Gemini geometry against tesseract text
 * through a tolerance tuned for tesseract's error modes, and this harness
 * would report the mismatch as an OCR-quality note rather than a regression.
 *
 * Defaults to tesseract so an un-flagged run keeps measuring what it measured
 * before, which is what makes a before/after pair on the same machine mean
 * something.
 */
const OCR_ENGINE = process.env.OCR_ENGINE ?? "vision";
if (
  OCR_ENGINE !== "tesseract" &&
  OCR_ENGINE !== "gemini" &&
  OCR_ENGINE !== "vision"
) {
  console.error(`OCR_ENGINE must be "tesseract" or "gemini", got "${OCR_ENGINE}"`);
  process.exit(1);
}

/**
 * The engine identity that goes into both OCR cache keys.
 *
 * Everything the stored text depends on, and nothing it does not: under Gemini
 * that is the model id and the prompt version, so a model swap or a bumped
 * `OCR_PROMPT_VERSION` misses by construction instead of serving text produced
 * by different wording. Under tesseract the engine is pinned by the lockfile
 * and the vendored traineddata, so the bare word carries it.
 */
const OCR_ENGINE_TAG =
  OCR_ENGINE === "gemini"
    ? `gemini:${OCR_MODEL_ID}:${OCR_PROMPT_VERSION}`
    : // Vision has no prompt, but it has a CONVERSION, and the cache is only
      // hazard-free for a fixed one. See VISION_MAPPING_VERSION.
      `vision:${VISION_MAPPING_VERSION}`;

/**
 * The model that reads the twelve human-authored crops into ground truth, and
 * it is A FIXED LITERAL rather than whatever this run happens to be measuring.
 *
 * The first version of this pinned ground truth to `MODEL_ID`, which fixed the
 * obvious half of the problem (a candidate OCR model must not read its own
 * yardstick) and left the other half open: changing MODEL_ID to measure the
 * REASONING stages would have moved the yardstick too, silently, in a run
 * whose only intended variable was somewhere else entirely. A yardstick that
 * depends on any variable under test is not a yardstick.
 *
 * So it is a constant, and it names the model the currently cached ground
 * truth was actually produced with. Overridable only to re-establish ground
 * truth deliberately, which is a decision to re-baseline every recorded score
 * in AGENTS.md and not something to do while measuring something else.
 */
const GROUND_TRUTH_MODEL_ID =
  process.env.GROUND_TRUTH_MODEL_ID ?? "gemini-3.5-flash";

const GROUND_TRUTH_ENGINE_TAG =
  OCR_ENGINE === "gemini"
    ? `gemini:${GROUND_TRUTH_MODEL_ID}:${OCR_PROMPT_VERSION}`
    : "tesseract";

/** sha256 of some bytes, hex, truncated -- a cache-key ingredient, not a
 * security boundary. 16 hex characters is 64 bits; collisions between two
 * revisions of one client bundle are not a thing that happens. */
function shortHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

if (!GEMINI_API_KEY) {
  console.error(
    "GOOGLE_GENERATIVE_AI_API_KEY is not set (checked process.env and .env.local). " +
      "This harness calls the real Gemini API and cannot proceed without it.",
  );
  process.exit(1);
}

/**
 * One call. `image`, when given, rides along as a second `inline_data` part.
 *
 * Base64 is the REST surface's only inline form, so a 2.2MB page PNG costs a
 * 33% encoding tax on the wire here. `/api/ocr` avoids that by taking raw
 * bytes; this harness cannot, because it talks to Google directly.
 */
async function geminiAskOnce(prompt, options = {}) {
  const {
    image = null,
    maxOutputTokens = MAX_OUTPUT_TOKENS,
    timeoutMs = 120_000,
    tag = "gemini",
    // Only the OCR path refuses a non-STOP finish. See `askImage` below.
    requireStop = false,
    // CONSTRAINED DECODING, and it is not optional on the OCR path. Measured
    // on four real pages: without a response schema 0 of 4 replies were
    // parseable JSON; with one, 4 of 4, keys exactly {box_2d, text}. See
    // OCR_RESPONSE_SCHEMA in src/lib/pipeline/gemini-ocr.ts for the four
    // distinct malformations this removes.
    responseSchema = null,
    // WHICH MODEL ANSWERS, and it is a parameter because OCR may run on a
    // cheaper tier than the reasoning stages (see OCR_MODEL_ID above). This
    // used to be hardcoded to MODEL_ID while OCR_ENGINE_TAG keyed the cache on
    // OCR_MODEL_ID, so pointing OCR at another model would have re-OCR'd the
    // bundle -- with the wrong model -- and filed the result under the right
    // one. Both halves have to agree or the cache is worse than useless.
    modelId = MODEL_ID,
  } = options;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent` +
    `?key=${GEMINI_API_KEY}`;
  const parts = [{ text: prompt }];
  if (image) {
    parts.push({
      inline_data: {
        mime_type: image.mediaType,
        data: Buffer.from(image.bytes).toString("base64"),
      },
    });
  }
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens,
      responseMimeType: "application/json",
      ...(responseSchema ? { responseSchema } : {}),
      thinkingConfig: { thinkingLevel: THINKING_LEVEL },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const json = await res.json();
    const usage = json.usageMetadata ?? {};
    const finishReason = json.candidates?.[0]?.finishReason;
    // `cached=` is printed even when it is zero, and that is the point. All
    // seven field slots ask about the same page pool, so the listing is
    // byte-identical across them and the provider discounts a repeated prompt
    // PREFIX by about 90% -- but only if the prompt is ORDERED so the
    // invariant part comes first (see buildLocatePrompt in
    // src/lib/pipeline/locate.ts). Nothing in a reply announces whether the
    // provider took the hint, so a run that shares a prefix and caches nothing
    // has to be able to say so out loud rather than looking like a success.
    console.log(
      `    [${tag}] in=${usage.promptTokenCount ?? "?"} out=${usage.candidatesTokenCount ?? "?"} ` +
        `thoughts=${usage.thoughtsTokenCount ?? 0} ` +
        `cached=${usage.cachedContentTokenCount ?? 0} ` +
        `total=${usage.totalTokenCount ?? "?"} ` +
        `finish=${finishReason ?? "?"}`,
    );
    // A truncated locate reply fails to parse loudly a moment later. A
    // truncated LINE LIST does not: it is a syntactically fine JSON object
    // holding a page's first N lines, and it reads downstream as a short page
    // whose later content simply is not there. Refuse it here, before anything
    // parses it, rather than letting it become the ground truth a slot is
    // scored against.
    if (requireStop && finishReason && finishReason !== "STOP") {
      throw new Error(
        `Gemini stopped with finishReason=${finishReason}, not STOP. The reply is ` +
          `not usable as OCR: a truncated or withheld line list reads as a short ` +
          `page. (If MAX_TOKENS: raise GEMINI_OCR_MAX_OUTPUT_TOKENS, currently ` +
          `${maxOutputTokens}.)`,
      );
    }
    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");
    if (!text.trim()) {
      throw new Error(`Gemini returned no text. finishReason=${finishReason}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function geminiAsk(prompt, options = {}) {
  // Six attempts with a longer backoff, not three. Gemini returned repeated
  // HTTP 503 "high demand" during the first scored run and killed three slots
  // outright, which scores an availability blip as a localization failure --
  // exactly the false signal this gate must not produce. AGENTS.md already
  // records 503s on gemini-3.7-flash; 3.5-flash shows them under load too.
  const attempts = 6;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await geminiAskOnce(prompt, options);
    } catch (err) {
      lastError = err;
      // RECITATION and OTHER join the transient set, measured rather than
      // assumed: OCR-ing merged page 0 three times returned STOP, RECITATION
      // (no text at all), then STOP. Whatever RECITATION means on a scan of a
      // printed contract, it is intermittent for identical bytes, and a
      // one-in-three abort on page 7 of 29 would end a run that has already
      // paid for six pages. MAX_TOKENS and the safety reasons are deliberately
      // NOT here: those are properties of the request, so another identical
      // call buys nothing but another image upload.
      // A TRANSPORT failure carries nothing matchable in its string. Node's
      // fetch rejects with `TypeError: fetch failed` and hangs the real reason
      // on `cause.code`, so `String(err)` is the useless half. MEASURED: this
      // run died at page 13 with `read ECONNRESET` after twelve pages were
      // already paid for, because the regex below saw only "fetch failed".
      // This is the same defect AGENTS.md records for the 503 -- detect from
      // the error OBJECT, not from its toString -- in a second place.
      // `src/lib/model.ts`'s `isTransient` carries the full list; this harness
      // deliberately does not import it (see the file header), so the two must
      // be kept in step by hand.
      const code = err?.code ?? err?.cause?.code;
      const transport =
        typeof code === "string" &&
        /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|EPIPE|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ENETDOWN|UND_ERR_)/.test(
          code,
        );
      const transient =
        transport ||
        /HTTP 503|HTTP 429|AbortError|abort|finishReason=(RECITATION|OTHER)/i.test(
          String(err),
        );
      if (!transient || i === attempts - 1) throw err;
      const backoffMs = Math.min(2000 * 2 ** i, 30_000);
      console.log(
        `    [${options.tag ?? "gemini"}] transient error, retrying in ${backoffMs}ms: ${err.message}`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError;
}

/**
 * The `AskImage` `ocrPageWithGemini` takes: (prompt, image, schema) => reply
 * text. The schema is forwarded to the provider as `responseSchema` so
 * generation is CONSTRAINED to it, not merely told about it.
 *
 * The same six-attempt backoff as the text ask, for the same reason -- a 503
 * blip mid-bundle would otherwise abandon a run that has already paid for
 * twenty pages -- plus two OCR-specific differences.
 *
 * One: `OCR_MAX_OUTPUT_TOKENS`, because a dense page's line list was measured
 * at 2554 output tokens and the locate cap is 2048.
 *
 * Two: `requireStop`. A truncated line list is the quiet failure this harness
 * exists to avoid producing, not merely to avoid scoring: it becomes the OCR
 * both the model's prompt and the ground-truth matcher are built from, so a
 * silently short page would move a slot's required range without anything in
 * the log to say so.
 */
async function askImage(prompt, image, schema, modelId = OCR_MODEL_ID) {
  return geminiAsk(prompt, {
    image,
    maxOutputTokens: OCR_MAX_OUTPUT_TOKENS,
    tag: "gemini-ocr",
    requireStop: true,
    responseSchema: schema,
    modelId,
  });
}

// ---------------------------------------------------------------------------
// Model-reply cache: keyed by slot name + sha256 of the exact prompt sent, so
// it only ever serves a reply for the exact question that produced it.
// ---------------------------------------------------------------------------

const MODEL_CACHE_PATH = join(tmpdir(), "tv-helper-measure-locate-model-cache.json");
const FORCE_FRESH = process.env.MEASURE_LOCATE_FORCE === "1";

/**
 * MEASURE_LOCATE_REPEAT asks the SAME prompt again under a separate cache
 * key, so the same question can be sampled more than once without either
 * answer overwriting the other.
 *
 * This exists because a prompt A/B on this gate is otherwise uninterpretable.
 * Changing one sentence changes the prompt for all eight field slots, so all
 * eight are re-asked, and the model is not deterministic: some of the movement
 * between an "old prompt" run and a "new prompt" run is the prompt and some is
 * just resampling. `locate.ts`'s own header records an earlier footer-rule A/B
 * that "moved answers on nine of the twelve scored slots" and was reverted on
 * that basis -- with no measurement of how many slots move when NOTHING is
 * changed. Run `MEASURE_LOCATE_REPEAT=1` and `=2` against the unchanged prompt
 * first and that noise floor becomes a number instead of an assumption.
 *
 * The salt is mixed into the CACHE KEY ONLY, never into the prompt: repeat 3
 * asks a byte-identical question to repeat 0. Repeat 0 is the default and its
 * key is the bare `slot:hash` the cache already holds, so existing entries
 * keep hitting and a default run re-spends nothing.
 */
const REPEAT = Number(process.env.MEASURE_LOCATE_REPEAT ?? 0);
if (!Number.isInteger(REPEAT) || REPEAT < 0) {
  console.error(`MEASURE_LOCATE_REPEAT must be a non-negative integer, got "${process.env.MEASURE_LOCATE_REPEAT}"`);
  process.exit(1);
}

async function loadJsonCache(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

async function saveJsonCache(path, cache) {
  await writeFile(path, JSON.stringify(cache), "utf8");
}

function makeCachedAsk(slotName, modelCache) {
  return async function cachedAsk(prompt) {
    const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 16);
    // THE MODEL AND ITS SETTINGS ARE IN THE KEY, and they were not before.
    //
    // The key used to be the slot name plus the prompt hash alone, which is
    // correct exactly until somebody changes the model in order to find out
    // what it does -- the one occasion on which they are certain to be
    // misled. Page text is what makes a locate prompt, and under
    // `OCR_ENGINE=tesseract` (or with the page cache already warm for the
    // candidate) the prompt is byte-identical across a reasoning-model swap,
    // so the old key served the PREVIOUS model's answers while the banner
    // named the new one. A plausible score for a model that was never called
    // is this project's own named failure class aimed at its instruments.
    //
    // This invalidates the existing entries by design. They were produced by
    // a model this key can now name, and re-earning them is the price of
    // being able to trust the next comparison.
    const settings = `${MODEL_ID}/${THINKING_LEVEL}/${MAX_OUTPUT_TOKENS}`;
    const key =
      REPEAT === 0
        ? `${settings}|${slotName}:${hash}`
        : `${settings}|${slotName}:${hash}:r${REPEAT}`;
    if (!FORCE_FRESH && modelCache[key]) {
      console.log(`    [cache] reusing cached model reply for "${slotName}"`);
      return modelCache[key];
    }
    const reply = await geminiAsk(prompt);
    modelCache[key] = reply;
    await saveJsonCache(MODEL_CACHE_PATH, modelCache);
    return reply;
  };
}

// ---------------------------------------------------------------------------
// OCR, under whichever engine OCR_ENGINE names, and its cache.
//
// One helper for both callers below -- the 29 full pages and the twelve
// ground-truth crops -- because the whole point of the gate is that the two
// sides are read by the SAME engine with the SAME settings. Two near-identical
// copies of this branch is how they would drift apart.
// ---------------------------------------------------------------------------

/**
 * `{ data, width, height }` in, `{ lines, report }` out. `report` is null
 * under tesseract, which has nothing to report; under Gemini it carries the
 * block/segment/interpolated/dropped counts the design's guardrails are read
 * from.
 */
async function ocrRendered(rendered, modelId = OCR_MODEL_ID, engine = OCR_ENGINE) {
  if (engine === "vision") {
    const image = await pageToPng(rendered);
    return await ocrPageWithVision(
      image,
      { width: rendered.width, height: rendered.height },
      (img) =>
        annotateImage(img, {
          feature: VISION_FEATURE,
          languageHints: VISION_LANGUAGE_HINTS,
        }),
    );
  }
  if (engine === "gemini") {
    const image = await pageToPng(rendered);
    return await ocrPageWithGemini(image, (prompt, image_, schema) =>
      askImage(prompt, image_, schema, modelId),
    );
  }
  throw new Error(
    `OCR_ENGINE=${engine} reached ocrRendered, which only knows "vision" and ` +
      '"gemini". tesseract was removed: this tool reads scans on Google ' +
      "infrastructure.",
  );
}

/**
 * How often the page-completeness assertion fired, and how many pages a re-read
 * then rescued. Printed in the summary, always, including the zeros.
 *
 * A GUARD THAT NEVER FIRES IS UNTESTED, NOT UNNECESSARY, and this one exists
 * for an intermittent defect: roughly 7% of whole-page reads came back
 * materially short on 2026-09-02. A gate run whose log says nothing about the
 * check is indistinguishable from one where it was never armed, and the Task 7
 * verdict makes "the run log shows either zero firings or firings that
 * recovered" a condition on deleting tesseract.
 */
let shortReads = 0;
let recoveredPages = 0;

/**
 * A whole PAGE, with the completeness assertion armed.
 *
 * Separate from `ocrRendered` above because the assertion applies to pages and
 * NOT to the twelve ground-truth crops, and the difference is not squeamishness
 * about a second retry. A crop is a picture of a REGION whose ink runs to its
 * own edge by construction, so the ratio the threshold was calibrated on means
 * something different there; and the crops are the ground truth this harness
 * scores against, so a false firing on that side would fail the gate over the
 * instrument rather than over the pipeline. The defect measured on 2026-09-02
 * was on the page side of the comparison, twice, and the crop side read longer
 * than the page it was cut from -- see `describeNoWindow`.
 *
 * Nothing here for tesseract, which has never produced this failure: it fails
 * loudly and illegibly instead ("Sa Pewa g A Pm 1 Sen"), which is a different
 * problem with a different cure.
 */
async function ocrPageRendered(rendered, label) {
  if (OCR_ENGINE !== "gemini") return await ocrRendered(rendered);

  const { lines, report, attempt } = await ocrPageCompletely(
    rendered,
    (png) => ocrPageWithGemini(png, askImage),
    {
      label,
      onShort: (short) => {
        shortReads += 1;
        console.warn(
          `  SHORT READ ${label}, attempt ${short.attempt} of ${short.attempts}: ` +
            `${short.lines} lines -- ${short.completeness.shortfalls.join("; ")}. ` +
            // Named, not implied: the re-read sends the same bytes with the same
            // prompt, so nothing but the model's own sampling can make it differ.
            "Re-reading the IDENTICAL page image.",
        );
      },
    },
  );
  if (attempt > 1) {
    recoveredPages += 1;
    console.log(`  RECOVERED ${label} on attempt ${attempt}.`);
  }
  return { lines, report };
}

// ---------------------------------------------------------------------------
// Page OCR cache. Rendering and OCR-ing a 3507x2480 scan is slow -- this is a
// real necessity, not a nicety: the merged contract scan is 27 pages and the
// SPLITBA scan is 2, so 29 pages must be OCR'd once for the whole run, and
// under Gemini each of those is a paid image call rather than local CPU.
//
// The key carries the document's role, the sha256 OF ITS BYTES, the page index
// and the engine tag, and the lookup honours FORCE_FRESH. Every one of those
// four was missing at some point and each absence had the same shape: a stale
// entry served silently under a run that looked entirely normal. See the file
// header for the full account, including the engine-swap case that is the
// reason this was made structural rather than documented harder.
//
// The DPI is not in the key because it is not a variable here: this harness
// renders at 300 in exactly one place, three lines below.
// ---------------------------------------------------------------------------

const OCR_CACHE_PATH = join(tmpdir(), "tv-helper-measure-locate-ocr-cache.json");

/** The one place the page-cache key is spelled, so the writer below and the
 * reader in `allBundlePages` cannot disagree about its shape. */
function pageCacheKey(pdfKey, pdfHash, pageIndex) {
  return `${pdfKey}:${pdfHash}:${pageIndex}:${OCR_ENGINE_TAG}`;
}

async function ocrPageCached(pdfDoc, pdfKey, pdfHash, pageIndex, ocrCache) {
  const key = pageCacheKey(pdfKey, pdfHash, pageIndex);
  if (!FORCE_FRESH && ocrCache[key]) return ocrCache[key];

  const started = Date.now();
  const page = await pdfDoc.getPage(pageIndex + 1); // pdf.js pages are 1-based
  const rendered = await renderPageUpright(page, 300, nodeContext);
  // The RGBA is right here, which is the whole argument for putting the
  // completeness assertion on the device: no decoder, no second render, and a
  // page that comes back short can simply be asked for again.
  const { lines, report } = await ocrPageRendered(
    rendered,
    `${pdfKey} page ${pageIndex}`,
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `  OCR ${pdfKey} page ${pageIndex}: ${rendered.width}x${rendered.height}, ` +
      `${lines.length} lines, ${seconds}s${describeReport(report)}`,
  );

  const entry = { width: rendered.width, height: rendered.height, lines, report };
  ocrCache[key] = entry;
  await saveJsonCache(OCR_CACHE_PATH, ocrCache);
  return entry;
}

/**
 * The part of an `OcrReport` worth a line in the run log.
 *
 * `chars` and `cover` are here because of what the 2026-09-02 run showed: two
 * of its 29 pages came back materially incomplete with `finishReason=STOP`,
 * zero dropped entries and no flag anywhere, and the ONLY numbers that
 * separated them from the healthy 27 were how much text they transcribed and
 * how far down the page their lowest returned box reached (0.514 of the page
 * height on `merged:19`, against 0.94-0.99 on every healthy page). Printing
 * them per page is the difference between seeing a short page while the run is
 * still going and reconstructing it from a cache file afterwards, which is what
 * actually happened and cost four investigations.
 *
 * `interpolated` is a NUMBER, not a warning. It ran at 69% of all lines
 * bundle-wide, so as an alarm it fired on 21 of 29 pages including entirely
 * healthy ones; as a number it still says the real thing, which is that this
 * pipeline has largely become "trust the model's block box with a 12px pad".
 *
 * These per-page lines only print on a cache MISS, so the summary at the end of
 * the run prints the same measurements for every page, cached or not.
 */
function describeReport(report) {
  if (!report) return "";
  const parts = [
    `${report.blocks} blocks`,
    `${report.interpolatedLines} interpolated`,
    `${report.transcribedChars} chars`,
    `cover ${report.verticalCoverage.toFixed(3)}`,
  ];
  // Present only where the caller held the pixels, which is pages and not
  // crops. `cover` measures the boxes against the PAPER and cannot tell a short
  // read from a wide bottom margin; `ink` measures them against this page's own
  // last row of print, which is the only one of the two that can.
  if (typeof report.inkCoverage === "number") {
    parts.push(`ink ${report.inkCoverage.toFixed(3)}`);
  }
  // The half of the assertion a surviving running footer cannot fake: `ink` is
  // a max over the boxes, so one box near the page bottom satisfies it however
  // little else came back.
  if (typeof report.uncoveredInkRunShare === "number") {
    parts.push(`uncovered ${(100 * report.uncoveredInkRunShare).toFixed(1)}%`);
  }
  if (report.collapsedBlocks > 0) {
    parts.push(`${report.collapsedBlocks} collapsed`);
  }
  if (report.droppedEntries > 0) parts.push(`${report.droppedEntries} dropped`);
  if (report.degraded) parts.push(`DEGRADED: ${report.reasons.join("; ")}`);
  return `  [${parts.join(", ")}]`;
}

/**
 * Every page of the whole bundle, in one list, numbered the way
 * `scripts/generate.mjs` numbers them: the merged scan first, then the
 * SPLITBA, with `index` continuing across the file boundary.
 *
 * One list rather than one per document, because the pool a slot is offered
 * is now the whole bundle -- see the file header. `doc` and `pageInDoc` are
 * kept alongside so a failure can still be reported as "merged page 19",
 * which is what a person opens.
 */
/**
 * How much of THIS slot's proposal rests on a sliced box rather than a
 * measured one.
 *
 * `Line.origin` was ruled in over a block id precisely because it would have
 * two real readers, and this is the second one (the first is the operator
 * plate's chip). The bundle-wide interpolation rate the summary prints cannot
 * answer the question that matters when a slot fails -- whether the rectangle
 * under THAT crop was returned by the model or arithmetic from a paragraph
 * block -- and that is the number Task 7 has to read to decide whether the
 * design has quietly degraded to "trust the block box with a 12px pad".
 *
 * Prints nothing under tesseract, whose lines carry no `origin` at all: an
 * unconditional "interp 0/12" would read as a measured zero rather than as an
 * engine that never had the concept.
 */
function interpolationOf(result, pages) {
  if (!result) return "";
  const page = pages[result.zone.pageIndex];
  if (!page || !page.lines.some((l) => l.origin)) return "";
  const [from, to] = result.zone.lineRange;
  const covered = page.lines.filter((l) => l.i >= from && l.i <= to);
  const interpolated = covered.filter((l) => l.origin === "interpolated").length;
  return `, ${interpolated}/${covered.length} interpolated`;
}

function allBundlePages(ocrCache, docPageCounts, docHashes) {
  const pages = [];
  for (const docKey of DOC_ORDER) {
    for (let pageInDoc = 0; pageInDoc < docPageCounts[docKey]; pageInDoc++) {
      const entry = ocrCache[pageCacheKey(docKey, docHashes[docKey], pageInDoc)];
      if (!entry) throw new Error(`page ${docKey}:${pageInDoc} was never OCR'd`);
      pages.push({
        index: pages.length,
        doc: docKey,
        pageInDoc,
        width: entry.width,
        height: entry.height,
        lines: entry.lines,
        // null under tesseract; the OcrReport under Gemini. Carried this far
        // so the summary can print the bundle-wide interpolation rate even on
        // a fully cached run, where no per-page OCR line was ever logged.
        report: entry.report ?? null,
      });
    }
  }
  return pages;
}

/** The bundle-global index of a (document, page-in-document) pair. */
function globalIndexOf(pages, docKey, pageInDoc) {
  const page = pages.find((p) => p.doc === docKey && p.pageInDoc === pageInDoc);
  if (!page) throw new Error(`no page ${docKey}:${pageInDoc} in the bundle`);
  return page.index;
}

// ---------------------------------------------------------------------------
// Ground-truth crop OCR.
//
// The spec's rule is scored against each crop's OWN OCR text, not a
// hand-picked phrase -- see the file header comment. The twelve crop PNGs
// live at word/media/imageN.png inside the sample docx; each is small
// (a cropped screenshot, not a full page), so OCR-ing all twelve is quick
// relative to the 29 full pages above. Cached separately, keyed by the sample
// docx's own content hash, the image name inside it and the engine tag, so
// re-running this script never re-OCRs them and a re-exported sample cannot be
// scored against the previous sample's crop text.
//
// CROP_OCR_UPSCALE exists because these crops are NOT rendered at the 300
// DPI the rest of this pipeline assumes. Measured directly: image1.png (the
// "BA Permintaan" crop, a full printed page of body text) is 472x752 pixels
// -- for that much text, on the order of 70-100 DPI, well below what
// tesseract needs for small print. OCR-ing it as-is produced pure noise
// ("ea Beam Kata Panjar serdanTAan Onoea..." -- not merely a few wrong
// characters, but no resemblance to the real Indonesian text at all).
// Upscaling the bitmap by 3x before OCR (bringing it near the 300 DPI the
// full pages already render at) turned that same image into clean,
// correctly-read text. Cross-checked at 2x (one crop's genuine text still
// missed tolerance) and 4x (no further improvement over 3x on any of the
// twelve crops) before picking 3x -- this was decided by inspecting OCR
// text quality against the crops' own known content, before any live model
// reply was scored against it, and was not revised afterward. See
// task-7-report.md.
//
// EVERY WORD OF THAT PARAGRAPH IS ABOUT TESSERACT, and the upscale is left at
// 3 anyway for this landing. The probe measured Gemini reading crops
// PERFECTLY -- it is whole-page tokenization, not small print, that makes it
// confabulate -- so 3x is very probably an unnecessary resample that changes
// results for nothing. It is deliberately not re-tuned here: this task moves
// the engine and only the engine, because a run that changes the engine and a
// preprocessing constant together cannot tell a gain from a regression, which
// is the one thing this harness exists to do. Task 8 re-derives it (and
// `foldConfusables`, which is likewise a tesseract-shaped tolerance) against
// the post-migration baseline, once, deliberately.
// ---------------------------------------------------------------------------

const CROP_OCR_CACHE_PATH = join(tmpdir(), "tv-helper-measure-locate-crop-ocr-cache.json");
const CROP_OCR_UPSCALE = 3;

/**
 * The sample docx, opened once, alongside the hash of the bytes it was opened
 * from. The hash is what makes a re-exported sample miss the crop cache
 * instead of quietly reusing the previous sample's ground-truth text: the
 * crops ARE the ground truth, so serving stale ones moves the target the
 * proposals are scored against with nothing in the log to say so. Same failure
 * shape as the page cache, same structural fix.
 */
let docxPromise;
function loadDocx() {
  docxPromise ??= readFile(DOCX_PATH).then(async (bytes) => ({
    zip: await JSZip.loadAsync(bytes),
    hash: shortHash(bytes),
  }));
  return docxPromise;
}

async function ocrCropCached(imageName, cropCache) {
  const { zip, hash } = await loadDocx();
  // Tagged with the REFERENCE model's tag, matching the pin below: the crop
  // cache must not be invalidated by, or keyed to, whichever candidate is
  // being measured.
  const key = `${hash}:${imageName}:${GROUND_TRUTH_ENGINE_TAG}`;
  if (!FORCE_FRESH && cropCache[key]) return cropCache[key];

  const file = zip.file(`word/media/${imageName}`);
  if (!file) throw new Error(`docx is missing word/media/${imageName}`);
  const pngBytes = await file.async("nodebuffer");

  const started = Date.now();
  const image = await loadImage(pngBytes);
  const width = Math.round(image.width * CROP_OCR_UPSCALE);
  const height = Math.round(image.height * CROP_OCR_UPSCALE);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  // The upscaled bitmap, not the docx's original PNG bytes, so both engines
  // are handed byte-for-byte the same pixels. Under Gemini `ocrRendered`
  // re-encodes them through the production `pageToPng`, which is also what
  // gives `pngDimensions` a coordinate space that provably matches the image
  // the model was shown.
  // GROUND TRUTH IS READ BY THE REFERENCE MODEL, NEVER BY THE CANDIDATE, and
  // that is a measurement-design decision rather than a cost one.
  //
  // These twelve crops are the yardstick every candidate is scored against. If
  // the candidate read them too, then switching OCR_MODEL_ID would move the
  // ruler and the thing being measured at the same time, and a run's score
  // would say nothing about which of the two had changed. Pinning it to
  // MODEL_ID keeps one fixed yardstick across every candidate.
  //
  // The cost is real and is smaller than the confound: the file header's
  // original argument was that scoring "real text against real text from the
  // same engine" avoids cross-engine transcription differences leaking into
  // the containment match. That still applies, but `findRequiredLineRange`
  // aligns the two sides with a free-start/free-end Levenshtein search at a
  // 25% tolerance, which is built precisely to absorb transcription noise --
  // whereas nothing absorbs a moving yardstick.
  //
  // It also sidesteps a measured failure. `gemini-3.5-flash-lite` read all 29
  // full pages of this bundle cleanly and then refused one crop outright with
  // finishReason=RECITATION, deterministically, through six retries and a 30s
  // backoff. Ground truth that a candidate can refuse to produce is not
  // ground truth.
  // PINNED TO THE GEMINI REFERENCE, engine and model both, whatever
  // OCR_ENGINE is measuring. The twelve crops are the yardstick: letting them
  // switch engines alongside the candidate would move the ruler and the thing
  // being measured at the same time, and every recorded score in AGENTS.md
  // would silently stop being comparable.
  const { lines, report } = await ocrRendered(
    { data, width, height },
    GROUND_TRUTH_MODEL_ID,
    "gemini",
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `  OCR crop ${imageName}: ${image.width}x${image.height} upscaled ${CROP_OCR_UPSCALE}x to ` +
      `${width}x${height}, ${lines.length} lines, ${seconds}s${describeReport(report)}`,
  );

  const entry = { width, height, lines, report };
  cropCache[key] = entry;
  await saveJsonCache(CROP_OCR_CACHE_PATH, cropCache);
  return entry;
}

// ---------------------------------------------------------------------------
// Text normalisation and matching, used to find which of a page's OCR lines
// correspond to a ground-truth crop's own OCR text.
//
// The same printed content is rasterised twice at different resolutions --
// once inside the 300 DPI full-page scan, once as a Word-embedded screenshot
// crop -- and tesseract does not always read the two identically. Per the
// task brief, the matcher tolerates: case (lowercased first), whitespace
// (collapsed to single spaces between normalised tokens), and two classes of
// characters tesseract commonly confuses at small sizes -- {l, i, 1} and
// {o, 0} -- each folded to one representative before comparison.
//
// `foldConfusables` is therefore, like CROP_OCR_UPSCALE above, a tolerance
// shaped around one engine's error modes. It is left alone in the engine-move
// commit for the same reason and is re-derived in Task 8. Worth knowing which
// way it is likely to be wrong: the two folds are glyph confusions rather than
// tesseract quirks (an "l" and a "1" genuinely look alike at 8pt), so they
// probably stay useful; what changes is that a VLM's mistakes are whole wrong
// WORDS rather than single wrong characters, which a character-level
// Levenshtein tolerance prices differently.
//
// A first version of this matcher (see git history) tokenised both sides and
// asked, per page line independently, "are most of this line's words
// present somewhere, in any order, in the crop's pooled vocabulary". That
// failed outright on this document, for a reason that is NOT ocr noise: a
// legal contract genuinely repeats the same text verbatim at multiple
// points -- e.g. "PERUSAHAAN PERSEROAN (PERSERO) PT TELEKOMUNIKASI
// INDONESIA TBK" appears in the title block, again introducing party II,
// and again in a notary reference paragraph 25+ lines later. The
// nine-line "KB / Nomor" crop (just the title block and two contract
// numbers) registered page-0 lines past index 30 as "required" this way,
// because those later, unrelated lines are ALSO built largely from that
// same recurring company name -- an accurate finding about the text, but
// the wrong question to have asked. Per-line matching cannot tell "the
// crop's own occurrence of this text" from "any occurrence of this text
// anywhere on the page". That is a defect in the matcher, not a signal
// about the model, so it was fixed here before any slot was scored against
// a live model reply -- see task-7-report.md.
//
// The fix: stop matching line-by-line and match the crop as a WHOLE. Each
// side is reduced to one normalised-token string in reading order (a page's
// full text, and a crop's full text); the crop's entire string is searched
// for as one approximate, ORDER-preserving, CONTIGUOUS run within the
// page's string (a free-start/free-end fuzzy substring search, i.e. where
// in the page does the crop's whole sequence of words best line up). A
// short recurring phrase elsewhere on the page cannot substitute for the
// crop's full sequence of words in that single-window search the way it
// could satisfy an independent per-line, any-order check -- reproducing
// dozens of characters of a specific sequence by coincidence is a
// fundamentally different (and vastly less likely) event than one company
// name recurring. The winning window's character span is then mapped back
// to whichever original OCR lines it overlaps, which becomes the required
// line range directly (no more independent per-line filtering).
//
// This algorithm and its tolerance were fixed before any live model reply
// was scored against them and were not revised afterward -- see
// task-7-report.md.
// ---------------------------------------------------------------------------

function foldConfusables(s) {
  return s.replace(/[li1]/g, "1").replace(/[o0]/g, "0");
}

function normalizeToken(raw) {
  return foldConfusables(raw.toLowerCase()).replace(/[^a-z0-9]/g, "");
}

function tokenize(text) {
  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length >= 2);
}

/** A line reduced to its normalised tokens, space-joined in reading order. */
function lineSignature(text) {
  return tokenize(text).join(" ");
}

/** A whole crop's OCR lines reduced to one signature, in top-to-bottom order. */
function cropSignature(cropLines) {
  return cropLines.map((l) => lineSignature(l.text)).filter(Boolean).join(" ");
}

/**
 * A page's OCR lines reduced to one signature string, in top-to-bottom
 * order, alongside each contributing line's [start, end) character span
 * within that string -- so a character range later found inside `text` can
 * be mapped straight back to which original line indexes produced it. A
 * line with no normalisable text (pure noise/symbols) contributes nothing
 * and can never itself be "required".
 */
function buildPageSignature(pageLines) {
  let text = "";
  const spans = [];
  for (const line of [...pageLines].sort((a, b) => a.i - b.i)) {
    const sig = lineSignature(line.text);
    if (!sig) continue;
    if (text.length > 0) text += " ";
    const start = text.length;
    text += sig;
    spans.push({ i: line.i, start, end: text.length });
  }
  return { text, spans };
}

/**
 * Best (lowest-cost) alignment of `needle` against a contiguous run
 * somewhere in `haystack` -- a free-start/free-end fuzzy substring search.
 * Standard Levenshtein DP, except: the first row is held at 0 (a match can
 * start at any haystack position for free) and, alongside the usual cost,
 * each cell also carries the haystack start position the best path to it
 * began from, propagated from whichever of the three predecessors was
 * chosen. Reading off the minimum of the final row then gives both the
 * lowest cost and the [start, end) haystack span that produced it.
 * O(len(needle) * len(haystack)); comfortably fast at the sizes here
 * (needles and haystacks both well under 3000 characters).
 */
function bestSubstringMatch(needle, haystack) {
  const n = needle.length;
  const m = haystack.length;
  if (n === 0) return { distance: 0, start: 0, end: 0 };
  if (m === 0) return { distance: n, start: 0, end: 0 };

  let prevCost = new Array(m + 1).fill(0);
  let prevStart = new Array(m + 1);
  for (let j = 0; j <= m; j++) prevStart[j] = j;
  let currCost = new Array(m + 1);
  let currStart = new Array(m + 1);

  for (let i = 1; i <= n; i++) {
    currCost[0] = i;
    currStart[0] = prevStart[0];
    for (let j = 1; j <= m; j++) {
      const subCost = prevCost[j - 1] + (needle[i - 1] === haystack[j - 1] ? 0 : 1);
      const delCost = prevCost[j] + 1; // needle char consumed, haystack char not
      const insCost = currCost[j - 1] + 1; // haystack char consumed, needle char not

      let best = subCost;
      let start = prevStart[j - 1];
      if (delCost < best) {
        best = delCost;
        start = prevStart[j];
      }
      if (insCost < best) {
        best = insCost;
        start = currStart[j - 1];
      }
      currCost[j] = best;
      currStart[j] = start;
    }
    [prevCost, currCost] = [currCost, prevCost];
    [prevStart, currStart] = [currStart, prevStart];
  }

  let bestJ = 0;
  for (let j = 1; j <= m; j++) if (prevCost[j] < prevCost[bestJ]) bestJ = j;
  return { distance: prevCost[bestJ], start: prevStart[bestJ], end: bestJ };
}

/**
 * How far a crop's own reading may sit from the page's before the two are
 * called different text: roughly 25% of the crop signature's own length, floor
 * 4 characters. Generous against per-character OCR noise across an entire crop,
 * but far tighter than any single recurring phrase could satisfy on its own.
 *
 * ONE FUNCTION, TWO CALLERS, on purpose. The scorer and the FAIL string that
 * explains a score used to hold independent copies of the same literal, so a
 * change to one would have made the printed "against a tolerance of N" name a
 * number the scorer did not apply -- a diagnostic quietly reporting a different
 * threshold than the one that decided the verdict. The Task 7 verdict's §6 says
 * it would not loosen this, which is exactly the circumstance in which a
 * duplicate lies dormant for a long time.
 */
function matchTolerance(cropSig) {
  return Math.max(4, Math.round(cropSig.length * 0.25));
}

/**
 * The [minLine, maxLine] run of a page's OCR lines that best reproduces a
 * ground-truth crop's own OCR text, or a `{ cause }` explaining why no window
 * on this page qualifies.
 *
 * IT RETURNS THE CAUSE RATHER THAN A BARE NULL because there are three
 * different ways to fail here and only one of them means "the page is short".
 * `describeNoWindow` used to re-derive its verdict from scratch and could not
 * tell them apart, so an empty crop signature printed a self-contradictory FAIL
 * line -- distance 0 against a tolerance of 4, described as no match -- that
 * blamed the page when the crop was the side that read as nothing. Pointing a
 * reader confidently at the wrong side is the failure this string was rewritten
 * to stop.
 */
function findRequiredLineRange(pageLines, cropSig) {
  if (!cropSig) return { cause: "empty-crop" };
  const { text: pageSig, spans } = buildPageSignature(pageLines);
  if (spans.length === 0) return { cause: "empty-page" };

  const { distance, start, end } = bestSubstringMatch(cropSig, pageSig);
  const tolerance = matchTolerance(cropSig);
  if (distance > tolerance) return { cause: "no-match", distance, tolerance };

  const covered = spans.filter((s) => s.start < end && s.end > start).map((s) => s.i);
  if (covered.length === 0) {
    return { cause: "no-lines-covered", distance, tolerance };
  }

  return { minLine: Math.min(...covered), maxLine: Math.max(...covered), distance, tolerance };
}

/**
 * Why no window of the chosen page matched this crop, in measured numbers.
 *
 * THE STRING THIS REPLACES HID THE DEFECT IT WAS REPORTING. It read "no window
 * ... matched within tolerance (OCR-quality issue, not necessarily a locate
 * failure)", and the parenthetical did exactly what the migration spec's Task 6
 * predicted it would: three separate readers took it as a note about the
 * instrument and looked elsewhere, and four investigations were spent before
 * anybody computed the one ratio that says what actually happened.
 *
 * That ratio is the whole diagnosis and it needs no re-OCR. On 2026-09-02 the
 * human crop `image1.png` -- a picture of a REGION of one page -- reduced to
 * 1694 normalised characters while the WHOLE PAGE it was cut from reduced to
 * 1142, or 67%. A part cannot contain more than its whole, so no window of that
 * page could match, and `findRequiredLineRange` was arithmetically right to
 * refuse. The page came back a third short with `finishReason=STOP`, zero
 * dropped entries and no flag. `KB / ToP (1)` failed the same way at 88%.
 *
 * Both readings and the ratio are printed unconditionally, including when the
 * page is longer than the crop, because a reader has to be able to tell the two
 * cases apart -- and a healthy page IS longer than a crop of part of it. The
 * verdict sentence is the only part that branches.
 *
 * IT BRANCHES ON THE SCORER'S OWN CAUSE, not on a re-derivation. There are
 * three ways to reach here and the page-is-short sentence is right for exactly
 * one of them. With an empty crop signature, `bestSubstringMatch("", pageSig)`
 * returns distance 0 by its own n===0 early return and the tolerance floor is
 * 4, so re-deriving printed "off by 0 against a tolerance of 4" and then called
 * it a miss -- self-contradictory, and it blamed the page when the CROP read as
 * nothing. Latent on today's twelve crops, which run 2 to 54 lines, and live
 * the first time an engine correctly declines a page of handwriting.
 */
function describeNoWindow(pageEntry, cropSig, imageName, chosenPage, cause) {
  const { text: pageSig } = buildPageSignature(pageEntry.lines);
  const share = cropSig.length > 0 ? (100 * pageSig.length) / cropSig.length : 0;
  const { distance } = bestSubstringMatch(cropSig, pageSig);
  const tolerance = matchTolerance(cropSig);
  const cover = pageGeometry(pageEntry.lines, pageEntry.height).verticalCoverage;

  if (cause === "empty-crop") {
    return (
      `crop ${imageName} OCR'd to nothing at all, so there is no ground truth ` +
      `to match page ${chosenPage} against. This says nothing about the ` +
      "proposal: the CROP is the side that failed to read"
    );
  }
  if (cause === "empty-page") {
    return (
      `page ${chosenPage} OCR'd to no lines at all, so no window of it can ` +
      `match crop ${imageName}'s ${cropSig.length} normalised characters. The ` +
      "page transcription is empty, not mis-chosen"
    );
  }

  const measured =
    `page ${chosenPage} OCR'd to ${pageSig.length} normalised characters against ` +
    `crop ${imageName}'s own ${cropSig.length} (${share.toFixed(0)}%), and its ` +
    `returned boxes reach ${cover.toFixed(3)} of the page height; best alignment ` +
    `was off by ${distance} against a tolerance of ${tolerance}`;

  if (cause === "no-lines-covered") {
    return (
      `${measured} -- the text matched within tolerance but the matching window ` +
      "covers no whole OCR line, so there is no line range to require. That is " +
      "a signature-alignment artifact, not a short page and not a locate miss"
    );
  }

  return share < 100
    ? `${measured} -- a crop of a REGION of this page reads longer than the whole ` +
        "page's own reading, so no window can match: the page transcription is " +
        "incomplete, not mis-chosen"
    : `${measured} -- the page is not short, so this is a genuine disagreement ` +
        "between the two readings of the same print";
}

// ---------------------------------------------------------------------------
// Ground truth.
//
// A note on the count: the task brief and the design doc both say "eleven"
// crops. Direct inspection of the docx (unzip word/media/*.png) and its own
// provenance table put PDF-sourced images at twelve: image1 (BA), image17
// (Email), image2+image3 (SP, two DIFFERENT pages -- 23 and 24, confirmed by
// rendering and reading both), image4/5/6/7/8/9/10/11 (KB's seven checklist
// rows, where "ToP" alone uses two images on two DIFFERENT pages -- 19 and
// 20, also confirmed by rendering). 1 + 1 + 2 + 6 + 2 = 12. Because the two
// SP images and the two ToP images each require an independent locateSlot
// call (they live on different pages), there is no way to fold either pair
// back into a single scored row without silently dropping a real crop. This
// harness therefore scores 12 rows and says so plainly in the summary, rather
// than forcing a count that does not match what is actually in the sample.
// See the task-7 report for the full trace.
// ---------------------------------------------------------------------------

/**
 * Document order in the bundle-global page numbering. `scripts/generate.mjs`
 * numbers pages in the order the PDFs are passed on the command line; this
 * fixes an order so the two agree and a `pageIndex` means the same thing in
 * both. The merged scan first, then the SPLITBA.
 */
const DOC_ORDER = ["merged", "splitba"];

/**
 * Production label and hint, read from the template rather than restated
 * here, so a hint strengthened to survive a whole-bundle pool is scored by
 * this gate instead of drifting away from it silently.
 */
const TEMPLATE_SLOTS = new Map(
  AO_TEMPLATE.sections.flatMap((section) =>
    section.slots.map((slot) => [slot.key, { section, slot }]),
  ),
);

function askedAs(entry) {
  if (!entry.slotKey) return { label: entry.slot, hint: entry.hint };
  const found = TEMPLATE_SLOTS.get(entry.slotKey);
  if (!found) {
    throw new Error(
      `ground truth names slot "${entry.slotKey}", which AO_TEMPLATE no longer has`,
    );
  }
  // The same composition `generate.mjs`'s `slotSearchLabel` makes -- section
  // title without its `(lanjutan)` layout suffix, then the row label -- so
  // this gate asks the question production asks rather than a tidier one.
  return {
    label: `${found.section.title.replace(/\s*\(lanjutan\)\s*$/i, "")} / ${found.slot.label}`,
    hint: found.slot.hint,
  };
}

/**
 * `poolPages` is gone from these rows on purpose. Every field slot is now
 * offered the whole bundle -- see the file header -- so a per-row pool would
 * only be a way to quietly re-narrow the search this gate exists to measure.
 *
 * `page` stays a page number WITHIN `doc`, because that is what a person
 * opens; `globalIndexOf` converts it to the bundle-global index the model's
 * answer is expressed in.
 */
const GROUND_TRUTH = [
  {
    slot: "BA Permintaan",
    wholeDocument: true,
    doc: "splitba",
    page: 0,
    hint: "the request memo (Berita Acara Permintaan) that authorized this order",
    image: "image1.png",
  },
  {
    slot: "Email",
    wholeDocument: true,
    doc: "splitba",
    page: 1,
    hint: "the printed email thread confirming the order request",
    image: "image17.png",
  },
  {
    slot: "SP / Isi Surat",
    wholeDocument: true,
    doc: "merged",
    page: 23,
    altPages: [25], // identical duplicate copy of the same letter, see report
    hint: "the appointment letter (Surat Penunjukan) naming the parties and its reference number",
    image: "image2.png",
  },
  {
    slot: "SP / TTD",
    wholeDocument: true,
    doc: "merged",
    page: 24,
    altPages: [26], // identical duplicate copy of the same signature page
    hint: "the signature block accepting the appointment letter",
    image: "image3.png",
  },
  {
    slot: "KB / Nomor",
    slotKey: "kb.nomor",
    doc: "merged",
    page: 0,
    image: "image4.png",
  },
  {
    slot: "KB / Para Pihak",
    slotKey: "kb.paraPihak",
    doc: "merged",
    page: 0,
    image: "image5.png",
  },
  {
    slot: "KB / Tanggal",
    slotKey: "kb.tanggal",
    doc: "merged",
    page: 0,
    image: "image6.png",
  },
  {
    slot: "KB / Jangka Waktu",
    slotKey: "kb.jangkaWaktu",
    doc: "merged",
    page: 17,
    image: "image7.png",
  },
  {
    slot: "KB / Detail",
    slotKey: "kbLanjutan.detail",
    doc: "merged",
    page: 18,
    image: "image8.png",
  },
  {
    slot: "KB / ToP (1)",
    slotKey: "kbLanjutan.top",
    doc: "merged",
    page: 19,
    image: "image9.png",
  },
  {
    // No slotKey: the template holds ToP as ONE `crops: 2` slot with one
    // hint, and the sample's second capture is a different region on a
    // different page. Asking the template's ToP hint twice would score the
    // same question twice and call the second answer a different slot.
    //
    // ## Why this row fails, and why it is not a locate defect to go fix
    //
    // Diagnosed from the OCR of merged page 20 rather than from the score.
    // The model answers lines 6-15, stably: 6-15 on two of three identical
    // samples and 6-16 on the third. The human's crop is lines 1-15. So the
    // two agree on where the block ENDS (line 15, the last line of the
    // remittance-account block) and disagree only on where it STARTS. An
    // earlier reading of this miss as "starts too late AND stops too early"
    // is wrong on the second half; `containsAll` fails on `from` alone.
    //
    // What is actually on that page: line 1 is the letterhead, lines 2-5 are
    // clause 4 (where to send invoices), lines 6-10 are clause 5 (when payment
    // is made, ending "ditujukan :"), lines 11-15 are the account block
    // itself. Asked for "the bank account number the payment is transferred
    // to", the model returned the account block plus the clause that
    // introduces it. That is a tighter and better-targeted piece of evidence
    // than the human's, which additionally carries the page letterhead and an
    // unrelated clause about invoice delivery.
    //
    // There is no document-agnostic rule that recovers the human's start.
    // "Include the page letterhead for provenance" was the obvious candidate
    // and the sample itself refutes it: of the crops whose block does not
    // begin at the top of the page, ONLY this one includes the letterhead.
    // `KB / Nomor` starts at line 2 of page 0, below a two-line letterhead;
    // `KB / TTD Pejabat` starts at line 7 of page 22, below a one-line
    // letterhead. A rule that reproduced this crop would inflate those two and
    // contradict the human on 7 of 8 field slots.
    //
    // That used to be the argument. It is now a measurement, run offline
    // against the required ranges this gate already prints, giving the
    // hypothesis its BEST case: every field slot keeps the end it answers
    // today and starts at line 0 instead.
    //
    //   KB / Nomor          PASS -> PASS
    //   KB / Para Pihak     PASS -> PASS
    //   KB / Tanggal        PASS -> FAIL  13 lines for a 2-line crop
    //   KB / Jangka Waktu   PASS -> FAIL  43 lines for an 18-line crop
    //   KB / Detail         PASS -> FAIL  runs the whole page (0-28)
    //   KB / ToP (1)        PASS -> FAIL  runs the whole page (0-37)
    //   KB / ToP (2)        FAIL -> PASS
    //   KB / TTD Pejabat    PASS -> PASS
    //
    // Fixes one, breaks four: 11/12 -> 8/12, and that is the ceiling for the
    // idea, not a sample of it. No model call was spent finding this out.
    //
    // Worth knowing before trying to close the gap semantically instead:
    // rewriting the hint cannot pass this row either. The required range
    // starts at line 1, which IS the letterhead (line 0 of this page is a
    // stray mark). Clause 4 and clause 5 are both payment terms, so the best
    // defensible semantic answer for "Terms of Payment" here is lines 2-15 --
    // and 2 > 1, so `containsAll` still fails. The only answers that pass this
    // row start on the letterhead.
    //
    // Worth knowing before treating this row as a product defect: PRODUCTION
    // NEVER ASKS THIS QUESTION. `kbLanjutan.top` is one slot with one hint and
    // `crops: 2`, so `generate.mjs` made a single locate call per round and the
    // second capture stayed outstanding.
    //
    // THAT IS NO LONGER WHAT PRODUCTION DOES, and this row was rewritten to
    // follow it. `crops` is gone: a continuation is DISCOVERED, and
    // `findContinuations` is handed the confirmed first capture and the page
    // AFTER it, then asked one narrow question. That is a far easier question
    // than the wide search this row used to run, and it cannot land on the
    // wrong page because the page is given.
    //
    // So the row no longer carries a hint of its own. It carried one for years
    // -- "the bank account number the payment is transferred to" -- and that
    // string was this harness's invention rather than a production string,
    // which meant the row measured a question no shipping code asked, and
    // tuning it until it passed would have measured nothing. The production
    // hint now comes from the template, through the same path the product
    // uses.
    slot: "KB / ToP (2)",
    doc: "merged",
    page: 20,
    // Walked forward from the capture this row's sibling located. Naming the
    // sibling rather than a page is the point: if `KB / ToP (1)` regresses,
    // this row cannot pass by accident on a lucky wide search.
    //
    // IT STILL FAILS, AND THE FAILURE IS NOW INFORMATIVE RATHER THAN INERT.
    // Measured: the walk answers page 20 lines [2,15]; the human crop is
    // [0,15]. Lines 0 and 1 are the PAGE LETTERHEAD -- two logos at y=207 with
    // h=140, then a tagline at y=368 -- and line 2 is where clause item 4
    // starts. So the product returns the clause exactly and the human's crop
    // additionally carries the furniture above it, because a person
    // screenshotting a region takes what is on the paper.
    //
    // DO NOT "FIX" THIS BY TEACHING THE PRODUCT TO INCLUDE LETTERHEADS.
    // `runningFurniture` exists to exclude exactly those lines, the product is
    // right to, and widening it to pass this row would be tuning to one
    // sample. The open question is the GATE's, not the product's: whether
    // containment should be computed against the human crop's CONTENT lines,
    // with furniture excluded by the same detector the product uses. That is a
    // scoring-rule change, it moves every row, and it needs its own
    // measurement -- so it is recorded here and in AGENTS.md rather than done
    // quietly while fixing something else.
    continuationOf: "KB / ToP (1)",
    slotKey: "kbLanjutan.top",
    image: "image10.png",
  },
  {
    slot: "KB / TTD Pejabat",
    slotKey: "kbLanjutan.ttdPejabat",
    doc: "merged",
    page: 22,
    image: "image11.png",
  },
];

// ---------------------------------------------------------------------------
// Scoring: right page, chosen range CONTAINS every full-page OCR line whose
// text appears in the ground-truth crop's own OCR text, overshoot capped
// proportionally rather than at a flat +2, and -- for a field slot -- the
// resulting picture no more than twice the height of the human's own crop.
// See the file header for why the flat allowance was wrong, and
// findRequiredLineRange above for how the required range is derived.
// ---------------------------------------------------------------------------

/**
 * How much wider than the crop a proposal may be. Two: a range of at most
 * twice the required line count.
 *
 * Proportional because the sample's own crops span 2 to 43 lines, so any
 * fixed number is a wildly different standard at the two ends. Two rather
 * than some other multiple because doubling is already generous for the
 * behaviour the cap exists to catch -- a localizer that returns half a page
 * while claiming to have found a field -- and the failure the cap is NOT
 * meant to catch is a person's ordinary habit of taking the surrounding
 * block. The `runs the full page` clause below is what actually stops a
 * runaway on a short field, where 2x of a two-line crop is still only four
 * lines.
 */
const OVERSHOOT_MULTIPLE = 2;

/**
 * How much TALLER than the human's own crop a field slot's picture may be.
 *
 * ## Why a height cap exists at all, when a line-count cap already does
 *
 * A line is a line whether it sits 40 pixels below the previous one or 1700,
 * so `OVERSHOOT_MULTIPLE` is structurally blind to the defect this cap
 * catches. Measured 2026-09-03, Gemini engine, on `kb.tanggal` over merged
 * page 0: the model answers the wanted two-line date sentence about half the
 * time and, the other half, a four-line range that starts two lines higher
 * and swallows the agreement's `Nomor :` block. FOUR chosen lines for a
 * TWO-line crop is exactly `OVERSHOOT_MULTIPLE`, so the line-count cap scores
 * that answer PASS at its own limit -- while the picture pasted into the
 * deliverable is 2.69x the height of the evidence it is supposed to be. The
 * gate could not tell the right answer from the wrong one, which meant no
 * hint or prompt change aimed at this defect could be believed either way.
 *
 * ## Where the number comes from
 *
 * Measured, not chosen: the same run prints this ratio for every slot, and
 * across the eight field slots the widest legitimate answer is 1.42x
 * (`KB / Nomor`), with six of the eight at or below 1.22x. The cap is set at
 * the same multiple the line-count rule already uses, which leaves a 1.4x
 * margin over the widest legitimate answer this bundle demonstrates and still
 * rejects the 2.69x overcapture. The margin is PRINTED at the end of every
 * run, exactly as `FOOTER_GAP_MULTIPLE`'s is, so a future bundle that walks a
 * legitimate slot up toward the cap says so in the run rather than silently
 * turning the cap into a source of false failures.
 *
 * ## What it deliberately does not apply to
 *
 * WHOLE-DOCUMENT SLOTS ARE EXEMPT, for the same reason they are exempt from
 * both line-count caps: they are not localizing anything, they take the whole
 * page by construction, and their inflation is a property of the human having
 * cropped the margins off a screenshot. `SP / TTD` measures 2.40x on exactly
 * that basis and is not a defect.
 */
const INFLATION_MULTIPLE = 2;

function evaluate(entry, result, pages, cropEntries) {
  if (!result) {
    return { pass: false, detail: "model returned no match (null pageIndex)" };
  }

  const acceptedPages = entry.acceptedPages;
  const chosenPage = result.zone.pageIndex;
  const pageOk = acceptedPages.includes(chosenPage);
  const [from, to] = result.zone.lineRange;

  if (!pageOk) {
    return {
      pass: false,
      pageOk,
      chosenPage,
      lineRange: [from, to],
      detail: `wrong page: chose ${chosenPage}, expected ${acceptedPages.join(" or ")}`,
    };
  }

  const pageEntry = pages[chosenPage];
  if (!pageEntry) throw new Error(`page ${chosenPage} is not in the bundle`);

  // Keyed by bare image name here, not by the crop cache's own key: the cache
  // key carries the docx hash and the engine tag so a stale entry cannot be
  // served, which is a producer concern. What the scorer needs is "the crop
  // this run OCR'd", and `main` hands it exactly that.
  const cropEntry = cropEntries.get(entry.image);
  if (!cropEntry) throw new Error(`crop ${entry.image} was never OCR'd`);
  const cropSig = cropSignature(cropEntry.lines);

  const required = findRequiredLineRange(pageEntry.lines, cropSig);

  if (required.cause) {
    return {
      pass: false,
      pageOk,
      chosenPage,
      lineRange: [from, to],
      detail: describeNoWindow(
        pageEntry,
        cropSig,
        entry.image,
        chosenPage,
        required.cause,
      ),
    };
  }

  const { minLine, maxLine } = required;
  const containsAll = from <= minLine && to >= maxLine;
  const chosenLineCount = to - from + 1;
  const requiredLineCount = maxLine - minLine + 1;
  const extra = chosenLineCount - requiredLineCount;

  // "Runs the full page when the crop does not" is measured against the
  // page's own line numbering rather than assuming it starts at 0, because
  // `boxForLineRange` and the OCR line ids are the same numbers the model
  // was shown.
  const lineIds = pageEntry.lines.map((l) => l.i);
  const firstLine = lineIds.length > 0 ? Math.min(...lineIds) : 0;
  const lastLine = lineIds.length > 0 ? Math.max(...lineIds) : 0;
  const chosenIsWholePage = from <= firstLine && to >= lastLine;
  const requiredIsWholePage = minLine <= firstLine && maxLine >= lastLine;

  const withinMultiple = chosenLineCount <= OVERSHOOT_MULTIPLE * requiredLineCount;
  const notAWholePageGrab = !(chosenIsWholePage && !requiredIsWholePage);

  // ---------------------------------------------------------------------
  // How TALL the proposal is, against how tall the human's own crop is.
  //
  // Both boxes come from `boxForLineRange` with the production padding, on
  // the same page geometry, so this is the real crop against the real crop
  // rather than a proxy: `requiredHeightPx` is what the human's own chosen
  // lines occupy on the 300 DPI page, not the docx thumbnail's pixel height
  // (which is a Word-embedded screenshot at an unknown, much lower DPI and
  // says nothing about the source page).
  //
  // THIS WAS REPORTED AND NOT SCORED UNTIL 2026-09-03, on the argument that
  // scoring it would be a second gate fitted to twelve samples and would fail
  // slots for a whitespace habit rather than for citing the wrong evidence.
  // What changed is a measured defect the line-count caps cannot see at all:
  // `kb.tanggal` overcaptures into the block above the date sentence, and at
  // four chosen lines for a two-line crop it lands EXACTLY on
  // `OVERSHOOT_MULTIPLE` and scores PASS. A gate that cannot separate that
  // answer from the correct one cannot be used to judge a fix for it. See
  // `INFLATION_MULTIPLE` for where the cap's number comes from and for why
  // whole-document slots stay exempt.
  // ---------------------------------------------------------------------
  const bounds = { x: 0, y: 0, w: pageEntry.width, h: pageEntry.height };
  const chosenHeightPx = result.zone.box.h;
  const requiredHeightPx = boxForLineRange(
    pageEntry.lines,
    minLine,
    maxLine,
    CROP_PADDING_PX,
    bounds,
  ).h;
  const inflation = chosenHeightPx / requiredHeightPx;
  const withinInflation = inflation <= INFLATION_MULTIPLE;

  // A whole-document slot is not localizing anything -- it deliberately takes
  // the entire page -- so neither cap measures anything there, and both would
  // fail every such slot merely because the page carries a header or footer
  // the human's crop trimmed. Containment is the whole test for these.
  //
  // This is a per-slot-TYPE rule, not a per-slot exemption: no individual
  // slot is excused, and the two types are reported separately below so the
  // model-dependent number stays visible on its own.
  const overshootOk =
    entry.wholeDocument ||
    (withinMultiple && notAWholePageGrab && withinInflation);
  const pass = pageOk && containsAll && overshootOk;

  let detail = "ok";
  if (!containsAll) {
    detail =
      `chosen lines [${from},${to}] do not cover the crop's required lines ` +
      `[${minLine},${maxLine}]`;
  } else if (!withinMultiple) {
    detail =
      `chosen range is ${chosenLineCount} lines for a ${requiredLineCount}-line crop ` +
      `[${minLine},${maxLine}] -- more than ${OVERSHOOT_MULTIPLE}x`;
  } else if (!notAWholePageGrab) {
    detail =
      `chosen range [${from},${to}] runs the whole page (${firstLine}-${lastLine}) ` +
      `while the crop [${minLine},${maxLine}] does not`;
  } else if (!withinInflation) {
    // Named as a HEIGHT failure and quoting inches, because the line counts
    // it passed are what make this one hard to see: a range can be inside
    // every line-count cap and still be a picture several times the size of
    // the evidence.
    detail =
      `chosen range [${from},${to}] is ${inches(chosenHeightPx).toFixed(2)}in tall ` +
      `for a ${inches(requiredHeightPx).toFixed(2)}in crop [${minLine},${maxLine}] ` +
      `-- ${inflation.toFixed(2)}x, more than ${INFLATION_MULTIPLE}x`;
  }

  return {
    pass,
    pageOk,
    containsAll,
    extra,
    chosenPage,
    lineRange: [from, to],
    requiredLineRange: [minLine, maxLine],
    chosenHeightPx,
    requiredHeightPx,
    humanGapRatio: maxGapRatio(pageEntry.lines, minLine, maxLine),
    detail,
  };
}

/** Page pixels to inches. Every page in this pipeline is rendered at 300 DPI
 * (`renderPageUpright(page, 300, ...)` above), so this is exact, not nominal. */
const RENDER_DPI = 300;
const inches = (px) => px / RENDER_DPI;

/**
 * The largest vertical gap inside a line range, in units of that range's own
 * median line pitch -- the exact quantity `trimRunningFooter` thresholds on.
 *
 * Reported for the HUMAN's line range on every slot, because that is the
 * number that justifies (or refutes) `FOOTER_GAP_MULTIPLE`. Every gap inside a
 * human-authored crop is a gap the trim must NEVER cut: it is legitimate
 * content spacing, by definition, since a person included both sides of it in
 * one piece of evidence. So the highest value this column ever reaches across
 * the twelve crops is a hard lower bound on any safe constant, measured rather
 * than guessed -- and the distance between that bound and the ratio at a real
 * footer is the whole safety margin. Printing both is what stops the constant
 * from being folklore.
 *
 * Returns null when the range is too short for a median pitch to mean
 * anything, which is the same condition under which the trim declines to fire.
 */
function maxGapRatio(pageLines, from, to) {
  const picked = pageLines
    .filter((l) => l.i >= from && l.i <= to)
    .sort((a, b) => a.i - b.i);
  if (picked.length < 4) return null;

  const pitches = [];
  for (let k = 1; k < picked.length; k++) {
    pitches.push(picked[k].box.y - picked[k - 1].box.y);
  }
  const typical = median(pitches);
  if (typical <= 0) return null;

  return Math.max(...pitches) / typical;
}

/**
 * The same median `trimRunningFooter` takes, so the numbers this script prints
 * about that rule are the rule's own arithmetic and not a lookalike.
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How many trailing lines `trimRunningFooter` would delete from a page if it
 * were handed that whole page as its block: the size of the page's running
 * footer, measured rather than assumed.
 *
 * This is the quantity `MAX_FOOTER_LINES` is drawn from, so printing it keeps
 * that constant's margin checked the same way `humanGapRatio` keeps
 * `FOOTER_GAP_MULTIPLE`'s. The two constants answer different questions and
 * both can be wrong on their own: the gap multiple decides WHETHER a gap looks
 * like the one above a footer, and the line cap decides whether what sits
 * below it is small enough to BE one. A bundle whose footers OCR into more
 * lines than the cap allows would stop being trimmed at all -- crops inflate,
 * nothing throws -- and this line is where that shows up.
 *
 * Deliberately measured with the whole page as the block rather than with the
 * model's chosen range: the footer's own size is a property of the page, and
 * measuring it against ranges the model happened to choose this run would make
 * the constant's justification move every time an answer moved.
 *
 * Returns 0 for a page with no oversized gap at all, which is most of them.
 */
function footerTailLines(pageLines) {
  const sorted = [...pageLines].sort((a, b) => a.i - b.i);
  if (sorted.length < 4) return 0;

  const pitches = [];
  for (let k = 1; k < sorted.length; k++) {
    pitches.push(sorted[k].box.y - sorted[k - 1].box.y);
  }
  const typical = median(pitches);
  if (typical <= 0) return 0;

  let cutAfter = -1;
  for (let k = 0; k < pitches.length; k++) {
    if (pitches[k] >= FOOTER_GAP_MULTIPLE * typical) cutAfter = k;
  }
  if (cutAfter < 0) return 0;

  return sorted.length - (cutAfter + 1);
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Model: ${MODEL_ID}  thinkingLevel=${THINKING_LEVEL}  maxOutputTokens=${MAX_OUTPUT_TOKENS}`);
  if (OCR_MODEL_ID !== MODEL_ID) {
    console.log(`OCR model: ${OCR_MODEL_ID}  (reasoning stages stay on ${MODEL_ID})`);
  }
  // The engine tag is printed, not just the engine name, because it IS the
  // cache key's engine half: a reader comparing two runs can see at a glance
  // whether they could possibly have shared an OCR entry.
  console.log(
    `OCR engine: ${OCR_ENGINE}  tag=${OCR_ENGINE_TAG}` +
      (OCR_ENGINE === "gemini" ? `  ocrMaxOutputTokens=${OCR_MAX_OUTPUT_TOKENS}` : ""),
  );
  const forcing = FORCE_FRESH ? " (forcing fresh)" : "";
  console.log(`OCR cache: ${OCR_CACHE_PATH}${forcing}`);
  console.log(`  key: <doc role>:<sha256 of its bytes>:<page>:<engine tag>`);
  console.log(`Crop OCR cache: ${CROP_OCR_CACHE_PATH}${forcing}`);
  console.log(`  key: <sha256 of the sample docx>:<image name>:<engine tag>`);
  console.log(`Model-reply cache: ${MODEL_CACHE_PATH}${forcing}`);
  console.log(`  key: <slot>:<sha256 of the exact prompt sent>`);
  console.log();

  const ocrCache = await loadJsonCache(OCR_CACHE_PATH);
  const cropOcrCache = await loadJsonCache(CROP_OCR_CACHE_PATH);
  const modelCache = await loadJsonCache(MODEL_CACHE_PATH);

  // MEASURE_LOCATE_ONLY lets a single slot be re-run in isolation (by a
  // case-insensitive substring of its name) while iterating on this script.
  // Unset (the default, and what `pnpm measure:locate` runs) scores all 12.
  const only = process.env.MEASURE_LOCATE_ONLY?.toLowerCase();
  const slotsToRun = only
    ? GROUND_TRUTH.filter((g) => g.slot.toLowerCase().includes(only))
    : GROUND_TRUTH;

  const docs = {};
  const docPageCounts = {};
  // The hash of each PDF's own bytes, half the page cache key. Taken here
  // because this is the one place the bytes are already in hand.
  const docHashes = {};
  for (const [key, path] of Object.entries(PDFS)) {
    const bytes = new Uint8Array(await readFile(path));
    docHashes[key] = shortHash(bytes);
    docs[key] = await getDocument({ data: bytes }).promise;
    docPageCounts[key] = docs[key].numPages;
    console.log(`${key}: ${docs[key].numPages} pages, ${docHashes[key]} (${path})`);
  }
  console.log();

  // EVERY page of EVERY document, always -- not just the ones some slot's
  // pool used to name. The pool is the whole bundle now (see the file
  // header), so "which pages does this slot need" is no longer a question
  // this harness is allowed to answer in advance. Even under
  // MEASURE_LOCATE_ONLY: one slot still sees the whole bundle.
  console.log(`Running OCR with ${OCR_ENGINE} (cached pages are skipped)...`);
  for (const docKey of DOC_ORDER) {
    for (let pageInDoc = 0; pageInDoc < docPageCounts[docKey]; pageInDoc++) {
      await ocrPageCached(docs[docKey], docKey, docHashes[docKey], pageInDoc, ocrCache);
    }
  }
  console.log("OCR complete.\n");

  const pages = allBundlePages(ocrCache, docPageCounts, docHashes);
  console.log(
    `Bundle: ${pages.length} pages, numbered 0-${pages.length - 1} across ` +
      `${DOC_ORDER.join(" then ")}.\n`,
  );

  // The ground truth names pages within a document, because that is what a
  // person opens; the model answers in bundle-global indexes. Resolve one to
  // the other once, here, rather than in three places below.
  for (const entry of GROUND_TRUTH) {
    entry.acceptedPages = [entry.page, ...(entry.altPages ?? [])].map((p) =>
      globalIndexOf(pages, entry.doc, p),
    );
  }

  // OCR every ground-truth crop image any slot-to-run needs, once, up front.
  // This is what the score is measured against -- see the file header and
  // the "Ground-truth crop OCR" section above.
  //
  // Same engine as the pages above, always. See the file header: scoring
  // Gemini page geometry against tesseract crop text runs the comparison
  // through a fuzzy tolerance tuned for tesseract's error modes, and this
  // harness reports a failure there as an OCR-quality note rather than as a
  // regression -- so the mismatch would hide the very thing being measured.
  console.log(
    `Running OCR on ground-truth crop images with ${OCR_ENGINE} (cached crops are skipped)...`,
  );
  const cropEntries = new Map();
  for (const entry of slotsToRun) {
    cropEntries.set(entry.image, await ocrCropCached(entry.image, cropOcrCache));
  }
  console.log("Crop OCR complete.\n");

  // ---- the plain field slots, in ONE call, exactly as production now asks ----
  //
  // THE GATE HAS TO ASK THE WAY PRODUCTION ASKS, or it stops being a gate.
  // `searchRound` and `/api/propose` group every slot sharing a pool into a
  // single `locateSlots` call; a harness still calling `locateSlot` per row
  // would score a code path nothing ships, and would do it while printing the
  // same familiar totals -- which is the wrong-and-quiet shape aimed at the
  // instrument rather than at the product.
  //
  // The whole-document rows and the continuation row are deliberately NOT in
  // here. The first make no model call at all, and the second walks forward
  // from its sibling's answer through `findContinuations`, which is its own
  // production path and its own question.
  // Row name -> a key shaped like a template slot key: lowercase, no spaces,
  // no punctuation the model might normalise away. "KB / ToP (1)" -> "kb_top_1".
  const slugForRow = (row) =>
    row
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const pooledEntries = slotsToRun.filter(
    (entry) => !entry.wholeDocument && !entry.continuationOf,
  );
  let pooledOutcomes = new Map();
  let pooledError = null;
  if (pooledEntries.length > 0) {
    const questions = pooledEntries.map((entry) => {
      const { label, hint } = askedAs(entry);
      // A SLUG, NOT THE HUMAN ROW LABEL, and the difference cost a measurement.
      //
      // This passed `entry.slot` -- "KB / ToP (1)", with spaces, a slash and a
      // parenthesised ordinal -- as the reply key. `locateSlots` drops any
      // answer whose key it did not ask for, which is the right guard against a
      // hallucinated key, and the model duly echoed "KB / ToP" without the
      // ordinal. The answer was correct (page 19, lines 12-41) and this harness
      // threw it away, then reported the slot as "the model found no match" and
      // took the dependent continuation row down with it.
      //
      // That is what produced the only sub-12/12 page-selection score ever
      // recorded here, and it was read as evidence that consolidating slots
      // makes the model omit fields. It was evidence about this line. The
      // cached replies show all three runs answering 7 of 7 with correct pages.
      //
      // Production never had the defect: `searchRound` and `/api/propose` key
      // on `slot.key`, already a slug (`kbLanjutan.top`). The gate has to key
      // the same way or it is not measuring production.
      return { key: slugForRow(entry.slot), label, hint };
    });
    console.log(
      `Locating ${questions.length} field slot(s) in ONE call over ${pages.length} pages:\n` +
        questions.map((q) => `  - ${q.key} (asked as "${q.label}")`).join("\n"),
    );
    // One cache entry for the pooled prompt, under a fixed name rather than a
    // slot's. The prompt hash still carries every question, so a changed slot
    // list misses by construction.
    const pooledAsk = makeCachedAsk("__pool__", modelCache);
    try {
      pooledOutcomes = await locateSlots(questions, pages, pooledAsk);
    } catch (err) {
      // A CALL-LEVEL FAILURE COSTS EVERY POOLED ROW, and the gate says so
      // rather than hiding it: production falls back to per-slot calls here,
      // but the harness deliberately does not, because a gate that silently
      // measured the fallback would report the old path's accuracy under the
      // new path's name.
      pooledError = err;
    }
  }
  console.log();

  const results = [];
  for (const entry of slotsToRun) {
    // `hint` is not read here: the pooled call above built its own questions
    // from `askedAs`, and the continuation branch takes the hint from the
    // template rather than from this row.
    const { label } = askedAs(entry);
    console.log(`Locating "${entry.slot}" (asked as "${label}")...`);
    const cachedAsk = makeCachedAsk(entry.slot, modelCache);

    let result = null;
    let error = null;

    if (entry.wholeDocument) {
      // These four slots are whole-PAGE captures, not localization targets.
      // The sample docx crops for BA Permintaan, Email and both SP pages each
      // cover essentially their entire source page, because a human filling
      // this form screenshots the page -- they do not hunt for a region within
      // it. Asking the model to "find the whole page inside this page" is a
      // category error, and it is precisely how these four failed: it returned
      // a sensible-looking fragment every time.
      //
      // The template config already encodes this distinction, as
      // `layout: "images"` sections versus `layout: "table"` sections, so the
      // product can route on it without new metadata.
      //
      // No model call is made here at all: the proposal is the whole page.
      const pageEntry = pages[entry.acceptedPages[0]];
      const lastLine = pageEntry.lines.length - 1;
      // Written from the array LENGTH, read back by line NUMBER. Those agree
      // only while `lines[k].i === k`, nothing in this harness calls
      // `assertLinesWellFormed`, and `boxForLineRange` -- whose count check
      // would throw -- is never reached for a whole-page capture. Without this
      // one comparison a differently numbered page scores against a range
      // naming different text than the rectangle covers, and the gate reports
      // a plausible number. Same guard as `wholePageZone` in
      // src/app/api/propose/handler.ts and the whole-page branch of
      // scripts/generate.mjs.
      if (lastLine >= 0 && pageEntry.lines[lastLine].i !== lastLine) {
        throw new Error(
          `page ${pageEntry.index} has its last line numbered ` +
            `${pageEntry.lines[lastLine].i}, not ${lastLine}: a whole-page ` +
            "citation is written from the array length",
        );
      }
      console.log("    [whole-document] captured the full page, no model call");
      result = {
        zone: {
          pageIndex: pageEntry.index,
          box: { x: 0, y: 0, w: pageEntry.width, h: pageEntry.height },
          lineRange: [0, lastLine],
        },
        text: pageEntry.lines.map((l) => l.text).join("\n"),
        confidence: "high",
      };
    } else if (entry.continuationOf) {
      // A CONTINUATION ROW MEASURES WHAT PRODUCTION MEASURES. It walks forward
      // from the capture its sibling row located, exactly as
      // src/app/api/propose/handler.ts does, rather than running a wide search
      // for a second capture -- which is a question no shipping code asks any
      // more, and which this row used to answer with a hint invented here.
      //
      // Depending on the sibling is deliberate. If `KB / ToP (1)` regresses,
      // this row fails too rather than passing on a lucky wide search, which is
      // the honest coupling: production cannot find a lanjutan for a capture it
      // never found either.
      const parent = results.find((r) => r.entry.slot === entry.continuationOf);
      const parentZone = parent && parent.result ? parent.result.zone : null;
      if (!parentZone) {
        error = new Error(
          `${entry.continuationOf} produced no zone, so there is nothing to ` +
            "walk forward from",
        );
      } else {
        const slotDef = AO_TEMPLATE.sections
          .flatMap((section) => section.slots.map((slot) => ({ section, slot })))
          .find((pair) => pair.slot.key === entry.slotKey);
        if (!slotDef) {
          error = new Error(`no template slot with key ${entry.slotKey}`);
        } else {
          // The pages of the SOURCE DOCUMENT only. A continuation lives on the
          // next page of the same scan; handing it the whole bundle would let
          // it walk across a file boundary, which is never a continuation.
          const parentDoc = pages[parentZone.pageIndex].doc;
          const documentPages = pages.filter((page) => page.doc === parentDoc);
          try {
            const walk = await findContinuations({
              slotLabel: slotDef.slot.label,
              // THE PRODUCTION HINT, from the template, not one written here.
              hint: slotDef.slot.hint,
              zone: parentZone,
              documentPages,
              furniture: runningFurniture(documentPages),
              wholePageCapture: slotDef.section.layout === "images",
              ask: cachedAsk,
            });
            const step = walk.steps.find((s) => s.zone);
            result = step
              ? { zone: step.zone, text: step.text ?? "", confidence: step.confidence ?? "low" }
              : null;
            if (!result) {
              const why = walk.steps.map((s) => s.reason).filter(Boolean);
              error = new Error(
                `findContinuations proposed no lanjutan${why.length ? `: ${why[0]}` : ""}`,
              );
            }
          } catch (err) {
            error = err;
          }
        }
      }
    } else {
      // Answered ALREADY, in the single pooled call above. Reading it back
      // here rather than asking per row is the whole point: production groups
      // these seven questions into one call, so the gate must too.
      if (pooledError) {
        error = pooledError;
      } else {
        const outcome = pooledOutcomes.get(slugForRow(entry.slot));
        if (!outcome) {
          error = new Error("the pooled search returned no outcome for this slot");
        } else if (!outcome.ok) {
          error = new Error(outcome.reason);
        } else {
          result = outcome.result;
        }
      }
    }

    const verdict = error
      ? { pass: false, detail: `locate failed: ${error.message}` }
      : evaluate(entry, result, pages, cropEntries);

    results.push({ entry, result, verdict });

    const want = entry.acceptedPages.join(" or ");
    const rangeStr = result ? `page ${result.zone.pageIndex}, lines [${result.zone.lineRange.join(",")}]` : "no proposal";
    console.log(
      `  -> ${verdict.pass ? "PASS" : "FAIL"}  ${rangeStr}` +
        `${interpolationOf(result, pages)}  (expected page ${want})`,
    );
    if (result) {
      const chosen = pages[result.zone.pageIndex];
      if (chosen) console.log(`     that is ${chosen.doc} page ${chosen.pageInDoc}`);
    }
    if (!verdict.pass) console.log(`     ${verdict.detail}`);
    console.log();
  }

  console.log("=".repeat(78));
  // The engine is in the heading so a pasted transcript is self-labelling.
  // Task 8 requires each recorded gate run to say which engine measured it,
  // and a number without that label is not comparable to anything.
  console.log(`SUMMARY  (OCR engine: ${OCR_ENGINE_TAG})`);
  console.log("=".repeat(78));
  console.log(
    `${"Slot".padEnd(20)} ${"Verdict".padEnd(6)} ${"Page".padEnd(16)} ${"Lines".padEnd(12)} Detail`,
  );
  let passCount = 0;
  for (const { entry, result, verdict } of results) {
    if (verdict.pass) passCount++;
    const want = entry.acceptedPages.join("/");
    const pageStr = result ? `${result.zone.pageIndex} (want ${want})` : `- (want ${want})`;
    const lineStr = result ? result.zone.lineRange.join(",") : "-";
    console.log(
      `${entry.slot.padEnd(20)} ${(verdict.pass ? "PASS" : "FAIL").padEnd(6)} ${pageStr.padEnd(16)} ${lineStr.padEnd(12)} ${verdict.pass ? "" : verdict.detail}`,
    );
  }
  console.log("-".repeat(78));
  console.log(`TOTAL: ${passCount} / ${results.length} passed`);
  console.log();

  // Report the model-dependent number on its own. Four slots are deterministic
  // whole-page captures that make no model call, so folding them into one
  // headline figure would flatter the localization design by counting work the
  // model never did. The field-slot line is the one that actually tests the
  // "OCR anchors + line addressing" bet.
  const field = results.filter((r) => !r.entry.wholeDocument);
  const whole = results.filter((r) => r.entry.wholeDocument);
  const fieldPass = field.filter((r) => r.verdict.pass).length;
  const wholePass = whole.filter((r) => r.verdict.pass).length;
  console.log(
    `  field slots (model-located):    ${fieldPass} / ${field.length}` +
      "   <- this is the number that tests the design",
  );
  console.log(
    `  whole-document slots (no model): ${wholePass} / ${whole.length}` +
      "   <- deterministic full-page capture",
  );
  console.log();

  const pageOkCount = results.filter((r) => r.verdict.pageOk).length;
  console.log(
    `Page selection alone: ${pageOkCount} / ${results.length} landed on the expected page.`,
  );
  console.log();

  // Crop extent. SCORED FOR FIELD SLOTS since 2026-09-03 (see
  // `INFLATION_MULTIPLE`), reported only for whole-document ones, which take
  // the page by construction. The required range is printed for PASSING slots
  // too, which the summary above never showed: without it there is no way to
  // see how much slack a passing slot has, so a prompt change that quietly
  // walks a slot to the edge of containment looks identical to one that
  // leaves it comfortable.
  console.log(
    `Crop extent (field slots scored at ${INFLATION_MULTIPLE}x; ` +
      "whole-document slots reported only -- see evaluate()):",
  );
  console.log(
    `${"Slot".padEnd(20)} ${"Chosen".padEnd(10)} ${"Human".padEnd(10)} ` +
      `${"Height".padEnd(9)} ${"Human".padEnd(9)} ${"Inflation".padEnd(14)} HumanGap`,
  );
  let worstHumanGap = 0;
  // The widest inflation any FIELD slot reached, which is the number
  // `INFLATION_MULTIPLE` has to stay above. Whole-document slots are excluded
  // from it for the same reason they are exempt from the cap itself.
  let worstFieldInflation = 0;
  for (const { entry, verdict } of results) {
    if (verdict.requiredHeightPx === undefined) {
      console.log(`${entry.slot.padEnd(20)} (no extent: ${verdict.detail})`);
      continue;
    }
    const ratio = verdict.chosenHeightPx / verdict.requiredHeightPx;
    const gap = verdict.humanGapRatio;
    if (gap !== null && gap > worstHumanGap) worstHumanGap = gap;
    if (!entry.wholeDocument && ratio > worstFieldInflation) {
      worstFieldInflation = ratio;
    }
    console.log(
      `${entry.slot.padEnd(20)} ` +
        `${verdict.lineRange.join(",").padEnd(10)} ` +
        `${verdict.requiredLineRange.join(",").padEnd(10)} ` +
        `${(inches(verdict.chosenHeightPx).toFixed(2) + "in").padEnd(9)} ` +
        `${(inches(verdict.requiredHeightPx).toFixed(2) + "in").padEnd(9)} ` +
        `${(ratio.toFixed(2) + "x" + (ratio >= 2 ? "  <- inflated" : "")).padEnd(14)} ` +
        `${gap === null ? "-" : gap.toFixed(1) + "x"}`,
    );
  }
  console.log();
  // The safety margin behind INFLATION_MULTIPLE, printed in the same shape as
  // FOOTER_GAP_MULTIPLE's below and for the same reason: the cap is calibrated
  // against twelve human crops on one bundle, so the run has to say how much
  // room is left between it and the widest answer it accepts. A bundle that
  // closes this margin has turned the cap into a source of false failures, and
  // that shows up here rather than as an unexplained regression.
  console.log(
    `Widest field-slot inflation: ${worstFieldInflation.toFixed(2)}x its human crop. ` +
      `INFLATION_MULTIPLE is ${INFLATION_MULTIPLE}x.`,
  );
  console.log(
    worstFieldInflation > INFLATION_MULTIPLE
      ? "  A field slot exceeded the cap and FAILED on height alone -- its row " +
          "above says by how much."
      : `  Margin: the cap sits ${(INFLATION_MULTIPLE / (worstFieldInflation || 1)).toFixed(1)}x ` +
          "above the tallest answer this run accepted.",
  );
  console.log();
  // The safety margin behind FOOTER_GAP_MULTIPLE, printed rather than
  // asserted. HumanGap is the largest gap inside a human-authored crop, in
  // units of that crop's own line pitch -- content spacing the trim must never
  // cut. The constant has to sit above every value in that column; how far
  // above is the margin, and if a future bundle pushes this number up to the
  // constant, the trim is no longer safe and this line is where that shows up.
  console.log(
    `Largest gap inside any human crop: ${worstHumanGap.toFixed(1)}x its own line pitch. ` +
      `FOOTER_GAP_MULTIPLE is ${FOOTER_GAP_MULTIPLE}x.`,
  );
  console.log(
    worstHumanGap >= FOOTER_GAP_MULTIPLE
      ? "  WARNING: a human crop contains a gap at or above the trim threshold -- " +
          "trimRunningFooter can now cut real evidence."
      : `  Margin: the trim fires no earlier than ${(FOOTER_GAP_MULTIPLE / (worstHumanGap || 1)).toFixed(1)}x ` +
          "beyond the widest legitimate in-crop gap measured.",
  );
  console.log();

  // The other half of the trim's safety, and a different question from the one
  // above: not "does it fire too early" but "how much does it delete when it
  // does". See MAX_FOOTER_LINES in locate.ts. Every page of the bundle is
  // measured, not just the ones a slot landed on, because a footer's size is a
  // property of the page rather than of this run's answers.
  let worstTail = 0;
  const tails = [];
  for (const p of pages) {
    const tail = footerTailLines(p.lines);
    if (tail === 0) continue;
    tails.push(`${p.doc} p${p.pageInDoc}: ${tail}`);
    if (tail > worstTail) worstTail = tail;
  }
  console.log(
    `Running footers, measured page by page: ${tails.length} of ${pages.length} pages have a ` +
      `gap at or above ${FOOTER_GAP_MULTIPLE}x, with ${worstTail} line(s) below it at the widest ` +
      `(${tails.join(", ") || "none"}). MAX_FOOTER_LINES is ${MAX_FOOTER_LINES}.`,
  );
  console.log(
    worstTail > MAX_FOOTER_LINES
      ? "  WARNING: a real footer here is longer than the trim is allowed to delete -- " +
          "trimRunningFooter now declines on that page and its crops run to the page bottom."
      : `  Margin: the cap allows ${MAX_FOOTER_LINES - worstTail} line(s) more than the longest ` +
          "footer this bundle demonstrates.",
  );
  console.log();

  // ---------------------------------------------------------------------
  // What each page's OCR looked like, page by page, on every run.
  //
  // The per-page OCR log lines above only print on a cache MISS, which means
  // that on the second run of a comparison -- the run whose numbers actually
  // get read -- they do not print at all. That is how the 2026-09-02 run
  // shipped a score computed over two materially incomplete page reads with
  // nothing in its output saying so.
  //
  // RECOMPUTED FROM THE CACHED LINES, not read off the cached `report`. Two
  // reasons, and both matter. A report written by an earlier run carries that
  // run's fields and that run's alarms, so reading it back would print the
  // retired interpolation warning and none of the new measurements; and
  // recomputing is what makes these alarms verifiable on a cached re-run that
  // costs no model calls at all. `pageGeometry` takes lines and a height and
  // touches no pixels, which is precisely what allows that.
  //
  // `blocks` and `dropped` still come from the report, because they are facts
  // about a reply the cache no longer holds.
  // ---------------------------------------------------------------------
  const reports = pages.map((p) => p.report).filter(Boolean);
  if (reports.length > 0) {
    const sum = (f) => reports.reduce((acc, r) => acc + f(r), 0);
    const totalLines = sum((r) => r.lines);
    const interpolated = sum((r) => r.interpolatedLines);
    const share = totalLines > 0 ? (100 * interpolated) / totalLines : 0;

    console.log("Per-page OCR, every page of the bundle:");
    console.log(
      "  page        lines   chars   cover     ink  uncov   medH  collapsed  density  interp",
    );
    const flagged = [];
    // Pages whose stored report carries no completeness numbers at all. They
    // are not passes: see the `ink` column's own note below.
    let unmeasured = 0;
    for (const p of pages) {
      if (!p.report) continue;
      const g = pageGeometry(p.lines, p.height);
      const interp = p.lines.filter((l) => l.origin === "interpolated").length;
      console.log(
        "  " +
          `${p.doc} p${p.pageInDoc}`.padEnd(12) +
          String(p.lines.length).padStart(5) +
          String(g.transcribedChars).padStart(8) +
          g.verticalCoverage.toFixed(3).padStart(8) +
          // The only two columns here that cannot be recomputed from the cached
          // lines: they need the page's pixels, so they are whatever the run
          // that OCR'd this page measured. "n/m" is not a pass and not a
          // failure -- it means NOT MEASURED: an entry written before the
          // assertion existed, or a tesseract entry.
          (typeof p.report.inkCoverage === "number"
            ? p.report.inkCoverage.toFixed(3)
            : "n/m"
          ).padStart(8) +
          (typeof p.report.uncoveredInkRunShare === "number"
            ? `${(100 * p.report.uncoveredInkRunShare).toFixed(1)}%`
            : "n/m"
          ).padStart(7) +
          String(Math.round(g.medianLineHeight)).padStart(7) +
          String(g.collapsedBlocks).padStart(11) +
          g.lineDensityRatio.toFixed(3).padStart(9) +
          String(interp).padStart(8),
      );
      // A CACHED entry can carry a coverage the running guard never saw: it was
      // written before the assertion existed, or by a run that failed later.
      // The assertion itself cannot re-fire here -- that would need the pixels
      // -- so the number it left behind is re-read instead, and a page below
      // the threshold is flagged rather than merely printed.
      const reasons = [...g.reasons];
      if (typeof p.report.inkCoverage !== "number") unmeasured += 1;
      if (
        typeof p.report.inkCoverage === "number" &&
        p.report.inkCoverage < MIN_INK_COVERAGE
      ) {
        reasons.push(
          `short page: its returned boxes reached ${(100 * p.report.inkCoverage).toFixed(0)}% ` +
            `of this page's own ink, under the ${(100 * MIN_INK_COVERAGE).toFixed(0)}% ` +
            "the completeness assertion requires",
        );
      }
      if (
        typeof p.report.uncoveredInkRunShare === "number" &&
        p.report.uncoveredInkRunShare > MAX_UNCOVERED_INK_RUN_SHARE
      ) {
        reasons.push(
          `uncovered ink: ${(100 * p.report.uncoveredInkRunShare).toFixed(1)}% of ` +
            "this page's height carries ink no returned box covers, over the " +
            `${(100 * MAX_UNCOVERED_INK_RUN_SHARE).toFixed(1)}% the completeness ` +
            "assertion allows",
        );
      }
      if (reasons.length > 0) flagged.push({ page: p, reasons });
    }
    console.log();

    if (flagged.length > 0) {
      console.log(
        `  WARNING: ${flagged.length} of ${reports.length} page(s) look incompletely read:`,
      );
      for (const f of flagged) {
        console.log(`    ${f.page.doc} p${f.page.pageInDoc}: ${f.reasons.join("; ")}`);
      }
    } else {
      console.log(
        `  No page of ${reports.length} tripped the collapsed-block, thin-page, ` +
          "short-page or uncovered-ink check.",
      );
    }

    // The completeness assertion's own tally, printed on every run including
    // the run where it did nothing. See `shortReads`: a silent guard and an
    // absent guard read identically, and the Task 7 verdict asks specifically
    // for "either zero firings or firings that recovered".
    //
    // These count THIS run's model calls, so a fully cached re-run reports zero
    // by construction -- no page was read, so none could come back short. That
    // is why the sentence says how many pages were actually read: "0 short
    // reads" over 0 fresh reads and "0 short reads" over 29 of them are the
    // same words about entirely different evidence, and the first is exactly
    // what an unarmed guard also prints.
    const fresh = reports.length - unmeasured;
    console.log(
      `  Completeness assertion: ${shortReads} short read(s) this run, ` +
        `${recoveredPages} page(s) recovered by a re-read, over ${fresh} of ` +
        `${reports.length} page(s) carrying a measured ink coverage` +
        (unmeasured > 0
          ? `. The other ${unmeasured} were served from a cache written before ` +
            "the assertion existed (or by tesseract), so they are NOT MEASURED " +
            `-- delete ${OCR_CACHE_PATH} to score them.`
          : "."),
    );
    console.log();

    // A NUMBER, NOT A WARNING, and the demotion is deliberate: as an alarm this
    // fired on 21 of 29 pages, healthy ones included, and stayed silent on both
    // pages that were genuinely broken. What it says as a number is a statement
    // about the DESIGN, not about any one page -- the spec says a multi-line
    // block is sliced into equal vertical bands and the resulting per-line
    // boxes are computed rather than returned, the 12px CROP_PADDING_PX absorbs
    // the error the probe measured, and at this share the pipeline has quietly
    // become "trust the model's block box with a 12px pad". That is a thing to
    // record and argue about once, which is what the Task 7 verdict does.
    console.log(
      `OCR geometry across ${reports.length} pages: ${sum((r) => r.blocks)} model entries -> ` +
        `${totalLines} lines, of which ${interpolated} (${share.toFixed(0)}%) were sliced out of a ` +
        `multi-line block rather than returned. ${sum((r) => r.droppedEntries)} entries dropped.`,
    );
    console.log();
  }

  if (!only) {
    console.log(
      "Note: this scores 12 individually-locatable crops, not the 11 the brief and\n" +
        "the design doc name -- see the file header comment and the task-7 report for\n" +
        "why (SP and ToP each contribute two crops on two different pages).",
    );
  }

  // 11, not 9. Nine was the number the flat "+2 extra lines" rule produced;
  // under containment with a proportional cap, on the whole-bundle pool and
  // with production labels and hints, this bundle measures 11/12, and the one
  // miss (`KB / ToP (2)`, the remittance-account block, whose human crop
  // starts at the page letterhead) is a known, recorded miss rather than
  // headroom. Leaving the bar at 9 would let two slots regress silently.
  //
  // 11 is calibrated against TESSERACT's line numbering, on this bundle. It is
  // deliberately not moved in the commit that adds the engine switch: a
  // threshold retuned in the same run as the change it is meant to judge
  // measures nothing. The plan's Task 8 re-sets it against the post-migration
  // baseline and rewrites this comment with the engine it was set from.
  const PASS_THRESHOLD = 11;
  process.exitCode = only || passCount >= PASS_THRESHOLD ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
