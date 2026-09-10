/**
 * Offline tests for Input EPIC: what EPIC's screen shows, judged against the
 * workbook. No API call, no credential, no screenshot -- the stage takes its
 * `Ask` injected and its captures are plain objects, so every rule is drivable
 * with invented text.
 *
 * THE FAILURE CLASS THESE PROTECT is a row that reads as checked and is not:
 * a verdict about a screen nobody supplied, a citation pointing at a capture
 * that does not exist, a `beda` recommending a value it never gave, a field the
 * reply went quiet about arriving as no row at all, and a `tidak-ada-di-excel`
 * finding for a field the workbook plainly has -- which puts one name in front
 * of the operator twice, saying two different things.
 *
 * EVERY STRING HERE IS INVENTED. The fictional set this repo uses is LOP999001,
 * 1-70000000001, BANK CONTOH NUSANTARA, PSB VPN IP KCP Contoh, SID 1209990001,
 * Budi Contoh, budi@contoh.example. The screen furniture below is generic
 * Indonesian order-entry wording, not a client's system: this repo is public.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ConfigField, EpicCapture } from "../config/types.ts";
import type { Line } from "./geometry.ts";
import {
  MAX_EXTRA,
  buildEpicPrompt,
  compareToEpic,
  foldEpicReply,
} from "./epic-compare.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The boxes are filler. This stage reads `i` and `text` and never touches
 * geometry -- it answers with line numbers, and the rectangle is somebody
 * else's business -- but `Line` carries a box, so one is supplied.
 */
function line(i: number, text: string): Line {
  return { i, text, box: { x: 0, y: i * 20, w: 400, h: 18 }, words: [] };
}

function capture(id: string, texts: string[]): EpicCapture {
  return {
    id,
    name: `${id}.png`,
    digest: `sha256-${id}`,
    width: 1280,
    height: 720,
    lines: texts.map((text, i) => line(i, text)),
  };
}

/** The two refs are irrelevant here: Input EPIC never writes a cell. */
function field(
  id: string,
  label: string,
  excelValue: string,
  group?: string,
): ConfigField {
  const made: ConfigField = {
    id,
    sheet: "Konfigurasi",
    label,
    labelRef: "C4",
    valueRef: "E4",
    excelValue,
  };
  if (group !== undefined) made.group = group;
  return made;
}

const FIELDS: ConfigField[] = [
  field("f-nomor", "Nomor Quote", "1-70000000001"),
  field("f-pelanggan", "Nama Pelanggan", "BANK CONTOH NUSANTARA"),
  field("f-alamat", "Alamat Instalasi", ""),
];

const SCREENS: EpicCapture[] = [
  capture("cap-ringkasan", [
    "EPIC - Detail Order",
    "Nomor Quote : 1-70000000001",
    "Nama Pelanggan : BANK CONTOH NUSANTARA",
  ]),
  capture("cap-layanan", [
    "Alamat Instalasi : Jalan Contoh Nomor 1",
    "Status Order : Aktif",
  ]),
];

/** An `Ask` that answers with one canned reply and records what it was sent. */
function asking(reply: unknown) {
  const prompts: string[] = [];
  const ask = async (prompt: string) => {
    prompts.push(prompt);
    return typeof reply === "string" ? reply : JSON.stringify(reply);
  };
  return { ask, prompts };
}

/** An `Ask` that fails the test if anything reaches it. */
const unreachable = async (): Promise<string> => {
  throw new Error("the model must not be called");
};

const silent = () => {};

/** A `warn` that keeps what it was told, so a drop can be asserted on. */
function collecting() {
  const said: string[] = [];
  return { said, warn: (message: string) => said.push(message) };
}

// ---------------------------------------------------------------------------
// One entry per field, whatever the reply did
// ---------------------------------------------------------------------------

test("every field gets exactly one entry in the workbook's own order, however the reply is ordered", () => {
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    {
      fields: [
        { id: "f-alamat", verdict: "beda", epicValue: "Jalan Contoh Nomor 1" },
        { id: "f-nomor", verdict: "cocok" },
      ],
    },
    silent,
  );

  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((entry) => entry.fieldId),
    ["f-nomor", "f-pelanggan", "f-alamat"],
    "entries must follow the workbook's field order, not the reply's",
  );
});

test("a field the reply went quiet about becomes a row saying so, not a missing row", () => {
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    { fields: [{ id: "f-nomor", verdict: "cocok" }] },
    silent,
  );

  const quiet = entries.find((entry) => entry.fieldId === "f-pelanggan");
  assert.equal(quiet?.verdict, "tidak-ditemukan");
  assert.match(quiet?.reason ?? "", /said nothing about this one/);
});

test("an answer for an id nobody asked about is dropped, and a duplicate id keeps the first", () => {
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    {
      fields: [
        { id: "f-nomor", verdict: "cocok" },
        { id: "f-nomor", verdict: "beda", epicValue: "1-70000000009" },
        { id: "f-hantu", verdict: "beda", epicValue: "tidak pernah diminta" },
      ],
    },
    silent,
  );

  assert.equal(entries.length, 3, "a hallucinated id must not become a fourth row");
  assert.equal(entries[0].verdict, "cocok", "the first answer for an id wins");
  assert.equal(
    entries.some((entry) => entry.label === "tidak pernah diminta"),
    false,
  );
});

test("the label and the workbook value are read off the field, never off the reply", () => {
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    {
      fields: [
        {
          id: "f-pelanggan",
          verdict: "beda",
          epicValue: "BANK CONTOH LAIN",
          // A reply that has drifted and starts describing the workbook.
          label: "Pelanggan (versi AI)",
          excelValue: "sesuatu yang lain",
        },
      ],
    },
    silent,
  );

  const entry = entries[1];
  assert.equal(entry.label, "Nama Pelanggan");
  assert.equal(entry.excelValue, "BANK CONTOH NUSANTARA");
  assert.equal(entry.epicValue, "BANK CONTOH LAIN");
});

test("every entry starts undecided, so nothing counts as approved by silence", () => {
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    {
      fields: [
        { id: "f-nomor", verdict: "cocok" },
        { id: "f-pelanggan", verdict: "beda", epicValue: "BANK CONTOH LAIN" },
        { id: "f-alamat", verdict: "tidak-ditemukan" },
      ],
      extra: [
        { label: "Status Order", epicValue: "Aktif", capture: 1, from: 1, to: 1 },
      ],
    },
    silent,
  );

  assert.equal(entries.length, 4);
  for (const entry of entries) {
    assert.equal(entry.decision, "belum", `${entry.label} must start undecided`);
  }
});

// ---------------------------------------------------------------------------
// Citations: checked against the capture that really exists
// ---------------------------------------------------------------------------

test("a good citation keeps the capture's id and quotes the capture's own lines", () => {
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    {
      fields: [
        {
          id: "f-pelanggan",
          verdict: "beda",
          epicValue: "BANK CONTOH LAIN",
          capture: 0,
          from: 1,
          to: 2,
        },
      ],
    },
    silent,
  );

  const cite = entries[1].citation;
  assert.equal(
    cite?.captureId,
    "cap-ringkasan",
    "the answer addresses captures by position and the entry stores the id",
  );
  assert.equal(cite?.from, 1);
  assert.equal(cite?.to, 2);
  assert.equal(
    cite?.text,
    "Nomor Quote : 1-70000000001\nNama Pelanggan : BANK CONTOH NUSANTARA",
    "the quoted text is the capture's, not the reply's",
  );
  assert.equal(entries[1].reason, undefined, "a citation that checked out owes no reason");
});

test("a citation naming a capture nobody supplied is dropped and the verdict survives", () => {
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    {
      fields: [
        {
          id: "f-pelanggan",
          verdict: "beda",
          epicValue: "BANK CONTOH LAIN",
          capture: 7,
          from: 0,
          to: 0,
        },
      ],
    },
    silent,
  );

  assert.equal(entries[1].verdict, "beda", "a bad citation must not cost a good verdict");
  assert.equal(entries[1].epicValue, "BANK CONTOH LAIN");
  assert.equal(entries[1].citation, undefined);
  assert.match(entries[1].reason ?? "", /capture 7/);
});

test("a reversed range, a line the capture does not have, and a half-citation are each refused", () => {
  const cases: { claim: Record<string, unknown>; expect: RegExp }[] = [
    { claim: { capture: 0, from: 2, to: 1 }, expect: /reversed range/ },
    { claim: { capture: 1, from: 0, to: 9 }, expect: /no line 2/ },
    { claim: { capture: 0, from: 1 }, expect: /incomplete/ },
  ];

  for (const one of cases) {
    const entries = foldEpicReply(
      FIELDS,
      SCREENS,
      {
        fields: [
          {
            id: "f-pelanggan",
            verdict: "beda",
            epicValue: "BANK CONTOH LAIN",
            ...one.claim,
          },
        ],
      },
      silent,
    );

    assert.equal(entries[1].verdict, "beda");
    assert.equal(entries[1].citation, undefined, `${JSON.stringify(one.claim)} must not be trusted`);
    assert.match(entries[1].reason ?? "", one.expect);
  }
});

test("offering no citation at all is not an error, so it carries no reason", () => {
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    { fields: [{ id: "f-nomor", verdict: "beda", epicValue: "1-70000000009" }] },
    silent,
  );

  assert.equal(entries[0].citation, undefined);
  assert.equal(
    entries[0].reason,
    undefined,
    "declining to cite and citing something false are different replies",
  );
});

// ---------------------------------------------------------------------------
// The two verdicts that get rewritten
// ---------------------------------------------------------------------------

test("a beda with no value is not a disagreement anybody can act on, so it is recorded as not found", () => {
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    {
      fields: [
        { id: "f-nomor", verdict: "beda", epicValue: "   ", capture: 0, from: 1, to: 1 },
      ],
    },
    silent,
  );

  assert.equal(entries[0].verdict, "tidak-ditemukan");
  assert.equal(entries[0].epicValue, undefined);
  assert.equal(
    entries[0].citation,
    undefined,
    "a downgraded row must not keep evidence for a value it refused to carry",
  );
  assert.match(entries[0].reason ?? "", /no value/);
});

test("a tidak-ditemukan drops any value and any citation the reply attached to it", () => {
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    {
      fields: [
        {
          id: "f-alamat",
          verdict: "tidak-ditemukan",
          epicValue: "Jalan Contoh Nomor 1",
          capture: 1,
          from: 0,
          to: 0,
        },
      ],
    },
    silent,
  );

  const entry = entries[2];
  assert.equal(entry.verdict, "tidak-ditemukan");
  assert.equal(entry.epicValue, undefined);
  assert.equal(entry.citation, undefined);
  assert.match(entry.reason ?? "", /every capture was read/);
});

// ---------------------------------------------------------------------------
// tidak-ada-di-excel: the finding the client asked for by name
// ---------------------------------------------------------------------------

test("a value EPIC shows that no field covers becomes its own entry, after the fields", () => {
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    {
      fields: [{ id: "f-nomor", verdict: "cocok" }],
      extra: [
        { label: "Status Order", epicValue: "Aktif", capture: 1, from: 1, to: 1 },
      ],
    },
    silent,
  );

  assert.equal(entries.length, 4);
  const found = entries[3];
  assert.equal(found.verdict, "tidak-ada-di-excel");
  assert.equal(found.label, "Status Order");
  assert.equal(found.epicValue, "Aktif");
  assert.equal(found.excelValue, "", "there is no cell behind this row");
  assert.equal(
    Object.hasOwn(found, "fieldId"),
    false,
    "the absence of fieldId is what says there is no field to point at",
  );
  assert.equal(found.citation?.captureId, "cap-layanan");
  assert.equal(found.citation?.text, "Status Order : Aktif");
});

test("a leftover with a blank label is dropped, and the drop is said out loud", () => {
  const log = collecting();
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    { fields: [], extra: [{ label: "   ", epicValue: "Aktif" }] },
    log.warn,
  );

  assert.equal(entries.length, 3, "only the three fields remain");
  assert.equal(log.said.length, 1);
  assert.match(log.said[0], /named no label/);
});

test("a leftover naming a field the workbook does have is a beda, not a missing field, and is dropped", () => {
  const log = collecting();
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    {
      fields: [],
      // Same name, different packaging: a form label wears a colon on screen.
      extra: [{ label: "nama pelanggan :", epicValue: "BANK CONTOH LAIN" }],
    },
    log.warn,
  );

  assert.equal(entries.length, 3);
  assert.equal(
    entries.some((entry) => entry.verdict === "tidak-ada-di-excel"),
    false,
    "one name must not reach the operator as two rows saying different things",
  );
  assert.match(log.said[0], /the workbook does have/);
});

test("a leftover repeating an earlier leftover, or carrying no value, is dropped", () => {
  const log = collecting();
  const entries = foldEpicReply(
    FIELDS,
    SCREENS,
    {
      fields: [],
      extra: [
        { label: "Status Order", epicValue: "Aktif" },
        { label: "Status Order", epicValue: "Aktif" },
        { label: "Jenis Layanan", epicValue: "" },
      ],
    },
    log.warn,
  );

  assert.equal(entries.length, 4, "one field-less finding survives");
  assert.equal(entries[3].label, "Status Order");
  assert.equal(log.said.length, 2);
  assert.match(log.said[0], /already named by an earlier finding/);
  assert.match(log.said[1], /came with no value/);
});

test("a reply naming more leftovers than one screen can hold is refused whole", () => {
  const extra = Array.from({ length: MAX_EXTRA + 1 }, (_unused, at) => ({
    label: `Kolom ${at}`,
    epicValue: `nilai ${at}`,
  }));

  assert.throws(
    () => foldEpicReply(FIELDS, SCREENS, { fields: [], extra }, silent),
    (error: unknown) => error instanceof Error,
  );
});

// ---------------------------------------------------------------------------
// Not spending a call to be told nothing
// ---------------------------------------------------------------------------

test("with no capture supplied the model is never called, and every field says why", async () => {
  const entries = await compareToEpic({
    fields: FIELDS,
    captures: [],
    ask: unreachable,
  });

  assert.equal(entries.length, 3);
  for (const entry of entries) {
    assert.equal(entry.verdict, "tidak-ditemukan");
    assert.equal(entry.decision, "belum");
    assert.match(entry.reason ?? "", /no EPIC screen capture was supplied/);
  }
});

test("the no-capture guard also refuses to believe a reply about screens nobody supplied", () => {
  const entries = foldEpicReply(
    FIELDS,
    [],
    { fields: [{ id: "f-nomor", verdict: "cocok" }] },
    silent,
  );

  assert.equal(
    entries[0].verdict,
    "tidak-ditemukan",
    "a cocok about a screen that does not exist would read as a checked field",
  );
});

test("with no field to judge against there is no yardstick, so no call is made", async () => {
  const { ask, prompts } = asking({ fields: [], extra: [] });

  const entries = await compareToEpic({ fields: [], captures: SCREENS, ask });

  assert.deepEqual(entries, []);
  assert.deepEqual(prompts, [], "a workbook with no fields is a Konfig Excel that did not happen");
});

// ---------------------------------------------------------------------------
// A reply that is not a reply
// ---------------------------------------------------------------------------

test("a reply with no JSON in it throws rather than answering", async () => {
  const { ask } = asking("Maaf, saya tidak dapat membaca tangkapan layar ini.");

  await assert.rejects(
    () => compareToEpic({ fields: FIELDS, captures: SCREENS, ask }),
    /No JSON object in model reply/,
  );
});

test("a verdict the schema does not know throws rather than being rounded to one that is", () => {
  assert.throws(
    () =>
      foldEpicReply(
        FIELDS,
        SCREENS,
        { fields: [{ id: "f-nomor", verdict: "mungkin-cocok" }] },
        silent,
      ),
    (error: unknown) => error instanceof Error,
  );
});

test("a reply shaped like something else entirely throws", () => {
  assert.throws(
    () => foldEpicReply(FIELDS, SCREENS, { answers: [] }, silent),
    (error: unknown) => error instanceof Error,
  );
});

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

test("the prompt asks for the leftovers explicitly, because a model told only about fields never volunteers them", () => {
  const prompt = buildEpicPrompt(FIELDS, SCREENS);

  assert.match(prompt, /LIST WHAT EPIC SHOWS THAT NO FIELD ABOVE COVERS/);
  assert.match(prompt, /"extra"/);
});

test("captures are numbered from 0 by position, and their names never reach the model", () => {
  const prompt = buildEpicPrompt(FIELDS, SCREENS);

  assert.match(prompt, /--- capture 0 ---/);
  assert.match(prompt, /--- capture 1 ---/);
  assert.equal(
    prompt.includes("cap-ringkasan"),
    false,
    "a filename is not on the screen and must not become a candidate value",
  );
});

test("the question comes before the listing, which is the ordering locate.ts measured", () => {
  const prompt = buildEpicPrompt(FIELDS, SCREENS);

  assert.ok(
    prompt.indexOf("THE WORKBOOK IS THE YARDSTICK") < prompt.indexOf("--- capture 0 ---"),
    "moving the pages above the question is the change that cost locate a slot",
  );
});

test("an empty cell, a row name, and a capture with no recognised text are each said out loud", () => {
  const prompt = buildEpicPrompt(
    [field("f-alamat", "Alamat Instalasi", "", "SID 1209990001")],
    [capture("cap-kosong", [])],
  );

  assert.match(prompt, /the workbook cell is EMPTY/);
  assert.match(prompt, /row: SID 1209990001/);
  assert.match(prompt, /no text was recognised on this screen capture/);
});

test("the workbook's own value is quoted to the model, since it is the yardstick", () => {
  const prompt = buildEpicPrompt(FIELDS, SCREENS);

  assert.match(prompt, /the workbook says: "1-70000000001"/);
  assert.match(prompt, /id: f-nomor/);
});
