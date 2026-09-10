/**
 * `/api/epic`: INPUT EPIC. Does what the operator's EPIC screen shows agree
 * with the workbook Konfig Excel settled?
 *
 * THE YARDSTICK HAS SWAPPED, and reading this as Konfig Excel one route over is
 * the mistake to avoid. There the scans judge the workbook; here the workbook
 * judges EPIC. So `fields` arrives already interpreted and already amended --
 * `effectiveFields` in `src/lib/config/effective.ts` applies the operator's
 * accepted edits before it is sent -- and it is the standard rather than the
 * thing under test.
 *
 * ## THE CAPTURES ARRIVE ALREADY RECOGNISED, AND THERE IS NO IMAGE PATH HERE
 *
 * A capture is a screenshot: bytes, a width and a height. None of that reaches
 * this route. The browser posts each PNG to `/api/ocr`, which already takes raw
 * page images, and sends the LINES it got back here. So Input EPIC -- a whole
 * checkpoint whose input is screenshots -- adds no second image path to this
 * app, and AGENTS.md's "only the OCR stage sends images" survives it by
 * construction rather than by care. `compareToEpic`'s `Ask` is
 * `(prompt: string) => Promise<string>` with no image parameter, and this route
 * has nowhere to put one.
 *
 * Do not add one to "read the screen properly". A capture the recogniser read
 * badly is a page the recogniser read badly, and it is fixed where every other
 * one is.
 *
 * ## WHAT IT COSTS
 *
 * ONE CALL. Every capture's lines and every field of the workbook ride in it
 * together, which is a fraction of what `/api/config`'s comparison carries: a
 * screen capture is a screenful of text against a 151-page bundle. There is no
 * chunking, because `compareToEpic` does not have any -- the leftovers half of
 * the reply (`tidak-ada-di-excel`) is a statement about the WHOLE screen
 * against the WHOLE workbook, and a chunked call would report a value as
 * missing from a workbook it was shown a third of. `route.ts` logs the call and
 * the request the way every other route here does.
 *
 * The control flow is separated from `route.ts` so
 * `src/app/api/epic/epic.test.mts` can execute the authorization gate, every
 * validation below and the 502/503 split with no Next runtime, no bundler and
 * no credential.
 */

import type { ApiGate } from "@/lib/auth/guard";

// Relative, with explicit `.ts`, and never through the `@/` alias: this file is
// executed directly by `node --test` (see the note above), which resolves
// neither a bare alias nor an extensionless specifier.
import { AskFailed, guardAsk } from "../../../lib/api/wire.ts";
import type { ConfigField, EpicCapture, EpicEntry } from "../../../lib/config/types.ts";
import type { Ask } from "../../../lib/pipeline/classify.ts";
import { compareToEpic } from "../../../lib/pipeline/epic-compare.ts";
import type { Line } from "../../../lib/pipeline/geometry.ts";
// ONE COPY OF THE FIELD VALIDATOR, IMPORTED RATHER THAN REPEATED. It lives at
// `/api/config` because that is the route which mints these fields; this one
// borrows the same list to judge EPIC against, and a second copy here would be
// a second validator that can silently disagree with the first -- the argument
// `src/lib/api/wire.ts` makes at length about `assertWirePages`. Both handlers
// are plain modules with no Next imports, so this costs nothing at either end.
import { assertConfigFields } from "../config/handler.ts";

/**
 * ONE SCREEN CAPTURE AS THE BROWSER SENDS IT: what was read off it, and enough
 * to say which screen it was.
 *
 * NARROWER THAN `EpicCapture` ON PURPOSE. The stored shape also carries a
 * `digest`, a `width` and a `height`; those are the bytes' identity and the
 * bytes' geometry, and the bytes stay on the device. Sending them would be
 * sending facts about a file this route is not allowed to have, to be used by
 * nothing: `compareToEpic` reads `id` and `lines`, and cites by `id` because
 * captures are removed one at a time and an index would go on resolving after
 * the capture above it was deleted.
 *
 * `name` is here for the log and for a refusal that can name a screen. It is
 * deliberately NOT put in the prompt -- `buildEpicPrompt` says why: it is a
 * filename the operator's browser chose, it is often the customer's name, and
 * the one thing it could do to a reply is offer a plausible value that is not
 * on the screen at all.
 */
export type WireCapture = {
  id: string;
  name: string;
  /** What `/api/ocr` read off this screen, numbered exactly as a page's lines are. */
  lines: Line[];
};

export type EpicBody = {
  runId: string;
  fields: ConfigField[];
  captures: WireCapture[];
};

export type EpicResult = { entries: EpicEntry[] };

/**
 * How many screen captures one request may carry.
 *
 * A CEILING ON MEMORY AND ON ONE PROMPT, not a budget, in the spirit of
 * `MAX_PNG_BYTES` at `/api/ocr`: the body is parsed into memory before anything
 * looks at it, every capture's lines then go into a single prompt, and on a
 * shared Cloud Run container an unbounded array is an OOM shape that takes
 * every other operator's in-flight request down with it.
 *
 * The client's instruction is "upload screen captures from EPIC, any number",
 * and what that means in practice is the handful of screens one order occupies.
 * Forty is generous against that and still refuses a caller that has started
 * posting a screenshot folder.
 *
 * IT IS NOT `MAX_EXTRA`, which is also 40 and is a different quantity: that one
 * bounds how many `tidak-ada-di-excel` findings one REPLY may name. Changing
 * either says nothing about the other.
 */
export const MAX_WIRE_CAPTURES = 40;

/**
 * How many recognised lines one request may carry, across every capture.
 *
 * The per-capture count is what actually reaches the prompt, and a caller could
 * stay under the capture ceiling while sending one capture with a hundred
 * thousand lines in it. One EPIC screen recognises to on the order of a
 * hundred lines, so 20,000 is roughly ten full captures' worth per capture at
 * the ceiling and still bounds the prompt and the parse.
 */
export const MAX_WIRE_CAPTURE_LINES = 20_000;

/**
 * The captures, checked before a token is spent on them.
 *
 * MIRRORS `assertWirePages`' DISCIPLINE, and for the same reason rather than
 * for symmetry: the model is shown these lines numbered, answers with a capture
 * and a line RANGE, and `citationFor` reads that range back BY LINE NUMBER out
 * of a `Map` built from `line.i`. So `i` is the address of the text a citation
 * quotes, and the two ways it can be wrong are the two ways a citation lies --
 * a duplicate `i` silently keeps one of two lines and quotes it as the other,
 * and a gap turns a real citation into a refusal.
 *
 * WHAT IS NOT CHECKED HERE, AND WHY. `assertLinesWellFormed` also bounds every
 * box against the page it was measured on; there is no page here, and nothing
 * downstream turns a capture's box into a rectangle. Nothing is cropped from a
 * capture, nothing is drawn as a denah, and `EpicCitation` carries no box at
 * all -- `src/lib/config/types.ts` states that a capture is read for its TEXT
 * and stops there. Bounding a box against a width this route deliberately does
 * not receive would mean asking for the width, which is a fact about bytes that
 * never left the device.
 */
export function assertWireCaptures(value: unknown): asserts value is WireCapture[] {
  if (!Array.isArray(value)) throw new Error("captures must be an array");
  if (value.length > MAX_WIRE_CAPTURES) {
    throw new Error(
      `captures carries ${value.length} entries, past the ${MAX_WIRE_CAPTURES} ` +
        "ceiling; every one of them rides in a single prompt",
    );
  }

  const seen = new Set<string>();
  let lines = 0;

  value.forEach((capture, at) => {
    const where = `captures[${at}]`;
    if (!capture || typeof capture !== "object") throw new Error(`${where} is not an object`);
    const one = capture as Partial<WireCapture>;

    if (typeof one.id !== "string" || one.id === "") {
      throw new Error(
        `${where}.id is required; a citation names the capture by id, because ` +
          "captures are removed one at a time and an index would go on " +
          "resolving after the capture above it was deleted",
      );
    }
    if (seen.has(one.id)) {
      throw new Error(
        `${where}.id ${JSON.stringify(one.id)} is used by an earlier capture. ` +
          "Two captures sharing an id make a citation ambiguous about which " +
          "screen an operator should open.",
      );
    }
    seen.add(one.id);

    if (typeof one.name !== "string") {
      throw new Error(`${where}.name must be the file's name`);
    }
    if (!Array.isArray(one.lines)) throw new Error(`${where}.lines must be an array`);

    lines += one.lines.length;
    if (lines > MAX_WIRE_CAPTURE_LINES) {
      throw new Error(
        `captures carry more than ${MAX_WIRE_CAPTURE_LINES} recognised lines ` +
          "between them; every one of them rides in a single prompt",
      );
    }

    one.lines.forEach((line, k) => {
      if (!line || typeof line !== "object") throw new Error(`${where}.lines[${k}] is not an object`);
      if (typeof line.text !== "string") {
        throw new Error(`${where}.lines[${k}].text must be the recognised text`);
      }
      // DENSE AND EQUAL TO THE POSITION, which is `assertLinesWellFormed`'s own
      // first rule. A citation is read back out of a map keyed by `i`, so a
      // capture numbered any other way answers a range with text that is not
      // the text the citation points at.
      if (line.i !== k) {
        throw new Error(
          `${where}.lines[${k}].i is ${JSON.stringify(line.i)}, not ${k}: line ` +
            "numbers must be dense and equal to the array position, or a cited " +
            "range quotes different text than it names",
        );
      }
    });
  });
}

/**
 * The wire captures as the `EpicCapture`s the stage's type names.
 *
 * `EpicCapture` IS THE STORED SHAPE and carries three fields this route is
 * never sent: `digest`, `width` and `height`. They are filled with values that
 * cannot be mistaken for measurements -- an empty digest and a zero size --
 * rather than with plausible ones, because a fabricated hash or a guessed
 * screen size is exactly the kind of thing the next person to add a use for one
 * would read as real. `compareToEpic` reads `id` and `lines` and nothing else,
 * which is checkable by grepping that module for `capture.`.
 */
function toEpicCaptures(captures: readonly WireCapture[]): EpicCapture[] {
  return captures.map((capture) => ({
    id: capture.id,
    name: capture.name,
    digest: "",
    width: 0,
    height: 0,
    lines: capture.lines,
  }));
}

/** Shape-checks the body before a single token is spent on it. */
export function parseEpicBody(value: unknown): EpicBody {
  const body = value as Partial<EpicBody>;
  if (!body || typeof body !== "object") throw new Error("body is not an object");
  if (typeof body.runId !== "string" || body.runId === "") {
    throw new Error("runId is required");
  }
  // The same field contract `/api/config` enforces, from the same one copy.
  // Checked here for a reason of its own: this route's `fields` is the
  // YARDSTICK rather than the thing under test, so a malformed list does not
  // produce a bad answer about a field, it produces a confident answer about
  // the wrong standard.
  assertConfigFields(body.fields);
  assertWireCaptures(body.captures);

  return body as EpicBody;
}

/** The checkpoint itself: one call, one entry per field, plus the leftovers. */
export async function checkEpic(body: EpicBody, rawAsk: Ask): Promise<EpicResult> {
  // Every model call goes through the tagged wrapper, so a provider failure
  // cannot be reported as a field that was checked against EPIC and matched --
  // which on this route would be the quietest wrong answer in the product: an
  // outage read as "EPIC agrees with everything".
  const ask = guardAsk(rawAsk);

  const entries = await compareToEpic({
    fields: body.fields,
    captures: toEpicCaptures(body.captures),
    ask,
  });

  return { entries };
}

export type EpicDeps = {
  /** The authorization gate. `requireApiUser` in production. */
  gate: () => Promise<ApiGate>;
  /** The model call. Only reached once `gate` has admitted the caller. */
  check: (body: EpicBody) => Promise<EpicResult>;
  /** Turns a provider failure into an operator-readable 503. */
  unreachable: (error: unknown) => Response;
  /** A reply that arrived and could not be used. Not the same as 503. */
  unusable?: (error: unknown) => Response;
  /** Malformed request. Separate from the two above: it is the caller's. */
  badRequest?: (error: unknown) => Response;
};

function defaultBadRequest(error: unknown): Response {
  return Response.json(
    {
      error: "bad-request",
      message: "The request body is not a valid EPIC check.",
      cause: error instanceof Error ? error.message : String(error),
    },
    { status: 400 },
  );
}

/**
 * A reply that arrived and could not be parsed, kept DISTINCT from a provider
 * that could not be reached.
 *
 * ONE CALL CARRIES THE WHOLE CHECKPOINT, so a reply that will not parse costs
 * the request outright -- there is no per-field salvage to fall back to.
 * Reporting that as a 503 would tell the operator to check their credential,
 * and reporting it as a body of `tidak-ditemukan` would tell them their EPIC
 * screens are missing values nothing managed to read. So it is its own status,
 * with the order explicitly unchanged and a retry the obvious next step.
 */
function defaultUnusable(error: unknown): Response {
  return Response.json(
    {
      error: "unusable-reply",
      message:
        "The model answered and the reply could not be used. Nothing in your " +
        "order has been changed; try again.",
      cause: error instanceof Error ? error.message : String(error),
    },
    { status: 502 },
  );
}

/**
 * THE ORDER IS THE POINT, and it is the order every route here uses: the gate
 * runs before the body is read and before anything reaches
 * `src/lib/model.ts`. Moving it after either would still return 401 to an
 * anonymous caller while letting them spend the credential first.
 */
export function createEpicHandler(deps: EpicDeps) {
  const badRequest = deps.badRequest ?? defaultBadRequest;
  const unusable = deps.unusable ?? defaultUnusable;

  return async function POST(req: Request): Promise<Response> {
    // 1. AUTHORIZE. First, unconditionally, in the handler itself. `src/proxy.ts`
    //    would also refuse an anonymous caller, but proxy is an optimization and
    //    not the boundary -- see the note at the top of that file.
    const gate = await deps.gate();
    if (gate.response) return gate.response;

    // 2. Only then read and validate what the caller sent.
    let body: EpicBody;
    try {
      body = parseEpicBody(await req.json());
    } catch (error) {
      return badRequest(error);
    }

    // 3. Only then spend the credential. A provider that could not be reached
    //    arrives here tagged; unwrap it so the 503 names the real cause rather
    //    than the wrapper. Anything else got an answer it could not use, which
    //    is a different thing and says so.
    try {
      return Response.json(await deps.check(body));
    } catch (error) {
      if (error instanceof AskFailed) return deps.unreachable(error.reason);
      return unusable(error);
    }
  };
}
