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
