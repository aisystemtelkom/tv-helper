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

/** Human-readable target, for logs and error copy. */
export const MODEL_TARGET = `${MODEL_ID} on the Gemini API`;

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
  cause?: unknown;
};

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

export function chatModel(): LanguageModel {
  if (cached) return cached;

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is not set. Copy .env.example to .env.local and add the key.",
    );
  }

  cached = createGoogleGenerativeAI({ apiKey }).languageModel(MODEL_ID);
  return cached;
}
