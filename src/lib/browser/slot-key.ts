/**
 * How a multi-capture slot's ordinal is separated from its template key.
 *
 * ITS OWN MODULE, and a pure leaf with no imports, for one reason: this rule
 * is needed on BOTH sides of the app. `src/lib/browser/runtime.ts` seeds the
 * keys in the browser and carries `"use client"`, so a server route that
 * imported `slotKeyOf` from there would get a client reference rather than a
 * function. `/api/propose` needs the same rule to map a capture key back to
 * the template slot it belongs to, and two copies of a separator convention
 * are two things that can disagree -- silently, since they agree on every key
 * that has no ordinal.
 *
 * `runtime.ts` re-exports `slotKeyOf`, so browser callers keep importing it
 * from the runtime and nothing else changes.
 */

/**
 * Separates a capture's ordinal from its template key. See `SlotState.key`:
 * one field's evidence can run past the bottom of a page and continue on the
 * next one, and one `SlotState` per slot would silently ship one half of it.
 */
export const CAPTURE_SEPARATOR = "#";

/**
 * The template key behind a `SlotState.key`, ordinal suffix removed.
 *
 * `lastIndexOf`, so a template key that itself contained the separator would
 * still lose only the ordinal. Keys without an ordinal come back unchanged,
 * which is what lets every caller run this over every key unconditionally.
 */
export function slotKeyOf(slotStateKey: string): string {
  const cut = slotStateKey.lastIndexOf(CAPTURE_SEPARATOR);
  return cut === -1 ? slotStateKey : slotStateKey.slice(0, cut);
}

/**
 * WHICH CAPTURE OF ITS SLOT THIS KEY IS. The first capture is 1.
 *
 * A bare template key IS capture 1, so `seedSlots` keys the one state it seeds
 * per slot with the template key verbatim and nothing about a single-capture
 * run changes. A lanjutan carries `#2`, `#3`, and so on.
 *
 * THE ORDINAL IS THE ONLY THING STORED ABOUT A CAPTURE'S IDENTITY, and it is
 * deliberately not its position in `run.slots`. `captureLabel` renders it
 * ("ToP (lanjutan 2)") and the docx exporter stacks pictures in it, so an
 * ordinal that shifted when an earlier capture was removed would RELABEL a
 * capture a human had already accepted. Positions shift; ordinals do not.
 *
 * A suffix that is not a positive integer is not an ordinal -- it is part of a
 * key that happens to contain a `#` -- and reads as capture 1. That disagrees
 * with `slotKeyOf`, which strips any suffix, and the disagreement is the safe
 * direction: such a key groups under a template slot it does not belong to
 * and is reported as an orphan rather than being silently treated as a
 * continuation of something.
 */
export function captureOrdinalOf(slotStateKey: string): number {
  const cut = slotStateKey.lastIndexOf(CAPTURE_SEPARATOR);
  if (cut === -1) return 1;
  const suffix = slotStateKey.slice(cut + 1);
  if (!/^[0-9]+$/.test(suffix)) return 1;
  const ordinal = Number(suffix);
  return ordinal >= 1 ? ordinal : 1;
}

/** The `SlotState.key` for one capture of `slotKey`. Capture 1 is bare. */
export function captureKeyFor(slotKey: string, ordinal: number): string {
  return ordinal <= 1 ? slotKey : `${slotKey}${CAPTURE_SEPARATOR}${ordinal}`;
}

/**
 * The ordinal a NEWLY DISCOVERED capture of `slotKey` takes.
 *
 * A HIGH-WATER MARK OVER EVERY KEY THE RUN CARRIES, never `states.length + 1`.
 * The two agree until a capture is removed, and after that the length rule
 * hands the next discovery an ordinal that is already spoken for: two captures
 * called "(lanjutan)", one overwriting the other in the export's picture
 * order. Counting from the highest ordinal the key has ever held means an
 * ordinal is never reused, which is what `captureOrdinalOf` promises.
 *
 * Reading the mark off the surviving keys is only correct because removal
 * takes the tail (see `withoutCapture` in `runtime.ts`): rejecting a lanjutan
 * drops it and every later one, so the highest surviving ordinal really is the
 * highest ever ISSUED for a slot the operator is still working on.
 */
export function nextCaptureOrdinal(
  keys: Iterable<string>,
  slotKey: string,
): number {
  let highest = 0;
  for (const key of keys) {
    if (slotKeyOf(key) !== slotKey) continue;
    highest = Math.max(highest, captureOrdinalOf(key));
  }
  // 2, never 1, for a slot with no state at all: capture 1 is what `seedSlots`
  // makes, and a DISCOVERED capture is by definition a continuation of one.
  return Math.max(2, highest + 1);
}
