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
 * Separates a multi-capture slot's ordinal from its template key. See
 * `SlotState.key`: the sample's ToP row holds two pictures cut from two
 * different pages, and one `SlotState` per slot would silently ship one of
 * them.
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
