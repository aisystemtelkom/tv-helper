/**
 * The konfigurasi checkpoint's production binding, and nothing else.
 *
 * IT GATES ITSELF, exactly as `/api/propose`, `/api/extract` and `/api/chat`
 * do. `src/proxy.ts` also refuses an unauthenticated `/api/*` request, but
 * proxy is an optimization, not the boundary: Next's own reference warns that a
 * matcher change or a refactor that moves work to a different route silently
 * removes proxy coverage. `requireApiUser()` below is the check that decides,
 * and `src/app/api/config/config.test.mts` proves it holds when proxy never
 * ran.
 *
 * `src/lib/model.ts` stays the only file that knows how the model is reached.
 * This file turns that `LanguageModel` into the pipeline's `Ask` -- a
 * `(prompt: string) => Promise<string>` -- and hands it to `checkConfig`, which
 * never learns who answered. It is also the only file under this directory that
 * may import `src/lib/model.ts` at all.
 *
 * TEXT ONLY, AND THE WORKBOOK IS NOT HERE. Both prompts this route builds are
 * text: a cell listing for the interpretation and a numbered line listing for
 * the comparison. No page image is attached and no `.xlsx` byte ever arrives --
 * see the header of `./handler.ts`.
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
  checkConfig,
  createConfigHandler,
  type ConfigBody,
  type ConfigResult,
} from "./handler.ts";

/**
 * One interpretation call over a cell listing, then one comparison call per
 * chunk of `MAX_FIELDS_PER_CALL` fields -- and every chunk re-sends the WHOLE
 * page listing, which for the 151-page client bundle is the dominant term in
 * the request. So this is not one call, and the ceiling is for the slow end of
 * a first upload against a large bundle.
 *
 * NOTE `maxDuration` IS INERT ON CLOUD RUN. Next reads it for platforms that
 * consume the build output, and Cloud Run does not; `--timeout` on the service
 * is the real control. It is kept accurate anyway, because it is the only place
 * in the tree that states what shape this request has.
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
 * `providerOptions` carries `mediaResolution` regardless, because it is the
 * shared per-request setting -- it simply costs nothing when there is no image,
 * and there is never an image here.
 */
async function ask(prompt: string): Promise<string> {
  const result = await generateText({
    model: chatModel(),
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    providerOptions,
  });

  /*
   * PER CALL, in the shape every other route here logs, because a per-request
   * total hides the thing worth seeing: the interpretation call carries a cell
   * listing measured in hundreds of cells and each comparison call carries the
   * whole bundle as numbered lines, so the calls are nothing like the same size
   * and an average over them says nothing. `thoughts=` is broken out because
   * thought tokens bill at the OUTPUT rate and are otherwise invisible inside
   * `out=`.
   *
   * `src/lib/cost.ts` declares a `"config"` row for the same spend, and the two
   * accountings are not redundant: the ledger is the SCRIPT side, where one run
   * is one process and a table can be printed at the end. A route serves many
   * operators from one container, so what it can honestly report is per request,
   * to the log.
   */
  const thoughts = result.usage.outputTokenDetails?.reasoningTokens ?? 0;

  calls += 1;
  promptTokens += result.usage.inputTokens ?? 0;
  outputTokens += result.usage.outputTokens ?? 0;
  thoughtTokens += thoughts;
  totalTokens += result.usage.totalTokens ?? 0;

  console.log(
    `[config] ${MODEL_ID} call=${calls} in=${result.usage.inputTokens ?? "?"} ` +
      `out=${result.usage.outputTokens ?? "?"} (thoughts=${thoughts}) ` +
      `total=${result.usage.totalTokens ?? "?"} finish=${result.finishReason}`,
  );

  if (result.finishReason === "length") {
    console.warn(
      `[config] hit the ${MAX_OUTPUT_TOKENS}-token output cap; the reply is ` +
        "truncated and will almost certainly fail to parse. Raise " +
        "GEMINI_MAX_OUTPUT_TOKENS if this is legitimate.",
    );
  }

  return result.text;
}

/**
 * Cost is visible in the server log rather than a month later on an invoice,
 * which is the rule every other route here follows. `job=` names which of the
 * two this request was, because a first upload pays for both halves and the one
 * re-search pays only for the second -- and a row that could not say which
 * could not answer the question a deployment actually asks about this
 * checkpoint.
 */
async function check(body: ConfigBody): Promise<ConfigResult> {
  const startedCalls = calls;
  const startedIn = promptTokens;
  const startedOut = outputTokens;
  const startedThoughts = thoughtTokens;
  const startedTotal = totalTokens;
  const startedAt = Date.now();
  const job = body.sheet ? "interpret+compare" : body.retry ? "re-search" : "compare";

  try {
    return await checkConfig(body, ask);
  } finally {
    console.log(
      `[config] cost ${MODEL_ID} run=${body.runId} job=${job} ` +
        `pages=${body.pages.length} fields=${body.fields?.length ?? "?"} ` +
        `calls=${calls - startedCalls} ` +
        `in=${promptTokens - startedIn} out=${outputTokens - startedOut} ` +
        `(thoughts=${thoughtTokens - startedThoughts}) ` +
        `total=${totalTokens - startedTotal} ` +
        `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
  }
}

/**
 * The likely failure is a missing or rejected credential, or quota. Say so
 * instead of surfacing a bare fetch error to an operator mid-order.
 */
function unreachable(error: unknown) {
  const cause = error instanceof Error ? error.message : String(error);
  console.error(`[config] ${MODEL_TARGET} failed:`, error);

  return Response.json(
    {
      error:
        `Could not reach ${MODEL_TARGET}. Check that GOOGLE_GENERATIVE_AI_API_KEY ` +
        "is set and still valid, that the key has the Generative Language API " +
        "enabled, and that you are not over quota. Run `pnpm smoke` to test " +
        "the key without the UI. Nothing in your order has been changed.",
      cause,
    },
    { status: 503 },
  );
}

export const POST = createConfigHandler({
  gate: requireApiUser,
  check,
  unreachable,
});
