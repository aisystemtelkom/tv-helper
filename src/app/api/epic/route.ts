/**
 * The EPIC checkpoint's production binding, and nothing else.
 *
 * IT GATES ITSELF, exactly as every other model-backed route here does.
 * `src/proxy.ts` also refuses an unauthenticated `/api/*` request, but proxy is
 * an optimization, not the boundary: Next's own reference warns that a matcher
 * change or a refactor that moves work to a different route silently removes
 * proxy coverage. `requireApiUser()` below is the check that decides, and
 * `src/app/api/epic/epic.test.mts` proves it holds when proxy never ran.
 *
 * `src/lib/model.ts` stays the only file that knows how the model is reached.
 * This file turns that `LanguageModel` into the pipeline's `Ask` -- a
 * `(prompt: string) => Promise<string>` -- and hands it to `checkEpic`, which
 * never learns who answered. It is also the only file under this directory that
 * may import `src/lib/model.ts` at all.
 *
 * TEXT ONLY, ON A CHECKPOINT WHOSE INPUT IS SCREENSHOTS. The captures were
 * recognised by `/api/ocr` before they got here and arrive as lines; there is
 * no image part in this call and `generateText` is handed a prompt string. See
 * the header of `./handler.ts`.
 */

import { generateText } from "ai";

import { requireApiUser } from "@/lib/auth/require-user";
import {
  chatModel,
  providerOptions,
  CHECKPOINT_MAX_OUTPUT_TOKENS,
  MODEL_ID,
  MODEL_TARGET,
} from "@/lib/model";

import {
  checkEpic,
  createEpicHandler,
  type EpicBody,
  type EpicResult,
} from "./handler.ts";

/**
 * ONE call, but a large one: every capture's recognised lines and every field
 * of the workbook go into a single prompt, and `compareToEpic` does not chunk.
 * The ceiling is for the slow end of that against a full set of screens, not
 * for the expected case -- which is well inside `/api/ocr`'s 120.
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
    maxOutputTokens: CHECKPOINT_MAX_OUTPUT_TOKENS,
    providerOptions,
  });

  /*
   * PER CALL, in the shape every other route here logs. There is only one call
   * per request today, so this line and the delta below agree -- and they are
   * both kept, because the day `compareToEpic` gains a chunk the per-request
   * line stops being able to say how big any single prompt was. `thoughts=` is
   * broken out because thought tokens bill at the OUTPUT rate and are otherwise
   * invisible inside `out=`.
   *
   * `src/lib/cost.ts` declares an `"epic"` row for the same spend; that ledger
   * is the SCRIPT side, where one run is one process and a table can be printed
   * at the end. A route serves many operators from one container, so what it
   * can honestly report is per request, to the log.
   */
  const thoughts = result.usage.outputTokenDetails?.reasoningTokens ?? 0;

  calls += 1;
  promptTokens += result.usage.inputTokens ?? 0;
  outputTokens += result.usage.outputTokens ?? 0;
  thoughtTokens += thoughts;
  totalTokens += result.usage.totalTokens ?? 0;

  console.log(
    `[epic] ${MODEL_ID} call=${calls} in=${result.usage.inputTokens ?? "?"} ` +
      `out=${result.usage.outputTokens ?? "?"} (thoughts=${thoughts}) ` +
      `total=${result.usage.totalTokens ?? "?"} finish=${result.finishReason}`,
  );

  if (result.finishReason === "length") {
    console.warn(
      `[epic] hit the ${CHECKPOINT_MAX_OUTPUT_TOKENS}-token output cap; the ` +
        "reply is truncated and will almost certainly fail to parse. Raise " +
        "GEMINI_CHECKPOINT_MAX_OUTPUT_TOKENS if this is legitimate.",
    );
  }

  return result.text;
}

/**
 * Cost is visible in the server log rather than a month later on an invoice,
 * which is the rule every other route here follows. `captures=` and `fields=`
 * are both here because they are the two halves of this prompt and they scale
 * independently: a second screen and twenty more workbook rows are different
 * kinds of growth.
 */
async function check(body: EpicBody): Promise<EpicResult> {
  const startedCalls = calls;
  const startedIn = promptTokens;
  const startedOut = outputTokens;
  const startedThoughts = thoughtTokens;
  const startedTotal = totalTokens;
  const startedAt = Date.now();

  try {
    return await checkEpic(body, ask);
  } finally {
    console.log(
      `[epic] cost ${MODEL_ID} run=${body.runId} ` +
        `captures=${body.captures.length} fields=${body.fields.length} ` +
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
  console.error(`[epic] ${MODEL_TARGET} failed:`, error);

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

export const POST = createEpicHandler({
  gate: requireApiUser,
  check,
  unreachable,
});
