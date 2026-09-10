"use client";

/**
 * CHECKPOINT 3: does EPIC show what the konfigurasi says?
 *
 * ## THE YARDSTICK HAS SWAPPED, AND EVERY WORD ON THIS SCREEN TURNS ON IT
 *
 * Checkpoint 2 asks the documents to judge the workbook: the scans are the
 * evidence and the workbook is the thing under test. HERE THE WORKBOOK IS THE
 * EVIDENCE and EPIC is the thing under test. So no sentence on this screen may
 * be borrowed from that one, and the two words that would read as borrowed are
 * the two that are fixed:
 *
 *  - `tidak-ada-di-excel` prints as **"tidak ada di konfigurasi"** and NEVER as
 *    "tidak ditemukan". "tidak ditemukan" is fixed by `docs/ui-bahasa.md` to
 *    mean SEARCHED AND NOT FOUND, which on this screen means "read every
 *    tangkapan layar and this isian is on none of them". The other finding is
 *    the opposite direction of travel: EPIC shows something the konfigurasi has
 *    no isian for at all. Printing one as the other would send the operator to
 *    look for another screenshot when what is missing is a row in their sheet.
 *  - The two value cells are labelled `konfigurasi` and `EPIC`, in that order,
 *    because the first is the measure and the second is the reading.
 *
 * ## THE BASIS QUESTION IS A GATE, NOT A DEFAULT
 *
 * Nothing else renders while `run.epic.basis === "belum"`. That is the client's
 * own instruction turned into a wall: an order that quietly assumed "lanjutkan"
 * would judge EPIC against a workbook the operator had already replaced, and
 * every finding on the ringkasan would be confidently wrong with nothing on
 * screen contradicting it. `EpicCheck.basis` records that the question was PUT,
 * which is a different fact from "no newer workbook was supplied", and only the
 * first of those is safe to act on.
 *
 * ## A CAPTURE THAT READ NOTHING IS REFUSED BY NAME
 *
 * `recogniseCapture` has no completeness ladder -- `src/lib/ui/checkpoint.ts`
 * says why: `ocrPageCompletely`'s thresholds were calibrated on 300 DPI A4
 * scans and a screenshot has entirely different ink. What replaces it is the
 * one unambiguous signal, and this screen is where it is spent: ZERO lines back
 * means the image is not stored at all, and the refusal names the berkas in
 * prose. A silently-kept blank capture would make every isian on it report
 * `tidak ditemukan`, which is the wrong-and-quiet failure this product exists
 * to prevent, delivered by the one screen whose whole output is a list of what
 * disagrees.
 *
 * ## THE RINGKASAN IS THE DELIVERABLE, SO IT IS AT THE TOP
 *
 * The client asked for it by name. Checkpoint 3 writes no file: what it
 * produces IS the list of everything that disagrees, so that list is the
 * subject of the screen and not a summary of one. When nothing disagrees it
 * says so AFFIRMATIVELY, because an absent warning is not a confirmation.
 *
 * ## EVERY WRITE GOES THROUGH `editEpic` AND THE CALLER KEEPS WHAT IT RETURNS
 *
 * `onRun(await runtime.editEpic(run.id, edit))`, never `saveRun({ ...run })`.
 * An ingest advances the revision once per page across minutes while this
 * screen holds a run in React state, so the composed-run write is refused as
 * stale on the ORDINARY path here, not on a corner case. An edit carries no
 * revision and is applied to whatever is stored when the lock is taken.
 *
 * ## A REFUSED WRITE IS REPORTED UPWARD, EVERYTHING ELSE IS PROSE HERE
 *
 * The vocabulary for a refused write (`StaleRunWriteError`, `DecisionLossError`,
 * `ConfigEditError`, `QuotaExceededError`) lives in `operator-app.tsx`'s
 * `saveFault`, which reads `error.name` and owns a sentence for each named
 * guard. This screen used to compose its own, and a review found what that
 * costs: it printed the first half of `docs/ui-bahasa.md`'s sentence and
 * dropped the `: {sebab}` half, so an operator was told the order did not save
 * and never told what to do about it. So `onSaveFailed` hands the RAW problem
 * over, exactly as `ConfigPanel` does, and the shell says the sentence. A
 * refused berkas, a tangkapan layar that read nothing and a failed comparison
 * are about THIS screen's own object and stay `Interruption` prose here.
 */

import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import { effectiveFields, epicSummary } from "@/lib/config/effective";
import type {
  ConfigField,
  EpicCapture,
  EpicCitation,
  EpicEntry,
} from "@/lib/config/types";
import {
  buildEpicRequest,
  buildFieldsOnlyRequest,
  digestOf,
  openWorkbook,
  recogniseCapture,
  requestConfigCheck,
  requestEpicCheck,
  workbookRecord,
} from "@/lib/ui/checkpoint";
import type { BrowserRun, EpicEdit } from "@/lib/ui/runtime";
import { epicEntryId } from "@/lib/ui/runtime";
import { useRuntime } from "@/lib/ui/runtime-context";
import type { SlotAggregateStatus } from "@/lib/ui/slots";
import { XLSX_TYPE } from "@/lib/ui/workbook";
import {
  MAX_LISTING_CELLS,
  MAX_LISTING_MERGES,
  listingTruncated,
} from "@/lib/xlsx/listing";

import {
  Advisory,
  Btn,
  Hint,
  Interruption,
  Lede,
  Mark,
  Note,
  Notice,
  StateWord,
  TechnicalDetail,
  Title,
  shortenFileName,
} from "./chrome";
import { BukuKerja, Klip } from "./icons";

/* ------------------------------------------------------------------ *
 * Small shared pieces.
 * ------------------------------------------------------------------ */

/** What the operator reads, and what a deployer reads, kept apart. */
type Fault = { sentence: string; detail?: string };

/** One berkas this screen would not take, with the reason it would not. */
type Refusal = { id: string; sentence: string; detail?: string };

/** An unknown throw as one readable line. Local, exactly as `ExportPanel`'s is. */
function messageOf(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}

/**
 * IDENTITY IS THE BYTES, so a name check is never the test.
 *
 * The extension and the MIME type are only ever used to decide whether it is
 * worth OPENING a berkas, which is a different question and a cheap one. A
 * renamed copy out of a downloads folder is the same workbook, and that is
 * settled by `digestOf` further down, exactly as `intake.ts` settles it for a
 * berkas of the order.
 */
function isXlsx(file: File): boolean {
  return file.type === XLSX_TYPE || /\.xlsx$/i.test(file.name);
}

function isCapture(file: File): boolean {
  return (
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    /\.(png|jpe?g)$/i.test(file.name)
  );
}

/**
 * PNG bytes for `/api/ocr`, which takes PNG and nothing else.
 *
 * A PNG travels untouched: re-encoding one buys nothing and would change the
 * bytes under a digest the operator's own file already answers to. A JPEG is
 * drawn once on this device and encoded as PNG here, because the route's own
 * contract is `content-type: image/png` and handing it a JPEG would be a
 * request that fails after the operator has walked away from the drop.
 */
async function toPngBytes(file: File): Promise<Uint8Array> {
  if (file.type === "image/png") return new Uint8Array(await file.arrayBuffer());

  const bitmap = await createImageBitmap(file);
  try {
    return new Uint8Array(await (await encodePng(bitmap)).arrayBuffer());
  } finally {
    // One screen capture is far smaller than a 300 DPI page, but the rule is
    // the same one `pageBitmap`'s callers follow and it costs one line.
    bitmap.close();
  }
}

async function encodePng(bitmap: ImageBitmap): Promise<Blob> {
  // `OffscreenCanvas` where there is one, the document's own canvas where there
  // is not. Feature-detected rather than branched on `typeof window`, which
  // AGENTS.md records as the pattern that silently meant the wrong thing in a
  // Web Worker and had to be fixed in three files.
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Gambar ini tidak bisa disiapkan di peramban ini.");
    context.drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type: "image/png" });
  }

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Gambar ini tidak bisa disiapkan di peramban ini.");
  context.drawImage(bitmap, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Gambar ini tidak bisa disiapkan di peramban ini.")),
      "image/png",
    );
  });
}

/**
 * What this finding is worth once the operator has ruled on it.
 *
 * THE SAME RULE `effectiveValue` APPLIES ONE CHECKPOINT DOWN, and it is written
 * again here for one reason: that function is typed for a `ConfigEntry`, whose
 * pair is `excelValue`/`documentValue`, and Checkpoint 3's pair is
 * `excelValue`/`epicValue`. There is no first answer to disagree with -- nothing
 * anywhere else resolves an `EpicEntry` -- so this is not a second copy of a
 * rule, it is the only one for this shape.
 *
 * NOTHING WRITES A FILE FROM IT. Checkpoint 2 owns the download; what Checkpoint
 * 3 produces is the summary list, so this is the record of a ruling rather than
 * a cell that will be patched, and the screen labels it that way.
 */
function settledValue(entry: EpicEntry): string {
  switch (entry.decision) {
    case "setuju":
      return entry.epicValue ?? entry.excelValue;
    case "manual":
      return entry.manualValue ?? "";
    default:
      return entry.excelValue;
  }
}

/** Does this finding still owe the operator a decision? */
function isOwed(entry: EpicEntry): boolean {
  return entry.verdict === "beda" && entry.decision === "belum";
}

/** Is this finding one the ringkasan must name? */
function isFlagged(entry: EpicEntry): boolean {
  return (
    entry.verdict === "beda" ||
    entry.verdict === "tidak-ditemukan" ||
    entry.verdict === "tidak-ada-di-excel"
  );
}

/**
 * The mark's shape and the row's word, from the one place that decides both.
 *
 * `SlotAggregateStatus` is borrowed rather than a private set of colours,
 * because it is what `Mark` and `StateWord` already understand: `proposed` is
 * the one place amber is a fill and it carries `--mark-ink` at 10.12:1,
 * `outstanding` is the struck diagonal in `--gap`, and the other four carry no
 * colour at all. Hand-painting a hue here would be a second colour system that
 * agrees with the first until somebody edits one of them.
 *
 * `cocok` WEARS THE PARAF. Nothing in the six shapes means "the two agree and
 * nobody had to do anything", and of the six the paraf is the only one that
 * means settled: `pending`'s empty box would claim nothing has looked, and
 * `unfilled`'s double rule is a decision the operator took. The word beside it
 * says which kind of settled it is, and the mark's own label carries that word
 * to a screen reader.
 */
function rowState(entry: EpicEntry): { status: SlotAggregateStatus; word: string } {
  if (entry.decision !== "belum") {
    return {
      status: "confirmed",
      word:
        entry.decision === "setuju"
          ? "Diterima"
          : entry.decision === "tolak"
            ? "Ditolak"
            : "Diketik sendiri",
    };
  }

  switch (entry.verdict) {
    case "cocok":
      return { status: "confirmed", word: "cocok" };
    case "beda":
      // TWO WORDS FOR ONE VERDICT, split on whether there is anything to
      // overwrite. `belum diisi` is not a milder `belum sesuai`: it says the
      // konfigurasi has nothing in the cell at all, which changes what accepting
      // EPIC's value would mean.
      return {
        status: "proposed",
        word: entry.excelValue === "" ? "belum diisi" : "belum sesuai",
      };
    case "tidak-ditemukan":
      return { status: "outstanding", word: "tidak ditemukan" };
    case "tidak-ada-di-excel":
      return { status: "proposed", word: "tidak ada di konfigurasi" };
    default:
      return { status: "pending", word: "belum diperiksa" };
  }
}

/**
 * Rows that owe a decision first, and ONLY ON ARRIVAL.
 *
 * A settled row keeps its place rather than jumping to the bottom, because the
 * operator works down this list and a list that reorders itself under a press
 * loses their place at the one moment they are certain where they are. So the
 * order is computed from the set of findings and recomputed only when that set
 * changes, never when a decision does.
 */
function owedFirst(entries: readonly EpicEntry[]): string[] {
  return entries
    .map((entry, at) => ({ id: epicEntryId(entry), at, owed: isOwed(entry) }))
    .sort((a, b) => (a.owed === b.owed ? a.at - b.at : a.owed ? -1 : 1))
    .map((row) => row.id);
}

/* ------------------------------------------------------------------ *
 * The drop target.
 * ------------------------------------------------------------------ */

/**
 * A TRAY CUT INTO THE BENCH, and the second one in the product.
 *
 * `DocumentDrop` in `ingest-panel.tsx` is the first and is hard-wired to PDF --
 * its refusal sentences, its accept list and its key all name one format -- so
 * this is the same recipe rather than the same component: `.lt-well` for the
 * recess, `--line-control` at rest because the whole card is a control, `--ink`
 * and `--wash` under the pointer. THE DRAG TARGET IS INK, NEVER AMBER: where a
 * pointer happens to be is not a decision owed.
 *
 * The depth counter is not fussiness. A drag over a CHILD fires `dragleave` on
 * the parent, so a boolean toggled by those two events flickers the whole time
 * the pointer is inside the tray.
 */
function Drop({
  label,
  hint,
  accept,
  keyLabel,
  icon,
  tone = "primary",
  multiple = false,
  onFiles,
  children,
}: {
  label: string;
  hint: string;
  accept: string;
  keyLabel: string;
  icon: ReactNode;
  tone?: "primary" | "default";
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  /** The consent statement, printed under the key and never behind a hover. */
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const inputId = useId();
  const labelId = useId();

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])];
    // EVERY HAND-OVER REACHES THE CALLER, including the ones that will be
    // refused. A drop that produces no reaction whatsoever is this project's
    // failure class in the interaction layer: the operator walks away believing
    // the tangkapan layar is in the order.
    if (files.length > 0) onFiles(files);
  };

  return (
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
        // the operator's own file over the top of the order.
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
      className={`lt-well flex flex-col items-center gap-4 rounded-xl px-6 py-4 text-center transition-colors duration-90 ease-[var(--ease)] ${
        over ? "border-ink bg-[var(--wash)]" : "border-line-control"
      }`}
    >
      <span className="text-ink-3">{icon}</span>

      <h3 id={labelId} className="lt-title">
        {label}
      </h3>

      <p className="text-ink-2 max-w-[52ch] text-[0.9375rem]">{hint}</p>

      <label htmlFor={inputId} className="sr-only">
        {keyLabel} dari komputer Anda
      </label>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(event) => {
          take(event.target.files);
          // Cleared, so choosing the same berkas twice still fires `change`.
          event.target.value = "";
        }}
      />
      <Btn tone={tone} onClick={() => input.current?.click()}>
        {keyLabel}
      </Btn>

      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The screen.
 * ------------------------------------------------------------------ */

export type EpicPanelProps = {
  run: BrowserRun;
  /**
   * KEEP WHAT EVERY WRITE RETURNS. `editEpic` answers with the STORED run, one
   * revision on, and the object this screen was holding is behind the moment it
   * resolves. A caller that ignored this works exactly once.
   */
  onRun: (run: BrowserRun) => void;
  /**
   * A write storage refused, handed over RAW.
   *
   * `operator-app.tsx`'s `saveFault` reads `error.name` and owns the sentence
   * for each named guard; passing the problem rather than a sentence is what
   * keeps that vocabulary in one place. This screen's own copy said half of it
   * and was found in review.
   */
  onSaveFailed: (problem: unknown) => void;
};

export function EpicPanel(props: EpicPanelProps) {
  // A different order is a different question, and every piece of state below
  // is about one: which berkas were refused, what is being read, which finding
  // is having a value typed into it. Keying on the run id says so in React's
  // own terms and resets all of it at once.
  return <Panel key={props.run.id} {...props} />;
}

function Panel({ run, onRun, onSaveFailed }: EpicPanelProps) {
  const runtime = useRuntime();

  const [fault, setFault] = useState<Fault | null>(null);
  const [refusals, setRefusals] = useState<Refusal[]>([]);
  /** The name of the berkas being read, so the wait is never silent. */
  const [reading, setReading] = useState<string | null>(null);
  /**
   * THE TANGKAPAN LAYAR HANDED OVER AND NOT YET READ, and the flag that says
   * one loop owns them.
   *
   * A REF RATHER THAN STATE, for the reason `operator-app.tsx` gives about the
   * berkas antrean: a drop lands while the loop is between two files, and React
   * state read there is a value from a render that has already been superseded.
   * Nothing draws this one, because the berkas being read is named beside the
   * spinner and a screenshot is seconds rather than the minutes a 27-page scan
   * takes; the moment it needs drawing it needs a `setQueueTo` that writes both.
   */
  const antrean = useRef<File[]>([]);
  const draining = useRef(false);
  const [comparing, setComparing] = useState(false);
  /** Which finding is being written, and which one to draw the paraf on. */
  const [writing, setWriting] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  /** Which finding has `Ketik sendiri` open. */
  const [typing, setTyping] = useState<string | null>(null);
  /** Has the operator asked for the workbook drop at the gate? */
  const [wantsWorkbook, setWantsWorkbook] = useState(false);
  const [changingBasis, setChangingBasis] = useState(false);
  /** How much of the newest workbook could not be used, as it was read. */
  const [unusable, setUnusable] = useState<
    { label: string; reason: string }[]
  >([]);
  /**
   * The newest workbook was larger than one pass can carry, as it was read.
   *
   * BOTH SIZES, BECAUSE THERE ARE TWO CAPS AND THEY CUT DIFFERENT THINGS.
   * `listingTruncated` is an OR over the cell cap and the merge cap, and this
   * screen used to answer it with `read: MAX_LISTING_CELLS`, so a sheet whose
   * merges alone were cut printed "4000 dari 159 sel yang terbaca" -- a figure
   * larger than the total, followed by a sentence saying isian went unread when
   * every one of them had been listed. The counts are kept and the clauses are
   * chosen from them below.
   */
  const [truncated, setTruncated] = useState<{
    cells: number;
    merges: number;
  } | null>(null);

  /**
   * THE ROW ORDER IS TAKEN FROM THE SET OF FINDINGS, NOT FROM THE DECISIONS.
   *
   * Rows that owe a decision sort first ON ARRIVAL, and a settled row then
   * keeps its place rather than jumping to the bottom: the operator works down
   * this list, and a list that reorders itself under a press loses their place
   * at the one moment they are certain where they are.
   *
   * Adjusted during render, which is React's own documented shape for "change
   * some state when an input changes" and the shape `outstanding-panel.tsx`
   * already uses. An effect would paint the old order and then the new one, so
   * the one thing that moves in this product would be a list flinching rather
   * than a paraf being drawn.
   *
   * ABOVE THE BASIS GATE, because a hook cannot sit behind an early return.
   * Before the question is answered `run.epic.entries` is empty, which this
   * handles as the empty list it is.
   */
  const ids = run.epic.entries.map(epicEntryId).join(" ");
  const [orderKey, setOrderKey] = useState(ids);
  const [order, setOrder] = useState<string[]>(() =>
    owedFirst(run.epic.entries),
  );
  if (orderKey !== ids) {
    setOrderKey(ids);
    setOrder(owedFirst(run.epic.entries));
  }

  const busy = reading !== null || comparing;

  /**
   * ONE WRITE, ONE PLACE, AND THE ANSWER IS KEPT.
   *
   * A FAILURE GOES UPWARD RAW, and it used to be answered here. The sentence
   * this composed was `docs/ui-bahasa.md`'s own minus its second half: "Order
   * gagal disimpan, jadi keputusan terakhir Anda hanya ada di tab ini" with no
   * `: {sebab}`, which tells the operator a decision was lost and nothing about
   * what to do next -- and every remedy differs by guard (muat ulang for a
   * stale write, kosongkan order lama for a full quota, lihat lagi daftar
   * isiannya for a `ConfigEditError`). `saveFault` in `operator-app.tsx` owns
   * that vocabulary, so this hands over the problem and says nothing.
   */
  const save = async (edit: EpicEdit): Promise<boolean> => {
    try {
      onRun(await runtime.editEpic(run.id, edit));
      return true;
    } catch (problem) {
      onSaveFailed(problem);
      return false;
    }
  };

  const refuse = (sentence: string, detail?: string) =>
    setRefusals((before) => [
      ...before,
      { id: crypto.randomUUID(), sentence, detail },
    ]);

  const interruptions = (
    <>
      {fault ? (
        <Interruption detail={fault.detail}>{fault.sentence}</Interruption>
      ) : null}
      {refusals.map((refusal) => (
        <Interruption key={refusal.id} detail={refusal.detail}>
          {refusal.sentence}
        </Interruption>
      ))}
    </>
  );

  /* --------------------------------------------------- the newest workbook */

  /**
   * The operator's answer of "yes, here is a newer one", read on this device.
   *
   * The order is deliberate: OPEN, then INTERPRET, then STORE THE BYTES, then
   * write the run. A refusal at any step leaves nothing behind, and the bytes
   * are only kept once there is something for them to be the bytes OF.
   */
  const takeWorkbook = async (files: File[]) => {
    setRefusals([]);
    const file = files[0];
    if (!file) return;

    if (!isXlsx(file)) {
      refuse(
        `Bukan berkas .xlsx, jadi tidak ada yang dibaca: ${file.name}. Simpan konfigurasinya sebagai .xlsx dulu, lalu muat lagi.`,
      );
      return;
    }

    setReading(file.name);
    setUnusable([]);
    setTruncated(null);
    try {
      const bytes = await file.arrayBuffer();
      const digest = await digestOf(bytes);
      const { sheet, sheetNames } = await openWorkbook(file);

      const answer = await requestConfigCheck(buildFieldsOnlyRequest(run, sheet));
      const fields = answer.fields ?? [];
      if (fields.length === 0) {
        refuse(
          `Tidak ada isian yang bisa dibaca dari ${file.name}, jadi tidak ada pembanding untuk EPIC. Periksa apakah berkasnya berisi lembar konfigurasi order ini, lalu muat lagi.`,
          answer.note,
        );
        return;
      }

      const id = crypto.randomUUID();
      await runtime.putCheckpointFile(run.id, id, file.name, bytes);

      const stored = await save({
        tag: "set-basis",
        basis: "baru",
        workbook: workbookRecord(id, file, sheet, sheetNames, digest),
        fields,
      });
      if (!stored) return;

      setUnusable(
        (answer.unusable ?? []).map((one) => ({
          label: one.label,
          reason: one.reason,
        })),
      );
      // SAID OUT LOUD, NEVER SWALLOWED. A workbook larger than one pass can
      // carry was read in part, and a screen that reported the part as the
      // whole is exactly the silence this product exists to break. WHICH cap
      // cut it is decided at the notice, off these two counts: `sheetListing`
      // cuts cells and merges independently, and `listingTruncation` in
      // `src/lib/xlsx/listing.ts` derives the cause in English for the prompt.
      if (listingTruncated(sheet)) {
        setTruncated({
          cells: sheet.cells.length,
          merges: sheet.merges.length,
        });
      }
      setWantsWorkbook(false);
    } catch (problem) {
      refuse(
        `Berkas konfigurasi ini gagal dibaca, jadi belum ada pembanding: ${file.name}. Coba muat lagi.`,
        messageOf(problem),
      );
    } finally {
      setReading(null);
    }
  };

  /* ------------------------------------------------------- the tangkapan */

  /**
   * EVERY HAND-OVER IS ACCEPTED, AND A SECOND DROP JOINS THE ANTREAN.
   *
   * It used to start a second loop. Reading one tangkapan layar is a `/api/ocr`
   * round trip, the tray invites "sebanyak yang Anda perlu", and the tray never
   * stands down, so a second drop while the first was in flight was the
   * ordinary case rather than a corner: two loops then shared `seen`, `reading`
   * and `refusals`, the second cleared the first's refusals, and whichever
   * finished first put `reading` back to null under the other. The berkas
   * hand-over in `operator-app.tsx` solved exactly this and this is its shape.
   */
  const takeCaptures = (files: File[]) => {
    antrean.current = [...antrean.current, ...files];
    void drainCaptures();
  };

  /**
   * The screenshots, one at a time, in the order they were handed over.
   *
   * IT IS RE-ENTRANT-SAFE BY THE `draining` FLAG AND NOTHING ELSE. Every
   * hand-over calls this; only the one that finds the flag down actually runs,
   * and the rest have simply added to a list the running loop has not reached
   * yet.
   *
   * SCREENED BEFORE THE ROUTE IS CALLED, in Bahasa, on the bytes. `addEpicCapture`
   * refuses a second copy too and its message is English by design
   * (`src/lib/browser/config.ts`: every operator-facing sentence about a
   * duplicate belongs on the screen that refused to submit it), so the screen
   * has to own the sentence and the storage guard is the net behind it.
   *
   * `seen` catches the pair inside ONE drop AND across the ones that joined the
   * antrean behind it: hashing is async, so two files of the same bytes would
   * each be screened against a run neither had reached yet. It is built once
   * per drain and added to as each capture lands, which is why the loop has to
   * be the only one running.
   */
  const drainCaptures = async () => {
    if (draining.current) return;
    if (antrean.current.length === 0) return;
    draining.current = true;
    // CLEARED BY THE LOOP, NOT BY THE HAND-OVER. A drop that joins a running
    // antrean must not wipe the refusals the running loop has already printed:
    // those name berkas that are NOT in this order, and an operator who never
    // sees one walks away believing the tangkapan layar is in it.
    setRefusals([]);
    const seen = new Set(run.epic.captures.map((capture) => capture.digest));
    const named = new Map(
      run.epic.captures.map((capture) => [capture.digest, capture.name]),
    );

    try {
      while (antrean.current.length > 0) {
        const [file, ...rest] = antrean.current;
        antrean.current = rest;
        if (!isCapture(file)) {
          refuse(
            `Bukan gambar PNG atau JPEG, jadi tidak dipakai: ${file.name}. Simpan tangkapan layarnya sebagai PNG atau JPEG dulu, lalu muat lagi.`,
          );
          continue;
        }

        setReading(file.name);
        try {
          const digest = await digestOf(await file.arrayBuffer());
          if (seen.has(digest)) {
            refuse(
              `Tangkapan layar ini sudah ada di order dengan nama ${
                named.get(digest) ?? file.name
              }, jadi tidak dipakai lagi: ${file.name}.`,
            );
            continue;
          }

          const png = await toPngBytes(file);
          const read = await recogniseCapture(png);

          // THE ONE UNAMBIGUOUS SIGNAL, AND IT IS SPENT HERE. Nothing is
          // stored: a blank capture kept in silence would make every isian on
          // it report `tidak ditemukan`, and the operator would go looking for
          // a berkas that does not exist rather than taking the screenshot
          // again.
          if (read.lines.length === 0) {
            refuse(
              `Tangkapan layar ini tidak terbaca, jadi tidak dipakai: ${file.name}. Coba ambil ulang dengan tampilan yang lebih besar.`,
            );
            continue;
          }

          const id = crypto.randomUUID();
          await runtime.putCheckpointFile(
            run.id,
            id,
            file.name,
            png.buffer.slice(
              png.byteOffset,
              png.byteOffset + png.byteLength,
            ) as ArrayBuffer,
          );

          const capture: EpicCapture = {
            id,
            name: file.name,
            digest,
            width: read.width,
            height: read.height,
            lines: read.lines,
          };
          const stored = await save({ tag: "add-capture", capture });
          if (!stored) {
            /*
             * A REFUSED WRITE STOPS THE ANTREAN, AND WHAT IS LEFT IS NAMED.
             *
             * The shell is already printing the refusal and its remedy is
             * "muat ulang halaman ini", so reading the rest would spend an
             * `/api/ocr` call each to be told the same thing again. But a
             * hand-over that simply vanishes is this project's failure class
             * in the interaction layer, and nothing here can resume an
             * antrean, so the berkas that will not be read are listed BY NAME
             * rather than dropped in silence.
             */
            const left = antrean.current;
            antrean.current = [];
            if (left.length > 0) {
              refuse(
                `${left.length} tangkapan layar belum sempat dibaca, jadi belum ada di order ini: ${left
                  .map((one) => one.name)
                  .join(
                    ", ",
                  )}. Order ini gagal disimpan, jadi selesaikan itu dulu, lalu muat tangkapan layarnya lagi.`,
              );
            }
            break;
          }
          seen.add(digest);
          named.set(digest, file.name);
        } catch (problem) {
          // ONE BERKAS, NOT THE REST OF THE ANTREAN. An operator hands over
          // four screenshots at once and one of them being unreadable must not
          // throw the other three away.
          refuse(
            `Tangkapan layar ini gagal dibaca, jadi tidak dipakai: ${file.name}. Coba muat lagi.`,
            messageOf(problem),
          );
        }
      }
    } finally {
      // Lowered before `reading` is cleared, so a hand-over landing in this
      // same tick finds the loop free and starts it again rather than queueing
      // behind a loop that has already finished. `reading` clears once, at the
      // end of the whole antrean, rather than per berkas: it is what holds the
      // compare key and the remove keys, and a gap between two files would
      // offer them for one tick in the middle of a read.
      draining.current = false;
      setReading(null);
    }
  };

  /* ------------------------------------------------------------ the gate */

  if (run.epic.basis === "belum") {
    return (
      <div className="flex flex-col gap-6">
        <Title>Cocokkan EPIC dengan konfigurasi</Title>
        <Lede>
          Yang menilai di layar ini adalah berkas konfigurasi order ini, dan yang
          dinilai adalah tampilan EPIC. Sebelum mulai, satu pertanyaan.
        </Lede>

        {interruptions}

        <section aria-labelledby="epic-basis-head" className="lt-slab">
          <div className="lt-kop" data-owes="decision">
            <h3 id="epic-basis-head">Pembanding untuk EPIC</h3>
          </div>

          <div className="lt-slab-body flex flex-col gap-4">
            {/* THE QUESTION IS PROSE, and it is the whole gate. Nothing below
                renders until it is answered, because an order that quietly
                assumed one of the two answers would judge EPIC against a
                workbook the operator had already replaced. */}
            <p className="text-ink max-w-[74ch] text-[0.9375rem]">
              Apakah berkas konfigurasi berubah lagi setelah Checkpoint 2?
            </p>

            <div className="flex flex-wrap gap-2">
              <Btn
                tone="primary"
                on={wantsWorkbook}
                disabled={busy}
                reason="Tunggu berkas konfigurasi selesai dibaca."
                onClick={() => setWantsWorkbook(true)}
              >
                Ya, saya punya yang terbaru
              </Btn>
              <Btn
                disabled={busy}
                reason="Tunggu berkas konfigurasi selesai dibaca."
                onClick={() => void save({ tag: "set-basis", basis: "lanjutkan" })}
              >
                Tidak, pakai hasil Checkpoint 2
              </Btn>
            </div>

            {/* WHAT EACH ANSWER MEANS, under the keys rather than inside them.
                "Hasil Checkpoint 2" is not a file the operator can point at, so
                it is spelled out: it is their own berkas with every perubahan
                they accepted there already applied. */}
            <div className="flex flex-col gap-2">
              <p className="text-ink-2 max-w-[74ch] text-[0.8125rem]">
                Ya: Anda muat berkas konfigurasi yang terbaru sekarang, dan EPIC
                dinilai terhadap berkas itu.
              </p>
              <p className="text-ink-2 max-w-[74ch] text-[0.8125rem]">
                Tidak: EPIC dinilai terhadap hasil Checkpoint 2, yaitu berkas
                konfigurasi Anda dengan setiap perubahan yang sudah Anda terima
                di sana.
              </p>
            </div>

            {wantsWorkbook ? (
              <Drop
                label="Muat berkas konfigurasi terbaru"
                hint="Satu berkas .xlsx, yaitu konfigurasi order ini seperti yang berlaku sekarang."
                accept={`.xlsx,${XLSX_TYPE}`}
                keyLabel="Pilih berkas konfigurasi"
                icon={<BukuKerja size={40} />}
                onFiles={(files) => void takeWorkbook(files)}
              >
                {/* A CONSENT STATEMENT, so it is prose and may never become a
                    hover. It is also the honest half: the bytes stay here and
                    the text does not. */}
                <p className="text-ink-2 max-w-[62ch] text-[0.8125rem]">
                  Berkas konfigurasi tidak diunggah. Isinya dibaca di peramban
                  ini, dan hanya teks tiap sel yang dikirim ke server aplikasi.
                </p>
              </Drop>
            ) : null}

            <Working name={reading} what="Membaca berkas konfigurasi" />
          </div>
        </section>
      </div>
    );
  }

  /* ------------------------------------------------------- past the gate */

  const check = run.epic;
  const fields: ConfigField[] =
    check.basis === "baru" ? check.fields : effectiveFields(run.konfigurasi);
  const fieldOf = new Map(fields.map((field) => [field.id, field]));
  const captureOf = new Map(
    check.captures.map((capture) => [capture.id, capture]),
  );
  const summary = epicSummary(check);
  const decided = check.entries.filter(
    (entry) => entry.decision !== "belum",
  ).length;

  const byId = new Map(check.entries.map((entry) => [epicEntryId(entry), entry]));
  const ordered = order
    .map((id) => byId.get(id))
    .filter((entry): entry is EpicEntry => entry !== undefined);

  const anchorOf = (at: number) => `epic-isian-${run.id}-${at}`;

  const hold = comparing
    ? "Tunggu pencocokan dengan EPIC selesai."
    : reading !== null
      ? "Tunggu tangkapan layar selesai dibaca."
      : undefined;

  const compare = async () => {
    setComparing(true);
    setFault(null);
    try {
      const answer = await requestEpicCheck(
        buildEpicRequest(run, fields, check.captures),
      );
      await save({ tag: "record-comparison", entries: answer.entries });
    } catch (problem) {
      setFault({
        sentence:
          "Pencocokan dengan EPIC gagal, jadi tidak ada temuan baru. Tangkapan layar yang sudah dimuat tetap tersimpan, dan Anda bisa mencoba lagi.",
        detail: messageOf(problem),
      });
    } finally {
      setComparing(false);
    }
  };

  const decide = async (
    entry: EpicEntry,
    decision: EpicEntry["decision"],
    manualValue?: string,
  ) => {
    const entryId = epicEntryId(entry);
    setWriting(entryId);
    setFresh(entryId);
    setTyping(null);
    await save(
      decision === "manual"
        ? { tag: "decide", entryId, decision, manualValue: manualValue ?? "" }
        : { tag: "decide", entryId, decision },
    );
    setWriting(null);
  };

  /** No yardstick at all: `lanjutkan` on an order that never reached Checkpoint 2. */
  const noYardstick = fields.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <Title>Cocokkan EPIC dengan konfigurasi</Title>

      {interruptions}

      {/* THE RINGKASAN THE CLIENT ASKED FOR BY NAME, AT THE TOP. Checkpoint 3
          writes no file: this list IS what it produces, so it is the subject of
          the screen rather than a summary of one. */}
      {check.entries.length > 0 ? (
        <Ringkasan
          entries={ordered}
          fieldOf={fieldOf}
          anchorOf={anchorOf}
          counts={summary}
        />
      ) : null}

      {/* WHICH WORKBOOK IS DOING THE JUDGING, named before anything is judged. */}
      <section aria-labelledby="epic-pembanding-head" className="lt-slab">
        <div className="lt-kop" data-owes={noYardstick ? "fault" : undefined}>
          <h3 id="epic-pembanding-head">Pembanding</h3>
          {/* The figure is mono and the word beside it is not: "isian" is a
              word the app says, not a figure the document carries. */}
          <span className="lt-kop-right flex items-baseline gap-2">
            <span className="lt-figure">{fields.length}</span>
            isian
          </span>
        </div>

        <div className="lt-slab-body flex flex-col gap-4">
          {check.basis === "baru" && check.workbook ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="lt-label">berkas konfigurasi terbaru</span>
              <span className="lt-kotak" title={check.workbook.name}>
                {shortenFileName(check.workbook.name, 34)}
              </span>
              <span className="lt-label">lembar</span>
              <span className="lt-kotak">{check.workbook.sheet}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="lt-label">hasil Checkpoint 2</span>
              <Note>
                Berkas konfigurasi Anda dengan setiap perubahan yang sudah Anda
                terima di Checkpoint 2.
              </Note>
            </div>
          )}

          {noYardstick ? (
            /* A BLOCKING CONDITION, SO IT IS PROSE: count, noun, remedy. The
               key below carries the same reason, but a sentence the operator
               may miss entirely and be no worse off is not this one. */
            <Notice tone="stop">
              Belum ada satu pun isian dari Checkpoint 2, jadi tidak ada
              pembanding untuk EPIC. Muat berkas konfigurasi di Checkpoint 2
              dulu, atau ganti pembandingnya di sini dan muat berkas yang
              terbaru.
            </Notice>
          ) : null}

          {truncated ? (
            /* THE ONE THAT MUST NOT BE QUIET. Silent truncation reading as full
               coverage is the failure this product exists to prevent, so it is
               said in prose, with the numbers, and with what it means.

               ONE CLAUSE PER CAP THAT ACTUALLY FIRED, which a review found this
               screen was not doing: it named the CELL cap whichever cap had cut
               the sheet, so a workbook whose merges alone were cut printed a
               figure larger than its own total and then told the operator that
               isian had gone unread when none had. The two arms say different
               things because the two cuts cost different things, and only the
               first one loses an isian. */
            <Notice tone="stop">
              <div className="flex flex-col gap-2">
                <p>
                  Berkas konfigurasi ini lebih besar daripada yang bisa dibaca
                  sekali jalan.
                </p>
                {truncated.cells > MAX_LISTING_CELLS ? (
                  <p>
                    {MAX_LISTING_CELLS} dari {truncated.cells} sel terisi yang
                    terbaca. Isian di luar bagian itu tidak pernah dilihat, jadi
                    tidak ikut dinilai terhadap EPIC.
                  </p>
                ) : null}
                {truncated.merges > MAX_LISTING_MERGES ? (
                  <p>
                    {MAX_LISTING_MERGES} dari {truncated.merges} sel gabungan
                    yang terbaca. Setiap isian tetap terbaca, tetapi bentuk
                    lembarnya terbaca kurang utuh, jadi periksa lagi kalau ada
                    isian yang terpasang pada sel yang salah.
                  </p>
                ) : null}
              </div>
            </Notice>
          ) : null}

          {unusable.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Advisory>
                {unusable.length} isian dari berkas konfigurasi ini tidak bisa
                dipakai, karena namanya tidak cocok dengan sel yang dirujuknya,
                jadi isian itu tidak ikut dinilai. Buka berkasnya dan periksa
                apakah nama dan nilainya sejajar, lalu muat lagi kalau perlu.
              </Advisory>
              <TechnicalDetail>
                {unusable
                  .map((one) => `${one.label}  ${one.reason}`)
                  .join("\n")}
              </TechnicalDetail>
            </div>
          ) : null}

          {/* CHANGING THE PEMBANDING CLEARS EVERY TEMUAN, and the rulings on
              them go too, because a "Terima" on "EPIC shows X where the sheet
              says Y" means nothing once Y comes from a different sheet. It asks
              in proportion: one press while nothing is decided, a confirmation
              once something is. */}
          {changingBasis ? (
            /* WARN, NOT STOP. `--gap` is a fault or a refusal and is absent
               from a healthy screen; nothing has failed here and nothing has
               been refused, the operator is being asked a question and both
               answers are live keys inside it. Amber is the hue for a decision
               owed, which is exactly what this block is. The red stays on the
               key that performs the act, which is the house pattern. */
            <Notice tone="warn">
              <div className="flex flex-col gap-3">
                <p>
                  {decided} keputusan Anda di layar ini ikut hilang kalau
                  pembandingnya diganti, karena setiap keputusan itu tentang
                  isian di pembanding yang sekarang. Tangkapan layar EPIC tetap
                  tersimpan.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Btn
                    tone="reject"
                    onClick={() => {
                      setChangingBasis(false);
                      setWantsWorkbook(false);
                      void save({ tag: "set-basis", basis: "belum" });
                    }}
                  >
                    Ya, ganti pembandingnya
                  </Btn>
                  <Btn onClick={() => setChangingBasis(false)}>Batal</Btn>
                </div>
              </div>
            </Notice>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Btn
                disabled={hold !== undefined}
                reason={hold}
                onClick={() => {
                  if (decided > 0) {
                    setChangingBasis(true);
                    return;
                  }
                  setWantsWorkbook(false);
                  void save({ tag: "set-basis", basis: "belum" });
                }}
              >
                Ganti pembanding
              </Btn>
              <span className="text-ink-2 text-[0.8125rem]">
                Kembali ke pertanyaan tentang berkas konfigurasi terbaru.
              </span>
            </div>
          )}
        </div>
      </section>

      {/* THE TANGKAPAN LAYAR, WHICH ARE THE ONLY THING EPIC IS READ FROM. */}
      <section aria-labelledby="epic-tangkapan-head" className="lt-slab">
        {/* NO `data-owes`, AND THAT IS THE RULE RATHER THAN AN OVERSIGHT. An
            order with no tangkapan layar yet owes WORK, not a decision, and
            `--mark` means a decision is owed here and nothing else ever. The
            primary key on the tray below is what says this is the move. */}
        <div className="lt-kop">
          <h3 id="epic-tangkapan-head">Tangkapan layar EPIC</h3>
          <span className="lt-figure lt-kop-right">
            {check.captures.length}
          </span>
        </div>

        <div className="lt-slab-body flex flex-col gap-4">
          <Drop
            label="Muat tangkapan layar EPIC"
            hint="Ambil tangkapan layar EPIC untuk order ini, sebanyak yang Anda perlu. PNG atau JPEG."
            accept="image/png,image/jpeg"
            keyLabel="Pilih tangkapan layar"
            icon={<Klip size={40} />}
            tone={check.captures.length === 0 ? "primary" : "default"}
            multiple
            onFiles={takeCaptures}
          >
            {/* A CONSENT STATEMENT IN THE OTHER DIRECTION, and it is stated
                plainly for that reason. Every other berkas in this product
                stays on the device; a screen capture has no text until
                something reads it, so the image itself goes. */}
            <p className="text-ink-2 max-w-[62ch] text-[0.8125rem]">
              Gambar tangkapan layar dikirim ke server aplikasi untuk dibaca
              teksnya.
            </p>
          </Drop>

          <Working name={reading} what="Membaca tangkapan layar" />

          {check.captures.length > 0 ? (
            <>
              <ul
                aria-label="Tangkapan layar EPIC di order ini"
                className="border-line flex flex-col border-t"
              >
                {check.captures.map((capture) => (
                  <li
                    key={capture.id}
                    className="border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-2"
                  >
                    <span className="lt-kotak" title={capture.name}>
                      {shortenFileName(capture.name, 34)}
                    </span>
                    <span className="lt-kotak">
                      {capture.lines.length} baris
                    </span>
                    <span className="ms-auto">
                      <Btn
                        tone="reject"
                        disabled={hold !== undefined}
                        reason={hold}
                        onClick={() =>
                          void save({
                            tag: "remove-capture",
                            captureId: capture.id,
                          })
                        }
                      >
                        Hapus tangkapan ini
                      </Btn>
                    </span>
                  </li>
                ))}
              </ul>
              <Note>
                Temuan yang dibaca dari sebuah tangkapan layar ikut hilang kalau
                tangkapannya dihapus, termasuk keputusan Anda atas temuan itu.
              </Note>
            </>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Btn
              tone="primary"
              disabled={
                hold !== undefined || noYardstick || check.captures.length === 0
              }
              reason={
                hold ??
                (noYardstick
                  ? "Belum ada isian pembanding untuk order ini."
                  : "Muat dulu tangkapan layar EPIC.")
              }
              onClick={() => void compare()}
            >
              {check.entries.length > 0
                ? "Cocokkan sekali lagi"
                : "Cocokkan dengan konfigurasi"}
            </Btn>
            {check.entries.length > 0 ? (
              <span className="text-ink-2 max-w-[52ch] text-[0.8125rem]">
                Keputusan yang sudah Anda ambil tetap tersimpan.
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {/* THE REGISTER. */}
      {check.entries.length > 0 ? (
        <Register
          entries={ordered}
          fieldOf={fieldOf}
          captureOf={captureOf}
          anchorOf={anchorOf}
          hold={hold}
          writing={writing}
          fresh={fresh}
          typing={typing}
          onType={setTyping}
          onDecide={(entry, decision, manualValue) =>
            void decide(entry, decision, manualValue)
          }
        />
      ) : null}
    </div>
  );
}

/**
 * A read in progress, named.
 *
 * Its own live region, because a wait that produces no reaction is a wait the
 * operator answers by dropping the berkas again.
 */
function Working({ name, what }: { name: string | null; what: string }) {
  return (
    <div role="status" aria-live="polite">
      {name ? (
        <p className="text-ink flex flex-wrap items-center gap-3 text-[0.9375rem]">
          <span className="lt-spinner" aria-hidden="true" />
          <span>
            {what}: <span className="lt-figure">{shortenFileName(name, 34)}</span>
          </span>
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The ringkasan.
 * ------------------------------------------------------------------ */

/**
 * WHAT THE CLIENT ASKED FOR BY NAME, and the reason it is affirmative when it
 * is empty.
 *
 * An absent warning is not a confirmation. A screen that simply showed nothing
 * when EPIC and the konfigurasi agree is indistinguishable from one that failed
 * to compare them, so the clear is a sentence rather than a silence.
 *
 * IT NAMES EVERY ISIAN AND LINKS TO ITS ROW. A count is not checkable against
 * anything: the operator is about to read EPIC on another screen, and what they
 * need in their hand is the list of names, in the order they will meet them
 * below.
 */
function Ringkasan({
  entries,
  fieldOf,
  anchorOf,
  counts,
}: {
  entries: readonly EpicEntry[];
  fieldOf: Map<string, ConfigField>;
  anchorOf: (at: number) => string;
  counts: {
    belumSesuai: number;
    tidakDitemukan: number;
    tidakAdaDiExcel: number;
    /** `beda` and still `belum`. See the kop below for why it is the number. */
    owed: number;
  };
}) {
  const flagged = entries
    .map((entry, at) => ({ entry, at }))
    .filter((row) => isFlagged(row.entry));

  return (
    <section aria-labelledby="epic-ringkasan-head" className="lt-slab">
      {/* THREE STATES, AND THE MIDDLE ONE IS THE POINT.

          Amber counts DECISIONS OWED and never findings, which is what
          `epicSummary().owed` counts and what `GroupBlock` twenty lines down
          already does. Driven off `flagged.length` this kop stayed amber after
          every decision on it had been taken, so the one screen whose whole
          output is a list of disagreements could never lose its colour, and
          amber stops being read.

          `done` is kept for the affirmative clear only. A ringkasan holding
          three `tidak ditemukan` owes no decision and is not finished either:
          petrol there would say there is nothing left to ask while naming
          three isian that are missing. So it carries no hue at all. */}
      <div
        className="lt-kop"
        data-owes={
          counts.owed > 0
            ? "decision"
            : flagged.length === 0
              ? "done"
              : undefined
        }
      >
        <h3 id="epic-ringkasan-head">Ringkasan EPIC</h3>
        {flagged.length > 0 ? (
          <span className="lt-figure lt-kop-right">{flagged.length}</span>
        ) : null}
      </div>

      <div className="lt-slab-body flex flex-col gap-4">
        <p aria-live="polite" className="sr-only">
          {flagged.length} isian di EPIC perlu Anda lihat.
        </p>

        {flagged.length === 0 ? (
          <p className="text-ink max-w-[74ch] text-[0.9375rem]">
            Semua isian di EPIC cocok dengan konfigurasi.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Counted n={counts.belumSesuai} word="belum sesuai" />
              <Counted
                n={counts.tidakDitemukan}
                word="tidak ditemukan di tangkapan layar"
              />
              <Counted
                n={counts.tidakAdaDiExcel}
                word="tidak ada di konfigurasi"
              />
            </div>

            <ul
              aria-label="Isian yang perlu Anda lihat"
              className="border-line flex flex-col border-t"
            >
              {flagged.map(({ entry, at }) => {
                const field = entry.fieldId
                  ? fieldOf.get(entry.fieldId)
                  : undefined;
                const { status, word } = rowState(entry);
                return (
                  <li
                    key={anchorOf(at)}
                    className="border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-2"
                  >
                    <Mark status={status} title={`${entry.label}: ${word}`} />
                    {/* PETROL, because a link is interaction and not a status.
                        Amber here would say a decision is owed on the LINK. */}
                    <a
                      className="lt-figure text-petrol font-bold underline underline-offset-4"
                      href={`#${anchorOf(at)}`}
                      onClick={(event) => {
                        /*
                         * THE FRAGMENT IS NOT A SPARE SURFACE, and following
                         * this link used to spend it.
                         *
                         * `src/lib/ui/run-address.ts` is the only place the
                         * address bar is written, and it puts WHICH ORDER IS
                         * OPEN there as `run/<id>`; `runIdFromHash` answers ""
                         * for anything else, and the workspace's boot effect
                         * consults nothing else. So a real fragment navigation
                         * here overwrote the pointer with a DOM id, nothing
                         * ever restored it, and the next reload opened no order
                         * at all -- in silence, after a three-minute ingest. It
                         * also printed the run's system id on screen, which
                         * this product never does.
                         *
                         * The `href` stays: it is what makes the row a real
                         * link to a screen reader, and `preventDefault` covers
                         * a keyboard Enter too, since that dispatches a click.
                         */
                        const target = document.getElementById(anchorOf(at));
                        if (!target) return;
                        event.preventDefault();
                        target.scrollIntoView({ block: "start" });
                      }}
                    >
                      {entry.label}
                    </a>
                    {field?.group ? (
                      <span className="lt-figure text-ink-2 text-[0.8125rem]">
                        {field.group}
                      </span>
                    ) : null}
                    <StateWord status={status}>{word}</StateWord>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/** One counted reason, silent when it counts nothing. */
function Counted({ n, word }: { n: number; word: string }) {
  if (n === 0) return null;
  return (
    <span className="flex items-baseline gap-2 text-[0.9375rem]">
      <span className="lt-figure font-bold">{n}</span>
      <span className="text-ink-2">{word}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * The register.
 * ------------------------------------------------------------------ */

type RowProps = {
  entries: readonly EpicEntry[];
  fieldOf: Map<string, ConfigField>;
  captureOf: Map<string, EpicCapture>;
  anchorOf: (at: number) => string;
  hold: string | undefined;
  writing: string | null;
  fresh: string | null;
  typing: string | null;
  onType: (entryId: string | null) => void;
  onDecide: (
    entry: EpicEntry,
    decision: EpicEntry["decision"],
    manualValue?: string,
  ) => void;
};

/**
 * Every finding, grouped by service where the workbook has services.
 *
 * TWO OF THE THREE REAL WORKBOOKS CARRY ONE ROW PER SERVICE, so the same isian
 * name appears twice and `ConfigField.group` is the only thing telling them
 * apart. A row with a group and no way to see it is a decision taken against the
 * wrong service, so the group is printed on the row AND carries the block it
 * sits in.
 */
function Register(props: RowProps) {
  const { entries, fieldOf } = props;

  const groups: { name: string | null; rows: { entry: EpicEntry; at: number }[] }[] =
    [];
  entries.forEach((entry, at) => {
    const name = entry.fieldId
      ? (fieldOf.get(entry.fieldId)?.group ?? null)
      : null;
    const group = groups.find((one) => one.name === name);
    if (group) group.rows.push({ entry, at });
    else groups.push({ name, rows: [{ entry, at }] });
  });

  const grouped = groups.some((group) => group.name !== null);

  return (
    <section aria-labelledby="epic-register-head" className="lt-slab">
      <div className="lt-kop">
        <h3 id="epic-register-head">Isian</h3>
        <span className="lt-kop-right flex items-center gap-2">
          <span className="lt-figure">{entries.length}</span>
          {/* THE EXPLANATION THAT NEVER CHANGES, so it may hide. What Terima and
              Tolak mean here reads word for word the same on every order. */}
          <Hint label="Arti Terima dan Tolak di layar ini">
            <strong>Terima</strong> berarti yang benar adalah nilai di EPIC.{" "}
            <strong>Tolak</strong> berarti yang benar adalah nilai di
            konfigurasi. <strong>Ketik sendiri</strong> berarti keduanya salah
            dan Anda yang menuliskan nilainya. Keputusan ini dicatat sebagai
            hasil pemeriksaan; berkas konfigurasi disimpan di Checkpoint 2.
          </Hint>
        </span>
      </div>

      <div className="lt-slab-body flex flex-col gap-4">
        {grouped ? (
          groups.map((group) => (
            <GroupBlock
              key={group.name ?? "tanpa-kelompok"}
              name={group.name}
              rows={group.rows}
              {...props}
            />
          ))
        ) : (
          /* Every field carries the same group, or none does, so there is
             exactly one bucket here and a block around it would be a heading
             that says nothing. */
          <Rows rows={groups[0]?.rows ?? []} {...props} />
        )}
      </div>
    </section>
  );
}

/** One service's isian, in a set-in block carrying that service's own name. */
function GroupBlock({
  name,
  rows,
  ...rest
}: RowProps & {
  name: string | null;
  rows: { entry: EpicEntry; at: number }[];
}) {
  const owed = rows.filter((row) => isOwed(row.entry)).length;

  return (
    <section className="lt-slab-flat">
      {/* THE 4px RULE DOWN THE LEADING EDGE IS THE LOUDEST CHANNEL AND THE ONE
          THAT READS DOWN A COLUMN, which is what this screen is. Never a
          saturated fill under light text. */}
      <div className="lt-kop" data-owes={owed > 0 ? "decision" : undefined}>
        {/* MONO ONLY FOR A REAL KELOMPOK: that is the workbook's own word for
            the row, an SID or a location name read off the sheet. The fallback
            is the app naming a bucket of its own, and setting it in the
            document's voice is exactly the habit `docs/ui-bahasa.md` removed --
            making a small app label look technical. Size and weight come from
            `.lt-kop`, so only the face changes. */}
        <h4 className={name === null ? undefined : "lt-figure"}>
          {name ?? "Tanpa kelompok"}
        </h4>
        {owed > 0 ? (
          <span className="lt-kop-right flex items-baseline gap-2">
            <span className="lt-figure">{owed}</span>
            belum diputuskan
          </span>
        ) : null}
      </div>
      <div className="lt-slab-body">
        <Rows rows={rows} {...rest} />
      </div>
    </section>
  );
}

function Rows({
  rows,
  ...rest
}: RowProps & { rows: { entry: EpicEntry; at: number }[] }) {
  return (
    <ul aria-label="Isian EPIC" className="border-line flex flex-col border-t">
      {rows.map(({ entry, at }) => (
        <Row key={rest.anchorOf(at)} entry={entry} at={at} {...rest} />
      ))}
    </ul>
  );
}

/**
 * ONE ISIAN.
 *
 * SIZE IS AN ARGUMENT, so the row is as long as the work left in it. A finding
 * that owes a decision carries both values, its sumber and its three keys; a
 * settled one collapses to the paraf, the value the operator settled on and the
 * one way back; an isian that agrees is one line.
 */
function Row({
  entry,
  at,
  fieldOf,
  captureOf,
  anchorOf,
  hold,
  writing,
  fresh,
  typing,
  onType,
  onDecide,
}: RowProps & { entry: EpicEntry; at: number }) {
  const entryId = epicEntryId(entry);
  const field = entry.fieldId ? fieldOf.get(entry.fieldId) : undefined;
  const { status, word } = rowState(entry);
  const settled = entry.decision !== "belum";
  const saving = writing === entryId;
  const held = hold ?? (saving ? "Keputusan ini sedang disimpan." : undefined);

  return (
    <li
      id={anchorOf(at)}
      className="border-line flex scroll-mt-24 flex-col gap-3 border-b py-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Mark
          status={status}
          drawing={fresh === entryId}
          saved={!saving}
          title={`${entry.label}: ${word}`}
        />
        {/* The isian's own name, in the workbook's voice. */}
        <span className="lt-figure font-bold">{entry.label}</span>
        {field?.group ? (
          <span className="lt-figure text-ink-2 text-[0.8125rem]">
            {field.group}
          </span>
        ) : null}
        {/* THE CELL ADDRESS IS OPERATOR-FACING AND THE ID IS NOT. This is the
            konfigurasi's half of the sumber: the operator opens their own
            berkas at this address and looks. */}
        {field ? (
          <span className="lt-figure text-ink-3 text-[0.8125rem]">
            {field.sheet}!{field.valueRef}
          </span>
        ) : null}
        <StateWord status={status}>{word}</StateWord>
      </div>

      {settled ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="lt-label">keputusan Anda</span>
          <Value value={settledValue(entry)} />
          <span className="ms-auto">
            <Btn
              disabled={held !== undefined}
              reason={held}
              onClick={() => onDecide(entry, "belum")}
            >
              Buka lagi
            </Btn>
          </span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
            {entry.verdict === "tidak-ada-di-excel" ? null : (
              <span className="flex flex-wrap items-center gap-2">
                <span className="lt-label">konfigurasi</span>
                <Value value={entry.excelValue} />
              </span>
            )}
            {entry.epicValue !== undefined ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="lt-label">EPIC</span>
                <Value value={entry.epicValue} />
              </span>
            ) : null}
          </div>

          {/* BEHIND `Detail teknis`, BECAUSE IT IS ENGLISH.

              `EpicEntry.reason` comes out of `src/lib/pipeline/`, whose strings
              are deployer-facing English by convention -- "the model answered
              for the other fields and never mentioned this one" is a sentence
              about a model reply, not about this order. Printed as prose it put
              English on an operator's screen and asked them to act on a
              diagnosis of our own plumbing.

              The sibling screen already files it here (`Diagnoses` in
              `config-panel.tsx`); this one printed it plainly, and the two
              disagreeing about the same field was the tell. The state word
              above already says what the operator needs, in their language. */}
          {entry.reason ? (
            <TechnicalDetail>{entry.reason}</TechnicalDetail>
          ) : null}

          {entry.verdict === "tidak-ada-di-excel" ? (
            <Advisory>
              {/* `isiannya`, NOT `barisnya`. `baris` is reserved for OCR lines
                  by `docs/ui-bahasa.md`, and this screen prints one two
                  elements down: `Sumber` names the baris of a tangkapan layar.
                  One scroll, one word, two referents. It is also the more
                  accurate word on a transposed sheet, where an isian is a
                  column. */}
              EPIC menampilkan isian ini, tetapi berkas konfigurasi tidak punya
              tempat untuknya. Tambahkan isiannya sendiri di berkas konfigurasi
              kalau memang bagian dari order ini.
            </Advisory>
          ) : null}

          {entry.citation ? (
            <Sumber
              cite={entry.citation}
              capture={captureOf.get(entry.citation.captureId)}
            />
          ) : entry.verdict === "beda" ? (
            /* A `beda` WITH NO SUMBER MUST SAY SO. "We found a different value
               somewhere" and "we found a different value here" are different
               claims, and showing nothing lets the operator read the second. */
            <Advisory>
              Tidak ada baris tangkapan layar yang tercatat sebagai sumber nilai
              ini, jadi periksa sendiri di EPIC sebelum memutuskan.
            </Advisory>
          ) : null}

          {typing === entryId ? (
            <ManualField
              initial={settledValue(entry)}
              disabled={held !== undefined}
              onCancel={() => onType(null)}
              onSubmit={(value) => onDecide(entry, "manual", value)}
            />
          ) : (
            <Keys
              entry={entry}
              held={held}
              onType={() => onType(entryId)}
              onDecide={onDecide}
            />
          )}
        </>
      )}
    </li>
  );
}

/**
 * One value, quoted out of a sheet or off a screen.
 *
 * `(belum diisi)` and never a bare dash: `docs/ui-bahasa.md` fixes the words for
 * an empty cell, because a dash is indistinguishable from a value that IS a
 * dash.
 */
function Value({ value }: { value: string }) {
  if (value === "") {
    return <span className="lt-kotak text-ink-3">(belum diisi)</span>;
  }
  return (
    <span className="lt-kotak max-w-full whitespace-normal">
      <span className="break-words">{value}</span>
    </span>
  );
}

/**
 * The keys, offered only where a decision means something.
 *
 * `beda` IS THE ONLY VERDICT THAT OWES ONE, which is what `epicSummary` counts
 * and what the amber mark stands for. The other three are deliberate:
 *
 *  - `cocok` owes nothing by definition, so it carries no keys at all and the
 *    row stays one line.
 *  - `tidak-ditemukan` has no recommendation to rule on: every tangkapan layar
 *    was read and the isian is on none of them. The moves that exist are
 *    loading another tangkapan, which is a control on the block above, and
 *    typing the value by hand, which is the one key offered here.
 *  - `tidak-ada-di-excel` has no `fieldId` at all, because there is no isian to
 *    point at -- that absence IS the finding. There is no cell to write and no
 *    value to keep, so a Terima there would be a key that does nothing, and the
 *    row prints what to do instead.
 */
function Keys({
  entry,
  held,
  onType,
  onDecide,
}: {
  entry: EpicEntry;
  held: string | undefined;
  onType: () => void;
  onDecide: (entry: EpicEntry, decision: EpicEntry["decision"]) => void;
}) {
  if (entry.verdict === "cocok" || entry.verdict === "tidak-ada-di-excel") {
    return null;
  }

  const typeKey = (
    <Btn disabled={held !== undefined} reason={held} onClick={onType}>
      Ketik sendiri
    </Btn>
  );

  if (entry.verdict !== "beda") {
    return <div className="flex flex-wrap gap-2">{typeKey}</div>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Btn
        tone="primary"
        disabled={held !== undefined}
        reason={held}
        onClick={() => onDecide(entry, "setuju")}
      >
        Terima
      </Btn>
      {/* THE REFUSAL INK, the same as Checkpoint 2's identical key. `Tolak`
          discards what EPIC shows in favour of the konfigurasi, which is the
          one key here that throws a reading away, and the neutral face made it
          read as the twin of `Ketik sendiri` beside it. Red INK and a red lip
          on the neutral face, never a red fill. */}
      <Btn
        tone="reject"
        disabled={held !== undefined}
        reason={held}
        onClick={() => onDecide(entry, "tolak")}
      >
        Tolak
      </Btn>
      {typeKey}
    </div>
  );
}

/**
 * The value the operator types, SEEDED AND NEVER BLANK-WITH-A-GUESS.
 *
 * Mono, from `.lt-input` itself: what they are typing is a cell of their own
 * paperwork, so it is in the document's voice while the chrome around it stays
 * sans.
 *
 * AN EMPTY VALUE IS ALLOWED AND SIMPAN IS NOT DISABLED FOR IT. Clearing a cell
 * the workbook filled is a real instruction -- EPIC's template carries isian a
 * particular order does not use -- and `assertDecision` in
 * `src/lib/browser/config.ts` records at length that refusing the empty string
 * here made that reachable state unreachable. `tolak` is the opposite
 * instruction, not a way to spell this one.
 */
function ManualField({
  initial,
  disabled,
  onSubmit,
  onCancel,
}: {
  initial: string;
  disabled: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) onSubmit(value);
      }}
    >
      <label className="lt-label" htmlFor={id}>
        Nilai
      </label>
      <input
        id={id}
        className="lt-input max-w-[42rem]"
        value={value}
        disabled={disabled}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Escape leaves without saving: the same promise Batal makes,
          // available to the hand already on the keyboard.
          if (event.key === "Escape" && !disabled) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <p className="text-ink-2 max-w-[74ch] text-[0.8125rem]">
        Yang Anda ketik dicatat sebagai keputusan Anda atas isian ini. Kosongkan
        kalau isian ini memang tidak dipakai di order ini.
      </p>
      <div className="flex flex-wrap gap-2">
        <Btn
          type="submit"
          tone="primary"
          disabled={disabled}
          reason="Keputusan ini sedang disimpan."
        >
          Simpan
        </Btn>
        <Btn
          disabled={disabled}
          reason="Tunggu sampai keputusan ini tersimpan."
          onClick={onCancel}
        >
          Batal
        </Btn>
      </div>
    </form>
  );
}

/**
 * WHERE IN A TANGKAPAN LAYAR A VALUE WAS READ.
 *
 * NOT `Cite` FROM chrome.tsx, and not `Citation`. That type describes a
 * rectangle on a halaman of a berkas: it prints a page number out of a source
 * document and `ukuran di halaman`, which is a measurement of a potongan. An
 * `EpicCitation` names a `captureId` and a baris range and nothing else -- there
 * is no halaman, no berkas of the order and no potongan -- so forcing it into
 * that shape would mean inventing three facts to print two.
 *
 * It keeps `Cite`'s own register layout, so a citation reads the same way
 * wherever the operator meets one.
 */
function Sumber({
  cite,
  capture,
}: {
  cite: EpicCitation;
  capture: EpicCapture | undefined;
}) {
  if (!capture) {
    return (
      <p className="text-gap text-[0.8125rem]">
        Sumber ini menunjuk tangkapan layar yang sudah tidak ada di order ini.
      </p>
    );
  }

  const count = Math.max(0, cite.to - cite.from + 1);

  return (
    <dl className="lt-register">
      <dt>tangkapan</dt>
      <dd title={capture.name}>{shortenFileName(capture.name, 34)}</dd>
      <dt>baris</dt>
      <dd>
        {cite.from}-{cite.to}{" "}
        <span className="text-ink-3">({count})</span>
      </dd>
      {cite.text ? (
        <>
          <dt>teks</dt>
          <dd className="whitespace-pre-wrap">{cite.text}</dd>
        </>
      ) : null}
    </dl>
  );
}
