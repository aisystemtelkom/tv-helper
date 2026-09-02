"use client";

/**
 * THE HEAD OF THE LEMBAR PERIKSA: what has no evidence yet, and the one
 * question that can still change it.
 *
 * IT USED TO BE SCREEN 3 OF FOUR, and that was the mistake. "Tambahan" was a
 * phase the operator left the review sheet to reach: a list of what was
 * missing, a question about another document, and a walk back. But the list is
 * about the sheet, every decision it offers lands on the sheet, and the
 * question it asks is the only thing that can put new usulan ON the sheet. So
 * it sits at the top of the sheet now and scrolls away. Three phases, not four.
 *
 * ITS SHAPE CHANGED WITH ITS POSITION. A screen title, a lede and a stack of
 * full-width panels at the top of the review sheet reads as a second page glued
 * above the first. This block answers two questions and stops:
 *
 *   1. WHAT IS MISSING: the count, and every bagian named by the label the
 *      packet itself uses, with its own `Mark` and the REASON it is blank;
 *   2. IS THERE A DOKUMEN TAMBAHAN: yes opens the ingest drop in a dialog,
 *      no offers the bulk write-off behind a confirmation naming the count.
 *
 * The requirement it still carries (2026-08-31 corrections, section 4) is not
 * "show what is missing". It is to turn "not found" from a silent gap into a
 * decision the operator makes ON THE RECORD, because a validation packet with
 * an unexplained empty cell is indistinguishable from one where the evidence
 * genuinely does not exist. So every bagian here keeps its two terminal
 * choices, DRAW IT BY HAND from a document already loaded, or ship it empty.
 * Manual selection is the designed terminal state, not a fallback, which is why
 * it sits beside "Kosongkan" as an equal choice rather than behind it.
 *
 * FOUR KINDS OF BLANK, ONE VOCABULARY. Never searched, searched and not found,
 * you rejected the usulan, you chose to ship it empty. The old screen printed
 * one hardcoded chip on every row, so all four read alike, and the reason is
 * the only fact that decides whether adding a document will help at all. Each
 * kind keeps its own `Mark` shape and its own sentence, and the register at the
 * top counts them apart. The sentence is stated ONCE per kind there rather than
 * repeated under every row: twelve copies of four sentences is the bulk that
 * made this a screen.
 *
 * WHAT MOVED OUT rather than being deleted, both still counted here:
 *
 * - THE PER-ROW `Denah`. The sheet's own index rail draws a plan of every
 *   capture a few centimetres below this block, so a second column of page
 *   plans at the top of the same screen is the same picture twice. What a row
 *   needs for "gambar sendiri" is the page a sibling potongan landed on, and
 *   that survives here in words.
 * - THE REGISTER OF ALREADY-EMPTIED BAGIAN. Each of those is a plate in the
 *   sheet below carrying its own "Buka lagi", which is where a decision is
 *   undone now. The count stays in the register, because a decision made on the
 *   record has to be visible on the record.
 */

import { Fragment, useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AO_TEMPLATE } from "@/lib/forms/template";
import { resolvePage } from "@/lib/ui/evidence";
import { wantedKeys } from "@/lib/ui/propose";
import { slotKeyOf } from "@/lib/ui/runtime";
import type { BrowserRun, SlotState, Zone } from "@/lib/ui/runtime";
import type { SlotAggregateStatus } from "@/lib/ui/slots";
import { templateSlots } from "@/lib/ui/slots";

import {
  Btn,
  Mark,
  Note,
  Notice,
  StateWord,
  TechnicalDetail,
  shortenFileName,
} from "./chrome";
import { DocumentDrop, type IngestProgress } from "./ingest-panel";

/**
 * One document read during THIS SESSION.
 *
 * `round` is a file ordinal the shell increments per PDF, INCLUDING the files
 * of the original bundle, so a two-file first bundle numbers the first real
 * dokumen tambahan 3. That number is therefore never printed as a putaran: the
 * history below lists the documents in the order they were read and says
 * nothing it cannot back up. The shape is kept exactly as the shell fills it.
 */
export type RoundLog = {
  round: number;
  document: string;
  pagesAdded: number;
  outstandingAfter: number;
};

/**
 * Why a capture is blank. The runtime has no field for this: `onReject` sets
 * `status: "outstanding"` with the zone cleared, which is byte for byte what a
 * search miss looks like.
 *
 * The one surviving trace of a rejection is `origin`, which `applyProposals`
 * writes only when it hands over a zone and which `onReject`'s patch does not
 * clear. So an outstanding capture carrying `origin: "llm"` and no zone had a
 * usulan that a person refused. If that ever stops being true the derivation
 * below falls back to "tidak ditemukan", which is the weaker and still-true
 * claim, never the stronger one.
 */
type Reason = "unsearched" | "notfound" | "rejected" | "emptied";

const REASON_WORD: Record<Reason, string> = {
  unsearched: "belum dicari",
  notfound: "tidak ditemukan",
  rejected: "usulan ditolak",
  emptied: "sengaja dikosongkan",
};

/** Each kind of blank gets its own SHAPE, not only its own sentence. */
const REASON_MARK: Record<Reason, SlotAggregateStatus> = {
  unsearched: "pending",
  notfound: "outstanding",
  rejected: "outstanding",
  emptied: "unfilled",
};

const REASON_SENTENCE: Record<Reason, string> = {
  unsearched:
    "Belum ada pencarian yang menyentuh bagian ini, jadi ini bukan bukti yang hilang.",
  notfound: "Sudah dicari di seluruh halaman yang ada, buktinya tidak ketemu.",
  rejected:
    "Anda menolak usulannya, dan areanya ikut dibuang. Bagian ini kembali kosong.",
  emptied:
    "Dikosongkan atas keputusan Anda, bukan karena terlewat. Selnya tetap muncul kosong di DOKUMEN VALIDASI.",
};

/** The order the register states them in: the three that owe a decision first. */
const REASON_ORDER: Reason[] = ["notfound", "rejected", "unsearched", "emptied"];

function reasonOf(state: SlotState): Reason {
  if (state.status === "unfilled") return "emptied";
  if (state.status === "pending") return "unsearched";
  return state.origin === "llm" ? "rejected" : "notfound";
}

type Blank = {
  /** Position in `run.slots`, or null for a bagian the run never seeded. */
  index: number | null;
  /** The machine key. Behind the support disclosure only, never on a row. */
  key: string;
  label: string;
  sectionTitle: string;
  reason: Reason;
  /** How many potongan this bagian holds, and how many already have one. */
  required: number;
  found: number;
  /** This capture's own zone, or a sibling capture's, so a page can be named. */
  zone: Zone | null;
  zoneIsSibling: boolean;
};

const OUTSIDE_TEMPLATE = "Di luar template ini";

/** Is this capture a blank the operator still owes a decision on? */
function isBlank(state: SlotState, reported: boolean): boolean {
  // A UNION, never an intersection. Dropping a capture the runtime reported
  // would lose a decision the operator has to make; dropping one it did not
  // report would hide a blank. Both directions are the wrong-and-quiet
  // failure, so this takes either.
  return (
    reported ||
    (!state.zone &&
      (state.status === "pending" || state.status === "outstanding"))
  );
}

/**
 * Every blank in the run, in template order, with its position kept ATTACHED.
 *
 * The old version built its rows from a filtered list and then read the slot
 * index out of the UNFILTERED one, so a single unresolvable index shifted
 * every row after it: the row labelled `TTD Pejabat` fired Gambar sendiri or
 * Kosongkan on a different bagian, silently, and the packet still looked
 * complete. Index and state are one object here and are never re-paired.
 */
function collectBlanks(
  run: BrowserRun,
  reportedOutstanding: Set<number>,
): { blanks: Blank[]; emptied: Blank[] } {
  const captures = new Map<string, { state: SlotState; index: number }[]>();
  run.slots.forEach((state, index) => {
    const key = slotKeyOf(state.key);
    const list = captures.get(key);
    if (list) list.push({ state, index });
    else captures.set(key, [{ state, index }]);
  });

  const blanks: Blank[] = [];
  const emptied: Blank[] = [];
  const declared = new Set<string>();

  for (const { section, slot } of templateSlots(AO_TEMPLATE)) {
    declared.add(slot.key);
    if (!slot.fillable) continue;

    const group = captures.get(slot.key) ?? [];
    const required = slot.crops ?? 1;
    const found = group.filter((c) => c.state.zone).length;
    // Only ever read when this capture has no zone of its own, so what it
    // finds is always a DIFFERENT capture of the same bagian.
    const sibling = group.find((c) => c.state.zone)?.state.zone ?? null;

    if (group.length === 0) {
      // The template declares it and the run has never seen it: a run made
      // before the template grew. There is no position to act on, so the row
      // says so instead of offering a button that would do nothing.
      blanks.push({
        index: null,
        key: slot.key,
        label: slot.label,
        sectionTitle: section.title,
        reason: "unsearched",
        required,
        found: 0,
        zone: null,
        zoneIsSibling: false,
      });
      continue;
    }

    for (const { state, index } of group) {
      const base = {
        index,
        key: state.key,
        label: state.label || slot.label,
        sectionTitle: section.title,
        required,
        found,
      };

      if (state.status === "unfilled") {
        emptied.push({
          ...base,
          reason: "emptied",
          zone: state.zone ?? null,
          zoneIsSibling: false,
        });
        continue;
      }

      if (!isBlank(state, reportedOutstanding.has(index))) continue;

      blanks.push({
        ...base,
        reason: reasonOf(state),
        zone: state.zone ?? sibling,
        zoneIsSibling: !state.zone && sibling !== null,
      });
    }
  }

  // Slot states the run holds under a key this template no longer declares.
  // Listed rather than dropped: the tool is document-agnostic and a template
  // can be edited between runs, so a stored run can outlive the slot list that
  // made it, and hiding those captures would hide real work.
  run.slots.forEach((state, index) => {
    if (declared.has(slotKeyOf(state.key))) return;
    const base = {
      index,
      key: state.key,
      label: state.label || state.key,
      sectionTitle: OUTSIDE_TEMPLATE,
      required: 1,
      found: state.zone ? 1 : 0,
      zone: state.zone ?? null,
      zoneIsSibling: false,
    };
    if (state.status === "unfilled") {
      emptied.push({ ...base, reason: "emptied" });
      return;
    }
    if (!isBlank(state, reportedOutstanding.has(index))) return;
    blanks.push({ ...base, reason: reasonOf(state) });
  });

  return { blanks, emptied };
}

export function OutstandingPanel({
  run,
  outstandingKeys,
  rounds,
  progress,
  busy,
  error,
  onFiles,
  onDraw,
  onUnfill,
  onUnfillAll,
  onSearch,
  searching = false,
}: {
  run: BrowserRun;
  /** Positions in `run.slots` the runtime reports as outstanding. */
  outstandingKeys: number[];
  rounds: RoundLog[];
  progress: IngestProgress | null;
  busy: boolean;
  error: string | null;
  onFiles: (files: File[]) => void;
  onDraw: (slotIndex: number) => void;
  onUnfill: (slotIndex: number) => void;
  onUnfillAll: (slotIndexes: number[]) => void;
  /**
   * Still ACCEPTED so the shell's call site keeps compiling, and deliberately
   * unused: this block no longer lists the bagian you already emptied, because
   * every one of them is a plate in the sheet below with its own "Buka lagi".
   * Reopening belongs where the evidence is, not in a head that gets out of the
   * way.
   */
  onReopen?: (slotIndex: number) => void;
  /**
   * Optional. Adding a document proposes nothing on its own, so a round is
   * still owed afterwards; without this the block still SAYS so, it just cannot
   * start one, which is the right shape when the shell offers the round itself.
   */
  onSearch?: () => void;
  searching?: boolean;
}) {
  /** Is the dokumen tambahan dialog open? */
  const [dropOpen, setDropOpen] = useState(false);
  /** Did the operator answer "no more documents"? Session only, and it says so. */
  const [noMore, setNoMore] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wasBusy = useRef(busy);

  /**
   * FOCUS MUST SURVIVE A DECISION HERE TOO.
   *
   * "Kosongkan" settles the row it sits on, so the row leaves this list and
   * takes the clicked button with it, which drops focus to the document body
   * and restarts the next Tab at the top of the page. The list itself is the
   * fallback: it is where the remaining decisions are, and it is a truthful
   * place to land when the thing that was focused no longer exists. Focus is
   * only taken when it was actually lost, so an operator who clicked somewhere
   * else meanwhile is left where they put themselves.
   */
  const unfillAndKeepFocus = (slotIndex: number) => {
    onUnfill(slotIndex);
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected) {
        listRef.current?.focus();
      }
    });
  };

  // A destructive form that appears below the fold and takes no focus is a
  // form a keyboard operator has to hunt for, and one a screen reader never
  // hears open.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  // THE DIALOG CLOSES ITSELF WHEN THE READING FINISHES, and only then: the
  // operator handed a document over to get back to the sheet, so leaving a
  // modal in front of it afterwards makes them dismiss a box to see the thing
  // they asked for. A read that FAILED is not a read that finished, so the
  // dialog stays open around its own failure notice, where the drop target is
  // still under the operator's hand.
  useEffect(() => {
    if (wasBusy.current && !busy && !error) setDropOpen(false);
    wasBusy.current = busy;
  }, [busy, error]);

  const { blanks, emptied } = collectBlanks(run, new Set(outstandingKeys));
  const actionable = blanks.filter((b) => b.index !== null);
  const searchable = wantedKeys(run).length;

  const counts: Record<Reason, number> = {
    notfound: blanks.filter((b) => b.reason === "notfound").length,
    rejected: blanks.filter((b) => b.reason === "rejected").length,
    unsearched: blanks.filter((b) => b.reason === "unsearched").length,
    emptied: emptied.length,
  };

  // One definition, placed by state rather than repeated: an ingest failure
  // belongs beside the drop the operator is looking at, and everywhere else it
  // belongs here, above the sheet, where it cannot be missed. Never both at
  // once: one failure stated twice on one screen reads as two failures.
  const errorNotice = error ? (
    <Notice tone="stop">
      {error} Halaman yang sudah selesai dibaca tetap tersimpan di pekerjaan
      ini.
    </Notice>
  ) : null;
  const errorHere = dropOpen ? null : errorNotice;

  const dialog = (
    <TambahanDialog
      open={dropOpen}
      onOpen={setDropOpen}
      busy={busy}
      progress={progress}
      errorNotice={errorNotice}
      onFiles={onFiles}
    />
  );

  // The sheet below already refuses to be reviewed with no pages and says so in
  // its own stop notice. Saying it twice, once above the other, is furniture.
  if (run.pages.length === 0) return null;

  /**
   * NOTHING IS OUTSTANDING: one quiet line, or nothing at all.
   *
   * This block is read on arrival at Periksa, every visit, for the whole life
   * of a pekerjaan. Once the work is done it must not go on occupying the top
   * of the screen with a congratulation, so it collapses to a sentence, and to
   * nothing when there is not even that much to report.
   */
  if (blanks.length === 0) {
    const nothingPending =
      emptied.length === 0 && rounds.length === 0 && !busy && error === null;
    if (nothingPending) return null;

    return (
      <div className="flex flex-col gap-2">
        {errorHere}
        <p className="text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
          Tidak ada yang tersisa. Setiap bagian yang bisa didukung dokumen sudah
          terisi atau sudah Anda putuskan.
          {emptied.length > 0
            ? ` ${emptied.length} bagian sengaja dikosongkan.`
            : ""}
        </p>
        <SessionHistory rounds={rounds} />
        {dialog}
      </div>
    );
  }

  return (
    <section
      aria-labelledby="tambahan-head"
      className="flex flex-col gap-4 border-b pb-5"
      style={{ borderColor: "var(--line)" }}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="lt-title text-base" id="tambahan-head">
          Yang belum ada buktinya
        </h2>
        <p className="text-[0.9375rem]" style={{ color: "var(--ink)" }}>
          <span className="lt-figure font-bold">{blanks.length}</span> bagian
          belum punya bukti. Setiap bagian di bawah berakhir dengan keputusan
          Anda: tidak ada yang dikirim kosong diam-diam.
        </p>
      </div>

      {/* The count changes as decisions are taken, with no navigation. */}
      <p aria-live="polite" className="sr-only">
        {blanks.length} bagian belum punya bukti. {emptied.length} bagian sudah
        Anda kosongkan.
      </p>

      {errorHere}

      <ReasonRegister counts={counts} />

      {/* A disabled control never appears without its reason. A decision
          committed mid-ingest saves from a run whose `rev` is behind, storage
          refuses it, and the operator is told their decision exists only in
          this tab. */}
      {busy ? (
        <Notice tone="warn">
          Keputusan ditahan dulu selama berkas dibaca. Menyimpan di tengah
          pembacaan akan ditolak oleh penyimpanan, dan keputusan Anda bisa
          hilang. Tunggu sampai pembacaan selesai.
        </Notice>
      ) : null}

      {/* ABOVE THE ROWS, because when a round is owed it outranks every row
          under it: deciding a bagian by hand before anything has looked for it
          is the one decision on this block that cannot be taken back cheaply. */}
      {searchable > 0 ? (
        <SearchLine
          searchable={searchable}
          pages={run.pages.length}
          searching={searching}
          busy={busy}
          afterDocument={rounds.length > 0}
          onSearch={onSearch}
        />
      ) : null}

      <ul
        ref={listRef}
        tabIndex={-1}
        aria-label="Bagian yang belum ada buktinya"
        className="flex flex-col border-t"
        style={{ borderColor: "var(--line)" }}
      >
        {blanks.map((blank) => (
          <BlankRow
            key={`${blank.key}-${blank.index ?? "belum-ada"}`}
            run={run}
            blank={blank}
            busy={busy}
            onDraw={onDraw}
            onUnfill={unfillAndKeepFocus}
          />
        ))}
      </ul>

      {/* The machine keys, for support, behind the one disclosure this product
          uses for deployer-facing text. An operator has no use for
          `kbLanjutan.top#2` and it used to sit on every row at the same weight
          as the label beside it. */}
      <TechnicalDetail>
        {blanks.map((b) => `${b.key}  ${b.sectionTitle} / ${b.label}`).join("\n")}
      </TechnicalDetail>

      <Fork
        noMore={noMore}
        onNoMore={setNoMore}
        onOpenDrop={() => setDropOpen(true)}
        busy={busy}
        actionable={actionable}
        confirming={confirming}
        setConfirming={setConfirming}
        confirmRef={confirmRef}
        onUnfillAll={onUnfillAll}
      />

      <SessionHistory rounds={rounds} />

      {dialog}
    </section>
  );
}

/**
 * The four kinds of blank, counted apart, each with its own sentence.
 *
 * The sentence is the fact that decides which action is right: a bagian nobody
 * searched needs a search, one the search missed needs another document, one
 * you rejected needs a different area on a page you already have. It is stated
 * here ONCE per kind instead of under every row, because twelve rows carrying
 * four repeated paragraphs is exactly the bulk that made this a separate
 * screen. The rows carry the word, which is the key back into this register.
 *
 * A kind with no rows is not listed. Zero is not a fact worth a line.
 */
function ReasonRegister({ counts }: { counts: Record<Reason, number> }) {
  const rows = REASON_ORDER.filter((reason) => counts[reason] > 0);
  if (rows.length === 0) return null;

  return (
    <dl
      className="lt-register max-w-[76ch]"
      style={{ gridTemplateColumns: "auto auto minmax(0, 1fr)" }}
    >
      {/* A fragment rather than a wrapper element: a `display: contents` div
          between the dl and its dt/dd is a known way to drop a group out of the
          accessibility tree, and it buys nothing here. */}
      {rows.map((reason) => (
        <Fragment key={reason}>
          {/* The same word, in the same colour, as the rows below: the
              register is the key back into them, so the two must not be two
              different-looking objects. It also keeps a meaning-bearing word
              off `--ink-3`, which the register's own dt would otherwise give
              it. */}
          <dt>
            <StateWord status={REASON_MARK[reason]}>
              {REASON_WORD[reason]}
            </StateWord>
          </dt>
          <dd className="text-end">{counts[reason]}</dd>
          <dd
            style={{
              // Sans: this is the application explaining itself, not the
              // packet's own voice, so it does not take the register's mono.
              fontFamily: "var(--font-ui), sans-serif",
              color: "var(--ink-2)",
            }}
          >
            {REASON_SENTENCE[reason]}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/**
 * One blank, one line, two terminal choices.
 *
 * It was a four-paragraph block per bagian, which at twelve bagian is a screen.
 * What survives is what a decision needs: the shape, the packet's own name for
 * the bagian, the reason word, and the page a sibling potongan landed on, which
 * is where "gambar sendiri" would start looking.
 */
function BlankRow({
  run,
  blank,
  busy,
  onDraw,
  onUnfill,
}: {
  run: BrowserRun;
  blank: Blank;
  busy: boolean;
  onDraw: (slotIndex: number) => void;
  onUnfill: (slotIndex: number) => void;
}) {
  const index = blank.index;
  const resolved = blank.zone ? resolvePage(run, blank.zone.pageIndex) : null;

  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b py-2"
      style={{ borderColor: "var(--line)" }}
    >
      <Mark status={REASON_MARK[blank.reason]} title={REASON_WORD[blank.reason]} />

      {/* Mono: the section title and the field name are the packet's own voice,
          spelled as the sample spells them. */}
      <span
        className="lt-figure text-[0.8125rem]"
        style={{ color: "var(--ink-3)" }}
      >
        {blank.sectionTitle}
      </span>
      <span className="lt-figure text-[0.9375rem] font-bold">{blank.label}</span>
      <StateWord status={REASON_MARK[blank.reason]}>
        {REASON_WORD[blank.reason]}
      </StateWord>

      {/* The half-filled bagian, said out loud. Kosongkan on this row settles
          ONE potongan, and the sample's KB (lanjutan) ToP row stacks two: an
          operator who reads it as "kosongkan seluruh baris ToP" has just written
          off a picture that is already accepted. */}
      {blank.required > 1 ? (
        <span
          className="text-[0.8125rem]"
          style={{ color: "var(--ink-2)" }}
          title="Keputusan di baris ini hanya mengenai satu potongan, yang lain tidak ikut berubah."
        >
          <span className="lt-figure">
            {blank.found} dari {blank.required}
          </span>{" "}
          potongan, keputusan ini hanya untuk satu
        </span>
      ) : null}

      {resolved ? (
        <span className="text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
          {blank.zoneIsSibling ? "potongan lain di " : "areanya di "}
          {/* The page's number inside its OWN source file, never the run-global
              index the zone is stored by. */}
          <span className="lt-figure">
            hal {resolved.pageInDoc + 1} dari {resolved.pagesInDoc}
          </span>{" "}
          <span style={{ color: "var(--ink-3)" }} title={resolved.sourceName}>
            {shortenFileName(resolved.sourceName, 22)}
          </span>
        </span>
      ) : blank.zone ? (
        <span className="text-[0.8125rem]" style={{ color: "var(--gap)" }}>
          Halamannya sudah tidak ada di pekerjaan ini.
        </span>
      ) : null}

      {index === null ? (
        <span className="text-[0.8125rem]" style={{ color: "var(--gap)" }}>
          Ada di template tapi belum ada di pekerjaan ini, jadi belum bisa
          diputuskan. Mulai pekerjaan lain supaya bagian ini ikut disiapkan.
        </span>
      ) : (
        <span className="ms-auto flex flex-wrap gap-2">
          <Btn disabled={busy} onClick={() => onDraw(index)}>
            Gambar sendiri
          </Btn>
          <Btn disabled={busy} onClick={() => onUnfill(index)}>
            Kosongkan
          </Btn>
        </span>
      )}
    </li>
  );
}

/**
 * A round is still owed, said in countable terms.
 *
 * NO BAR, and there is no honest way to draw one: `requestProposals` is a
 * single POST for the whole run, so there is no per-bagian progress to fill a
 * rectangle with and inventing one would be a claim this app cannot make. What
 * it can say is how many bagian go up and how many pages of text they are
 * searched against, both of which are facts it holds.
 *
 * The two wordings are not decoration. "Nothing has been searched yet" and "you
 * added a document and the search has not run over it" send the operator to
 * completely different next actions, and one screen showed the same "still not
 * found" list in both, which reads as "the new document did not help".
 */
function SearchLine({
  searchable,
  pages,
  searching,
  busy,
  afterDocument,
  onSearch,
}: {
  searchable: number;
  pages: number;
  searching: boolean;
  busy: boolean;
  afterDocument: boolean;
  onSearch?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p
        aria-live="polite"
        className="max-w-[70ch] flex-1 text-[0.9375rem]"
        style={{ color: "var(--ink)" }}
      >
        {searching ? (
          <>
            Pencarian sedang berjalan untuk{" "}
            <span className="lt-figure">{searchable}</span> bagian di{" "}
            <span className="lt-figure">{pages}</span> halaman. Tab ini boleh
            dibiarkan terbuka, dan bukti yang sudah Anda terima tidak ikut
            dicari ulang.
          </>
        ) : afterDocument ? (
          <>
            Berkas sudah dibaca, pencarian belum dijalankan. Jalankan pencarian
            supaya <span className="lt-figure">{searchable}</span> bagian di
            atas dicari lagi, kali ini termasuk di halaman yang baru.
          </>
        ) : (
          <>
            <span className="lt-figure">{searchable}</span> bagian bisa dicari
            lagi di <span className="lt-figure">{pages}</span> halaman yang ada
            sekarang. Bukti yang sudah Anda terima tidak ikut dicari ulang.
          </>
        )}
      </p>
      {onSearch ? (
        <Btn
          disabled={searching || busy}
          aria-busy={searching || undefined}
          onClick={onSearch}
        >
          {/* `Proses`, the same word the Muat screen uses, because it is the
              same action: it is what turns halaman into usulan. Calling it
              "Cari bagian ini" here and "Proses" there would make one action
              wear two names across the flow, which is the thing the glossary
              in docs/ui-bahasa.md exists to stop. */}
          {searching ? "Sedang memproses..." : "Proses lagi"}
        </Btn>
      ) : null}
    </div>
  );
}

/**
 * The branch point: is there another document.
 *
 * It has to READ as a fork, with two consequences, rather than as two buttons
 * that look like filters. Yes opens the drop in a dialog; no reveals the bulk
 * write-off, which is the only other way a blank can leave this list. The
 * answer is remembered for the session and the screen says exactly that,
 * because it is not written into the run: presenting a session variable as a
 * record would be the second-worst thing this block could do after losing a
 * decision outright.
 */
function Fork({
  noMore,
  onNoMore,
  onOpenDrop,
  busy,
  actionable,
  confirming,
  setConfirming,
  confirmRef,
  onUnfillAll,
}: {
  noMore: boolean;
  onNoMore: (value: boolean) => void;
  onOpenDrop: () => void;
  busy: boolean;
  actionable: Blank[];
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  confirmRef: React.RefObject<HTMLDivElement | null>;
  onUnfillAll: (slotIndexes: number[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p
          id="tambahan-question"
          className="text-[0.9375rem] font-semibold"
          style={{ color: "var(--ink)" }}
        >
          Ada dokumen tambahan?
        </p>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-labelledby="tambahan-question"
        >
          <Btn disabled={busy} onClick={onOpenDrop}>
            Ya, ada berkas lain
          </Btn>
          <Btn
            on={noMore}
            aria-pressed={noMore}
            onClick={() => onNoMore(!noMore)}
          >
            Tidak, hanya ini
          </Btn>
        </div>
        <p className="text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
          Bagian di atas mungkin ada di berkas lain. Bukti yang sudah Anda
          terima tetap disimpan.
        </p>
      </div>

      {noMore ? (
        <div className="flex flex-col gap-2">
          <Notice tone="warn">
            Kalau tidak ada berkas lain, setiap bagian di atas butuh keputusan:
            gambar sendiri areanya dari dokumen yang sudah dimuat, atau
            kosongkan. Keduanya tercatat sebagai keputusan Anda.
          </Notice>

          {confirming ? (
            <BulkConfirm
              ref={confirmRef}
              rows={actionable}
              busy={busy}
              onCancel={() => setConfirming(false)}
              onConfirm={() => {
                onUnfillAll(
                  actionable.flatMap((b) => (b.index === null ? [] : [b.index])),
                );
                setConfirming(false);
              }}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Btn
                tone="reject"
                disabled={busy || actionable.length === 0}
                onClick={() => setConfirming(true)}
              >
                Kosongkan semua ({actionable.length} bagian)
              </Btn>
              {/* Both answers stay live, so "tidak, hanya ini" followed by a
                  document turning up anyway is a state this block can hold. */}
              <Note>
                Jawaban ini hanya berlaku selama tab ini terbuka dan tidak ikut
                tersimpan di pekerjaan.
              </Note>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Ceremony proportional to the risk.
 *
 * The bulk form used to fire on one click, from the fastest and easiest control
 * on the screen, and write a blank into the deliverable for every outstanding
 * bagian at once. Under time pressure that becomes the default path, which
 * inverts the design's own claim that drawing by hand is an equal choice. It
 * names the count, names every bagian by its operator-facing label, and says
 * separately how many of them nobody ever searched, because writing off an
 * unsearched bagian is a different act from writing off one the search
 * genuinely could not answer.
 */
function BulkConfirm({
  ref,
  rows,
  busy,
  onCancel,
  onConfirm,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  rows: Blank[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const unsearched = rows.filter((b) => b.reason === "unsearched").length;

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-labelledby="kosongkan-semua"
      className="lt-panel flex flex-col gap-3 p-4"
    >
      <h3 className="lt-title text-base" id="kosongkan-semua">
        Kosongkan {rows.length} bagian?
      </h3>
      <p className="max-w-[62ch] text-[0.9375rem]">
        Bagian berikut akan dikirim kosong di DOKUMEN VALIDASI, tercatat atas
        keputusan Anda:
      </p>
      <ul className="lt-well flex max-h-44 flex-col gap-1 overflow-auto p-3">
        {rows.map((row) => (
          <li
            key={`${row.key}-${row.index}`}
            className="lt-figure text-[0.8125rem]"
          >
            {row.sectionTitle} / {row.label}
          </li>
        ))}
      </ul>
      {unsearched > 0 ? (
        <Notice tone="warn">
          {unsearched} di antaranya belum pernah dicari, jadi belum ada yang
          pernah melihat apakah buktinya ada.
        </Notice>
      ) : null}
      <p
        className="max-w-[62ch] text-[0.9375rem]"
        style={{ color: "var(--ink-2)" }}
      >
        Untuk membatalkannya nanti, buka lagi bagiannya satu per satu di lembar
        periksa di bawah.
      </p>
      <div className="flex flex-wrap gap-2">
        <Btn tone="reject" disabled={busy} onClick={onConfirm}>
          Ya, kosongkan {rows.length} bagian
        </Btn>
        <Btn onClick={onCancel}>Batal</Btn>
      </div>
    </div>
  );
}

/**
 * THE DOKUMEN TAMBAHAN HAND-OVER, in a dialog.
 *
 * It is a dialog because it is a detour: the operator is in the middle of the
 * review sheet, and adding a document is one act with a beginning and an end
 * that hands them straight back to it. A drop target expanded in place would
 * push the whole sheet down the screen for as long as it stayed open.
 *
 * IT CANNOT BE DISMISSED WHILE A DOCUMENT IS BEING READ. Reading a bundle takes
 * minutes, the pages land one at a time, and a modal that vanishes on Escape
 * mid-read leaves the operator with no picture of a job that is still running
 * and still writing to their pekerjaan. Outside presses, Escape and the close
 * button are all refused for exactly as long as `busy` is true, and the block
 * says so rather than simply not reacting.
 *
 * THE PROMISE IS THE SHARED ONE, not a second one written here. `DocumentDrop`
 * carries the sentence about what leaves the device, and it already refuses a
 * non-PDF out loud in a live region instead of swallowing it. `inline` is the
 * same target at a smaller height, because in this dialog the paper is not the
 * hero: what the document is FOR is.
 */
function TambahanDialog({
  open,
  onOpen,
  busy,
  progress,
  errorNotice,
  onFiles,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  busy: boolean;
  progress: IngestProgress | null;
  errorNotice: React.ReactNode;
  onFiles: (files: File[]) => void;
}) {
  return (
    <Dialog
      open={open}
      disablePointerDismissal={busy}
      onOpenChange={(next, details) => {
        if (!next && busy) {
          details.cancel();
          return;
        }
        onOpen(next);
      }}
    >
      <DialogContent showCloseButton={!busy} closeLabel="Tutup">
        <DialogHeader>
          <DialogTitle>Tambahkan dokumen tambahan</DialogTitle>
          <DialogDescription>
            Hanya bagian yang belum ada buktinya yang dicari lagi. Setiap area
            yang sudah Anda terima tetap tersimpan, jadi menambahkan berkas
            keempat tidak mengulang pekerjaan yang sudah selesai.
          </DialogDescription>
        </DialogHeader>

        {busy ? (
          <Reading progress={progress} />
        ) : (
          <DocumentDrop
            label="Dokumen tambahan"
            hint="Berkas PDF lain yang mungkin memuat bagian yang belum ada buktinya. Sesudah dibaca, pencarian masih harus dijalankan."
            size="inline"
            onFiles={onFiles}
          />
        )}

        {errorNotice}
      </DialogContent>
    </Dialog>
  );
}

/**
 * What is happening, in whole pages, while the dialog is held open.
 *
 * Countable and never smooth, for the reason the ingest screen states at
 * length: the app only ever learns about whole pages, a page is stored the
 * moment it is read, and the number that matters to somebody who might close
 * the tab is how many are SAFELY STORED.
 */
function Reading({ progress }: { progress: IngestProgress | null }) {
  const named = Boolean(progress?.name);
  const counting = !progress || progress.total <= 0;

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <p className="text-[0.9375rem]" style={{ color: "var(--ink)" }}>
        {named ? (
          <>
            Membaca{" "}
            <span className="lt-figure" title={progress?.name}>
              {shortenFileName(progress?.name ?? "", 30)}
            </span>
          </>
        ) : (
          "Membaca dokumen"
        )}
      </p>
      <p className="text-[0.9375rem]" style={{ color: "var(--ink)" }}>
        {counting ? (
          "Membuka berkas dan menghitung halamannya."
        ) : (
          <>
            <span className="lt-figure">{progress?.done}</span> dari{" "}
            <span className="lt-figure">{progress?.total}</span> halaman sudah
            tersimpan.
          </>
        )}
      </p>
      <Note>
        Setiap halaman disimpan begitu selesai dibaca. Kotak ini tidak bisa
        ditutup selama pembacaan berjalan, supaya tidak ada pembacaan yang
        berjalan tanpa terlihat. Kotak ini menutup sendiri kalau sudah selesai.
      </Note>
    </div>
  );
}

/**
 * The documents read in THIS SESSION, and nothing stronger.
 *
 * `rounds` lives in the shell's React state, is reset when a run is opened, and
 * is never persisted, so it is empty exactly when it would matter most: after
 * the reload of a long session. Fixing that means changing storage, which is
 * out of scope here, so the line says plainly what this list is rather than
 * letting it pass as an audit trail.
 */
function SessionHistory({ rounds }: { rounds: RoundLog[] }) {
  if (rounds.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
        Dibaca di sesi ini:{" "}
        {rounds.map((round, i) => (
          <Fragment key={`${round.round}-${round.document}-${i}`}>
            {i > 0 ? ", " : ""}
            <span className="lt-figure" title={round.document}>
              {shortenFileName(round.document, 28)}
            </span>{" "}
            <span className="lt-figure">+{round.pagesAdded}</span> halaman
          </Fragment>
        ))}
      </p>
      <Note>
        Daftar ini hanya ada selama tab ini terbuka, jadi jangan dipakai sebagai
        catatan serah terima.
      </Note>
    </div>
  );
}
