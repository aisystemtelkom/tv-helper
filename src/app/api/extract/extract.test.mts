/**
 * `/api/extract`: the gate, the page-numbering guard, the six dispositions,
 * and the two poisoned fields.
 *
 * No Next runtime, no bundler, no credential. `handler.ts` imports only pure
 * pipeline modules and takes its model call as an argument, so the whole
 * control flow runs here with a fake `ask`.
 *
 * What these protect is the thing a human validator signs. The route's whole
 * job is to say WHICH KIND of answer each cell holds: a value the model cited
 * and a value whose citation was a hallucination look identical in a
 * spreadsheet, and one of them is evidence while the other is a guess with a
 * page number stapled to it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createAllowlist, type AllowlistReader } from "../../../lib/auth/allowlist.ts";
import {
  createGuard,
  type ApiGate,
  type SessionLike,
} from "../../../lib/auth/guard.ts";
import type { Template } from "../../../lib/forms/template.ts";
import type { Line } from "../../../lib/pipeline/geometry.ts";
import { citationOutcome } from "../../../lib/pipeline/fields.ts";
import type { WirePage } from "../../../lib/api/wire.ts";
import {
  createExtractHandler,
  extractValues,
  toFieldPages,
  type ExtractedField,
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

function line(i: number, text: string, y: number): Line {
  const box = { x: 100, y, w: 900, h: 40 };
  return { i, text, box, words: [{ text, box }] };
}

function wirePage(index: number, sourceId: string, text: string): WirePage {
  return {
    index,
    sourceId,
    width: 2480,
    height: 3507,
    lines: [line(0, text, 200), line(1, `${text} continued`, 260)],
  };
}

function extractRequest(body: unknown): Request {
  return new Request("http://localhost/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * A row of the template's xlsx list, built by assertion.
 *
 * `Template` is `src/lib/forms/template.ts`'s, and a row carries more than a
 * fieldKey; nothing here reads the rest, so the cast says "this is the part
 * under test" rather than transcribing a shape that would then have to be
 * kept in step with the real one.
 */
const row = (fieldKey: string) =>
  ({ fieldKey, itemI: fieldKey, itemII: fieldKey }) as Template["xlsxRows"][number];

/**
 * Three backed keys, two ranking groups.
 *
 * `cc` has a `FIELD_DOC_TYPES` entry (BA Permintaan) and the whole-page
 * section's docType is the email thread, so `quote` ranks differently and the
 * two land in separate extraction calls -- which is the grouping the cost
 * note in `handler.ts` is about. `namaProyek` is here to be refused.
 */
const TEMPLATE: Template = {
  id: "t",
  label: "T",
  sections: [
    {
      title: "Email",
      layout: "images",
      slots: [
        {
          key: "email.1",
          label: "Email",
          docType: "Email",
          hint: "the whole printed email page",
          fillable: true,
        },
      ],
    },
  ],
  xlsxRows: [row("cc"), row("quote"), row("namaProyek")],
  fieldHints: {
    cc: "the customer named as the subscriber on an order request, explicitly not a name appearing in an email header",
  },
};

/** One KB page, one BA Permintaan page, one email page, one source file. */
const PAGES = [
  wirePage(0, "a", "Perjanjian Kerjasama"),
  wirePage(1, "a", "Berita Acara Permintaan"),
  wirePage(2, "a", "From: someone"),
];

const SPANS = JSON.stringify({
  spans: [
    { docType: "KB", fromPage: 0, toPage: 0 },
    { docType: "BAPermintaan", fromPage: 1, toPage: 1 },
    { docType: "Email", fromPage: 2, toPage: 2 },
  ],
});

/**
 * A model that classifies, then answers every extraction call with the same
 * list. `extractFields` keeps only the keys its own group asked for, so one
 * list serves both calls and the groups stay disjoint.
 */
function answering(values: unknown[]) {
  return async (prompt: string): Promise<string> =>
    prompt.includes("segmenting") ? SPANS : JSON.stringify({ values });
}

function byKey(fields: ExtractedField[]): Map<string, ExtractedField> {
  return new Map(fields.map((field) => [field.fieldKey, field]));
}

/* ------------------------------------------------------------------ the gate */

test("an unauthenticated POST to /api/extract is refused, and the model is never reached", async () => {
  const guard = guardFor(null);
  const reached: unknown[] = [];
  const handler = createExtractHandler({
    gate: () => guard.apiUser(),
    extract: async (body) => {
      reached.push(body);
      return { fields: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  const response = await handler(extractRequest({ runId: "r", pages: [] }));

  assert.equal(response.status, 401);
  // The claim that matters is not "it answered 401" but "it never spent the
  // credential". This is the request `src/proxy.ts` would have stopped,
  // arriving at a handler proxy never ran for.
  assert.deepEqual(reached, []);
});

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

test("an admitted caller sending within-source page numbers gets a 400, not an extraction", async () => {
  const reached: unknown[] = [];
  const handler = createExtractHandler({
    gate: admits,
    extract: async (body) => {
      reached.push(body);
      return { fields: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  const response = await handler(
    extractRequest({
      runId: "r",
      pages: [wirePage(0, "a", "one"), wirePage(0, "b", "two")],
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(reached, []);
  assert.match(
    ((await response.json()) as { cause?: string }).cause ?? "",
    /run-global position/,
  );
});

test("a malformed line is refused before the credential is spent", async () => {
  // The same contract `/api/propose` enforces, from the same one copy in
  // `src/lib/api/wire.ts`. It matters here for the same reason: `extractFields`
  // numbers the lines for the model and validates the range it cites back
  // against them, so a page numbered any other way buys a full extraction and
  // returns a citation of text that is not where it says it is.
  const reached: unknown[] = [];
  const handler = createExtractHandler({
    gate: admits,
    extract: async (body) => {
      reached.push(body);
      return { fields: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  const broken: [string, WirePage][] = [
    [
      "a gap in the line numbering",
      { ...wirePage(0, "a", "one"), lines: [line(0, "first", 200), line(2, "third", 260)] },
    ],
    [
      "a NaN box",
      {
        ...wirePage(0, "a", "one"),
        lines: [{ i: 0, text: "first", box: { x: NaN, y: NaN, w: NaN, h: NaN }, words: [] }],
      },
    ],
    [
      "no page size to bound the boxes against",
      { ...wirePage(0, "a", "one"), width: 0, height: 0 },
    ],
    // The two fields that reach an operator VERBATIM. `toFieldPages` copies
    // them into the citation and `buildXlsx` renders the note as
    // `${sourceName} p${pageInDoc + 1}`, so unchecked they printed
    // "s1 pnot a number1" -- and, worse, a numeric-but-wrong page number that
    // reads perfectly and does not exist in that file.
    [
      "a sourceName that is not a name",
      { ...wirePage(0, "a", "one"), sourceName: {} as unknown as string },
    ],
    [
      "a pageInDoc that is not a page number",
      { ...wirePage(0, "a", "one"), pageInDoc: "not a number" as unknown as number },
    ],
    [
      "a pageInDoc that is really the run-global index",
      { ...wirePage(0, "a", "one"), pageInDoc: 12 },
    ],
  ];

  for (const [what, page] of broken) {
    const response = await handler(extractRequest({ runId: "r", pages: [page] }));
    assert.equal(response.status, 400, what);
  }

  assert.deepEqual(reached, []);
});

/* ------------------------------------------- the citation outcome in fields.ts */

test("citationOutcome tells 'no citation' apart from 'a citation that failed'", () => {
  const page = { index: 0, width: 100, height: 100, lines: [line(0, "a", 10), line(1, "b", 50)] };

  // The distinction the whole route rests on. Both of these used to be the
  // same absent `source`, and an operator looking at a filled cell with no
  // provenance could not tell which one they were signing.
  assert.deepEqual(citationOutcome({ pageIndex: null, from: null, to: null }, [page]), {
    status: "uncited",
  });

  const hallucinatedPage = citationOutcome({ pageIndex: 7, from: 0, to: 1 }, [page]);
  assert.equal(hallucinatedPage.status, "invalid");
  assert.match(
    hallucinatedPage.status === "invalid" ? hallucinatedPage.reason : "",
    /cited page 7, which is not one of the 1 pages/,
  );
  // The claim is kept, so a reviewer sees the shape of the mistake rather
  // than only being told there was one.
  assert.deepEqual(
    hallucinatedPage.status === "invalid" ? hallucinatedPage.claimed : null,
    { pageIndex: 7, from: 0, to: 1 },
  );

  const reversed = citationOutcome({ pageIndex: 0, from: 1, to: 0 }, [page]);
  assert.equal(reversed.status, "invalid");
  assert.match(reversed.status === "invalid" ? reversed.reason : "", /reversed range/);

  const missingLine = citationOutcome({ pageIndex: 0, from: 0, to: 9 }, [page]);
  assert.equal(missingLine.status, "invalid");
  assert.match(missingLine.status === "invalid" ? missingLine.reason : "", /has no line 9/);

  // A HALF-ANSWER IS NOT A NON-ANSWER: a citation the model started and did
  // not finish is a reply worth flagging, not one to round down to "it did
  // not say".
  const halfAnswer = citationOutcome({ pageIndex: 0, from: null, to: null }, [page]);
  assert.equal(halfAnswer.status, "invalid");
  assert.match(halfAnswer.status === "invalid" ? halfAnswer.reason : "", /incomplete/);

  const good = citationOutcome({ pageIndex: 0, from: 0, to: 1 }, [page]);
  assert.deepEqual(good, {
    status: "cited",
    source: { pageIndex: 0, lineRange: [0, 1] },
  });
});

/* ------------------------------------------------------- the six dispositions */

test("a cited value carries the RUN-GLOBAL page, not the pool position it was answered with", async () => {
  // `cc` ranks BA Permintaan first, so page 1 leads its pool and the model's
  // "page 0" is run-global page 1. Echoing the position straight through is
  // the defect `remapCitedPageIndex` exists to stop: it would send a reviewer
  // to the first page of the bundle to check a value read off the second.
  const result = await extractValues(
    { runId: "r", pages: PAGES },
    answering([
      { fieldKey: "cc", value: "BANK CONTOH NUSANTARA", pageIndex: 0, from: 0, to: 1 },
      { fieldKey: "quote", value: "1-70000000001", pageIndex: 0, from: 0, to: 0 },
    ]),
    TEMPLATE,
  );

  const fields = byKey(result.fields);
  const cc = fields.get("cc");
  assert.equal(cc?.status, "cited");
  assert.equal(cc?.source?.pageIndex, 1);
  // And the citation names the page's own document and its number inside it,
  // because a bundle-global index alone sends a reviewer to the wrong file for
  // every page after the first source document.
  assert.equal(cc?.source?.sourceName, "a");
  assert.equal(cc?.source?.pageInDoc, 1);

  // `quote` ranks the email page first, so its "page 0" is run-global page 2.
  const quote = fields.get("quote");
  assert.equal(quote?.status, "cited");
  assert.equal(quote?.source?.pageIndex, 2);
});

test("a hallucinated citation is 'citation-invalid', NOT 'uncited', and keeps the value", async () => {
  // The 2026-09-03 findings' blocker, end to end. The value survives -- it may
  // well be right, and dropping it would discard a good answer -- but the
  // operator is told the model cited a page it was never shown, which is
  // evidence about the answer and not just about the reference.
  const result = await extractValues(
    { runId: "r", pages: PAGES },
    answering([
      { fieldKey: "quote", value: "1-70000000001", pageIndex: 9, from: 0, to: 1 },
    ]),
    TEMPLATE,
  );

  const quote = byKey(result.fields).get("quote");
  assert.equal(quote?.status, "citation-invalid");
  assert.equal(quote?.value, "1-70000000001");
  assert.equal(quote?.confidence, "low");
  assert.match(quote?.reason ?? "", /did not check out/);
  assert.deepEqual(quote?.claimed, { pageIndex: 9, from: 0, to: 1 });
  // No `source`, because there is no citation to print. A `source` beside an
  // invalid citation would be the false citation this pipeline refuses.
  assert.equal(quote?.source, undefined);
});

test("a value the model would not cite is 'uncited', and never high confidence", async () => {
  const result = await extractValues(
    { runId: "r", pages: PAGES },
    answering([
      { fieldKey: "quote", value: "1-70000000001", pageIndex: null, from: null, to: null },
    ]),
    TEMPLATE,
  );

  const quote = byKey(result.fields).get("quote");
  assert.equal(quote?.status, "uncited");
  assert.equal(quote?.value, "1-70000000001");
  assert.equal(quote?.confidence, "low");
});

test("two answers that denote different things come back as a conflict, blank, with both", async () => {
  const result = await extractValues(
    { runId: "r", pages: PAGES },
    answering([
      { fieldKey: "quote", value: "1-70000000001", pageIndex: 0, from: 0, to: 0 },
      { fieldKey: "quote", value: "1-70000000002", pageIndex: 1, from: 0, to: 0 },
    ]),
    TEMPLATE,
  );

  const quote = byKey(result.fields).get("quote");
  assert.equal(quote?.status, "conflict");
  // Blank on purpose: choosing between two quote numbers is the operator's
  // call, and shipping either one is a coin toss printed as evidence.
  assert.equal(quote?.value, "");
  assert.deepEqual(quote?.conflict, ["1-70000000001", "1-70000000002"]);
});

test("a key the documents do not answer is 'not-found', not silently missing", async () => {
  const result = await extractValues(
    { runId: "r", pages: PAGES },
    answering([{ fieldKey: "cc", value: "BANK CONTOH NUSANTARA", pageIndex: 0, from: 0, to: 0 }]),
    TEMPLATE,
  );

  // Every backed key the template declares comes back. A key missing from the
  // response is a key the UI can say nothing about.
  assert.deepEqual(
    result.fields.map((f) => f.fieldKey).sort(),
    ["cc", "namaProyek", "quote"],
  );
  const quote = byKey(result.fields).get("quote");
  assert.equal(quote?.status, "not-found");
  assert.equal(quote?.value, "");
  assert.match(quote?.reason ?? "", /searched every page/);
});

test("a key the order request answered is 'not-searched', and is not sent to the model", async () => {
  const prompts: string[] = [];
  const spy = async (prompt: string): Promise<string> => {
    prompts.push(prompt);
    return prompt.includes("segmenting")
      ? SPANS
      : JSON.stringify({ values: [{ fieldKey: "cc", value: "X", pageIndex: 0, from: 0, to: 0 }] });
  };

  const result = await extractValues(
    { runId: "r", pages: PAGES, answered: ["quote"] },
    spy,
    TEMPLATE,
  );

  const quote = byKey(result.fields).get("quote");
  assert.equal(quote?.status, "not-searched");
  assert.match(quote?.reason ?? "", /order request supplies this value/);
  // NOT ASKED FOR, not merely ignored. A value the request already supplies
  // must not also be hunted for in the scans: the hunt can succeed plausibly
  // and then two answers have to be reconciled by machinery that cannot know
  // the request is the authority.
  assert.ok(
    prompts.every((prompt) => !/^Fields:.*\bquote\b/m.test(prompt)),
    "quote must not appear in any extraction prompt's Fields line",
  );
});

test("no pages means every key is 'not-searched', and the model is never called", async () => {
  const result = await extractValues(
    { runId: "r", pages: [] },
    async () => {
      throw new Error("the model must not be reached with no pages to read");
    },
    TEMPLATE,
  );

  assert.ok(result.fields.length > 0);
  for (const field of result.fields) {
    // NOT `not-found`: saying the bundle does not contain a customer name
    // would be a statement about documents nobody opened.
    assert.equal(field.status, "not-searched");
  }
});

/* ------------------------------------------------------- the poisoned fields */

test("namaProyek comes back not-searched even when the model volunteers an answer", async () => {
  const result = await extractValues(
    { runId: "r", pages: PAGES },
    answering([
      { fieldKey: "namaProyek", value: "PSB VPN IP KCP Contoh", pageIndex: 0, from: 0, to: 1 },
      { fieldKey: "cc", value: "BANK CONTOH NUSANTARA", pageIndex: 0, from: 0, to: 1 },
    ]),
    TEMPLATE,
  );

  const namaProyek = byKey(result.fields).get("namaProyek");
  // It reaches the two most-read cells in the deliverables, and on the full
  // pool it reliably answered with the master contract's scope title carrying
  // a citation that PASSED validation. Blank, with the reason, is the whole
  // point: a blank invites the operator to fill it in and a plausible wrong
  // value does not.
  assert.equal(namaProyek?.status, "not-searched");
  assert.equal(namaProyek?.value, "");
  assert.match(namaProyek?.reason ?? "", /deliberately not extracted/);
});

test("cc is returned but never at high confidence, however clean its citation", async () => {
  const result = await extractValues(
    { runId: "r", pages: PAGES },
    answering([
      { fieldKey: "cc", value: "BANK CONTOH NUSANTARA", pageIndex: 0, from: 0, to: 1 },
    ]),
    TEMPLATE,
  );

  const cc = byKey(result.fields).get("cc");
  assert.equal(cc?.status, "cited");
  assert.equal(cc?.value, "BANK CONTOH NUSANTARA");
  // A validated citation proves the lines exist, not that they name the
  // subscriber rather than a distribution list -- which is exactly the
  // mistake that shipped a wrong customer on both deliverables.
  assert.equal(cc?.confidence, "low");
  assert.match(cc?.reason ?? "", /confirm it against the document/);
});

/* ------------------------------------------------ reaching the model, or not */

test("a model that cannot be reached is a 503, NOT a page of 'not-found'", async () => {
  // The defect `/api/propose` recorded, one route over: with no API key the
  // route would answer 200 with every field marked as searched and missing,
  // and the operator would be told their documents do not contain values
  // nothing ever read.
  const noCredential = async (): Promise<string> => {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set.");
  };

  const handler = createExtractHandler({
    gate: admits,
    extract: (body) => extractValues(body, noCredential, TEMPLATE),
    unreachable: (error) =>
      Response.json(
        { error: "unreachable", cause: (error as Error).message },
        { status: 503 },
      ),
  });

  const response = await handler(extractRequest({ runId: "r", pages: PAGES }));

  assert.equal(response.status, 503);
  // Unwrapped: the 503 names the real cause, not the internal wrapper.
  assert.match(
    ((await response.json()) as { cause: string }).cause,
    /GOOGLE_GENERATIVE_AI_API_KEY/,
  );
});

test("a reply that arrives and cannot be used is a 502, not a 503 and not a run of 'not-found'", async () => {
  // Three different things: the provider was unreachable, the provider
  // answered nonsense, and the documents do not contain the value. Only the
  // first is a credential problem and only the last is a statement about the
  // documents.
  const garbage = async (prompt: string): Promise<string> =>
    prompt.includes("segmenting") ? SPANS : "not json at all";

  const handler = createExtractHandler({
    gate: admits,
    extract: (body) => extractValues(body, garbage, TEMPLATE),
    unreachable: () =>
      Response.json({ error: "unreachable" }, { status: 503 }),
  });

  const response = await handler(extractRequest({ runId: "r", pages: PAGES }));

  assert.equal(response.status, 502);
  assert.equal(((await response.json()) as { error: string }).error, "unusable-reply");
});

/* ------------------------------------------------------------- page identity */

test("pageInDoc is derived per source document, and restarts for the second file", () => {
  const pages = toFieldPages([
    wirePage(0, "a", "one"),
    wirePage(1, "a", "two"),
    wirePage(2, "b", "three"),
  ]);

  assert.deepEqual(
    pages.map((p) => [p.sourceName, p.pageInDoc]),
    [
      ["a", 0],
      ["a", 1],
      ["b", 0],
    ],
  );

  // What the browser sends wins over what is derived: it knows the real
  // filename and the real page number, and this route never invents either.
  // `assertWirePages` still BOUNDS what may be sent -- a pageInDoc past the
  // last page the run carries of that document is the run-global index by
  // another name -- so this reads the trusted path directly rather than
  // through the handler.
  const told = toFieldPages([
    ...Array.from({ length: 12 }, (_, i) => wirePage(i, "a", "page")),
    { ...wirePage(12, "a", "one"), sourceName: "bundle.pdf", pageInDoc: 12 },
  ]);
  assert.equal(told[12].sourceName, "bundle.pdf");
  assert.equal(told[12].pageInDoc, 12);
});
