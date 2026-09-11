"use client";

/**
 * KONFIG EXCEL: the operator's own EPIC konfigurasi, read against the scans.
 *
 * One sentence: *"here is the order-configuration workbook I already have, tell
 * me where it disagrees with the documents, let me settle each one, and give me
 * the workbook back."* Nothing on this screen authors a workbook; it amends the
 * one the operator handed over, cell by cell, and only where a person said so.
 *
 * ## THE FOUR STATES, AND WHY THE SECOND ONE EXISTS AT ALL
 *
 *  1. **No workbook.** A drop target and the consent sentence.
 *  2. **Read, not compared.** The berkas is open ON THIS DEVICE and nothing has
 *     left it. This is a state and not a formality: `openWorkbook` runs jszip in
 *     this tab, so the split between "your file is open here" and "its text goes
 *     to the server" is exactly where `Cocokkan dengan dokumen` sits. An
 *     operator who reads the consent sentence and changes their mind has a
 *     screen to change it on.
 *  3. **Compared.** The register: one row per isian, owed rows first.
 *  4. **Download.** The same workbook, patched, under their own name.
 *
 * States 3 and 4 are one screen: the download stands at the foot of the
 * register because the count it prints ("N sel akan diubah") is the register's
 * own arithmetic and reading them apart is how the two come to disagree.
 *
 * ## WHAT THIS SCREEN OWNS, AND WHAT IT HANDS UPWARD
 *
 * Every write goes through `runtime.editConfig`, which takes an EDIT and not a
 * run, applies it to what is STORED, and returns the stored run with its
 * revision advanced. THE CALLER MUST KEEP WHAT IT RETURNS -- `onRun(await
 * runtime.editConfig(...))`, never `saveRun({ ...run, konfigurasi })`, which is
 * refused as stale on the ordinary path: an ingest advances the revision once
 * per page across minutes while this screen holds a run in React state, and
 * this is a screen of amber rows the operator works down while the tool is
 * still busy.
 *
 * A REFUSED WRITE IS REPORTED UPWARD, everything else is prose here. The
 * vocabulary for a storage refusal (`StaleRunWriteError`, `CaptureLossError`,
 * `QuotaExceededError`) lives in `operator-app.tsx`'s `saveFault`, and a second
 * copy here would disagree with the first, so `onSaveFailed` hands the raw
 * problem over and the shell says the sentence in the sticky band where it
 * cannot be scrolled past. A refused berkas, a workbook that will not open, a
 * failed comparison and a download whose bytes are gone are all about THIS
 * screen's own object, so they are `Interruption` prose here. Never both: one
 * failure stated twice on one screen reads as two failures.
 *
 * ## THE PROPS, AND WHY EACH ONE IS HERE
 *
 *  - `run` / `onRun` -- the order, and the keeper of what a write returns.
 *  - `runtime` -- passed in rather than imported, so a test can drive this
 *    screen without IndexedDB. Narrowed to the three calls it actually makes,
 *    which is also what the type says out loud.
 *  - `onSaveFailed` -- see above.
 *  - `busy` -- true while a berkas is being ingested. It holds ONLY the two
 *    controls that send `run.pages` to the server (`Cocokkan dengan dokumen`
 *    and `Cari sekali lagi`), because a comparison run mid-ingest is a
 *    comparison against half a bundle that reports `tidak ditemukan` -- fixed
 *    in `docs/ui-bahasa.md` to mean SEARCHED AND NOT FOUND -- for isian sitting
 *    on pages nothing has read yet. Decisions and the download are NOT held: an
 *    edit carries no revision, so a decision taken during an ingest is a queued
 *    write rather than a refused one, which is the whole reason `ConfigEdit`
 *    exists.
 *
 * ## TWO PLACES THIS SCREEN DELIBERATELY DOES NOT DO AS IT IS TOLD
 *
 *  - **The blocking sentence is composed here, not by `downloadBlocked`.** That
 *    helper counts every entry whose decision is `belum`, and a fresh
 *    comparison gives EVERY entry that decision, `cocok` included -- so its
 *    count is the size of the register rather than the size of the debt, and
 *    its predicate can never clear, because a `cocok` row owes no decision and
 *    is offered none. The gate is `configSummary(check).owed`, which is the one
 *    number the amber mark counts. See `DOWNLOAD_BLOCKED` below.
 *  - **State 2 counts SEL, not isian.** Nothing knows how many isian a sheet
 *    holds until the model has read it; 159 non-empty cells is not 159 isian,
 *    and printing it as one would be a figure this screen cannot back up. The
 *    isian count appears the moment there is one, in the line above the
 *    register.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { describeDifference } from "@/lib/config/difference";
import type { DifferenceKind, Span } from "@/lib/config/difference";
import { configSummary, effectiveValue } from "@/lib/config/effective";
import type {
  ConfigCheck,
  ConfigCitation,
  ConfigEntry,
  ConfigField,
  FencedBerkas,
} from "@/lib/config/types";
import {
  buildInterpretRequest,
  buildRecompareRequest,
  buildResearchRequest,
  digestOf,
  fenceReport,
  fencedBerkas,
  openWorkbook,
  requestConfigCheck,
  workbookRecord,
} from "@/lib/ui/checkpoint";
import type { ConfigResponse, FenceReport } from "@/lib/ui/checkpoint";
import { citeLines } from "@/lib/ui/evidence";
import { searchablePageCount } from "@/lib/ui/propose";
import { configEntryId } from "@/lib/ui/runtime";
import type { BrowserRun, ConfigEdit, Runtime } from "@/lib/ui/runtime";
import type { SlotAggregateStatus } from "@/lib/ui/slots";
import { XLSX_TYPE, saveUpdatedWorkbook } from "@/lib/ui/workbook";
import type { Sheet } from "@/lib/xlsx/grid";
import { listingTruncated } from "@/lib/xlsx/listing";

import {
  Advisory,
  Btn,
  Cite,
  CiteAdvisories,
  Hint,
  Interruption,
  Lede,
  Mark,
  Note,
  Notice,
  StateWord,
  TechnicalDetail,
  shortenFileName,
} from "./chrome";
import { BukuKerja, Muat } from "./icons";

/* ------------------------------------------------------------------ *
 * Sentences that are written once.
 * ------------------------------------------------------------------ */

/**
 * The consent statement, and it may never become a hover.
 *
 * It is about data leaving the device, which `docs/design-system.md` puts on
 * the short list of things that stay as prose even though they read the same on
 * every order. It says the doing half first, as the tanpa AI sentence does: the
 * berkas is opened here, and what crosses the wire is the text of its cells.
 */
const CONSENT =
  "Berkas konfigurasi tidak diunggah. Isinya dibaca di peramban ini, dan hanya teks tiap sel yang dikirim ke server aplikasi.";

/**
 * Why every control that reads the order's halaman is held during an ingest.
 *
 * One sentence, declared once, riding on each control rather than standing in a
 * notice above them. The same wording `outstanding-panel.tsx` uses, and for the
 * same reason: MUAT is the pages coming in, and a hold that named the AI's
 * reading would name the wrong move.
 */
const LOADING_HOLD = "Tunggu pemuatan dokumen selesai.";

/**
 * The export-blocked sentence for this checkpoint: count, noun, remedy.
 *
 * ITS REMEDY HALF IS `downloadBlocked`'s, WORD FOR WORD, so an operator meets
 * one sentence for one condition. What is not taken from it is the COUNT: see
 * the header. When that helper counts the debt rather than the register, this
 * should call it and this constant should go.
 */
function downloadBlockedSentence(owed: number): string {
  return (
    `${owed} isian masih menunggu keputusan Anda. Tidak ada berkas ` +
    "konfigurasi yang disimpan sebelum setiap isian diputuskan, karena " +
    "nilai yang belum diperiksa di dalam berkas yang dipakai untuk input " +
    "EPIC adalah persis kegagalan yang dicegah langkah ini."
  );
}

/** The one re-search, stated as the budget the client named. */
const RESEARCH_OFFER =
  "Isian yang tidak ditemukan bisa dicari sekali lagi di seluruh halaman order ini. Pencarian ulang hanya sekali untuk tiap order.";

const RESEARCH_SPENT =
  "Pencarian ulang hanya sekali untuk tiap order, dan sudah dipakai untuk order ini.";

/**
 * The budget is unspent and there is nothing left to spend it ON.
 *
 * Every isian that was not found has already been decided, and a decision hides
 * whatever the search would find for it (see `research`). Said in full rather
 * than by taking the key away in silence, and it names the way back, because
 * the operator can put a row in scope again with a gesture they already know.
 */
const RESEARCH_SETTLED =
  "Setiap isian yang tidak ditemukan sudah Anda putuskan, jadi tidak ada lagi yang perlu dicari. Pencarian ulang belum dipakai untuk order ini: buka lagi salah satu keputusan itu kalau Anda mau memakainya.";

/**
 * A comparison that came back with nothing, and a comparison this device could
 * not finish.
 *
 * Both are refusals, so both are prose, and NEITHER CARRIES THE CAUSE IN ITS
 * SENTENCE. What arrives in the exception is `/api/config`'s own English
 * paragraph about the API key, the quota and `pnpm smoke`, or a bare
 * `TypeError: Failed to fetch`; it belongs behind `Detail teknis`, which is
 * where every other screen in this product files a deployer's words.
 */
const COMPARE_FAILED =
  "Pencocokan gagal, jadi belum ada isian yang bisa Anda putuskan dan tidak ada yang berubah di order ini. Coba lagi sebentar lagi.";

/** The register is intact when a comparison AGAIN fails, so it says that. */
const RECOMPARE_FAILED =
  "Pencocokan ulang gagal, jadi isian di bawah tetap seperti sebelumnya dan keputusan Anda tidak berubah. Coba lagi sebentar lagi.";

/**
 * IT SAYS THE BUDGET WENT, because it did. `markResearched` is written BEFORE
 * the search on purpose (a search that ran and failed to record itself is one
 * the operator can buy again), so a failure here costs the order its one
 * re-search and the sentence that hid that would be the quiet half of a bad
 * trade.
 */
const RESEARCH_FAILED =
  "Pencarian ulang gagal, jadi tidak ada isian yang berubah. Pencarian ulang hanya sekali untuk tiap order dan sudah terpakai untuk order ini, jadi isian yang tidak ditemukan perlu Anda periksa sendiri di dokumen.";

/* ------------------------------------------------------------------ *
 * Small shared pieces.
 * ------------------------------------------------------------------ */

function messageOf(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}

/** A fault this screen owns: an operator sentence, and the raw cause behind it. */
type PanelFault = { sentence: string; detail?: string };

/**
 * The reading's own diagnoses, ENGLISH, for `Detail teknis` and nowhere else.
 *
 * The model's note about the sheet and the rows the grid refused are written
 * for whoever maintains this, and one derivation serves both the refusal band
 * and the register's foot so the two cannot come to different answers.
 */
function readingDetail(answer: ConfigResponse | null): string | undefined {
  if (!answer) return undefined;
  const lines: string[] = [];
  if (answer.note) lines.push(answer.note);
  for (const row of answer.unusable ?? []) {
    lines.push(
      `unusable  ${row.label}  ${row.labelRef ?? "?"}/${row.valueRef ?? "?"}  ${row.reason}`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/**
 * TWO DECISIONS CAN BE IN THE AIR AT ONCE, so what is in flight is a SET.
 *
 * The operator works down twenty amber rows and does not wait for a write to
 * land. Held as one id, the second press cleared the first row's `saving` and
 * its paraf went solid over a write that had not reached disk -- which is the
 * one thing `Paraf`'s `saved` exists to say. Found by review.
 *
 * Identity when the answer does not change, so a press that adds nothing costs
 * no render.
 */
function withId(held: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (held.has(id)) return held;
  return new Set(held).add(id);
}

function withoutId(held: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!held.has(id)) return held;
  const next = new Set(held);
  next.delete(id);
  return next;
}

/**
 * WHICH ORDERS HAVE A COMPARISON IN THE AIR, KEPT OUTSIDE REACT.
 *
 * One comparison is one paid model call over the whole order and it runs for a
 * while. The shell renders the phases in a ternary, so an operator who walks to
 * another phase mid-comparison UNMOUNTS this screen and every piece of its state
 * goes with it: coming back, the key stood armed with no sign that anything was
 * running, and pressing it bought the same answer a second time. Found by
 * review.
 *
 * A set of run ids plus a subscription is the smallest thing that survives an
 * unmount. IT IS DELIBERATELY NOT ON THE RUN: a call in flight is a fact about
 * this tab, not about the order, and an order written as "comparing" would stay
 * that way for ever if the tab were closed mid-call.
 */
const comparingRuns = new Set<string>();
const comparingWatchers = new Set<() => void>();

function markComparing(runId: string, running: boolean): void {
  if (running) comparingRuns.add(runId);
  else comparingRuns.delete(runId);
  // A copy, because a watcher that unsubscribes while being notified would
  // otherwise mutate the set this loop is walking.
  for (const notify of [...comparingWatchers]) notify();
}

function subscribeComparing(notify: () => void): () => void {
  comparingWatchers.add(notify);
  return () => {
    comparingWatchers.delete(notify);
  };
}

/**
 * A berkas this app can actually open.
 *
 * Both tests, not the extension alone, for the reason `isPdf` gives one screen
 * over: a file handed over through a chat client commonly arrives with the
 * right MIME type and a mangled name, and refusing that would be refusing the
 * operator's real workbook.
 */
function isWorkbookFile(file: File): boolean {
  return file.type === XLSX_TYPE || file.name.toLowerCase().endsWith(".xlsx");
}

/**
 * The state word for one isian, and the shape beside it.
 *
 * Five verdicts and four decisions collapse into six words, and the split that
 * matters is the one `docs/ui-bahasa.md` fixes: amber means A DECISION IS OWED
 * HERE and nothing else, so a settled row carries no colour whatever it was
 * before, and `tidak ditemukan` keeps `--gap` because it is a search that came
 * back empty rather than a decision anybody can take.
 *
 * `belum sesuai` and `belum diisi` are one verdict wearing two words: the
 * operator's move is the same in each, and `excelValue === ""` is what
 * separates them. Telling them apart matters because "there is nothing to
 * overwrite" and "you are about to replace what is there" are different acts.
 */
function stateOf(entry: ConfigEntry): {
  word: string;
  status: SlotAggregateStatus;
} {
  if (entry.decision === "setuju") return { word: "diterima", status: "confirmed" };
  if (entry.decision === "tolak") return { word: "ditolak", status: "confirmed" };
  if (entry.decision === "manual") {
    return { word: "diketik sendiri", status: "confirmed" };
  }

  switch (entry.verdict) {
    case "cocok":
      return { word: "cocok", status: "confirmed" };
    case "beda":
      return entry.field.excelValue === ""
        ? { word: "belum diisi", status: "proposed" }
        : { word: "belum sesuai", status: "proposed" };
    case "tidak-ditemukan":
      return { word: "tidak ditemukan", status: "outstanding" };
    default:
      return { word: "belum diperiksa", status: "pending" };
  }
}

/**
 * WHAT KIND OF DIFFERENCE THIS IS, in the operator's words.
 *
 * Beside `stateOf` because this is the same job: a token the domain uses
 * (`DifferenceKind` in `src/lib/config/difference.ts`, which is pure and says
 * nothing in Bahasa) turned into the word this screen says. Every other word
 * this panel speaks is decided in this file and this one is not an exception.
 *
 * `nilai` MAPS TO NOTHING ON PURPOSE. It is the default and it is what the
 * module answers whenever it cannot prove two spellings are one value, so a
 * word for it would appear on most rows and mean "no finding" -- and a label
 * on every row is a label on no row. The band in the values has already said
 * where they diverge.
 *
 * NONE OF THESE CLAIMS THE DIFFERENCE IS THE ONLY ONE. The ladder in
 * `difference.ts` is cumulative, so a pair differing in both case and
 * punctuation reports `tanda-baca`; the words therefore NAME a difference
 * rather than saying "hanya", and the band beside them shows the rest. And
 * none of them says "salah": `docs/ui-bahasa.md` fixes that, because the
 * konfigurasi may well be right and the scan misread.
 */
const KIND_WORD: Partial<Record<DifferenceKind, string>> = {
  spasi: "spasi",
  huruf: "huruf besar-kecil",
  "tanda-baca": "tanda baca",
  angka: "penulisan angka, nilainya sama",
};

/**
 * One value with its differing run banded.
 *
 * A MARK THAT COVERS EVERYTHING MARKS NOTHING, which is why the whole-value
 * case falls back to plain text. Two values with nothing in common -- the
 * `Monthly Postpaid` against `Berlangganan` shape -- would otherwise draw a
 * band under every character on the row and point at nothing at all.
 *
 * A ZERO-WIDTH RUN IS THE MOST USEFUL ANSWER THIS DRAWS and it has no
 * characters to band, so it becomes a caret (`data-point`). That is the
 * missing-space case: nothing on this side is wrong, and something stands at
 * this spot on the other.
 *
 * The caret is silent to a screen reader, which is what the `bedanya` row of
 * the register is for: the finding is in text as well as in the band.
 */
function Marked({ text, span }: { text: string; span?: Span }) {
  if (!span || (span.from === 0 && span.to === text.length)) return <>{text}</>;
  const run = text.slice(span.from, span.to);
  return (
    <>
      {text.slice(0, span.from)}
      {run === "" ? (
        <span className="lt-beda" data-point="true" />
      ) : (
        <span className="lt-beda">{run}</span>
      )}
      {text.slice(span.to)}
    </>
  );
}

/** Does this row still carry the three keys? */
function isOpen(entry: ConfigEntry): boolean {
  return (
    entry.decision === "belum" &&
    (entry.verdict === "beda" || entry.verdict === "tidak-ditemukan")
  );
}

/**
 * The order the register is drawn in, computed ONCE per set of isian.
 *
 * Owed rows first, everything else in the workbook's own order. It is frozen
 * against the DECISIONS on purpose: a row that jumps out of the list the
 * instant it is settled takes the operator's eye with it, and they are working
 * down twenty rows. Only the arrival of a different set of isian -- a fresh
 * comparison, a replacement workbook -- re-sorts.
 */
function rankOf(entries: readonly ConfigEntry[]): Map<string, number> {
  const owed = (entry: ConfigEntry) =>
    entry.verdict === "beda" && entry.decision === "belum" ? 0 : 1;
  const sorted = entries
    .map((entry, at) => ({ entry, at }))
    .sort((a, b) => owed(a.entry) - owed(b.entry) || a.at - b.at);
  return new Map(sorted.map((row, at) => [configEntryId(row.entry), at]));
}

/* ------------------------------------------------------------------ *
 * The props.
 * ------------------------------------------------------------------ */

export type ConfigPanelProps = {
  run: BrowserRun;
  /** Every write returns the STORED run. Keep it, or the next write is stale. */
  onRun: (run: BrowserRun) => void;
  /**
   * Narrowed to what this screen touches, so the type says what it does. The
   * whole runtime satisfies it structurally, which is how the shell passes it.
   */
  runtime: Pick<
    Runtime,
    "editConfig" | "putCheckpointFile" | "getCheckpointFile"
  >;
  /**
   * A write storage refused, handed over RAW.
   *
   * `operator-app.tsx`'s `saveFault` reads `error.name` and owns the sentence
   * for each named guard; passing the problem rather than a sentence is what
   * keeps that vocabulary in one place.
   */
  onSaveFailed: (problem: unknown) => void;
  /** True while a berkas is being read into this order. See the header. */
  busy?: boolean;
};

/**
 * A different order is a different question, and every piece of state in here
 * is about one: which workbook is staged, what the last reading said, which row
 * is being typed into. Keying on the run id says so in React's own terms and
 * resets all of it at once.
 */
export function ConfigPanel(props: ConfigPanelProps) {
  return <Panel key={props.run.id} {...props} />;
}

/* ------------------------------------------------------------------ *
 * The screen.
 * ------------------------------------------------------------------ */

/** The workbook open on this device, whether just dropped or read back. */
type Staged = {
  /** Its key in the blob store. Reused when this order already holds it. */
  id: string;
  file: File;
  digest: string;
  sheet: Sheet;
  sheetNames: string[];
};

function Panel({
  run,
  onRun,
  runtime,
  onSaveFailed,
  busy = false,
}: ConfigPanelProps) {
  const headId = useId();
  const check = run.konfigurasi;
  const summary = configSummary(check);
  const compared = check.entries.length > 0;

  /**
   * True while THIS ORDER has a comparison in the air, whichever mount of this
   * screen started it. See `comparingRuns`: leaving Konfig Excel mid-comparison
   * used to re-arm the key with no sign a paid call was still running.
   */
  const comparing = useSyncExternalStore(
    subscribeComparing,
    () => comparingRuns.has(run.id),
    () => false,
  );
  const [staged, setStaged] = useState<Staged | null>(null);
  const [fault, setFault] = useState<PanelFault | null>(null);
  const [reading, setReading] = useState(false);
  const [researching, setResearching] = useState(false);
  /**
   * The last reading's ENGLISH diagnoses: its note about the sheet, and why
   * each refused row was refused.
   *
   * Session-only, and that is now a decision rather than a gap. The half an
   * OPERATOR needs -- WHICH isian were refused -- is stored on the workbook
   * record and rendered from the run, because a reload that dropped it left a
   * screen reading as full coverage of a workbook part of which was never
   * compared. The reasons are for a deployer, they are the long half, and the
   * run's small store is read for every order on the device, so they stop here.
   */
  const [answer, setAnswer] = useState<ConfigResponse | null>(null);
  /** The bytes this order's workbook was stored under are gone. */
  const [bytesGone, setBytesGone] = useState(false);
  /** Which isian are being written, and which ones just were. See `withId`. */
  const [working, setWorking] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [fresh, setFresh] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  /** Which isian has `Ketik sendiri` open. */
  const [typing, setTyping] = useState<string | null>(null);
  /** Is the replacement drop open? */
  const [replacing, setReplacing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ name: string; changed: number } | null>(
    null,
  );

  /**
   * THE ORDER OF THE REGISTER, adjusted during render rather than in an effect.
   *
   * React's own documented shape for "change some state when an input changes".
   * An effect would paint the register once in workbook order and again in owed
   * order, so the one thing that moves in this product would be a list of
   * twenty rows re-sorting itself under the pointer.
   */
  const signature = check.entries.map(configEntryId).join("\n");
  const [order, setOrder] = useState(() => ({
    signature,
    rank: rankOf(check.entries),
  }));
  if (order.signature !== signature) {
    setOrder({ signature, rank: rankOf(check.entries) });
  }

  /**
   * THE WORKBOOK READ BACK FROM STORAGE, so a reload does not lose the two
   * things only the sheet itself can say.
   *
   * The first is truncation. `listingTruncated` is a fact about the SHEET, and
   * nothing on `ConfigWorkbook` records it, so without this an operator who
   * reloads meets a register that reads as full coverage of a workbook only
   * part of which was ever looked at. That is the failure this whole product
   * exists to prevent, and it costs one jszip parse of a small file to close.
   *
   * The second is the bytes. `buildUpdatedWorkbook` needs them and refuses
   * honestly when they are gone, but it refuses at the moment the operator
   * presses the key -- and "the berkas is no longer on this device" is
   * something they can act on long before then.
   */
  const recovered = useRef<string | null>(null);
  /**
   * THE ID AND THE DIGEST, NEVER THE OBJECT. Every write round-trips the run
   * through structured clone, so `check.workbook` is a NEW object after each
   * one -- a decision, or a page landing mid-ingest -- and an effect keyed on it
   * re-ran and cancelled this read for reasons that had nothing to do with the
   * workbook. Keyed on the two values it actually reads, it runs once per
   * workbook.
   */
  const workbookId = check.workbook?.id;
  const workbookDigest = check.workbook?.digest;
  useEffect(() => {
    if (!workbookId || !workbookDigest) return;
    if (recovered.current === workbookId) return;
    recovered.current = workbookId;

    let alive = true;
    let settled = false;
    void (async () => {
      try {
        const stored = await runtime.getCheckpointFile(workbookId);
        if (!alive) return;
        if (!stored) {
          settled = true;
          setBytesGone(true);
          return;
        }
        const file = new File([stored.bytes], stored.name, { type: XLSX_TYPE });
        const { sheet, sheetNames } = await openWorkbook(file);
        if (!alive) return;
        settled = true;
        setBytesGone(false);
        setStaged({
          id: workbookId,
          file,
          digest: workbookDigest,
          sheet,
          sheetNames,
        });
      } catch (problem) {
        if (!alive) return;
        settled = true;
        // NOT a fault band. The register is intact and every decision on it
        // still works; what is lost is the sheet's own facts, so the screen
        // says which ones and stops there.
        setBytesGone(true);
        setFault({
          sentence:
            "Berkas konfigurasi order ini tidak bisa dibuka lagi di perangkat ini, jadi berkas terbarunya belum bisa disimpan. Muat berkasnya sekali lagi.",
          detail: messageOf(problem),
        });
      }
    })();
    return () => {
      alive = false;
      // A CANCELLED ATTEMPT IS NOT A FINISHED ONE. The id was marked read
      // BEFORE the first await, so one cancellation -- a re-render with a new
      // workbook object, React's own double-invoke in development -- recorded
      // the read as done and no later run of this effect would try again. The
      // truncation sentence, which is the one thing on this screen that must
      // not be quiet, then never came back for the rest of the session. Found
      // by review, so the claim is released unless the attempt actually landed.
      if (!settled && recovered.current === workbookId) recovered.current = null;
    };
  }, [workbookId, workbookDigest, runtime]);

  /* ---------------------------------------------------------------- *
   * The hand-over.
   * ---------------------------------------------------------------- */

  const takeWorkbook = (file: File) => {
    setReading(true);
    setFault(null);
    setSaved(null);
    void (async () => {
      try {
        const bytes = await file.arrayBuffer();
        const digest = await digestOf(bytes);
        const { sheet, sheetNames } = await openWorkbook(file);

        // THE SAME BYTES KEEP THE SAME KEY. A workbook re-handed over is the
        // same workbook -- identity is the content, exactly as it is for a
        // berkas -- so reusing the id means the order does not end up holding
        // two copies of one file, and `attachWorkbook` can see that nothing
        // changed.
        const held = check.workbook;
        const id =
          held && held.digest === digest ? held.id : crypto.randomUUID();
        await runtime.putCheckpointFile(run.id, id, file.name, bytes);

        recovered.current = id;
        setBytesGone(false);
        setStaged({ id, file, digest, sheet, sheetNames });
        setReplacing(false);
      } catch (problem) {
        const known =
          problem instanceof Error && problem.name === "WorkbookUnreadable";
        setFault({
          sentence: known
            ? "Berkas ini tidak bisa dibaca sebagai .xlsx, jadi tidak ada yang dimuat. Buka berkasnya di Excel, simpan ulang sebagai .xlsx, lalu muat lagi."
            : // THE CAUSE IS NOT THE SENTENCE. This used to end in
              // `: ${messageOf(problem)}`, and what lands here is English
              // written for whoever maintains this -- `WorkbookUnreadable`'s
              // own text, a jszip failure, a storage quota -- pasted onto the
              // end of the operator's own paragraph. It goes behind
              // `Detail teknis` like every other deployer sentence in this
              // product, and the prose covers the two causes an operator can
              // actually do something about. Found by review.
              "Berkas konfigurasi ini tidak bisa dipakai, jadi tidak ada yang dimuat. Pastikan berkasnya berisi lembar konfigurasi order ini dan tersimpan sebagai .xlsx biasa, lalu muat lagi.",
          detail: messageOf(problem),
        });
      } finally {
        setReading(false);
      }
    })();
  };

  /* ---------------------------------------------------------------- *
   * The comparison.
   * ---------------------------------------------------------------- */

  const searchablePages = searchablePageCount(run);

  const compare = () => {
    if (!staged || comparing) return;
    // Recorded beside the request it describes, off the same run, so the two
    // cannot disagree about which berkas this reading was given.
    const fenced = fencedBerkas(run);
    markComparing(run.id, true);
    setFault(null);
    void (async () => {
      let response: ConfigResponse;
      try {
        response = await requestConfigCheck(
          buildInterpretRequest(run, staged.sheet),
        );
      } catch (problem) {
        setFault({ sentence: COMPARE_FAILED, detail: messageOf(problem) });
        markComparing(run.id, false);
        return;
      }

      setAnswer(response);

      // NOTHING FOR THE REGISTER IS A REFUSAL, NOT A QUIET SUCCESS. `compared`
      // is `entries.length > 0`, so folding an empty reading in repaints this
      // screen exactly as it was: the operator pressed the key, paid for a
      // model call over the whole order, and met the screen they were already
      // looking at. On a replacement it is worse -- `attach-workbook` would
      // drop the register this order holds and leave an isian-less workbook in
      // its place. Found by review, and it is a reachable answer rather than a
      // hypothetical: `config-compare.ts` returns `[]` for a sheet nothing
      // could be interpreted out of, and the route says so in its note.
      if (response.entries.length === 0) {
        setFault({
          sentence:
            `Tidak ada isian yang bisa dibaca dari lembar ${staged.sheet.name} di ` +
            `${shortenFileName(staged.file.name, 34)}, jadi tidak ada yang dicocokkan ` +
            "dan tidak ada yang berubah di order ini. Periksa apakah berkas ini " +
            "berisi konfigurasi order ini, lalu muat lagi.",
          detail: readingDetail(response),
        });
        markComparing(run.id, false);
        return;
      }

      /**
       * WHICH EDIT, AND IT IS NOT ONE CHOICE OUT OF TWO STYLES.
       *
       * `attachWorkbook` returns the run UNCHANGED when the incoming workbook
       * has the same digest and sheet as the one already held -- so a second
       * reading of the same berkas folded in that way would be paid for and
       * then dropped on the floor. `record-comparison` is the gesture that
       * exists for exactly this, and it keeps every ruling the operator has
       * already made.
       */
      const held = check.workbook;
      const same =
        held !== undefined &&
        held.digest === staged.digest &&
        held.sheet === staged.sheet.name;
      /*
       * WHAT THE READING REFUSED, STORED WITH THE WORKBOOK IT REFUSED IT FROM.
       *
       * A refused row never becomes a `ConfigEntry`, so the register cannot
       * show it and, kept in component state, it vanished on reload -- leaving
       * a screen that read as full coverage of a workbook part of which was
       * never compared. It rides on the workbook record because that record
       * names one digest and one sheet: `attach-workbook` mints a fresh one per
       * workbook, and the same-workbook fold below keeps the stored one, which
       * is exactly the rule this list needs. Names only; the English reasons
       * stay behind `Detail teknis`. Found by review.
       */
      const refused = (response.unusable ?? []).map((row) => row.label);
      const edit: ConfigEdit = same
        ? { tag: "record-comparison", entries: response.entries, fenced }
        : {
            tag: "attach-workbook",
            fenced,
            workbook: {
              ...workbookRecord(
                staged.id,
                staged.file,
                staged.sheet,
                staged.sheetNames,
                staged.digest,
              ),
              unusable: refused,
            },
            entries: response.entries,
          };

      try {
        onRun(await runtime.editConfig(run.id, edit));
      } catch (problem) {
        onSaveFailed(problem);
      } finally {
        markComparing(run.id, false);
      }
    })();
  };

  /* ---------------------------------------------------------------- *
   * The one re-search.
   * ---------------------------------------------------------------- */

  /**
   * WHAT THE ONE RE-SEARCH MAY BE SPENT ON, and the reason it is not simply
   * every `tidak-ditemukan` row.
   *
   * A settled row takes the answer and hides it. `recordComparison` folds the
   * model's half over the stored entry and KEEPS the person's half, so a row
   * the operator already ruled on comes back carrying the new verdict under the
   * old decision -- and a decided row collapses, printing the value that will be
   * written and nothing else. The isian the search found would be on the run and
   * on no screen, bought with a budget the client capped at one. So the budget
   * is offered for rows that still owe a decision, and `Buka lagi` on a settled
   * row puts it back in scope. Found by review.
   */
  const researchable = check.entries.filter(
    (entry) => entry.verdict === "tidak-ditemukan" && entry.decision === "belum",
  );

  /* ---------------------------------------------------------------- *
   * Comparing again, once a skipped berkas is let back in.
   * ---------------------------------------------------------------- */

  /**
   * THE SAME QUESTION OVER THE SAME ISIAN, against the bundle the order now
   * offers.
   *
   * Not the re-search, and it spends nothing of that budget: see
   * `buildRecompareRequest`. The answer covers every isian, so it is folded in
   * whole, and `recordComparison` keeps every ruling on an id it still holds.
   * `answer` is left alone because a comparison over fields brings no note about
   * the sheet, and replacing it would drop the diagnoses the first reading left.
   */
  const recompare = () => {
    if (comparing || check.entries.length === 0) return;
    const fields = check.entries.map((entry) => entry.field);
    const fenced = fencedBerkas(run);
    markComparing(run.id, true);
    setFault(null);
    void (async () => {
      let response: ConfigResponse;
      try {
        response = await requestConfigCheck(buildRecompareRequest(run, fields));
      } catch (problem) {
        setFault({ sentence: RECOMPARE_FAILED, detail: messageOf(problem) });
        markComparing(run.id, false);
        return;
      }
      try {
        onRun(
          await runtime.editConfig(run.id, {
            tag: "record-comparison",
            entries: response.entries,
            fenced,
          }),
        );
      } catch (problem) {
        onSaveFailed(problem);
      } finally {
        markComparing(run.id, false);
      }
    })();
  };

  const research = () => {
    const fields: ConfigField[] = researchable.map((entry) => entry.field);
    if (fields.length === 0 || researching) return;
    const fenced = fencedBerkas(run);

    setResearching(true);
    setFault(null);
    void (async () => {
      try {
        // THE BUDGET IS MARKED BEFORE THE SEARCH, which is what
        // `markResearched` asks of whoever calls it: the budget is about
        // tokens, and a search that ran and then failed to record itself is a
        // search the operator can buy again.
        onRun(await runtime.editConfig(run.id, { tag: "mark-researched" }));
      } catch (problem) {
        onSaveFailed(problem);
        setResearching(false);
        return;
      }

      let response: ConfigResponse;
      try {
        response = await requestConfigCheck(buildResearchRequest(run, fields));
      } catch (problem) {
        setFault({ sentence: RESEARCH_FAILED, detail: messageOf(problem) });
        setResearching(false);
        return;
      }

      /**
       * MERGED, NEVER HANDED OVER ON ITS OWN.
       *
       * The re-search asks about the `tidak-ditemukan` fields alone, so the
       * answer covers those alone -- and `recordComparison` REPLACES the entry
       * list with what it is given, dropping every field the new reading does
       * not mention. Handing the bare answer over would delete every isian the
       * operator had already settled, with the loss named in an opt-in nobody
       * reads.
       */
      const byId = new Map(
        response.entries.map((entry) => [configEntryId(entry), entry]),
      );
      const seen = new Set<string>();
      const merged: ConfigEntry[] = check.entries.map((entry) => {
        const id = configEntryId(entry);
        seen.add(id);
        return byId.get(id) ?? entry;
      });
      for (const entry of response.entries) {
        // An answer about a field this order does not hold cannot be dropped in
        // silence: it was paid for, and a verdict nobody can see is a verdict
        // nobody can act on.
        if (!seen.has(configEntryId(entry))) merged.push(entry);
      }

      try {
        onRun(
          await runtime.editConfig(run.id, {
            tag: "record-comparison",
            entries: merged,
            fenced,
          }),
        );
      } catch (problem) {
        onSaveFailed(problem);
      } finally {
        setResearching(false);
      }
    })();
  };

  /* ---------------------------------------------------------------- *
   * One decision.
   * ---------------------------------------------------------------- */

  const decide = (
    entryId: string,
    decision: ConfigEntry["decision"],
    manualValue?: string,
  ) => {
    // ONE ROW AT A TIME IS NOT HOW THIS SCREEN IS USED. Both of these were a
    // single id, so a second press cleared the first row's `saving` and its
    // paraf went solid while that write was still in the air. See `withId`.
    setWorking((held) => withId(held, entryId));
    setFresh((held) => withId(held, entryId));
    void (async () => {
      try {
        const edit: ConfigEdit =
          decision === "manual"
            ? { tag: "decide", entryId, decision, manualValue: manualValue ?? "" }
            : { tag: "decide", entryId, decision };
        onRun(await runtime.editConfig(run.id, edit));
        // ONLY THIS ROW'S FIELD. A bare `setTyping(null)` closed whichever
        // field was open, so a decision landing on one row could take away a
        // value the operator was still typing into another.
        setTyping((open) => (open === entryId ? null : open));
      } catch (problem) {
        // The typed value stays on screen with the field still open: a save
        // that did not land must not also throw away what they wrote.
        setFresh((held) => withoutId(held, entryId));
        onSaveFailed(problem);
      } finally {
        setWorking((held) => withoutId(held, entryId));
      }
    })();
  };

  /* ---------------------------------------------------------------- *
   * The download.
   * ---------------------------------------------------------------- */

  const download = () => {
    if (saving) return;
    setSaving(true);
    setFault(null);
    void (async () => {
      try {
        const built = await saveUpdatedWorkbook(check, runtime.getCheckpointFile);
        setSaved({ name: built.name, changed: built.changed });
      } catch (problem) {
        // TWO SOURCES OF FAILURE HERE, AND ONLY ONE OF THEM SPEAKS BAHASA.
        // `buildUpdatedWorkbook` refuses in Bahasa when the bytes are gone or
        // no workbook is held, and that sentence already names the berkas and
        // the remedy, so it is printed as it stands. `patchWorkbook` throws
        // `WorkbookPatchError`, whose thirty-odd messages are OOXML internals
        // written for whoever maintains that module -- and they are reachable
        // from a workbook this app read and compared happily, because reading
        // and patching demand different things of the archive: a `<row>` with
        // no `r` attribute reads fine and is refused a patch by name. Printed
        // as the operator's own sentence, as it was until review, the screen
        // answered "save my konfigurasi" with a sentence about worksheet parts.
        // Discriminated by `name`, the way `WorkbookUnreadable` already is one
        // screen up, so no new import is needed. The remedy holds for every one
        // of them: Excel rewrites the parts this patcher refuses.
        const internal =
          problem instanceof Error && problem.name === "WorkbookPatchError";
        setFault({
          sentence: internal
            ? "Berkas konfigurasi terbaru tidak bisa disusun dari berkas asli Anda, jadi tidak ada yang tersimpan. Buka berkasnya di Excel, simpan ulang sebagai .xlsx biasa, lalu muat dan cocokkan lagi."
            : messageOf(problem),
          detail: messageOf(problem),
        });
      } finally {
        setSaving(false);
      }
    })();
  };

  /* ---------------------------------------------------------------- *
   * Render.
   * ---------------------------------------------------------------- */

  const owes = fault
    ? "fault"
    : summary.owed > 0
      ? "decision"
      : compared
        ? "done"
        : undefined;

  return (
    <section aria-labelledby={headId} className="lt-slab">
      {/* THE KOP IS THIS BLOCK'S STATUS CHANNEL: a 12% tint of the block's own
          ground and a 4px rule down its leading edge, never a saturated fill.
          The figure at the right is the size of the debt, and it appears only
          once there is a register for it to be about -- a zero standing over an
          empty screen would report work finished that has not started. */}
      <div className="lt-kop" data-owes={owes}>
        <h2 id={headId}>Cocokkan konfigurasi dengan dokumen</h2>
        {compared ? (
          <span className="lt-figure lt-kop-right">{summary.owed}</span>
        ) : null}
      </div>

      <div className="lt-slab-body flex flex-col gap-4">
        {fault ? (
          <Interruption detail={fault.detail}>{fault.sentence}</Interruption>
        ) : null}

        {compared ? (
          <Compared
            run={run}
            check={check}
            summary={summary}
            answer={answer}
            staged={staged}
            rank={order.rank}
            busy={busy}
            bytesGone={bytesGone}
            searchablePages={searchablePages}
            researchable={researchable.length}
            researching={researching}
            working={working}
            fresh={fresh}
            typing={typing}
            saving={saving}
            saved={saved}
            replacing={replacing}
            reading={reading}
            comparing={comparing}
            onReplace={setReplacing}
            onFiles={takeWorkbook}
            onCompare={compare}
            onResearch={research}
            fence={fenceReport(run)}
            onRecompare={recompare}
            onDecide={decide}
            onType={setTyping}
            onDownload={download}
          />
        ) : (
          <Intake
            check={check}
            staged={staged}
            reading={reading}
            comparing={comparing}
            busy={busy}
            searchablePages={searchablePages}
            pages={run.pages.length}
            onFiles={takeWorkbook}
            onCompare={compare}
          />
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * States 1 and 2: no workbook, and a workbook nothing has compared yet.
 * ------------------------------------------------------------------ */

function Intake({
  check,
  staged,
  reading,
  comparing,
  busy,
  searchablePages,
  pages,
  onFiles,
  onCompare,
}: {
  check: ConfigCheck;
  staged: Staged | null;
  reading: boolean;
  comparing: boolean;
  busy: boolean;
  searchablePages: number;
  pages: number;
  onFiles: (file: File) => void;
  onCompare: () => void;
}) {
  if (!staged) {
    return (
      <>
        <Lede>
          Muat berkas konfigurasi EPIC untuk order ini. Setiap isian akan
          dicocokkan dengan dokumen yang sudah Anda periksa, dan Anda yang
          memutuskan tiap perubahannya.
        </Lede>
        <WorkbookDrop reading={reading} onFiles={onFiles} />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-baseline gap-2 text-sm">
          <span className="lt-kotak" title={staged.file.name}>
            {shortenFileName(staged.file.name, 34)}
          </span>
          {/* SEL, NOT ISIAN. Nothing knows how many isian this sheet holds
              until the model has read it, and a cell count printed as an isian
              count would be a figure this screen cannot back up. The isian
              count appears the moment there is one. */}
          <span>
            <span className="lt-figure">{staged.sheet.cells.length}</span> sel
            terbaca dari lembar
          </span>
          <span className="lt-kotak">{staged.sheet.name}</span>
        </p>

        {staged.sheetNames.length > 1 ? (
          <Note>
            Berkas ini punya{" "}
            <span className="lt-figure">{staged.sheetNames.length}</span> lembar,
            dan yang dibaca adalah {staged.sheet.name}. Kalau konfigurasi order
            ini ada di lembar lain, pindahkan isinya ke lembar pertama lalu muat
            lagi.
          </Note>
        ) : null}
      </div>

      <Truncation sheet={staged.sheet} />
      <ReplacementCost check={check} digest={staged.digest} />

      <CompareLine
        comparing={comparing}
        busy={busy}
        searchablePages={searchablePages}
        pages={pages}
        onCompare={onCompare}
      />
    </>
  );
}

/**
 * WHY THERE IS NOTHING TO COMPARE AGAINST, when there is nothing.
 *
 * A comparison over no readable halaman answers every isian
 * `tidak-ditemukan`, and that word is fixed in `docs/ui-bahasa.md` to mean
 * SEARCHED AND NOT FOUND. Stamping it across a whole workbook that nothing read
 * a baris of is the same lie `outstanding-panel.tsx` refuses to tell, so the
 * key is held and the reason is on the page as well as on the control: this is
 * a blocking condition the operator has to act on somewhere else.
 */
function nothingToRead(pages: number, searchablePages: number): string | null {
  if (pages === 0) {
    return "Belum ada dokumen di order ini, jadi tidak ada yang bisa dicocokkan. Muat dokumen order dulu di langkah Berkas Order.";
  }
  if (searchablePages === 0) {
    return "Semua berkas order ini Anda tandai tanpa AI, jadi tidak ada halaman yang bisa dibaca untuk pencocokan. Ubah salah satu berkas jadi dibaca AI di bar dokumen.";
  }
  return null;
}

/**
 * THE MOMENT THE TEXT LEAVES THE DEVICE, and the consent sentence beside it.
 *
 * One component rather than two copies, because the same press happens twice in
 * the flow: on the berkas the order is given first, and on a replacement handed
 * over later. A second copy would be a second set of words for one act.
 */
function CompareLine({
  comparing,
  busy,
  searchablePages,
  pages,
  onCompare,
}: {
  comparing: boolean;
  busy: boolean;
  searchablePages: number;
  pages: number;
  onCompare: () => void;
}) {
  const blocked = nothingToRead(pages, searchablePages);
  const hold = busy ? LOADING_HOLD : (blocked ?? undefined);

  return (
    <>
      {blocked ? <Notice tone="stop">{blocked}</Notice> : null}

      <p className="text-ink-2 max-w-[62ch] text-[0.8125rem]">{CONSENT}</p>

      <div className="flex flex-wrap items-center gap-4">
        <Btn
          tone="primary"
          disabled={comparing || hold !== undefined}
          reason={hold}
          aria-busy={comparing || undefined}
          onClick={onCompare}
        >
          <BukuKerja />
          {comparing ? "Sedang mencocokkan..." : "Cocokkan dengan dokumen"}
        </Btn>
        {comparing ? (
          <p aria-live="polite" className="flex items-center gap-2 text-sm">
            {/* The wait has to move: a comparison is one request over the whole
                order and it runs for a while, and a line that stands perfectly
                still is indistinguishable from a screen that has hung. */}
            <span className="lt-spinner" aria-hidden="true" />
            Isian berkas ini sedang dibaca dan dicocokkan dengan dokumen.
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * The workbook is bigger than one reading can carry, said out loud.
 *
 * THE ONE THING ON THIS SCREEN THAT MUST NOT BE QUIET. A truncated listing
 * produces a Konfig Excel that opens cleanly, lists a screenful of isian, and
 * is a comparison of a FRACTION of the operator's workbook -- every isian past
 * the cut reported as neither matching nor mismatching, because it was never
 * seen. That reads exactly like a workbook with fewer isian in it, which is
 * this project's central failure class with a spreadsheet on top of it. So it
 * is prose, in `--gap`, it names what was read, and it says plainly that the
 * rest was never looked at.
 */
function Truncation({ sheet }: { sheet: Sheet }) {
  if (!listingTruncated(sheet)) return null;

  return (
    <Notice tone="stop">
      <span className="flex flex-col gap-2">
        <span>
          Lembar {sheet.name} lebih besar daripada yang bisa dibaca sekali jalan:{" "}
          <span className="lt-figure">{sheet.cells.length}</span> sel terisi dan{" "}
          <span className="lt-figure">{sheet.merges.length}</span> sel gabungan.
          Hanya bagian awal lembar ini yang dibaca.
        </span>
        <span>
          Isian di luar bagian itu tidak pernah dilihat, jadi tidak muncul di
          daftar di bawah dan tidak berarti sudah cocok. Periksa sisanya sendiri
          di berkas Anda, atau pecah lembar ini jadi beberapa berkas yang lebih
          kecil lalu muat satu per satu.
        </span>
      </span>
    </Notice>
  );
}

/**
 * WHAT REPLACING THE WORKBOOK COSTS, before the operator presses anything.
 *
 * `attachWorkbook` discards every ruling this order holds when the workbook
 * changes, and it is right to: a `setuju` on a name in the old sheet is not a
 * `setuju` on whatever stands at that name in the new one. Its own doc says the
 * screen owes the operator the sentence before it calls, so this is that
 * sentence. It is a `Notice` and not a dialog because the drop itself destroys
 * nothing: the key below is a second, deliberate act with this standing over
 * it.
 */
function ReplacementCost({
  check,
  digest,
}: {
  check: ConfigCheck;
  digest: string;
}) {
  const held = check.workbook;
  if (!held || held.digest === digest) return null;

  const decided = check.entries.filter(
    (entry) => entry.decision !== "belum",
  ).length;
  if (decided === 0) return null;

  return (
    <Notice tone="warn">
      <span className="flex flex-wrap items-baseline gap-2">
        <span className="lt-figure">{decided}</span>
        <span>
          keputusan yang sudah Anda ambil akan hilang kalau berkas ini
          dicocokkan, karena setiap keputusan itu tentang sel di{" "}
          {shortenFileName(held.name, 28)}.
        </span>
      </span>
    </Notice>
  );
}

/**
 * The place you put the konfigurasi.
 *
 * A TRAY CUT INTO THE BENCH, the same recess the berkas drop uses, so the two
 * hand-over points in the product read as one object. A file that is not an
 * .xlsx is refused OUT LOUD: dropping one in silence is this project's failure
 * class in the interaction layer, because the operator walks away believing
 * their konfigurasi is in the order.
 */
function WorkbookDrop({
  reading,
  onFiles,
  label = "Muat berkas konfigurasi",
}: {
  reading: boolean;
  onFiles: (file: File) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  // A drag over a CHILD fires dragleave on the parent, so a boolean toggled by
  // those two events flickers the whole time the pointer is inside. Counting
  // enter against leave is the only version that stays lit.
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const inputId = useId();
  const labelId = useId();

  const take = (list: FileList | null) => {
    const all = [...(list ?? [])];
    const books = all.filter(isWorkbookFile);
    const others = all.filter((file) => !isWorkbookFile(file));

    if (all.length === 0) {
      setRefusal(
        "Tidak ada berkas yang terbaca dari yang Anda jatuhkan. Coba pilih berkasnya lewat tombol di bawah.",
      );
      return;
    }

    if (others.length > 0) {
      const names = others
        .map((file) => shortenFileName(file.name, 28))
        .join(", ");
      setRefusal(
        books.length > 0
          ? `Hanya berkas .xlsx yang bisa dibaca di sini, jadi yang ini dilewati: ${names}.`
          : `Bukan berkas .xlsx, jadi tidak ada yang dimuat: ${names}. Simpan konfigurasinya sebagai .xlsx dulu, lalu coba lagi.`,
      );
    } else if (books.length > 1) {
      // Said rather than silently dropped: one order has one konfigurasi, and
      // an operator who handed two over has to know which one was taken.
      setRefusal(
        `Satu order memakai satu berkas konfigurasi, jadi yang dibaca hanya ${shortenFileName(books[0].name, 28)}.`,
      );
    } else {
      setRefusal(null);
    }

    if (books.length > 0) onFiles(books[0]);
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-labelledby={labelId}
        onDragEnter={(event) => {
          event.preventDefault();
          depth.current += 1;
          setOver(true);
        }}
        onDragOver={(event) => {
          // Without this the browser treats the drop as a navigation and opens
          // the operator's workbook over the top of the order.
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          depth.current = 0;
          setOver(false);
          take(event.dataTransfer.files);
        }}
        className={`lt-well flex flex-col items-center gap-3 rounded-[20px] border px-4 py-6 text-center ${
          // `--wash` under the pointer is the film a hand leaves, which is this
          // system's one recipe for "this is being touched and it is not a
          // key". Amber is not available here: nothing is owed at a drop.
          over ? "border-ink bg-[var(--wash)]" : "border-line-control"
        }`}
      >
        <Muat size={40} className="text-ink-3" />

        <h3 id={labelId} className="lt-title">
          {label}
        </h3>

        <label htmlFor={inputId} className="sr-only">
          Pilih berkas konfigurasi .xlsx dari komputer Anda
        </label>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => {
            take(event.target.files);
            // Cleared, so choosing the same berkas twice still fires `change`.
            event.target.value = "";
          }}
        />
        <Btn
          tone="primary"
          disabled={reading}
          reason="Berkas konfigurasi ini sedang dibaca."
          aria-busy={reading || undefined}
          onClick={() => input.current?.click()}
        >
          {reading ? "Sedang membaca..." : "Pilih berkas konfigurasi"}
        </Btn>

        {/* THE CONSENT SENTENCE, ON THE PAGE, ALWAYS. It is about data leaving
            the device, which is on the short list of things that stay as prose
            even though they read the same on every order. */}
        <p className="text-ink-2 max-w-[62ch] text-[0.8125rem]">{CONSENT}</p>
      </div>

      {/* The live region sits in the DOM before it has anything to say, so a
          refusal is announced when it appears rather than when the region is
          first inserted. */}
      <div role="status" aria-live="polite">
        {refusal ? <Notice tone="stop">{refusal}</Notice> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * States 3 and 4: the register, and the workbook going back.
 * ------------------------------------------------------------------ */

function Compared({
  run,
  check,
  summary,
  answer,
  staged,
  rank,
  busy,
  bytesGone,
  searchablePages,
  researchable,
  researching,
  fence,
  working,
  fresh,
  typing,
  saving,
  saved,
  replacing,
  reading,
  comparing,
  onReplace,
  onFiles,
  onCompare,
  onResearch,
  onRecompare,
  onDecide,
  onType,
  onDownload,
}: {
  run: BrowserRun;
  check: ConfigCheck;
  summary: ReturnType<typeof configSummary>;
  answer: ConfigResponse | null;
  staged: Staged | null;
  rank: Map<string, number>;
  busy: boolean;
  bytesGone: boolean;
  searchablePages: number;
  /** Isian that are `tidak-ditemukan` AND still undecided. See `researchable`. */
  researchable: number;
  researching: boolean;
  /** Which berkas the register was compared without. See `Fence`. */
  fence: FenceReport;
  working: ReadonlySet<string>;
  fresh: ReadonlySet<string>;
  typing: string | null;
  saving: boolean;
  saved: { name: string; changed: number } | null;
  replacing: boolean;
  reading: boolean;
  comparing: boolean;
  onReplace: (open: boolean) => void;
  onCompare: () => void;
  onFiles: (file: File) => void;
  onResearch: () => void;
  onRecompare: () => void;
  onDecide: (
    entryId: string,
    decision: ConfigEntry["decision"],
    manualValue?: string,
  ) => void;
  onType: (entryId: string | null) => void;
  onDownload: () => void;
}) {
  const workbook = check.workbook;
  const ordered = [...check.entries].sort(
    (a, b) =>
      (rank.get(configEntryId(a)) ?? 0) - (rank.get(configEntryId(b)) ?? 0),
  );

  /**
   * GROUPED BY SERVICE WHEN THERE IS ONE, FLAT WHEN THERE IS NOT.
   *
   * Two of the three real workbooks carry one row per SERVICE, so the same
   * isian name appears twice and the group is the only thing telling them
   * apart. A row with a group and no way to see it is a decision made against
   * the wrong service.
   */
  const groups: { name: string; rows: ConfigEntry[] }[] = [];
  for (const entry of ordered) {
    const name = entry.field.group ?? "";
    const held = groups.find((group) => group.name === name);
    if (held) held.rows.push(entry);
    else groups.push({ name, rows: [entry] });
  }

  const rowProps = {
    run,
    working,
    fresh,
    typing,
    onDecide,
    onType,
  };

  /**
   * IS THE BERKAS OPEN ON THIS DEVICE THE ONE THIS REGISTER IS ABOUT?
   *
   * It is not, the moment the operator stages a replacement, and the difference
   * decides which workbook the truncation sentence is about. A sentence about
   * the replacement standing over a register built from the old berkas would be
   * a warning attached to the wrong file.
   */
  /*
   * A REPLACEMENT IS STAGED: a berkas open on this device that is NOT the one
   * this register describes. The inverse of `stagedIsCompared`, named
   * separately because the two are read for opposite purposes -- one decides
   * which workbook a truncation sentence is about, the other decides whether
   * there is anything left to compare.
   */
  const replacementStaged =
    staged !== undefined &&
    staged !== null &&
    (workbook === undefined || staged.digest !== workbook.digest);

  const stagedIsCompared =
    staged !== undefined &&
    staged !== null &&
    workbook !== undefined &&
    staged.digest === workbook.digest;

  return (
    <>
      {/* The counts change as decisions are taken, with no navigation. */}
      <p aria-live="polite" className="sr-only">
        {summary.total} isian. {summary.belumSesuai} belum sesuai.{" "}
        {summary.tidakDitemukan} tidak ditemukan. {summary.owed} menunggu
        keputusan Anda.
      </p>

      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-baseline gap-2 text-sm">
          <span>
            <span className="lt-figure">{summary.total}</span> isian,{" "}
            <span className="lt-figure">{summary.belumSesuai}</span> belum
            sesuai, <span className="lt-figure">{summary.tidakDitemukan}</span>{" "}
            tidak ditemukan.
          </span>
          {/* What each of the three keys does to the operator's own berkas.
              It reads word for word the same on every order and everything it
              describes still works, so it may sit behind the mark. */}
          <Hint label="Arti tiga pilihan itu">
            <strong>Terima</strong> menulis nilai dari dokumen ke sel itu.{" "}
            <strong>Tolak</strong> membiarkan nilai yang sudah ada di berkas
            konfigurasi Anda. <strong>Ketik sendiri</strong> mengisi sel itu
            dengan nilai yang Anda tulis.
          </Hint>
        </p>

        {workbook ? (
          <p className="flex flex-wrap items-baseline gap-2 text-[0.8125rem] text-ink-2">
            <span>dari</span>
            <span className="lt-kotak" title={workbook.name}>
              {shortenFileName(workbook.name, 30)}
            </span>
            <span>lembar</span>
            <span className="lt-kotak">{workbook.sheet}</span>
          </p>
        ) : null}
      </div>

      {/* ONLY FOR THE WORKBOOK THIS REGISTER IS ABOUT.

          `staged` is two different things here. On an ordinary visit it is the
          COMPARED workbook, read back off the device by the recovery effect
          above precisely so this sentence can be said after a reload -- and
          without it an operator meets a register that reads as full coverage
          of a workbook only part of which was ever looked at, which is the
          failure this screen exists to prevent.

          The moment they stage a REPLACEMENT it is that instead, and a
          truncation sentence about the replacement standing over a register
          built from the old berkas is a warning attached to the wrong file.
          The replacement gets its own, beside its own cell count, once it is
          the thing being read. */}
      {stagedIsCompared ? <Truncation sheet={staged.sheet} /> : null}

      {/* FROM THE RUN, NOT FROM THE LAST REPLY. What the reading refused is
          stored on the workbook record, so a reload no longer turns a partial
          comparison into a screen that reads as full coverage. */}
      <Unusable labels={workbook?.unusable ?? []} />

      <Fence
        fence={fence}
        busy={busy}
        comparing={comparing}
        searchablePages={searchablePages}
        onRecompare={onRecompare}
      />

      <Research
        check={check}
        summary={summary}
        researchable={researchable}
        busy={busy}
        searchablePages={searchablePages}
        researching={researching}
        onResearch={onResearch}
      />

      {groups.map((group) =>
        group.name === "" ? (
          <ul key="tanpa-kelompok" className="flex flex-col gap-2">
            {group.rows.map((entry) => (
              <EntryRow key={configEntryId(entry)} entry={entry} {...rowProps} />
            ))}
          </ul>
        ) : (
          <section
            key={group.name}
            aria-label={group.name}
            className="lt-slab"
          >
            <div className="lt-kop">
              {/* Mono: the group is the model's own words for the row -- an
                  SID, a location -- read off the operator's workbook, so it is
                  a quotation and not the app speaking. */}
              <h3 className="lt-figure">{group.name}</h3>
              <span className="lt-figure lt-kop-right">
                {group.rows.length}
              </span>
            </div>
            <div className="lt-slab-body">
              <ul className="flex flex-col gap-2">
                {group.rows.map((entry) => (
                  <EntryRow
                    key={configEntryId(entry)}
                    entry={entry}
                    {...rowProps}
                  />
                ))}
              </ul>
            </div>
          </section>
        ),
      )}

      <Reasons check={check} answer={answer} />

      <Download
        check={check}
        summary={summary}
        bytesGone={bytesGone}
        saving={saving}
        saved={saved}
        onDownload={onDownload}
      />

      {/* THE WAY BACK FROM THE WRONG BERKAS, closed, one line at rest.
          Without it an order that was compared against the wrong konfigurasi
          could never be compared against the right one, and the operator would
          have to start the order again. */}
      <details className="lt-disclose">
        <summary>Ganti berkas konfigurasi</summary>
        <div className="flex flex-col gap-3 pt-2">
          <Note>
            Berkas yang baru menggantikan yang sekarang, dan keputusan yang
            sudah Anda ambil untuk berkas lama tidak ikut pindah karena setiap
            keputusan itu tentang sel di berkas itu.
          </Note>
          {replacing ? (
            <WorkbookDrop
              reading={reading}
              onFiles={onFiles}
              label="Muat berkas konfigurasi pengganti"
            />
          ) : (
            <span>
              <Btn onClick={() => onReplace(true)}>
                <BukuKerja />
                Pilih berkas pengganti
              </Btn>
            </span>
          )}

          {/* THE OTHER HALF OF REPLACING, AND WITHOUT IT THIS IS A DEAD END.

              Dropping a replacement only stages it. Nothing compared it, so
              the register below still described the old berkas and the key at
              the foot of the screen still patched the old berkas -- an
              operator who noticed they had loaded the wrong konfigurasi could
              load the right one and then watch the screen ignore it, with
              nothing saying why. Found by review.

              `onCompare` is the same call the first reading makes.
              `compare()` already knows the difference: a staged berkas whose
              digest differs from the one held is folded in with
              `attach-workbook`, which replaces the workbook AND its isian and
              names the rulings it discards, so storage cannot lose one
              silently. `ReplacementCost` prints that price before the press. */}
          {replacementStaged ? (
            <>
              <p className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="lt-kotak" title={staged.file.name}>
                  {shortenFileName(staged.file.name, 34)}
                </span>
                <span>
                  <span className="lt-figure">{staged.sheet.cells.length}</span>{" "}
                  sel terbaca dari lembar
                </span>
                <span className="lt-kotak">{staged.sheet.name}</span>
              </p>

              <Truncation sheet={staged.sheet} />
              <ReplacementCost check={check} digest={staged.digest} />

              <span>
                <Btn
                  tone="primary"
                  disabled={comparing || busy}
                  reason={
                    busy
                      ? "Tunggu berkas order selesai dimuat."
                      : comparing
                        ? "Pencocokan sedang berjalan."
                        : undefined
                  }
                  onClick={onCompare}
                >
                  {comparing
                    ? "Sedang mencocokkan..."
                    : "Cocokkan berkas pengganti dengan dokumen"}
                </Btn>
              </span>
            </>
          ) : null}
        </div>
      </details>
    </>
  );
}

/**
 * WHICH BERKAS THIS REGISTER WAS COMPARED WITHOUT, BY NAME, ONCE.
 *
 * The rows keep `tidak ditemukan` and the fence keeps tanpa AI. What neither
 * word can say is that some isian were never looked for in a berkas the
 * operator fenced off, and on 2026-09-11 a register of such rows was reported
 * as the check being broken. So the head of the register says it, the way the
 * lembar periksa reports its own fence.
 *
 * WHEN A SKIPPED BERKAS HAS SINCE BEEN LET IN, THE KEY TO USE IT IS HERE.
 * There was none: the same workbook re-handed over is recognised by its bytes
 * and offers no compare key, and the one re-search is usually spent by then.
 */
function Fence({
  fence,
  busy,
  comparing,
  searchablePages,
  onRecompare,
}: {
  fence: FenceReport;
  busy: boolean;
  comparing: boolean;
  searchablePages: number;
  onRecompare: () => void;
}) {
  const { skipped, nowRead, known } = fence;
  if (skipped.length === 0 && nowRead.length === 0) return null;

  const hold = busy
    ? LOADING_HOLD
    : searchablePages === 0
      ? "Semua berkas order ini Anda tandai tanpa AI, jadi tidak ada halaman yang bisa dibaca."
      : undefined;

  return (
    <div className="flex flex-col gap-2">
      {skipped.length > 0 ? (
        <Advisory>
          Berkas yang Anda tandai tanpa AI tidak ikut dicari saat mencocokkan:{" "}
          <BerkasNames berkas={skipped} />. Isian yang hanya tertulis di sana
          tampil tidak ditemukan. Kalau berkas itu boleh dibaca AI, ubah di bar
          dokumen, lalu cocokkan ulang di sini.
        </Advisory>
      ) : null}

      {nowRead.length > 0 ? (
        <Notice tone="info">
          <p className="max-w-[62ch] text-sm">
            <BerkasNames berkas={nowRead} /> sekarang dibaca AI
            {known
              ? ", tapi isian di bawah dicocokkan waktu berkas itu masih tanpa AI."
              : ". Kalau Anda mengubahnya setelah pencocokan, isian di bawah belum dicari di sana."}{" "}
            Cocokkan ulang supaya isiannya ikut dicari. Keputusan yang sudah
            Anda ambil tetap tersimpan.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <Btn
              tone="primary"
              disabled={comparing || hold !== undefined}
              reason={hold}
              aria-busy={comparing || undefined}
              onClick={onRecompare}
            >
              <BukuKerja />
              {comparing ? "Sedang mencocokkan..." : "Cocokkan ulang dengan dokumen"}
            </Btn>
            {comparing ? (
              <p aria-live="polite" className="flex items-center gap-2 text-sm">
                <span className="lt-spinner" aria-hidden="true" />
                Isian berkas ini sedang dicocokkan lagi dengan dokumen.
              </p>
            ) : null}
          </div>
        </Notice>
      ) : null}
    </div>
  );
}

/** Berkas named as the documents bar names them: shortened, whole on hover. */
function BerkasNames({ berkas }: { berkas: readonly FencedBerkas[] }) {
  return (
    <>
      {berkas.map((one, at) => (
        <span key={one.id}>
          {at > 0 ? ", " : ""}
          <span className="lt-figure" title={one.name}>
            {shortenFileName(one.name, 40)}
          </span>
        </span>
      ))}
    </>
  );
}

/**
 * What the reading could not use, and what to do about it.
 *
 * An `Advisory`: no hue, because amber already means a decision is owed and one
 * hue asked to mean act-on-this and be-suspicious-of-this at once teaches an
 * operator to read neither. It always ends in something to do. The REASONS are
 * written for a developer and stay in `Detail teknis` at the foot of the
 * register, never in a sentence an operator is meant to act on.
 *
 * ISIAN, NOT "BARIS". `docs/ui-bahasa.md` reserves `baris` for OCR lines and
 * this same screen spends it that way twelve rows down, in every `Cite`. It was
 * also the wrong count: on the transposed workbook one isian is a COLUMN, and
 * on the header-row workbook one row carries twenty of them. Found by review.
 *
 * NAMED, NOT COUNTED. The operator's move is to open their own file and look at
 * these isian, and a bare number does not tell them which.
 */
function Unusable({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null;

  return (
    <Advisory>
      <span className="lt-figure">{labels.length}</span> isian di berkas ini
      tidak bisa dipakai, jadi tidak ikut dicocokkan dan tidak muncul di daftar
      di bawah:{" "}
      {labels.map((label, at) => (
        <span key={`${label}/${at}`}>
          {at > 0 ? ", " : ""}
          {/* Mono: it is the workbook's own word for the isian. */}
          <span className="lt-figure">{label}</span>
        </span>
      ))}
      . Buka berkas konfigurasi Anda dan periksa sendiri isian itu.
    </Advisory>
  );
}

/**
 * Every English sentence on this screen, in the one place this product puts
 * text written for a DEPLOYER and shown to an OPERATOR.
 *
 * The reasons a value was not found, the model's own note about the sheet, and
 * the rows the grid refused are all diagnoses rather than instructions. They
 * never share a paragraph with a sentence the operator is meant to act on.
 */
function Reasons({
  check,
  answer,
}: {
  check: ConfigCheck;
  answer: ConfigResponse | null;
}) {
  const lines: string[] = [];
  const reading = readingDetail(answer);
  if (reading) lines.push(reading);
  for (const entry of check.entries) {
    if (entry.reason) lines.push(`${entry.field.label}  ${entry.reason}`);
  }
  if (lines.length === 0) return null;

  return <TechnicalDetail>{lines.join("\n")}</TechnicalDetail>;
}

/**
 * The one re-search, and the sentence it leaves behind when it is spent.
 *
 * The budget is the client's own: once per order, so an isian the documents do
 * not carry cannot be searched for all afternoon. `canResearch` is both halves
 * of it -- not yet spent, AND something to spend it on -- so the key is never
 * offered to buy an answer the run already has.
 *
 * SPENT IS SAID IN THE PAST TENSE, not as a disabled key with a hover. There is
 * nothing to press and nothing that will ever make it pressable again, and a
 * down key invites an operator to keep trying to find out why.
 */
function Research({
  check,
  summary,
  researchable,
  busy,
  searchablePages,
  researching,
  onResearch,
}: {
  check: ConfigCheck;
  summary: ReturnType<typeof configSummary>;
  researchable: number;
  busy: boolean;
  searchablePages: number;
  researching: boolean;
  onResearch: () => void;
}) {
  if (summary.tidakDitemukan === 0) return null;

  if (!summary.canResearch) {
    return <Note>{check.researched ? RESEARCH_SPENT : RESEARCH_OFFER}</Note>;
  }

  // THE BUDGET IS UNSPENT AND THERE IS NOTHING TO SPEND IT ON: every isian that
  // was not found has already been decided, and a decision hides what a search
  // would find for it. Said in the past tense with the way back named, rather
  // than a key that spends a model call and changes nothing on screen.
  if (researchable === 0) return <Note>{RESEARCH_SETTLED}</Note>;

  const hold = busy
    ? LOADING_HOLD
    : searchablePages === 0
      ? "Semua berkas order ini Anda tandai tanpa AI, jadi tidak ada halaman yang bisa dibaca lagi."
      : undefined;

  return (
    <div className="flex flex-col gap-2">
      <Note>{RESEARCH_OFFER}</Note>
      <div className="flex flex-wrap items-center gap-4">
        <Btn
          disabled={researching || hold !== undefined}
          reason={hold}
          aria-busy={researching || undefined}
          onClick={onResearch}
        >
          {researching ? "Sedang mencari..." : "Cari sekali lagi"}
        </Btn>
        {researching ? (
          <p aria-live="polite" className="flex items-center gap-2 text-sm">
            <span className="lt-spinner" aria-hidden="true" />
            Mencari <span className="lt-figure">{researchable}</span> isian di{" "}
            <span className="lt-figure">{searchablePages}</span> halaman.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One isian.
 * ------------------------------------------------------------------ */

/**
 * ONE ROW, AND ITS SIZE IS AN ARGUMENT.
 *
 * A row that owes a decision is a block: the two values read against each other
 * in one column, the sumber under them, and the three keys. A settled row and a
 * row that already agrees collapse to one ruled line carrying the paraf, the
 * name and the value that will be written. The length of this list is the
 * amount of work left.
 *
 * WHAT IS NEVER ON THE ROW: `ConfigField.id`. The CELL ADDRESS is
 * operator-facing and belongs here -- it is the workbook's half of the sumber,
 * the address they open their own file at -- and the id is system vocabulary
 * competing for the space the isian's own name should occupy.
 */
function EntryRow({
  run,
  entry,
  working,
  fresh,
  typing,
  onDecide,
  onType,
}: {
  run: BrowserRun;
  entry: ConfigEntry;
  /** Every isian whose write is in the air, and every one that just landed. */
  working: ReadonlySet<string>;
  fresh: ReadonlySet<string>;
  typing: string | null;
  onDecide: (
    entryId: string,
    decision: ConfigEntry["decision"],
    manualValue?: string,
  ) => void;
  onType: (entryId: string | null) => void;
}) {
  const id = configEntryId(entry);
  const state = stateOf(entry);
  const open = isOpen(entry);
  const saving = working.has(id);
  const field = entry.field;
  const address = `${field.sheet}!${field.valueRef}`;

  /**
   * HOW THE TWO VALUES DIFFER, for a row that has two values to compare.
   *
   * `undefined` for a `tidak-ditemukan`, which carries no `documentValue`: a
   * band drawn against nothing would mark the whole konfigurasi value as
   * differing from an absence, which is not what the row says.
   */
  const difference =
    entry.documentValue === undefined
      ? undefined
      : describeDifference(field.excelValue, entry.documentValue);
  const kindWord = difference ? KIND_WORD[difference.kind] : undefined;

  const head = (
    <>
      <Mark
        status={state.status}
        title={state.word}
        drawing={fresh.has(id)}
        saved={!saving}
      />
      {/* Mono: the isian's name is the workbook's own word for it, and two of
          them are read against each other down this column. */}
      <span className="lt-figure font-bold">{field.label}</span>
      {field.group ? (
        <span className="lt-figure text-ink-2 text-[0.8125rem]">
          {field.group}
        </span>
      ) : null}
      <span className="lt-kotak text-ink-3" title="Alamat sel di berkas Anda">
        {address}
      </span>
      <StateWord status={state.status}>{state.word}</StateWord>
    </>
  );

  if (!open) {
    const value = effectiveValue(entry);
    return (
      <li className="border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-2">
        {head}
        <span className="lt-figure ms-auto">
          {value === "" ? (
            <span className="text-ink-3">
              {entry.decision === "manual" ? "(dikosongkan)" : "(belum diisi)"}
            </span>
          ) : (
            value
          )}
        </span>
        {entry.decision !== "belum" ? (
          <Btn
            data-flat="true"
            disabled={saving}
            reason="Keputusan ini sedang disimpan."
            onClick={() => onDecide(id, "belum")}
          >
            Buka lagi
          </Btn>
        ) : null}
      </li>
    );
  }

  return (
    <li className="lt-row">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">{head}</div>

      {/* THE TWO VALUES IN ONE COLUMN, both mono, so a pair that differs by one
          character can be read against each other. An empty cell prints
          `(belum diisi)` and never a bare dash: a dash is a character somebody
          could have typed.

          READING THEM AGAINST EACH OTHER IS NOT ENOUGH ON ITS OWN, which is
          what `difference` adds. Mono and one above the other is the right
          arrangement and it still loses to a hundred-character address whose
          only difference is a space in the middle. */}
      <dl className="lt-register">
        <dt>konfigurasi</dt>
        <dd>
          {field.excelValue === "" ? (
            <span className="text-ink-3">(belum diisi)</span>
          ) : (
            <Marked text={field.excelValue} span={difference?.a} />
          )}
        </dd>

        <dt>dokumen</dt>
        <dd>
          {entry.documentValue === undefined ? (
            /* THE WORD IS THE VERDICT'S OWN. This cell said "(tidak ada di
               dokumen)", which is a claim about the DOCUMENT -- the mirror of
               Input EPIC's `tidak ada di konfigurasi`, and pointed the wrong
               way. What is actually known is `tidak ditemukan`, fixed in
               `docs/ui-bahasa.md` to mean SEARCHED AND NOT FOUND, which is what
               the state word on this row already says. Found by review. */
            <span className="text-ink-3">(tidak ditemukan)</span>
          ) : (
            <Marked text={entry.documentValue} span={difference?.b} />
          )}
        </dd>

        {/* THE KIND, IN THE SAME GRID, because it is a third thing known about
            the same pair and a line floating beside the register would read as
            a note about the row. Sans: this is the app talking, not a value
            quoted out of a document, and `.lt-register dd` is mono for the
            values. Nothing is printed for `nilai`, which is the default and
            the case where the band above has already said everything. */}
        {kindWord ? (
          <>
            <dt>bedanya</dt>
            <dd className="font-sans">{kindWord}</dd>
          </>
        ) : null}
      </dl>

      <Sumber run={run} entry={entry} />

      {typing === id ? (
        <ManualValue
          initial={effectiveValue(entry)}
          address={address}
          saving={saving}
          onCancel={() => onType(null)}
          onSubmit={(value) => onDecide(id, "manual", value)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {/* TERIMA ONLY WHERE THERE IS SOMETHING TO TAKE. `effectiveValue`
              records a `setuju` with no recommendation as a bug upstream, and
              the only way to reach it is a screen that offered this key on an
              isian carrying no document value. */}
          {entry.documentValue !== undefined ? (
            <Btn
              tone="primary"
              disabled={saving}
              reason="Keputusan ini sedang disimpan."
              onClick={() => onDecide(id, "setuju")}
            >
              Terima
            </Btn>
          ) : null}
          <Btn
            tone="reject"
            disabled={saving}
            reason="Keputusan ini sedang disimpan."
            onClick={() => onDecide(id, "tolak")}
          >
            Tolak
          </Btn>
          <Btn
            disabled={saving}
            reason="Keputusan ini sedang disimpan."
            onClick={() => onType(id)}
          >
            Ketik sendiri
          </Btn>
        </div>
      )}
    </li>
  );
}

/**
 * WHERE THE VALUE WAS READ, or the fact that it was read nowhere in particular.
 *
 * `citeLines` resolves the berkas and that file's OWN page number, because
 * `ConfigCitation.pageIndex` is a position in `run.pages` -- 0-based across
 * every document in the order -- and printing it would send a reviewer to page
 * 34 of a bundle rather than page 7 of the SPLITBA. Those two numbering systems
 * have already shipped a wrong page reference once.
 *
 * A `beda` WITH NO SUMBER SAYS SO. "We found a different value somewhere" and
 * "we found a different value here" are different claims, and a row that showed
 * nothing would leave the operator to assume the stronger one.
 */
function Sumber({ run, entry }: { run: BrowserRun; entry: ConfigEntry }) {
  const citation: ConfigCitation | undefined = entry.citation;

  if (!citation) {
    if (entry.verdict !== "beda") return null;
    return (
      <Advisory>
        Nilai ini tidak membawa sumber, jadi tidak ada baris dokumen yang bisa
        Anda buka untuk memeriksanya. Cocokkan sendiri dengan dokumen sebelum
        menerimanya.
      </Advisory>
    );
  }

  const cite = citeLines(run, citation.pageIndex, citation.from, citation.to);
  if (!cite) {
    return (
      <p className="text-[0.8125rem] text-gap">
        Sumbernya menunjuk ke halaman yang sudah tidak ada di order ini.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Cite cite={cite} />
      <CiteAdvisories cite={cite} />

      {/* The transcript, on demand and CLOSED: OCR text can be right while the
          lines it was read from are the wrong ones, so it is the second
          opinion rather than the first. */}
      {citation.text ? (
        <details className="lt-disclose">
          <summary>Teks yang dikutip</summary>
          <p className="lt-well lt-figure mt-2 max-h-40 overflow-auto p-2 text-[0.8125rem] whitespace-pre-wrap">
            {citation.text}
          </p>
        </details>
      ) : null}
    </div>
  );
}

/**
 * The value the operator types, seeded with what is there.
 *
 * THE APP NEVER INVENTS A VALUE, so the field opens holding the isian's current
 * effective value rather than a blank with a guess behind it. Mono, from
 * `.lt-input` itself: what they type goes into a cell of their own workbook,
 * which is the document's voice.
 *
 * AN EMPTY VALUE IS A REAL INSTRUCTION and is not refused. EPIC's template
 * carries fields a particular order does not use, and `""` is how an operator
 * says so -- `effectiveValue` takes the empty string on purpose, and a screen
 * that blocked it would leave that a state nothing could reach. What it gets
 * instead is the sentence saying what it will do.
 */
function ManualValue({
  initial,
  address,
  saving,
  onSubmit,
  onCancel,
}: {
  initial: string;
  address: string;
  saving: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const blank = value === "";

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving) onSubmit(value);
      }}
    >
      <label className="lt-label" htmlFor={id}>
        Nilai untuk {address}
      </label>
      <input
        id={id}
        className="lt-input max-w-[42rem]"
        value={value}
        disabled={saving}
        style={{ opacity: saving ? 0.4 : 1 }}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Escape leaves without saving: the same promise "Batal" makes,
          // available to the hand already on the keyboard.
          if (event.key === "Escape" && !saving) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {blank ? (
        <Note>
          Kosong berarti sel ini dikosongkan di berkas konfigurasi yang Anda
          simpan nanti.
        </Note>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Btn
          type="submit"
          tone="primary"
          disabled={saving}
          reason="Nilai ini sedang disimpan."
        >
          Simpan
        </Btn>
        <Btn
          disabled={saving}
          reason="Tunggu sampai nilai ini tersimpan."
          onClick={onCancel}
        >
          Batal
        </Btn>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * The workbook going back.
 * ------------------------------------------------------------------ */

/**
 * THE END OF KONFIG EXCEL: the operator's own berkas, amended.
 *
 * The tool does not author a workbook, it amends one, so what comes back is the
 * file that went in with the cells they approved changed and every other part
 * of the archive -- the formatting, the data validations, the print settings --
 * untouched.
 *
 * ZERO EDITS DOES NOT BLOCK. A konfigurasi the documents entirely agree with,
 * or one where every recommendation was rejected, produces a file identical to
 * the original, and handing it back is correct: refusing would read as the tool
 * having failed. The count says so plainly instead.
 */
function Download({
  check,
  summary,
  bytesGone,
  saving,
  saved,
  onDownload,
}: {
  check: ConfigCheck;
  summary: ReturnType<typeof configSummary>;
  bytesGone: boolean;
  saving: boolean;
  saved: { name: string; changed: number } | null;
  onDownload: () => void;
}) {
  const workbook = check.workbook;
  if (!workbook) return null;

  const blocked = summary.owed > 0;
  const gone = bytesGone
    ? `Berkas konfigurasi "${workbook.name}" sudah tidak ada di perangkat ini, jadi tidak bisa diperbarui. Muat berkasnya sekali lagi lewat Ganti berkas konfigurasi di bawah.`
    : null;

  return (
    <div className="flex flex-col gap-3">
      {/* A BLOCKING CONDITION IS PROSE ON THE PAGE, in the same viewport as the
          key it stops, and it clears affirmatively. The `reason` on the key is
          the short form of the same fact for a pointer, a keyboard and a
          screen reader; neither stands in for the other. */}
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {blocked ? (
          <Notice tone="stop">{downloadBlockedSentence(summary.owed)}</Notice>
        ) : null}
        {gone ? <Notice tone="stop">{gone}</Notice> : null}
        {saved ? (
          <Note>
            Tersimpan sebagai{" "}
            <span className="lt-kotak">{saved.name}</span> dengan{" "}
            <span className="lt-figure">{saved.changed}</span> sel diubah.
          </Note>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Btn
          tone="primary"
          disabled={blocked || bytesGone || saving}
          reason={
            blocked
              ? `${summary.owed} isian masih menunggu keputusan Anda.`
              : bytesGone
                ? "Berkas konfigurasi order ini sudah tidak ada di perangkat ini."
                : "Berkas konfigurasi sedang disiapkan."
          }
          aria-busy={saving || undefined}
          onClick={onDownload}
        >
          <BukuKerja />
          {saving ? "Sedang menyiapkan..." : "Simpan konfigurasi terbaru"}
        </Btn>

        <p className="text-sm">
          {summary.edits === 0 ? (
            "Tidak ada sel yang berubah, jadi berkas yang Anda simpan sama persis dengan yang Anda muat."
          ) : (
            <>
              <span className="lt-figure">{summary.edits}</span> sel akan
              diubah.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
