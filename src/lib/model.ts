import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

/**
 * The single place the app learns how to reach a model.
 *
 * Everything upstream receives an AI SDK `LanguageModel` and knows nothing
 * about who serves it. Keep provider SDK imports out of app code so that
 * changing runtimes stays a change to this file rather than a refactor.
 */

/**
 * Chosen by measurement, not by version number. `gemini-3.7-flash` was the
 * newest GA flash tag and took 99-190s on a trivial vision call with
 * intermittent 503s, past `maxDuration` in the chat route. This answers the
 * same probe in about 2s. Re-run `pnpm smoke` before moving it.
 */
export const MODEL_ID = process.env.MODEL_ID ?? "gemini-3.5-flash";

/**
 * The model that reads the scans, which is DELIBERATELY ALLOWED TO BE A
 * DIFFERENT AND CHEAPER ONE than the model that reasons about them.
 *
 * ## Why this is a second binding rather than a second opinion
 *
 * The two jobs this app asks of a model are not the same job, and measurement
 * says so. Per 29-page bundle, attributed by stage:
 *
 *   OCR       29 image calls, ~36k input, ~58k OUTPUT  -- about 70% of the bill
 *   locate     7 text calls, ~122k input, ~1k output   -- about 22%
 *   the rest   classify, extract, verify               -- about 8%
 *
 * OCR is the only call in this app whose legitimate reply is long: it returns
 * every text block on a 300 DPI page with its box. So OCR is priced almost
 * entirely on OUTPUT tokens, where `gemini-3.5-flash` bills $9.00/M against
 * `gemini-3.5-flash-lite`'s $2.50/M. Everything else is priced on INPUT, where
 * the same pair is $1.50 against $0.30.
 *
 * That asymmetry is the whole argument. Transcription is a perception task
 * with a checkable answer; choosing which clause answers "Jangka Waktu" is a
 * judgement call that a validator signs. Paying the reasoning tier's output
 * rate to transcribe is paying for the wrong thing, and one model id for both
 * made that impossible to express.
 *
 * ## Its default is INDEPENDENT of MODEL_ID, because the two were measured
 * separately and did not come out the same
 *
 * Three OCR candidates were run against the gate on the sample bundle,
 * 2026-09-03, three samples each, with the reasoning model held at
 * `gemini-3.5-flash` and the ground-truth crops pinned to a fixed reference so
 * the yardstick could not move:
 *
 *   OCR model                totals      field slots  page sel  collapsed blocks
 *   gemini-3.5-flash         11, 9, 11   7, 5, 7      12/12     20
 *   gemini-3.8-flash         11, 10, 11  7, 6, 7      12/12     59
 *   gemini-3.5-flash-lite     9           5           12/12     43
 *
 * `gemini-3.8-flash` scores equal-or-better than the model it replaces at HALF
 * the price, and answers a vision probe in 2.6s. It is the default.
 *
 * TWO CAVEATS, BOTH REAL. First, it returns coarser geometry: 59 collapsed
 * blocks against 20, a collapsed block being a paragraph returned as one box
 * instead of per-line boxes. That did not cost a gate slot -- widest crop
 * inflation was 1.75x against a 2x cap -- but it is the metric to watch, and
 * `scripts/compare-ocr.mjs` is what watches it. Second,
 * `gemini-3.5-flash-lite` is cheaper still and was REJECTED: same character
 * count, coarser geometry, a worse gate score, and it refused one crop
 * outright with `finishReason=RECITATION`, deterministically, through six
 * retries.
 *
 * THE REASONING SIDE WENT THE OTHER WAY, which is why this is a separate
 * constant rather than one model id for the run. Moving the reasoning stages
 * to `gemini-3.8-flash` as well measured 10, 10, 10 and failed
 * `KB / Tanggal` on every sample. Same model, opposite verdict, different job.
 * Do not "simplify" these two back into one.
 *
 * ## The cache hazard, which is real and is handled
 *
 * Both scripts' OCR caches key on the OCR model id (`OCR_ENGINE_TAG`). They
 * used to key on `MODEL_ID`, which was the same thing until this constant
 * existed and is now the wrong one: with `OCR_MODEL_ID` set and `MODEL_ID`
 * unchanged, a `MODEL_ID`-keyed cache would serve one model's page text while
 * the banner named another. Both tags were moved to `OCR_MODEL_ID` in the same
 * change that added this.
 */
export const DEFAULT_OCR_MODEL_ID = "gemini-3.8-flash";

export const OCR_MODEL_ID = process.env.OCR_MODEL_ID ?? DEFAULT_OCR_MODEL_ID;

/** Human-readable target, for logs and error copy. */
export const MODEL_TARGET = `${MODEL_ID} on the Gemini API`;

/** The same, for the OCR binding, which may be a different model. */
export const OCR_MODEL_TARGET = `${OCR_MODEL_ID} on the Gemini API`;

/**
 * Cost controls, measured against this model:
 *
 *   mediaResolution  LOW 274 | MEDIUM 528 | HIGH 1110 prompt tokens per image
 *   thinkingLevel    minimal 0 | low 40 | medium 194 | high 324 thought tokens
 *
 * Image cost is a flat rate per tier: 791x1024 and 1700x2200 pages billed
 * identically, so rendering pages larger costs upload and IndexedDB space but
 * not API tokens. `TARGET_EDGE` in src/lib/attachments/pdf.ts is therefore a
 * payload limit, not a cost lever.
 *
 * The defaults are deliberate. HIGH is what dense scans need -- this project
 * exists to read small print off documents, and MEDIUM halves the cost by
 * discarding exactly the detail that decides a verdict. Thinking is the cheap
 * win instead: "low" drops 79% of thought tokens against Gemini's own default
 * of medium, and thought tokens bill at the output rate. Both are env-tunable
 * so a deployment can trade accuracy for cost without editing code.
 */
export const MEDIA_RESOLUTION =
  process.env.GEMINI_MEDIA_RESOLUTION ?? "MEDIA_RESOLUTION_HIGH";

export const THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL ?? "low";

/**
 * A runaway-generation guard, not a budget. Gemini 3.5 Flash will emit up to
 * 65536 output tokens; a loop that hits that ceiling is a bill, not an answer.
 * Ample for chat and for the validator's JSON verdicts. Raise it if a legitimate
 * reply ever comes back with `finishReason: "length"`.
 */
export const MAX_OUTPUT_TOKENS = Number(
  process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 4096,
);

/**
 * The OCR stage's own cap, and deliberately NOT a raise of the global one.
 *
 * `MAX_OUTPUT_TOKENS` above is a genuine runaway guard for four-field JSON
 * verdicts -- a classify span, a locate range, an extracted value -- where
 * anything past a few hundred tokens is a loop rather than an answer. OCR is
 * the one call in this app whose legitimate reply is long: it returns every
 * text block on a 300 DPI page with its box, and a dense contract page was
 * measured emitting 2554 output tokens. Deleting the 4096 guard everywhere to
 * serve that one call site would trade a real protection for no gain, so the
 * OCR path gets its own ceiling and the guard stays where it is.
 *
 * Still a ceiling, not a budget. A reply that hits it is truncated, and a
 * truncated line list is a SILENTLY SHORT PAGE -- which is why the OCR callers
 * throw on `finishReason === "length"` rather than warning the way the text
 * path does. Raise this if a legitimate page ever hits it.
 */
export const OCR_MAX_OUTPUT_TOKENS = Number(
  process.env.GEMINI_OCR_MAX_OUTPUT_TOKENS ?? 16384,
);

/**
 * Anything with the shape this function reads. Deliberately `unknown`-valued:
 * these properties are what a provider or the platform happens to hang on a
 * rejection, not a contract anybody typed for us, so the checks below test the
 * value rather than trusting a declaration.
 */
type ErrorLike = {
  isRetryable?: unknown;
  statusCode?: unknown;
  name?: unknown;
  code?: unknown;
  cause?: unknown;
};

/**
 * Node's transport-level failures, which arrive as `TypeError: fetch failed`
 * carrying the real reason on `cause.code` and NO status anywhere.
 *
 * MEASURED, not imagined: a 29-page OCR run died at page 13 with
 * `TypeError: fetch failed { cause: Error: read ECONNRESET }`. Twelve pages
 * were already paid for. Every one of these is the connection breaking rather
 * than the server answering, so retrying asks the question again instead of
 * spending the same tokens to be told the same thing -- the test that
 * separates a transient from a verdict everywhere else in this function.
 */
const TRANSPORT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * Is this rejection worth retrying, or is it the answer?
 *
 * IT READS THE ERROR OBJECT, NEVER `String(error)`, and that is not a style
 * preference. The first version of this tested the message text for
 * `503|429|unavailable|...`, and a real Gemini 503 got past it and killed a
 * run that had already spent 100k tokens: the message is "This model is
 * currently experiencing high demand. Spikes in demand are usually temporary."
 * -- no status code and no "unavailable" anywhere in `toString()`, because the
 * code and the status live on the error object (`statusCode: 503`,
 * `isRetryable: true`) and in `responseBody`, neither of which `toString()`
 * includes. Measured on the real bundle, not imagined. `model.test.mts` drives
 * that exact shape, so a message-matching rewrite goes red.
 *
 * `AbortSignal.timeout` rejects with a DOMException carrying no status at all,
 * so that case is matched by name.
 *
 * It lives in the provider boundary because it reads provider error SHAPES,
 * which is what this file is for, and because it is about to have three
 * callers. It spent its life private to `scripts/generate.mjs`, which nothing
 * under `src/lib` can import -- which is why `/api/propose`'s `ask` has no
 * retry at all.
 */
export function isTransient(error: unknown): boolean {
  const root = error as ErrorLike | null | undefined;

  // The AI SDK wraps the transport's rejection, so the status is as likely to
  // be one level down as it is on the thing that was thrown.
  for (const err of [root, root?.cause as ErrorLike | null | undefined]) {
    if (!err) continue;
    if (err.isRetryable === true) return true;
    const status = err.statusCode;
    if (typeof status === "number") {
      // 408 timeout, 409 conflict, 429 rate limit, and every 5xx. A 4xx that
      // is not one of those is a verdict about the request itself: retrying it
      // spends the same tokens to be told the same thing.
      if (status === 408 || status === 409 || status === 429 || status >= 500) {
        return true;
      }
    }
    if (err.name === "TimeoutError" || err.name === "AbortError") return true;
    // A transport failure carries no status at all, so it must be matched on
    // `code`. See TRANSPORT_CODES: this is the case that killed a run which
    // had already OCR'd twelve pages.
    if (typeof err.code === "string" && TRANSPORT_CODES.has(err.code)) {
      return true;
    }
  }
  return false;
}

/** Per-request Gemini settings. Mirrored by `scripts/smoke.mjs`. */
export const providerOptions = {
  google: {
    mediaResolution: MEDIA_RESOLUTION,
    thinkingConfig: { thinkingLevel: THINKING_LEVEL },
  },
};

/**
 * Built on first request rather than at import time. A missing key would
 * otherwise throw while Next is collecting routes and fail the build instead of
 * the request that actually needs the credential.
 */
let cached: LanguageModel | undefined;
let cachedOcr: LanguageModel | undefined;

/**
 * The credential check, shared by both bindings so that neither can drift into
 * a different error message for the same missing key.
 */
function provider() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set. Copy .env.example to .env.local and add the key.",
    );
  }
  return createGoogleGenerativeAI({ apiKey });
}

export function chatModel(): LanguageModel {
  if (cached) return cached;
  cached = provider().languageModel(MODEL_ID);
  return cached;
}

/**
 * The binding for whole-page recognition, and for nothing else.
 *
 * SEPARATE FROM `chatModel` SO THE CHEAP TIER CANNOT LEAK INTO A JUDGEMENT.
 * The saving that motivates `OCR_MODEL_ID` is on OCR's output tokens; applying
 * the same model to locate or extract would be a second, unmeasured change
 * riding along on the first, and the two have completely different evidence
 * behind them. OCR quality is checkable against a page's own ink coverage and
 * against the human-authored crops, which is what `pnpm measure:locate` prints
 * a per-page table for. Locate quality is measured by a gate whose score moves
 * by two slots between identical runs.
 *
 * The crop-level verification pass in `src/lib/pipeline/verify.ts` also sends
 * images and deliberately does NOT use this. Its whole job is to re-read small
 * print more carefully than the whole-page pass did, and re-reading it with the
 * cheaper model would weaken the guard that exists to catch the cheaper
 * model's most likely mistake.
 */
export function ocrModel(): LanguageModel {
  if (cachedOcr) return cachedOcr;
  // Same object when the ids agree, so the default configuration keeps one
  // client and one connection pool rather than two identical ones.
  if (OCR_MODEL_ID === MODEL_ID) return chatModel();
  cachedOcr = provider().languageModel(OCR_MODEL_ID);
  return cachedOcr;
}
