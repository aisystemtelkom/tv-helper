/**
 * The OCR route's production binding, and nothing else.
 *
 * IT GATES ITSELF, exactly as `/api/propose` and `/api/chat` do. `src/proxy.ts`
 * also refuses an unauthenticated `/api/*` request, but proxy is an
 * optimization, not the boundary: Next's own reference warns that a matcher
 * change or a refactor that moves work to a different route silently removes
 * proxy coverage. `requireApiUser()` below is the check that decides, and
 * `src/app/api/ocr/ocr.test.mts` proves it holds when proxy never ran.
 *
 * `src/lib/model.ts` stays the only file that knows how the model is reached.
 * THIS IS THE ONLY FILE UNDER `src/app/api/ocr/` THAT IMPORTS IT: `handler.ts`
 * takes the recognition step as an argument and never learns who answered,
 * which is what lets `node --test` drive the whole gate with no credential.
 *
 * `src/lib/pipeline/gemini-ocr.ts` is shared with `pnpm generate`, so the route
 * and the script run the identical, once-tested conversion. The alternative --
 * returning the model's raw 0-1000 boxes and converting them on the device --
 * was considered and rejected: it would either duplicate that conversion or
 * ship it in the browser bundle, where a deploy cannot fix it.
 */

import { generateObject, jsonSchema } from "ai";

import { requireApiUser } from "@/lib/auth/require-user";
import {
  chatModel,
  isTransient,
  providerOptions,
  MODEL_ID,
  MODEL_TARGET,
  OCR_MAX_OUTPUT_TOKENS,
} from "@/lib/model";
import {
  ocrPageWithGemini,
  type AskImage,
  type ImageInput,
  type ResponseSchema,
} from "@/lib/pipeline/gemini-ocr";

import { createOcrHandler, OcrUnusable } from "./handler.ts";

/**
 * One page, one call. The probe's slowest page was 15.3s at concurrency 4, so
 * this is the ceiling for the slow end and not the expected case; `/api/propose`
 * needs 300 because it makes many sequential calls in one request.
 *
 * NOTE `maxDuration` IS INERT ON CLOUD RUN. Next reads it for platforms that
 * consume the build output, and Cloud Run does not; `--timeout` on the service
 * is the real control. With the retry budget below a single request can
 * legitimately outlive this number, which is another way of saying the same
 * thing.
 */
export const maxDuration = 120;

/**
 * A ceiling on one attempt, not a budget. `generateText` has no timeout of its
 * own, so without this a stalled connection hangs an ingest silently, one page
 * short, with the operator watching a progress bar. `isTransient` counts an
 * abort as retryable, so a stall costs a retry rather than the page.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Four attempts, with `scripts/generate.mjs`'s backoff.
 *
 * `/api/propose` deliberately has no retry and survives it because one failed
 * slot costs one slot, and the operator finishes the document by hand anyway.
 * A FAILED PAGE OF A 29-PAGE INGEST IS NOT THAT. `BrowserRun.pages` is
 * append-only because `Zone.pageIndex` is a position in it, so there is no
 * single-page re-OCR path: the page either lands here or the whole ingest
 * fails and is run again. Gemini's intermittent 503s are recorded in AGENTS.md
 * and cost a measurement run three slots outright.
 */
const ATTEMPTS = 4;

let calls = 0;
let promptTokens = 0;
let outputTokens = 0;
let thoughtTokens = 0;
let totalTokens = 0;

/** What one attempt learned, so the per-page log line can carry it all. */
type CallStats = {
  in: number;
  out: number;
  thoughts: number;
  total: number;
  finish: string;
};

/**
 * "The model could not be reached" wrapped so it cannot be mistaken for "the
 * model answered and the answer was unusable".
 *
 * The same distinction `/api/propose`'s `AskFailed` draws, for a stricter
 * reason: unreachable is a 503 that promises the run is unchanged, unusable is
 * a 502 about this one reply, and a 200 with no lines -- which is what
 * conflating them once produced on the propose route -- would append a
 * permanently blank page to an append-only run.
 */
class ModelUnreachable extends Error {
  reason: unknown;

  constructor(reason: unknown) {
    super("the model could not be reached");
    this.name = "ModelUnreachable";
    this.reason = reason;
  }
}

/**
 * One image call.
 *
 * THE ONE PLACE IN `src/lib/pipeline`'s CALLERS THAT SENDS AN IMAGE. Classify,
 * locate and extract are still provably text-only -- `Ask` is
 * `(prompt: string) => Promise<string>` and has no image parameter anywhere --
 * and `AskImage` has exactly this one consumer plus the two scripts'.
 *
 * `finishReason !== "stop"` THROWS RATHER THAN WARNING, which is the one place
 * this differs from every text ask in the tree. A truncated locate reply fails
 * to parse loudly; a truncated line list is a page that quietly came back
 * short, and short is indistinguishable from sparse once it is stored.
 */
async function askImageOnce(
  prompt: string,
  image: ImageInput,
  schema: ResponseSchema,
  stats: CallStats,
): Promise<string> {
  // `generateObject`, not `generateText`: it forwards the schema to Gemini as
  // `responseSchema`, so generation is CONSTRAINED to the shape rather than
  // asked for it in prose. Measured on four real 300 DPI pages with the same
  // prompt -- unconstrained, 0 of 4 replies were parseable JSON; constrained,
  // 4 of 4. Without this, every page of a real ingest throws and the operator
  // sees an ingest that fails at page 1.
  const result = await generateObject({
    model: chatModel(),
    schema: jsonSchema(schema),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          // A `file` part, not the `image` part the AI SDK deprecated in v7.
          // The two were measured sending the identical request for the
          // identical token count; `image` additionally logs a
          // DeprecationWarning per call, and 29 of those per ingest in the
          // Cloud Run log is exactly the noise a real warning hides in. See
          // the same call in `scripts/generate.mjs`'s `askImageOnce`, which
          // this deliberately matches.
          { type: "file", data: image.bytes, mediaType: image.mediaType },
        ],
      },
    ],
    // OCR-scoped, not the global 4096 runaway guard: a dense page measured 2554
    // output tokens in the probe, and raising the global cap everywhere to
    // serve this one call site would delete a real guard from the JSON verdicts.
    maxOutputTokens: OCR_MAX_OUTPUT_TOKENS,
    providerOptions,
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    // Retries are the loop below instead, so a 503 storm is one visible backoff
    // sequence in this log rather than two nested ones.
    maxRetries: 0,
  });

  const thoughts = result.usage.outputTokenDetails?.reasoningTokens ?? 0;
  stats.in = result.usage.inputTokens ?? 0;
  stats.out = result.usage.outputTokens ?? 0;
  stats.thoughts = thoughts;
  stats.total = result.usage.totalTokens ?? 0;
  stats.finish = result.finishReason;

  calls += 1;
  promptTokens += stats.in;
  outputTokens += stats.out;
  thoughtTokens += thoughts;
  totalTokens += stats.total;

  if (result.finishReason !== "stop") {
    throw new OcrUnusable(
      new Error(
        `the reply stopped with finishReason="${result.finishReason}" and was ` +
          "not parsed. At the OCR cap of " +
          `${OCR_MAX_OUTPUT_TOKENS} output tokens a "length" finish means the ` +
          "line list is cut off part-way down the page; raise " +
          "GEMINI_OCR_MAX_OUTPUT_TOKENS if this is a legitimate page.",
      ),
    );
  }

  // Stringified straight back: `AskImage` is `=> Promise<string>` and
  // `linesFromGeminiReply` owns the parse, so the convention guard and the
  // drop-and-count stay at one seam rather than at every call site.
  return JSON.stringify(result.object);
}

/** Retries transients, tags everything else so the handler can tell them apart. */
async function askImage(
  prompt: string,
  image: ImageInput,
  schema: ResponseSchema,
  stats: CallStats,
): Promise<string> {
  let lastError: unknown;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      return await askImageOnce(prompt, image, schema, stats);
    } catch (error) {
      lastError = error;
      // The model answered; the answer is the problem. Retrying spends the
      // same tokens to be told the same thing.
      if (error instanceof OcrUnusable) throw error;
      if (!isTransient(error) || i === ATTEMPTS - 1) break;
      const backoffMs = Math.min(5000 * 2 ** i, 60_000);
      console.warn(
        `[ocr] transient error, retrying in ${backoffMs}ms: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw new ModelUnreachable(lastError);
}

/**
 * The recognition step the handler injects.
 *
 * Cost is visible in the server log rather than a month later on an invoice,
 * which is the rule every model call site in this project follows. Per page,
 * because a bundle is 29 of them and an average says nothing about which page
 * was expensive. `lines=` and `interpolated=` are the OCR-specific half: a page
 * whose lines are mostly interpolated has quietly stopped being "the rectangle
 * is the union of measured line boxes" and become "trust the model's block box
 * with a 12px pad", and that shows up here first.
 */
async function recognize(png: Uint8Array) {
  const image: ImageInput = { bytes: png, mediaType: "image/png" };
  const stats: CallStats = { in: 0, out: 0, thoughts: 0, total: 0, finish: "?" };
  const ask: AskImage = (prompt, img, schema) =>
    askImage(prompt, img, schema, stats);
  const startedAt = Date.now();

  let lines = "-";
  let interpolated = "-";
  try {
    const result = await ocrPageWithGemini(image, ask);
    lines = String(result.lines.length);
    interpolated = String(result.report.interpolatedLines);
    return result;
  } catch (error) {
    // Never reached the model: unwrap so the 503 names the real provider error
    // rather than the wrapper.
    if (error instanceof ModelUnreachable) throw error.reason;
    // Already classified as "the reply cannot be used".
    if (error instanceof OcrUnusable) throw error;
    // Everything that is left is `linesFromGeminiReply` refusing the reply --
    // unparseable JSON, or too many boxes failing validation, which is what a
    // reply in pixel coordinates instead of 0-1000 looks like. The model was
    // reached, so this is a 502, not a 503.
    throw new OcrUnusable(error);
  } finally {
    console.log(
      `[ocr] ${MODEL_ID} call=${calls} in=${stats.in} out=${stats.out} ` +
        `(thoughts=${stats.thoughts}) total=${stats.total} ` +
        `finish=${stats.finish} lines=${lines} interpolated=${interpolated} ` +
        `${((Date.now() - startedAt) / 1000).toFixed(1)}s ` +
        `run=[calls=${calls} in=${promptTokens} out=${outputTokens} ` +
        `(thoughts=${thoughtTokens}) total=${totalTokens}]`,
    );
  }
}

/**
 * The likely failure is a missing or rejected credential, or quota.
 *
 * SAY SO, AND SAY THE RUN IS UNTOUCHED. This string is what an operator
 * actually reads: the worker copies the route's message verbatim into the
 * `failed` protocol response and the ingest panel shows it. Before this
 * migration a `pnpm dev` with no API key ingested perfectly well, because OCR
 * was local and needed no credential -- so "OCR failed" now has a cause that
 * nothing in the operator's own machine explains.
 */
function unreachable(error: unknown) {
  const cause = error instanceof Error ? error.message : String(error);
  console.error(`[ocr] ${MODEL_TARGET} failed:`, error);

  // `{error: <slug>, message: <prose>, hint}`, the same shape `handler.ts`'s
  // 400/413/502 and `proxy.ts`'s 401 use. This one used to put the prose in
  // `error` on its own, which meant the worker -- reading `error` first --
  // showed the operator readable text for exactly this status and a bare
  // machine slug for every other one. One shape, one reader.
  return Response.json(
    {
      error: "model-unreachable",
      message:
        `Could not reach ${MODEL_TARGET} to read this page. Text recognition is ` +
        "no longer done on the device, so an ingest now needs the server's API " +
        "credential: check that GOOGLE_GENERATIVE_AI_API_KEY is set and still " +
        "valid, that the key has the Generative Language API enabled, and that " +
        "you are not over quota. Run `pnpm smoke` to test the key without the UI.",
      hint: "Nothing in your run has been changed.",
      cause,
    },
    { status: 503 },
  );
}

export const POST = createOcrHandler({
  gate: requireApiUser,
  recognize,
  unreachable,
});
