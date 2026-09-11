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
 * the fold, and the two controls that exist nowhere else on this screen, Baca
 * dengan AI and Tambah dokumen, stand outside the disclosure at all times.
 *
 * THE LIST IS CLOSED ON ARRIVAL. It used to open on the first visit to a
 * order, on the argument that a briefing is read once. The density pass
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
 * FIVE KINDS OF BLANK, ONE VOCABULARY. Never searched, searched and not found,
 * you rejected the usulan, nothing will ever search it because the judul is
 * your own, you chose to ship it empty. The old screen printed one hardcoded
 * chip on every row, so all of them read alike, and the reason is the only fact
 * that decides whether adding a document will help at all. Each kind keeps its
 * own `Mark` shape and its own word, and the block counts them apart. The
 * SENTENCES that gloss those words are behind a question mark, once each,
 * because they read the same on every order for the life of this product;
 * twelve rows carrying repeated paragraphs is the bulk that made this a screen
 * in the first place.
 *
 * THE FIFTH IS "belum digambar" AND IT IS NOT A FAILURE. A judul the operator
 * added is captured by hand by design (`AddedSection` carries no layout;
 * `isSearchable` is false for every bagian under one), so no berkas and no
 * round can ever fill it. It had been reported as "tidak ditemukan" -- a word
 * fixed in `docs/ui-bahasa.md` to mean SEARCHED AND NOT FOUND -- which told the
 * operator, on every reading pass, for ever, that the tool had hunted for
 * something nobody had ever asked it about, in the one place they go to decide
 * whether to fetch another document.
 *
 * AND ONE THING THAT IS NOT A BLANK AT ALL: a potongan stored under a key this
 * order's form does not declare. See `Stray`.
 *
 * AND ONE SLAB THAT IS NOT ABOUT BLANKS AT ALL: the USULAN JUDUL, above
 * everything, in its own block. Every list below is about a bagian THE FORM
 * ALREADY DECLARES and the tool could not fill; a usulan is a JUDUL the form
 * does not have, which the AI read off a berkas and which does not exist in
 * this order until a person accepts it. It stands above the "nothing left"
 * branch too, because an order can owe no blanks at all and still owe four of
 * these. See `UsulanJudul`.
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

import { useEffect, useId, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isSearchable } from "@/lib/forms/overlay";
import type { NodeId, ProposedSection } from "@/lib/forms/overlay";
import type { Template } from "@/lib/forms/template";
import { resolvePage } from "@/lib/ui/evidence";
import {
  DISCOVER_FENCED_REASON,
  NO_USULAN_WAITING,
  PAGES_NOT_IN_JUDUL,
  REASON_HINT_LABEL,
  REASON_MARK,
  REASON_ORDER,
  REASON_SENTENCE,
  REASON_WORD,
  SEARCH_ALL_FENCED_REASON,
  berkasUsulan,
  reasonOf,
} from "@/lib/ui/outstanding";
import type { BerkasUsulan, Reason } from "@/lib/ui/outstanding";
import { searchablePageCount, wantedKeys } from "@/lib/ui/propose";
import { slotKeyOf } from "@/lib/ui/runtime";
import type {
  BrowserRun,
  RefusedDocument,
  SectionEdit,
  SlotState,
  UsedElsewhere,
  Zone,
} from "@/lib/ui/runtime";
import { templateSlots } from "@/lib/ui/slots";
import { useRunTemplate } from "@/lib/ui/use-run-template";

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
import { Denah } from "./denah";
import { Cari, Klip, Kosongkan, Otak, Potongan } from "./icons";
import {
  Antrean,
  DocumentDrop,
  Refusals,
  Reused,
  type IngestFault,
  type IngestProgress,
  type QueuedDocument,
} from "./ingest-panel";
import type { SectionEditor } from "./judul";

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
 * Why every decision on this block is refused while a document is being loaded.
 *
 * ONE SENTENCE, DECLARED ONCE, because it rides on each of the five controls
 * the load disables instead of standing in a notice above them. Five
 * hand-typed copies is how two of them end up describing one state in two
 * different ways.
 *
 * IT SAYS PEMUATAN, NOT PEMBACAAN, and that is the same split ingest-panel
 * made upstream: move one is MUAT, the pages coming in, and move two is the AI
 * reading them. This block carries both, a few centimetres apart, so a hold
 * that said "pembacaan" while the key below it says "Baca dengan AI" named the
 * wrong move at the one moment the operator is asking which one they are
 * waiting for.
 */
const LOADING_HOLD = "Tunggu pemuatan dokumen selesai.";

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

/**
 * A potongan stored under a key this order's form does not declare.
 *
 * IT IS NOT A BLANK AND IT USED TO BE FILED AS ONE. These rows were pushed into
 * `blanks` with `OUTSIDE_TEMPLATE` as their sectionTitle, which put them in a
 * list built by walking the template, counted them under a reason word that
 * describes a search, and offered them the blank's two remedies -- neither of
 * which does anything here. "Gambar sendiri" draws a new rectangle under a key
 * that still reaches no cell, and "Kosongkan" changes the word while leaving
 * the zone in place (`PlannedCapture.strandedZone`), so the export stays
 * blocked and the screen says the bagian was settled.
 *
 * Worse, the filing HID the ones that actually block: `isBlank` is false for a
 * capture that carries a zone, so a confirmed orphan -- the only kind
 * `blockingItems` stops the export on -- appeared on no list at all. An
 * operator could reach a permanently blocked export screen with nothing
 * anywhere to press.
 *
 * So every one of them is listed here, whatever its status, with the one remedy
 * that is true: drop it.
 */
type Stray = {
  /** Position in `run.slots`. Always known: a stray IS a stored state. */
  index: number;
  key: string;
  label: string;
  status: SlotState["status"];
  zone: Zone | null;
};

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
 *
 * `template` IS THIS ORDER'S RESOLVED FORM, and passing the module constant
 * here is the whole defect this parameter exists to close. The walk below IS
 * the list of judul the operator is looking at: read the constant and a judul
 * they deleted is walked as though it were still there (its bagian reported as
 * work owed, for ever) while a judul they added is walked past entirely, so its
 * bagian -- the ones that can ONLY be captured by hand -- appear on no list
 * anywhere.
 */
function collectBlanks(
  run: BrowserRun,
  reportedOutstanding: Set<number>,
  template: Template,
): { blanks: Blank[]; emptied: Blank[]; strays: Stray[] } {
  const captures = new Map<string, { state: SlotState; index: number }[]>();
  run.slots.forEach((state, index) => {
    const key = slotKeyOf(state.key);
    const list = captures.get(key);
    if (list) list.push({ state, index });
    else captures.set(key, [{ state, index }]);
  });

  const blanks: Blank[] = [];
  const emptied: Blank[] = [];
  const strays: Stray[] = [];
  const declared = new Set<string>();

  for (const { section, slot } of templateSlots(template)) {
    declared.add(slot.key);
    if (!slot.fillable) continue;

    // ASKED ONCE PER BAGIAN, on the template key, and handed to every row this
    // slot produces. False means the model is never asked where this bagian is
    // -- the judul is one the operator added, so its potongan is theirs to take
    // -- which is a fifth kind of blank and not a fifth flavour of failure.
    const searchable = isSearchable(template, slot.key);
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
        // "belum dicari" would be a promise here: it says a round can still
        // find this. On a judul the operator added no round ever will.
        reason: searchable ? "unsearched" : "undrawn",
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
        reason: reasonOf(state, searchable),
        zone: state.zone ?? sibling,
        zoneIsSibling: !state.zone && sibling !== null,
      });
    }
  }

  // Slot states the run holds under a key this order's form does not declare.
  // Listed rather than dropped: the tool is document-agnostic, an operator can
  // delete a judul mid-order, and a stored run can outlive the slot list that
  // made it, so hiding these captures would hide real work.
  //
  // EVERY ONE OF THEM, WHATEVER ITS STATUS, which is the change: `isBlank` is
  // false for a capture carrying a zone, so the very orphans `blockingItems`
  // stops the export on were the ones this block never showed.
  run.slots.forEach((state, index) => {
    if (declared.has(slotKeyOf(state.key))) return;
    strays.push({
      index,
      key: state.key,
      label: state.label || state.key,
      status: state.status,
      zone: state.zone ?? null,
    });
  });

  return { blanks, emptied, strays };
}

type PanelProps = {
  run: BrowserRun;
  /** Positions in `run.slots` the runtime reports as outstanding. */
  outstandingKeys: number[];
  rounds: RoundLog[];
  progress: IngestProgress | null;
  busy: boolean;
  /**
   * The ingest that just failed. Unlike `ingest-panel.tsx` this panel does
   * speak the fault's own sentence, because the drop it belongs to is a
   * dialog the operator may have closed; the `detail` rides behind a
   * disclosure exactly as it does everywhere else.
   */
  fault: IngestFault | null;
  onFiles: (files: File[]) => void;
  /**
   * THE SAME ANTREAN THE MUAT SCREEN SHOWS, because it is the same hand-over.
   *
   * The shell owns the queue, so a berkas dropped here and a berkas dropped
   * there join one list read by one loop. Passing it through means this dialog
   * can leave its drop target LIVE while a document is being read, which is
   * the whole point: an operator who has just been told a bagian is missing is
   * exactly the operator who goes and finds two more documents, one after the
   * other.
   */
  queue?: readonly QueuedDocument[];
  screening?: boolean;
  refusals?: readonly RefusedDocument[];
  /** Berkas another order already holds; see `Reused`. */
  reused?: readonly UsedElsewhere[];
  onCancelQueued?: (id: string) => void;
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
   * "Buang potongan ini": drop a `Stray` outright.
   *
   * REQUIRED, unlike `onSearch`, because there is no honest degraded shape for
   * it. A block that lists a potongan the deliverable cannot carry, states that
   * it stops the export, and offers no way to clear it is worse than one that
   * never mentioned it: the operator is told they are stuck and not told what
   * to press. The shell's handler must name the dropped keys in `saveRun`'s
   * `removing`, or storage refuses the write as a capture loss.
   */
  onDiscard: (slotIndex: number) => void;
  /**
   * Optional. Adding a document proposes nothing on its own, so a round is
   * still owed afterwards; without this the block still SAYS so, it just cannot
   * start one, which is the right shape when the shell offers the round itself.
   */
  onSearch?: () => void;
  searching?: boolean;
  /**
   * ONE GESTURE ON THIS ORDER'S FORM, handed over as a value, exactly as
   * `judul.tsx` hands its own. It is what "Terima", "Bukan ini" and "Ganti
   * namanya" compose.
   *
   * OPTIONAL, and without it the usulan are still LISTED with their berkas,
   * their halaman and their baris -- they just cannot be ruled on here. That is
   * the same degraded shape `onSearch` takes, and it is the honest one: a
   * usulan the operator cannot see at all is a decision owed that nothing on
   * screen mentions, which is worse than one they have to rule on elsewhere.
   */
  onSectionEdit?: SectionEditor;
  /**
   * "Cari judul lagi": put the judul question to one berkas a second time.
   *
   * A SEPARATE PROP RATHER THAN A `SectionEdit`, because it is not an edit to
   * the form. It clears that berkas's `sectionsAskedFor` -- the cost gate that
   * stops a second press of Baca dengan AI paying for the same answer -- and
   * then reads again, which is a run write plus a network round trip and
   * belongs to the shell that owns both.
   */
  onDiscoverAgain?: (sourceId: string) => void;
};

/**
 * A different order is a different question, and every piece of state in
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
  fault,
  onFiles,
  queue = [],
  screening = false,
  refusals = [],
  reused = [],
  onCancelQueued,
  onDraw,
  onUnfill,
  onUnfillAll,
  onDiscard,
  onSearch,
  searching = false,
  onSectionEdit,
  onDiscoverAgain,
}: PanelProps) {
  /**
   * THIS ORDER'S FORM. Every list on this block is built from it, and reading
   * the module constant instead is what made a judul the operator deleted come
   * back as work owed on every visit.
   */
  const template = useRunTemplate(run);
  /**
   * IS A ROUND OWED? A document has been read into this order and nothing
   * has searched it yet. Computed before any state because the list's opening
   * position depends on it: see `expanded` below.
   *
   * `wantedKeys` NOW FILTERS ON THE FORM, so this figure is what a round would
   * genuinely look for. It used to count bagian nothing would ever search --
   * the operator's own judul, and judul they had deleted -- so a order with
   * nothing left to find still offered "Baca dengan AI" over a count that could
   * only come back as a miss.
   */
  const searchable = wantedKeys(run, template).length;
  const owesRound = rounds.length > 0 && searchable > 0;

  /** Is the dokumen tambahan dialog open? */
  const [dropOpen, setDropOpen] = useState(false);
  /** Did the operator answer "no more documents"? Session only, and it says so. */
  const [noMore, setNoMore] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /**
   * Is the list of blanks open under its disclosure? Closed, unless a round is
   * owed: Baca dengan AI outranks the rows the moment a document has been
   * read.
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
    if (wasBusy.current && !busy && !fault) setDropOpen(false);
    wasBusy.current = busy;
  }, [busy, fault]);

  const { blanks, emptied, strays } = collectBlanks(
    run,
    new Set(outstandingKeys),
    template,
  );
  const actionable = blanks.filter((b) => b.index !== null);

  const counts: Record<Reason, number> = {
    notfound: blanks.filter((b) => b.reason === "notfound").length,
    rejected: blanks.filter((b) => b.reason === "rejected").length,
    unsearched: blanks.filter((b) => b.reason === "unsearched").length,
    undrawn: blanks.filter((b) => b.reason === "undrawn").length,
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

  // ONLY INSIDE THE DIALOG NOW, and the missing half is deliberate. This used
  // to print the failure above the sheet as well, whenever the dialog was shut,
  // because the lembar periksa was a screen of its own and no other drop was
  // visible from it. Berkas Order draws the upload section directly above this
  // sheet on the same page, and that section carries every ingest failure in
  // full -- so a second copy here would state one failure twice on one screen,
  // which reads as two failures.
  const errorNotice = fault ? (
    <Notice tone="stop">
      {/* The same two-part shape `Interruption` uses, gap and all, because it
          is the same object: one sentence for the operator, and the raw
          diagnosis behind a disclosure under it. THE DIAGNOSIS TRAVELS WITH
          THE SENTENCE -- this notice used to carry the sentence alone, so a
          failed tambahan round told the operator that something went wrong
          and told nobody what. */}
      <div className="flex flex-col gap-2">
        <p>{fault.sentence} Halaman yang sudah dimuat tetap tersimpan.</p>
        {fault.detail ? <TechnicalDetail>{fault.detail}</TechnicalDetail> : null}
      </div>
    </Notice>
  ) : null;

  const dialog = (
    <TambahanDialog
      open={dropOpen}
      onOpen={setDropOpen}
      busy={busy}
      progress={progress}
      errorNotice={errorNotice}
      onFiles={onFiles}
      queue={queue}
      screening={screening}
      refusals={refusals}
      reused={reused}
      onCancelQueued={onCancelQueued}
    />
  );

  // The sheet below already refuses to be reviewed with no pages and says so in
  // its own stop notice. Saying it twice, once above the other, is furniture.
  if (run.pages.length === 0) return null;

  /**
   * THE USULAN JUDUL STAND ABOVE THE BLANKS, and above the "nothing left"
   * branch too.
   *
   * They are a different question from the rest of this block. Everything below
   * is about a bagian the form already declares and the tool could not fill; a
   * usulan is a JUDUL the form does not have at all, which the AI read off a
   * berkas and which does not exist in this order until a person says so. An
   * order can perfectly well owe no blanks and still owe four of these, so it
   * cannot live inside the branch that reports the work finished.
   */
  const usulan = (
    <UsulanJudul
      run={run}
      // The judul edits are run writes like any other, so they are held while a
      // document is being read for the same reason every control here is.
      busy={busy}
      searching={searching}
      onEdit={onSectionEdit}
      onDiscoverAgain={onDiscoverAgain}
    />
  );

  /**
   * NOTHING IS OUTSTANDING: one slab that says so, or nothing at all.
   *
   * This block is read on arrival at Periksa, every visit, for the whole life
   * of a order. Once the work is done it must not go on occupying the top
   * of the screen with a congratulation, so it collapses to a kop and one line,
   * and to nothing when there is not even that much to report.
   *
   * The clear is AFFIRMATIVE and therefore stays on screen rather than hiding:
   * an absent warning is not a confirmation, which is the rule this whole
   * product is built on.
   */
  //
  // A STRAY IS NOT "NOTHING LEFT". It stops the export outright
  // (`blockingItems`), and the only control that clears it is on this block, so
  // it can never fall into the branch that reports the work finished.
  if (blanks.length === 0 && strays.length === 0) {
    const nothingPending =
      emptied.length === 0 && rounds.length === 0 && !busy && fault === null;
    // A usulan owes a decision whatever the bagian list says, so it keeps this
    // block alive on its own.
    if (nothingPending) return usulan;

    return (
      <>
      {usulan}
      <section aria-labelledby="tambahan-head" className="lt-slab">
        <div className="lt-kop" data-owes={fault ? "fault" : "done"}>
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
          <Note>
            Setiap bagian yang bisa didukung dokumen sudah terisi atau sudah
            Anda putuskan.
          </Note>
          <SessionHistory rounds={rounds} />
        </div>

        {dialog}
      </section>
      </>
    );
  }

  return (
    <>
    {usulan}
    <section aria-labelledby="tambahan-head" className="lt-slab">
      {/* THE KOP IS THIS BLOCK'S STATUS CHANNEL. An amber tint over the bar and
          a 4px amber rule down its leading edge mean it owes the operator a
          decision, the correction pen in the same two places means a read
          failed, and the figure at the right is the size of the debt. Neither
          hue is ever a saturated fill under light text; the rule is what reads
          from across the room. Nothing else on the block has to carry that
          signal, and none of it can be collapsed. */}
      <div className="lt-kop" data-owes={fault ? "fault" : "decision"}>
        {/* THE KOP NAMES WHICHEVER DEBT IT IS COUNTING. A order can reach this
            branch on strays alone -- every bagian decided, and a potongan left
            over under a key the form no longer declares -- and heading that
            "Bagian tanpa bukti / 0" would be a figure contradicting its own
            list. The strays carry their own count on their own register either
            way, so nothing is hidden in the case where both are present. */}
        <h2 id="tambahan-head">
          {blanks.length > 0 ? "Bagian tanpa bukti" : "Potongan di luar template ini"}
        </h2>
        <span className="lt-figure lt-kop-right">
          {blanks.length > 0 ? blanks.length : strays.length}
        </span>
      </div>

      <div className="lt-slab-body flex flex-col gap-4">
        {/* The count changes as decisions are taken, with no navigation. */}
        <p aria-live="polite" className="sr-only">
          {blanks.length} bagian belum ada buktinya. {emptied.length} bagian
          sudah Anda kosongkan.{" "}
          {strays.length > 0
            ? `${strays.length} potongan tidak punya tempat di dokumen ini.`
            : ""}
        </p>


        {/* ABOVE EVERYTHING, AND NEVER BEHIND THE FOLD. This is the one control
            in the product that can clear a blocked export, it appears on no
            other screen, and the rule this block states about its own
            disclosure is that a control existing nowhere else stands outside
            it. */}
        <Strays rows={strays} run={run} busy={busy} onDiscard={onDiscard} />

        {/* THE HOLD DURING A READ TRAVELS ON THE CONTROLS IT HOLDS. It was a
            standing amber notice here saying "Keputusan ditahan sampai
            pembacaan selesai", with a question mark explaining that a write
            landing mid-read would be refused by storage. Both halves were
            wrong for this screen: amber means A DECISION IS OWED and a
            temporary hold owes nothing, and how our storage refuses a stale
            write is our engineering rather than anything the operator can act
            on. Every control the hold disables now carries the reason itself,
            reachable by pointer, by keyboard and by screen reader, which is
            also the one thing a collapsible notice could never promise: a
            reason that cannot be folded away from the button it explains. */}
        <ReasonCounts counts={counts} />

        {/* WHY NO USULAN CAME OUT OF THOSE BERKAS, said once, here.

            IT DOES NOT TOUCH THE WORDS ABOVE IT, and that is the whole design
            of this line. A bagian in an order holding a fenced berkas is still
            honestly `belum dicari` or `tidak ditemukan`: those words mean what
            they have always meant, they are what `reasonOf` derives per
            bagian, and one of them is the operator's own recorded rejection.
            Relabelling them run-wide would collapse five distinct reasons into
            one, and would point the dokumen tambahan question at a berkas the
            operator is already holding.

            So the fence is reported as a fact about the ORDER, above the
            counts and above the question, where it qualifies both without
            rewriting either. It names the berkas, because "1 berkas" with no
            name is a fact nobody can act on -- the action is to switch it back
            to Dibaca AI in the documents bar. */}
        <FencedBerkas run={run} />

        {/* ABOVE THE QUESTION, because when a round is owed it outranks it:
            deciding a bagian by hand before anything has looked for it is the
            one decision on this block that cannot be taken back cheaply. */}
        {searchable > 0 ? (
          <SearchLine
            searchable={searchable}
            /* THE HALAMAN A ROUND WILL ACTUALLY BE GIVEN, not every halaman in
               the order. `run.pages.length` counts the pages of a berkas the
               operator fenced with "tanpa AI", whose lines `buildProposeRequest`
               strips before it sends -- so this line promised a search over
               pages nothing would read. */
            pages={searchablePageCount(run)}
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
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Usulan judul: what the AI thinks a berkas is made of.
 * ------------------------------------------------------------------ */

/**
 * THE JUDUL THE AI READ OFF A BERKAS, AS USULAN A PERSON RULES ON.
 *
 * The operator's own request: *"Kalo di-scan AI, AI bisa bikinin section-nya
 * sendiri, tapi user harusnya juga bisa rename setiap slot."* So the AI names
 * headings and a person decides, every time, one at a time.
 *
 * ## A USULAN IS NOT A JUDUL, AND THE CODE SAYS SO RATHER THAN THIS COMMENT
 *
 * These rows live in `overlay.proposed`, and `resolveTemplate` does not read
 * that array at all. Nothing here is in the packet or on the outstanding list; there is no code path from a heading the model invented to
 * a deliverable that does not pass through "Terima". That is why this block can
 * afford to show what a model said in the DOCUMENT'S OWN MONO VOICE: the title
 * is a transcription (`src/lib/pipeline/sections.ts` refuses one that is not
 * literally in the lines it cites), and it is a quotation right up to the point
 * where a person adopts it.
 *
 * ## WHY IT IS ITS OWN SLAB AND NOT A FIFTH KIND OF BLANK
 *
 * Everything else on this screen is about a bagian THE FORM ALREADY DECLARES
 * that has no evidence. This is about a judul the form does not have at all.
 * The five reason words below (`belum dicari`, `tidak ditemukan`, ...) all
 * describe a search for something known to be wanted, and none of them can be
 * said about a heading nobody has agreed exists yet. Filing these among the
 * blanks would also count them in the kop's debt figure, which is the number
 * an operator reads as "how much work is left on the packet".
 *
 * ## THREE ANSWERS, AND THE THIRD IS THE ONE THE OPERATOR ASKED FOR
 *
 * Terima adopts it. Bukan ini ends it. Ganti namanya keeps it a usulan and
 * changes its words, which is exactly the case the request names: the AI is
 * right that there is a judul here and wrong about what to call it. It is
 * written as a re-record of that berkas's usulan rather than as a new edit
 * shape, because `record-proposals` REPLACES one berkas's entries by design --
 * so renaming is the same write that filing them was, with one title changed,
 * and no second spelling of a name exists anywhere to disagree with the first.
 */
function UsulanJudul({
  run,
  busy,
  searching,
  onEdit,
  onDiscoverAgain,
}: {
  run: BrowserRun;
  busy: boolean;
  searching: boolean;
  onEdit?: SectionEditor;
  onDiscoverAgain?: (sourceId: string) => void;
}) {
  /** Which usulan is having its name typed, and which is being written. */
  const [renaming, setRenaming] = useState<NodeId | null>(null);
  const [working, setWorking] = useState<NodeId | null>(null);

  const proposed = run.overlay.proposed;

  // Every berkas of this order, with what may truthfully be said about it.
  // The arithmetic is in `../../lib/ui/outstanding.ts` so a test can drive it
  // with a real run: three of the sentences this block prints were false in
  // ways only a run with a rejection in it makes visible.
  const groups = berkasUsulan(run);

  /**
   * USULAN WHOSE BERKAS THIS ORDER NO LONGER HOLDS.
   *
   * Listed rather than dropped, and offered ONLY "Bukan ini". A usulan carries
   * `fromPages` as POSITIONS in `run.pages`, and removing a berkas renumbers
   * that array -- so accepting one of these would take whole-page potongan of
   * whatever now sits at those positions, under a heading read out of a
   * document that is gone. Hiding them instead would leave a decision owed that
   * nothing on screen mentions.
   */
  const held = new Set(run.sources.map((source) => source.id));
  const orphans = proposed.filter((entry) => !held.has(entry.fromSourceId));

  const live = groups.filter((group) => group.usulan.length > 0 || group.asked);
  if (live.length === 0 && orphans.length === 0) return null;

  const hold = busy
    ? LOADING_HOLD
    : searching
      ? "Tunggu pembacaan AI selesai."
      : undefined;

  const edit = (id: NodeId, next: SectionEdit) => {
    if (!onEdit) return;
    setWorking(id);
    setRenaming(null);
    void onEdit(next).finally(() => setWorking(null));
  };

  /**
   * A RENAME IS A RE-RECORD OF THAT BERKAS'S USULAN, one title changed.
   *
   * `record-proposals` replaces a berkas's entries wholesale by design, so this
   * is the same write that filed them. The alternative -- a `rename-proposal`
   * edit -- would put a second home for a usulan's title in the overlay, and
   * every two-homed name in this codebase has ended up disagreeing with itself.
   */
  const rename = (sourceId: string, id: NodeId, title: string) =>
    edit(id, {
      tag: "record-proposals",
      sourceId,
      sections: proposed
        .filter((entry) => entry.fromSourceId === sourceId)
        .map((entry) => (entry.id === id ? { ...entry, title } : entry)),
    });

  return (
    <section aria-labelledby="usulan-head" className="lt-slab">
      {/* AMBER ONLY WHILE SOMETHING IS ACTUALLY OWED. A berkas that was asked
          and yielded nothing leaves this block standing with a count of zero,
          and marking that as a decision owed is how amber stops being read. */}
      <div
        className="lt-kop"
        data-owes={proposed.length > 0 ? "decision" : "done"}
      >
        <h2 id="usulan-head">Usulan judul dari AI</h2>
        {proposed.length > 0 ? (
          <span className="lt-figure lt-kop-right">{proposed.length}</span>
        ) : null}
      </div>

      <div className="lt-slab-body flex flex-col gap-4">
        <p aria-live="polite" className="sr-only">
          {proposed.length} usulan judul menunggu keputusan Anda.
        </p>

        {live.map((group) => (
          <BerkasUsulan
            key={group.id}
            run={run}
            group={group}
            hold={hold}
            working={working}
            renaming={renaming}
            onRename={setRenaming}
            canEdit={onEdit !== undefined}
            onEdit={edit}
            onSubmitName={rename}
            onDiscoverAgain={onDiscoverAgain}
          />
        ))}

        {orphans.length > 0 ? (
          <div className="flex flex-col gap-2">
            <Notice tone="stop">
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="lt-figure">{orphans.length}</span>
                <span>
                  usulan berasal dari berkas yang sudah tidak ada di order ini,
                  jadi halamannya tidak bisa diambil lagi.
                </span>
              </span>
            </Notice>
            <ul className="border-line flex flex-col border-t">
              {orphans.map((entry) => (
                <li
                  key={entry.id}
                  className="border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-2"
                >
                  <Mark status="outstanding" title="berkasnya sudah tidak ada" />
                  <span className="lt-figure font-bold">{entry.title}</span>
                  <span className="ms-auto">
                    <Btn
                      tone="reject"
                      disabled={hold !== undefined || !onEdit}
                      reason={hold ?? "Keputusan usulan belum bisa diambil di layar ini."}
                      onClick={() =>
                        edit(entry.id, { tag: "reject-proposal", id: entry.id })
                      }
                    >
                      Bukan ini
                    </Btn>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {onEdit ? null : (
          /* The degraded shape, said out loud rather than left as three keys
             that do nothing. It is a deployment fault, not an operator's, so it
             names what is missing in their terms and stops there. */
          <Note>
            Usulan di atas belum bisa diputuskan di layar ini. Judul bisa
            ditambahkan sendiri lewat Tambah judul di Susunan judul.
          </Note>
        )}
      </div>
    </section>
  );
}

/** One berkas's usulan, under the one sentence that says how many there are. */
function BerkasUsulan({
  run,
  group,
  hold,
  working,
  renaming,
  onRename,
  canEdit,
  onEdit,
  onSubmitName,
  onDiscoverAgain,
}: {
  run: BrowserRun;
  group: BerkasUsulan;
  hold: string | undefined;
  working: NodeId | null;
  renaming: NodeId | null;
  onRename: (id: NodeId | null) => void;
  canEdit: boolean;
  onEdit: (id: NodeId, edit: SectionEdit) => void;
  onSubmitName: (sourceId: string, id: NodeId, title: string) => void;
  onDiscoverAgain?: (sourceId: string) => void;
}) {
  /**
   * WHY "Cari judul lagi" IS DOWN ON A FENCED BERKAS.
   *
   * `discoverIds` drops a berkas marked tanpa AI, and nothing lifts that -- not
   * even naming it in `again`, which is what this key does. So the press ran a
   * whole pass over the order and came back with a sentence about a search that
   * had not happened, on the one berkas the operator had just asked about. The
   * reason rides on the control per the house rule; the fence itself is already
   * on the page in prose, in `FencedBerkas`.
   */
  const discoverHold = hold ?? (group.fenced ? DISCOVER_FENCED_REASON : undefined);

  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        {group.usulan.length > 0 ? (
          <>
            AI menemukan <span className="lt-figure">{group.usulan.length}</span>{" "}
            judul di berkas
          </>
        ) : (
          /* NOT "AI tidak menemukan judul": see `NO_USULAN_WAITING`. An empty
             list is also what a berkas whose usulan were all REFUSED looks
             like, and what one whose usulan were all ACCEPTED looks like, and
             the runtime keeps nothing that tells the three apart. */
          <>{NO_USULAN_WAITING}</>
        )}
        <span className="lt-kotak" title={group.name}>
          {shortenFileName(group.name, 30)}
        </span>
      </p>

      {group.usulan.length > 0 ? (
        <ul
          aria-label={`Usulan judul dari ${group.name}`}
          className="border-line flex flex-col border-t"
        >
          {group.usulan.map((entry) => (
            <UsulanRow
              key={entry.id}
              run={run}
              sourceId={group.id}
              entry={entry}
              hold={hold}
              busy={working === entry.id}
              canEdit={canEdit}
              renaming={renaming === entry.id}
              onRename={onRename}
              onEdit={onEdit}
              onSubmitName={onSubmitName}
            />
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        {group.asked && group.unclaimed > 0 ? (
          /* NOT "tidak diusulkan": a halaman whose usulan the operator REFUSED
             lands in this count and had one proposed for it. The figure is
             right and the claim about it was not, so the line reports the state
             (`PAGES_NOT_IN_JUDUL`) instead of the history. */
          <span className="text-ink-2 flex flex-wrap items-center gap-2 text-[0.8125rem]">
            <span className="lt-figure">{group.unclaimed}</span>
            {PAGES_NOT_IN_JUDUL}
          </span>
        ) : null}

        {onDiscoverAgain && group.asked ? (
          <>
            <Btn
              disabled={discoverHold !== undefined}
              reason={discoverHold}
              onClick={() => onDiscoverAgain(group.id)}
            >
              {/* The brain, because this is the AI reading again, and the same
                  glyph it wears wherever else it reads. */}
              <Otak />
              Cari judul lagi
            </Btn>
            {/* STATED AS A REPEAT OF A SEARCH, not as a free action. It is
                another model call over the whole berkas, and it REPLACES the
                usulan on screen -- which matters most to the operator who has
                just renamed one and not yet accepted it.

                NOT SHOWN ON A FENCED BERKAS, because every word of it would be
                false there: nothing reads that berkas again and no usulan is
                replaced. The key beside it carries the reason instead. */}
            {group.fenced ? null : (
              <Hint label="Yang terjadi kalau dicari lagi">
                AI membaca berkas ini sekali lagi. Usulan yang sekarang diganti
                dengan hasil baru, termasuk nama yang sudah Anda ubah. Judul yang
                sudah Anda terima tidak ikut berubah.
              </Hint>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** One usulan, one line, three answers. */
function UsulanRow({
  run,
  sourceId,
  entry,
  hold,
  busy,
  canEdit,
  renaming,
  onRename,
  onEdit,
  onSubmitName,
}: {
  run: BrowserRun;
  sourceId: string;
  entry: ProposedSection;
  hold: string | undefined;
  busy: boolean;
  canEdit: boolean;
  renaming: boolean;
  onRename: (id: NodeId | null) => void;
  onEdit: (id: NodeId, edit: SectionEdit) => void;
  onSubmitName: (sourceId: string, id: NodeId, title: string) => void;
}) {
  const resolved = resolvePage(run, entry.cite.pageIndex);
  const first = run.pages[entry.fromPages[0]];
  const held = hold ?? (busy ? "Keputusan ini sedang disimpan." : undefined);
  const stopped = held !== undefined || !canEdit;
  const why = held ?? "Keputusan usulan belum bisa diambil di layar ini.";

  return (
    <li className="border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-2">
      {/* AMBER: a decision is owed here, which is the only thing amber means. */}
      <Mark status="proposed" title="usulan judul" />

      {/* The page plan, so "is this the right page" is answered with a picture
          rather than with a better-typeset number. Decorative because the row
          names the berkas and the halaman in words beside it. */}
      <Denah
        page={first}
        size="sm"
        label={`Halaman pertama usulan ${entry.title}`}
        decorative
      />

      {/* Mono: the title is transcribed from the document, and the pipeline
          refuses one that is not literally in the lines it cites. */}
      <span className="lt-figure font-bold">{entry.title}</span>

      <span className="lt-kotak">{entry.fromPages.length} halaman</span>

      {/* Berkas, halaman, baris: where this heading was read, so the operator
          can go and look at it. Not `Cite` from chrome.tsx, which also prints
          "ukuran di halaman" -- there is no potongan here yet, so there is no
          size to state and inventing one would be a measurement of nothing. */}
      {resolved ? (
        <span className="flex flex-wrap items-center gap-2">
          <span className="lt-label">dari</span>
          <span className="lt-kotak" title={resolved.sourceName}>
            {shortenFileName(resolved.sourceName, 24)}
          </span>
          <span className="lt-kotak">
            hal {resolved.pageInDoc + 1}/{resolved.pagesInDoc}
          </span>
          <span className="lt-kotak">
            baris {entry.cite.lineRange[0]}-{entry.cite.lineRange[1]}
          </span>
        </span>
      ) : (
        <span className="text-gap text-[0.8125rem]">
          Halamannya sudah tidak ada di order ini.
        </span>
      )}

      {renaming ? (
        <NamaUsulan
          initial={entry.title}
          disabled={held !== undefined}
          onCancel={() => onRename(null)}
          onSubmit={(title) => onSubmitName(sourceId, entry.id, title)}
        />
      ) : (
        <span className="ms-auto flex flex-wrap gap-2">
          <Btn
            tone="primary"
            disabled={stopped}
            reason={why}
            onClick={() => onEdit(entry.id, { tag: "accept-proposal", id: entry.id })}
          >
            Terima
          </Btn>
          <Btn
            disabled={stopped}
            reason={why}
            onClick={() => onRename(entry.id)}
          >
            Ganti namanya
          </Btn>
          <Btn
            tone="reject"
            disabled={stopped}
            reason={why}
            onClick={() => onEdit(entry.id, { tag: "reject-proposal", id: entry.id })}
          >
            Bukan ini
          </Btn>
        </span>
      )}
    </li>
  );
}

/**
 * The name, typed in flow, seeded with what the AI transcribed.
 *
 * MONO, from `.lt-input` itself, for the reason `judul.tsx` gives at length: a
 * renamed judul is still a quotation, of a different order's paperwork, so the
 * title is in the document's voice before and after and the chrome around it
 * stays sans. The app never invents a name -- the field opens holding what is
 * there.
 */
function NamaUsulan({
  initial,
  disabled,
  onSubmit,
  onCancel,
}: {
  initial: string;
  disabled: boolean;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const blank = value.trim().length === 0;

  return (
    <form
      className="ms-auto flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!blank && !disabled) onSubmit(value);
      }}
    >
      <label className="lt-label" htmlFor={id}>
        Judul
      </label>
      <input
        id={id}
        className="lt-input w-full max-w-[28rem]"
        value={value}
        disabled={disabled}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Escape leaves without saving: the same promise "Batal" makes,
          // available to the hand already on the keyboard.
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <Btn
        type="submit"
        tone="primary"
        disabled={blank || disabled}
        reason={
          blank
            ? "Judul tanpa kata tercetak sebagai ruang kosong di DOKUMEN VALIDASI."
            : LOADING_HOLD
        }
      >
        Simpan nama
      </Btn>
      <Btn onClick={onCancel}>Batal</Btn>
    </form>
  );
}

/**
 * The berkas this order will not let the AI look inside, named.
 *
 * NO COLOUR. The operator made this choice deliberately and it is not owed
 * back: amber means a decision is owed here, and re-marking a settled decision
 * with the product's loudest signal is how the signal stops being read. It is
 * a `Note`, at the head of the block, in the operator's own terms.
 *
 * ABSENT MEANS DIBACA AI, read `=== false` for the reason `aiExcludedSources`
 * gives: every order stored before this choice existed must keep reading as
 * fully searched.
 */
function FencedBerkas({ run }: { run: BrowserRun }) {
  const fenced = run.sources.filter((source) => source.ai === false);
  if (fenced.length === 0) return null;

  return (
    <Note>
      <span className="lt-figure">{fenced.length}</span> berkas Anda tandai
      tanpa AI, jadi tidak ada usulan yang datang dari halamannya:{" "}
      {fenced.map((source) => shortenFileName(source.name, 34)).join(", ")}.
    </Note>
  );
}

/**
 * The kinds of blank, counted apart. `REASON_ORDER` says how many there are,
 * and no sentence on this component may say it a second time.
 *
 * SPLIT CLAUSE BY CLAUSE, which is the whole density argument in one component.
 * The COUNTS change with the order and decide what the operator does next,
 * so they stand. The SENTENCES that gloss them read the same words on
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

      {/* EVERY ONE OF THEM, ALWAYS, whichever are on screen: the panel is the
          fixed explanation of the vocabulary, not a report on this run. Which
          of them are actually happening is what the figures beside it say.

          THE LABEL DOES NOT COUNT THEM, and `REASON_HINT_LABEL` says why: it
          read "keempat" over five entries, because `emptied` was added to
          `REASON_ORDER` and the numeral stayed behind. */}
      <Hint label={REASON_HINT_LABEL}>
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
 * POTONGAN THAT CANNOT REACH THE BERKAS, and the one key that clears them.
 *
 * WHY THIS IS A STOP AND NOT AN ADVISORY. `blockingItems` refuses the export on
 * any of these that carries an area, for the reason it refuses a `lost`
 * capture: the exporter places a potongan BY KEY, so one filed under a key this
 * order's form does not declare reaches no cell at all. It is evidence a person
 * accepted, going missing from a packet that opens fine.
 *
 * WHY "Buang potongan ini" AND NOT "Kosongkan". Emptying leaves the area in
 * place and only changes the word, so the export stays blocked while the screen
 * reports the bagian settled -- the reassuring half of a contradiction, which is
 * the half that gets a packet signed. Dropping the state is the only thing that
 * actually clears it, so it is the only thing offered.
 *
 * IT DOES NOT ASK TWICE. The bulk write-off below is guarded by a confirmation
 * because it settles every remaining bagian at once and reads as one click; this
 * is one named row at a time, and the alternative to pressing it is an export
 * that cannot be produced. What it costs is stated on the row rather than in a
 * dialog: the area is named, its page is named, and the sentence above says
 * plainly that these cannot go into the berkas.
 */
function Strays({
  rows,
  run,
  busy,
  onDiscard,
}: {
  rows: Stray[];
  run: BrowserRun;
  busy: boolean;
  onDiscard: (slotIndex: number) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {/* THE EXPORT SCREEN'S OWN WORDS, deliberately. It already says
          "potongan tidak punya tempat di dokumen ini" and "Belum bisa
          diekspor" about exactly these rows, and an operator who meets the
          block there and the remedy here must meet one name for one thing. */}
      <Notice tone="stop">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="lt-figure">{rows.length}</span>
          <span>
            potongan tidak punya tempat di dokumen ini: bagiannya sudah tidak
            ada di order ini. Selama potongan ini masih tersimpan, order ini
            belum bisa diekspor.
          </span>
        </span>
      </Notice>

      <ul
        aria-label={OUTSIDE_TEMPLATE}
        className="border-line flex flex-col border-t"
      >
        {rows.map((row) => {
          const resolved = row.zone ? resolvePage(run, row.zone.pageIndex) : null;
          return (
            <li
              key={`${row.key}-${row.index}`}
              className="border-line flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-2"
            >
              {/* The state's OWN mark, not a reason shape: this row is not one
                  of the five kinds of blank, and lending it their vocabulary
                  would say a search had something to do with it. */}
              <Mark status={row.status} />
              <span className="lt-figure text-ink-3 text-[0.8125rem]">
                {OUTSIDE_TEMPLATE}
              </span>
              <span className="lt-figure font-bold">{row.label}</span>

              {resolved ? (
                <span className="flex items-center gap-2">
                  <span className="lt-label">area</span>
                  <span className="lt-kotak" title={resolved.sourceName}>
                    hal {resolved.pageInDoc + 1}/{resolved.pagesInDoc}
                  </span>
                </span>
              ) : row.zone ? (
                <span className="text-gap text-[0.8125rem]">
                  Halamannya sudah tidak ada di order ini.
                </span>
              ) : null}

              <span className="ms-auto">
                {/* NO GLYPH. `Kosongkan`'s icon is the double rule a clerk
                    leaves in a cell that stays blank, which is precisely what
                    this does NOT do: the bagian is not in the packet at all, so
                    nothing is left blank anywhere. And every row here carries
                    the same single control, so an icon on all of them
                    discriminates nothing -- the same rule `BlankRow` states
                    about its own pair. */}
                <Btn
                  tone="reject"
                  disabled={busy}
                  reason={LOADING_HOLD}
                  onClick={() => onDiscard(row.index)}
                >
                  Buang potongan ini
                </Btn>
              </span>
            </li>
          );
        })}
      </ul>

      {/* The machine keys, behind the one disclosure this product uses for
          deployer-facing text, exactly as the blanks list files its own. */}
      <TechnicalDetail>
        {rows.map((row) => row.key).join("\n")}
      </TechnicalDetail>
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
          Halamannya sudah tidak ada di order ini.
        </span>
      ) : null}

      {index === null ? (
        /* The reason this row carries no control, and it never hides. */
        <span className="text-gap text-[0.8125rem]">
          Belum ada di order ini. Mulai order lain supaya ikut
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
          <Btn
            disabled={busy}
            reason={LOADING_HOLD}
            onClick={() => onDraw(index)}
          >
            <Potongan />
            Gambar sendiri
          </Btn>
          <Btn
            disabled={busy}
            reason={LOADING_HOLD}
            onClick={() => onUnfill(index)}
          >
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
 * NO BAR IS NOT THE SAME AS NOTHING MOVING, which is the correction an
 * operator made: a block that sits perfectly still for several minutes is
 * indistinguishable from one that has hung, and somebody who is not watching
 * the word change never learns they are meant to wait. `.lt-spinner` claims no
 * progress and no proportion; it says only that this is running, which is the
 * one thing this screen genuinely knows.
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
      <p
        aria-live="polite"
        className="flex flex-1 flex-wrap items-center gap-2 text-sm"
      >
        {searching ? (
          <>
            {/* THE WAIT HAS TO MOVE. A round is a single POST over the whole
                order and it runs for minutes, and this line stood perfectly
                still for all of them: an operator who was not watching the
                word change could not tell it from a screen that had hung.
                `aria-hidden`, because the sentence beside it says the same
                thing to a screen reader and this region is already live. */}
            <span className="lt-spinner" aria-hidden="true" />
            <span>
              Mencari <span className="lt-figure">{searchable}</span> bagian.
            </span>
          </>
        ) : pages === 0 ? (
          /* EVERY BERKAS IS FENCED, so there is nothing to read and the two
             sentences below would both be false: "bisa dicari di 0 halaman"
             contradicts itself, and "halaman baru belum dicari" points at
             halaman no round will ever be given. What is true is why, and the
             operator can act on it -- the switch back to Dibaca AI is on the
             documents bar. */
          <span>
            Tidak ada halaman yang bisa dibaca AI: semua berkas Anda tandai
            tanpa AI.
          </span>
        ) : afterDocument ? (
          <span>
            Halaman baru belum dicari:{" "}
            <span className="lt-figure">{searchable}</span> bagian menunggu.
          </span>
        ) : (
          <span>
            <span className="lt-figure">{searchable}</span> bagian bisa dicari di{" "}
            <span className="lt-figure">{pages}</span> halaman.
          </span>
        )}
      </p>

      {/* WHICH SENTENCE STAYS AND WHICH GOES, clause by clause. The counts are
          about THIS run and stand. What is left behind the mark answers the
          one hesitation this control meets ("does running it again undo what I
          already accepted?"), which decides whether the operator presses it.
          The clause about leaving the tab open went with the rest of the
          mechanism copy: it described how the app works, not what pressing
          this does. */}
      <Hint label="Yang terjadi kalau dibaca lagi">
        Bukti yang sudah Anda terima tidak ikut dicari ulang, jadi membacanya
        lagi tidak mengulang order yang sudah selesai.
      </Hint>

      {onSearch ? (
        <Btn
          tone={afterDocument ? "primary" : "default"}
          /* NOTHING TO READ IS ALSO A REASON THIS KEY IS DOWN, and it is not
             cosmetic. A round over an order whose every page carries
             `searchable: false` answers each wanted key in `outstanding`, and
             `applyProposals` writes that word onto the bagian -- so the press
             would stamp `tidak ditemukan`, fixed in `docs/ui-bahasa.md` to mean
             SEARCHED AND NOT FOUND, across bagian nothing read a baris of. */
          disabled={searching || busy || pages === 0}
          /* THE FIFTH CONTROL THE LOAD HOLDS, and the one that was left
             without its reason when the standing notice above went. Only for
             the load: while the round itself is running, the spinner and the
             sentence to the left say so on screen at full ink, and a hover
             repeating that would be the restatement this pass removes. */
          /* THE LOAD OUTRANKS THE FENCE while both hold, because it is the one
             that is about to change: a berkas arriving mid-load is Dibaca AI by
             default, so "wait for the load" is the truthful thing to say to an
             operator who is loading the document that will lift this. */
          reason={
            busy && !searching
              ? LOADING_HOLD
              : pages === 0
                ? SEARCH_ALL_FENCED_REASON
                : undefined
          }
          aria-busy={searching || undefined}
          onClick={onSearch}
        >
          {/* THE SAME NAME THE MUAT SCREEN'S KEY WEARS, because it is the same
              action: an AI reads the pages and marks where each bagian is.
              This said "Proses lagi" against a Muat screen that says "Baca
              dengan AI", so one action wore two names across the flow, and one
              of them was the word the operator killed for meaning nothing.
              The "lagi" went with it rather than moving into the label: the
              line beside this key already says whether new halaman are waiting
              or nothing has been read yet, and a second name for a re-run is
              how two names start again. The magnifier is shared with that key
              on purpose; ingest-panel says it must be on both or on neither. */}
          <Cari />
          {searching ? "Sedang membaca..." : "Baca dengan AI"}
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
 * The answer is remembered for the session only, and NOTHING HERE CLAIMS
 * OTHERWISE, which is what that has always needed. It used to be said in a
 * question mark ("this answer only lasts while the tab is open and is not
 * saved to the order"), and that panel was two thirds a restatement of the
 * question above it and one third a description of where the app keeps a
 * variable. What matters is that no wording on this block presents the answer
 * as a record: "Tidak, hanya ini" is a pressed toggle that reveals a control,
 * and it never reports itself as saved.
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
            document clipped to the same order. */}
        <Btn
          disabled={busy}
          reason={LOADING_HOLD}
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
              reason={
                busy
                  ? LOADING_HOLD
                  : "Tidak ada bagian yang bisa dikosongkan sekaligus."
              }
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

        {/* Two question marks in one confirmation box is one too many, and the
            one that went explained how to undo this afterwards. Every bagian
            written off here is a plate in the sheet below carrying its own
            "Buka lagi", so the route back is on the screen rather than in a
            panel; what stays behind a mark is the difference between writing
            off a bagian that was searched and one that never was, which is the
            thing that should change the answer to this question. */}
        <div className="flex flex-wrap items-center gap-4">
          <Btn
            tone="reject"
            disabled={busy}
            reason={LOADING_HOLD}
            onClick={onConfirm}
          >
            Ya, kosongkan {rows.length} bagian
          </Btn>
          <Btn onClick={onCancel}>Batal</Btn>
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
 * and still writing to their order. Outside presses, Escape and the close
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
  queue,
  screening,
  refusals,
  reused,
  onCancelQueued,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  busy: boolean;
  progress: IngestProgress | null;
  errorNotice: React.ReactNode;
  onFiles: (files: File[]) => void;
  queue: readonly QueuedDocument[];
  screening: boolean;
  refusals: readonly RefusedDocument[];
  reused: readonly UsedElsewhere[];
  onCancelQueued?: (id: string) => void;
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
          {/* One line, and the mark that used to follow it is gone: it said
              that accepted evidence is kept and adding a document does not
              redo finished work, which is the same sentence the search line on
              the block behind this dialog already carries. One fact, one
              place. */}
          <DialogDescription>
            Hanya bagian yang belum ada buktinya yang dicari lagi.
          </DialogDescription>
        </DialogHeader>

        {/* THE TARGET STAYS OPEN WHILE A DOCUMENT IS BEING READ, and it used
            to be replaced by the progress. An operator who has just been shown
            a list of bagian nobody could find is precisely the operator who
            walks off and comes back with two documents, one after the other,
            and under the old shape the second one was refused for as long as
            the first took to read. It joins the antrean and is read in turn.
            See `ingest-panel.tsx`'s own note for the invariant that keeps. */}
        {busy ? <Reading progress={progress} /> : null}

        <Antrean
          queue={queue}
          stopped={!busy}
          onCancel={onCancelQueued ?? (() => {})}
        />

        <Refusals refusals={refusals} />

        <Reused reused={reused} />

        <DocumentDrop
          label={busy ? "Tambahkan berkas lagi" : "Dokumen tambahan"}
          hint={
            busy
              ? "Berkas ini masuk antrean dan dimuat setelah yang sedang berjalan selesai."
              : "Sesudah dimuat, AI masih harus membacanya."
          }
          size="inline"
          tone={busy ? "default" : "primary"}
          onFiles={onFiles}
        />

        <div role="status" aria-live="polite">
          {screening ? (
            <p className="text-ink flex items-center gap-3 text-[0.9375rem]">
              <span className="lt-spinner" aria-hidden="true" />
              <span>Memeriksa berkas yang Anda berikan.</span>
            </p>
          ) : null}
        </div>

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
 * is on its way in, and how much of it has landed.
 *
 * AND IT DOES NOT SAY IT IS COUNTING PAGES. The first version of that cut kept
 * the verb and said "Menghitung halaman", which was the half the client's
 * objection was actually about: counting sounds like something that takes an
 * instant, it takes a while on a scanned bundle, and an app that claims to be
 * doing a trivial thing slowly reads as a slow app.
 *
 * IT SAYS MEMUAT, NOT MEMBACA, for the reason ingest-panel's own `Reading`
 * gives: move one is MUAT, the pages coming in, and move two is the AI reading
 * them. This block is inches from a key labelled "Baca dengan AI", so it was
 * the one place in the product where both moves were on screen at once wearing
 * one verb between them.
 *
 * THE SPINNER IS ONLY HERE, AND ONLY WHILE THE TOTAL IS UNKNOWN, which is the
 * same rule and the same reason as upstream: once "3/29 halaman tersimpan"
 * starts ticking, the figure is the motion, and two drawings of one fact is
 * one too many. Before it, this dialog held the operator in front of a block
 * that did not move for minutes.
 */
function Reading({ progress }: { progress: IngestProgress | null }) {
  const named = Boolean(progress?.name);
  const counting = !progress || progress.total <= 0;

  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        Memuat
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
          <>
            <span className="lt-spinner" aria-hidden="true" />
            <span>Dokumen sedang dimuat.</span>
          </>
        ) : (
          <>
            <span className="lt-kotak">
              {progress?.done}/{progress?.total}
            </span>
            halaman tersimpan.
          </>
        )}
      </p>

      {/* THE WHOLE OF WHAT THE OPERATOR NEEDS, IN ONE LINE. The reason the
          close control is missing never hides, and the half of the old
          question mark that was worth keeping is the half that tells them to
          do nothing: the box lets go by itself. What went with the mark was
          the sentence about pages being written to storage one at a time,
          which is our machinery and not their business. */}
      <Note>
        Tidak bisa ditutup sampai pemuatan selesai, lalu menutup sendiri.
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
 * out of scope here, so the mark beside it says plainly what this list is
 * rather than letting it pass as an audit trail.
 */
function SessionHistory({ rounds }: { rounds: RoundLog[] }) {
  if (rounds.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="lt-label">Dimuat di sesi ini</span>
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
