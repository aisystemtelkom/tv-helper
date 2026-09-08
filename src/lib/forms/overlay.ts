/**
 * A run's edits to the form, stored as a DIFF against the compile-time
 * template, plus the one pure resolver that turns base + diff back into an
 * ordinary `Template`.
 *
 * WHY A DIFF AND NOT A COPY OF THE FORM. A run that stored its own whole
 * template would freeze `AO_TEMPLATE` as it stood the day the run was made:
 * every hint correction, every new slot, every fix to a `catatan` would reach
 * new runs only, and an old run reopened next month would still be searched
 * with last month's prompts while looking identical on screen. A diff carries
 * only what the OPERATOR changed, so everything they did not touch keeps
 * tracking the code.
 *
 * WHY IT IS ITS OWN PURE LEAF, in the manner of `../browser/slot-key.ts`.
 * Three places need the same resolution and none of them may own it: the
 * browser (which renders the edited form), the route that answers `/api/propose`
 * (which must search the same slot list the operator is looking at), and
 * `scripts/generate.mjs` (plain node, no client bundle). A second resolver is a
 * second answer to "what does this run's form look like", and the two would
 * agree on every unedited run, which is exactly how a disagreement stays hidden
 * until it matters.
 *
 * THE FENCE. An overlay can rename a heading, drop a section, reorder the
 * document and add a bagian of whole-page captures. It CANNOT express a prompt,
 * a hint, a docType, a table layout or a fillable flag: `assertOverlay` refuses
 * any object carrying one of those keys at any depth. That is a structural
 * rule, not a convention, and it exists because the measurement gate
 * (`pnpm measure:locate`) is the only thing that can tell a prompt gain from a
 * prompt regression. An operator editing a heading on a Tuesday must not be
 * able to move a number the gate is watching.
 *
 * WHAT AN AI PROPOSAL CAN AND CANNOT DO. `overlay.proposed` is read by NOTHING
 * in this module's resolver. A heading the model suggested is therefore
 * structurally unable to reach the docx exporter: it has to be moved into
 * `overlay.added` by a human act first. See `resolveTemplate`.
 */

import { CAPTURE_SEPARATOR, slotKeyOf } from "../browser/slot-key.ts";
import type { SectionDef, SlotDef, Template } from "./template.ts";

/**
 * Bumped when a stored overlay's SHAPE changes in a way this resolver cannot
 * read. `assertOverlay` refuses anything else outright rather than reading an
 * unknown shape optimistically: a version it does not understand is a form it
 * would render wrong, and a form rendered wrong is a packet a validator signs.
 */
export const OVERLAY_VERSION = 1;

/**
 * The name of one node in the resolved form: a section or a slot.
 *
 * A base node's id is the one it declares (`SectionDef.id`, `SlotDef.key`). A
 * node the operator added carries `u:${uuid}`, which cannot collide with a
 * declared id because no declared id starts with `u:` and the uuid is unique
 * anyway.
 *
 * IT MAY NEVER CONTAIN `#`. That is not a stylistic rule: `slotKeyOf` splits a
 * `SlotState.key` on the LAST `#` to separate a capture's ordinal from its
 * template key, so an added slot whose id carried one would silently be read as
 * capture N of some other slot, and its crop would be filed under a heading it
 * does not belong to. `assertNodeId` is the enforcement.
 */
export type NodeId = string;

/** An edit to a section that the base declares, or to one the operator added. */
export type SectionPatch = {
  /** Absent leaves the base's title alone. Present replaces it. */
  title?: string;
  /** The section is not rendered and its slots go with it. */
  removed?: true;
};

/** An edit to a slot that the base declares, or to one the operator added. */
export type SlotPatch = {
  label?: string;
  /**
   * The operator-facing definition. Editable because, unlike `ask`, no
   * measurement depends on its wording: see `SlotDef.catatan` in template.ts
   * for the whole argument. This is the reason `catatan` and `ask` are separate
   * fields at all, and it is what lets the fence be absolute about `ask`.
   */
  catatan?: { adalah: string; bukan?: string };
  /** The slot is not rendered. Its section stays. */
  removed?: true;
};

/** One capture the operator's added bagian asks for. */
export type AddedSlot = { id: NodeId; label: string };

/**
 * A bagian the operator added to THIS run's form.
 *
 * NO `layout` FIELD, EVER, and this is the load-bearing absence. An added
 * bagian is always `layout: "images"`, which means whole-page captures taken by
 * hand. A `layout: "table"` bagian would be a slot the model is asked to locate
 * inside a page, and nothing here can supply what such a slot needs: a `hint`
 * written to beat a look-alike anywhere in the bundle, and a gate run proving
 * it does. Adding the field would let an operator create a searchable slot with
 * no hint behind it, which returns a plausible fragment every time. See the
 * "routes on section.layout" note in AGENTS.md for the measurement that says so.
 */
export type AddedSection = {
  id: NodeId;
  title: string;
  slots: AddedSlot[];
  /**
   * Who put it there. `"llm"` means it began as a `ProposedSection` and a human
   * accepted it, which is a different provenance from a heading the operator
   * typed and is worth keeping visible on screen.
   */
  origin: "human" | "llm";
  /** The source document the heading was read out of, when there was one. */
  fromSourceId?: string;
  /** Where in that document, so the operator can go and look. */
  cite?: { pageIndex: number; lineRange: [number, number] };
  /** The pages this bagian is expected to capture, when they are known. */
  pages?: number[];
};

/**
 * A bagian the model thinks this bundle contains and the form does not name.
 *
 * A SUGGESTION, AND NOTHING MORE. `resolveTemplate` does not read this array,
 * so a proposal cannot reach the exporter, cannot reach the xlsx, and cannot be
 * counted as outstanding work. Accepting one means constructing an
 * `AddedSection` from it, which is a human act by construction.
 */
export type ProposedSection = {
  id: NodeId;
  title: string;
  fromSourceId: string;
  fromPages: number[];
  cite: { pageIndex: number; lineRange: [number, number] };
};

export type TemplateOverlay = {
  version: typeof OVERLAY_VERSION;
  /** `Template.id` of the form this diffs against, checked on resolve. */
  base: string;
  /** `fingerprintOf(base)` as it stood when the overlay was made. */
  baseFingerprint: string;
  sections: Record<NodeId, SectionPatch>;
  slots: Record<NodeId, SlotPatch>;
  added: AddedSection[];
  proposed: ProposedSection[];
  /** Section ids in the order they should render. See `resolveTemplate`. */
  order?: NodeId[];
};

/** Thrown by every guard here, so a route can answer 400 instead of 500. */
export class OverlayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OverlayError";
  }
}

/**
 * The `ask` every added slot carries, and every added section's `ask.title`.
 *
 * FIXED, SHARED AND FROZEN. It is never sent anywhere: `isSearchable` is false
 * for an added node, so no locate prompt is ever built from it. It reads as a
 * tombstone rather than as a description on purpose, because the moment it
 * reads like a real hint somebody will "improve" it and an operator's typing
 * will be one edit away from a prompt. Frozen because one object is shared by
 * every added slot in every run in the tab, and a mutation would reach all of
 * them.
 */
export const ADDED_SLOT_ASK: Readonly<{ label: string; hint: string }> =
  Object.freeze({
    label: "added bagian, never searched",
    hint: "added bagian, never searched",
  });

/** The section-level twin of `ADDED_SLOT_ASK`, for the same reason. */
export const ADDED_SECTION_ASK: Readonly<{ title: string }> = Object.freeze({
  title: "added bagian, never searched",
});

/**
 * Keys an overlay may never carry, AT ANY DEPTH.
 *
 * This is the fence stated as data. `ask` and `hint` are the prompt; `docType`
 * is the search's ranking preference; `layout` decides whether a section is
 * located by the model at all; `fillable` decides whether it is searched; and
 * `pageOrdinal` is computed by the resolver rather than declared, so a stored
 * one could only disagree with it. Every one of them is a lever the measurement
 * gate is the only judge of, and none of them is an operator's business.
 */
const FENCED_KEYS: ReadonlySet<string> = new Set([
  "ask",
  "hint",
  "docType",
  "layout",
  "pageOrdinal",
  "fillable",
]);

/** Long enough for any real heading, short enough that a paste is refused. */
const MAX_NODE_ID = 200;
const MAX_LABEL = 200;

/** How deep the fence walk will go before calling the value hostile. */
const MAX_FENCE_DEPTH = 24;

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Error messages reach logs, and a heading is operator text copied off a client
 * document, so quote a stub of it rather than the whole thing.
 */
function brief(value: string): string {
  return value.length <= 60 ? value : `${value.slice(0, 57)}...`;
}

function nodeIdAt(value: unknown, where: string): NodeId {
  if (typeof value !== "string") {
    throw new OverlayError(`${where}: node id is ${typeof value}, not a string`);
  }
  if (value.length === 0) {
    throw new OverlayError(`${where}: node id is empty`);
  }
  if (value.length > MAX_NODE_ID) {
    throw new OverlayError(
      `${where}: node id is ${value.length} characters, over the ${MAX_NODE_ID} limit`,
    );
  }
  if (value.includes(CAPTURE_SEPARATOR)) {
    // See the NodeId doc comment: `slotKeyOf` would read everything after this
    // as a capture ordinal and file the crop under another slot.
    throw new OverlayError(
      `${where}: node id "${brief(value)}" contains ${CAPTURE_SEPARATOR}, ` +
        "which separates a capture ordinal from its slot key",
    );
  }
  return value;
}

/** Public form of the id rule, for a caller minting one. */
export function assertNodeId(id: string): void {
  nodeIdAt(id, "node id");
}

function labelAt(value: unknown, where: string): string {
  if (typeof value !== "string") {
    throw new OverlayError(`${where}: expected a string, got ${typeof value}`);
  }
  // Blank is refused rather than accepted, because a blank heading is a heading
  // the deliverable prints as nothing: the operator would see a gap in the
  // packet and have no way to tell it from a section that failed to render.
  if (value.trim().length === 0) {
    throw new OverlayError(`${where}: is empty`);
  }
  if (value.length > MAX_LABEL) {
    throw new OverlayError(
      `${where}: is ${value.length} characters, over the ${MAX_LABEL} limit`,
    );
  }
  return value;
}

/**
 * Walks the WHOLE value refusing any fenced key, wherever it sits.
 *
 * At any depth, not just on the shapes this module names, because the fence has
 * to hold against the shape nobody thought of: a `catatan` carrying an `ask`, a
 * future field holding a nested object, an extra property a caller invented.
 * The point is that no arrangement of an overlay can carry a prompt.
 */
function assertNoFencedKeys(
  value: unknown,
  path: string,
  depth: number,
  ancestors: Set<object>,
): void {
  if (depth > MAX_FENCE_DEPTH) {
    throw new OverlayError(`${path}: nested deeper than ${MAX_FENCE_DEPTH}`);
  }
  if (typeof value !== "object" || value === null) return;
  // ANCESTORS, not everything seen. A cycle cannot come off the wire (JSON has
  // none) but can come from a caller assembling an overlay in process, and the
  // walk must not hang on one. Tracking every object ever visited would also
  // reject a perfectly legal overlay that happens to reuse one sub-object in
  // two places, which is a shared value rather than a loop.
  if (ancestors.has(value)) {
    throw new OverlayError(`${path}: contains a cycle`);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      assertNoFencedKeys(item, `${path}[${i}]`, depth + 1, ancestors);
    }
  } else {
    for (const key of Object.keys(value)) {
      if (FENCED_KEYS.has(key)) {
        throw new OverlayError(
          `${path}.${key}: an overlay may not carry "${key}". ` +
            "The prompt, the layout and the search flags belong to the " +
            "template, which the measurement gate scores; an overlay only " +
            "renames, removes, reorders and adds whole-page bagian.",
        );
      }
      assertNoFencedKeys(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
        depth + 1,
        ancestors,
      );
    }
  }
  ancestors.delete(value);
}

function assertCite(value: unknown, where: string): void {
  if (!isRecord(value)) {
    throw new OverlayError(`${where}: expected an object`);
  }
  const { pageIndex, lineRange } = value;
  if (!Number.isInteger(pageIndex) || (pageIndex as number) < 0) {
    throw new OverlayError(`${where}.pageIndex: expected a page index >= 0`);
  }
  if (!Array.isArray(lineRange) || lineRange.length !== 2) {
    throw new OverlayError(`${where}.lineRange: expected [from, to]`);
  }
  const [from, to] = lineRange as unknown[];
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    (from as number) < 0 ||
    (to as number) < (from as number)
  ) {
    // A reversed range is the citation failure `fields.ts` already refuses to
    // trust. Refusing it here too keeps a bad citation from ever being stored.
    throw new OverlayError(
      `${where}.lineRange: expected 0 <= from <= to, got [${String(from)}, ${String(to)}]`,
    );
  }
}

function assertPageList(value: unknown, where: string): void {
  if (!Array.isArray(value)) {
    throw new OverlayError(`${where}: expected an array of page indexes`);
  }
  for (const [i, page] of value.entries()) {
    if (!Number.isInteger(page) || (page as number) < 0) {
      throw new OverlayError(`${where}[${i}]: expected a page index >= 0`);
    }
  }
}

/**
 * THE WIRE GUARD. Run this on anything that arrives from storage or a request
 * body, BEFORE a single token is spent on it.
 *
 * Its job is to turn a caller's mistake into a 400 at the door rather than a
 * `TypeError` three stages later, next to a half-billed run. It is deliberately
 * stricter than the type: `assertOverlay` is the only thing standing between a
 * stored blob and a form an operator signs off.
 */
export function assertOverlay(
  value: unknown,
): asserts value is TemplateOverlay {
  if (!isRecord(value)) {
    throw new OverlayError(
      `overlay: expected an object, got ${Array.isArray(value) ? "an array" : typeof value}`,
    );
  }

  // THE FENCE RUNS FIRST, over the raw value, before any field is inspected.
  // Ordering it last would make it reachable only by a value that had already
  // passed every other check, and the whole point is that no shape gets past
  // it, including shapes this function does not otherwise understand.
  assertNoFencedKeys(value, "overlay", 0, new Set());

  if (value.version !== OVERLAY_VERSION) {
    throw new OverlayError(
      `overlay.version: expected ${OVERLAY_VERSION}, got ${JSON.stringify(value.version)}`,
    );
  }
  if (typeof value.base !== "string" || value.base.length === 0) {
    throw new OverlayError("overlay.base: expected the base template's id");
  }
  if (
    typeof value.baseFingerprint !== "string" ||
    value.baseFingerprint.length === 0
  ) {
    throw new OverlayError(
      "overlay.baseFingerprint: expected fingerprintOf(base)",
    );
  }
  // Pulled into locals rather than narrowed in place: a property path's
  // narrowing is a compiler courtesy, and a local is one the reader can see.
  const sectionPatches = value.sections;
  const slotPatches = value.slots;
  const added = value.added;
  const proposed = value.proposed;
  if (!isRecord(sectionPatches)) {
    throw new OverlayError("overlay.sections: expected an object of patches");
  }
  if (!isRecord(slotPatches)) {
    throw new OverlayError("overlay.slots: expected an object of patches");
  }
  if (!Array.isArray(added)) {
    throw new OverlayError("overlay.added: expected an array");
  }
  if (!Array.isArray(proposed)) {
    throw new OverlayError("overlay.proposed: expected an array");
  }

  // TWO ID NAMESPACES, NOT ONE. Sections and slots are pooled separately
  // because the base draws them from two different declarations and this guard
  // is not the place to assert the BASE is self-consistent: a template whose
  // section id happened to equal a slot key would make every legitimate overlay
  // throw, which is a worse failure than the collision it would be catching.
  const sectionIds = new Set<NodeId>();
  const slotIds = new Set<NodeId>();
  // Kept apart from the union above only so the error message can say WHICH
  // rule was broken: a collision with a patch key is "you patched a node you
  // own" (edit it in place), a collision with another added id is "two bagian,
  // one name". They are different mistakes and read as one otherwise.
  const patchedSectionIds = new Set<NodeId>();
  const patchedSlotIds = new Set<NodeId>();

  for (const id of Object.keys(sectionPatches)) {
    nodeIdAt(id, "overlay.sections");
    const patch = sectionPatches[id];
    if (!isRecord(patch)) {
      throw new OverlayError(`overlay.sections["${brief(id)}"]: expected an object`);
    }
    if (patch.title !== undefined) {
      labelAt(patch.title, `overlay.sections["${brief(id)}"].title`);
    }
    if (patch.removed !== undefined && patch.removed !== true) {
      throw new OverlayError(
        `overlay.sections["${brief(id)}"].removed: expected true or absent`,
      );
    }
    sectionIds.add(id);
    patchedSectionIds.add(id);
  }

  for (const id of Object.keys(slotPatches)) {
    nodeIdAt(id, "overlay.slots");
    const patch = slotPatches[id];
    if (!isRecord(patch)) {
      throw new OverlayError(`overlay.slots["${brief(id)}"]: expected an object`);
    }
    if (patch.label !== undefined) {
      labelAt(patch.label, `overlay.slots["${brief(id)}"].label`);
    }
    if (patch.catatan !== undefined) {
      if (!isRecord(patch.catatan)) {
        throw new OverlayError(
          `overlay.slots["${brief(id)}"].catatan: expected an object`,
        );
      }
      labelAt(patch.catatan.adalah, `overlay.slots["${brief(id)}"].catatan.adalah`);
      if (patch.catatan.bukan !== undefined) {
        labelAt(patch.catatan.bukan, `overlay.slots["${brief(id)}"].catatan.bukan`);
      }
    }
    if (patch.removed !== undefined && patch.removed !== true) {
      throw new OverlayError(
        `overlay.slots["${brief(id)}"].removed: expected true or absent`,
      );
    }
    slotIds.add(id);
    patchedSlotIds.add(id);
  }

  for (const [i, entry] of (added as unknown[]).entries()) {
    const where = `overlay.added[${i}]`;
    if (!isRecord(entry)) {
      throw new OverlayError(`${where}: expected an object`);
    }
    const id = nodeIdAt(entry.id, `${where}.id`);
    if (patchedSectionIds.has(id)) {
      // ONE ID, ONE HOME. See `resolveAdded`: an added bagian is the operator's
      // own node and is edited where it lives, so a patch naming one would be a
      // second spelling of its title that nothing reconciles.
      throw new OverlayError(
        `${where}.id: overlay.sections also names "${brief(id)}". ` +
          "An added bagian is edited in place, not through a patch.",
      );
    }
    if (sectionIds.has(id)) {
      throw new OverlayError(
        `${where}.id: "${brief(id)}" is already used by another section`,
      );
    }
    sectionIds.add(id);
    labelAt(entry.title, `${where}.title`);
    if (entry.origin !== "human" && entry.origin !== "llm") {
      throw new OverlayError(`${where}.origin: expected "human" or "llm"`);
    }
    if (entry.fromSourceId !== undefined && typeof entry.fromSourceId !== "string") {
      throw new OverlayError(`${where}.fromSourceId: expected a string`);
    }
    if (entry.cite !== undefined) assertCite(entry.cite, `${where}.cite`);
    if (entry.pages !== undefined) assertPageList(entry.pages, `${where}.pages`);
    const entrySlots = entry.slots;
    if (!Array.isArray(entrySlots)) {
      throw new OverlayError(`${where}.slots: expected an array`);
    }
    for (const [j, slot] of (entrySlots as unknown[]).entries()) {
      if (!isRecord(slot)) {
        throw new OverlayError(`${where}.slots[${j}]: expected an object`);
      }
      const slotId = nodeIdAt(slot.id, `${where}.slots[${j}].id`);
      if (patchedSlotIds.has(slotId)) {
        throw new OverlayError(
          `${where}.slots[${j}].id: overlay.slots also names "${brief(slotId)}". ` +
            "An added bagian is edited in place, not through a patch.",
        );
      }
      if (slotIds.has(slotId)) {
        throw new OverlayError(
          `${where}.slots[${j}].id: "${brief(slotId)}" is already used by another slot`,
        );
      }
      slotIds.add(slotId);
      labelAt(slot.label, `${where}.slots[${j}].label`);
    }
  }

  const proposedIds = new Set<NodeId>();
  for (const [i, entry] of (proposed as unknown[]).entries()) {
    const where = `overlay.proposed[${i}]`;
    if (!isRecord(entry)) {
      throw new OverlayError(`${where}: expected an object`);
    }
    const id = nodeIdAt(entry.id, `${where}.id`);
    // A proposal that names a section which already exists is either an accept
    // that half happened or an id about to collide with one. Both would show
    // the operator the same heading twice, once as a decision owed.
    if (proposedIds.has(id) || sectionIds.has(id)) {
      throw new OverlayError(
        `${where}.id: "${brief(id)}" is already used by another section`,
      );
    }
    proposedIds.add(id);
    labelAt(entry.title, `${where}.title`);
    if (typeof entry.fromSourceId !== "string" || entry.fromSourceId.length === 0) {
      throw new OverlayError(`${where}.fromSourceId: expected the source id`);
    }
    assertPageList(entry.fromPages, `${where}.fromPages`);
    assertCite(entry.cite, `${where}.cite`);
  }

  const order = value.order;
  if (order !== undefined) {
    if (!Array.isArray(order)) {
      throw new OverlayError("overlay.order: expected an array of section ids");
    }
    const placed = new Set<NodeId>();
    for (const [i, id] of (order as unknown[]).entries()) {
      const checked = nodeIdAt(id, `overlay.order[${i}]`);
      // A duplicate is refused rather than de-duplicated, because the two
      // readings ("first wins", "last wins") put a section in two different
      // places and nothing on screen would say which one happened.
      if (placed.has(checked)) {
        throw new OverlayError(
          `overlay.order[${i}]: "${brief(checked)}" appears more than once`,
        );
      }
      placed.add(checked);
    }
  }
}

// ---------------------------------------------------------------------------
// Construction and identity
// ---------------------------------------------------------------------------

export function emptyOverlay(base: Template): TemplateOverlay {
  return {
    version: OVERLAY_VERSION,
    base: base.id,
    baseFingerprint: fingerprintOf(base),
    sections: {},
    slots: {},
    added: [],
    proposed: [],
  };
}

/**
 * Does this overlay change the resolved form at all.
 *
 * `proposed` IS DELIBERATELY NOT COUNTED. An overlay carrying nothing but
 * proposals resolves to the base BY IDENTITY, which is the strongest available
 * statement of the rule that a model-suggested heading cannot reach a
 * deliverable: not "it is filtered out downstream" but "the resolver never
 * looked at it".
 *
 * So DO NOT use this to decide whether an overlay is worth STORING. A run with
 * pending proposals has state to keep and this function will say it is empty.
 * The question it answers is "may I hand the caller the base object", nothing
 * else.
 */
export function isEmpty(overlay: TemplateOverlay): boolean {
  return (
    Object.keys(overlay.sections).length === 0 &&
    Object.keys(overlay.slots).length === 0 &&
    overlay.added.length === 0 &&
    (overlay.order === undefined || overlay.order.length === 0)
  );
}

/**
 * A cheap, SYNCHRONOUS hash of the base's shape: its section ids and slot keys.
 *
 * Synchronous and dependency-free on purpose. `crypto.subtle.digest` is async
 * and would make every caller async for a drift check, and a node import would
 * stop this module loading in the browser, which is one of the three places it
 * runs. FNV-1a is enough: this DETECTS DRIFT, it is not a security boundary and
 * nothing authenticates anything with it. A collision costs a missed warning,
 * not a wrong document, because `resolveTemplate` resolves every patch by name
 * against the base it was handed rather than trusting this value.
 *
 * SORTED, so a pure reorder of the base's own section list does not change it.
 * That is deliberate: `overlay.order` addresses sections by id, so reordering
 * the base invalidates nothing an overlay stored.
 */
export function fingerprintOf(base: Template): string {
  const parts: string[] = [];
  for (const section of base.sections) {
    parts.push(`s:${section.id}`);
    for (const slot of section.slots) parts.push(`k:${slot.key}`);
  }
  parts.sort();
  return fnv1a(parts.join("\n"));
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // The FNV prime (16777619) as shifts. `hash * 16777619` would overflow into
    // a float and throw away the low bits, which is how a hand-written FNV ends
    // up colliding far more than the algorithm does.
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

function patchedSlot(slot: SlotDef, patch: SlotPatch | undefined): SlotDef | null {
  if (patch?.removed) return null;
  if (!patch || (patch.label === undefined && patch.catatan === undefined)) {
    // Identity, not a copy. Every untouched node coming back as itself is what
    // lets a memo in the UI compare by reference per section instead of
    // re-rendering the whole packet on every keystroke.
    return slot;
  }
  const next: SlotDef = { ...slot };
  if (patch.label !== undefined) next.label = patch.label;
  if (patch.catatan !== undefined) next.catatan = patch.catatan;
  return next;
}

function patchedSection(
  section: SectionDef,
  sections: Map<NodeId, SectionPatch>,
  slots: Map<NodeId, SlotPatch>,
): SectionDef | null {
  const patch = sections.get(section.id);
  if (patch?.removed) return null;

  const next: SlotDef[] = [];
  let changed = false;
  for (const slot of section.slots) {
    const resolved = patchedSlot(slot, slots.get(slot.key));
    if (resolved === null) {
      changed = true;
      continue;
    }
    if (resolved !== slot) changed = true;
    next.push(resolved);
  }

  const retitled = patch?.title !== undefined && patch.title !== section.title;
  if (!changed && !retitled) return section;

  const out: SectionDef = { ...section, slots: next };
  if (patch?.title !== undefined) out.title = patch.title;
  return out;
}

/**
 * ONE ID, ONE HOME. An added node is edited IN PLACE in `overlay.added`, never
 * through a patch, and `assertOverlay` refuses an overlay whose `sections` or
 * `slots` names an added id at all.
 *
 * The alternative was to let a patch name any node, base or added. It reads as
 * more forgiving and is the worse design: an added heading would then have two
 * spellings, `added[i].title` and `sections[id].title`, and the pair can
 * disagree. Every disagreement of that kind in this codebase has resolved the
 * same way, silently and in favour of whichever the reader happened to consult.
 * With one home there is nothing to reconcile, and removing an added bagian is
 * dropping its entry rather than filing a tombstone next to it.
 */
function resolveAdded(add: AddedSection): SectionDef {
  const out: SlotDef[] = [];
  for (const slot of add.slots) {
    const resolved: SlotDef = {
      key: slot.id,
      label: slot.label,
      // No document type: an added bagian is captured by hand, so there is no
      // ranking preference to express and nothing that would read one.
      docType: null,
      ask: ADDED_SLOT_ASK,
      fillable: true,
      // WHICH PAGE OF THIS BAGIAN this capture takes, 0-based, as `SlotDef`
      // requires of every fillable slot in a `layout: "images"` section. It is
      // a POSITION, not an identity: identity is the node id, and
      // `slot-key.ts` explains at length why the two must not be confused.
      pageOrdinal: out.length,
      // `added.id` IS THE NODE'S OWN NodeId, not its section's. It reads as a
      // duplicate of `key` and is not one: `key` is what the rest of the app
      // addresses this slot by (and what `slotKeyOf` strips a capture ordinal
      // off), while `added.id` is the overlay entry this def was built from.
      // They are equal today because an added slot's key IS its node id, and
      // writing it out is what keeps that a stated fact rather than a
      // coincidence a later change can break silently. `origin` is the
      // section's: a slot inside an accepted proposal was proposed too.
      added: { id: slot.id, origin: add.origin },
    };
    out.push(resolved);
  }

  const added: NonNullable<SectionDef["added"]> = {
    id: add.id,
    origin: add.origin,
  };
  // Only when there was one: `added.fromSourceId` names the document the judul
  // was read off, and an absent key says "nobody read this off anything",
  // which is a different statement from an empty string.
  if (add.fromSourceId !== undefined) added.fromSourceId = add.fromSourceId;

  return {
    id: add.id,
    title: add.title,
    // ALWAYS images. `AddedSection` has no field that could say otherwise, and
    // this is the line that makes that absence mean something.
    layout: "images",
    ask: ADDED_SECTION_ASK,
    slots: out,
    added,
  };
}

function ordered(sections: SectionDef[], order: NodeId[] | undefined): SectionDef[] {
  if (order === undefined || order.length === 0) return sections;
  const byId = new Map(sections.map((section) => [section.id, section]));
  const out: SectionDef[] = [];
  const placed = new Set<NodeId>();
  for (const id of order) {
    const section = byId.get(id);
    // An id naming nothing is IGNORED, not an error: a stored order outlives
    // the section it named the moment the base drops one, and refusing to
    // render the form over it would strand the run.
    if (section === undefined || placed.has(id)) continue;
    out.push(section);
    placed.add(id);
  }
  // AND THE REST STILL RENDER. An order that forgot a section must never delete
  // it: removal has its own explicit spelling (`removed: true`), and a silently
  // dropped section is a missing page of evidence in a packet that opens fine.
  for (const section of sections) {
    if (!placed.has(section.id)) out.push(section);
  }
  return out;
}

/**
 * base + diff -> an ordinary `Template`, which is what every downstream
 * function already takes. That is the whole integration surface: nothing below
 * this line knows an overlay exists.
 *
 * `resolveTemplate(base, undefined)` and `resolveTemplate(base, emptyOverlay(base))`
 * return `base` BY IDENTITY. Every run stored before overlays existed carries
 * no overlay and therefore behaves EXACTLY as it did, byte for byte, and a UI
 * memo keyed on the resolved template costs nothing for a run nobody edited.
 *
 * `overlay.proposed` IS NOT READ HERE, and that is the point of it being a
 * separate array rather than a flag on `added`. A heading the model invented
 * cannot reach the docx exporter, the xlsx, or the outstanding list without a
 * human moving it into `added` first. There is no code path from a proposal to
 * a deliverable.
 */
export function resolveTemplate(
  base: Template,
  overlay: TemplateOverlay | undefined,
): Template {
  if (overlay === undefined) return base;

  // Checked BEFORE the empty short-circuit, so an overlay against the wrong
  // form is loud even when it happens to be empty. The quiet version of this
  // resolves every patch against a template that declares none of its ids,
  // silently returns an unedited form, and shows the operator a packet with
  // their edits missing.
  if (overlay.base !== base.id) {
    throw new OverlayError(
      `overlay.base: overlay is against "${brief(overlay.base)}", template is "${brief(base.id)}"`,
    );
  }
  // The fingerprint is deliberately NOT enforced here. It records the base's
  // shape at the time the overlay was made so a caller can warn about drift;
  // refusing to resolve on a mismatch would strand every stored run behind any
  // change to the compile-time template, and the resolver is already safe
  // against drift because it looks every patch up by name.
  if (isEmpty(overlay)) return base;

  // Maps rather than the records themselves: a lookup by an id that happens to
  // name something on Object.prototype ("constructor", "toString") returns a
  // value that is not a patch, and reading `.removed` off it answers undefined
  // rather than throwing. That is a wrong-and-quiet path for the cost of two
  // lines to close.
  const sections = new Map<NodeId, SectionPatch>(Object.entries(overlay.sections));
  const slots = new Map<NodeId, SlotPatch>(Object.entries(overlay.slots));

  const out: SectionDef[] = [];
  for (const section of base.sections) {
    const resolved = patchedSection(section, sections, slots);
    if (resolved !== null) out.push(resolved);
  }
  for (const add of overlay.added) out.push(resolveAdded(add));

  // `xlsxRows`, `fieldHints`, `fieldLists`, `id` and `label` pass through
  // untouched, by construction rather than by copying them one at a time. The
  // overlay edits the DOCX SECTION LIST and nothing else, so no operator edit
  // can blank an xlsx cell or move a field hint the gate scores.
  return { ...base, sections: ordered(out, overlay.order) };
}

// ---------------------------------------------------------------------------
// Questions callers ask about a resolved template
// ---------------------------------------------------------------------------

function findSlot(
  template: Template,
  slotKey: string,
): { section: SectionDef; slot: SlotDef } | null {
  // A `SlotState.key` may carry a capture ordinal ("kb.top#2"); the template
  // knows only the bare key. Stripping unconditionally is safe: a key without
  // an ordinal comes back unchanged.
  const key = slotKeyOf(slotKey);
  for (const section of template.sections) {
    for (const slot of section.slots) {
      if (slot.key === key) return { section, slot };
    }
  }
  return null;
}

/**
 * MAY THE MODEL BE ASKED WHERE THIS SLOT IS.
 *
 * False for an added bagian, and false for a key the template does not declare.
 * This is the predicate the client filter uses when it builds `wanted`, and it
 * is the reason an added bagian never comes back labelled "tidak ditemukan":
 * the search was never asked about it, so there is no negative answer to report.
 * A slot nobody searched for and a slot the search failed on look identical on
 * screen, and one of them is a fault while the other is the design.
 *
 * `fillable` is a SEPARATE question and is deliberately not folded in here. A
 * non-fillable slot ships blank by design, which is a statement about the
 * deliverable, not about whether the model may be asked.
 */
export function isSearchable(template: Template, slotKey: string): boolean {
  const found = findSlot(template, slotKey);
  if (found === null) return false;
  // Both, though `resolveTemplate` makes them agree: `section.added` is belt
  // and braces for a template built by hand in a test or a migration.
  return !found.slot.added && !found.section.added;
}

/**
 * The added bagian this slot belongs to, or null if it belongs to the base (or
 * to nothing at all).
 *
 * Null is the answer for a base slot as well as for an unknown key, because the
 * question callers actually ask is "is this an added bagian, and if so which
 * one" -- the two nulls lead to the same branch.
 */
export function addedSectionOf(
  template: Template,
  slotKey: string,
): SectionDef | null {
  const found = findSlot(template, slotKey);
  if (found === null) return null;
  return found.section.added ? found.section : null;
}
