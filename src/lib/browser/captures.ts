/**
 * How a capture comes to exist, and how one stops existing.
 *
 * ITS OWN MODULE, PURE, for the same reason `slot-key.ts` is one: these two
 * functions are needed where IndexedDB is not. `src/lib/ui/propose.ts` folds
 * `/api/propose`'s answer into a run and runs under `node --test`, while
 * `runtime.ts` carries `"use client"` and drags in the storage layer and the
 * Web Worker client. `runtime.ts` re-exports both, so browser callers keep
 * importing them from the runtime and nothing else changes.
 *
 * WHY THERE IS ANYTHING TO APPEND AT ALL. `SlotDef.crops` used to declare that
 * the `KB (lanjutan)` ToP row holds two pictures, and `seedSlots` made two
 * states up front. An operator testing the tool reported the result: the sheet
 * showed "ToP 1" and "ToP 2" with the second permanently missing, on a
 * document holding one ToP. The sample's two pictures are one payment clause
 * split by a page break -- a fact about that contract's page breaks, not about
 * the form. So the count is discovered per document now, and a capture is a
 * thing that comes into existence when something finds it.
 */

import {
  captureKeyFor,
  captureOrdinalOf,
  nextCaptureOrdinal,
  slotKeyOf,
} from "./slot-key.ts";
import type { BrowserRun, SlotState } from "./types.ts";

/**
 * One discovered lanjutan, ready to be appended.
 *
 * `after` is the `SlotState.key` of the capture it continues, which is how the
 * ordinal is allocated and how a stale answer is recognised: a search runs for
 * minutes, and the capture it was walking forward from may have been rejected
 * or redrawn in the meantime.
 */
export type DiscoveredCapture = {
  after: string;
  zone: NonNullable<SlotState["zone"]>;
  text: string;
  origin?: SlotState["origin"];
  /**
   * Whether the walk ALSO looked past this newly-found capture.
   *
   * True for every link of a chain but the last one, because link n's own
   * continuation is link n+1 and it is being appended in the same call. Leaving
   * them all unstamped is what made the next Proses re-walk the whole chain and
   * append a byte-identical duplicate of every link -- see `capturesToWalk` and
   * `applyContinuations`.
   */
  continuationChecked?: boolean;
};

/**
 * What makes two captures the same picture: the page and the lines, never the
 * box, which `boxForLineRange` re-derives from the lines anyway.
 */
export function zoneFingerprint(
  zone: NonNullable<SlotState["zone"]>,
): string {
  return `${zone.pageIndex}:${zone.lineRange[0]}-${zone.lineRange[1]}`;
}

/**
 * Has anything looked past THIS capture's current rectangle?
 *
 * THE VERDICT NAMES ITS OWN SUBJECT, and that is the whole mechanism. It used
 * to be a boolean, which meant every one of the three places that replaces a
 * zone -- a hand redraw, a rejection, a fresh proposal arriving through the
 * normal tambahan loop -- had to remember to clear it, and all three were
 * found still carrying a verdict about a rectangle that no longer existed. A
 * fourth writer would have had to remember too.
 *
 * Storing the fingerprint of the zone that was walked removes the requirement
 * to remember: `{ ...slot, zone: next }` written by anybody, anywhere, now
 * carries a verdict whose subject no longer matches, and this function reads
 * it as unchecked. The invariant is enforced where it is READ rather than at
 * every site that writes.
 */
export function continuationChecked(slot: SlotState): boolean {
  if (!slot.zone || !slot.continuationCheckedFor) return false;
  return slot.continuationCheckedFor === zoneFingerprint(slot.zone);
}

/**
 * Continuations folded into a run's slot list, and the captures they follow
 * stamped as searched.
 *
 * APPENDED, never inserted, and always with a fresh ordinal from
 * `nextCaptureOrdinal`. `captureLabel` renders the ordinal and the docx
 * exporter stacks pictures in it, so re-using one relabels a capture the
 * operator has already signed off.
 *
 * PROPOSED, NEVER CONFIRMED. Measured on bundle one's four eligible field
 * slots, the confirming call is right three times and wrong once -- and the
 * wrong one is a legible crop of the NEXT clause under this slot's label,
 * which is exactly the plausible-wrong-evidence failure this project is
 * organised against. It goes to the operator with Terima / Bukan ini like any
 * other usulan.
 *
 * `checked` names the captures nothing needs to look past again, so the sheet
 * can tell "diperiksa, tidak ada lanjutan" from "belum diperiksa". A capture
 * whose walk stopped at the chain cap or on an error is NOT in that list: "we
 * ran out of budget" is not "there is nothing there".
 *
 * NOTHING IS APPENDED TWICE, and the guard is on the ZONE rather than on
 * trust. Every appended capture takes a fresh ordinal, so an answer that
 * repeats one the slot already holds becomes a second row carrying the same
 * picture: `captureLabel` renders it "(lanjutan 2)" beside an identical
 * "(lanjutan)", it arrives `proposed` so it re-opens a bagian the operator had
 * settled, and accepted it stacks the same image twice in one docx cell. That
 * is the operator's original complaint -- a row for a capture that does not
 * exist -- rebuilt on evidence that is already in the packet.
 */
export function withDiscoveredCaptures(
  run: BrowserRun,
  found: readonly DiscoveredCapture[],
  checked: readonly string[] = [],
): BrowserRun {
  const stamped = new Set(checked);
  const slots = run.slots.map((slot) =>
    // ONLY WHILE IT STILL HOLDS THE RECTANGLE THAT WAS WALKED. The flag is a
    // fact about one zone, not about a slot, and a run re-read from storage may
    // have had that capture reopened while the search ran. Stamping it then
    // would record "we looked past this" about whatever fills it next.
    stamped.has(slot.key) && slot.zone
      ? { ...slot, continuationCheckedFor: zoneFingerprint(slot.zone) }
      : slot,
  );

  const keys = new Set(slots.map((slot) => slot.key));
  /** Every zone the run already holds, grouped by the slot it belongs to. */
  const held = new Map<string, Set<string>>();
  for (const slot of slots) {
    if (!slot.zone) continue;
    const slotKey = slotKeyOf(slot.key);
    const seen = held.get(slotKey) ?? new Set<string>();
    seen.add(zoneFingerprint(slot.zone));
    held.set(slotKey, seen);
  }

  for (const capture of found) {
    const parent = slots.find((slot) => slot.key === capture.after);
    // A capture whose parent is gone, or whose parent lost its zone while the
    // search ran, is an answer to a question nobody is asking any more.
    // Appending it would put a lanjutan under a bagian that has none.
    if (!parent || !parent.zone) continue;
    // Same rule, one step further: `unfilled` is the operator saying this
    // bagian ships empty ON THE RECORD, and it keeps its zone, so the check
    // above does not catch it. Appending a `proposed` lanjutan under it would
    // re-open a decision that was made while the search ran, which is exactly
    // what `applyProposals` refuses to do on the other half of the answer.
    if (parent.status === "unfilled") continue;

    const slotKey = slotKeyOf(capture.after);
    const seen = held.get(slotKey) ?? new Set<string>();
    const fingerprint = zoneFingerprint(capture.zone);
    if (seen.has(fingerprint)) continue;

    const key = captureKeyFor(slotKey, nextCaptureOrdinal(keys, slotKey));
    keys.add(key);
    seen.add(fingerprint);
    held.set(slotKey, seen);
    slots.push({
      key,
      // The TEMPLATE's own label, undecorated. `captureLabel` adds
      // "(lanjutan)" from the ordinal at render time, so a stored label cannot
      // outlive a renumber.
      label: parent.label,
      status: "proposed",
      origin: capture.origin ?? "llm",
      zone: capture.zone,
      text: capture.text,
      ...(capture.continuationChecked
        ? { continuationCheckedFor: zoneFingerprint(capture.zone) }
        : {}),
    });
  }

  return { ...run, slots };
}

/**
 * A capture removed, together with every later capture of the same slot.
 *
 * WHY THE TAIL GOES TOO. Continuations are found by walking FORWARD: `#3` was
 * discovered by asking what follows `#2`. If the operator says `#2` is not a
 * lanjutan of this bagian, `#3` is not one either -- it is the continuation of
 * something that was never here. Leaving it behind would keep a row on the
 * sheet claiming a lanjutan for a bagian that has none, which is the operator's
 * original complaint in a new place.
 *
 * Rejecting capture 1 therefore clears the whole chain. Capture 1 itself is
 * NOT removed: the slot is still one the template asks for, so it drops into
 * the tambahan loop as `outstanding` the way it always has.
 *
 * Returns the removed keys as well, because `saveRun` needs them: a write that
 * drops a zone-carrying state without naming it is refused by
 * `CaptureLossError`.
 */
export function withoutCapture(
  run: BrowserRun,
  index: number,
): { run: BrowserRun; removed: string[] } {
  return dropCaptures(run, index, true);
}

/**
 * The tail alone: every LATER capture of one slot removed, the named capture
 * kept as it is.
 *
 * The REDRAW counterpart of `withoutCapture`, and the same reasoning one step
 * short of it. An operator who redraws `#2` is saying the lanjutan is here but
 * not shaped like that; `#3` was found by asking what follows the OLD `#2` and
 * is now the continuation of a rectangle that no longer exists. The redrawn
 * capture itself is evidence a human just drew, so it stays.
 */
export function withoutCapturesAfter(
  run: BrowserRun,
  index: number,
): { run: BrowserRun; removed: string[] } {
  return dropCaptures(run, index, false);
}

function dropCaptures(
  run: BrowserRun,
  index: number,
  includeTarget: boolean,
): { run: BrowserRun; removed: string[] } {
  const target = run.slots[index];
  if (!target) return { run, removed: [] };

  const slotKey = slotKeyOf(target.key);
  const from = captureOrdinalOf(target.key);
  const removed: string[] = [];

  const slots = run.slots.filter((slot, at) => {
    if (slotKeyOf(slot.key) !== slotKey) return true;
    const ordinal = captureOrdinalOf(slot.key);
    // Capture 1 survives as the slot's own row; only continuations are states
    // that can cease to exist.
    if (ordinal <= 1) return true;
    const doomed = (includeTarget && at === index) || ordinal > from;
    if (doomed) removed.push(slot.key);
    return !doomed;
  });

  return { run: { ...run, slots }, removed };
}
