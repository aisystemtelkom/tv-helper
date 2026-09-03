/**
 * Joining what the runtime knows (slot states) to what the template declares
 * (sections and labels).
 *
 * THE TEMPLATE NO LONGER KNOWS HOW MANY PICTURES A SLOT HOLDS, and this module
 * is where that shows up hardest. It used to read `SlotDef.crops`, which said
 * the `KB (lanjutan)` ToP row holds two -- and an operator testing the tool
 * reported the result: a sheet showing "ToP 1" and "ToP 2", the second
 * permanently missing, on a document that holds one ToP. The count was never a
 * property of the form. A lanjutan is now DISCOVERED per document, so the only
 * honest source for "how many captures does this bagian have" is `run.slots`
 * itself.
 *
 * What replaces the count as a completeness check is `continuationChecked` on
 * each capture: whether anything has looked past its page bottom yet. Without
 * it this change would only trade a visible wrong ("1 of 2" for ever) for an
 * invisible one (a truncated clause that reads as finished).
 *
 * Pure, so `src/lib/ui/ui.test.mts` can drive it.
 */

import type { SectionDef, SlotDef, Template } from "../forms/template.ts";
import { captureOrdinalOf, slotKeyOf } from "./runtime.ts";
import type { BrowserRun, SlotState, SlotStatus } from "./runtime.ts";
import { continuationChecked } from "../browser/captures.ts";

/** Every slot the template declares, with the section it belongs to. */
export function templateSlots(
  template: Template,
): { section: SectionDef; slot: SlotDef }[] {
  return template.sections.flatMap((section) =>
    section.slots.map((slot) => ({ section, slot })),
  );
}

/**
 * What to CALL one capture of a slot that needs more than one.
 *
 * THE SECOND CAPTURE IS NOT A SECOND FIELD. A slot needs two pictures when one
 * field's evidence runs past the bottom of a page and continues on the next
 * one, so the two captures are the same field either side of a page break.
 * Verified against the sample: the ToP slot's first picture is `Pasal 6
 * PEMBAYARAN PEKERJAAN` items 1 to 3, and its second is items 4 and 5 of that
 * same Pasal, carrying the next page's header. One clause, one payment term,
 * two pages.
 *
 * "ToP 1" and "ToP 2" therefore told an operator something false -- that the
 * document holds two Terms of Payment and only one was found -- and an
 * operator who reads it that way goes looking for a second clause that does
 * not exist. `lanjutan` is the word the template already uses for exactly this
 * relationship in its section names ("KB (lanjutan)"), so it is the word the
 * captures use too.
 *
 * Numbered from the SECOND capture, because the first is not a continuation of
 * anything: a three-capture slot reads label, "(lanjutan)", "(lanjutan 2)".
 *
 * A PURE FUNCTION OF THE ORDINAL, AND THAT IS THE WHOLE POINT OF THE
 * SIGNATURE. It used to take the slot's capture count as well and read
 * "(lanjutan)" at two captures but "(lanjutan 1)" at three, which was fine
 * while the count came from `SlotDef.crops` and could not move. It is read off
 * the run now and GROWS: discovering a third capture renamed a picture the
 * operator had already accepted from "ToP (lanjutan)" to "ToP (lanjutan 1)",
 * the same instability `PlannedCapture.ordinal`, `nextCaptureOrdinal` and
 * `SlotAggregate.maxOrdinal` each carry a comment about avoiding. The label of
 * an accepted potongan may not change because an unrelated later one was
 * found, so the count is gone from the decision.
 */
export function captureLabel(label: string, ordinal: number): string {
  if (ordinal <= 1) return label;
  return ordinal === 2 ? `${label} (lanjutan)` : `${label} (lanjutan ${ordinal - 1})`;
}

/**
 * `partial` is this module's own aggregate, not a runtime status: it is what a
 * two-capture slot looks like when one capture is confirmed and the other is
 * still missing. The runtime has no single status for that because its states
 * are per capture.
 */
export type SlotAggregateStatus = SlotStatus | "partial";

/**
 * A slot state together with WHERE IT SITS in `run.slots`.
 *
 * The position is carried rather than recovered later with `indexOf`. Every
 * action the operator takes names a slot by position, and `indexOf` finds the
 * first structurally-equal reference: a runtime that stored the two captures
 * of a two-capture slot as one shared object would silently route both
 * captures' buttons to the first one. The contract promises key, label and
 * status -- it does not promise that two entries are two objects.
 */
export type PlacedSlot = { state: SlotState; index: number };

export type SlotAggregate = {
  def: SlotDef;
  section: SectionDef;
  /** Every runtime state carrying this key, in the order the runtime gave. */
  states: PlacedSlot[];
  /**
   * The highest capture ordinal this slot holds, which is what `captureLabel`
   * needs as its `total`.
   *
   * NOT `states.length`, and the difference is only visible after a removal:
   * captures 1 and 3 are two states, and calling the second of them "capture 2
   * of 2" would rename a picture the operator already accepted. Ordinals are
   * never re-used, so the count and the highest number legitimately disagree.
   */
  maxOrdinal: number;
  /** How many captures actually hold a zone. */
  found: number;
  /**
   * Captures holding evidence that nothing has yet looked PAST -- no lanjutan
   * search has run on them.
   *
   * The honest half of dropping the declared count. A bagian whose one capture
   * has never been checked is not known to be complete; it is only known not to
   * be obviously incomplete. Surfaced on screen, deliberately NOT blocking:
   * see the note on `hasUnreviewedProposals`.
   */
  unchecked: number;
  status: SlotAggregateStatus;
};

/** The capture number this state is, read off its key. */
export function ordinalOf(placed: PlacedSlot): number {
  return captureOrdinalOf(placed.state.key);
}

/** The highest ordinal among a slot's captures; 1 when it holds none. */
export function maxOrdinalOf(states: readonly PlacedSlot[]): number {
  return states.reduce((high, placed) => Math.max(high, ordinalOf(placed)), 1);
}

/**
 * One word for a slot that may hold several captures.
 *
 * THE WORD ANSWERS EXACTLY ONE QUESTION: is anything still owed on this slot?
 * That is the only thing the operator is scanning the sheet for, and it is
 * what the export screen's affirmative and `progressOf`'s `decided` are built
 * on. Every branch below is in service of it.
 *
 * A capture is SETTLED when the operator has finished with it: `confirmed`
 * (they accepted the evidence) or `unfilled` (they decided it ships empty, on
 * the record). Everything else still owes something. `outstanding` is
 * deliberately unsettled even though a search has run over it, because
 * "searched, not found" is the START of the tambahan loop and the operator
 * still has to draw it by hand or ship it empty. A capture the template asks
 * for that the run holds no state for at all is unsettled by omission.
 *
 * IF YOU ARE HERE TO CHANGE THIS, YOU HAVE PROBABLY ARRIVED WITH A RANKING IN
 * MIND. That is the frame the bug lived in and it is the thing to put down
 * first. The old rule was an ordered list of "which status wins", and every
 * fix available inside that frame is just a different ordering, which means
 * every one of them has a new pair it gets wrong. Two orderings were tried and
 * both broke, in opposite directions, before anyone noticed the frame was the
 * problem. This function does not rank statuses. It asks one question about
 * the whole slot and answers it.
 *
 * THE ORDERING THAT SHIPPED ASSERTED INTENT OVER EVIDENCE, TWICE. `unfilled`
 * was tested before `partial`, so a two-capture slot with one confirmed crop
 * and one deliberately-empty capture reported "sengaja dikosongkan" while the
 * crop that WILL be exported sat visible underneath the label. `outstanding`
 * was tested before `partial` too, so the same slot with its second capture
 * merely not found reported "tidak ditemukan": nothing was found, said the
 * label, over a picture. That second branch is the stronger contradiction and
 * it went unnoticed longer, because a search for "the bug" naturally stops at
 * the first ordering it finds.
 *
 * THE OBVIOUS FIX IS ALSO WRONG, and it was proposed and rejected. Making
 * `partial` win whenever any capture is confirmed cures the first lie by
 * installing a second one: that slot is FULLY SETTLED, the operator has
 * nothing left to do on it, and calling it "sebagian" means the sheet can
 * never go quiet. The first lie is at least visible (a crop sits there
 * contradicting the label); the second is invisible, and a packet that can
 * never reach a quiet state teaches people to ignore the colour entirely,
 * which costs more than the bug it fixes. It would also drop a finished slot
 * out of `progressOf`'s `decided`, making the export screen's "Siap diekspor"
 * lie in the other direction.
 *
 * So: `partial` only while something is genuinely still open. Once everything
 * is settled the slot is `confirmed` if any capture carries evidence and
 * `unfilled` only if none does. Assert this together with `decided`: the bug
 * is only ever visible when the two disagree.
 *
 * A DISCOVERED LANJUTAN IS A NEW THING THAT IS OWED, and it re-opens a slot
 * that had gone quiet. It arrives as an APPENDED capture in `proposed`, so the
 * first branch below carries it with no special case: a bagian whose one crop
 * the operator accepted goes from "diterima" back to "perlu diputuskan" the
 * moment a continuation is found for it, drops out of `progressOf`'s `decided`,
 * and blocks the export until they rule on it. That is the point -- the
 * alternative is a second picture appearing in the packet that nobody looked
 * at.
 *
 * THE ARGUMENTS `found` AND `required` ARE GONE. `found` was never read, and
 * `required` came from `SlotDef.crops`, which is dead: nothing declares how
 * many captures a slot holds, so the states ARE the captures. The one case
 * that argument used to carry is now explicit below -- a slot the run holds no
 * state for at all is `pending`, not `unfilled`.
 */
export function aggregateStatus(states: PlacedSlot[]): SlotAggregateStatus {
  // The template declares it and the run has never seen it: a run made before
  // the template grew. Nobody has looked, so it owes a search -- reading it as
  // `unfilled` would let it ship as a considered blank.
  if (states.length === 0) return "pending";

  const statuses = states.map((s) => s.state.status);

  // A proposal outranks everything: it is the one state where a person is
  // being waited on rather than merely having work left.
  if (statuses.includes("proposed")) return "proposed";

  const confirmed = states.filter(
    (s) => s.state.status === "confirmed" && s.state.zone,
  ).length;
  const open = statuses.filter(
    (s) => s === "pending" || s === "outstanding" || s === "proposed",
  ).length;

  if (open > 0) {
    if (confirmed > 0) return "partial";
    if (statuses.includes("outstanding")) return "outstanding";
    return "pending";
  }

  return confirmed > 0 ? "confirmed" : "unfilled";
}

export type SheetSection = {
  title: string;
  layout: SectionDef["layout"];
  entries: SlotAggregate[];
};

/**
 * The contact sheet, in template order.
 *
 * Slots the template declares but the run has never seen appear as `pending`
 * rather than being dropped, because the sheet's job is to account for every
 * slot in the deliverable, including the ones nothing has looked at yet.
 */
export function sheetSections(
  run: BrowserRun,
  template: Template,
): SheetSection[] {
  // Grouped by TEMPLATE key, not by the state's own key. A two-capture slot
  // reaches this function as `kbLanjutan.top#1` and `kbLanjutan.top#2`, and
  // grouping on those raw strings matched no template slot at all: the ToP row
  // rendered `pending` forever, both captures fell out into
  // `unmatchedStates`, and -- worst of the three -- `hasUnreviewedProposals`
  // returned false while a proposal sat unreviewed on `#2`, so the export gate
  // opened on an unreviewed zone. Measured against the real `seedSlots`, not
  // theorised.
  const byKey = new Map<string, PlacedSlot[]>();
  run.slots.forEach((state, index) => {
    const key = slotKeyOf(state.key);
    const existing = byKey.get(key);
    if (existing) existing.push({ state, index });
    else byKey.set(key, [{ state, index }]);
  });

  return template.sections.map((section) => ({
    title: section.title,
    layout: section.layout,
    entries: section.slots.map((slot) => {
      const states = byKey.get(slot.key) ?? [];
      const found = states.filter((s) => s.state.zone).length;
      return {
        def: slot,
        section,
        states,
        maxOrdinal: maxOrdinalOf(states),
        found,
        unchecked: states.filter(
          (s) => s.state.zone && !continuationChecked(s.state),
        ).length,
        status: aggregateStatus(states),
      };
    }),
  }));
}

/**
 * The run positions of every proposal waiting in one section: what the
 * section's "Accept all" acts on, and what its count must report.
 *
 * TAKEN FROM THE AGGREGATE, never re-derived from the state keys. The contact
 * sheet used to compute this as "states whose `key` is one of this section's
 * `SlotDef.key`s", and a two-capture slot's states are keyed
 * `kbLanjutan.top#1` / `#2`, which equal no `SlotDef.key` at all. So the ToP
 * row's proposals were invisible to it: the button offered to "Accept all 2"
 * in a section holding three proposals and left the third untouched, while
 * the section's own nav badge -- which reads the aggregate -- said 3. An
 * operator who clicked it had every reason to believe the section was done.
 *
 * That is the same mistake `sheetSections` documents at length just above,
 * made a second time twenty lines away. `states` already holds the grouping,
 * so there is nothing here to get wrong.
 */
export function proposedIndexesIn(section: SheetSection): number[] {
  return section.entries.flatMap((entry) =>
    entry.states
      .filter((placed) => placed.state.status === "proposed")
      .map((placed) => placed.index),
  );
}

/**
 * Slot states the run holds under a key the template does not declare.
 *
 * Not a theoretical case: the tool is document-agnostic and a template can be
 * edited between runs, so a stored run can outlive the slot list that made it.
 * Showing them at the end of the sheet is the honest answer -- silently
 * dropping them would hide evidence the operator already confirmed.
 */
export function unmatchedStates(
  run: BrowserRun,
  template: Template,
): SlotState[] {
  const known = new Set(templateSlots(template).map(({ slot }) => slot.key));
  // `slotKeyOf` first: a capture of a slot the template DOES declare is not an
  // unmatched state. Without it every multi-capture slot in the run was
  // reported as belonging to no template.
  return run.slots.filter((state) => !known.has(slotKeyOf(state.key)));
}

export type Progress = {
  /** Slots the template expects a PDF to back. */
  fillable: number;
  confirmed: number;
  proposed: number;
  partial: number;
  outstanding: number;
  unfilled: number;
  pending: number;
  /** Slots the operator has settled one way or the other. */
  decided: number;
  /**
   * Slots holding evidence that no lanjutan search has run over.
   *
   * Reported, not enforced. See `hasUnreviewedProposals` for why an unchecked
   * capture is shown rather than blocked.
   */
  uncheckedForContinuation: number;
};

/**
 * Counts over FILLABLE slots only. The six EPIC and spreadsheet slots are
 * deliberately empty cells the operator pastes into by hand, and counting
 * them as outstanding would report a complete run as permanently unfinished.
 */
export function progressOf(run: BrowserRun, template: Template): Progress {
  const counts: Record<SlotAggregateStatus, number> = {
    pending: 0,
    proposed: 0,
    confirmed: 0,
    outstanding: 0,
    unfilled: 0,
    partial: 0,
  };

  let fillable = 0;
  let uncheckedForContinuation = 0;
  for (const section of sheetSections(run, template)) {
    for (const entry of section.entries) {
      if (!entry.def.fillable) continue;
      fillable += 1;
      counts[entry.status] += 1;
      if (entry.unchecked > 0) uncheckedForContinuation += 1;
    }
  }

  return {
    fillable,
    uncheckedForContinuation,
    confirmed: counts.confirmed,
    proposed: counts.proposed,
    partial: counts.partial,
    outstanding: counts.outstanding,
    unfilled: counts.unfilled,
    pending: counts.pending,
    decided: counts.confirmed + counts.unfilled,
  };
}

/**
 * True when nothing is waiting on the operator.
 *
 * `outstanding` and `partial` do NOT block export: the tambahan loop's whole
 * point is that the operator may answer "no more documents" and ship those
 * slots empty on the record. A proposal nobody has looked at is different --
 * exporting it would put an unreviewed zone in the deliverable, which the
 * design forbids outright.
 *
 * NEITHER DOES AN UNCHECKED CAPTURE, and the line is worth stating because it
 * is close to one that would be wrong. A capture nobody has looked past is a
 * gap in what we KNOW, not evidence nobody ruled on: the crop in the packet is
 * one the operator personally accepted. Blocking on it would stop an export
 * every time an operator drew a zone by hand without re-running Proses, which
 * teaches people that the block means nothing. So it is counted
 * (`Progress.uncheckedForContinuation`) and said out loud on the sheet and on
 * the export screen, and the operator decides whether to press Proses again.
 */
export function hasUnreviewedProposals(
  run: BrowserRun,
  template: Template,
): boolean {
  return progressOf(run, template).proposed > 0;
}

/**
 * Where the runtime's outstanding list sits in `run.slots`.
 *
 * `outstandingSlots(run)` returns `SlotState[]`, and the contract does not say
 * whether those are the run's own objects or copies of them. Matching purely
 * by reference would work against one implementation and, against another,
 * quietly return nothing at all -- the header would say three slots are
 * missing and the tambahan loop would show an empty list, which is the worst
 * possible way to lose a decision the operator has to make on the record.
 *
 * So: identity first, since it is exact, and a key-and-shape match as a
 * fallback, preferring the entries that carry no zone because those are the
 * ones an outstanding report is about.
 */
export function outstandingIndexes(
  run: BrowserRun,
  reported: SlotState[],
): number[] {
  const byIdentity = new Set<SlotState>(reported);
  const exact = run.slots.flatMap((slot, index) =>
    byIdentity.has(slot) ? [index] : [],
  );
  if (exact.length === reported.length) return exact;

  const wanted = new Map<string, number>();
  for (const state of reported) {
    wanted.set(state.key, (wanted.get(state.key) ?? 0) + 1);
  }

  const placed = run.slots.map((state, index) => ({ state, index }));
  const picked: number[] = [];
  for (const [key, count] of wanted) {
    const candidates = placed.filter((p) => p.state.key === key);
    const ordered = [
      ...candidates.filter((p) => !p.state.zone),
      ...candidates.filter((p) => p.state.zone),
    ];
    for (const candidate of ordered.slice(0, count)) picked.push(candidate.index);
  }
  return picked.sort((a, b) => a - b);
}

export type OutstandingEntry = {
  state: SlotState;
  def?: SlotDef;
  sectionTitle: string;
  label: string;
};

/**
 * The runtime's outstanding list, given the labels and sections that make it
 * readable. Keeps the runtime's own ordering; it is the authority on what is
 * outstanding, this only decorates it.
 */
export function describeOutstanding(
  states: SlotState[],
  template: Template,
): OutstandingEntry[] {
  const index = new Map(
    templateSlots(template).map(({ section, slot }) => [
      slot.key,
      { section, slot },
    ]),
  );

  return states.map((state) => {
    // The template key, so a capture keyed `<slot>#2` is named by its own
    // section rather than reported as "Not in this template".
    const found = index.get(slotKeyOf(state.key));
    return {
      state,
      def: found?.slot,
      // Operator-visible, so Bahasa Indonesia like every other string that
      // reaches a screen. It names the case where a run holds a capture under
      // a key the template no longer declares: the exporter will not place it,
      // and it is listed rather than dropped so that nothing an operator
      // confirmed disappears without being mentioned.
      sectionTitle: found?.section.title ?? "Tidak ada di template ini",
      label: state.label || found?.slot.label || state.key,
    };
  });
}
