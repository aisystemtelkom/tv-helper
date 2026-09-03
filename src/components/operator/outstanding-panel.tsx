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
 * IT IS ONE SLAB WITH A KOP, AND THE KOP CARRIES THE COUNT. A screen title, a
 * count sentence, a four-row reason register, a search line, one row per blank,
 * a technical disclosure, the fork, its confirmation and a session log came to
 * about 570px above the first crop with three blanks and about 930px with
 * twelve: most of a 1366x768 viewport spent before the operator reaches the
 * work. What stands at rest now is the kop (the block's name, and how many
 * bagian owe a decision), the reason counts, the one question, and the controls
 * that answer it. The list itself is a closed disclosure.
 *
 * COLLAPSING IT HIDES NO REACHABLE ACTION, which is the only reason it is
 * allowed to collapse at all. Every blank bagian is ALSO a plate in the sheet
 * a few centimetres below, carrying the same two terminal choices, Gambar
 * sendiri and Kosongkan, from `ProposalPlate`'s outstanding branch. The count
 * and the kop's own amber never collapse, so nothing unreviewed can hide behind
 * the fold, and the two controls that exist nowhere else on this screen, Proses
 * lagi and Tambah dokumen, stand outside the disclosure at all times.
 *
 * THE LIST IS CLOSED ON ARRIVAL. It used to open on the first visit to a
 * pekerjaan, on the argument that a briefing is read once. The density pass
 * retires that: a briefing that costs most of the viewport is furniture on the
 * first visit too, and the kop now states the same fact in one bar. What
 * survives of the old rule is the half that was about REACHABILITY rather than
 * about briefing, and it is unchanged: a round that becomes owed forces the
 * list open (see `owedBefore` below), because reading a document is the moment
 * the search line starts mattering more than the rows under it.
 *
 * THE FORK IS NOT A PARAGRAPH ANY MORE. "Ada dokumen tambahan?" with two
 * buttons, an explanation, a conditional notice and a caveat was a
 * five-element block asking a yes/no question. It is one line now, and both
 * answers are on it: yes opens the dokumen tambahan dialog, no reveals the bulk
 * write-off, which is the only other way a blank can leave this list.
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
 * kind keeps its own `Mark` shape and its own word, and the block counts them
 * apart. The four SENTENCES that gloss those words are behind a question mark,
 * once each, because they read the same on every order for the life of this
 * product; twelve rows carrying four repeated paragraphs is the bulk that made
 * this a screen in the first place.
 *
 * WHAT MOVED OUT rather than being deleted, all of it still counted here:
 *
 * - THE PER-ROW `Denah`. The sheet's own index rail draws a plan of every
 *   capture a few centimetres below this block, so a second column of page
 *   plans at the top of the same screen is the same picture twice. What a row
 *   needs for "gambar sendiri" is the page a sibling potongan landed on, and
 *   that survives here as a kotak isian.
 * - THE PER-ROW BERKAS NAME, for the same reason and to the same place: the
 *   plate below carries the full citation register. It stays on the row as the
 *   kotak's title, so it is one pointer away rather than twelve names wide.
 * - THE REGISTER OF ALREADY-EMPTIED BAGIAN. Each of those is a plate in the
 *   sheet below carrying its own "Buka lagi", which is where a decision is
 *   undone now. The count stays on the kop, and stays there whether the list is
 *   open or shut, because a decision made on the record has to be visible on
 *   the record.
 */

import { useEffect, useRef, useState } from "react";

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
  Hint,
  Mark,
  Note,
  Notice,
  StateWord,
  TechnicalDetail,
  shortenFileName,
} from "./chrome";
import { Cari, Klip, Kosongkan, Potongan } from "./icons";
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

/** The order the counts state them in: the three that owe a decision first. */
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
    // The captures the run HOLDS, never a count the template declares. Nothing
    // declares one any more: a lanjutan is discovered, and the row that used
    // to read "0 dari 2 potongan" over a bagian nobody had searched for a
    // second picture of is the operator report this feature comes from.
    const required = group.length;
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
        required: 1,
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

type PanelProps = {
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
};

/**
 * A different pekerjaan is a different question, and every piece of state in
 * here is about one: whether the list is open, whether the operator answered
 * the tambahan question, whether a write-off is half-confirmed. Keying on the
 * run id says so in React's own terms and resets all of it at once.
 */
export function OutstandingPanel(props: PanelProps) {
  return <Panel key={props.run.id} {...props} />;
}

function Panel({
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
}: PanelProps) {
  /**
   * IS A ROUND OWED? A document has been read into this pekerjaan and nothing
   * has searched it yet. Computed before any state because the list's opening
   * position depends on it: see `expanded` below.
   */
  const searchable = wantedKeys(run).length;
  const owesRound = rounds.length > 0 && searchable > 0;

  /** Is the dokumen tambahan dialog open? */
  const [dropOpen, setDropOpen] = useState(false);
  /** Did the operator answer "no more documents"? Session only, and it says so. */
  const [noMore, setNoMore] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /**
   * Is the list of blanks open under its disclosure? Closed, unless a round is
   * owed: Proses lagi outranks the rows the moment a document has been read.
   */
  const [expanded, setExpanded] = useState(owesRound);
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

  const counts: Record<Reason, number> = {
    notfound: blanks.filter((b) => b.reason === "notfound").length,
    rejected: blanks.filter((b) => b.reason === "rejected").length,
    unsearched: blanks.filter((b) => b.reason === "unsearched").length,
    emptied: emptied.length,
  };

  /**
   * A ROUND THAT BECOMES OWED OPENS THE LIST, once, on the edge.
   *
   * Reading a document is exactly the moment the round becomes owed, and it is
   * the operator's own action, so opening answers something they just did
   * rather than moving the page under them. It stays a toggle afterwards: this
   * never holds the list open against the operator.
   *
   * ADJUSTED DURING RENDER, which is React's own documented shape for "change
   * some state when an input changes" and is why there is no effect here. An
   * effect would paint the closed list and then the open one, so the one thing
   * that moves in this product would be a panel flinching rather than a paraf
   * being drawn.
   */
  const [owedBefore, setOwedBefore] = useState(owesRound);
  if (owesRound !== owedBefore) {
    setOwedBefore(owesRound);
    if (owesRound) setExpanded(true);
  }

  // One definition, placed by state rather than repeated: an ingest failure
  // belongs beside the drop the operator is looking at, and everywhere else it
  // belongs here, above the sheet, where it cannot be missed. Never both at
  // once: one failure stated twice on one screen reads as two failures.
  const errorNotice = error ? (
    <Notice tone="stop">
      {error} Halaman yang sudah dibaca tetap tersimpan.
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
   * NOTHING IS OUTSTANDING: one slab that says so, or nothing at all.
   *
   * This block is read on arrival at Periksa, every visit, for the whole life
   * of a pekerjaan. Once the work is done it must not go on occupying the top
   * of the screen with a congratulation, so it collapses to a kop and one line,
   * and to nothing when there is not even that much to report.
   *
   * The clear is AFFIRMATIVE and therefore stays on screen rather than hiding:
   * an absent warning is not a confirmation, which is the rule this whole
   * product is built on.
   */
  if (blanks.length === 0) {
    const nothingPending =
      emptied.length === 0 && rounds.length === 0 && !busy && error === null;
    if (nothingPending) return null;

    return (
      <section aria-labelledby="tambahan-head" className="lt-slab">
        <div className="lt-kop" data-owes={error ? "fault" : "done"}>
          <h2 id="tambahan-head">Tidak ada yang tersisa</h2>
          {/* `lt-kop-right` rather than a hand-rolled `ms-auto`: the stylesheet
              declares the kop's right-hand slot so every kop in the product
              puts its count in the same place. The figure is mono and the word
              beside it is not, because "dikosongkan" is a state word the app
              says, not a figure the document carries. */}
          {emptied.length > 0 ? (
            <span className="lt-kop-right flex items-baseline gap-2">
              <span className="lt-figure">{emptied.length}</span>
              dikosongkan
            </span>
          ) : null}
        </div>

        <div className="lt-slab-body flex flex-col gap-4">
          {errorHere}
          <Note>
            Setiap bagian yang bisa didukung dokumen sudah terisi atau sudah
            Anda putuskan.
          </Note>
          <SessionHistory rounds={rounds} />
        </div>

        {dialog}
      </section>
    );
  }

  return (
    <section aria-labelledby="tambahan-head" className="lt-slab">
      {/* THE KOP IS THIS BLOCK'S STATUS CHANNEL. An amber tint over the bar and
          a 4px amber rule down its leading edge mean it owes the operator a
          decision, the correction pen in the same two places means a read
          failed, and the figure at the right is the size of the debt. Neither
          hue is ever a saturated fill under light text; the rule is what reads
          from across the room. Nothing else on the block has to carry that
          signal, and none of it can be collapsed. */}
      <div className="lt-kop" data-owes={error ? "fault" : "decision"}>
        <h2 id="tambahan-head">Bagian tanpa bukti</h2>
        <span className="lt-figure lt-kop-right">{blanks.length}</span>
      </div>

      <div className="lt-slab-body flex flex-col gap-4">
        {/* The count changes as decisions are taken, with no navigation. */}
        <p aria-live="polite" className="sr-only">
          {blanks.length} bagian belum ada buktinya. {emptied.length} bagian
          sudah Anda kosongkan.
        </p>

        {errorHere}

        {/* A disabled control never appears without its reason, and the control
            this one disables is Tambah dokumen, one line below. So it stands
            outside the fold: a reason that can be collapsed away from the
            button it explains is not a reason. */}
        {busy ? (
          <Notice tone="warn">
            <span className="flex flex-wrap items-center gap-2">
              Keputusan ditahan sampai pembacaan selesai.
              <Hint label="Kenapa keputusan ditahan">
                Menyimpan di tengah pembacaan akan ditolak oleh penyimpanan,
                karena pekerjaannya sudah berubah, dan keputusan Anda bisa
                hilang.
              </Hint>
            </span>
          </Notice>
        ) : null}

        <ReasonCounts counts={counts} />

        {/* ABOVE THE QUESTION, because when a round is owed it outranks it:
            deciding a bagian by hand before anything has looked for it is the
            one decision on this block that cannot be taken back cheaply. */}
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

        <Fork
          noMore={noMore}
          onNoMore={setNoMore}
          busy={busy}
          actionable={actionable}
          confirming={confirming}
          setConfirming={setConfirming}
          confirmRef={confirmRef}
          onUnfillAll={onUnfillAll}
          onAddDocument={() => setDropOpen(true)}
        />

        {/* THE LIST, CLOSED. Every row in it is also a plate in the sheet a few
            centimetres below, carrying the same two choices, so the fold hides
            no decision. */}
        <details
          className="lt-disclose"
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>Daftar bagian</summary>

          <div className="flex flex-col gap-4 pt-2">
            {/* A RULED REGISTER, DRAWN IN HAIRLINES. The rules were 2px, which
                is the stamped-plate weight rather than this system's: `--line`
                is separation between content and nothing else, and a dozen
                two-pixel rules down one column read as a stack of parts. */}
            <ul
              ref={listRef}
              tabIndex={-1}
              aria-label="Bagian yang belum ada buktinya"
              className="border-line flex flex-col border-t"
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

            {/* The machine keys, for support, behind the one disclosure this
                product uses for deployer-facing text. An operator has no use
                for `kbLanjutan.top#2` and it used to sit on every row at the
                same weight as the label beside it. */}
            <TechnicalDetail>
              {blanks
                .map((b) => `${b.key}  ${b.sectionTitle} / ${b.label}`)
                .join("\n")}
            </TechnicalDetail>

            <SessionHistory rounds={rounds} />
          </div>
        </details>
      </div>

      {dialog}
    </section>
  );
}

/**
 * The four kinds of blank, counted apart.
 *
 * SPLIT CLAUSE BY CLAUSE, which is the whole density argument in one component.
 * The COUNTS change with the pekerjaan and decide what the operator does next,
 * so they stand. The four SENTENCES that gloss them read the same words on
 * every order, and an operator has read them four hundred times, so they sit
 * behind the question mark where they can be pointed at. What used to be a
 * three-column register roughly 110px tall is a run of figures on one line.
 *
 * THE WORD ITSELF NEVER HIDES. It is the key back into the rows below, which
 * carry the same word in the same colour, and a count with no name is a number
 * nobody can act on.
 *
 * A kind with no rows is not counted. Zero is not a fact worth a figure.
 */
function ReasonCounts({ counts }: { counts: Record<Reason, number> }) {
  const rows = REASON_ORDER.filter((reason) => counts[reason] > 0);
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {rows.map((reason) => (
        <span key={reason} className="flex items-baseline gap-2">
          <StateWord status={REASON_MARK[reason]}>
            {REASON_WORD[reason]}
          </StateWord>
          <span className="lt-figure text-ink text-[0.8125rem]">
            {counts[reason]}
          </span>
        </span>
      ))}

      {/* All four, always, whichever are on screen: the panel is the fixed
          explanation of the vocabulary, not a report on this run. Which of the
          four are actually happening is what the figures beside it say. */}
      <Hint label="Arti keempat keterangan ini">
        <dl className="flex flex-col gap-2">
          {REASON_ORDER.map((reason) => (
            <div key={reason}>
              <dt className="inline">
                <strong>{REASON_WORD[reason]}</strong>
                {": "}
              </dt>
              <dd className="inline">{REASON_SENTENCE[reason]}</dd>
            </div>
          ))}
        </dl>
      </Hint>
    </div>
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
    <li className="border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-2">
      <Mark
        status={REASON_MARK[blank.reason]}
        title={REASON_WORD[blank.reason]}
      />

      {/* Mono: the section title and the field name are the packet's own voice,
          spelled as the sample spells them. */}
      <span className="lt-figure text-ink-3 text-[0.8125rem]">
        {blank.sectionTitle}
      </span>
      {/* Body size at 700, not the 16px `text-base` this carried: the sans
          ramp here runs 13, 14, 15 and then a title at 21, and rank on a row
          is bought with weight. It reads against the 13px section title to its
          left, which is the pair that tells the two apart. */}
      <span className="lt-figure font-bold">{blank.label}</span>
      <StateWord status={REASON_MARK[blank.reason]}>
        {REASON_WORD[blank.reason]}
      </StateWord>

      {/* The half-filled bagian, said out loud. Kosongkan on this row settles
          ONE potongan, and a bagian whose block ran past a page bottom holds
          several: an operator who reads it as "kosongkan seluruh baris ToP"
          has just written off a picture that is already accepted. The figure
          counts what the run holds, so it can only ever appear once a lanjutan
          has actually been found, and the warning that goes with it is fixed
          wording, so it sits behind a mark rather than on twelve rows. */}
      {blank.required > 1 ? (
        <span className="flex items-center gap-2">
          <span className="lt-kotak">
            {blank.found}/{blank.required} potongan
          </span>
          <Hint label="Berlaku untuk berapa potongan">
            Keputusan di baris ini hanya mengenai satu potongan. Potongan lain
            di bagian yang sama tidak ikut berubah.
          </Hint>
        </span>
      ) : null}

      {resolved ? (
        <span className="flex items-center gap-2">
          <span className="lt-label">
            {blank.zoneIsSibling ? "potongan lain" : "area"}
          </span>
          {/* The page's number inside its OWN source file, never the run-global
              index the zone is stored by. The berkas name is the kotak's title:
              the plate in the sheet below carries the full register, and twelve
              file names across the head of the sheet is the bulk this pass
              removed. */}
          <span className="lt-kotak" title={resolved.sourceName}>
            hal {resolved.pageInDoc + 1}/{resolved.pagesInDoc}
          </span>
        </span>
      ) : blank.zone ? (
        <span className="text-gap text-[0.8125rem]">
          Halamannya sudah tidak ada di pekerjaan ini.
        </span>
      ) : null}

      {index === null ? (
        /* The reason this row carries no control, and it never hides. */
        <span className="text-gap text-[0.8125rem]">
          Belum ada di pekerjaan ini. Mulai pekerjaan lain supaya ikut
          disiapkan.
        </span>
      ) : (
        <span className="ms-auto flex flex-wrap gap-2">
          {/* The potongan, because that is what drawing by hand LEAVES: a
              region cut out of a page. Its pair carries none, and that is the
              set's own rule about a homogeneous list rather than an oversight:
              two identical glyphs on every one of twelve rows discriminate
              nothing, and the icon belongs on the choice the design calls the
              equal terminal state rather than on the one that ships a blank. */}
          <Btn disabled={busy} onClick={() => onDraw(index)}>
            <Potongan />
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
 * found" list in both, which reads as "the new document did not help". That is
 * also the one moment this block claims the screen's primary control, because
 * it is the only moment where nothing else the operator can do will help.
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
    <div className="flex flex-wrap items-center gap-4">
      <p aria-live="polite" className="flex-1 text-sm">
        {searching ? (
          <>
            Mencari <span className="lt-figure">{searchable}</span> bagian.
          </>
        ) : afterDocument ? (
          <>
            Halaman baru belum dicari:{" "}
            <span className="lt-figure">{searchable}</span> bagian menunggu.
          </>
        ) : (
          <>
            <span className="lt-figure">{searchable}</span> bagian bisa dicari
            di <span className="lt-figure">{pages}</span> halaman.
          </>
        )}
      </p>

      {/* WHICH SENTENCE STAYS AND WHICH GOES, clause by clause. The counts are
          about THIS run and stand. The reassurance underneath reads the same
          words on every order, so it moves behind the mark. */}
      <Hint label="Yang terjadi kalau diproses lagi">
        Bukti yang sudah Anda terima tidak ikut dicari ulang, jadi memproses
        lagi tidak mengulang pekerjaan yang sudah selesai. Tab ini boleh
        dibiarkan terbuka selama prosesnya berjalan.
      </Hint>

      {onSearch ? (
        <Btn
          tone={afterDocument ? "primary" : "default"}
          disabled={searching || busy}
          aria-busy={searching || undefined}
          onClick={onSearch}
        >
          {/* `Proses`, the same word the Muat screen uses, because it is the
              same action: it is what turns halaman into usulan. Calling it
              "Cari bagian ini" here and "Proses" there would make one action
              wear two names across the flow, which is the thing the glossary
              in docs/ui-bahasa.md exists to stop. */}
          <Cari />
          {searching ? "Memproses..." : "Proses lagi"}
        </Btn>
      ) : null}
    </div>
  );
}

/**
 * The branch point, and it is no longer a paragraph.
 *
 * It used to be a five-element block asking a yes/no question: the question,
 * two buttons, an explanation, a conditional notice and a caveat, standing at
 * the top of the review sheet on every visit. It is one line now, and both
 * answers are on it: yes opens the dokumen tambahan dialog, no reveals the bulk
 * write-off, which is the only other way a blank can leave this list.
 *
 * The answer is remembered for the session only, and the question mark says
 * exactly that, because it is not written into the run: presenting a session
 * variable as a record would be the second-worst thing this block could do
 * after losing a decision outright.
 */
function Fork({
  noMore,
  onNoMore,
  busy,
  actionable,
  confirming,
  setConfirming,
  confirmRef,
  onUnfillAll,
  onAddDocument,
}: {
  noMore: boolean;
  onNoMore: (value: boolean) => void;
  busy: boolean;
  actionable: Blank[];
  confirming: boolean;
  setConfirming: (value: boolean) => void;
  confirmRef: React.RefObject<HTMLDivElement | null>;
  onUnfillAll: (slotIndexes: number[]) => void;
  onAddDocument: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* The question still has to be ASKED: without it "Tidak, hanya ini"
            is an answer to nothing. */}
        <span id="tambahan-question" className="lt-label">
          Ada dokumen tambahan?
        </span>

        {/* The klip, because what the operator is about to hand over is another
            document clipped to the same pekerjaan. */}
        <Btn
          disabled={busy}
          aria-describedby="tambahan-question"
          onClick={onAddDocument}
        >
          <Klip />
          Tambah dokumen
        </Btn>

        <Btn
          on={noMore}
          aria-pressed={noMore}
          aria-describedby="tambahan-question"
          onClick={() => onNoMore(!noMore)}
        >
          Tidak, hanya ini
        </Btn>

        <Hint label="Tentang jawaban ini">
          Bagian yang belum ada buktinya mungkin ada di berkas lain, dan bukti
          yang sudah Anda terima tetap disimpan. Jawaban ini hanya berlaku
          selama tab ini terbuka dan tidak ikut tersimpan di pekerjaan.
        </Hint>
      </div>

      {noMore ? (
        confirming ? (
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
          <div className="flex flex-wrap items-center gap-4">
            {/* The consequence of the answer just given, beside the control it
                enables. Both answers stay live, so "tidak, hanya ini" followed
                by a document turning up anyway is a state this block holds. */}
            <Notice tone="warn">
              Tanpa berkas lain, setiap bagian butuh keputusan Anda.
            </Notice>
            <Btn
              tone="reject"
              disabled={busy || actionable.length === 0}
              onClick={() => setConfirming(true)}
            >
              {/* The double rule a clerk leaves in a cell that stays blank:
                  the button draws what the click leaves behind, times the
                  count beside it. */}
              <Kosongkan />
              Kosongkan semua ({actionable.length})
            </Btn>
          </div>
        )
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
 *
 * A SLAB INSIDE A SLAB, so it is SET IN rather than lifted: `.lt-slab-flat`
 * nested in a block goes darker than the block holding it and takes the
 * shallow inner shadow that says so, which is what makes a confirmation read
 * as something opened inside the list rather than as a second list beside it.
 * The old wording, "casts no plate of its own", named a hard offset shadow
 * this system does not have. The kop asks the question, and the well under it
 * lists what is about to be written off.
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
      className="lt-slab-flat"
    >
      <div className="lt-kop" data-owes="decision">
        <h3 id="kosongkan-semua">Kosongkan {rows.length} bagian?</h3>
      </div>

      <div className="lt-slab-body flex flex-col gap-4">
        <p className="text-sm">
          Bagian ini dikirim kosong di DOKUMEN VALIDASI, atas keputusan Anda:
        </p>

        <ul className="lt-well flex max-h-48 flex-col gap-2 overflow-auto p-4">
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
            <span className="flex flex-wrap items-center gap-2">
              <span className="lt-figure">{unsearched}</span> di antaranya belum
              pernah dicari.
              <Hint label="Kenapa itu berbeda">
                Belum ada yang pernah melihat apakah buktinya ada, jadi itu
                bukan bukti yang hilang.
              </Hint>
            </span>
          </Notice>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <Btn tone="reject" disabled={busy} onClick={onConfirm}>
            Ya, kosongkan {rows.length} bagian
          </Btn>
          <Btn onClick={onCancel}>Batal</Btn>
          <Hint label="Kalau berubah pikiran">
            Untuk membatalkannya nanti, buka lagi bagiannya satu per satu di
            lembar periksa di bawah.
          </Hint>
        </div>
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
          {/* The same klip the block's own control carries, so the button and
              the box it opens are visibly one act. */}
          <DialogTitle className="flex items-center gap-2">
            <Klip size={20} />
            Dokumen tambahan
          </DialogTitle>
          <DialogDescription>
            <span className="flex flex-wrap items-center gap-2">
              Hanya bagian yang belum ada buktinya yang dicari lagi.
              <Hint label="Yang terjadi dengan bukti yang sudah diterima">
                Setiap area yang sudah Anda terima tetap tersimpan, jadi
                menambahkan berkas keempat tidak mengulang pekerjaan yang sudah
                selesai.
              </Hint>
            </span>
          </DialogDescription>
        </DialogHeader>

        {busy ? (
          <Reading progress={progress} />
        ) : (
          <DocumentDrop
            label="Dokumen tambahan"
            hint="Sesudah dibaca, pencarian masih harus dijalankan."
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
 *
 * THREE OR FOUR WORDS A LINE, on purpose. "Membuka berkas dan menghitung
 * halamannya" is the exact line the client named as unreasonably long, and
 * nothing is lost by cutting it: what the operator needs is that the document
 * is being read, and how much of it has landed.
 */
function Reading({ progress }: { progress: IngestProgress | null }) {
  const named = Boolean(progress?.name);
  const counting = !progress || progress.total <= 0;

  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        Membaca
        {named ? (
          <span className="lt-kotak" title={progress?.name}>
            {shortenFileName(progress?.name ?? "", 30)}
          </span>
        ) : (
          "dokumen"
        )}
      </p>

      <p className="flex flex-wrap items-center gap-2 text-sm">
        {counting ? (
          "Menghitung halaman."
        ) : (
          <>
            <span className="lt-kotak">
              {progress?.done}/{progress?.total}
            </span>
            halaman tersimpan.
          </>
        )}
      </p>

      {/* The reason the close control is missing, which never hides. The
          promise that the box lets go by itself is fixed wording and reads the
          same on every read, so it sits behind the mark with the rest of the
          explanation rather than doubling the line on screen. */}
      <div className="flex flex-wrap items-center gap-2">
        <Note>Tidak bisa ditutup sampai pembacaan selesai.</Note>
        <Hint label="Kenapa tidak bisa ditutup">
          Setiap halaman disimpan begitu selesai dibaca. Kotak ini bertahan
          supaya tidak ada pembacaan yang berjalan tanpa terlihat, dan menutup
          sendiri begitu selesai.
        </Hint>
      </div>
    </div>
  );
}

/**
 * The documents read in THIS SESSION, and nothing stronger.
 *
 * `rounds` lives in the shell's React state, is reset when a run is opened, and
 * is never persisted, so it is empty exactly when it would matter most: after
 * the reload of a long session. Fixing that means changing storage, which is
 * out of scope here, so the mark beside it says plainly what this list is
 * rather than letting it pass as an audit trail.
 */
function SessionHistory({ rounds }: { rounds: RoundLog[] }) {
  if (rounds.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="lt-label">Dibaca di sesi ini</span>
      {rounds.map((round, i) => (
        <span
          key={`${round.round}-${round.document}-${i}`}
          className="lt-kotak"
          title={round.document}
        >
          {shortenFileName(round.document, 28)} +{round.pagesAdded}
        </span>
      ))}
      <Hint label="Tentang daftar ini">
        Daftar ini hanya ada selama tab ini terbuka, jadi jangan dipakai sebagai
        catatan serah terima.
      </Hint>
    </div>
  );
}
