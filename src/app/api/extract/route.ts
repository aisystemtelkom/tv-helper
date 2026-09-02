/**
 * The extraction route's production binding, and nothing else.
 *
 * IT GATES ITSELF, exactly as `/api/propose` and `/api/chat` do.
 * `src/proxy.ts` also refuses an unauthenticated `/api/*` request, but proxy
 * is an optimization, not the boundary: Next's own reference warns that a
 * matcher change or a refactor that moves work to a different route silently
 * removes proxy coverage. `requireApiUser()` below is the check that decides,
 * and `src/app/api/extract/extract.test.mts` proves it holds when proxy never
 * ran.
 *
 * `src/lib/model.ts` stays the only file that knows how the model is reached.
 * This file turns that `LanguageModel` into the pipeline's `Ask` -- a
 * `(prompt: string) => Promise<string>` -- and hands it to `extractValues`,
 * which never learns who answered.
 */

import { generateText } from "ai";

import { requireApiUser } from "@/lib/auth/require-user";
import {
  chatModel,
  providerOptions,
  MAX_OUTPUT_TOKENS,
  MODEL_ID,
  MODEL_TARGET,
} from "@/lib/model";

import {
  createExtractHandler,
  extractValues,
  type ExtractBody,
  type ExtractResult,
} from "./handler.ts";

/**
 * One classify call per source document, then one extraction call per
 * docType-ranking group -- two groups for this template. Fewer calls than
 * `/api/propose` makes, but each extraction call carries the whole run's OCR
 * listing (~19-21k input tokens on the sample bundle's 29 pages), and a
 * 155-page bundle scales that directly. The ceiling is for the slow end, not
 * the expected case.
 */
export const maxDuration = 300;

let calls = 0;
let promptTokens = 0;
let outputTokens = 0;
let thoughtTokens = 0;
let totalTokens = 0;

/**
 * The pipeline's `Ask`, over the one model this app knows about.
 *
 * TEXT ONLY. Every prompt `classifyPages` and `extractFields` build is OCR
 * line text; no page image is ever attached, which is what keeps the scans on
 * the operator's device. `providerOptions` carries `mediaResolution`
 * regardless, because it is the shared per-request setting -- it simply costs
 * nothing when there is no image.
 */
async function ask(prompt: string): Promise<string> {
  const result = await generateText({
    model: chatModel(),
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    providerOptions,
  });

  /*
   * PER CALL, in the same shape `/api/propose` and `/api/chat` log, because a
   * per-request total hides the thing worth seeing: an extraction call
   * carries every page of the run as numbered lines while a classify call
   * carries twelve lines a page, so the calls are nothing like the same size
   * and an average over them says nothing. `thoughts=` is broken out because
   * thought tokens bill at the OUTPUT rate and are otherwise invisible inside
   * `out=`.
   */
  const thoughts = result.usage.outputTokenDetails?.reasoningTokens ?? 0;

  calls += 1;
  promptTokens += result.usage.inputTokens ?? 0;
  outputTokens += result.usage.outputTokens ?? 0;
  thoughtTokens += thoughts;
  totalTokens += result.usage.totalTokens ?? 0;

  console.log(
    `[extract] ${MODEL_ID} call=${calls} in=${result.usage.inputTokens ?? "?"} ` +
      `out=${result.usage.outputTokens ?? "?"} (thoughts=${thoughts}) ` +
      `total=${result.usage.totalTokens ?? "?"} finish=${result.finishReason}`,
  );

  if (result.finishReason === "length") {
    console.warn(
      `[extract] hit the ${MAX_OUTPUT_TOKENS}-token output cap; the reply is ` +
        "truncated and will almost certainly fail to parse. Raise " +
        "GEMINI_MAX_OUTPUT_TOKENS if this is legitimate.",
    );
  }

  return result.text;
}

/**
 * Cost is visible in the server log rather than a month later on an invoice,
 * which is the rule `/api/chat` and `/api/propose` both follow. Measured on
 * the sample bundle, one request is ~40-46k input tokens: two key groups
 * times the whole run's OCR listing, plus the classify pass. More pages, or a
 * template with a third ranking group, multiplies that directly.
 */
async function extract(body: ExtractBody): Promise<ExtractResult> {
  const startedCalls = calls;
  const startedIn = promptTokens;
  const startedOut = outputTokens;
  const startedThoughts = thoughtTokens;
  const startedTotal = totalTokens;
  const startedAt = Date.now();

  try {
    return await extractValues(body, ask);
  } finally {
    console.log(
      `[extract] cost ${MODEL_ID} run=${body.runId} pages=${body.pages.length} ` +
        `answered=${body.answered?.length ?? 0} calls=${calls - startedCalls} ` +
        `in=${promptTokens - startedIn} out=${outputTokens - startedOut} ` +
        `(thoughts=${thoughtTokens - startedThoughts}) ` +
        `total=${totalTokens - startedTotal} ` +
        `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
  }
}

/**
 * The likely failure is a missing or rejected credential, or quota. Say so
 * instead of surfacing a bare fetch error to an operator mid-run.
 */
function unreachable(error: unknown) {
  const cause = error instanceof Error ? error.message : String(error);
  console.error(`[extract] ${MODEL_TARGET} failed:`, error);

  return Response.json(
    {
      error:
        `Could not reach ${MODEL_TARGET}. Check that GOOGLE_GENERATIVE_AI_API_KEY ` +
        "is set and still valid, that the key has the Generative Language API " +
        "enabled, and that you are not over quota. Run `pnpm smoke` to test " +
        "the key without the UI. Nothing in your run has been changed.",
      cause,
    },
    { status: 503 },
  );
}

export const POST = createExtractHandler({
  gate: requireApiUser,
  extract,
  unreachable,
});
