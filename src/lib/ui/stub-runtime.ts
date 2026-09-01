/**
 * A FAKE browser runtime, so this UI track can be built and driven before the
 * real `src/lib/browser/runtime.ts` lands. It is not a fallback and must never
 * become one: it invents pages, invents OCR lines, and paints its own
 * "scans". Delete it, or leave it wired only behind `RuntimeProvider`, once
 * the real module exists -- see the merge note at the top of `runtime.ts`.
 *
 * Two things about it are deliberate rather than lazy:
 *
 *   - The synthetic page bitmap DRAWS EVERY OCR LINE AT ITS OWN BOX. The zone
 *     editor's snapping is only judgeable if what is painted and what is
 *     snapped to are the same geometry; a stub that painted lorem ipsum
 *     wherever it liked would make a broken snap look correct.
 *   - `ingestDocument` also produces proposals. The agreed contract has no
 *     entry point for the search itself, and the only reading that makes the
 *     flow work is that the run it returns has been searched. The UI copes
 *     either way (it says plainly when pages arrived unsearched), and this
 *     stub takes the reading that lets the whole flow be exercised.
 *
 * Every identifier here is from the project's fictional set. This repo is
 * public and has leaked twice.
 */

import { seedSlots } from "../browser/runtime.ts";
import { AO_TEMPLATE } from "../forms/template.ts";
import type { Line } from "../pipeline/geometry.ts";
import { CROP_PADDING_PX } from "../pipeline/locate.ts";
import type {
  BrowserRun,
  Runtime,
  RunSummary,
  SlotState,
  StoredPage,
} from "./runtime.ts";

const PAGE_W = 2480;
const PAGE_H = 3507;

const SAMPLE_TEXT = [
  "PERJANJIAN KERJASAMA",
  "Nomor: K.TEL.999/HK.810/DBS-0000/2026",
  "Antara",
  "PT TELEKOMUNIKASI CONTOH",
  "Dengan",
  "BANK CONTOH NUSANTARA",
  "Tentang",
  "PSB VPN IP KCP Contoh",
  "Pada hari ini, Senin tanggal satu bulan September tahun dua ribu dua",
  "puluh enam, yang bertanda tangan di bawah ini:",
  "1. PIHAK PERTAMA, dalam hal ini bertindak untuk dan atas nama",
  "   penyedia jasa telekomunikasi, berkedudukan di Jakarta.",
  "2. PIHAK KEDUA, dalam hal ini bertindak untuk dan atas nama",
  "   BANK CONTOH NUSANTARA, berkedudukan di Jakarta.",
  "Pasal 1",
  "RUANG LINGKUP DAN HARGA PEKERJAAN",
  "Ruang lingkup pekerjaan meliputi penyediaan layanan VPN IP pada",
  "lokasi KCP Contoh dengan bandwidth sesuai lampiran.",
  "Pasal 2",
  "JANGKA WAKTU PERJANJIAN",
  "Perjanjian ini berlaku selama 36 (tiga puluh enam) bulan terhitung",
  "sejak tanggal Berita Acara Instalasi ditandatangani.",
  "Pasal 3",
  "PEMBAYARAN PEKERJAAN",
  "Tagihan diterbitkan setiap bulan dan dibayarkan selambat-lambatnya",
  "30 (tiga puluh) hari kalender sejak tagihan diterima.",
  "LOP999001 / QUOTE 1-70000000001",
  "PIHAK PERTAMA",
  "PIHAK KEDUA",
  "( .................... )",
  "( .................... )",
  "Paraf Pihak Pertama / Paraf Pihak Kedua - halaman 1 dari 1",
];

/** Lines laid out down the page, wide enough to look like scanned body text. */
function syntheticLines(seed: number): Line[] {
  const left = 260;
  const top = 300;
  const step = 96;
  return SAMPLE_TEXT.map((text, i) => {
    const width = Math.min(1900, 620 + ((text.length * 34 + seed * 17) % 1280));
    const box = { x: left, y: top + i * step, w: width, h: 54 };
    return { i, text, box, words: [{ text, box }] };
  });
}

/**
 * `indexInSource` is the page's number WITHIN ITS OWN DOCUMENT, restarting at
 * 0 for every source -- which is what `StoredPage.index` means in the real
 * runtime. It is NOT the run-global page number; that one is the page's
 * position in `run.pages` and is what a `Zone.pageIndex` holds.
 *
 * This stub used to number pages globally here, which made both readings look
 * identical and hid the distinction from every screen developed against it.
 */
function makePage(sourceId: string, indexInSource: number): StoredPage {
  return {
    id: `${sourceId}-${indexInSource}`,
    sourceId,
    index: indexInSource,
    widthPx: PAGE_W,
    heightPx: PAGE_H,
    lines: syntheticLines(indexInSource),
  };
}

/**
 * Seeded by the REAL runtime's `seedSlots`, deliberately.
 *
 * The stub previously built its own slot list and gave a two-capture slot two
 * states under the SAME key, where the real runtime keys them `<slot>#1` and
 * `<slot>#2`. Every screen was therefore developed against a key convention
 * production does not use, and the difference was invisible until the real
 * module was wired. Borrowing the real seeder is what stops that recurring:
 * a stub may invent pages and pixels, but not the shape of the contract.
 */
function emptySlots(): SlotState[] {
  return seedSlots(AO_TEMPLATE);
}

/**
 * `pageIndex` is the page's POSITION IN `run.pages`, not `page.index`. Getting
 * this wrong in a fake is worse than getting it wrong in production, because
 * it teaches every screen the wrong rule while all the tests pass.
 */
function zoneFor(run: BrowserRun, page: StoredPage, from: number, to: number) {
  const picked = page.lines.filter((l) => l.i >= from && l.i <= to);
  const x = Math.min(...picked.map((l) => l.box.x)) - CROP_PADDING_PX;
  const y = Math.min(...picked.map((l) => l.box.y)) - CROP_PADDING_PX;
  const right = Math.max(...picked.map((l) => l.box.x + l.box.w)) + CROP_PADDING_PX;
  const bottom = Math.max(...picked.map((l) => l.box.y + l.box.h)) + CROP_PADDING_PX;
  return {
    pageIndex: run.pages.indexOf(page),
    box: { x, y, w: right - x, h: bottom - y },
    lineRange: [from, to] as [number, number],
  };
}

/**
 * A plausible proposal for each slot still wanting one, cycling through a few
 * line ranges so the contact sheet shows a mix of tight crops and one that
 * obviously ran on -- which is the failure the sheet exists to catch.
 */
const RANGES: [number, number][] = [
  [0, 7],
  [8, 13],
  [14, 17],
  [18, 21],
  [22, 25],
  [0, 31],
  [27, 31],
];

function searchStub(run: BrowserRun, roundPages: StoredPage[]): SlotState[] {
  if (roundPages.length === 0) return run.slots;
  let cursor = 0;
  return run.slots.map((slot) => {
    // Confirmed work is never re-searched: a later round may only add.
    if (slot.status === "confirmed" || slot.status === "unfilled") return slot;
    if (slot.zone) return slot;

    const page = roundPages[cursor % roundPages.length];
    const range = RANGES[cursor % RANGES.length];
    cursor += 1;

    // Every fourth slot comes back empty, so the dokumen tambahan loop has
    // something real to work on.
    if (cursor % 4 === 0) {
      return { ...slot, status: "outstanding" as const, zone: undefined };
    }
    return {
      ...slot,
      status: "proposed" as const,
      origin: "llm" as const,
      zone: zoneFor(run, page, range[0], range[1]),
      text: page.lines
        .filter((l) => l.i >= range[0] && l.i <= range[1])
        .map((l) => l.text)
        .join("\n"),
    };
  });
}

function seedRun(): BrowserRun {
  const sourceId = "src-splitba";
  const otherId = "src-merged";
  // Each source's pages restart at 0, exactly as the real ingest numbers them.
  // The run-global positions are 0..4; the second document's `index` values
  // are 0,1,2 and deliberately COLLIDE with the first document's, because that
  // collision is the normal case in production and any screen that cannot
  // cope with it is broken.
  const pages = [
    makePage(sourceId, 0),
    makePage(sourceId, 1),
    makePage(otherId, 0),
    makePage(otherId, 1),
    makePage(otherId, 2),
  ];
  const run: BrowserRun = {
    id: "demo-run",
    createdAt: Date.now(),
    sources: [
      { id: sourceId, name: "SPLITBA_LOP999001.pdf", pageCount: 2 },
      { id: otherId, name: "LOP999001_1-70000000001_merged.pdf", pageCount: 3 },
    ],
    pages,
    slots: emptySlots(),
  };
  return { ...run, slots: searchStub(run, pages) };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Draws a page that matches its own OCR boxes. Not a scan, and not trying to
 * look like one: grey bars where the text is, so a snap that lands on the
 * wrong lines is visible.
 */
async function drawPage(page: StoredPage): Promise<ImageBitmap> {
  const canvas = document.createElement("canvas");
  canvas.width = page.widthPx;
  canvas.height = page.heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("stub runtime needs a 2d canvas context");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f2f0ec";
  ctx.fillRect(0, 0, canvas.width, 180);

  ctx.fillStyle = "#111111";
  ctx.font = "42px monospace";
  ctx.textBaseline = "top";
  for (const line of page.lines) {
    ctx.fillStyle = "#e6e3dd";
    ctx.fillRect(line.box.x, line.box.y, line.box.w, line.box.h);
    ctx.fillStyle = "#1b1b1b";
    ctx.fillText(line.text, line.box.x + 6, line.box.y + 6);
  }

  ctx.fillStyle = "#8a8a8a";
  ctx.font = "36px monospace";
  ctx.fillText(`STUB PAGE ${page.index} - ${page.id}`, 260, 90);

  return await createImageBitmap(canvas);
}

/**
 * One store per module load. Runs do not survive a reload, which is the point:
 * nobody should mistake the stub for the IndexedDB-backed real thing.
 */
export function createStubRuntime(): Runtime {
  // THE GUARD. This fake invents pages, invents OCR lines and paints its own
  // "scans"; a build that served it to an operator would produce a validation
  // document full of confident, fabricated evidence and nothing would look
  // wrong. The app ran on it for an entire track precisely because nothing
  // failed when it was wired, so the refusal is deliberate and loud.
  //
  // `process.env.NODE_ENV` is statically inlined into the client bundle by
  // Next, so this is a real production-build guard and not just a server-side
  // check. Tests and `next dev` are unaffected.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "createStubRuntime() was called in a production build. The stub " +
        "fabricates pages and OCR text; it must never back an operator's " +
        "run. Use `liveRuntime` from src/lib/ui/live-runtime.ts.",
    );
  }

  const runs = new Map<string, BrowserRun>();
  const seeded = seedRun();
  runs.set(seeded.id, seeded);

  return {
    outstandingSlots(run) {
      return run.slots.filter((slot) => slot.status === "outstanding");
    },

    async listRuns(): Promise<RunSummary[]> {
      return [...runs.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((run) => ({
          id: run.id,
          createdAt: run.createdAt,
          label: run.sources[0]?.name ?? "Empty run",
        }));
    },

    async loadRun(id) {
      return runs.get(id) ?? null;
    },

    async saveRun(run) {
      // Advance `rev` exactly as the real runtime does. A stub that returns
      // the run unchanged would let the UI pass a stale revision back, so the
      // real implementation refuses the second save of every run while the
      // stub reports success -- the stub would hide the very bug the counter
      // exists to catch.
      // `rev` is optional, and a missing one means revision 0 -- the oldest
      // possible -- so a hand-built run is refused rather than trusted.
      const stored = { ...run, rev: (run.rev ?? 0) + 1 };
      runs.set(stored.id, stored);
      return stored;
    },

    async ingestDocument(runId, file, onProgress) {
      const existing = runs.get(runId) ?? {
        id: runId,
        createdAt: Date.now(),
        sources: [],
        pages: [],
        slots: emptySlots(),
      };

      const sourceId = `src-${existing.sources.length}-${file.name}`;
      const total = 3;
      const added: StoredPage[] = [];
      for (let i = 0; i < total; i++) {
        await wait(400);
        // `i`, not a run-global counter: pages are numbered within their own
        // source document.
        added.push(makePage(sourceId, i));
        onProgress?.(i + 1, total);
      }

      const withPages: BrowserRun = {
        ...existing,
        sources: [
          ...existing.sources,
          { id: sourceId, name: file.name, pageCount: total },
        ],
        pages: [...existing.pages, ...added],
      };
      const updated: BrowserRun = {
        ...withPages,
        slots: searchStub(withPages, added),
      };
      runs.set(runId, updated);
      return updated;
    },

    async pageBitmap(runId, pageId) {
      const run = runs.get(runId);
      const page = run?.pages.find((p) => p.id === pageId);
      if (!page) throw new Error(`no page ${pageId} in run ${runId}`);
      return await drawPage(page);
    },
  };
}
