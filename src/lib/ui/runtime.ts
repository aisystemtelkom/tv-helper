/**
 * THE SEAM between the operator UI and the browser runtime, now JOINED.
 *
 * This file used to MIRROR the agreed contract, because the UI track and the
 * runtime track were built concurrently and `src/lib/browser/runtime.ts` did
 * not exist on the UI branch. It exists now, so the mirror is gone and the
 * types below are re-exported from it. That is not tidiness: while the mirror
 * stood, drift between the two declarations was invisible, and every consumer
 * of these types was checked against a copy rather than against the thing it
 * actually receives at runtime. Re-exporting makes `tsc` the referee.
 *
 * DO NOT RE-INTRODUCE A LOCAL COPY OF THESE TYPES. The mirror hid three real
 * mismatches until it was removed (see `slotKeyOf` below, and the note on
 * `Zone.pageIndex`), each of which shipped a document that looked complete.
 */

import type { Line } from "../pipeline/geometry.ts";
import type { Zone } from "../pipeline/locate.ts";

export type { Line, Zone };

/**
 * The contract itself. `src/lib/browser/runtime.ts` is the only definition;
 * everything the UI knows about a run comes from there.
 *
 * Two of these carry a meaning that is NOT guessable from the type, and both
 * have already been a defect in this project:
 *
 *  - `StoredPage.index` is the page's number WITHIN ITS OWN SOURCE DOCUMENT.
 *    `Zone.pageIndex` is a different number: the page's POSITION IN
 *    `BrowserRun.pages`, which is append-only across every document ingested
 *    into the run. They coincide for the first source file and diverge for
 *    every one after it, which is why confusing them is quiet -- the first
 *    document reviews correctly and the second sends a reviewer to the wrong
 *    page. Resolve one to the other with `resolvePage` in `./evidence.ts`;
 *    never index `run.pages` with a `StoredPage.index`.
 *
 *  - `SlotState.key` is NOT always a `SlotDef.key`. Capture 1 is the template
 *    key verbatim; a LANJUTAN -- the rest of one field's evidence, carried
 *    onto the next page by a page break -- is keyed `<slotKey>#2`,
 *    `<slotKey>#3`, because `SlotState.zone` holds one zone and one state per
 *    slot would silently drop the continuation. NOTHING DECLARES HOW MANY
 *    THERE ARE: a run grows them as they are found, so a screen must read the
 *    count off `run.slots` and never off the template. Recover the template
 *    key with `slotKeyOf` and the capture number with `captureOrdinalOf`, both
 *    re-exported below -- never by splitting the string by hand.
 */
export type {
  SlotStatus,
  SlotState,
  StoredPage,
  RunSource,
  BrowserRun,
} from "../browser/runtime.ts";

/**
 * The template key behind a `SlotState.key`.
 *
 * Re-exported rather than reimplemented so there is exactly one definition of
 * how a capture ordinal is separated from its slot key. A second one here
 * would compile, agree on every key that has no ordinal, and disagree the
 * first time the separator changed.
 *
 * Taken from the leaf module rather than from `../browser/runtime.ts` so that
 * the pure logic modules (`./slots.ts`, `./export.ts`) do not drag IndexedDB
 * and the Web Worker client into a plain `node --test` process.
 */
export {
  captureKeyFor,
  captureOrdinalOf,
  nextCaptureOrdinal,
  slotKeyOf,
} from "../browser/slot-key.ts";

/**
 * Appending a discovered lanjutan, and removing a rejected one.
 *
 * From `../browser/captures.ts` rather than from `../browser/runtime.ts` for
 * the same reason as above: `./propose.ts` folds a route's answer into a run
 * and is driven by `node --test`, which has no IndexedDB and no Web Worker.
 */
export {
  withDiscoveredCaptures,
  withoutCapture,
  withoutCapturesAfter,
  type DiscoveredCapture,
} from "../browser/captures.ts";

import type { BrowserRun, SlotState } from "../browser/runtime.ts";
import type { PutRunOptions } from "../storage/runs.ts";

export type { PutRunOptions };

export type RunSummary = { id: string; createdAt: number; label: string };

/**
 * The contract's free functions, gathered into one object.
 *
 * The runtime declares them as module-level exports; the UI takes them as a
 * VALUE so a screen can be driven by a fake without mocking a module, and so
 * the live/stub choice is made in one place instead of by whichever module
 * happened to import first. `src/lib/ui/live-runtime.ts` is that one place in
 * production; `import * as runtime` satisfies this type as-is, which is what
 * makes `tsc` check the real module against the shape the UI consumes.
 */
export type Runtime = {
  outstandingSlots(run: BrowserRun): SlotState[];
  listRuns(): Promise<RunSummary[]>;
  loadRun(id: string): Promise<BrowserRun | null>;
  /**
   * Returns the STORED run, whose `rev` has advanced. The caller must keep it
   * and save from that next time: a revision counter the caller never advances
   * is worse than none, because the second save of any run is then always
   * behind and is refused. That refusal is deliberate -- `saveRun` replaces a
   * run wholesale, so a stale write silently deletes every page an in-flight
   * ingest added.
   *
   * `options.removing` names slot-state keys this write deliberately drops. A
   * write that loses a zone-carrying capture without naming it is refused
   * (`CaptureLossError`), because a discovered lanjutan lives nowhere but the
   * stored slot list.
   */
  saveRun(run: BrowserRun, options?: PutRunOptions): Promise<BrowserRun>;
  /**
   * Renders + OCRs every page of `file` in a Web Worker and appends them to
   * the run. `onProgress` reports page-level progress so the UI can show a bar.
   */
  ingestDocument(
    runId: string,
    file: File,
    onProgress?: (done: number, total: number) => void,
  ): Promise<BrowserRun>;
  /**
   * Takes one source document back out of an open order, and it is not the
   * inverse of `ingestDocument` however much it looks like one.
   *
   * `Zone.pageIndex` is a POSITION IN `run.pages`, so removing a document's
   * pages repoints every zone found in a LATER document unless something moves
   * them. `removeSource` does, and this is the storage call around it. Never
   * write a shorter `pages` array through `saveRun` instead: `PageLossError`
   * refuses it, which is the correct outcome and not one to route around.
   */
  removeDocument(runId: string, sourceId: string): Promise<BrowserRun>;
  /**
   * What removing that document would cost, without removing it: pages,
   * captures, and how many of those captures the operator has already
   * accepted. Pure, so a screen may call it while rendering.
   */
  sourceRemovalCost(
    run: BrowserRun,
    sourceId: string,
  ): { pages: number; captures: number; confirmed: number };
  /**
   * A page bitmap for display and for cropping, rendered on demand at
   * `DEFAULT_DPI` so a `Zone.box` maps to bitmap pixels ONE TO ONE.
   *
   * Scale for display in CSS only. Re-rendering at another DPI would draw
   * correctly and put every rectangle in the wrong place, including one the
   * operator drew by hand, which would then be saved back wrong.
   *
   * THE CALLER MUST `close()` THE BITMAP. One 300 DPI A4 page is ~35MB.
   */
  pageBitmap(runId: string, pageId: string): Promise<ImageBitmap>;
};
