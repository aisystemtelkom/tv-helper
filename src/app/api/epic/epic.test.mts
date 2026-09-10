/**
 * `/api/epic`: the gate, every refusal, and the 503/502/200 split.
 *
 * No Next runtime, no bundler, no credential. `handler.ts` imports only pure
 * pipeline modules and takes its model call as an argument, so the whole
 * control flow runs here with a fake `ask`.
 *
 * WHAT THESE PROTECT is the last reading pass before an order is considered
 * done. Input EPIC tells the operator which values in EPIC disagree with the
 * workbook, and the two answers that are expensive to get wrong both look like
 * ordinary rows: "EPIC agrees" on a field nothing checked, and a citation
 * pointing at a screen capture other than the one the value was read on.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createAllowlist, type AllowlistReader } from "../../../lib/auth/allowlist.ts";
import {
  createGuard,
  type ApiGate,
  type SessionLike,
} from "../../../lib/auth/guard.ts";
import type { ConfigField } from "../../../lib/config/types.ts";
import type { Line } from "../../../lib/pipeline/geometry.ts";
import {
  MAX_WIRE_CAPTURES,
  MAX_WIRE_CAPTURE_LINES,
  checkEpic,
  createEpicHandler,
  parseEpicBody,
  type EpicResult,
  type WireCapture,
} from "./handler.ts";

const silent = () => {};

/** A reader that throws if it is consulted at all. */
const untouchedReader: AllowlistReader = {
  async get() {
    throw new Error("the allowlist must not be read for an anonymous caller");
  },
  async list() {
    throw new Error("not expected");
  },
  async put() {
    throw new Error("not expected");
  },
  async remove() {
    throw new Error("not expected");
  },
};

function guardFor(session: SessionLike) {
  const list = createAllowlist(untouchedReader, { warn: silent });
  return createGuard({
    getSession: async () => session,
    allowlist: () => list,
    authDisabled: () => false,
    warn: silent,
  });
}

/** A gate that admits, so a test can reach the steps after authorization. */
const admits = async (): Promise<ApiGate> => ({
  user: {
    email: "op@gmail.com",
    name: "Operator",
    image: null,
    role: "member",
    isAdmin: false,
    via: "allowlist",
  },
  response: null,
});

function line(i: number, text: string): Line {
  const box = { x: 40, y: 40 + i * 30, w: 400, h: 24 };
  return { i, text, box, words: [{ text, box }] };
}

function capture(id: string, name: string, ...texts: string[]): WireCapture {
  return { id, name, lines: texts.map((text, i) => line(i, text)) };
}

/** The fictional set, per AGENTS.md. No real identifier reaches a committed file. */
const FIELDS: ConfigField[] = [
  {
    id: "f1",
    sheet: "Config",
    label: "Nama Pelanggan",
    labelRef: "C9",
    valueRef: "E9",
    excelValue: "BANK CONTOH NUSANTARA",
  },
  {
    id: "f2",
    sheet: "Config",
    label: "Nomor Kutipan",
    labelRef: "C10",
    valueRef: "E10",
    excelValue: "1-70000000001",
  },
];

const CAPTURES: WireCapture[] = [
  capture("c1", "epic-1.png", "Data Pelanggan", "BANK CONTOH NUSANTARA"),
  capture("c2", "epic-2.png", "Nomor Kutipan", "1-70000000002", "SID 1209990001"),
];

function epicRequest(body: unknown): Request {
  return new Request("http://localhost/api/epic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function answering(reply: string, prompts: string[] = []) {
  return async (prompt: string): Promise<string> => {
    prompts.push(prompt);
    return reply;
  };
}

const AGREES = JSON.stringify({
  fields: [
    { id: "f1", verdict: "cocok" },
    { id: "f2", verdict: "cocok" },
  ],
});

/* ------------------------------------------------------------------ the gate */

test("an unauthenticated POST to /api/epic is refused, and the model is never reached", async () => {
  const guard = guardFor(null);
  const reached: unknown[] = [];
  const handler = createEpicHandler({
    gate: () => guard.apiUser(),
    check: async (body) => {
      reached.push(body);
      return { entries: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  const response = await handler(
    epicRequest({ runId: "r", fields: FIELDS, captures: CAPTURES }),
  );

  assert.equal(response.status, 401);
  // The claim that matters is not "it answered 401" but "it never spent the
  // credential". This is the request `src/proxy.ts` would have stopped,
  // arriving at a handler proxy never ran for.
  assert.deepEqual(reached, []);
});

/* -------------------------------------------------------------- the envelope */

test("the body itself is checked, and a run with no id is refused", () => {
  // `runId` is what the log line names when a request is being chased down
  // afterwards, and it is the only thing in the body that says which order this
  // spend belonged to.
  assert.throws(() => parseEpicBody(null), /body is not an object/);
  assert.throws(
    () => parseEpicBody({ fields: FIELDS, captures: CAPTURES }),
    /runId is required/,
  );
  assert.throws(
    () => parseEpicBody({ runId: "r", fields: FIELDS }),
    /captures must be an array/,
  );
});

/* --------------------------------------------------------------- the captures */

test("a capture list that could produce a lying citation is refused before a token is spent", async () => {
  const reached: unknown[] = [];
  const handler = createEpicHandler({
    gate: admits,
    check: async (body) => {
      reached.push(body);
      return { entries: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  const broken: [string, unknown, RegExp][] = [
    ["not an array", "c1", /captures must be an array/],
    [
      // A citation names a capture by id because captures are removed one at a
      // time; two captures sharing one leaves an operator no way to know which
      // screen to open.
      "two captures sharing an id",
      [CAPTURES[0], { ...CAPTURES[1], id: "c1" }],
      /is used by an earlier capture/,
    ],
    ["a capture with no id", [{ ...CAPTURES[0], id: "" }], /\.id is required/],
    ["a capture with no name", [{ ...CAPTURES[0], name: 12 }], /name must be the file's name/],
    ["lines that are not an array", [{ ...CAPTURES[0], lines: "dua baris" }], /lines must be an array/],
    [
      // `citationFor` reads a cited range back out of a map keyed by `i`, so a
      // capture numbered any other way answers a range with text that is not
      // the text the citation points at.
      "a gap in the line numbering",
      [{ ...CAPTURES[0], lines: [line(0, "Data Pelanggan"), line(2, "BANK CONTOH NUSANTARA")] }],
      /must be dense and equal to the array position/,
    ],
    [
      "two lines claiming one number",
      [{ ...CAPTURES[0], lines: [line(0, "satu"), line(0, "dua")] }],
      /must be dense and equal to the array position/,
    ],
    [
      "a line with no text",
      [{ ...CAPTURES[0], lines: [{ ...line(0, "x"), text: null }] }],
      /text must be the recognised text/,
    ],
  ];

  for (const [what, captures, why] of broken) {
    const response = await handler(epicRequest({ runId: "r", fields: FIELDS, captures }));
    assert.equal(response.status, 400, what);
    assert.match(((await response.json()) as { cause?: string }).cause ?? "", why, what);
  }

  assert.deepEqual(reached, []);
});

test("the two ceilings refuse a body that would be held in memory and sent in one prompt", () => {
  const many = Array.from({ length: MAX_WIRE_CAPTURES + 1 }, (_, i) =>
    capture(`c${i}`, `epic-${i}.png`, "Data Pelanggan"),
  );
  assert.throws(
    () => parseEpicBody({ runId: "r", fields: FIELDS, captures: many }),
    new RegExp(`past the ${MAX_WIRE_CAPTURES} ceiling`),
  );

  // The per-capture count is what reaches the prompt, so a caller could stay
  // under the capture ceiling with one enormous capture.
  const enormous = capture("c1", "epic-1.png");
  enormous.lines = Array.from({ length: MAX_WIRE_CAPTURE_LINES + 1 }, (_, i) =>
    line(i, "Data Pelanggan"),
  );
  assert.throws(
    () => parseEpicBody({ runId: "r", fields: FIELDS, captures: [enormous] }),
    new RegExp(`more than ${MAX_WIRE_CAPTURE_LINES} recognised lines`),
  );

  // NO CAPTURES IS NOT A REFUSAL. It is the state before the operator has
  // handed any over, and `compareToEpic` answers it by saying so on every row
  // rather than with an empty list a panel would render as "not run yet".
  assert.doesNotThrow(() =>
    parseEpicBody({ runId: "r", fields: FIELDS, captures: [] }),
  );
});

/* ----------------------------------------------------------------- the fields */

test("the yardstick is checked too: a malformed field list is a 400, not a confident answer", async () => {
  // On this route `fields` is the STANDARD rather than the thing under test, so
  // a bad list does not produce a bad answer about one field -- it produces a
  // confident answer about the wrong standard. The validator is the one copy
  // `/api/config` owns; this asserts it is really reached from here.
  const reached: unknown[] = [];
  const handler = createEpicHandler({
    gate: admits,
    check: async (body) => {
      reached.push(body);
      return { entries: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  const duplicated = await handler(
    epicRequest({
      runId: "r",
      fields: [FIELDS[0], { ...FIELDS[1], id: "f1" }],
      captures: CAPTURES,
    }),
  );
  assert.equal(duplicated.status, 400);
  assert.match(
    ((await duplicated.json()) as { cause?: string }).cause ?? "",
    /is used by an earlier field/,
  );

  const missing = await handler(epicRequest({ runId: "r", captures: CAPTURES }));
  assert.equal(missing.status, 400);

  assert.deepEqual(reached, []);
});

/* --------------------------------------------------------------- the happy path */

test("one call answers every field, and a citation names the capture by id", async () => {
  const prompts: string[] = [];
  const result = await checkEpic(
    { runId: "r", fields: FIELDS, captures: CAPTURES },
    answering(
      JSON.stringify({
        fields: [
          { id: "f1", verdict: "cocok", epicValue: "BANK CONTOH NUSANTARA", capture: 0, from: 1, to: 1 },
          {
            id: "f2",
            verdict: "beda",
            epicValue: "1-70000000002",
            capture: 1,
            from: 1,
            to: 1,
          },
        ],
        extra: [{ label: "SID", epicValue: "1209990001", capture: 1, from: 2, to: 2 }],
      }),
      prompts,
    ),
  );

  // ONE CALL. Every capture's lines and every field ride in it together, and
  // `compareToEpic` does not chunk, because the leftovers half of the reply is
  // a statement about the WHOLE screen against the WHOLE workbook.
  assert.equal(prompts.length, 1);
  // The capture's NAME is deliberately not in the listing: it is a filename the
  // browser chose, it is often the customer's name, and the one thing it could
  // do to a reply is offer a plausible value that is not on the screen.
  assert.ok(!prompts[0].includes("epic-1.png"));

  assert.deepEqual(
    result.entries.map((entry) => [entry.fieldId, entry.verdict, entry.decision]),
    [
      ["f1", "cocok", "belum"],
      ["f2", "beda", "belum"],
      // EPIC shows something the workbook has no field for. Its `fieldId` is
      // absent because there is no field to point at, which is the whole
      // content of the finding.
      [undefined, "tidak-ada-di-excel", "belum"],
    ],
  );
  assert.equal(result.entries[1].epicValue, "1-70000000002");
  // BY ID, NEVER BY POSITION: the model answered "capture 1" and the citation
  // carries `c2`, so removing the first capture cannot silently repoint it.
  assert.equal(result.entries[1].citation?.captureId, "c2");
  assert.equal(result.entries[1].citation?.text, "1-70000000002");
});

test("no captures means every field is reported unchecked, and the model is never called", async () => {
  // Asking what a screen nobody supplied shows is waste, and the answer is
  // already known. An empty list would render as "not run yet"; a row per field
  // saying nothing was read is the honest shape.
  const result = await checkEpic(
    { runId: "r", fields: FIELDS, captures: [] },
    async () => {
      throw new Error("the model must not be reached with no capture to read");
    },
  );

  assert.equal(result.entries.length, 2);
  for (const entry of result.entries) {
    assert.equal(entry.verdict, "tidak-ditemukan");
    assert.match(entry.reason ?? "", /no EPIC screen capture was supplied/);
  }
});

/* ------------------------------------------------ reaching the model, or not */

test("a model that cannot be reached is a 503, NOT 'EPIC agrees with everything'", async () => {
  // The quietest wrong answer this product could give: an outage read as
  // agreement on the last reading pass before an order is signed off.
  const noCredential = async (): Promise<string> => {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set.");
  };

  const handler = createEpicHandler({
    gate: admits,
    check: (body) => checkEpic(body, noCredential),
    unreachable: (error) =>
      Response.json(
        { error: "unreachable", cause: (error as Error).message },
        { status: 503 },
      ),
  });

  const response = await handler(
    epicRequest({ runId: "r", fields: FIELDS, captures: CAPTURES }),
  );

  assert.equal(response.status, 503);
  // Unwrapped: the 503 names the real cause, not the internal wrapper.
  assert.match(
    ((await response.json()) as { cause: string }).cause,
    /GOOGLE_GENERATIVE_AI_API_KEY/,
  );
});

test("a reply that arrives and cannot be used is a 502, not a 503 and not a run of verdicts", async () => {
  // ONE CALL CARRIES THE WHOLE CHECKPOINT, so an unparseable reply costs the
  // request outright. Reported as 503 it would send the operator to their
  // credential; reported as a body of `tidak-ditemukan` it would tell them
  // their EPIC screens are missing values nothing managed to read.
  const garbage = async (): Promise<string> => "not json at all";

  const handler = createEpicHandler({
    gate: admits,
    check: (body) => checkEpic(body, garbage),
    unreachable: () => Response.json({ error: "unreachable" }, { status: 503 }),
  });

  const response = await handler(
    epicRequest({ runId: "r", fields: FIELDS, captures: CAPTURES }),
  );

  assert.equal(response.status, 502);
  assert.equal(((await response.json()) as { error: string }).error, "unusable-reply");
});

test("a request that survives every check answers 200 with the entries", async () => {
  const handler = createEpicHandler({
    gate: admits,
    check: (body) => checkEpic(body, answering(AGREES)),
    unreachable: () => Response.json({ error: "unreachable" }, { status: 503 }),
  });

  const response = await handler(
    epicRequest({ runId: "r", fields: FIELDS, captures: CAPTURES }),
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as EpicResult;
  assert.deepEqual(
    body.entries.map((entry) => [entry.fieldId, entry.verdict]),
    [
      ["f1", "cocok"],
      ["f2", "cocok"],
    ],
  );
});
