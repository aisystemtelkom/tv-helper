/**
 * The one JSON extractor every model-facing pipeline module shares.
 *
 * It existed three times, byte for byte, in classify.ts, locate.ts and
 * fields.ts, because the first copy was never exported. Three copies of a
 * parser guarding three different Zod schemas is three chances for one to
 * drift, and the drift would be invisible: a looser copy accepts a malformed
 * reply, the schema fills in what it can, and the pipeline ships a plausible
 * wrong rectangle or a wrong field value. Hence one copy.
 *
 * ## The behaviour this pins, and why each part is deliberate
 *
 * Models wrap JSON in prose or fences often enough that a naked `JSON.parse`
 * is not an option. But every tolerance added here is also a chance to accept
 * something the model did not mean, so the rule is: recover from *packaging*,
 * never from *content*. Concretely --
 *
 *  - A fenced block wins over the surrounding text. ```json ... ``` is the
 *    most common wrapper, and the prose around it routinely has braces of
 *    its own.
 *  - Outside a fence, the span from the first `{` to the last `}` is taken,
 *    so leading and trailing prose is dropped. Widest span, not first
 *    balanced object: a `}` inside a JSON string value (`{"a":"}"}`) ends a
 *    naive brace-counting scan early and silently truncates a valid reply.
 *  - Anything that is not then one valid JSON object THROWS. Two objects side
 *    by side, a truncated reply, a reply with no braces at all -- each raises
 *    rather than returning the first, the salvageable, or a partial. That is
 *    the property that matters most here: a crash is cheap and a plausible
 *    wrong answer is expensive, so ambiguous replies must fail loudly at this
 *    boundary instead of reaching a schema that will do its best with them.
 *
 * `scripts/test-pipeline.mjs` pins each of those cases against this function
 * and against all three of its callers; keep them passing if this is ever
 * touched again.
 */
export function extractJson(reply: string): unknown {
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : reply;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`No JSON object in model reply: ${reply.slice(0, 200)}`);
  }
  return JSON.parse(body.slice(start, end + 1));
}
