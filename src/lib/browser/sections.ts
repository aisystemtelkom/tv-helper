/**
 * THE SECTION-EDIT ENGINE: one operator gesture, expressed as a VALUE, applied
 * to a run.
 *
 * ITS OWN MODULE, PURE, for the reason `captures.ts`, `sources.ts` and
 * `slot-key.ts` are: the interesting part is arithmetic over a run and an
 * overlay, it has to be testable where IndexedDB is not, and the storage call
 * that performs it (`editSections` in `runtime.ts`) is six lines wrapped around
 * this.
 *
 * ## WHY AN EDIT IS A VALUE AND NOT A RUN
 *
 * The obvious API is `saveRun({ ...run, overlay: next })` from the screen. It
 * is wrong here, and the reason is timing rather than taste. `ingestDocument`
 * holds the run lock for MINUTES over a 151-page document and advances the
 * revision once per page. A React-held `BrowserRun` composed into a new overlay
 * during that window is dozens of revisions stale by the time it reaches
 * storage, and `putRun` refuses it -- correctly, and with a sentence the
 * operator has to understand ("this order changed underneath you") for the
 * crime of renaming a heading while a document was being read.
 *
 * A `SectionEdit` has no revision. It is applied to whatever is STORED at the
 * moment the lock is taken, so a rename queued behind an ingest is a queued
 * write instead of a refused one.
 *
 * ## WHAT EVERY EDIT OWES THE STORAGE LAYER
 *
 * `putRun` runs four nets, and two of them take an opt-in: `removing` for a
 * potongan whose evidence this write discards, `removingSections` for a name
 * the operator authored that it discards. Every function here therefore returns
 * BOTH LISTS ALONGSIDE THE RUN, and the caller hands them straight to `putRun`.
 *
 * `removingSections` is computed with `discardedAuthorship`, which is the
 * storage layer's OWN function -- the one `putRun` will run to decide whether
 * to refuse this write. Deriving the opt-in from the guard rather than
 * hand-listing ids is what makes it impossible for the two to disagree: a
 * future edit shape that drops something new is named automatically instead of
 * being refused in front of an operator.
 */

import {
  OverlayError,
  assertNodeId,
  assertOverlay,
  resolveTemplate,
  type AddedSection,
  type AddedSlot,
  type NodeId,
  type ProposedSection,
  type SectionPatch,
  type TemplateOverlay,
} from "../forms/overlay.ts";
import { AO_TEMPLATE, type SectionDef, type Template } from "../forms/template.ts";
import type { Zone } from "../pipeline/locate.ts";
import { discardedAuthorship } from "../storage/runs.ts";
import { slotKeyOf } from "./slot-key.ts";
import type { BrowserRun, SlotState, StoredPage } from "./types.ts";

/**
 * The label an added bagian wears when the operator did not type one.
 *
 * Bahasa, because it is printed in the docx row and shown on the sheet. Named
 * by PAGE because that is what an added bagian always is: `AddedSection` has no
 * `layout` field, so every judul added to an order resolves to whole-page
 * captures taken by hand. See `resolveAdded` in `../forms/overlay.ts`.
 */
function pageLabel(ordinal: number): string {
  return `Halaman ${ordinal}`;
}

export type SectionEdit =
  /** A judul's heading, base or added. Writes a name and nothing else. */
  | { tag: "rename-section"; id: NodeId; title: string }
  /** A bagian's row label, base or added. Writes a name and nothing else. */
  | { tag: "rename-slot"; id: NodeId; label: string }
  /** One place up or down the packet, past the next VISIBLE judul. */
  | { tag: "move-section"; id: NodeId; by: -1 | 1 }
  /** The judul stops being part of this order, and its bagian go with it. */
  | {
      tag: "remove-section";
      id: NodeId;
      /**
       * HOW MANY ZONE-CARRYING POTONGAN THE OPERATOR AGREED TO LOSE.
       *
       * Present means a person was shown a figure and said yes to it, so the
       * removal is refused if the STORED order would drop more than that.
       * Absent means nobody was asked -- which is `sectionRemovalCost`'s own
       * call, made to compute the figure in the first place -- and is a
       * different statement from a zero. See `removeSection`.
       */
      droppingCaptures?: number;
    }
  /** A base judul brought back, its bagian re-seeded as belum dicari. */
  | { tag: "restore-section"; id: NodeId }
  /** A judul this order has and the form does not, typed by a person. */
  | { tag: "add-section"; title: string; slotLabel?: string }
  /** What discovery read out of one berkas, replacing that berkas's answers. */
  | { tag: "record-proposals"; sourceId: string; sections: ProposedSection[] }
  /** A person standing behind a usulan: it becomes an added judul. */
  | { tag: "accept-proposal"; id: NodeId }
  /** A person ruling a usulan out. It ceases to exist. */
  | { tag: "reject-proposal"; id: NodeId };

/**
 * A judul removal that would cost MORE than the operator was asked about.
 *
 * ## The gap this closes is minutes wide and is nobody's mistake
 *
 * `sectionRemovalCost` computes the figure against the `BrowserRun` REACT IS
 * HOLDING. `editSections` re-reads inside the run lock and applies the edit to
 * whatever is STORED, which is the entire point of an edit being a value: an
 * ingest holds that lock for minutes over a 151-page document and a Proses
 * behind it can attach a potongan to any judul while the dialog is on screen.
 *
 * The visible shape is worse than a wrong number. `judul.tsx` skips the
 * confirmation ENTIRELY when the count is zero, so a judul that gained a
 * confirmed crop during a long ingest is deleted on one press with no question
 * asked. And every net downstream reports success: the revision is current,
 * every page is carried, and `removing` names the very captures being dropped,
 * so `CaptureLossError` is SATISFIED BY THE WRITE ITSELF. It is the operator's
 * consent that went stale, and consent is the one thing storage cannot check.
 *
 * ## Named, so the shell can say it in Bahasa
 *
 * Read off `error.name` exactly as `saveFault` in `operator-app.tsx` reads the
 * storage refusals. An `OverlayError` here would fall through to that
 * function's generic sentence, which blames the device's storage for a
 * refusal that is about a number changing.
 *
 * A SUBCLASS of `OverlayError` rather than a sibling, so every existing
 * `instanceof OverlayError` boundary -- including a route answering 400 rather
 * than 500 -- keeps working unchanged.
 */
export class CaptureCountChangedError extends OverlayError {
  /** The figure the operator agreed to, as the screen printed it. */
  readonly agreed: number;
  /** What the stored order would actually drop. */
  readonly held: number;

  constructor(id: NodeId, agreed: number, held: number) {
    super(
      `remove-section "${id}": the operator agreed to lose ${agreed} potongan ` +
        `carrying evidence, and this order now holds ${held}. Something ` +
        "attached evidence to this judul after the question was asked -- most " +
        "likely a Proses or an ingest that finished while the dialog was " +
        "open -- so the removal is refused rather than performed. Re-read the " +
        "run, show the new figure, and ask again.",
    );
    this.name = "CaptureCountChangedError";
    this.agreed = agreed;
    this.held = held;
  }
}

export type SectionEditResult = {
  /** The run as it should now be stored. The SAME OBJECT when nothing changed. */
  run: BrowserRun;
  /** `putRun`'s `removing`: dropped slot-state keys that CARRIED A ZONE. */
  removing: string[];
  /** `putRun`'s `removingSections`: authored names this write discards. */
  removingSections: NodeId[];
};

/**
 * A fresh node id.
 *
 * INJECTABLE so a test can be deterministic, and `u:`-prefixed because that is
 * the one prefix no declared id uses -- see `NodeId` in `../forms/overlay.ts`.
 */
export type MintId = () => NodeId;

const defaultMintId: MintId = () => `u:${crypto.randomUUID()}`;

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

function trimmedTitle(value: string, what: string): string {
  // ENGLISH, deliberately. The UI validates before it calls, so anything that
  // reaches here is a caller's mistake rather than an operator's typing, and a
  // developer is the person who has to read it. Every operator-facing sentence
  // about a blank heading belongs on the screen that refused to submit it.
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OverlayError(`${what} is empty; a heading with no words prints as a gap`);
  }
  return value;
}

/** A shallow copy of the overlay, deep enough that no stored object is shared. */
function copyOverlay(overlay: TemplateOverlay): TemplateOverlay {
  const next: TemplateOverlay = {
    ...overlay,
    sections: { ...overlay.sections },
    slots: { ...overlay.slots },
    added: [...overlay.added],
    proposed: [...overlay.proposed],
  };
  if (overlay.order) next.order = [...overlay.order];
  return next;
}

function unchanged(run: BrowserRun): SectionEditResult {
  return { run, removing: [], removingSections: [] };
}

/**
 * Every section id this order knows about, in the arrangement it renders in,
 * INCLUDING the ones a `removed: true` patch is hiding.
 *
 * `resolveTemplate` drops a removed judul, so an order built from the RESOLVED
 * list would forget where a hidden judul used to sit -- and `ordered()` appends
 * anything the order does not name, so restoring it would drop it at the bottom
 * of the packet rather than back where the operator left it. A move must
 * therefore be written against the full list.
 */
function fullOrder(base: Template, overlay: TemplateOverlay): NodeId[] {
  const known = [
    ...base.sections.map((section) => section.id),
    ...overlay.added.map((section) => section.id),
  ];
  const stated = overlay.order ?? [];
  const placed = new Set<NodeId>();
  const out: NodeId[] = [];
  for (const id of stated) {
    // An id naming nothing is dropped rather than kept, matching `ordered()`'s
    // own rule: a stored order outlives the section it named the moment the
    // base stops declaring one.
    if (!known.includes(id) || placed.has(id)) continue;
    out.push(id);
    placed.add(id);
  }
  for (const id of known) {
    if (!placed.has(id)) out.push(id);
  }
  return out;
}

/** Is this judul rendered at all, or is a `removed: true` patch hiding it. */
function isVisible(overlay: TemplateOverlay, id: NodeId): boolean {
  return overlay.sections[id]?.removed !== true;
}

/**
 * The pending states a judul's fillable bagian are seeded with.
 *
 * KEYED EXACTLY AS `seedSlots` KEYS THEM -- the template key verbatim, capture
 * 1 wearing no ordinal -- because a restored judul has to rejoin a slot list
 * that everything else groups by `slotKeyOf`. A key invented here would render
 * as an orphan, which `blockingItems` reports with `stateIndex: -1` and the
 * outstanding panel deliberately draws with no button.
 */
function seedForSection(section: SectionDef): SlotState[] {
  const out: SlotState[] = [];
  for (const slot of section.slots) {
    if (!slot.fillable) continue;
    out.push({ key: slot.key, label: slot.label, status: "pending" });
  }
  return out;
}

/**
 * A whole page, as a zone, MIRRORING `wholePageZone` in
 * `src/app/api/propose/handler.ts`.
 *
 * Two things are copied deliberately rather than imported: that function is not
 * exported, and this one reads a `StoredPage` (widthPx/heightPx/lines) where
 * that one reads a `WirePage`. What must not diverge is the RULE, so the
 * numbering check comes with it.
 *
 * THE RANGE IS WRITTEN FROM THE ARRAY LENGTH AND READ BY LINE NUMBER, which
 * only agrees while `lines[k].i === k`. A page numbered any other way cites a
 * range that names different text than the rectangle covers: nothing throws,
 * and the citation under the picture is quietly wrong.
 */
function wholePageZone(page: StoredPage, pageIndex: number): Zone {
  const last = page.lines.length - 1;
  if (last < 0) {
    // REFUSED, NEVER PATCHED OVER. `Zone.lineRange` is two required numbers, so
    // a page with no lines has no honest range at all: the only value available
    // is [0, 0], which cites line 0 of a page that has none. That is a false
    // sumber under a picture in a packet a validator signs, which is the exact
    // failure this project is organised against.
    throw new OverlayError(
      `page ${pageIndex} has no OCR lines, so a whole-page capture of it would ` +
        "cite line 0 of a page with no line 0. Add the judul by hand and draw " +
        "the area instead.",
    );
  }
  if (page.lines[last].i !== last) {
    throw new OverlayError(
      `page ${pageIndex}'s last line is numbered ${page.lines[last].i}, not ` +
        `${last}: a whole-page citation is written from the array length`,
    );
  }
  return {
    pageIndex,
    box: { x: 0, y: 0, w: page.widthPx, h: page.heightPx },
    lineRange: [0, last],
  };
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

/**
 * One edit, applied to one run.
 *
 * PURE, AND ALWAYS A NEW RUN OBJECT when anything changed. The stored run is
 * never mutated: `editSections` reads it inside the lock and hands the result
 * to `putRun`, and a caller that mutated in place would have written half the
 * edit before the guards ran.
 *
 * `mintId` is injected so a test can pin what an added judul is called.
 */
export function applySectionEdit(
  run: BrowserRun,
  edit: SectionEdit,
  mintId: MintId = defaultMintId,
  base: Template = AO_TEMPLATE,
): SectionEditResult {
  const result = route(run, edit, mintId, base);

  // NOTHING LEAVES HERE THAT STORAGE OR THE RESOLVER WOULD REFUSE. Running the
  // wire guard on the way OUT rather than trusting each branch is what makes
  // the fence structural: an edit that minted a colliding id, a blank title or
  // (impossibly, but the guard does not care) a key carrying a prompt fails
  // here, in the function that produced it, instead of at a `putRun` several
  // frames away or in a resolver in front of an operator.
  if (result.run !== run) assertOverlay(result.run.overlay);
  return result;
}

function route(
  run: BrowserRun,
  edit: SectionEdit,
  mintId: MintId,
  base: Template,
): SectionEditResult {
  switch (edit.tag) {
    case "rename-section":
      return renameSection(run, edit.id, edit.title, base);
    case "rename-slot":
      return renameSlot(run, edit.id, edit.label, base);
    case "move-section":
      return moveSection(run, edit.id, edit.by, base);
    case "remove-section":
      return removeSection(run, edit.id, base, edit.droppingCaptures);
    case "restore-section":
      return restoreSection(run, edit.id, base);
    case "add-section":
      return addSection(run, edit.title, edit.slotLabel, mintId);
    case "record-proposals":
      return recordProposals(run, edit.sourceId, edit.sections);
    case "accept-proposal":
      return acceptProposal(run, edit.id, mintId);
    case "reject-proposal":
      return rejectProposal(run, edit.id);
  }
}

/**
 * Nothing but the overlay changed, so the two opt-ins are computed rather than
 * assumed.
 *
 * `removing` IS EMPTY BY PROOF, not by assertion, for every caller of this
 * helper. `CaptureLossError`'s entire input is `slot.key` and `slot.zone`
 * (`putRun` builds `new Map(run.slots.map((slot) => [slot.key, slot]))` and
 * compares each stored zone-carrier against it). These edits pass `run.slots`
 * through BY REFERENCE, so the carried map is key for key and zone for zone
 * identical to what is stored and that guard has nothing to find.
 */
function overlayOnly(run: BrowserRun, overlay: TemplateOverlay): SectionEditResult {
  return {
    run: { ...run, overlay },
    removing: [],
    removingSections: discardedAuthorship(run.overlay, overlay),
  };
}

// ---------------------------------------------------------------------------
// Renaming
// ---------------------------------------------------------------------------

/**
 * A heading, renamed. NO `SlotState` IS TOUCHED, and that is the point.
 *
 * The obvious alternative -- copying the new name onto every matching
 * `SlotState.label` -- looks like a rename and arrives at storage shaped like a
 * rebuild from the template, which is the write `CaptureLossError` exists to
 * refuse. A name lives in the overlay and nowhere else; `run.slots` holds
 * evidence.
 *
 * ONE ID, ONE HOME. An ADDED judul is edited IN PLACE inside `overlay.added`,
 * because `assertOverlay` refuses an overlay whose `sections` names an added id
 * at all -- two spellings of one title are two things that can disagree. A BASE
 * judul is renamed with a patch, which is the only place its new name can live.
 */
function renameSection(
  run: BrowserRun,
  id: NodeId,
  title: string,
  base: Template,
): SectionEditResult {
  assertNodeId(id);
  trimmedTitle(title, `rename-section ${id}: title`);

  const overlay = copyOverlay(run.overlay);
  const addedAt = overlay.added.findIndex((section) => section.id === id);
  if (addedAt !== -1) {
    overlay.added[addedAt] = { ...overlay.added[addedAt], title };
    return overlayOnly(run, overlay);
  }

  if (!base.sections.some((section) => section.id === id)) {
    throw new OverlayError(
      `rename-section: no judul with id "${id}" in this order. A usulan is ` +
        "renamed by accepting it first; it is not part of the form until then.",
    );
  }
  // The patch is MERGED, never replaced: a judul that is currently removed
  // keeps its tombstone, so renaming one on the review sheet cannot bring it
  // silently back into the packet.
  overlay.sections[id] = { ...overlay.sections[id], title };
  return overlayOnly(run, overlay);
}

/** A bagian's row label. Same two homes, same argument, one level down. */
function renameSlot(
  run: BrowserRun,
  id: NodeId,
  label: string,
  base: Template,
): SectionEditResult {
  assertNodeId(id);
  trimmedTitle(label, `rename-slot ${id}: label`);

  const overlay = copyOverlay(run.overlay);
  const addedAt = overlay.added.findIndex((section) =>
    section.slots.some((slot) => slot.id === id),
  );
  if (addedAt !== -1) {
    const section = overlay.added[addedAt];
    overlay.added[addedAt] = {
      ...section,
      slots: section.slots.map((slot) => (slot.id === id ? { ...slot, label } : slot)),
    };
    return overlayOnly(run, overlay);
  }

  const declared = base.sections.some((section) =>
    section.slots.some((slot) => slot.key === id),
  );
  if (!declared) {
    throw new OverlayError(
      `rename-slot: no bagian with key "${id}" in this order's form. A capture ` +
        "ordinal is not part of a key here; rename the bagian, not the capture.",
    );
  }
  overlay.slots[id] = { ...overlay.slots[id], label };
  return overlayOnly(run, overlay);
}

// ---------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------

/**
 * One judul moved one place up or down the packet.
 *
 * PAST THE NEXT VISIBLE JUDUL, NOT THE NEXT ENTRY. A removed judul keeps its
 * place in the stored order (see `fullOrder`) so that restoring it puts it back
 * where it was, and swapping with an invisible neighbour would be a button that
 * appears to do nothing. So the neighbour is found among the visible ones and
 * the two are swapped where they sit, leaving every hidden judul pinned.
 *
 * NO `SlotState` IS TOUCHED here either, for the reason `renameSection` states:
 * `run.slots` passes through by reference, so `CaptureLossError` has nothing to
 * find and `removing` is empty by construction rather than by promise.
 */
function moveSection(
  run: BrowserRun,
  id: NodeId,
  by: -1 | 1,
  base: Template,
): SectionEditResult {
  assertNodeId(id);
  const order = fullOrder(base, run.overlay);
  const at = order.indexOf(id);
  if (at === -1) {
    throw new OverlayError(`move-section: no judul with id "${id}" in this order`);
  }
  if (!isVisible(run.overlay, id)) {
    throw new OverlayError(
      `move-section: judul "${id}" is not in this order's packet, so there is ` +
        "nowhere to move it. Restore it first.",
    );
  }

  let swap = -1;
  for (let i = at + by; i >= 0 && i < order.length; i += by) {
    if (isVisible(run.overlay, order[i])) {
      swap = i;
      break;
    }
  }
  // Already at the end of the packet. Returning the run BY IDENTITY rather than
  // a copy is what lets `editSections` skip the write entirely: a no-op that
  // still saved would advance the revision and refuse whatever the screen was
  // holding, which is a real cost for a button press that did nothing.
  if (swap === -1) return unchanged(run);

  const next = [...order];
  next[at] = order[swap];
  next[swap] = id;

  const overlay = copyOverlay(run.overlay);
  overlay.order = next;
  return overlayOnly(run, overlay);
}

// ---------------------------------------------------------------------------
// Removing and restoring
// ---------------------------------------------------------------------------

/**
 * A judul taken out of this order, WITH THE STATES UNDER IT.
 *
 * THE STATES GO IN THE SAME WRITE, and leaving them behind is the defect this
 * function is shaped around. A `SlotState` whose key the resolved form no
 * longer declares is an ORPHAN (`unmatchedStates`), and an orphan CARRYING A
 * ZONE now BLOCKS THE EXPORT: `blockingItems` pushes it with `stateIndex: -1`,
 * which the outstanding panel draws with no button. So an operator who removed
 * a judul they did not want would be left unable to finish the packet, with the
 * only remedy on a row they cannot press.
 *
 * ## Two removals, two shapes
 *
 * A BASE judul is TOMBSTONED (`{ removed: true }`) rather than forgotten,
 * because the form still declares it and the operator must be able to change
 * their mind. The title patch, if they had renamed it, is KEPT: restoring
 * brings back their own word rather than the form's.
 *
 * An ADDED judul is DROPPED from `overlay.added`, because there is no base
 * declaration for a tombstone to sit against. Its id is what
 * `removingSections` names.
 *
 * ## Idempotent for a base judul, and not for an added one
 *
 * Removing a tombstoned judul twice changes nothing and reports nothing, which
 * is what two tabs or a double click produce. Removing an added judul twice
 * addresses an id that no longer exists anywhere and throws. The asymmetry is
 * the tombstone: one of them is still a thing you can name.
 *
 * ## `droppingCaptures` is the operator's consent, carried on the edit
 *
 * See `CaptureCountChangedError`. The figure a person was shown is computed
 * against a run React is holding and this edit is applied to the STORED one, so
 * the number has to travel with the decision or it cannot be checked at all.
 */
function removeSection(
  run: BrowserRun,
  id: NodeId,
  base: Template,
  droppingCaptures?: number,
): SectionEditResult {
  assertNodeId(id);

  const overlay = copyOverlay(run.overlay);
  const addedAt = overlay.added.findIndex((section) => section.id === id);
  const baseSection = base.sections.find((section) => section.id === id);

  /** Every template key the judul owns; a capture ordinal is stripped later. */
  let owned: Set<string>;

  if (addedAt !== -1) {
    owned = new Set(overlay.added[addedAt].slots.map((slot) => slot.id));
    overlay.added.splice(addedAt, 1);
  } else if (baseSection) {
    if (overlay.sections[id]?.removed) return unchanged(run);
    // THE BASE'S OWN SLOT LIST, not the resolved one. `resolveTemplate` can
    // only ever remove slots from a base section, never add them, so this is
    // the superset -- and a state for a slot some patch had already hidden is
    // exactly the orphan this sweep is here to take with it.
    owned = new Set(baseSection.slots.map((slot) => slot.key));
    overlay.sections[id] = { ...overlay.sections[id], removed: true };
  } else {
    throw new OverlayError(
      `remove-section: no judul with id "${id}" in this order. A usulan is ` +
        "rejected, not removed: it is not part of the form.",
    );
  }

  const removing: string[] = [];
  const slots = run.slots.filter((slot) => {
    // `slotKeyOf` first, so `<key>#2` and `<key>#3` go with `<key>`. A lanjutan
    // left behind under a deleted judul is the orphan case above, wearing the
    // one key shape a naive `owned.has(slot.key)` would miss.
    if (!owned.has(slotKeyOf(slot.key))) return true;
    // ONLY A ZONE-CARRIER IS NAMED. That is precisely `CaptureLossError`'s own
    // test: a capture nobody found evidence for costs nothing to re-seed, and
    // naming it would spend the opt-in on nothing.
    if (slot.zone) removing.push(slot.key);
    return false;
  });

  /*
   * MORE THAN WAS AGREED IS A DIFFERENT DECISION, so it is asked again.
   *
   * FEWER IS NOT. A "Bukan ini" landing between the question and the answer
   * lowers the count, and refusing then would block a removal nobody objects
   * to: the operator already consented to losing more than this costs.
   *
   * ABSENT IS NOT ZERO, and the difference is load-bearing.
   * `sectionRemovalCost` performs this very edit to COUNT what it would drop,
   * and reading an omitted figure as a zero would make the guard refuse the
   * call that exists to feed it -- taking down the review sheet in the act of
   * deciding how loudly to ask.
   *
   * Thrown AFTER `removing` is computed and BEFORE anything is returned: the
   * function is pure, so nothing is half-applied either way, but the counts in
   * the message have to be the real ones.
   */
  if (droppingCaptures !== undefined && removing.length > droppingCaptures) {
    throw new CaptureCountChangedError(id, droppingCaptures, removing.length);
  }

  return {
    run: { ...run, overlay, slots },
    removing,
    removingSections: discardedAuthorship(run.overlay, overlay),
  };
}

/**
 * A base judul brought back, and its bagian re-seeded.
 *
 * THE RE-SEED IS THE WHOLE OPERATION, not a tidy-up after it. `remove-section`
 * dropped every state under this judul; putting the heading back without them
 * leaves each fillable bagian with ZERO captures, which `blockingItems` reports
 * as a blocking `kind: "pending"` at `stateIndex: -1` -- a row the outstanding
 * panel deliberately renders with no button. The export would be blocked behind
 * a control that does not exist.
 *
 * IT NAMES NOTHING IN EITHER LIST. An addition is not a loss: no state is
 * dropped and no name is discarded, so both opt-ins are empty and
 * `discardedAuthorship` agrees.
 *
 * KEEPS THE OPERATOR'S OWN NAME. Only the `removed` key is deleted, never the
 * whole patch, so a judul they had renamed comes back under their word. The
 * patch is removed entirely only when `removed` was all it held -- an empty
 * patch is a name nobody wrote.
 */
function restoreSection(
  run: BrowserRun,
  id: NodeId,
  base: Template,
): SectionEditResult {
  assertNodeId(id);
  if (!base.sections.some((section) => section.id === id)) {
    throw new OverlayError(
      `restore-section: no judul with id "${id}" in the form. An added judul ` +
        "is dropped outright rather than tombstoned, so there is nothing to " +
        "restore; add it again.",
    );
  }

  const overlay = copyOverlay(run.overlay);
  const patch = overlay.sections[id];
  const wasRemoved = patch?.removed === true;
  if (wasRemoved) {
    // Rebuilt field by field rather than by dropping a key off a spread, so
    // that a field added to `SectionPatch` later fails to compile here instead
    // of being carried across silently. That is the same discipline `metaOf`
    // and `toStoredPage` use, and for the same reason.
    const kept: SectionPatch = {};
    if (patch?.title !== undefined) kept.title = patch.title;
    if (Object.keys(kept).length === 0) delete overlay.sections[id];
    else overlay.sections[id] = kept;
  }

  // Resolved AFTER the restore, so the seeded rows carry the labels the
  // operator actually sees -- including a bagian they renamed before the judul
  // was removed.
  const section = resolveTemplate(base, overlay).sections.find(
    (candidate) => candidate.id === id,
  );
  if (!section) {
    throw new OverlayError(
      `restore-section: judul "${id}" is still not in the resolved form after ` +
        "its removal was lifted, which means something else is hiding it",
    );
  }

  const held = new Set(run.slots.map((slot) => slot.key));
  // ONLY THE ROWS THAT ARE MISSING. Restoring a judul whose states are somehow
  // still there must not seed a second `pending` row under the same key: two
  // states with one key make one of them permanently unaddressable, since every
  // screen and `putRun`'s own map key by it.
  const seeded = seedForSection(section).filter((slot) => !held.has(slot.key));
  // Nothing was hidden and nothing is missing: the judul is already in the
  // packet with its rows. Identity, so `editSections` skips the write.
  if (!wasRemoved && seeded.length === 0) return unchanged(run);

  return {
    run: { ...run, overlay, slots: [...run.slots, ...seeded] },
    removing: [],
    removingSections: discardedAuthorship(run.overlay, overlay),
  };
}

// ---------------------------------------------------------------------------
// Adding
// ---------------------------------------------------------------------------

/**
 * A judul this order has and the form does not.
 *
 * AND ITS BAGIAN'S STATE IS SEEDED IN THE SAME BREATH. That is not tidiness.
 * `blockingItems` pushes a blocking `kind: "pending"` with `stateIndex: -1` for
 * a fillable slot holding ZERO captures, and a `-1` index is a row the
 * outstanding panel deliberately renders WITH NO BUTTON -- there is no capture
 * on the sheet for it to point at. Without the seed, adding a judul would block
 * the export behind a control that does not exist, on the happy path of the
 * feature that adds one.
 *
 * ONE bagian, never none: an added judul with no rows prints a heading over
 * nothing, and `AddedSection` is always whole-page captures taken by hand, so
 * the first page is the smallest honest thing to ask for.
 */
function addSection(
  run: BrowserRun,
  title: string,
  slotLabel: string | undefined,
  mintId: MintId,
): SectionEditResult {
  trimmedTitle(title, "add-section: title");
  const label =
    slotLabel === undefined
      ? pageLabel(1)
      : trimmedTitle(slotLabel, "add-section: slotLabel");

  const sectionId = mintId();
  const slotId = mintId();
  assertNodeId(sectionId);
  assertNodeId(slotId);
  if (sectionId === slotId) {
    // Two nodes, one name. `assertOverlay` pools section and slot ids
    // separately and would not catch it, and `resolveAdded` makes the slot's
    // KEY its node id -- so the judul and the bagian inside it would answer to
    // the same string, and `isSearchable`/`addedSectionOf` would disagree about
    // which one they found.
    throw new OverlayError("add-section: mintId returned the same id twice");
  }

  const slot: AddedSlot = { id: slotId, label };
  const section: AddedSection = {
    id: sectionId,
    title,
    slots: [slot],
    // A person typed this heading. `"llm"` is reserved for a usulan somebody
    // accepted, and the two read differently on the sheet on purpose.
    origin: "human",
  };

  const overlay = copyOverlay(run.overlay);
  overlay.added.push(section);

  return {
    run: {
      ...run,
      overlay,
      // The key is the SLOT'S NODE ID, because that is what `resolveAdded`
      // makes the resolved `SlotDef.key`. Anything else here is a state the
      // form has no row for: an orphan, under a judul the operator just added.
      slots: [...run.slots, { key: slotId, label, status: "pending" }],
    },
    removing: [],
    removingSections: discardedAuthorship(run.overlay, overlay),
  };
}

// ---------------------------------------------------------------------------
// Usulan: recording, accepting, rejecting
// ---------------------------------------------------------------------------

/**
 * The judul this order ALREADY captures every page of, if there is one.
 *
 * ## Why anything asks this
 *
 * "Cari judul lagi" puts the same question to the same berkas and gets the same
 * answer. Discovery is stateless -- it re-reads the pages and names every
 * heading printed on them -- and it has never seen `overlay.added`, which is
 * where a heading goes the moment somebody accepts it. So the second pass
 * re-proposes what the operator already adopted, and accepting the repeat files
 * THE SAME PAGES a second time under a second heading: the packet then carries
 * one picture twice, in two places, reading as more evidence rather than as the
 * same evidence.
 *
 * ## FULLY CLAIMED, NOT OVERLAPPING, and the narrowness is the point
 *
 * A span sharing one page with an accepted judul and adding three of its own is
 * a DIFFERENT finding about the document -- a re-segmentation the operator may
 * well want, and the operator is the only one who can tell that from a
 * duplicate. Refusing on any overlap would silently delete headings nobody has
 * ruled on. The duplicate this guards is the exact repeat, which is precisely
 * what asking twice produces.
 *
 * Only `pages` is consulted, so this sees judul that came from a usulan and not
 * ones the operator TYPED: `add-section` claims no pages, because it was not
 * read off anything. That is correct rather than a gap -- a typed heading makes
 * no claim about a page, so it cannot be claiming these.
 */
function fullyClaimedBy(
  added: readonly AddedSection[],
  pages: readonly number[],
): AddedSection | null {
  if (pages.length === 0) return null;
  for (const section of added) {
    if (section.pages === undefined || section.pages.length === 0) continue;
    const held = new Set(section.pages);
    if (pages.every((page) => held.has(page))) return section;
  }
  return null;
}

/**
 * What discovery read out of ONE berkas.
 *
 * REPLACES that berkas's entries rather than appending to them, because asking
 * twice must not show the operator each heading twice. Every other berkas's
 * usulan are untouched: they are separate answers to separate questions.
 *
 * `sectionsAskedFor` IS THE COST GATE and is set here, on that source alone. It
 * records that the QUESTION WAS PUT, not that the answer was useful: a berkas
 * that yielded nothing is still asked-for, and paying again buys the same
 * sentence.
 */
function recordProposals(
  run: BrowserRun,
  sourceId: string,
  sections: ProposedSection[],
): SectionEditResult {
  const source = run.sources.find((candidate) => candidate.id === sourceId);
  if (!source) {
    throw new OverlayError(
      `record-proposals: this order holds no berkas with id "${sourceId}", so ` +
        "there is nothing to file these usulan against",
    );
  }
  if (!Array.isArray(sections)) {
    throw new OverlayError("record-proposals: sections must be an array");
  }
  for (const [at, section] of sections.entries()) {
    // NAMED BY THE BERKAS THEY CAME OUT OF, and checked. This function replaces
    // by `fromSourceId`, so an entry filed under a different berkas would
    // survive the next recording of its own berkas and be replaced by an
    // unrelated one -- a heading attributed to a document it was not read from,
    // with a `cite` pointing into that document's pages.
    if (section?.fromSourceId !== sourceId) {
      throw new OverlayError(
        `record-proposals: sections[${at}].fromSourceId is ` +
          `"${String(section?.fromSourceId)}", not "${sourceId}"`,
      );
    }
  }

  /*
   * A HEADING THE OPERATOR ALREADY ADOPTED IS NOT A DECISION OWED, so it never
   * reaches the panel. See `fullyClaimedBy`: asking a berkas twice re-proposes
   * everything already accepted out of it, and the amber count on the usulan
   * panel would then stand over work that is finished. `--mark` stops being
   * read the moment it appears over nothing.
   *
   * DROPPED, NOT REFUSED. The reply is otherwise perfectly good, and one
   * repeated heading is no reason to throw away the three new ones beside it --
   * the same line `discoverSections` draws when it files one entry in
   * `unusable` and keeps the rest.
   *
   * `acceptProposal` checks this too, and that is not redundant: a usulan filed
   * BEFORE the accept is already stored, and nothing re-screens it.
   */
  const filed = sections.filter(
    (section) => fullyClaimedBy(run.overlay.added, section.fromPages) === null,
  );

  const overlay = copyOverlay(run.overlay);
  overlay.proposed = [
    ...run.overlay.proposed.filter((entry) => entry.fromSourceId !== sourceId),
    ...filed,
  ];

  return {
    run: {
      ...run,
      overlay,
      sources: run.sources.map((candidate) =>
        candidate.id === sourceId
          ? { ...candidate, sectionsAskedFor: true }
          : candidate,
      ),
    },
    removing: [],
    removingSections: discardedAuthorship(run.overlay, overlay),
  };
}

/**
 * A person standing behind a usulan.
 *
 * THE ONLY PATH FROM `proposed` TO A DELIVERABLE, and it is a human act by
 * construction: `resolveTemplate` does not read `overlay.proposed` at all, so a
 * heading the model invented is structurally unable to reach the docx exporter
 * until this function moves it into `overlay.added`.
 *
 * ## Fresh ids, one bagian per page
 *
 * The proposal's own id is not reused. It named a suggestion; what is created
 * here is a different kind of thing -- a judul in this order's form, with a
 * bagian per page of the span, each of which needs an id of its own that no
 * proposal ever had. Reusing the id would also make "was this accepted" and
 * "is this still a usulan" the same question.
 *
 * ## The zones are whole pages, read from `fromPages`
 *
 * `ProposedSection.fromPages` are RUN-GLOBAL positions in `run.pages`, which is
 * what `Zone.pageIndex` means. They are NOT `StoredPage.index`, which restarts
 * at 0 for every berkas -- confusing the two crops every page of the second
 * document out of the first, which is quiet because the first document reviews
 * correctly.
 *
 * ## A lineless page is refused, and the whole span with it
 *
 * A whole-page citation is written from the array length, so a page with no
 * lines would be cited as line 0 of a page that has none. There is no honest
 * range to write instead. Accepting the rest of the span and skipping that page
 * would be worse: a judul that silently ships one page short is the missing
 * evidence this project is organised against. The remedy is to add the judul by
 * hand and draw the area, which is what `add-section` is for.
 */
function acceptProposal(
  run: BrowserRun,
  id: NodeId,
  mintId: MintId,
): SectionEditResult {
  assertNodeId(id);
  const proposal = run.overlay.proposed.find((entry) => entry.id === id);
  if (!proposal) {
    throw new OverlayError(
      `accept-proposal: no usulan with id "${id}" in this order. It may have ` +
        "been accepted or rejected already; re-read the order.",
    );
  }
  if (proposal.fromPages.length === 0) {
    throw new OverlayError(
      `accept-proposal: usulan "${id}" names no pages, so there is nothing to ` +
        "capture",
    );
  }

  // THE SAME PAGES, UNDER A SECOND HEADING, IS ONE PICTURE FILED TWICE. See
  // `fullyClaimedBy` for how a usulan gets to be a repeat of a judul that is
  // already in the packet, and why the test is "every page of it" rather than
  // "any page of it".
  const alreadyHeld = fullyClaimedBy(run.overlay.added, proposal.fromPages);
  if (alreadyHeld) {
    throw new OverlayError(
      `accept-proposal: usulan "${id}" covers page(s) ` +
        `${proposal.fromPages.join(", ")}, which the judul ` +
        `"${alreadyHeld.title}" in this order already captures. Accepting it ` +
        "would file the same pages a second time under a second heading, so " +
        "the packet would carry one picture twice and read as more evidence " +
        'than it holds. Rule it out with "Bukan ini", or remove the judul ' +
        "that holds those pages first.",
    );
  }

  const slots: AddedSlot[] = [];
  const states: SlotState[] = [];
  const held = new Set(run.slots.map((slot) => slot.key));

  proposal.fromPages.forEach((pageIndex, at) => {
    const page = run.pages[pageIndex];
    if (!page) {
      throw new OverlayError(
        `accept-proposal: usulan "${id}" names page ${pageIndex}, and this ` +
          `order holds ${run.pages.length} page(s). A page index here is a ` +
          "position in run.pages, not a page number inside its own berkas.",
      );
    }
    // Throws on a lineless or oddly-numbered page. Before anything is written.
    const zone = wholePageZone(page, pageIndex);

    const slotId = mintId();
    assertNodeId(slotId);
    if (held.has(slotId) || slots.some((existing) => existing.id === slotId)) {
      throw new OverlayError(`accept-proposal: mintId returned a duplicate id`);
    }
    const label = pageLabel(at + 1);
    slots.push({ id: slotId, label });
    states.push({
      key: slotId,
      label,
      // PROPOSED, NEVER CONFIRMED. The model picked the pages; a person has
      // agreed the judul exists, which is a different statement from "this
      // picture is the right picture". It goes to the operator with Terima /
      // Bukan ini like any other usulan.
      status: "proposed",
      origin: "llm",
      zone,
      text: page.lines.map((line) => line.text).join("\n"),
    });
  });

  const sectionId = mintId();
  assertNodeId(sectionId);

  const section: AddedSection = {
    id: sectionId,
    title: proposal.title,
    slots,
    // `"llm"` records that this began as a suggestion. A deliverable looks
    // exactly the same whichever put the row in it, so the provenance has to be
    // carried rather than inferred.
    origin: "llm",
    fromSourceId: proposal.fromSourceId,
    cite: proposal.cite,
    pages: [...proposal.fromPages],
  };

  const overlay = copyOverlay(run.overlay);
  overlay.added.push(section);
  overlay.proposed = overlay.proposed.filter((entry) => entry.id !== id);

  return {
    run: { ...run, overlay, slots: [...run.slots, ...states] },
    removing: [],
    removingSections: discardedAuthorship(run.overlay, overlay),
  };
}

/**
 * A usulan ruled out. It simply ceases to exist.
 *
 * NAMES NOTHING IN EITHER LIST, and `discardedAuthorship` says so rather than
 * this function asserting it: `overlay.proposed` is not authorship. A usulan
 * nobody has ruled on is the overlay's equivalent of a capture carrying no
 * zone -- it costs a model call to make again, not a person's decision -- which
 * is the same line `CaptureLossError` draws one level down.
 */
function rejectProposal(run: BrowserRun, id: NodeId): SectionEditResult {
  assertNodeId(id);
  if (!run.overlay.proposed.some((entry) => entry.id === id)) {
    throw new OverlayError(
      `reject-proposal: no usulan with id "${id}" in this order. It may have ` +
        "been accepted or rejected already; re-read the order.",
    );
  }

  const overlay = copyOverlay(run.overlay);
  overlay.proposed = overlay.proposed.filter((entry) => entry.id !== id);
  return overlayOnly(run, overlay);
}
