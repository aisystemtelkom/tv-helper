/**
 * Taking one source document back out of an open order.
 *
 * ITS OWN MODULE, PURE, for the reason `captures.ts` and `slot-key.ts` are:
 * the interesting part is arithmetic over a run, it has to be testable where
 * IndexedDB is not, and the storage call that performs it is four lines
 * wrapped around this.
 *
 * WHY THIS IS NOT A FILTER. `BrowserRun.pages` is append-only and its own
 * doc comment says so, because `Zone.pageIndex` IS A POSITION IN THAT ARRAY.
 * Removing a document's pages therefore does two things at once, and the
 * second is invisible:
 *
 *   1. the evidence found INSIDE that document stops existing, which is what
 *      the operator asked for and expects, and
 *   2. every zone found in a LATER document silently starts pointing at a
 *      different page.
 *
 * The second is this project's whole failure class in one line: the packet
 * still opens, every crop is still a crop, and one of them is now a picture of
 * the wrong page with a validator's signature under it. So the pages are not
 * filtered; they are renumbered, and every surviving zone is moved with them.
 *
 * WHAT HAPPENS TO EVIDENCE THAT LIVED IN THE REMOVED DOCUMENT is the other
 * half, and it follows `withoutCapture`'s rule rather than inventing one.
 *
 *   - Capture 1 of a bagian KEEPS ITS ROW and loses its zone, dropping back to
 *     `pending`. The template still asks for that bagian; only the evidence
 *     for it is gone.
 *   - A lanjutan (ordinal 2 and up) is REMOVED OUTRIGHT, and so is every later
 *     capture of the same bagian, exactly as rejecting one does. A lanjutan
 *     exists only because something walked forward from the capture before it
 *     and found more of the same clause IN A DOCUMENT. Take the document away
 *     and the row is a claim about a page break that is no longer in the run.
 *   - The last surviving capture of any bagian that lost a tail has its
 *     `continuationCheckedFor` CLEARED. That field records "the walk past this
 *     rectangle is finished", and one of the two ways it becomes true is "the
 *     lanjutan it found is already held". Once that lanjutan is gone the
 *     recorded fact is false, and `continuationChecked` would not notice: it
 *     compares the fingerprint against this capture's OWN zone, which has not
 *     changed. Leaving it set would print "diperiksa, tidak ada lanjutan" on a
 *     bagian nothing has looked past since the document it was looking in was
 *     removed.
 *
 * Every key whose EVIDENCE this loses comes back in `removedCaptureKeys`, in
 * the shape `putRun`'s `removing` option takes, because a write that drops a
 * zone-carrying state without naming it is refused by `CaptureLossError` and
 * should be.
 */

import { zoneFingerprint } from "./captures.ts";
import { captureOrdinalOf, slotKeyOf } from "./slot-key.ts";
import type { BrowserRun, SlotState } from "./types.ts";

export type SourceRemoval = {
  /** The run as it should now be stored. Unchanged if `sourceId` is not in it. */
  run: BrowserRun;
  /** `StoredPage.id` of every page that must be deleted alongside the write. */
  removedPageIds: string[];
  /**
   * The `SlotState.key` of every capture this loses evidence from, whether the
   * row went with it or only its zone did. Hand it to `putRun`'s `removing`.
   */
  removedCaptureKeys: string[];
  /** How many captures the operator had already accepted here. For the warning. */
  confirmedLost: number;
};

/**
 * What removing this source would cost, without removing it.
 *
 * The document manager asks before it acts, and it has to ask in numbers: an
 * operator who has spent twenty minutes accepting crops is owed "this takes 4
 * potongan you accepted with it", not a generic confirmation. Same arithmetic
 * as `removeSource`, so the two cannot disagree about what is about to happen.
 */
export function sourceRemovalCost(
  run: BrowserRun,
  sourceId: string,
): { pages: number; captures: number; confirmed: number } {
  const { removedPageIds, removedCaptureKeys, confirmedLost } = removeSource(
    run,
    sourceId,
  );
  return {
    pages: removedPageIds.length,
    captures: removedCaptureKeys.length,
    confirmed: confirmedLost,
  };
}

export function removeSource(
  run: BrowserRun,
  sourceId: string,
): SourceRemoval {
  const empty = {
    run,
    removedPageIds: [],
    removedCaptureKeys: [],
    confirmedLost: 0,
  };
  if (!run.sources.some((source) => source.id === sourceId)) return empty;

  /*
   * THE PAGE MAP IS BUILT ONCE AND EVERY ZONE IS MOVED THROUGH IT.
   *
   * `next[old]` is where the page at position `old` ends up, or -1 if it is
   * one of the ones going. Computing the shift per zone instead ("count the
   * removed pages before me") is the same number and invites the off-by-one
   * that this whole module exists to prevent, so it is done once here where a
   * test can read it.
   */
  const next: number[] = [];
  const removedPageIds: string[] = [];
  const pages: BrowserRun["pages"] = [];
  for (const page of run.pages) {
    if (page.sourceId === sourceId) {
      next.push(-1);
      removedPageIds.push(page.id);
    } else {
      next.push(pages.length);
      pages.push(page);
    }
  }

  const lostEvidence = (slot: SlotState) =>
    slot.zone !== undefined && next[slot.zone.pageIndex] === -1;

  /*
   * WHICH BAGIAN LOSE A TAIL. Collected before the rewrite because the rule is
   * about a slot as a whole ("every capture after the first affected one goes
   * too") and cannot be decided one row at a time in order.
   */
  const cutFrom = new Map<string, number>();
  for (const slot of run.slots) {
    if (!lostEvidence(slot)) continue;
    const key = slotKeyOf(slot.key);
    const ordinal = captureOrdinalOf(slot.key);
    const held = cutFrom.get(key);
    if (held === undefined || ordinal < held) cutFrom.set(key, ordinal);
  }

  const removedCaptureKeys: string[] = [];
  let confirmedLost = 0;
  const slots: SlotState[] = [];

  for (const slot of run.slots) {
    const key = slotKeyOf(slot.key);
    const ordinal = captureOrdinalOf(slot.key);
    const cut = cutFrom.get(key);
    const affected = cut !== undefined && ordinal >= cut;

    if (!affected) {
      /*
       * Untouched by the removal except for where its page now sits -- AND ITS
       * VERDICT MOVES WITH IT.
       *
       * `continuationCheckedFor` holds `zoneFingerprint(zone)`, which is
       * `pageIndex:from-to`, so it is keyed on the exact number being remapped
       * here. Remapping the zone alone leaves a verdict whose subject no
       * longer matches, `continuationChecked` reads that as unchecked, and
       * every capture past the removed document gets re-walked on the next
       * Proses: a narrow model call each, silently, on every removal.
       *
       * Carrying it is also the truthful answer rather than merely the cheap
       * one. The recorded fact is "the walk past this rectangle is finished",
       * and that is a fact about a clause and the page after it. Removing an
       * unrelated earlier document changes neither; only the index moved.
       *
       * Rebuilt through `zoneFingerprint` rather than by editing the string,
       * so the format cannot fork from the one `continuationChecked` compares
       * against.
       */
      if (!slot.zone) {
        slots.push(slot);
        continue;
      }
      const zone = { ...slot.zone, pageIndex: next[slot.zone.pageIndex] };
      slots.push({
        ...slot,
        zone,
        ...(slot.continuationCheckedFor === zoneFingerprint(slot.zone)
          ? { continuationCheckedFor: zoneFingerprint(zone) }
          : {}),
      });
      continue;
    }

    if (slot.zone) {
      removedCaptureKeys.push(slot.key);
      if (slot.status === "confirmed") confirmedLost += 1;
    }

    // A lanjutan goes with the document. Its row is a claim about a page break
    // that is no longer in this run.
    if (ordinal > 1) continue;

    // A WHITELIST, not an omit. `{ zone: _zone, ...rest }` would carry every
    // other field through, which is the wrong default here: a capture with no
    // evidence should hold nothing but its identity and its status, and
    // anything else `SlotState` grows later would arrive attached to a row
    // whose evidence has just been deleted. Listing the three fields that
    // survive means a fourth has to be added deliberately, in a diff somebody
    // reads, rather than inherited by a spread.
    slots.push({
      key: slot.key,
      label: slot.label,
      status: "pending",
    });
  }

  /*
   * THE STAMP ON WHAT SURVIVED. A bagian whose tail was cut has a last
   * surviving capture that may still record "the walk past me is finished",
   * and that was true only while the lanjutan it found was in the run.
   * `continuationChecked` compares the fingerprint against this capture's own
   * zone, which the cut did not touch, so nothing else would ever notice.
   */
  for (const key of cutFrom.keys()) {
    let last = -1;
    for (let i = 0; i < slots.length; i += 1) {
      if (slotKeyOf(slots[i].key) === key) last = i;
    }
    if (last === -1) continue;
    const survivor = { ...slots[last] };
    delete survivor.continuationCheckedFor;
    slots[last] = survivor;
  }

  return {
    run: {
      ...run,
      sources: run.sources.filter((source) => source.id !== sourceId),
      pages,
      slots,
    },
    removedPageIds,
    removedCaptureKeys,
    confirmedLost,
  };
}
