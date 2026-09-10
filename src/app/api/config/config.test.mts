/**
 * `/api/config`: the gate, every refusal, and the 503/502/200 split.
 *
 * No Next runtime, no bundler, no credential. `handler.ts` imports only pure
 * pipeline modules and takes its model call as an argument, so the whole
 * control flow runs here with a fake `ask`.
 *
 * WHAT THESE PROTECT is a cell in the operator's own workbook. Konfig Excel's
 * output is a per-field recommendation that a person accepts, and accepting one
 * writes a value into an `.xlsx` they then send onward. Every validation below
 * exists because the body that breaks it produces a recommendation that looks
 * ordinary and is aimed at the wrong cell, quotes a page nothing read, or was
 * never searched for at all.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createAllowlist, type AllowlistReader } from "../../../lib/auth/allowlist.ts";
import {
  createGuard,
  type ApiGate,
  type SessionLike,
} from "../../../lib/auth/guard.ts";
import type { WirePage } from "../../../lib/api/wire.ts";
import type { ConfigField } from "../../../lib/config/types.ts";
import type { Line } from "../../../lib/pipeline/geometry.ts";
import type { Cell } from "../../../lib/xlsx/grid.ts";
import {
  MAX_WIRE_CELLS,
  MAX_WIRE_FIELDS,
  checkConfig,
  createConfigHandler,
  parseConfigBody,
  toSheet,
  type ConfigResult,
  type WireSheet,
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

function line(i: number, text: string, y: number): Line {
  const box = { x: 100, y, w: 900, h: 40 };
  return { i, text, box, words: [{ text, box }] };
}

function wirePage(index: number, sourceId: string, ...texts: string[]): WirePage {
  return {
    index,
    sourceId,
    width: 2480,
    height: 3507,
    lines: texts.map((text, i) => line(i, text, 200 + i * 60)),
  };
}

/** The fictional set, per AGENTS.md. No real identifier reaches a committed file. */
const PAGES = [
  wirePage(0, "a", "PERJANJIAN KERJASAMA", "Nama Pelanggan: BANK CONTOH NUSANTARA"),
  wirePage(1, "a", "Nomor Kutipan 1-70000000002", "SID 1209990001"),
];

function cell(ref: string, row: number, col: number, text: string): Cell {
  return { ref, row, col, text, kind: "text" };
}

/**
 * The first of the three real layouts, transcribed with fictional values:
 * field names down column C, each value in column E.
 */
const SHEET: WireSheet = {
  name: "Config",
  cells: [
    cell("C9", 9, 3, "Nama Pelanggan"),
    cell("E9", 9, 5, "BANK CONTOH NUSANTARA"),
    cell("C10", 10, 3, "Nomor Kutipan"),
    cell("E10", 10, 5, "1-70000000001"),
  ],
  dimension: "A1:E10",
  rows: 10,
  cols: 5,
  merges: [],
};

const INTERPRETED = JSON.stringify({
  fields: [
    { label: "Nama Pelanggan", labelRef: "C9", valueRef: "E9" },
    { label: "Nomor Kutipan", labelRef: "C10", valueRef: "E10" },
  ],
});

/** Ids a test can predict, so an assertion about a decision can name one. */
function counter(): () => string {
  let n = 0;
  return () => `f${(n += 1)}`;
}

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

function configRequest(body: unknown): Request {
  return new Request("http://localhost/api/config", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Interpret one way, compare the other, and record every prompt either way. */
function answering(
  compareReply: string,
  prompts: string[] = [],
): (prompt: string) => Promise<string> {
  return async (prompt: string) => {
    prompts.push(prompt);
    return prompt.includes("one worksheet of an order-configuration workbook")
      ? INTERPRETED
      : compareReply;
  };
}

const AGREES = JSON.stringify({
  fields: [
    { id: "f1", verdict: "cocok" },
    { id: "f2", verdict: "cocok" },
  ],
});

/* ------------------------------------------------------------------ the gate */

test("an unauthenticated POST to /api/config is refused, and the model is never reached", async () => {
  const guard = guardFor(null);
  const reached: unknown[] = [];
  const handler = createConfigHandler({
    gate: () => guard.apiUser(),
    check: async (body) => {
      reached.push(body);
      return { entries: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  const response = await handler(
    configRequest({ runId: "r", pages: [], fields: FIELDS }),
  );

  assert.equal(response.status, 401);
  // The claim that matters is not "it answered 401" but "it never spent the
  // credential". This is the request `src/proxy.ts` would have stopped,
  // arriving at a handler proxy never ran for.
  assert.deepEqual(reached, []);
});

/* ------------------------------------------------------------- the envelope */

test("the body itself is checked, and a run with no id is refused", () => {
  // `runId` is what the log line names when a request is being chased down
  // afterwards, and it is the only thing in the body that says which order this
  // spend belonged to.
  assert.throws(() => parseConfigBody(null), /body is not an object/);
  assert.throws(() => parseConfigBody({ pages: [], fields: FIELDS }), /runId is required/);
  assert.throws(
    () => parseConfigBody({ runId: "r", fields: FIELDS }),
    /pages must be an array/,
  );
  assert.throws(
    () => parseConfigBody({ runId: "r", pages: PAGES, fields: FIELDS, retry: "ya" }),
    /retry is true, false, or absent/,
  );
});

/* ------------------------------------------------------------ the two jobs */

test("a request must ask for exactly one of the two jobs", async () => {
  const reached: unknown[] = [];
  const handler = createConfigHandler({
    gate: admits,
    check: async (body) => {
      reached.push(body);
      return { entries: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  // NEITHER. An empty `entries` would come back reading exactly like a workbook
  // the model found no fields in.
  const neither = await handler(configRequest({ runId: "r", pages: PAGES }));
  assert.equal(neither.status, 400);
  assert.match(
    ((await neither.json()) as { cause?: string }).cause ?? "",
    /carries neither/,
  );

  // BOTH. Interpreting mints new `ConfigField.id`s, so answering this request
  // would orphan every decision already made against the ids it also sent.
  const both = await handler(
    configRequest({ runId: "r", pages: PAGES, sheet: SHEET, fields: FIELDS }),
  );
  assert.equal(both.status, 400);
  assert.match(((await both.json()) as { cause?: string }).cause ?? "", /never both/);

  assert.deepEqual(reached, []);
});

test("the one re-search cannot be spent on a sheet nobody has compared yet", async () => {
  const reached: unknown[] = [];
  const handler = createConfigHandler({
    gate: admits,
    check: async (body) => {
      reached.push(body);
      return { entries: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  const response = await handler(
    configRequest({ runId: "r", pages: PAGES, sheet: SHEET, retry: true }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(reached, []);

  // `retry: false` beside a sheet is a client that sends the key unconditionally
  // and is not asking for anything. It is not a refusal.
  assert.doesNotThrow(() =>
    parseConfigBody({ runId: "r", pages: PAGES, sheet: SHEET, retry: false }),
  );
});

/* -------------------------------------------------------- the page contract */

test("within-source page numbers are refused before the credential is spent", async () => {
  const reached: unknown[] = [];
  const handler = createConfigHandler({
    gate: admits,
    check: async (body) => {
      reached.push(body);
      return { entries: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  const response = await handler(
    configRequest({
      runId: "r",
      pages: [wirePage(0, "a", "one"), wirePage(0, "b", "two")],
      fields: FIELDS,
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(reached, []);
  assert.match(
    ((await response.json()) as { cause?: string }).cause ?? "",
    /run-global position/,
  );
});

/* --------------------------------------------------------------- the sheet */

test("a sheet whose cells and whose grid disagree is refused, one way per hazard", async () => {
  const reached: unknown[] = [];
  const handler = createConfigHandler({
    gate: admits,
    check: async (body) => {
      reached.push(body);
      return { entries: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  const broken: [string, unknown, RegExp][] = [
    [
      "an address the grid could not hold",
      { ...SHEET, cells: [{ ...cell("C9", 9, 3, "Nama Pelanggan"), ref: "C9x" }] },
      /not a cell address/,
    ],
    [
      // The listing groups by `row`/`col` and `byRef` is rebuilt from `ref`, so
      // a disagreeing pair puts one cell in two places at once.
      "a row/col pair that contradicts its own address",
      { ...SHEET, cells: [cell("C9", 4, 3, "Nama Pelanggan")] },
      /says it is at row 4 column 3 and its address C9 says row 9 column 3/,
    ],
    [
      // `kindTag` prints anything that is not "text" into the prompt as a fact
      // about the cell, and `"date"` is the one kind whose stored form shares no
      // digits with what a person reads.
      "a kind that is not one of the five",
      {
        ...SHEET,
        cells: [{ ...cell("C9", 9, 3, "Nama Pelanggan"), kind: "tanggal" as Cell["kind"] }],
      },
      /kind is "tanggal"/,
    ],
    [
      // `rows`/`cols` widen the window `inSheet` accepts a `valueRef` in, which
      // is how a far-corner address a model invented becomes "inside the sheet".
      "a row count larger than the cells reach",
      { ...SHEET, rows: 900, dimension: "A1:E900" },
      /They must agree/,
    ],
    [
      "a dimension that describes a different sheet",
      { ...SHEET, dimension: "A1:ZZ999" },
      /extent of the NON-EMPTY cells/,
    ],
    [
      // `byRef` keeps the FIRST occurrence in document order and the listing
      // reads down the sheet the way a person does; a reordered array moves
      // both.
      "cells that are not row-major",
      { ...SHEET, cells: [SHEET.cells[1], SHEET.cells[0], SHEET.cells[2], SHEET.cells[3]] },
      /row-major/,
    ],
    [
      "merges that are not ranges",
      { ...SHEET, merges: [{ ref: "A1:C1" }] },
      /range strings/,
    ],
    ["a name the order cannot show", { ...SHEET, name: "" }, /sheet.name is required/],
  ];

  for (const [what, sheet, why] of broken) {
    const response = await handler(configRequest({ runId: "r", pages: PAGES, sheet }));
    assert.equal(response.status, 400, what);
    assert.match(((await response.json()) as { cause?: string }).cause ?? "", why, what);
  }

  assert.deepEqual(reached, []);
});

test("a sheet past the cell ceiling is refused rather than held in memory", () => {
  // A CEILING ON MEMORY, not a budget: the body is parsed before anything looks
  // at it, and on a shared container an unbounded array takes every other
  // operator's in-flight request down with it.
  const cells = Array.from({ length: MAX_WIRE_CELLS + 1 }, (_, i) =>
    cell(`A${i + 1}`, i + 1, 1, "x"),
  );
  assert.throws(
    () =>
      parseConfigBody({
        runId: "r",
        pages: PAGES,
        sheet: {
          ...SHEET,
          cells,
          rows: cells.length,
          cols: 1,
          dimension: `A1:A${cells.length}`,
        },
      }),
    new RegExp(`past the ${MAX_WIRE_CELLS}-cell ceiling`),
  );
});

test("byRef is rebuilt from the cells, and a duplicated address keeps the FIRST", () => {
  // Rebuilding rather than trusting a sent index is the whole point: `byRef` is
  // what every anti-fabrication check in config-interpret.ts consults, and an
  // index supplied by the caller could disagree with the cells beside it.
  //
  // FIRST, not last, which is `read.ts`'s own rule: a workbook can carry two
  // cells claiming one address, and taking the last would read back an appended
  // duplicate's value and make a damaged sheet look clean.
  const sheet = toSheet({
    ...SHEET,
    cells: [
      cell("C9", 9, 3, "Nama Pelanggan"),
      cell("C9", 9, 3, "sisipan yang menimpa"),
      cell("E9", 9, 5, "BANK CONTOH NUSANTARA"),
    ],
  });

  assert.equal(sheet.byRef.get("C9")?.text, "Nama Pelanggan");
  assert.equal(sheet.byRef.size, 2);
  // The duplicate is still in `cells`, because the patcher's verification
  // counts occurrences of an address to catch exactly this.
  assert.equal(sheet.cells.length, 3);
});

/* --------------------------------------------------------------- the fields */

test("a stored field list is checked before it is compared against anything", async () => {
  const reached: unknown[] = [];
  const handler = createConfigHandler({
    gate: admits,
    check: async (body) => {
      reached.push(body);
      return { entries: [] };
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });

  const broken: [string, unknown, RegExp][] = [
    ["not an array", "f1", /fields must be an array/],
    [
      // Both fields take one answer and one decision between them, so the
      // operator rules on one row and the other is silently decided too.
      "two fields sharing an id",
      [FIELDS[0], { ...FIELDS[1], id: "f1" }],
      /is used by an earlier field/,
    ],
    ["a field with no id", [{ ...FIELDS[0], id: "" }], /\.id is required/],
    [
      "a label the operator could not identify the row by",
      [{ ...FIELDS[0], label: "   " }],
      /\.label is required/,
    ],
    [
      // A field carrying an address the grid could not hold did not come from
      // `interpretWorkbook`, which refuses one.
      "a value cell that is not a cell",
      [{ ...FIELDS[0], valueRef: "Sheet1!E9" }],
      /valueRef is "Sheet1!E9", not a cell address/,
    ],
    [
      "an excelValue that is not text",
      [{ ...FIELDS[0], excelValue: 1 }],
      /excelValue must be the cell's text/,
    ],
  ];

  for (const [what, fields, why] of broken) {
    const response = await handler(configRequest({ runId: "r", pages: PAGES, fields }));
    assert.equal(response.status, 400, what);
    assert.match(((await response.json()) as { cause?: string }).cause ?? "", why, what);
  }

  assert.deepEqual(reached, []);
});

test("a field list past the ceiling is refused; the stage that mints them cannot produce one", () => {
  const many = Array.from({ length: MAX_WIRE_FIELDS + 1 }, (_, i) => ({
    ...FIELDS[0],
    id: `f${i}`,
  }));
  assert.throws(
    () => parseConfigBody({ runId: "r", pages: PAGES, fields: many }),
    /did not come from it/,
  );
  // An empty list is not a refusal: a workbook the model found no field in is a
  // real outcome, and `compareToDocuments` answers it with no entries at all.
  assert.doesNotThrow(() => parseConfigBody({ runId: "r", pages: PAGES, fields: [] }));
});

/* ------------------------------------------------------------- the happy paths */

test("a first upload interprets the sheet and compares what it read, in one request", async () => {
  const prompts: string[] = [];
  const result = await checkConfig(
    { runId: "r", pages: PAGES, sheet: SHEET },
    answering(
      JSON.stringify({
        fields: [
          { id: "f1", verdict: "cocok" },
          {
            id: "f2",
            verdict: "beda",
            documentValue: "1-70000000002",
            page: 1,
            from: 0,
            to: 0,
          },
        ],
      }),
      prompts,
    ),
    counter(),
  );

  // Two calls, in order: the cell listing, then the page listing.
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /one worksheet of an order-configuration workbook/);
  assert.match(prompts[1], /order-configuration spreadsheet against the scanned/);

  assert.deepEqual(
    result.fields?.map((field) => [field.id, field.label, field.valueRef]),
    [
      ["f1", "Nama Pelanggan", "E9"],
      ["f2", "Nomor Kutipan", "E10"],
    ],
  );
  // The value is read out of the GRID, never out of the reply.
  assert.equal(result.fields?.[0].excelValue, "BANK CONTOH NUSANTARA");
  assert.deepEqual(result.unusable, []);
  // ALWAYS, including when the list is empty: "no fields" has several
  // completely different causes and an empty array cannot tell them apart.
  assert.match(result.note ?? "", /2 field\(s\) read out of sheet "Config"/);

  // ONE ENTRY PER FIELD, whatever the reply contained, and every one of them
  // `belum`: silence is never read as consent.
  assert.deepEqual(
    result.entries.map((entry) => [entry.field.id, entry.verdict, entry.decision]),
    [
      ["f1", "cocok", "belum"],
      ["f2", "beda", "belum"],
    ],
  );
  assert.equal(result.entries[1].documentValue, "1-70000000002");
  assert.equal(result.entries[1].citation?.pageIndex, 1);
  // The cited text comes off the page, never out of the reply.
  assert.equal(result.entries[1].citation?.text, "Nomor Kutipan 1-70000000002");
});

test("the re-search compares only what it was given, and asks the widened question", async () => {
  const prompts: string[] = [];
  const result = await checkConfig(
    { runId: "r", pages: PAGES, fields: [FIELDS[1]], retry: true },
    answering(
      JSON.stringify({
        fields: [{ id: "f2", verdict: "tidak-ditemukan" }],
      }),
      prompts,
    ),
  );

  // NO INTERPRETATION. Re-reading the sheet to re-search one field would pay
  // for the reading again and mint ids that orphan the decisions already made.
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /A first pass over these same documents already looked/);
  assert.equal(result.fields, undefined);
  assert.equal(result.note, undefined);

  assert.deepEqual(
    result.entries.map((entry) => [entry.field.id, entry.verdict]),
    [["f2", "tidak-ditemukan"]],
  );
  assert.match(result.entries[0].reason ?? "", /every searchable page was read/);
});

/* ------------------------------------------ the per-berkas "tanpa AI" choice */

test("a fenced berkas reaches no prompt, and its pages are not renumbered away", async () => {
  // The pages arrive CARRYING THEIR LINES, exactly as at `/api/propose`: the
  // browser withholds them at the boundary and the route may not depend on it
  // having done so. Left unfiltered, a value read out of the one document the
  // operator was told would not be checked arrives as an ordinary
  // recommendation, and accepting it writes that value into their workbook.
  const fenced: WirePage[] = [
    { ...wirePage(0, "b", "Kutipan rahasia dari berkas tertutup"), searchable: false },
    wirePage(1, "a", "Nomor Kutipan 1-70000000002"),
  ];

  const prompts: string[] = [];
  const result = await checkConfig(
    { runId: "r", pages: fenced, fields: [FIELDS[1]] },
    answering(
      JSON.stringify({
        fields: [
          { id: "f2", verdict: "beda", documentValue: "1-70000000002", page: 0, from: 0, to: 0 },
        ],
      }),
      prompts,
    ),
  );

  for (const prompt of prompts) {
    assert.ok(
      !prompt.includes("Kutipan rahasia"),
      "a fenced berkas's text must not reach any prompt",
    );
  }
  // THE PAGE NUMBERING TRAP, which this pool is always at risk of: the model is
  // shown one page and answers "page 0", and page 0 of the pool is run-global
  // page 1. Echoing the position straight through would send the operator to
  // the fenced document to check a value read off the other one.
  assert.equal(result.entries[0].citation?.pageIndex, 1);
});

test("every page fenced is reported as unsearched, and the reason names the fence", async () => {
  // `tidak-ditemukan` is the only verdict the union has for this, and the
  // pipeline's own reason is what tells the operator whether to fetch a
  // document or lift a fence. The route must not answer it differently.
  const result = await checkConfig(
    {
      runId: "r",
      pages: PAGES.map((page) => ({ ...page, searchable: false })),
      fields: FIELDS,
    },
    async () => {
      throw new Error("the model must not be reached with no page open to it");
    },
  );

  assert.equal(result.entries.length, 2);
  for (const entry of result.entries) {
    assert.equal(entry.verdict, "tidak-ditemukan");
    assert.match(entry.reason ?? "", /may be fenced off from the model/);
  }
});

/* ------------------------------------------------ reaching the model, or not */

test("a model that cannot be reached is a 503, NOT a page of 'tidak-ditemukan'", async () => {
  // The defect `/api/propose` recorded, two routes over: with no API key the
  // route would answer 200 with every field marked SEARCHED AND NOT FOUND, and
  // `tidak-ditemukan` is the verdict that sends an operator to hunt for another
  // document.
  const noCredential = async (): Promise<string> => {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set.");
  };

  const handler = createConfigHandler({
    gate: admits,
    check: (body) => checkConfig(body, noCredential),
    unreachable: (error) =>
      Response.json(
        { error: "unreachable", cause: (error as Error).message },
        { status: 503 },
      ),
  });

  const response = await handler(
    configRequest({ runId: "r", pages: PAGES, fields: FIELDS }),
  );

  assert.equal(response.status, 503);
  // Unwrapped: the 503 names the real cause, not the internal wrapper.
  assert.match(
    ((await response.json()) as { cause: string }).cause,
    /GOOGLE_GENERATIVE_AI_API_KEY/,
  );
});

test("a reply that arrives and cannot be used is a 502, not a 503 and not a run of verdicts", async () => {
  const garbage = async (): Promise<string> => "not json at all";

  const handler = createConfigHandler({
    gate: admits,
    check: (body) => checkConfig(body, garbage),
    unreachable: () => Response.json({ error: "unreachable" }, { status: 503 }),
  });

  const response = await handler(
    configRequest({ runId: "r", pages: PAGES, fields: FIELDS }),
  );

  assert.equal(response.status, 502);
  assert.equal(((await response.json()) as { error: string }).error, "unusable-reply");
});

test("a request that survives every check answers 200 with the entries", async () => {
  const handler = createConfigHandler({
    gate: admits,
    check: (body) => checkConfig(body, answering(AGREES), counter()),
    unreachable: () => Response.json({ error: "unreachable" }, { status: 503 }),
  });

  const response = await handler(
    configRequest({ runId: "r", pages: PAGES, sheet: SHEET }),
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as ConfigResult;
  assert.equal(body.fields?.length, 2);
  assert.deepEqual(
    body.entries.map((entry) => entry.verdict),
    ["cocok", "cocok"],
  );
});

/* ------------------------------------------- interpret without comparing */

test("compare: false asks what the workbook holds and never runs the expensive call", async () => {
  /*
   * Input EPIC's "yes, I have a newer konfigurasi" reads a workbook to learn
   * its isian; EPIC is then judged against those, and the SCANS have nothing to
   * do with that question. Without the flag this route interpreted and then ran
   * the comparison anyway -- the one call carrying the whole run's page
   * listing -- and the caller read only `fields`, so every verdict was paid for
   * and dropped. Found by review.
   */
  const prompts: string[] = [];
  const answer = JSON.stringify({
    fields: [{ label: "Nama Pelanggan", labelRef: "C9", valueRef: "E9" }],
  });

  const result = await checkConfig(
    { runId: "r", pages: PAGES, sheet: SHEET, compare: false },
    async (prompt: string) => {
      prompts.push(prompt);
      return answer;
    },
    () => "f1",
  );

  assert.equal(prompts.length, 1, "one call: the interpretation, and nothing else");
  assert.ok(
    !prompts[0].includes("halaman") && !prompts[0].includes("page 0"),
    "the one call made is the cell listing, not the page listing",
  );
  assert.equal(result.fields?.length, 1, "the fields still come back");
  assert.deepEqual(result.entries, [], "and no verdict is invented for them");
});

test("compare: false needs a sheet, because without one it asks for nothing at all", () => {
  assert.throws(
    () => parseConfigBody({ runId: "r", pages: PAGES, fields: FIELDS, compare: false }),
    /needs a sheet/,
  );

  // Absent and `true` both mean compare, so a client that predates the flag,
  // and one that sends it unconditionally, are byte-identical requests.
  assert.doesNotThrow(() =>
    parseConfigBody({ runId: "r", pages: PAGES, sheet: SHEET, compare: true }),
  );
  assert.doesNotThrow(() =>
    parseConfigBody({ runId: "r", pages: PAGES, fields: FIELDS, compare: true }),
  );
  assert.throws(
    () => parseConfigBody({ runId: "r", pages: PAGES, sheet: SHEET, compare: "no" }),
    /true, false, or absent/,
  );
});
