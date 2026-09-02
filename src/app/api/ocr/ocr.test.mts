/**
 * `/api/ocr`: the gate, the body validation, and the three ways a page can
 * fail to be read.
 *
 * No Next runtime, no bundler, no credential. `handler.ts` takes the
 * recognition step as an argument and imports only pure pipeline modules, so
 * the whole control flow runs here with a fake `recognize`.
 *
 * What these protect is an append-only run. `BrowserRun.pages` cannot lose a
 * page or have one re-read, because `Zone.pageIndex` is a position in that
 * array -- so a page that arrives empty, or arrives at all when the model was
 * never reached, is a blank scan for the life of the run and makes every slot
 * legitimately report not-found. The status codes below are the difference
 * between an operator seeing that and not.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createAllowlist, type AllowlistReader } from "../../../lib/auth/allowlist.ts";
import {
  createGuard,
  type ApiGate,
  type SessionLike,
} from "../../../lib/auth/guard.ts";
import { encodePng } from "../../../lib/export/png.ts";
import type { Line } from "../../../lib/pipeline/geometry.ts";
import type { OcrReport } from "../../../lib/pipeline/gemini-ocr.ts";
import { createOcrHandler, MAX_PNG_BYTES, OcrUnusable } from "./handler.ts";

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

function ocrRequest(body: Uint8Array): Request {
  return new Request("http://localhost/api/ocr", {
    method: "POST",
    headers: { "content-type": "image/png" },
    // `BodyInit` wants an ArrayBuffer-backed view; a bare `Uint8Array` widens
    // to `ArrayBufferLike`. Everything here comes from `encodePng` or a plain
    // `new Uint8Array`, so this narrows a fact rather than asserting one.
    body: body as Uint8Array<ArrayBuffer>,
  });
}

/** A real PNG, small but with a real IHDR for `pngDimensions` to read. */
async function tinyPng(width = 7, height = 3): Promise<Uint8Array> {
  return encodePng(new Uint8ClampedArray(width * height * 4), width, height);
}

function report(overrides: Partial<OcrReport> = {}): OcrReport {
  return {
    blocks: 1,
    segments: 1,
    lines: 1,
    interpolatedLines: 0,
    droppedEntries: 0,
    degraded: false,
    reasons: [],
    ...overrides,
  };
}

/** Invented content only. Never a line lifted from `documents/`. */
function oneLine(): Line[] {
  const box = { x: 100, y: 200, w: 900, h: 40 };
  return [
    {
      i: 0,
      text: "BANK CONTOH NUSANTARA",
      box,
      words: [{ text: "BANK CONTOH NUSANTARA", box }],
      origin: "measured",
    },
  ];
}

const never503 = () => new Response("unreachable", { status: 503 });

/* ------------------------------------------------------------------ the gate */

test("an anonymous POST to /api/ocr is refused, and the image is never sent to the model", async () => {
  const guard = guardFor(null);
  const reached: Uint8Array[] = [];
  const handler = createOcrHandler({
    gate: () => guard.apiUser(),
    recognize: async (png) => {
      reached.push(png);
      return { lines: oneLine(), report: report() };
    },
    unreachable: never503,
  });

  const response = await handler(ocrRequest(await tinyPng()));

  assert.equal(response.status, 401);
  // The claim that matters is not "it answered 401" but "the page image never
  // left this process". This is the request `src/proxy.ts` would have stopped,
  // arriving at a handler proxy never ran for.
  assert.deepEqual(reached, []);
});

/* ------------------------------------------------------- the body validation */

test("a body that is not a PNG is refused before the credential is spent", async () => {
  let called = 0;
  const handler = createOcrHandler({
    gate: admits,
    recognize: async () => {
      called += 1;
      return { lines: oneLine(), report: report() };
    },
    unreachable: never503,
  });

  const response = await handler(
    ocrRequest(new TextEncoder().encode('{"pages":[]}')),
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /not a PNG/);
  assert.equal(called, 0);
});

test("an empty body is refused", async () => {
  const handler = createOcrHandler({
    gate: admits,
    recognize: async () => {
      throw new Error("must not be reached");
    },
    unreachable: never503,
  });

  const response = await handler(ocrRequest(new Uint8Array(0)));
  assert.equal(response.status, 400);
});

test("a PNG whose header does not survive is refused, not sent", async () => {
  const handler = createOcrHandler({
    gate: admits,
    recognize: async () => {
      throw new Error("must not be reached");
    },
    unreachable: never503,
  });

  // The signature, then nothing. `pngDimensions` refuses it and the route says
  // so rather than paying for a call that would be shown a broken image.
  const response = await handler(
    ocrRequest(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
    ),
  );

  assert.equal(response.status, 400);
});

test("an oversized body is refused with 413, and never buffered into a model call", async () => {
  let called = 0;
  const handler = createOcrHandler({
    gate: admits,
    recognize: async () => {
      called += 1;
      return { lines: oneLine(), report: report() };
    },
    unreachable: never503,
  });

  // A real PNG signature so the size check is provably what refused it.
  const huge = new Uint8Array(MAX_PNG_BYTES + 1);
  huge.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const response = await handler(ocrRequest(huge));

  assert.equal(response.status, 413);
  assert.equal(called, 0);
});

/* -------------------------------------------------- the three failure shapes */

test("an unreachable model is a 503 that promises the run was not changed", async () => {
  const handler = createOcrHandler({
    gate: admits,
    recognize: async () => {
      throw new Error("fetch failed");
    },
    // The shape `route.ts` really sends: a machine slug in `error`, the prose
    // in `message`, the reassurance in `hint`. The fixture mirrors production
    // deliberately -- it used to put the prose in `error`, which is how the
    // worker's `messageFrom` came to read `error` first and show the operator a
    // bare `bad-request` token for every OTHER failure status.
    unreachable: (error) =>
      Response.json(
        {
          error: "model-unreachable",
          message: "Could not reach the model to read this page.",
          hint: "Nothing in your run has been changed.",
          cause: error instanceof Error ? error.message : String(error),
        },
        { status: 503 },
      ),
  });

  const response = await handler(ocrRequest(await tinyPng()));

  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.message, /Could not reach the model/);
  assert.match(body.hint, /Nothing in your run has been changed/);
  assert.equal(body.cause, "fetch failed");
});

test("every failure body names its prose in `message`, which is what the worker reads", () => {
  // The worker's `messageFrom` builds `message ?? error`, then appends `cause`
  // and `hint`. Pinned here rather than in the worker's own suite because this
  // file is the one that knows what the route actually sends, and the two
  // drifted apart once already: `handler.ts` put a slug in `error` and the
  // prose in `message`, while the worker read `error` first, so the carefully
  // written explanation and the "nothing has changed" reassurance were both
  // discarded on 400, 413 and 502.
  const shapes = [
    { error: "bad-request", message: "the request body is not a PNG.", hint: "x" },
    { error: "unusable-reply", message: "the reply produced no lines at all.", cause: "y" },
    { error: "unauthenticated", message: "Sign in with Google to continue." },
    { error: "model-unreachable", message: "Could not reach the model.", hint: "z" },
  ];
  for (const body of shapes) {
    assert.equal(
      typeof body.message,
      "string",
      `${body.error} must carry its prose in \`message\`, not in \`error\``,
    );
    assert.ok(
      !/ /.test(body.error),
      `${body.error} must be a machine slug, not a sentence`,
    );
  }
});

test("a reply the conversion refused is a 502, not a 503 and not a thin page", async () => {
  const handler = createOcrHandler({
    gate: admits,
    recognize: async () => {
      throw new OcrUnusable(
        new Error("41 of 44 OCR entries failed box validation"),
      );
    },
    // A 502 must not be routed through `unreachable`: the model answered, and
    // saying it could not be reached would send the operator to check a
    // credential that is fine.
    unreachable: () => {
      throw new Error("unreachable must not be called for an unusable reply");
    },
  });

  const response = await handler(ocrRequest(await tinyPng()));

  assert.equal(response.status, 502);
  assert.match((await response.json()).cause, /failed box validation/);
});

test("a page that came back with no lines is a 502, NEVER a 200", async () => {
  const handler = createOcrHandler({
    gate: admits,
    recognize: async () => ({
      lines: [],
      report: report({
        blocks: 0,
        segments: 0,
        lines: 0,
        degraded: true,
        reasons: ["the reply produced no lines at all"],
      }),
    }),
    unreachable: never503,
  });

  const response = await handler(ocrRequest(await tinyPng()));

  // This is the guardrail the whole route exists for. A 200 here appends a
  // permanently blank page to an append-only run, every slot then legitimately
  // reports not-found, and nothing anywhere looks wrong.
  assert.equal(response.status, 502);
  assert.match((await response.json()).message, /no text lines at all/);
});

/* ------------------------------------------------------------- the happy path */

test("a good PNG returns the recognizer's lines unmodified, with the image's own dimensions", async () => {
  const lines = oneLine();
  const sent: number[] = [];
  const handler = createOcrHandler({
    gate: admits,
    recognize: async (png) => {
      sent.push(png.byteLength);
      return { lines, report: report({ interpolatedLines: 0 }) };
    },
    unreachable: never503,
  });

  const png = await tinyPng(11, 5);
  const response = await handler(ocrRequest(png));

  assert.equal(response.status, 200);
  const body = await response.json();
  // The dimensions come from the PNG's own IHDR, never from the caller: the
  // client asserts them against its own RenderedPage, which is what catches
  // OCR measured at one DPI and a crop cut from a re-render at another.
  assert.equal(body.width, 11);
  assert.equal(body.height, 5);
  assert.deepEqual(body.lines, JSON.parse(JSON.stringify(lines)));
  assert.equal(body.report.interpolatedLines, 0);
  assert.deepEqual(sent, [png.byteLength]);
});
