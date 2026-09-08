/**
 * WHAT THE JUDUL CONTROLS NEED TO KNOW, computed away from the JSX.
 *
 * A judul is one heading of the DOKUMEN VALIDASI together with the bagian
 * under it, and the review sheet is where an operator decides that a judul is
 * not part of THIS order. The controls that act on that judgement sit on the
 * sheet; the arithmetic behind them is here, for the reason `slots.ts` and
 * `export.ts` are: `node --test` cannot render React, and every question this
 * file answers is one a wrong answer to would be invisible.
 *
 * THE REMOVAL COST IS COMPUTED BY PERFORMING THE REMOVAL, and that is the
 * whole design of `sectionRemovalCost`. It mirrors `sourceRemovalCost` in
 * `../browser/sources.ts` exactly: run the real edit, throw the run away, keep
 * the numbers. A confirmation that counts potongan with arithmetic of its own
 * is a second answer to "what is about to be lost", and the two agree on every
 * ordinary judul right up until the day they do not -- at which point the
 * dialog under-reports a loss that cannot be undone. Deriving it from
 * `applySectionEdit` makes disagreement structurally impossible.
 *
 * NOTHING HERE IS STORED. The hidden list, the packet position and the
 * provenance line are all derived from the base form plus this order's
 * overlay on every render. A stored copy of any of them is a second spelling
 * of a fact the overlay already carries, and the two can disagree.
 */

import { applySectionEdit } from "../browser/sections.ts";
import type { NodeId, SectionPatch } from "../forms/overlay.ts";
import { AO_TEMPLATE, type SectionDef, type Template } from "../forms/template.ts";
import type { BrowserRun } from "./runtime.ts";

/** What removing one judul would take with it. */
export type HeadingCost = {
  /**
   * Potongan CARRYING EVIDENCE that the removal drops.
   *
   * Exactly `putRun`'s own test, because it is `putRun`'s own list: a capture
   * nobody found evidence for costs nothing to re-seed, so it is not counted
   * and the operator is not asked about it.
   */
  captures: number;
  /** How many of those the operator had already accepted. */
  confirmed: number;
  /** True for a judul this order added; false for one the form declares. */
  added: boolean;
  /** Who put an added judul there. Null for a judul the form declares. */
  origin: "human" | "llm" | null;
};

/**
 * What "Hapus judul" would cost, without spending it.
 *
 * A JUDUL THE FORM DOES NOT DECLARE AND THIS ORDER HAS NOT ADDED COSTS
 * NOTHING, rather than throwing. This is asked while deciding how loudly to
 * ask, and a heading that names nothing produces a question nobody is ever
 * shown; raising here would take down the sheet instead. `applySectionEdit`
 * still refuses the removal itself, which is where the loudness belongs.
 */
export function sectionRemovalCost(
  run: BrowserRun,
  sectionId: NodeId,
  base: Template = AO_TEMPLATE,
): HeadingCost {
  const added = run.overlay.added.find((section) => section.id === sectionId);
  const declared = base.sections.some((section) => section.id === sectionId);
  if (!added && !declared) {
    return { captures: 0, confirmed: 0, added: false, origin: null };
  }

  // THE REAL EDIT. `removing` is the list `putRun` would be handed, so what is
  // counted here and what is dropped there are one computation.
  const { removing } = applySectionEdit(
    run,
    { tag: "remove-section", id: sectionId },
    undefined,
    base,
  );

  const dropped = new Set(removing);
  let confirmed = 0;
  for (const slot of run.slots) {
    if (dropped.has(slot.key) && slot.status === "confirmed") confirmed += 1;
  }

  return {
    captures: removing.length,
    confirmed,
    added: added !== undefined,
    origin: added?.origin ?? null,
  };
}

/** One judul the form declares that this order is not printing. */
export type HiddenSection = { id: NodeId; title: string };

/**
 * The judul this order has taken out of the packet.
 *
 * DERIVED, NEVER STORED: the base's sections minus the ones the resolved form
 * still carries. A list kept alongside the overlay would be a second spelling
 * of `sections[id].removed`, and the two would agree until a migration or a
 * second tab made them disagree, at which point a judul would be missing from
 * the packet with no row anywhere offering it back.
 *
 * IT REPORTS THE OPERATOR'S OWN NAME, not the form's. `restoreSection` keeps a
 * title patch through a removal on purpose, so a judul they renamed comes back
 * under their word; naming it here with the base's title would promise them
 * something else.
 *
 * An ADDED judul never appears: it is dropped outright rather than tombstoned,
 * so there is nothing to bring back and the row would be a button that throws.
 */
export function hiddenSections(
  run: BrowserRun,
  template: Template,
  base: Template = AO_TEMPLATE,
): HiddenSection[] {
  const present = new Set(template.sections.map((section) => section.id));
  // A Map rather than the record, for the reason `resolveTemplate` gives: an
  // id that happens to name something on Object.prototype reads back as a
  // value that is not a patch and answers `undefined` to `.title` instead of
  // throwing.
  const patches = new Map<NodeId, SectionPatch>(
    Object.entries(run.overlay.sections),
  );

  const out: HiddenSection[] = [];
  for (const section of base.sections) {
    if (present.has(section.id)) continue;
    out.push({
      id: section.id,
      title: patches.get(section.id)?.title ?? section.title,
    });
  }
  return out;
}

/**
 * WHERE THIS JUDUL SITS IN THE PACKET, which is not where it sits on the sheet.
 *
 * The review sheet groups the judul that ask for work above the ones that ship
 * blank, so its own order is not the order of the deliverable. "Naikkan" moves
 * a judul past the next VISIBLE one in the PACKET, and that neighbour is
 * routinely in the other group -- so the press is correct and nothing on the
 * sheet moves. A key that appears to do nothing is a key an operator presses
 * twice and then distrusts, so the position is printed beside it and the
 * figure is what changes.
 *
 * `at` is 1-based because it is read by a person, and 0 when the judul is not
 * in the packet at all.
 */
export function packetPosition(
  template: Template,
  sectionId: NodeId,
): { at: number; of: number } {
  const index = template.sections.findIndex(
    (section) => section.id === sectionId,
  );
  return { at: index + 1, of: template.sections.length };
}

/**
 * Where a judul's NAME came from, when it did not come from the form as it
 * stands.
 *
 * `declared` is the ordinary case and prints nothing: a line under every
 * heading saying it is one of ours is furniture on every order forever.
 */
export type Provenance =
  | { kind: "declared" }
  | { kind: "renamed"; wasCalled: string }
  | { kind: "human" }
  | { kind: "llm"; sourceName: string | null };

export function provenanceOf(
  run: BrowserRun,
  section: SectionDef,
  base: Template = AO_TEMPLATE,
): Provenance {
  const added = section.added;
  if (added) {
    if (added.origin === "human") return { kind: "human" };
    // The berkas may have been removed from the order since the usulan was
    // accepted. Null rather than a made-up name: the judul is still the
    // model's suggestion, and saying WHICH document is the part that stopped
    // being true.
    const source = run.sources.find(
      (candidate) => candidate.id === added.fromSourceId,
    );
    return { kind: "llm", sourceName: source?.name ?? null };
  }

  const declared = base.sections.find(
    (candidate) => candidate.id === section.id,
  );
  if (declared && declared.title !== section.title) {
    return { kind: "renamed", wasCalled: declared.title };
  }
  return { kind: "declared" };
}
