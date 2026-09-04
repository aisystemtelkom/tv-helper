/**
 * `/api/propose`: the gate, the page-numbering guard, and the multi-capture
 * rule.
 *
 * No Next runtime, no bundler, no credential. `handler.ts` imports only pure
 * pipeline modules and takes its model call as an argument, so the whole
 * control flow runs here with a fake `ask`.
 *
 * What these protect is the thing a human validator signs. A zone attributed
 * to the wrong page, or a two-capture slot silently answered once, both
 * produce a document that opens fine and carries the wrong evidence.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createAllowlist, type AllowlistReader } from "../../../lib/auth/allowlist.ts";
import {
  createGuard,
  type ApiGate,
  type SessionLike,
} from "../../../lib/auth/guard.ts";
import type { Line } from "../../../lib/pipeline/geometry.ts";
import {
  applyResponse,
  buildProposeRequest,
  capturesToWalk,
} from "../../../lib/ui/propose.ts";
import type { BrowserRun } from "../../../lib/browser/types.ts";
import type { SectionDef, Template } from "../../../lib/forms/template.ts";
import { continuationChecked } from "../../../lib/browser/captures.ts";
import {
  assertRunGlobalIndexes,
  createProposeHandler,
  parseProposeBody,
  proposeZones,
  rankedPoolForSlot,
  type WirePage,
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

/**
 * The keys one consolidated locate prompt is asking about, read back off it.
 *
 * The route no longer makes one call per slot, so "which slots reached the
 * model" is no longer a call count -- it is the contents of a prompt. Every
 * double below answers BY KEY through this, which means a prompt that stopped
 * naming its slots, or named the wrong ones, fails these tests instead of
 * quietly answering the wrong thing.
 *
 * It THROWS rather than returning an empty list, so a non-locate prompt that
 * reaches a locate double is loud. A double that answered `{"answers":[]}` to
 * a prompt it did not understand would report every slot "the model found no
 * match", which reads exactly like a document that does not contain them.
 */
function askedKeys(prompt: string): string[] {
  return [...prompt.matchAll(/^- key: (.+)$/gm)].map((m) => m[1].trim());
}

/**
 * A locate answer in WHICHEVER SHAPE THE PROMPT ASKED FOR.
 *
 * `locateSlots` sends two different prompts depending on
 * `MAX_SLOTS_PER_LOCATE_CALL`: the original single-slot `buildLocatePrompt` at
 * the shipped default of 1, and `buildPoolLocatePrompt` above it. A double
 * that spoke only one of them would pin the dial rather than the behaviour,
 * and every test here is about behaviour that must hold at either setting --
 * so this answers whatever it was handed.
 *
 * A pool prompt lists its keys as `- key: <name>` lines; a single-slot prompt
 * names no keys at all, and its answer carries no key field.
 */
function poolAnswer(
  prompt: string,
  answerFor: (key: string) => {
    pageIndex: number | null;
    from: number | null;
    to: number | null;
    confidence?: "high" | "low";
  },
): string {
  const keys = askedKeys(prompt);

  if (keys.length === 0) {
    // The single-slot prompt. It never names a key, so the answer is keyed by
    // whichever slot the caller is currently asking about -- which `answerFor`
    // is free to ignore, exactly as it ignores the key in the pooled case
    // when it answers uniformly.
    const label = /answers the field "([^"]+)"/.exec(prompt)?.[1] ?? "";
    return JSON.stringify({ confidence: "high", ...answerFor(label) });
  }

  return JSON.stringify({
    answers: keys.map((key) => ({
      confidence: "high",
      ...answerFor(key),
      // Last, so an `answerFor` cannot answer under a key it was not asked
      // about: that is the model's mistake to make, not a double's.
      key,
    })),
  });
}

/** A capture's zone, as the browser sends one it already holds evidence for. */
const ZONE_ON_PAGE_0 = {
  pageIndex: 0,
  box: { x: 100, y: 200, w: 900, h: 100 },
  lineRange: [0, 1] as [number, number],
};

function proposeRequest(body: unknown): Request {
  return new Request("http://localhost/api/propose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ------------------------------------------------------------------ the gate */

test("an unauthenticated POST to /api/propose is refused, and the model is never reached", async () => {
  const guard = guardFor(null);
  const reached: unknown[] = [];
  const handler = createProposeHandler({
    gate: () => guard.apiUser(),
    search: async (body) => {
      reached.push(body);
      return { proposals: [], outstanding: [], continuations: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  const response = await handler(
    proposeRequest({ runId: "r", pages: [], wanted: [] }),
  );

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

test("an admitted caller sending within-source page numbers gets a 400, not a search", async () => {
  const reached: unknown[] = [];
  const handler = createProposeHandler({
    gate: admits,
    search: async (body) => {
      reached.push(body);
      return { proposals: [], outstanding: [], continuations: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  const response = await handler(
    proposeRequest({
      runId: "r",
      wanted: [],
      pages: [wirePage(0, "a", "one"), wirePage(0, "b", "two")],
    }),
  );

  assert.equal(response.status, 400);
  // The guard runs before the credential is spent, so a caller that numbered
  // its pages the other way pays nothing and is told why.
  assert.deepEqual(reached, []);
  assert.match(
    ((await response.json()) as { cause?: string }).cause ?? "",
    /run-global position/,
  );
});

test("a malformed line is refused before the credential is spent", async () => {
  // The route used to check `Array.isArray(page.lines)` and nothing more,
  // while checking the page NUMBERING contract twice and very carefully. But
  // the whole pipeline counts in lines: the locate prompt numbers them, the
  // model answers with a range of them, and `boxForLineRange` turns that
  // range back into the rectangle a validator signs. A page whose lines are
  // numbered any other way, or whose box is NaN or off the page, buys a full
  // search and returns a plausible citation of the wrong text.
  const reached: unknown[] = [];
  const handler = createProposeHandler({
    gate: admits,
    search: async (body) => {
      reached.push(body);
      return { proposals: [], outstanding: [], continuations: [] };
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
      "a box off the page",
      {
        ...wirePage(0, "a", "one"),
        lines: [{ i: 0, text: "first", box: { x: 0, y: 0, w: 9999, h: 40 }, words: [] }],
      },
    ],
    [
      "lines out of reading order",
      { ...wirePage(0, "a", "one"), lines: [line(0, "lower", 900), line(1, "upper", 100)] },
    ],
    [
      "no page size to bound the boxes against",
      { ...wirePage(0, "a", "one"), width: 0, height: 0 },
    ],
  ];

  for (const [what, page] of broken) {
    const response = await handler(
      proposeRequest({ runId: "r", wanted: [], pages: [page] }),
    );
    assert.equal(response.status, 400, what);
  }

  // The point is not the status code but that nothing was searched: every one
  // of these arrived past the gate and stopped before a token was spent.
  assert.deepEqual(reached, []);
});

/* ------------------------------------------------- the page-numbering guard */

test("a page numbered within its own source is refused, not searched", () => {
  // Two documents of two pages each, numbered the way `StoredPage.index` is:
  // restarting at 0 for the second file. That is a legitimate `StoredPage`
  // list and an ILLEGITIMATE request body, because `locateSlot` copies these
  // numbers straight into `Zone.pageIndex`, which indexes `run.pages`.
  const perSource = [
    wirePage(0, "a", "KB page one"),
    wirePage(1, "a", "KB page two"),
    wirePage(0, "b", "SP page one"),
    wirePage(1, "b", "SP page two"),
  ];

  assert.throws(
    () => assertRunGlobalIndexes(perSource),
    /run-global position/,
    "sending within-source page numbers must fail loudly rather than " +
      "attribute every zone after the first document to the wrong page",
  );
});

test("run-global numbering is accepted", () => {
  const global = [
    wirePage(0, "a", "KB page one"),
    wirePage(1, "a", "KB page two"),
    wirePage(2, "b", "SP page one"),
    wirePage(3, "b", "SP page two"),
  ];
  assert.doesNotThrow(() => assertRunGlobalIndexes(global));
  assert.equal(parseProposeBody({ runId: "r", pages: global, wanted: [] }).pages.length, 4);
});

test("a malformed captures list is a 400, not a 503 blamed on the model", () => {
  // The lanjutan half of the request. Absent is legitimate -- a client that
  // only wants the search sends nothing -- but a malformed one must stop here.
  // `body.captures ?? []` accepts a string, `for..of` walks its characters,
  // and the first `capture.key` read throws a TypeError that the handler
  // catches on its PROVIDER-FAILURE path: the operator is told the model could
  // not be reached, and presses Proses again for as long as they can stand it.
  const pages = [wirePage(0, "a", "KB page one")];
  const base = { runId: "r", pages, wanted: [] };

  assert.doesNotThrow(() => parseProposeBody(base), "absent is fine");
  assert.doesNotThrow(() =>
    parseProposeBody({
      ...base,
      captures: [
        { key: "kbLanjutan.top", zone: ZONE_ON_PAGE_0 },
      ],
    }),
  );

  assert.throws(() => parseProposeBody({ ...base, captures: "kb" }), /array/);
  assert.throws(
    () => parseProposeBody({ ...base, captures: [{ zone: ZONE_ON_PAGE_0 }] }),
    /key/,
  );
  assert.throws(
    () => parseProposeBody({ ...base, captures: [{ key: "a" }] }),
    /zone/,
  );
  assert.throws(
    () =>
      parseProposeBody({
        ...base,
        captures: [{ key: "a", zone: { ...ZONE_ON_PAGE_0, pageIndex: -1 } }],
      }),
    /pageIndex/,
  );
  assert.throws(
    () =>
      parseProposeBody({
        ...base,
        captures: [{ key: "a", zone: { ...ZONE_ON_PAGE_0, lineRange: [0] } }],
      }),
    /lineRange/,
  );
});

/* ------------------------------------------------------------ the pool rule */

test("ranking is a preference, never a filter: every page stays in the pool", () => {
  const pages = [
    wirePage(0, "a", "one"),
    wirePage(1, "a", "two"),
    wirePage(2, "b", "three"),
  ];
  const byType = new Map([["SP" as const, new Set([2])]]);

  const pool = rankedPoolForSlot(
    { key: "k", label: "L", docType: "SP", hint: "h", fillable: true },
    pages,
    byType,
  );

  // The preferred page leads, and nothing was dropped. Narrowing the pool is
  // what shipped a wrong customer once; the fix was ranking, not filtering.
  assert.equal(pool.length, 3);
  assert.equal(pool[0].index, 2);
  assert.deepEqual(
    pool.map((p) => p.index).sort((a, b) => a - b),
    [0, 1, 2],
  );
});

/* ------------------------------------------------------- the multi-capture rule */

/**
 * ONE SLOT, NO DECLARED CAPTURE COUNT.
 *
 * `crops: 2` used to sit on this fixture, mirroring the real template. Both
 * are gone: a lanjutan is discovered per document now, so the only way a
 * second capture of this bagian exists is that something walked the first one
 * forward and found it.
 */
const twoCaptureSection: SectionDef = {
  title: "KB (lanjutan)",
  layout: "table",
  slots: [
    {
      key: "kbLanjutan.top",
      label: "ToP",
      docType: null,
      hint: "the payment clause",
      fillable: true,
    },
  ],
};

const TEMPLATE: Template = {
  id: "t",
  label: "T",
  sections: [twoCaptureSection],
  xlsxRows: [],
  fieldHints: {},
};

/** A model that names the second page offered, for every slot it is asked. */
const answersSecondPage = async (prompt: string): Promise<string> =>
  prompt.includes("segmenting")
    ? '{"spans":[{"docType":"KB","fromPage":0,"toPage":1}]}'
    : poolAnswer(prompt, () => ({ pageIndex: 1, from: 0, to: 1 }));

test("a zone's pageIndex is the run-global page, not the page's own number", async () => {
  // Two documents. The answer names pool position 1, which is run-global
  // page 1 here; the point is that what comes back indexes `run.pages`.
  const pages = [
    wirePage(0, "a", "first document page one"),
    wirePage(1, "a", "first document page two"),
    wirePage(2, "b", "second document page one"),
  ];

  const result = await proposeZones(
    { runId: "r", pages, wanted: ["kbLanjutan.top#1", "kbLanjutan.top#2"] },
    answersSecondPage,
    TEMPLATE,
  );

  assert.equal(result.proposals.length, 1);
  const zone = result.proposals[0].zone;
  // Run-global index 1, and it must resolve inside `run.pages`.
  assert.equal(zone.pageIndex, 1);
  assert.ok(zone.pageIndex < pages.length);
});

test("a leftover lanjutan key is reported, never answered by the wide search", async () => {
  // A run stored under the old declared-count design still carries
  // `kbLanjutan.top#2`. The search cannot answer it: a lanjutan is defined by
  // the capture it follows, and asking `locateSlot` for one is exactly the
  // question that produced the gate's long-standing ToP miss (the wide call
  // answered lines 5-16 against the human's 0-15). So it is reported and left
  // to the walk, rather than silently filled with a second wide answer.
  const pages = [wirePage(0, "a", "alpha"), wirePage(1, "a", "beta")];

  const result = await proposeZones(
    { runId: "r", pages, wanted: ["kbLanjutan.top", "kbLanjutan.top#2"] },
    answersSecondPage,
    TEMPLATE,
  );

  assert.deepEqual(
    result.proposals.map((p) => p.key),
    ["kbLanjutan.top"],
  );
  assert.deepEqual(
    result.outstanding.map((o) => o.key),
    ["kbLanjutan.top#2"],
  );
  assert.match(result.outstanding[0].reason, /working forward/);
});

test("a slot the search cannot find is reported outstanding, not dropped", async () => {
  const notFound = async (prompt: string): Promise<string> =>
    prompt.includes("segmenting")
      ? '{"spans":[{"docType":"KB","fromPage":0,"toPage":0}]}'
      : poolAnswer(prompt, () => ({
          pageIndex: null,
          from: null,
          to: null,
          confidence: "low",
        }));

  const result = await proposeZones(
    { runId: "r", pages: [wirePage(0, "a", "alpha")], wanted: ["kbLanjutan.top"] },
    notFound,
    TEMPLATE,
  );

  assert.deepEqual(result.proposals, []);
  assert.deepEqual(
    result.outstanding.map((o) => o.key),
    ["kbLanjutan.top"],
  );
});

/* --------------------------------------------- one call per POOL, not per slot */

/**
 * Four slots over two pools, which is the shape the consolidation is about.
 *
 * `kb.nomor`, `kb.ttd` and `kbLanjutan.ttd` all carry `docType: "KB"`, so they
 * rank the same pages and share one call -- ACROSS SECTIONS, which is the part
 * a per-section loop could never see. `ba.nomor` carries a different docType
 * and so gets its own.
 *
 * TWO SLOTS IN THE SAME POOL SHARE A LABEL, deliberately: `AO_TEMPLATE` has two
 * `TTD Pejabat` and two `Nomor`, and a consolidated reply keyed by LABEL would
 * merge their answers into one and ship a picture of one row's evidence against
 * the other. The reply is keyed by `slot.key`, which is unique.
 */
const TWO_POOL_TEMPLATE: Template = {
  id: "t",
  label: "T",
  sections: [
    {
      title: "KB",
      layout: "table",
      slots: [
        {
          key: "kb.nomor",
          label: "Nomor",
          docType: "KB",
          hint: "the agreement number",
          fillable: true,
        },
        {
          key: "kb.ttd",
          label: "TTD Pejabat",
          docType: "KB",
          hint: "the signature block of the agreement",
          fillable: true,
        },
      ],
    },
    {
      title: "KB (lanjutan)",
      layout: "table",
      slots: [
        {
          key: "kbLanjutan.ttd",
          label: "TTD Pejabat",
          docType: "KB",
          hint: "the signature block on the continuation page",
          fillable: true,
        },
      ],
    },
    {
      title: "BA Permintaan",
      layout: "table",
      slots: [
        {
          key: "ba.nomor",
          label: "Nomor",
          docType: "BAPermintaan",
          hint: "the number of the berita acara permintaan",
          fillable: true,
        },
      ],
    },
  ],
  xlsxRows: [],
  fieldHints: {},
};

const TWO_PAGES = [wirePage(0, "a", "alpha"), wirePage(1, "a", "beta")];

test("slots that share a pool share ONE call, and the prompt names exactly them", async () => {
  // THE SAVING, PINNED AS A PROPERTY OF THE PROMPT RATHER THAN AS A CALL COUNT.
  // Every fillable table slot in the production template carries
  // `docType: "KB"`, so one call per slot re-uploaded the same ~23k-token page
  // listing seven times: 160.7k input tokens a run, about 138k of it redundant.
  // What must stay true is not "few calls" but "one call per pool, asking about
  // exactly the slots that pool is for" -- a prompt that named a slot from
  // another pool would be answering a question over pages that were never
  // ranked for it.
  const locatePrompts: string[] = [];
  const answersEverything = async (prompt: string): Promise<string> => {
    if (prompt.includes("segmenting")) {
      return '{"spans":[{"docType":"KB","fromPage":0,"toPage":1}]}';
    }
    if (prompt.includes("--- next page ---")) {
      return '{"continues":false,"from":null,"to":null,"confidence":"high"}';
    }
    locatePrompts.push(prompt);
    return poolAnswer(prompt, () => ({ pageIndex: 0, from: 0, to: 1 }));
  };

  // Driven with the dial RAISED, because grouping is what this test is about
  // and the shipped default is one slot per call. See
  // MAX_SLOTS_PER_LOCATE_CALL: every multi-slot setting measured worse on the
  // gate, so the saving ships switched off -- but the route must still behave
  // when somebody switches it on, which is what this pins.
  const result = await proposeZones(
    {
      runId: "r",
      pages: TWO_PAGES,
      wanted: ["kb.nomor", "kb.ttd", "kbLanjutan.ttd", "ba.nomor"],
    },
    answersEverything,
    TWO_POOL_TEMPLATE,
    9,
  );

  assert.equal(locatePrompts.length, 2, "four slots, two pools, two calls");
  assert.deepEqual(
    locatePrompts.map((prompt) => askedKeys(prompt).sort()),
    [["kb.nomor", "kb.ttd", "kbLanjutan.ttd"], ["ba.nomor"]],
  );
  // A prompt must never mix pools, whatever the dial says: pages ranked for
  // one document type would be answering a question asked about another.
  for (const prompt of locatePrompts) {
    const keys = askedKeys(prompt);
    const pools = new Set(keys.map((k) => (k.startsWith("ba.") ? "ba" : "kb")));
    assert.equal(pools.size, 1, `one prompt named two pools: ${keys.join(", ")}`);
  }

  // And every slot still comes back with its own zone: sharing a call must not
  // cost a slot its answer.
  assert.deepEqual(
    result.proposals.map((p) => p.key).sort(),
    ["ba.nomor", "kb.nomor", "kb.ttd", "kbLanjutan.ttd"],
  );
  assert.deepEqual(result.outstanding, []);
});

test("one bad ANSWER costs one slot, and a key the reply skips is still reported", async () => {
  // The property one call per slot had for free and this one has to rebuild.
  // The reply below is wrong in the two ways a consolidated reply can be wrong
  // about a single slot: `kb.nomor` names a page position the pool does not
  // have, and `kb.ttd` is simply not mentioned. Neither may cost
  // `kbLanjutan.ttd`, which was answered correctly by the same reply -- and
  // neither may vanish: a slot in neither list is a slot the review screen
  // never mentions again.
  const oneBadOneMissing = async (prompt: string): Promise<string> => {
    if (prompt.includes("segmenting")) {
      return '{"spans":[{"docType":"KB","fromPage":0,"toPage":1}]}';
    }
    if (prompt.includes("--- next page ---")) {
      return '{"continues":false,"from":null,"to":null,"confidence":"high"}';
    }
    assert.deepEqual(
      askedKeys(prompt).sort(),
      ["kb.nomor", "kb.ttd", "kbLanjutan.ttd"],
      "all three KB slots must be asked in the one call",
    );
    return JSON.stringify({
      answers: [
        { key: "kb.nomor", pageIndex: 9, from: 0, to: 1, confidence: "high" },
        {
          key: "kbLanjutan.ttd",
          pageIndex: 0,
          from: 0,
          to: 1,
          confidence: "high",
        },
      ],
    });
  };

  const result = await proposeZones(
    {
      runId: "r",
      pages: TWO_PAGES,
      wanted: ["kb.nomor", "kb.ttd", "kbLanjutan.ttd"],
    },
    oneBadOneMissing,
    TWO_POOL_TEMPLATE,
    9,
  );

  assert.deepEqual(
    result.proposals.map((p) => p.key),
    ["kbLanjutan.ttd"],
  );
  const why = new Map(result.outstanding.map((o) => [o.key, o.reason]));
  assert.deepEqual([...why.keys()].sort(), ["kb.nomor", "kb.ttd"]);
  // Both read as a failed search rather than as "not in these pages", which is
  // reserved for a model that answered null. An omitted key is silence, not a
  // verdict -- see MAX_SLOTS_PER_LOCATE_CALL, where omission is the measured
  // failure mode of asking about several slots at once. The diagnosis still
  // survives inside the reason, and it has to: a page the pool does not have
  // and a question that was never answered need different fixes.
  assert.match(why.get("kb.nomor") ?? "", /^search failed: .*pageIndex 9/);
  assert.match(why.get("kb.ttd") ?? "", /^search failed: .*found no match/);
});

test("a failed CALL names every slot in that pool, and costs no other pool", async () => {
  // Consolidating gives this one away and it cannot be rebuilt: there is one
  // call and it either answered or it did not. What must not happen is the
  // pool's slots falling out of both lists -- so every one of them is named
  // with the reason, and the pools that answered are untouched. The run is not
  // failed over it: by this point the request has spent real work on slots that
  // succeeded, and the operator finishes the document by hand anyway.
  const kbPoolIsGarbage = async (prompt: string): Promise<string> => {
    if (prompt.includes("segmenting")) {
      return '{"spans":[{"docType":"KB","fromPage":0,"toPage":1}]}';
    }
    if (prompt.includes("--- next page ---")) {
      return '{"continues":false,"from":null,"to":null,"confidence":"high"}';
    }
    if (askedKeys(prompt).includes("kb.nomor")) return "not json at all";
    return poolAnswer(prompt, () => ({ pageIndex: 0, from: 0, to: 1 }));
  };

  const result = await proposeZones(
    {
      runId: "r",
      pages: TWO_PAGES,
      wanted: ["kb.nomor", "kb.ttd", "kbLanjutan.ttd", "ba.nomor"],
    },
    kbPoolIsGarbage,
    TWO_POOL_TEMPLATE,
    9,
  );

  assert.deepEqual(
    result.proposals.map((p) => p.key),
    ["ba.nomor"],
  );
  assert.deepEqual(
    result.outstanding.map((o) => o.key).sort(),
    ["kb.nomor", "kb.ttd", "kbLanjutan.ttd"],
  );
  for (const entry of result.outstanding) {
    assert.match(entry.reason, /search failed/, entry.key);
  }
});

test("a model that cannot be reached is a 503, NOT a run full of 'not found'", async () => {
  // The defect this pins, reproduced against the running app before it was
  // fixed: with no API key the route answered 200 and marked every slot
  // "outstanding" -- which means SEARCHED AND NOT FOUND and drives the
  // dokumen tambahan loop. The operator would have gone hunting for documents
  // to fill slots nothing had ever looked at.
  const noCredential = async (): Promise<string> => {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set.");
  };

  await assert.rejects(
    () =>
      proposeZones(
        { runId: "r", pages: [wirePage(0, "a", "alpha")], wanted: ["kbLanjutan.top"] },
        noCredential,
        TEMPLATE,
      ),
    /could not be reached/,
  );

  // And through the handler it must be the provider's 503, not a 200.
  const handler = createProposeHandler({
    gate: admits,
    search: (body) => proposeZones(body, noCredential, TEMPLATE),
    unreachable: (error) =>
      Response.json(
        { error: "unreachable", cause: (error as Error).message },
        { status: 503 },
      ),
  });

  const response = await handler(
    proposeRequest({
      runId: "r",
      wanted: ["kbLanjutan.top"],
      pages: [wirePage(0, "a", "alpha")],
    }),
  );

  assert.equal(response.status, 503);
  // Unwrapped: the 503 names the real cause, not the internal wrapper.
  assert.match(
    ((await response.json()) as { cause: string }).cause,
    /GOOGLE_GENERATIVE_AI_API_KEY/,
  );
});

test("a provider that fails only at LOCATE is still a 503, at every dial", async () => {
  // THE TEST ABOVE PASSES FOR A REASON THAT IS NOT THE ONE IT NAMES, and this
  // is the half it does not reach. Its double refuses every prompt, so the
  // 503 is raised by `classifyByDocType` and the search is never entered. Here
  // classification SUCCEEDS and only the locate call cannot reach the provider,
  // which is the ordinary shape of a provider going down mid-request.
  //
  // Measured on the shipped dial before this was fixed: the request resolved
  // 200 with `outstanding: [{ reason: "the model could not be reached" }]`.
  // `locateSlots` catches per slot when it is asked about one slot at a time,
  // so the `AskFailed` tag never reached the route's own catch -- and
  // "outstanding" means SEARCHED AND NOT FOUND, which drives the dokumen
  // tambahan loop. The operator would go looking for documents to fill a slot
  // nothing had ever read. That is the precise defect `AskFailed` exists for,
  // rebuilt one layer down by consolidation.
  const classifiesThenDies = async (prompt: string): Promise<string> => {
    if (prompt.includes("segmenting")) {
      return '{"spans":[{"docType":"KB","fromPage":0,"toPage":0}]}';
    }
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set.");
  };

  // Both settings of the accuracy/cost dial: at 1 the failure is swallowed by
  // `locateSlots` and has to be noticed, above 1 it is thrown straight out.
  // Neither may be reported as a document that lacks the slot.
  for (const slotsPerCall of [1, 9]) {
    await assert.rejects(
      () =>
        proposeZones(
          {
            runId: "r",
            pages: [wirePage(0, "a", "alpha")],
            wanted: ["kbLanjutan.top"],
          },
          classifiesThenDies,
          TEMPLATE,
          slotsPerCall,
        ),
      /could not be reached/,
      `slotsPerCall=${slotsPerCall}`,
    );
  }
});

test("a classify failure does not cost the run its search", async () => {
  // Classification only ranks the pool. A document that will not classify
  // loses its head start and nothing else; failing the request would cost the
  // operator every slot over a preference.
  const classifyBroken = async (prompt: string): Promise<string> =>
    prompt.includes("segmenting")
      ? "{ this is not json"
      : poolAnswer(prompt, () => ({ pageIndex: 0, from: 0, to: 1 }));

  const result = await proposeZones(
    { runId: "r", pages: [wirePage(0, "a", "alpha")], wanted: ["kbLanjutan.top"] },
    classifyBroken,
    TEMPLATE,
  );

  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].zone.pageIndex, 0);
});

/* --------------------------------------------- whole-page ("images") sections */

/**
 * The routing `scripts/generate.mjs` has always done and this route did not.
 *
 * A `layout: "images"` section is a whole-page capture: the human filling the
 * sample screenshots the entire page, so there is no region inside it to find.
 * This route used to hand those slots to `locateSlot` like any other, which
 * returns a plausible-looking FRAGMENT of the right page -- a crop that opens
 * fine, looks like evidence, and is not the capture. Four of the production
 * template's twelve captures are whole-page, so a third of the deliverable was
 * that.
 */
const IMAGE_TEMPLATE: Template = {
  id: "t",
  label: "T",
  sections: [
    {
      title: "SP",
      layout: "images",
      slots: [
        {
          key: "sp.1",
          label: "SP",
          docType: "SP",
          hint: "the whole Surat Penunjukan page",
          fillable: true,
        },
        {
          key: "sp.2",
          label: "SP (lanjutan)",
          docType: "SP",
          hint: "the second whole page of the Surat Penunjukan",
          fillable: true,
        },
      ],
    },
    twoCaptureSection,
  ],
  xlsxRows: [],
  fieldHints: {},
};

/** Classifies pages 1 and 2 as the SP; refuses to be asked anything else. */
const classifiesSpOnly = async (prompt: string): Promise<string> => {
  if (prompt.includes("segmenting")) {
    return JSON.stringify({
      spans: [
        { docType: "KB", fromPage: 0, toPage: 0 },
        { docType: "SP", fromPage: 1, toPage: 2 },
      ],
    });
  }
  throw new Error(
    "a whole-page slot must not reach the locate call: asking the model to " +
      "find a page inside that page is the defect this test pins",
  );
};

test("a whole-page slot takes the page WHOLE, with no model call", async () => {
  const pages = [
    wirePage(0, "a", "KB page"),
    wirePage(1, "a", "SP page one"),
    wirePage(2, "a", "SP page two"),
  ];

  const result = await proposeZones(
    { runId: "r", pages, wanted: ["sp.1", "sp.2"] },
    classifiesSpOnly,
    IMAGE_TEMPLATE,
  );

  assert.equal(result.outstanding.length, 0);
  const byKey = new Map(result.proposals.map((p) => [p.key, p]));

  // Consecutive slots take consecutive pages of the document: that is what
  // "SP" and "SP (lanjutan)" mean.
  assert.equal(byKey.get("sp.1")?.zone.pageIndex, 1);
  assert.equal(byKey.get("sp.2")?.zone.pageIndex, 2);

  // WHOLE, not a region. A box smaller than the page is the failure.
  assert.deepEqual(byKey.get("sp.1")?.zone.box, {
    x: 0,
    y: 0,
    w: 2480,
    h: 3507,
  });
  assert.deepEqual(byKey.get("sp.1")?.zone.lineRange, [0, 1]);
});

test("a whole-page slot with no page of its type is outstanding, not an arbitrary page", async () => {
  // Taking whatever page happened to be there would be plausible wrong
  // evidence, which is worse than a slot the operator is asked to settle.
  const noSp = async (prompt: string): Promise<string> => {
    if (prompt.includes("segmenting")) {
      return '{"spans":[{"docType":"KB","fromPage":0,"toPage":1}]}';
    }
    throw new Error("must not reach the locate call");
  };

  const result = await proposeZones(
    {
      runId: "r",
      pages: [wirePage(0, "a", "KB one"), wirePage(1, "a", "KB two")],
      wanted: ["sp.1"],
    },
    noSp,
    IMAGE_TEMPLATE,
  );

  assert.equal(result.proposals.length, 0);
  assert.equal(result.outstanding.length, 1);
  assert.equal(result.outstanding[0].key, "sp.1");
  assert.match(result.outstanding[0].reason, /no SP page 0/);
});

test("re-searching only the second SP slot does not hand it the first one's page", async () => {
  // The ordinal is the slot's FIXED place in the template, not its place
  // among the slots wanted this time. Counting only the wanted ones would
  // give `sp.2` the very page `sp.1` is already confirmed on, and the
  // deliverable would carry the same screenshot twice.
  const result = await proposeZones(
    {
      runId: "r",
      pages: [
        wirePage(0, "a", "KB page"),
        wirePage(1, "a", "SP page one"),
        wirePage(2, "a", "SP page two"),
      ],
      wanted: ["sp.2"],
    },
    classifiesSpOnly,
    IMAGE_TEMPLATE,
  );

  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].key, "sp.2");
  assert.equal(result.proposals[0].zone.pageIndex, 2);
});

/* ------------------------------------------------------ the lanjutan chain */

/**
 * A model that walks a clause across every page it is given.
 *
 * Three prompts reach it and they are told apart by their own wording:
 * `classifyPages` says "segmenting", `buildContinuationPrompt` ends with the
 * next page's listing under `--- next page ---`, and anything else is
 * `locateSlots`.
 */
const walksTheWholeDocument = async (prompt: string): Promise<string> => {
  if (prompt.includes("segmenting")) {
    return '{"spans":[{"docType":"KB","fromPage":0,"toPage":2}]}';
  }
  if (prompt.includes("--- next page ---")) {
    return '{"continues":true,"from":0,"to":1,"confidence":"high"}';
  }
  return poolAnswer(prompt, () => ({ pageIndex: 0, from: 0, to: 1 }));
};

/**
 * The three pages, as the browser stores them and as the wire carries them.
 *
 * Deliberately share no wording. `runningFurniture` calls two bottom lines the
 * same running line at 0.60 token overlap, and three pages whose lines all
 * read "... pasal 6 ..." are every line furniture, `lastContentLine` null, and
 * stage 1 declining every capture with "no-content-line" -- which would make
 * this test pass for the wrong reason.
 */
const CHAIN_WIRE_PAGES = [
  wirePage(0, "a", "Pembayaran dilakukan bertahap"),
  wirePage(1, "a", "Rekening tujuan transfer"),
  wirePage(2, "a", "Sanksi keterlambatan denda"),
];

function chainRun(): BrowserRun {
  return {
    id: "r",
    createdAt: 0,
    sources: [{ id: "a", name: "LOP999001_merged.pdf", pageCount: 3 }],
    pages: CHAIN_WIRE_PAGES.map((page) => ({
      id: `p${page.index}`,
      sourceId: page.sourceId,
      index: page.index,
      widthPx: page.width,
      heightPx: page.height,
      lines: page.lines,
    })),
    slots: [{ key: "kbLanjutan.top", label: "ToP", status: "pending" }],
  };
}

test("a second Proses over a walked chain adds nothing: no duplicate captures, no extra calls", async () => {
  // THE DEFECT THIS PINS, and it is the operator's original complaint rebuilt
  // in a new place. Only the capture the walk STARTED from used to be stamped
  // `continuationChecked`, so every link the chain appended came back
  // unstamped -- and a non-terminal link ends at its page's last content line
  // BY CONSTRUCTION, which is why the next link exists. The next Proses
  // therefore re-walked all of them, was asked the identical question, and
  // appended the identical answer under a fresh ordinal: a "ToP (lanjutan 2)"
  // row holding the same picture as "ToP (lanjutan)", arriving `proposed` so
  // it re-opened a settled bagian and blocked the export. Quadratically, too:
  // an n-link chain spawns (n-1)+(n-2)+... duplicates on one press.
  //
  // A second Proses is the designed path, not an edge case: it is the dokumen
  // tambahan loop, and the export screen tells the operator to press it.
  let calls = 0;
  const counted = async (prompt: string): Promise<string> => {
    calls += 1;
    return walksTheWholeDocument(prompt);
  };

  const run = chainRun();
  const first = await proposeZones(
    buildProposeRequest(run),
    counted,
    TEMPLATE,
  );
  const afterFirst = applyResponse(run, first);

  assert.deepEqual(
    afterFirst.slots.map((slot) => slot.key),
    ["kbLanjutan.top", "kbLanjutan.top#2", "kbLanjutan.top#3"],
  );
  // Page 2 is the last page of the document, so the walk ended on a definitive
  // no and EVERY link is checked: the middle ones because the run already
  // holds their own lanjutan, the last because nothing follows it.
  assert.deepEqual(
    afterFirst.slots.map((slot) => continuationChecked(slot)),
    [true, true, true],
  );
  assert.deepEqual(capturesToWalk(afterFirst), []);

  const callsAfterFirst = calls;
  const second = await proposeZones(
    buildProposeRequest(afterFirst),
    counted,
    TEMPLATE,
  );
  const afterSecond = applyResponse(afterFirst, second);

  assert.deepEqual(
    afterSecond.slots.map((slot) => slot.key),
    afterFirst.slots.map((slot) => slot.key),
    "a second round must not append a capture the run already holds",
  );
  assert.equal(calls, callsAfterFirst, "and must not pay for the same question");
});

test("a chain re-walked from an unstamped link does not append the block twice", async () => {
  // The second net, and it is not hypothetical: a run stored before the stamp
  // was written to every link carries exactly this shape, and so does a
  // capture whose flag was cleared. Nothing dedupes on ordinal -- every append
  // takes a fresh one -- so the guard has to be on the zone itself.
  const run = chainRun();
  const first = await proposeZones(
    buildProposeRequest(run),
    walksTheWholeDocument,
    TEMPLATE,
  );
  const walked = applyResponse(run, first);

  const unstamped: BrowserRun = {
    ...walked,
    slots: walked.slots.map((slot) =>
      slot.key === "kbLanjutan.top#2"
        ? { ...slot, continuationCheckedFor: undefined }
        : slot,
    ),
  };
  assert.deepEqual(
    capturesToWalk(unstamped).map((capture) => capture.key),
    ["kbLanjutan.top#2"],
  );

  const again = await proposeZones(
    buildProposeRequest(unstamped),
    walksTheWholeDocument,
    TEMPLATE,
  );
  // The walk answers page 2 lines 0-1 again, which is byte-for-byte the zone
  // `#3` already holds.
  assert.equal(again.continuations.length, 1);
  assert.equal(again.continuations[0].zones.length, 1);

  const after = applyResponse(unstamped, again);
  assert.deepEqual(
    after.slots.map((slot) => slot.key),
    ["kbLanjutan.top", "kbLanjutan.top#2", "kbLanjutan.top#3"],
  );
});

test("a whole-page capture is NOT recorded as checked, because nothing looked", async () => {
  // `checked` used to be read off the step OUTCOME, and stage 1 "declines" a
  // whole-page capture precisely because the geometric test carries no
  // information about it: such a capture ends at its page's last content line
  // by construction. So all four of the production template's `layout:
  // "images"` captures were stamped "diperiksa, tidak ada lanjutan" although
  // nothing had looked past them, which is the wrong-and-quiet shape the flag
  // exists to prevent. Bundle two's whole-page sections account for 16 of its
  // 33 continuations, so this is where the misses would be.
  const result = await proposeZones(
    {
      runId: "r",
      pages: [
        wirePage(0, "a", "KB page"),
        wirePage(1, "a", "SP page one"),
        wirePage(2, "a", "SP page two"),
      ],
      wanted: ["sp.1"],
    },
    classifiesSpOnly,
    IMAGE_TEMPLATE,
  );

  assert.equal(result.continuations.length, 1);
  assert.equal(result.continuations[0].key, "sp.1");
  assert.equal(result.continuations[0].checked, false);
  assert.match(result.continuations[0].reason, /says nothing about it/);
});
