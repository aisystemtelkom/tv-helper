/**
 * Offline tests for judul discovery. No API call, no credential, no PDF: the
 * stage takes its `Ask` injected and its pages are plain objects, so every
 * rule -- what parses, what is refused, and what the answer is when the model
 * says something untrue -- is drivable with invented text.
 *
 * EVERY STRING HERE IS INVENTED. The fictional set this repo uses is
 * LOP999001, 1-70000000001, BANK CONTOH NUSANTARA, PSB VPN IP KCP Contoh, SID
 * 1209990001, Budi Contoh. The headings below are generic Indonesian contract
 * furniture, not a client's paperwork: this repo is public.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSectionsPrompt,
  discoverSections,
  type DiscoveryPage,
} from "./sections.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function page(index: number, texts: string[]): DiscoveryPage {
  return { index, lines: texts.map((text, i) => ({ i, text })) };
}

/**
 * A three-page berkas whose pages carry a real heading each, so a reply can be
 * both right and wrong about them in every way the rules care about.
 */
const BERKAS: DiscoveryPage[] = [
  page(0, [
    "BERITA ACARA PERMINTAAN ORDER",
    "Nomor: LOP999001",
    "Pada hari ini telah dilakukan permintaan order untuk",
    "BANK CONTOH NUSANTARA",
  ]),
  page(1, [
    "Lampiran daftar layanan",
    "SID 1209990001",
    "PSB VPN IP KCP Contoh",
  ]),
  page(2, [
    "SURAT PENUNJUKAN",
    "Nomor: 1-70000000001",
    "Kepada Budi Contoh",
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

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test("a good reply parses into judul, with the pages it spans", async () => {
  const { ask } = asking({
    sections: [
      {
        title: "BERITA ACARA PERMINTAAN ORDER",
        fromPage: 0,
        toPage: 1,
        titleLines: [0, 0],
      },
      { title: "SURAT PENUNJUKAN", fromPage: 2, toPage: 2, titleLines: [0, 0] },
    ],
  });

  const found = await discoverSections(BERKAS, ask);

  assert.equal(found.unusable.length, 0);
  assert.deepEqual(
    found.sections.map((s) => s.title),
    ["BERITA ACARA PERMINTAAN ORDER", "SURAT PENUNJUKAN"],
  );
  assert.deepEqual(found.sections[0].pages, [0, 1]);
  assert.deepEqual(found.sections[0].cite, {
    pageIndex: 0,
    lineRange: [0, 0],
  });
  assert.deepEqual(found.sections[1].pages, [2]);
});

test("the title may be transcribed across two wrapped lines", async () => {
  // A printed heading wraps, and the reply cites both lines. Whitespace
  // collapsing is packaging, so this is the same heading and must pass.
  const wrapped = [
    page(0, ["BERITA ACARA", "PERMINTAAN ORDER", "Nomor: LOP999001"]),
  ];
  const { ask } = asking({
    sections: [
      {
        title: "BERITA ACARA PERMINTAAN ORDER",
        fromPage: 0,
        toPage: 0,
        titleLines: [0, 1],
      },
    ],
  });

  const found = await discoverSections(wrapped, ask);
  assert.equal(found.unusable.length, 0);
  assert.equal(found.sections.length, 1);
});

// ---------------------------------------------------------------------------
// GAPS ARE LEGAL. This is the deliberate departure from `classifyPages`.
// ---------------------------------------------------------------------------

test("a reply that leaves pages out is accepted, not refused", async () => {
  // `classifyPages` would throw here: it demands every page exactly once,
  // because nothing downstream confirms its spans. Every span this stage
  // produces is ruled on by a person, so a reply covering one page of three is
  // an ordinary reply about a document whose middle pages carry no heading.
  const { ask } = asking({
    sections: [
      { title: "SURAT PENUNJUKAN", fromPage: 2, toPage: 2, titleLines: [0, 0] },
    ],
  });

  const found = await discoverSections(BERKAS, ask);

  assert.equal(found.sections.length, 1);
  assert.equal(found.unusable.length, 0);
  assert.deepEqual(found.sections[0].pages, [2]);
});

// ---------------------------------------------------------------------------
// The refusals
// ---------------------------------------------------------------------------

test("an overlapping pair is refused, both of them", async () => {
  const { ask } = asking({
    sections: [
      {
        title: "BERITA ACARA PERMINTAAN ORDER",
        fromPage: 0,
        toPage: 1,
        titleLines: [0, 0],
      },
      {
        title: "Lampiran daftar layanan",
        fromPage: 1,
        toPage: 2,
        titleLines: [0, 0],
      },
    ],
  });

  const found = await discoverSections(BERKAS, ask);

  // Neither survives: which heading page 1 belongs under is the thing the
  // model got wrong, so preferring either by argument order would be a guess.
  assert.equal(found.sections.length, 0);
  assert.equal(found.unusable.length, 2);
  for (const one of found.unusable) {
    assert.match(one.reason, /also claimed by/);
  }
});

test("a title that is not in its cited lines is refused", async () => {
  const { ask } = asking({
    sections: [
      {
        // Described rather than transcribed. Plausible, absent from the page,
        // and a fabricated heading in a document a validator signs.
        title: "Halaman permintaan order dari pelanggan",
        fromPage: 0,
        toPage: 0,
        titleLines: [0, 0],
      },
    ],
  });

  const found = await discoverSections(BERKAS, ask);

  assert.equal(found.sections.length, 0);
  assert.equal(found.unusable.length, 1);
  assert.match(found.unusable[0].reason, /described rather than transcribed/);
});

test("titleLines naming a line the page lacks is refused", async () => {
  const { ask } = asking({
    sections: [
      {
        title: "SURAT PENUNJUKAN",
        fromPage: 2,
        toPage: 2,
        // Page 2 has lines 0-2.
        titleLines: [0, 3],
      },
    ],
  });

  const found = await discoverSections(BERKAS, ask);

  assert.equal(found.sections.length, 0);
  assert.match(found.unusable[0].reason, /line 3, which page 2 does not have/);
});

test("a citation wide enough to make the substring rule meaningless is refused", async () => {
  const wide = [
    page(0, [
      "BERITA ACARA PERMINTAAN ORDER",
      "satu",
      "dua",
      "tiga",
      "empat",
      "lima",
    ]),
  ];
  const { ask } = asking({
    sections: [
      {
        title: "BERITA ACARA PERMINTAAN ORDER",
        fromPage: 0,
        toPage: 0,
        titleLines: [0, 5],
      },
    ],
  });

  const found = await discoverSections(wide, ask);

  assert.equal(found.sections.length, 0);
  assert.match(found.unusable[0].reason, /titleLines covers 6 lines/);
});

test("a span whose first page has no OCR lines is dropped", async () => {
  const withBlank = [
    page(0, []),
    page(1, ["SURAT PENUNJUKAN", "Nomor: 1-70000000001"]),
  ];
  const { ask } = asking({
    sections: [
      { title: "SURAT PENUNJUKAN", fromPage: 0, toPage: 1, titleLines: [0, 0] },
    ],
  });

  const found = await discoverSections(withBlank, ask);

  // Accepting it would put a whole-page citation on a page with no line 0,
  // which `acceptProposal` refuses one page into an accept already under way.
  assert.equal(found.sections.length, 0);
  assert.match(found.unusable[0].reason, /no recognised lines/);
});

test("a reversed span and a span past the last page are refused", async () => {
  const { ask } = asking({
    sections: [
      { title: "SURAT PENUNJUKAN", fromPage: 2, toPage: 1, titleLines: [0, 0] },
      {
        title: "BERITA ACARA PERMINTAAN ORDER",
        fromPage: 0,
        toPage: 9,
        titleLines: [0, 0],
      },
    ],
  });

  const found = await discoverSections(BERKAS, ask);

  assert.equal(found.sections.length, 0);
  assert.equal(found.unusable.length, 2);
  assert.match(found.unusable[0].reason, /span reversed/);
  assert.match(found.unusable[1].reason, /this berkas has 3 page\(s\)/);
});

// ---------------------------------------------------------------------------
// Everything failing is an empty list and a sentence. Never a fallback.
// ---------------------------------------------------------------------------

test("everything failing yields an empty list, a sentence, and no throw", async () => {
  const { ask } = asking({
    sections: [
      { title: "Bagian pembayaran", fromPage: 0, toPage: 0, titleLines: [0, 0] },
      { title: "Bagian layanan", fromPage: 1, toPage: 1, titleLines: [0, 0] },
    ],
  });

  const found = await discoverSections(BERKAS, ask);

  assert.deepEqual(found.sections, []);
  assert.equal(found.unusable.length, 2);
  // A sentence, and one that says which of the several "no judul" cases this
  // is. Inventing "one judul named after the berkas" would be fabrication with
  // better manners; the operator has "Tambah judul" for that.
  assert.match(found.note, /named 2 judul and none of them could be checked/);
});

test("a model that names nothing says so, distinctly from everything failing", async () => {
  const { ask } = asking({ sections: [] });
  const found = await discoverSections(BERKAS, ask);

  assert.deepEqual(found.sections, []);
  assert.deepEqual(found.unusable, []);
  assert.match(found.note, /found no heading/);
});

test("no pages means no model call at all", async () => {
  let called = 0;
  const found = await discoverSections([], async () => {
    called += 1;
    return "{}";
  });

  assert.equal(called, 0);
  assert.deepEqual(found.sections, []);
  assert.match(found.note, /nothing was asked/);
});

test("a reply with no JSON in it throws rather than answering empty", async () => {
  // `extractJson`'s own line, and `classifyPages` draws it too: an ambiguous
  // reply fails at the boundary instead of reaching a schema that will do its
  // best with it. An empty answer here would read as "this berkas has no
  // headings", which is a different and false statement.
  const { ask } = asking("I could not read this document.");
  await assert.rejects(() => discoverSections(BERKAS, ask), /No JSON object/);
});

// ---------------------------------------------------------------------------
// Local renumbering. The case that hid the original bug.
// ---------------------------------------------------------------------------

test("the prompt numbers pages from 0 and the answer maps back to true indexes", async () => {
  // A pool starting at page 23 made the model answer 22, and it stayed hidden
  // for weeks because every other pool started at 0 -- where "convert to
  // 0-based" and "echo the label back" produce the same answer. So the pool
  // here deliberately starts at a non-zero index.
  const later: DiscoveryPage[] = [
    page(23, ["SURAT PENUNJUKAN", "Nomor: 1-70000000001"]),
    page(24, ["Lampiran daftar layanan", "SID 1209990001"]),
  ];

  const { ask, prompts } = asking({
    sections: [
      { title: "SURAT PENUNJUKAN", fromPage: 0, toPage: 1, titleLines: [0, 0] },
    ],
  });

  const found = await discoverSections(later, ask);

  // The model never saw 23 or 24.
  assert.match(prompts[0], /page 0:/);
  assert.match(prompts[0], /page 1:/);
  assert.doesNotMatch(prompts[0], /page 23:/);

  // And every number that came back out is a true index.
  assert.deepEqual(found.sections[0].pages, [23, 24]);
  assert.equal(found.sections[0].cite.pageIndex, 23);
});

test("a page the recogniser found no text on is listed as such, not omitted", async () => {
  const prompt = buildSectionsPrompt([page(0, ["SURAT PENUNJUKAN"]), page(1, [])]);
  // A silent gap in the listing reads as a page that was withheld.
  assert.match(prompt, /page 1: \(no text was recognised on this page\)/);
});

test("the question leads and the listing follows", async () => {
  const prompt = buildSectionsPrompt(BERKAS);
  const question = prompt.indexOf("List those sections");
  const listing = prompt.indexOf("page 0:");
  assert.ok(question >= 0 && listing >= 0);
  assert.ok(
    question < listing,
    "the listing must not come before the question; see the prefix-cache note",
  );
});
