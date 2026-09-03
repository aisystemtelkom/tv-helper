/**
 * Offline tests for continuation discovery. No API calls, no credential, no
 * PDF: stage 1 is pure geometry and stage 2 takes its `Ask` injected, so the
 * whole thing -- what fires, what declines, what the chain does when the model
 * keeps saying yes -- is drivable with invented pages.
 *
 * Every string here is invented. The fictional set this repo uses is
 * LOP999001, 1-70000000001, BANK CONTOH NUSANTARA, PSB VPN IP KCP Contoh, and
 * nothing may be lifted out of `documents/`: this is a public repo. The
 * "Pasal" wording below is generic contract Indonesian, not a client's.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { OcrPage, Zone } from "./locate.ts";
import {
  CONTINUATION_CONTEXT_LINES,
  FURNITURE_MIN_PAGES,
  buildContinuationPrompt,
  checkForContinuation,
  confirmContinuation,
  findContinuations,
  furnitureSlack,
  furnitureTokens,
  lastContentLine,
  runningFurniture,
} from "./continuation.ts";

// ---------------------------------------------------------------------------
// Fixtures. A page big enough that CROP_PADDING_PX (12) never pushes a box off
// it, with lines far enough apart that `trimRunningFooter` has a real median
// pitch to divide by -- and never a gap 16x that pitch, so nothing here trips
// the footer trim by accident.
// ---------------------------------------------------------------------------

const PAGE_W = 1000;
const PAGE_H = 1400;
const PITCH = 40;

function page(index: number, texts: string[]): OcrPage {
  return {
    index,
    width: PAGE_W,
    height: PAGE_H,
    lines: texts.map((text, i) => ({
      i,
      text,
      box: { x: 100, y: 100 + i * PITCH, w: 700, h: 30 },
      words: [],
    })),
  };
}

/** The 3-line running footer bundle one's contract carries on every page. */
function withFooter(index: number, body: string[]): OcrPage {
  return page(index, [
    ...body,
    "PIHAK PERTAMA PIHAK KEDUA",
    `Halaman ${index + 1} dari 27`,
    "Ref: KONTRAK/CONTOH/2026",
  ]);
}

const zoneOn = (pageIndex: number, from: number, to: number): Zone => ({
  pageIndex,
  box: { x: 0, y: 0, w: 10, h: 10 },
  lineRange: [from, to],
});

const NO_FURNITURE = new Map<number, ReadonlySet<number>>();

// ---------------------------------------------------------------------------
// Running furniture.
// ---------------------------------------------------------------------------

test("furnitureTokens masks digits and collapses runs of them", () => {
  // The half that actually matters: a running footer's page number changes
  // LENGTH partway down a long document, so masking each digit without
  // collapsing makes the same footer look different on exactly the pages the
  // rule has to match.
  assert.deepEqual(furnitureTokens("Halaman 9 dari 27"), ["halaman", "#", "dari", "#"]);
  assert.deepEqual(
    furnitureTokens("Halaman 10 dari 27"),
    furnitureTokens("Halaman 9 dari 27"),
  );
  // Punctuation is not a token, and a line of pure punctuation has none.
  assert.deepEqual(furnitureTokens("Ref: KONTRAK/CONTOH/2026"), [
    "ref",
    "kontrak",
    "contoh",
    "#",
  ]);
  assert.deepEqual(furnitureTokens("---"), []);
});

test("runningFurniture finds the strip that repeats and leaves the body alone", () => {
  const pages = [
    withFooter(0, ["PERJANJIAN KERJASAMA", "Pasal 1 DEFINISI", "1. Para Pihak sepakat"]),
    withFooter(1, ["2. Ruang lingkup pekerjaan", "3. Harga borongan", "4. Jangka waktu"]),
    withFooter(2, ["Pasal 6 PEMBAYARAN PEKERJAAN", "1. Pembayaran dilakukan", "2. Tagihan"]),
    withFooter(3, ["3. Denda keterlambatan", "4. Rekening tujuan", "5. Pajak"]),
  ];

  const furniture = runningFurniture(pages);

  for (const p of pages) {
    // The last three lines of every page, and nothing above them.
    assert.deepEqual(
      [...furniture.get(p.index)!].sort((a, b) => a - b),
      [3, 4, 5],
      `page ${p.index}`,
    );
  }
});

test("runningFurniture returns nothing for a document too short to have a repeat", () => {
  // Deliberate, not accidental. On two pages every bottom line "repeats" on
  // 50% or 100% of the document, so the share threshold means nothing.
  //
  // THE CONSEQUENCE IS A MISS, NOT EXTRA WORK, and this comment used to say
  // the opposite. `lastContentLine` reads the true last line when nothing is
  // detected -- footer included -- which is a LATER line, and stage 1 declines
  // whatever ends above it. So an undetected footer silently declines the
  // captures that end where the content ends. `furnitureSlack` is what answers
  // it; see the test below.
  const pages = [
    withFooter(0, ["BERITA ACARA SPLITTING", "Nomor: BA/CONTOH/001"]),
    withFooter(1, ["Demikian berita acara ini dibuat", "Tanda tangan"]),
  ];
  assert.ok(pages.length < FURNITURE_MIN_PAGES);

  const furniture = runningFurniture(pages);
  for (const p of pages) assert.equal(furniture.get(p.index)!.size, 0);
});

test("lastContentLine skips the furniture, and is null when every line is furniture", () => {
  const p = withFooter(0, ["Pasal 6 PEMBAYARAN", "1. Pembayaran dilakukan"]);
  assert.equal(lastContentLine(p, new Set([2, 3, 4])), 1);
  assert.equal(lastContentLine(p, new Set()), 4);
  assert.equal(lastContentLine(p, new Set([0, 1, 2, 3, 4])), null);
});

// ---------------------------------------------------------------------------
// Stage 1.
// ---------------------------------------------------------------------------

test("a capture ending at the page's last content line looks like a continuation", () => {
  const pages = [
    withFooter(0, ["Pasal 6 PEMBAYARAN PEKERJAAN", "1. Tagihan diterbitkan", "2. Pembayaran"]),
    withFooter(1, ["3. Denda", "4. Rekening tujuan", "5. Pajak"]),
    withFooter(2, ["Pasal 7 SANKSI", "1. Sanksi", "2. Ganti rugi"]),
  ];
  const furniture = runningFurniture(pages);

  const check = checkForContinuation({
    zone: zoneOn(0, 0, 2),
    documentPages: pages,
    furniture,
    wholePageCapture: false,
  });

  assert.equal(check.looksLikeContinuation, true);
  assert.equal(check.verdict, "at-page-bottom");
  assert.equal(check.nextPage?.index, 1);
  // The reason carries the numbers, because a log line that only says "may
  // continue" cannot be checked by the person reading it.
  assert.match(check.reason, /last line \(2\)/);
  assert.match(check.reason, /3 running-furniture line\(s\) below it/);
});

test("a capture that stops above the last content line does not", () => {
  const pages = [
    withFooter(0, ["Pasal 2 JANGKA WAKTU", "1. Berlaku 12 bulan", "2. Dapat diperpanjang"]),
    withFooter(1, ["Pasal 3 HARGA", "1. Nilai borongan", "2. Sudah termasuk pajak"]),
    withFooter(2, ["Pasal 4 LAIN LAIN", "1. Perubahan", "2. Penutup"]),
  ];
  const furniture = runningFurniture(pages);

  const check = checkForContinuation({
    zone: zoneOn(0, 0, 1),
    documentPages: pages,
    furniture,
    wholePageCapture: false,
  });

  assert.equal(check.looksLikeContinuation, false);
  assert.equal(check.verdict, "above-last-content");
  assert.match(check.reason, /1 line\(s\) above page 0's last content line \(2\)/);
});

test("a page whose own footer went undetected can still report a continuation", () => {
  // MEASURED ON THE REAL BUNDLE, and the reason the slack exists. On bundle
  // one's merged scan, one OCR-dropped character puts page 7's doc-id line at
  // 0.50 token overlap against the other 20 pages' spelling, under the 0.60
  // threshold: 2 of its 3 footer lines go undetected, `lastContent` lands on a
  // footer line, and a capture ending exactly where the CONTENT ends is
  // declined with no signal at all. Four of 29 pages of the only bundle the
  // 1/1 recall was observed on are in that state.
  //
  // Reproduced here by handing `checkForContinuation` a furniture map that is
  // right about page 0 and short on page 1, which is what the detector does.
  //
  // FULL-LENGTH PAGES, because the slack is capped at a quarter of a page: a
  // running footer sits at the bottom of a page and is never a quarter of it,
  // and a six-line fixture would have the guard rather than the rule decide
  // the answer. A 300 DPI A4 contract page OCRs to 40-50 lines.
  const pages = [0, 1, 2].map((index) =>
    withFooter(
      index,
      Array.from({ length: 24 }, (_, k) => `p${index} butir ${k + 1} uraian`),
    ),
  );
  const lastBody = 23;
  const short = new Map<number, ReadonlySet<number>>([
    [0, new Set([24, 25, 26])],
    // Only the last of the three detected: `lastContentLine` answers 25, which
    // is a footer line, where the content ends at 23.
    [1, new Set([26])],
    [2, new Set([24, 25, 26])],
  ]);

  const check = checkForContinuation({
    zone: zoneOn(1, 0, lastBody),
    documentPages: pages,
    furniture: short,
    wholePageCapture: false,
  });

  assert.equal(check.looksLikeContinuation, true);
  assert.equal(check.verdict, "at-page-bottom");
  // The sentence says which line it allowed and why, because the operator
  // reading it has to be able to check it.
  assert.match(check.reason, /last detected content line \(25\)/);

  // The slack is the document's own deepest footer, never a tuned number.
  assert.equal(furnitureSlack(pages[1], pages, short), 3);

  // AND IT IS MONOTONE: a page the detector got right behaves exactly as
  // before, so nothing that fires today stops firing and nothing new fires on
  // a well-detected page.
  const rightAboutIt = checkForContinuation({
    zone: zoneOn(0, 0, lastBody - 1),
    documentPages: pages,
    furniture: short,
    wholePageCapture: false,
  });
  assert.equal(rightAboutIt.looksLikeContinuation, false);
  assert.equal(rightAboutIt.verdict, "above-last-content");
});

test("a capture that overshot into the footer is reported as an overshoot", () => {
  // It fires either way -- the block may still run on -- but it is the WEAKEST
  // evidence of a continuation, not the strongest, and the old sentence
  // asserted that line 4 IS line 2 and claimed three furniture lines below a
  // capture that had swallowed all three. That string is the reason in the
  // OUTSTANDING JSON and the log line an operator opens a page from.
  const pages = [
    withFooter(0, ["Pasal 6 PEMBAYARAN", "1. Tagihan", "2. Pembayaran"]),
    withFooter(1, ["3. Denda", "4. Rekening", "5. Pajak"]),
    withFooter(2, ["Pasal 7 SANKSI", "1. Sanksi", "2. Ganti rugi"]),
  ];
  const furniture = runningFurniture(pages);

  const clean = checkForContinuation({
    zone: zoneOn(0, 0, 2),
    documentPages: pages,
    furniture,
    wholePageCapture: false,
  });
  assert.equal(clean.verdict, "at-page-bottom");
  assert.match(clean.reason, /3 running-furniture line\(s\) below it/);

  const overshot = checkForContinuation({
    zone: zoneOn(0, 0, 4),
    documentPages: pages,
    furniture,
    wholePageCapture: false,
  });
  assert.equal(overshot.looksLikeContinuation, true);
  assert.equal(overshot.verdict, "past-last-content");
  assert.match(overshot.reason, /runs 2 line\(s\) PAST/);
  // Never "3 furniture lines below it": the capture contains them.
  assert.equal(/below it/.test(overshot.reason), false);
});

test("stage 2 is never shown the running footer as the tail of the block", async () => {
  // `findContinuations` hands the model the last lines of the confirmed
  // capture as what the continuation must be recognised against. A range that
  // overshot into the footer would make those lines the page-number and
  // initialling strip, which is a concrete mechanism for the plausible-wrong
  // extent this design has already measured once.
  const pages = [
    withFooter(0, ["Pasal 6 PEMBAYARAN", "1. Tagihan", "2. Pembayaran"]),
    withFooter(1, ["3. Denda", "4. Rekening", "5. Pajak"]),
    withFooter(2, ["Pasal 7 SANKSI", "1. Sanksi", "2. Ganti rugi"]),
  ];
  const furniture = runningFurniture(pages);

  let seen = "";
  await findContinuations({
    slotLabel: "KB / ToP",
    hint: "the payment clause",
    zone: zoneOn(0, 0, 5),
    documentPages: pages,
    furniture,
    wholePageCapture: false,
    ask: async (prompt) => {
      seen = prompt;
      return '{"continues":false,"from":null,"to":null,"confidence":"high"}';
    },
  });

  // Only the TAIL half of the prompt: the next page's own listing legitimately
  // carries that page's footer, and it is the last lines of the BLOCK that
  // this test is about.
  const tail = seen.slice(
    seen.indexOf("in order, are:"),
    seen.indexOf("Decide whether"),
  );
  assert.ok(tail.includes("2. Pembayaran"), "the block's own last line");
  assert.equal(tail.includes("PIHAK PERTAMA PIHAK KEDUA"), false);
  assert.equal(tail.includes("Halaman 1 dari 27"), false);
});

test("a table's repeating bottom row is not running furniture", () => {
  // Every digit run masks to `#` and the tokens are a SET, so a line reading
  // only "17.500.000" reduces to {"#"} and overlaps every other money-only
  // line at 1.0. A price annex whose every page ends on a total row would have
  // that row called furniture on every page, and a capture that visibly
  // stopped a row SHORT of the page bottom would then fire as at-page-bottom.
  // Constructed rather than measured -- bundle one's detected furniture is all
  // genuine footer -- but bundle two is all price and quantity rows.
  // Every page ends on a money-only row and shares no other wording, so the
  // total row is the only candidate the repeat rule can see.
  const rows = [
    ["Instalasi perangkat utama", "Kabel dan aksesori"],
    ["Konfigurasi jaringan inti", "Lisensi tahunan"],
    ["Pengujian akhir sistem", "Dokumentasi serah terima"],
    ["Pelatihan pengguna kantor", "Dukungan purna jual"],
  ];
  const pages = rows.map((body, index) =>
    page(index, [...body, "17.500.000"]),
  );

  const furniture = runningFurniture(pages);
  for (const p of pages) {
    assert.equal(furniture.get(p.index)!.size, 0, `page ${p.index}`);
  }

  // So the last row is content, and a capture stopping above it says so.
  const check = checkForContinuation({
    zone: zoneOn(0, 0, 1),
    documentPages: pages,
    furniture,
    wholePageCapture: false,
  });
  assert.equal(check.looksLikeContinuation, false);
  assert.equal(check.verdict, "above-last-content");
});

test("a whole-page capture is never asked, because the test cannot inform it", () => {
  // Three of the six false positives measured on bundle one were exactly
  // this: a whole-page capture ends at its page's last content line BY
  // CONSTRUCTION, so the rule fires on it and means nothing.
  const pages = [page(0, ["BERITA ACARA", "Isi surat", "Tanda tangan"]), page(1, ["x"])];

  const check = checkForContinuation({
    zone: zoneOn(0, 0, 2),
    documentPages: pages,
    furniture: NO_FURNITURE,
    wholePageCapture: true,
  });

  assert.equal(check.looksLikeContinuation, false);
  assert.equal(check.verdict, "whole-page-capture");
});

test("a capture on the last page of its document has nowhere to continue", () => {
  // This is also what fences a chain to ONE source document: the last page of
  // a merged contract scan is not continued by the first page of a separate
  // SPLITBA scan, however adjacent their run-global page numbers are.
  const pages = [page(0, ["a", "b"]), page(1, ["c", "d"])];

  const check = checkForContinuation({
    zone: zoneOn(1, 0, 1),
    documentPages: pages,
    furniture: NO_FURNITURE,
    wholePageCapture: false,
  });

  assert.equal(check.looksLikeContinuation, false);
  assert.equal(check.verdict, "no-next-page");
  assert.equal(check.nextPage, null);
});

test("a page whose every line is furniture declines rather than guessing", () => {
  const pages = [page(0, ["a", "b"]), page(1, ["c"]), page(2, ["d"])];
  const furniture = new Map<number, ReadonlySet<number>>([[0, new Set([0, 1])]]);

  const check = checkForContinuation({
    zone: zoneOn(0, 0, 1),
    documentPages: pages,
    furniture,
    wholePageCapture: false,
  });

  assert.equal(check.looksLikeContinuation, false);
  assert.equal(check.verdict, "no-content-line");
});

test("a zone whose page is not in the document supplied throws", () => {
  // Loud, because the alternative is scoping a chain to the wrong document
  // and proposing the next FILE's first page as a continuation.
  assert.throws(
    () =>
      checkForContinuation({
        zone: zoneOn(7, 0, 1),
        documentPages: [page(0, ["a", "b"])],
        furniture: NO_FURNITURE,
        wholePageCapture: false,
      }),
    /zone page 7 is not among the 1 pages of the document supplied/,
  );
});

// ---------------------------------------------------------------------------
// Stage 2.
// ---------------------------------------------------------------------------

const TAIL_PAGE = page(0, [
  "Pasal 6 PEMBAYARAN PEKERJAAN",
  "1. Tagihan diterbitkan setiap bulan",
  "2. Pembayaran dilakukan 30 hari",
  "3. Denda keterlambatan berlaku",
  "4. Rekening tujuan sebagai berikut",
  "5. Pajak ditanggung PIHAK KEDUA",
  "6. Bukti transfer dikirimkan",
  "7. Perselisihan diselesaikan musyawarah",
]);
const NEXT_PAGE = page(1, [
  "8. Nomor rekening tujuan pembayaran",
  "9. Atas nama penerima",
  "10. Konfirmasi transfer",
  "Pasal 7 SANKSI",
]);

test("the prompt shows only the tail of the block and numbers the next page from 0", () => {
  const prompt = buildContinuationPrompt(
    "KB / ToP",
    "the payment clause",
    TAIL_PAGE.lines,
    NEXT_PAGE,
  );

  // Six of the eight tail lines, and not the first two.
  assert.equal(CONTINUATION_CONTEXT_LINES, 6);
  assert.equal(prompt.includes("Pasal 6 PEMBAYARAN PEKERJAAN"), false);
  assert.equal(prompt.includes("1. Tagihan diterbitkan setiap bulan"), false);
  assert.ok(prompt.includes("2. Pembayaran dilakukan 30 hari"));
  assert.ok(prompt.includes("7. Perselisihan diselesaikan musyawarah"));

  // The next page, numbered by POSITION -- the same discipline, for the same
  // measured reason, as buildLocatePrompt.
  assert.ok(prompt.includes("0: 8. Nomor rekening tujuan pembayaran"));
  assert.ok(prompt.includes("3: Pasal 7 SANKSI"));
  assert.ok(prompt.includes('"continues"'));
});

test("a yes becomes a rectangle on the next page, cited by line number", async () => {
  const found = await confirmContinuation(
    "KB / ToP",
    "the payment clause",
    TAIL_PAGE.lines,
    NEXT_PAGE,
    async () => '{"continues":true,"from":0,"to":2,"confidence":"high"}',
  );

  assert.ok(found);
  assert.equal(found.zone.pageIndex, 1);
  assert.deepEqual(found.zone.lineRange, [0, 2]);
  assert.equal(found.confidence, "high");
  // The transcript is the cited lines and only them, so the picture and the
  // line numbers printed beside it cannot disagree.
  assert.equal(
    found.text,
    ["8. Nomor rekening tujuan pembayaran", "9. Atas nama penerima", "10. Konfirmasi transfer"].join(
      "\n",
    ),
  );
  // The box unions those three lines and pads them, inside the page.
  assert.ok(found.zone.box.w > 0 && found.zone.box.h > 0);
  assert.ok(found.zone.box.x >= 0 && found.zone.box.y >= 0);
  assert.ok(found.zone.box.x + found.zone.box.w <= PAGE_W);
});

test("a no is a no, not an empty range", async () => {
  const found = await confirmContinuation(
    "KB / ToP",
    "the payment clause",
    TAIL_PAGE.lines,
    NEXT_PAGE,
    async () => '{"continues":false,"from":null,"to":null,"confidence":"high"}',
  );
  assert.equal(found, null);
});

test("a yes with no range, or a range the page does not have, throws", async () => {
  await assert.rejects(
    () =>
      confirmContinuation(
        "KB / ToP",
        "the payment clause",
        TAIL_PAGE.lines,
        NEXT_PAGE,
        async () => '{"continues":true,"from":null,"to":null,"confidence":"low"}',
      ),
    /null line range/,
  );

  await assert.rejects(
    () =>
      confirmContinuation(
        "KB / ToP",
        "the payment clause",
        TAIL_PAGE.lines,
        NEXT_PAGE,
        async () => '{"continues":true,"from":2,"to":40,"confidence":"low"}',
      ),
    /not a position range/,
  );

  await assert.rejects(
    () =>
      confirmContinuation(
        "KB / ToP",
        "the payment clause",
        TAIL_PAGE.lines,
        NEXT_PAGE,
        async () => '{"continues":true,"from":3,"to":1,"confidence":"low"}',
      ),
    /reversed/,
  );
});

// ---------------------------------------------------------------------------
// The chain.
// ---------------------------------------------------------------------------

/** Pages with no furniture, so "ends at the last line" means "runs on". */
const CHAIN_PAGES = [0, 1, 2, 3, 4].map((i) =>
  page(i, [`p${i} baris satu`, `p${i} baris dua`, `p${i} baris tiga`]),
);

/** A model that always says "yes, the whole of the next page". */
const alwaysYes = async () => '{"continues":true,"from":0,"to":2,"confidence":"high"}';

test("a continuation that itself runs off the page is followed, with no count declared", async () => {
  // The operator's own words: "there can be more than 1 lanjutan". Nothing in
  // the template says how many, and nothing here counts to a target -- each
  // confirmed capture simply becomes stage 1's input again.
  let asked = 0;
  const walked = await findContinuations({
    slotLabel: "KB / ToP",
    hint: "the payment clause",
    zone: zoneOn(0, 0, 2),
    documentPages: CHAIN_PAGES,
    furniture: NO_FURNITURE,
    wholePageCapture: false,
    ask: async (prompt) => {
      asked += 1;
      // Page 2 opens something else, so the chain stops there.
      return prompt.includes("p2 baris satu")
        ? '{"continues":false,"from":null,"to":null,"confidence":"high"}'
        : '{"continues":true,"from":0,"to":2,"confidence":"high"}';
    },
  });

  assert.equal(asked, 2);
  assert.deepEqual(walked.zones.map((z) => z.pageIndex), [1]);
  assert.equal(walked.stoppedAtCap, false);
  assert.deepEqual(
    walked.steps.map((s) => [s.ordinal, s.outcome]),
    [
      [2, "found"],
      [3, "model-declined"],
    ],
  );
});

test("the chain stops at its cap and SAYS SO rather than stopping quietly", async () => {
  // The cap cannot be small enough to be a safety mechanism on its own --
  // bundle two's deepest slot holds ten captures, i.e. nine continuations --
  // so what protects a 151-page document is that hitting it is reported.
  const walked = await findContinuations({
    slotLabel: "KB / Detail",
    hint: "the scope and pricing clause",
    zone: zoneOn(0, 0, 2),
    documentPages: CHAIN_PAGES,
    furniture: NO_FURNITURE,
    wholePageCapture: false,
    ask: alwaysYes,
    maxChain: 2,
  });

  assert.equal(walked.zones.length, 2);
  assert.equal(walked.stoppedAtCap, true);
  const last = walked.steps[walked.steps.length - 1];
  assert.equal(last.outcome, "cap");
  assert.match(last.reason, /chain cap/);
  assert.match(last.reason, /checked by hand/);
});

test("a whole-page capture costs no model call at all", async () => {
  let asked = 0;
  const walked = await findContinuations({
    slotLabel: "SP",
    hint: "the whole Surat Penunjukan page",
    zone: zoneOn(0, 0, 2),
    documentPages: CHAIN_PAGES,
    furniture: NO_FURNITURE,
    wholePageCapture: true,
    ask: async () => {
      asked += 1;
      return alwaysYes();
    },
  });

  assert.equal(asked, 0);
  assert.deepEqual(walked.zones, []);
  assert.deepEqual(
    walked.steps.map((s) => s.verdict),
    ["whole-page-capture"],
  );
});

test("a decline is recorded, not just an acceptance", async () => {
  // "We looked and found none" is the half that closes this change's own
  // trade: without it a slot with an undiscovered continuation looks finished.
  const walked = await findContinuations({
    slotLabel: "KB / Jangka Waktu",
    hint: "the term of the agreement",
    zone: zoneOn(0, 0, 0),
    documentPages: CHAIN_PAGES,
    furniture: NO_FURNITURE,
    wholePageCapture: false,
    ask: alwaysYes,
  });

  assert.deepEqual(walked.zones, []);
  assert.equal(walked.steps.length, 1);
  assert.equal(walked.steps[0].outcome, "declined");
  assert.equal(walked.steps[0].verdict, "above-last-content");
  assert.equal(walked.steps[0].fromPageIndex, 0);
});

test("an unusable reply stops the chain with the message kept, and never throws", async () => {
  // A continuation nobody can validate is a capture the operator draws by
  // hand, which is this design's floor and a perfectly good outcome. Losing
  // the rest of the run over it is not, and neither is inventing a range.
  const walked = await findContinuations({
    slotLabel: "KB / ToP",
    hint: "the payment clause",
    zone: zoneOn(0, 0, 2),
    documentPages: CHAIN_PAGES,
    furniture: NO_FURNITURE,
    wholePageCapture: false,
    ask: async () => '{"continues":true,"from":0,"to":99,"confidence":"high"}',
  });

  assert.deepEqual(walked.zones, []);
  assert.equal(walked.steps[0].outcome, "model-error");
  assert.match(walked.steps[0].reason, /not a position range/);
});
