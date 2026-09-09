/**
 * Offline tests for Checkpoint 2's comparison. No API call, no credential, no
 * PDF: the stage takes its `Ask` injected and its pages are plain objects, so
 * every rule -- what survives, what is refused, and what an operator is told
 * when the model says something untrue -- is drivable with invented text.
 *
 * WHAT THIS FILE PROTECTS is the two-sided promise `foldCompareReply` makes:
 * exactly one entry per field the caller asked about, always, and never a
 * citation that has not been checked against the pages it names. A dropped
 * field is a workbook cell the operator is never told to look at; an unchecked
 * citation is a page reference a validator follows to text that does not say
 * what the cell says.
 *
 * THE POOL IN THESE TESTS DELIBERATELY DOES NOT START AT PAGE 0. The caller
 * hands in searchable pages only, so a run with one berkas fenced off as
 * "tanpa AI" produces exactly this shape, and it is the shape that once made
 * the model answer 22 for page 23. The renumbering is pinned here rather than
 * assumed.
 *
 * EVERY STRING HERE IS INVENTED. The fictional set this repo uses is
 * LOP999001, 1-70000000001, BANK CONTOH NUSANTARA, PSB VPN IP KCP Contoh, SID
 * 1209990001, Budi Contoh, budi@contoh.example. This repo is public.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { WirePage } from "../api/wire.ts";
import type { ConfigEntry, ConfigField } from "../config/types.ts";
import type { Line } from "./geometry.ts";
import {
  MAX_FIELDS_PER_CALL,
  buildComparePrompt,
  compareToDocuments,
  foldCompareReply,
} from "./config-compare.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function line(i: number, text: string): Line {
  const box = { x: 40, y: 40 + i * 30, w: 800, h: 24 };
  return { i, text, box, words: [{ text, box }] };
}

function wirePage(index: number, texts: string[]): WirePage {
  return {
    index,
    sourceId: "berkas-1",
    width: 2480,
    height: 3508,
    lines: texts.map((text, i) => line(i, text)),
  };
}

/**
 * A two-page pool starting at run-global page 23, because the first berkas of
 * this imaginary order was fenced off and its pages are not in the pool.
 */
const PAGES: WirePage[] = [
  wirePage(23, [
    "BERITA ACARA PERMINTAAN ORDER",
    "Nomor: LOP999001",
    "Nama Pelanggan: BANK CONTOH NUSANTARA",
    "Alamat: Jalan Contoh Nomor 1, Jakarta",
  ]),
  wirePage(24, [
    "Lampiran daftar layanan",
    "SID 1209990001",
    "PSB VPN IP KCP Contoh",
    "Kontak: Budi Contoh, budi@contoh.example",
  ]),
];

function field(
  id: string,
  label: string,
  excelValue: string,
  group?: string,
): ConfigField {
  const made: ConfigField = {
    id,
    sheet: "Sheet1",
    label,
    labelRef: "C4",
    valueRef: "E4",
    excelValue,
  };
  if (group !== undefined) made.group = group;
  return made;
}

const FIELDS: ConfigField[] = [
  field("f1", "Nama Pelanggan", "BANK CONTOH NUSANTARA"),
  field("f2", "Nama Proyek", "PSB VPN IP KCP Contoh", "1209990001"),
  field("f3", "Alamat", ""),
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

function byId(entries: ConfigEntry[]): Map<string, ConfigEntry> {
  return new Map(entries.map((entry) => [entry.field.id, entry]));
}

// ---------------------------------------------------------------------------
// One entry per field, always
// ---------------------------------------------------------------------------

test("every field comes back exactly once and in input order, whatever the reply held", () => {
  const entries = foldCompareReply(FIELDS, PAGES, { fields: [] });

  assert.deepEqual(
    entries.map((entry) => entry.field.id),
    ["f1", "f2", "f3"],
    "the entries are the input fields, in the input's own order",
  );
  assert.equal(entries.length, FIELDS.length);
});

test("a field the reply never mentions is told apart from one the model searched for", () => {
  const entries = byId(
    foldCompareReply(FIELDS, PAGES, {
      fields: [{ id: "f1", verdict: "tidak-ditemukan" }],
    }),
  );

  const searched = entries.get("f1");
  const silent = entries.get("f2");
  assert.equal(searched?.verdict, "tidak-ditemukan");
  assert.equal(silent?.verdict, "tidak-ditemukan");
  assert.match(searched?.reason ?? "", /every searchable page was read/);
  assert.match(silent?.reason ?? "", /never mentioned this one/);
  assert.notEqual(
    searched?.reason,
    silent?.reason,
    "searched-and-absent and never-asked-about must not read the same",
  );
});

test("every entry starts undecided, because silence is never consent", () => {
  const entries = foldCompareReply(FIELDS, PAGES, {
    fields: [
      { id: "f1", verdict: "cocok" },
      { id: "f2", verdict: "beda", documentValue: "PSB VPN IP KCP Lain" },
      { id: "f3", verdict: "tidak-ditemukan" },
    ],
  });

  for (const entry of entries) {
    assert.equal(entry.decision, "belum", `${entry.field.id} must owe a decision`);
    assert.equal(entry.manualValue, undefined);
  }
});

test("an answer naming a field that was not asked about is ignored", () => {
  const entries = foldCompareReply(FIELDS, PAGES, {
    fields: [
      { id: "hantu", verdict: "beda", documentValue: "BANK CONTOH LAIN" },
      { id: "f1", verdict: "cocok" },
    ],
  });

  assert.equal(entries.length, 3, "a hallucinated id must not add an entry");
  assert.equal(
    entries.find((entry) => entry.field.id === "hantu"),
    undefined,
  );
  assert.equal(byId(entries).get("f1")?.verdict, "cocok");
});

test("a duplicate answer for one field keeps the first, deterministically", () => {
  const entries = byId(
    foldCompareReply(FIELDS, PAGES, {
      fields: [
        { id: "f1", verdict: "cocok" },
        { id: "f1", verdict: "beda", documentValue: "BANK CONTOH LAIN" },
      ],
    }),
  );

  assert.equal(entries.get("f1")?.verdict, "cocok");
  assert.equal(entries.get("f1")?.documentValue, undefined);
});

test("an entry the schema cannot read costs its own field and no other", () => {
  const entries = byId(
    foldCompareReply(FIELDS, PAGES, {
      fields: [
        { id: "f1", verdict: "cocok" },
        { id: "f2", verdict: "mungkin" },
        { id: "f3", verdict: "beda", documentValue: "Jalan Contoh Nomor 1, Jakarta" },
      ],
    }),
  );

  assert.equal(entries.get("f1")?.verdict, "cocok");
  assert.equal(entries.get("f3")?.verdict, "beda");
  assert.equal(entries.get("f2")?.verdict, "tidak-ditemukan");
  assert.match(
    entries.get("f2")?.reason ?? "",
    /could not be read/,
    "an unreadable answer is a different fact from an unmentioned field",
  );
  assert.doesNotMatch(entries.get("f2")?.reason ?? "", /never mentioned/);
});

// ---------------------------------------------------------------------------
// The envelope is the one thing that throws
// ---------------------------------------------------------------------------

test("a reply that is not an object throws rather than becoming a page of not-founds", () => {
  for (const reply of ["maaf, saya tidak bisa", null, [1, 2, 3], 42, { fields: {} }, {}]) {
    assert.throws(
      () => foldCompareReply(FIELDS, PAGES, reply),
      `${JSON.stringify(reply)} is not a reply about these documents, and folding ` +
        "it into three tidak-ditemukan would send the operator hunting for documents",
    );
  }
});

// ---------------------------------------------------------------------------
// Citations: mapped back, read off the page, and refused four ways
// ---------------------------------------------------------------------------

test("a citation is mapped back to the pool's own page index, never to its position", () => {
  const entries = byId(
    foldCompareReply(FIELDS, PAGES, {
      fields: [{ id: "f1", verdict: "cocok", page: 1, from: 1, to: 2 }],
    }),
  );

  assert.equal(
    entries.get("f1")?.citation?.pageIndex,
    24,
    "position 1 in a pool starting at 23 is run-global page 24",
  );
});

test("citation text is read off the page's own lines, not echoed by the model", () => {
  const entries = byId(
    foldCompareReply(FIELDS, PAGES, {
      fields: [
        {
          id: "f1",
          verdict: "cocok",
          page: 0,
          from: 1,
          to: 2,
          text: "sesuatu yang tidak ada di halaman",
        },
      ],
    }),
  );

  assert.deepEqual(entries.get("f1")?.citation, {
    pageIndex: 23,
    from: 1,
    to: 2,
    text: "Nomor: LOP999001\nNama Pelanggan: BANK CONTOH NUSANTARA",
  });
});

test("every way a citation can be wrong drops the citation and keeps the verdict", () => {
  const rejected: [string, Record<string, unknown>][] = [
    ["a page the pool does not have", { page: 5, from: 0, to: 1 }],
    ["a reversed range", { page: 0, from: 3, to: 1 }],
    ["a negative line number", { page: 0, from: -1, to: 2 }],
    ["a negative page number", { page: -1, from: 0, to: 1 }],
    ["a line the page does not have", { page: 0, from: 1, to: 99 }],
    ["a half-written citation", { page: 0, from: 1 }],
    ["a non-integer position", { page: 0.5, from: 1, to: 2 }],
    ["a stringified number", { page: "0", from: "1", to: "2" }],
  ];

  for (const [why, citation] of rejected) {
    const entries = byId(
      foldCompareReply(FIELDS, PAGES, {
        fields: [
          {
            id: "f1",
            verdict: "beda",
            documentValue: "BANK CONTOH LAIN",
            ...citation,
          },
        ],
      }),
    );

    const entry = entries.get("f1");
    assert.equal(entry?.citation, undefined, `${why} must not survive as a citation`);
    assert.equal(entry?.verdict, "beda", `${why} must not cost the verdict`);
    assert.equal(
      entry?.documentValue,
      "BANK CONTOH LAIN",
      `${why} must not cost the recommendation`,
    );
  }
});

test("an answer with no citation at all is a value the model did not source, not an error", () => {
  const entries = byId(
    foldCompareReply(FIELDS, PAGES, {
      fields: [{ id: "f1", verdict: "beda", documentValue: "BANK CONTOH LAIN" }],
    }),
  );

  assert.equal(entries.get("f1")?.verdict, "beda");
  assert.equal(entries.get("f1")?.citation, undefined);
});

test("a citation offered for tidak-ditemukan is dropped, because there is nothing to have read", () => {
  const entries = byId(
    foldCompareReply(FIELDS, PAGES, {
      fields: [{ id: "f1", verdict: "tidak-ditemukan", page: 0, from: 0, to: 1 }],
    }),
  );

  assert.equal(entries.get("f1")?.citation, undefined);
  assert.equal(entries.get("f1")?.verdict, "tidak-ditemukan");
});

// ---------------------------------------------------------------------------
// The verdicts themselves
// ---------------------------------------------------------------------------

test("beda with nothing to recommend is downgraded rather than shown as actionable", () => {
  for (const documentValue of [undefined, null, "", "   "]) {
    const entries = byId(
      foldCompareReply(FIELDS, PAGES, {
        fields: [{ id: "f1", verdict: "beda", documentValue }],
      }),
    );

    const entry = entries.get("f1");
    assert.equal(entry?.verdict, "tidak-ditemukan", JSON.stringify(documentValue));
    assert.equal(entry?.documentValue, undefined);
    assert.match(entry?.reason ?? "", /nothing to recommend/);
  }
});

test("an empty workbook cell with a value in the documents is beda with a recommendation", () => {
  const entries = byId(
    foldCompareReply(FIELDS, PAGES, {
      fields: [
        {
          id: "f3",
          verdict: "beda",
          documentValue: "Jalan Contoh Nomor 1, Jakarta",
          page: 0,
          from: 3,
          to: 3,
        },
      ],
    }),
  );

  const entry = entries.get("f3");
  assert.equal(entry?.field.excelValue, "", "this fixture's cell really is empty");
  assert.equal(entry?.verdict, "beda");
  assert.equal(entry?.documentValue, "Jalan Contoh Nomor 1, Jakarta");
  assert.equal(entry?.citation?.text, "Alamat: Jalan Contoh Nomor 1, Jakarta");
});

test("cocok on an empty cell is refused: an empty cell has nothing to agree with", () => {
  const entries = byId(
    foldCompareReply(FIELDS, PAGES, {
      fields: [{ id: "f3", verdict: "cocok", page: 0, from: 3, to: 3 }],
    }),
  );

  const entry = entries.get("f3");
  assert.equal(
    entry?.verdict,
    "tidak-ditemukan",
    "a blank cell reported as checked-and-fine ships an incomplete workbook",
  );
  assert.match(entry?.reason ?? "", /empty cell has nothing/);
  assert.equal(entry?.citation, undefined);
});

test("beda whose recommendation is what the cell already says is read as agreement", () => {
  const entries = byId(
    foldCompareReply(FIELDS, PAGES, {
      fields: [
        {
          id: "f1",
          verdict: "beda",
          // The same value the workbook holds, differing only by wrapping.
          documentValue: "BANK CONTOH\n  NUSANTARA",
          page: 0,
          from: 2,
          to: 2,
        },
      ],
    }),
  );

  const entry = entries.get("f1");
  assert.equal(entry?.verdict, "cocok", "a no-op edit must not spend a decision");
  assert.equal(entry?.documentValue, undefined);
  assert.equal(entry?.citation?.pageIndex, 23, "the citation is still where it was read");
});

test("a documentValue that arrives as a JSON number is kept as its text", () => {
  const numeric = [field("n1", "Bandwidth", "10")];
  const entries = foldCompareReply(numeric, PAGES, {
    fields: [{ id: "n1", verdict: "beda", documentValue: 20 }],
  });

  assert.equal(entries[0].verdict, "beda");
  assert.equal(entries[0].documentValue, "20");
});

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

test("the prompt numbers pages by position from 0, never by their run-global index", () => {
  const prompt = buildComparePrompt(FIELDS, PAGES, false);

  assert.ok(prompt.includes("--- page 0 ---"));
  assert.ok(prompt.includes("--- page 1 ---"));
  assert.ok(
    !prompt.includes("--- page 23 ---"),
    "a pool starting at 23 once made the model answer 22",
  );
});

test("the question comes before the listing, which is the measured ordering", () => {
  const prompt = buildComparePrompt(FIELDS, PAGES, false);

  assert.ok(
    prompt.indexOf("FIELDS") < prompt.indexOf("--- page 0 ---"),
    "moving the question below the listing turned a locate slot from an " +
      "intermittent failure into a certain one; see locate.ts's header",
  );
});

test("the prompt says which cell is empty and which row a field belongs to", () => {
  const prompt = buildComparePrompt(FIELDS, PAGES, false);

  assert.ok(prompt.includes("the spreadsheet cell is EMPTY"));
  assert.ok(prompt.includes('the spreadsheet says: "BANK CONTOH NUSANTARA"'));
  assert.ok(
    prompt.includes('row: "1209990001"'),
    "two rows of one workbook carry the same field names and only the row tells them apart",
  );
  const f1Block = prompt.slice(prompt.indexOf("- id: f1"), prompt.indexOf("- id: f2"));
  assert.ok(
    !f1Block.includes("row:"),
    "a field with no group must not be given one; a row nobody wrote is a row " +
      "the model will answer against",
  );
});

test("a label or value carrying a newline cannot break the field list open", () => {
  const wrapped = [field("w1", "Alamat\nBaru", "Jalan Contoh\nNomor 1")];
  const prompt = buildComparePrompt(wrapped, PAGES, false);

  assert.ok(prompt.includes('field: "Alamat\\nBaru"'));
  assert.ok(prompt.includes('the spreadsheet says: "Jalan Contoh\\nNomor 1"'));
});

test("the re-search asks a different question, not the same one again", () => {
  const first = buildComparePrompt(FIELDS, PAGES, false);
  const again = buildComparePrompt(FIELDS, PAGES, true);

  assert.notEqual(first, again, "a re-roll of the identical question buys nothing");
  assert.match(again, /A first pass over these same documents already looked/);
  assert.match(again, /abbreviate freely/);
  assert.match(again, /SPLIT ACROSS TWO LINES/);
  assert.ok(
    again.includes('  "tidak-ditemukan"'),
    "the reply shape must be identical in both passes",
  );
});

// ---------------------------------------------------------------------------
// compareToDocuments
// ---------------------------------------------------------------------------

test("one call carries every field, because the listing is the expensive half", async () => {
  const { ask, prompts } = asking({
    fields: [
      { id: "f1", verdict: "cocok", page: 0, from: 2, to: 2 },
      { id: "f2", verdict: "beda", documentValue: "PSB VPN IP KCP Lain" },
      { id: "f3", verdict: "tidak-ditemukan" },
    ],
  });

  const entries = await compareToDocuments({ fields: FIELDS, pages: PAGES, ask });

  assert.equal(prompts.length, 1, "three fields must not cost three page listings");
  assert.deepEqual(
    entries.map((entry) => entry.verdict),
    ["cocok", "beda", "tidak-ditemukan"],
  );
});

test("the re-search prompt is what a retry actually sends", async () => {
  const { ask, prompts } = asking({ fields: [] });

  await compareToDocuments({ fields: FIELDS, pages: PAGES, ask, retry: true });

  assert.match(prompts[0], /A first pass over these same documents already looked/);
});

test("more fields than one call may carry are chunked, and every field still returns once", async () => {
  const many: ConfigField[] = Array.from(
    { length: MAX_FIELDS_PER_CALL + 5 },
    (_unused, at) => field(`f${at}`, `Isian ${at}`, `nilai ${at}`),
  );
  const prompts: string[] = [];
  const ask = async (prompt: string) => {
    prompts.push(prompt);
    // Answer only for the fields this chunk actually named, so a chunk that
    // silently carried the wrong slice would show up as missing entries.
    const asked = [...prompt.matchAll(/^- id: (f\d+)$/gm)].map((match) => match[1]);
    return JSON.stringify({
      fields: asked.map((id) => ({ id, verdict: "cocok" })),
    });
  };

  const entries = await compareToDocuments({ fields: many, pages: PAGES, ask });

  assert.equal(prompts.length, 2, "45 fields at 40 per call is two calls");
  assert.deepEqual(
    entries.map((entry) => entry.field.id),
    many.map((one) => one.id),
    "chunking must preserve input order and drop nothing",
  );
  assert.equal(
    entries.filter((entry) => entry.verdict === "cocok").length,
    many.length,
    "every field was asked about in the chunk that carried it",
  );
});

test("no field means no model call at all", async () => {
  const { ask, prompts } = asking({ fields: [] });

  assert.deepEqual(await compareToDocuments({ fields: [], pages: PAGES, ask }), []);
  assert.deepEqual(prompts, []);
});

test("no searchable page means nothing is asked and every field says why", async () => {
  const { ask, prompts } = asking({ fields: [] });

  const entries = await compareToDocuments({ fields: FIELDS, pages: [], ask });

  assert.deepEqual(prompts, [], "an empty listing invites a value with no source");
  assert.equal(entries.length, FIELDS.length);
  for (const entry of entries) {
    assert.equal(entry.verdict, "tidak-ditemukan");
    assert.match(entry.reason ?? "", /no searchable page was offered/);
  }
});

test("a provider failure is not swallowed into a page of searched-and-not-found", async () => {
  const ask = async () => {
    throw new Error("the model could not be reached");
  };

  await assert.rejects(
    () => compareToDocuments({ fields: FIELDS, pages: PAGES, ask }),
    /could not be reached/,
  );
});

test("a fenced reply is unwrapped, because models wrap JSON in prose", async () => {
  const { ask } = asking(
    'Berikut hasilnya:\n```json\n{"fields":[{"id":"f1","verdict":"cocok"}]}\n```',
  );

  const entries = byId(await compareToDocuments({ fields: FIELDS, pages: PAGES, ask }));

  assert.equal(entries.get("f1")?.verdict, "cocok");
});
