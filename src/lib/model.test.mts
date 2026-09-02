/**
 * The provider boundary's two testable exports.
 *
 * No credential and no network: nothing here calls `chatModel()`, so the
 * suite runs in a fresh clone with an empty `.env.local` exactly as the rest
 * of `pnpm test` does.
 *
 * The point of the file is `isTransient`. It decides whether a rejection costs
 * a retry or the whole run, it is about to be shared by `pnpm generate`, the
 * gate harness and `/api/ocr`, and the failure it exists to prevent is INVISIBLE
 * to a reader who only sees the message text. So the tests below drive the
 * error SHAPES a provider actually throws -- including the measured Gemini 503
 * whose `toString()` contains neither a status code nor the word "unavailable"
 * -- and assert that fact directly, so that a "simplification" back to matching
 * `String(error)` goes red instead of quietly killing a run.
 *
 * The env vars are cleared before the import because both caps are read at
 * module load: a shell that happens to carry one would otherwise make the
 * default assertions pass or fail for reasons that have nothing to do with the
 * code.
 */

import assert from "node:assert/strict";
import test from "node:test";

delete process.env.GEMINI_MAX_OUTPUT_TOKENS;
delete process.env.GEMINI_OCR_MAX_OUTPUT_TOKENS;

const { MAX_OUTPUT_TOKENS, OCR_MAX_OUTPUT_TOKENS, isTransient } = await import(
  "./model.ts"
);

// ---------------------------------------------------------------------------
// The output caps.
// ---------------------------------------------------------------------------

test("the OCR cap is separate from the global runaway guard", () => {
  // 4096 is a real protection for four-field JSON verdicts, where anything
  // longer is a loop rather than an answer. It must survive OCR needing more.
  assert.equal(MAX_OUTPUT_TOKENS, 4096);
  assert.equal(OCR_MAX_OUTPUT_TOKENS, 16384);
  assert.ok(
    OCR_MAX_OUTPUT_TOKENS > MAX_OUTPUT_TOKENS,
    "a dense 300 DPI page was measured emitting 2554 output tokens of blocks " +
      "and boxes, well past the verdict-sized guard",
  );
});

// ---------------------------------------------------------------------------
// isTransient: the shapes that must retry.
// ---------------------------------------------------------------------------

/**
 * The one this function exists for, reproduced field by field from the real
 * rejection AGENTS.md records. An earlier message-matching version let this
 * through and killed a run that had already spent 100k tokens.
 */
function gemini503(): Error & { statusCode?: number; isRetryable?: boolean } {
  const error: Error & { statusCode?: number; isRetryable?: boolean } =
    new Error(
      "This model is currently experiencing high demand. Spikes in demand " +
        "are usually temporary.",
    );
  error.statusCode = 503;
  error.isRetryable = true;
  return error;
}

test("the measured Gemini 503 says nothing about itself in its message", () => {
  // This assertion is the whole reason the function reads the object. If it
  // ever stops holding, the tests below stop proving anything, and a reader
  // deciding that message matching would be simpler deserves to see why it
  // is not.
  const text = String(gemini503());
  assert.ok(!/503/.test(text), `status leaked into the message: ${text}`);
  assert.ok(!/unavailable/i.test(text), `"unavailable" appeared in: ${text}`);
  assert.ok(!/retry/i.test(text), `"retry" appeared in: ${text}`);
});

test("the measured Gemini 503 is transient", () => {
  assert.equal(isTransient(gemini503()), true);
});

test("statusCode alone is enough, with no isRetryable flag", () => {
  // Not every provider error carries the SDK's own verdict; a raw transport
  // rejection carries only the status.
  for (const statusCode of [408, 409, 429, 500, 502, 503, 504]) {
    assert.equal(
      isTransient(Object.assign(new Error("boom"), { statusCode })),
      true,
      `gave up on a ${statusCode}`,
    );
  }
});

test("isRetryable alone is enough, with no status", () => {
  assert.equal(
    isTransient(Object.assign(new Error("boom"), { isRetryable: true })),
    true,
  );
});

test("a status one level down, on the cause, still counts", () => {
  // The AI SDK wraps the transport's rejection, so the shape that reaches a
  // caller is routinely an outer error carrying nothing and an inner one
  // carrying everything.
  const wrapped = new Error("An error occurred while calling the model.", {
    cause: gemini503(),
  });
  assert.equal(isTransient(wrapped), true);
});

test("a real AbortSignal.timeout rejection is transient", async () => {
  // Built from the platform rather than hand-rolled, because the point is the
  // shape the platform actually produces: a DOMException with no status at
  // all, matched by name. `pnpm generate` wraps every request in one of these,
  // so a stalled connection must cost a retry rather than the run.
  const signal = AbortSignal.timeout(1);
  const reason = await new Promise<unknown>((resolve) => {
    signal.addEventListener("abort", () => resolve(signal.reason), {
      once: true,
    });
  });

  assert.equal((reason as { name?: string }).name, "TimeoutError");
  assert.equal((reason as { statusCode?: number }).statusCode, undefined);
  assert.equal(isTransient(reason), true);
});

test("an AbortError is transient", () => {
  assert.equal(
    isTransient(Object.assign(new Error("aborted"), { name: "AbortError" })),
    true,
  );
});

// ---------------------------------------------------------------------------
// isTransient: the shapes that must NOT retry.
// ---------------------------------------------------------------------------

test("a transient-SOUNDING message with no fields is not transient", () => {
  // The negative that keeps the design honest. Every string below reads like
  // an outage and none of them is a verdict from the provider, so retrying
  // spends the same tokens to be told the same thing.
  for (const message of [
    "503 Service Unavailable",
    "The model is currently unavailable, please retry",
    "rate limit exceeded (429)",
  ]) {
    assert.equal(
      isTransient(new Error(message)),
      false,
      `matched on the message text: ${message}`,
    );
  }
});

test("a 4xx that is a verdict about the request is not transient", () => {
  for (const statusCode of [400, 401, 403, 404, 413, 422]) {
    assert.equal(
      isTransient(Object.assign(new Error("bad request"), { statusCode })),
      false,
      `retried a ${statusCode}`,
    );
  }
});

test("isRetryable: false with a 4xx status is not transient", () => {
  assert.equal(
    isTransient(
      Object.assign(new Error("bad request"), {
        statusCode: 400,
        isRetryable: false,
      }),
    ),
    false,
  );
});

test("a plain error, and the non-errors, are not transient", () => {
  assert.equal(isTransient(new Error("something went wrong")), false);
  assert.equal(isTransient(undefined), false);
  assert.equal(isTransient(null), false);
  assert.equal(isTransient("503"), false);
  assert.equal(isTransient({}), false);
  // A status that is not a number is not a status: a string "503" from a
  // hand-built error object must not be read as one.
  assert.equal(isTransient({ statusCode: "503" }), false);
  // Neither is a truthy-but-not-`true` isRetryable.
  assert.equal(isTransient({ isRetryable: "yes" }), false);
});
