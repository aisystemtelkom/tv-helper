/**
 * Joining what the runtime knows (slot states) to what the template declares
 * (sections, labels, how many captures a slot holds).
 *
 * The runtime's `SlotState` carries a key, a label and a status. The template
 * is where a slot's SECTION and its capture count live, and the capture count
 * is load-bearing: the sample's `KB (lanjutan)` ToP row stacks two pictures in
 * one cell, so a slot holding one of them is half done, not done. A contact
 * sheet that showed it as filled would be the wrong-and-quiet failure in its
 * purest form -- a complete-looking sheet over a deliverable missing evidence.
 *
 * Pure, so `src/lib/ui/ui.test.mts` can drive it.
 */

import type { SectionDef, SlotDef, Template } from "../forms/template.ts";
import type { BrowserRun, SlotState, SlotStatus } from "./runtime.ts";

/** Every slot the template declares, with the section it belongs to. */
export function templateSlots(
  template: Template,
): { section: SectionDef; slot: SlotDef }[] {
  return template.sections.flatMap((section) =>
    section.slots.map((slot) => ({ section, slot })),
  );
}

/** Absent means one. See the `crops` doc comment on `SlotDef`. */
export function requiredCrops(slot: SlotDef): number {
  return slot.crops ?? 1;
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
  required: number;
  /** How many captures actually hold a zone. */
  found: number;
  status: SlotAggregateStatus;
};

export function aggregateStatus(
  states: PlacedSlot[],
  found: number,
  required: number,
): SlotAggregateStatus {
  const statuses = states.map((s) => s.state.status);
  if (statuses.includes("proposed")) return "proposed";
  if (
    found >= required &&
    states
      .filter((s) => s.state.zone)
      .every((s) => s.state.status === "confirmed")
  ) {
    return "confirmed";
  }
  if (statuses.includes("unfilled")) return "unfilled";
  if (statuses.includes("outstanding")) return "outstanding";
  if (found > 0) return "partial";
  return "pending";
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
  const byKey = new Map<string, PlacedSlot[]>();
  run.slots.forEach((state, index) => {
    const existing = byKey.get(state.key);
    if (existing) existing.push({ state, index });
    else byKey.set(state.key, [{ state, index }]);
  });

  return template.sections.map((section) => ({
    title: section.title,
    layout: section.layout,
    entries: section.slots.map((slot) => {
      const states = byKey.get(slot.key) ?? [];
      const required = requiredCrops(slot);
      const found = states.filter((s) => s.state.zone).length;
      return {
        def: slot,
        section,
        states,
        required,
        found,
        status: aggregateStatus(states, found, required),
      };
    }),
  }));
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
  return run.slots.filter((state) => !known.has(state.key));
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
  for (const section of sheetSections(run, template)) {
    for (const entry of section.entries) {
      if (!entry.def.fillable) continue;
      fillable += 1;
      counts[entry.status] += 1;
    }
  }

  return {
    fillable,
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
    const found = index.get(state.key);
    return {
      state,
      def: found?.slot,
      sectionTitle: found?.section.title ?? "Not in this template",
      label: state.label || found?.slot.label || state.key,
    };
  });
}
