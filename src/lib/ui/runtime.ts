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

import type { StoredOrder } from "../browser/intake.ts";
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
 *
 *  - `BrowserRun.overlay` is THIS ORDER'S DIFF against `AO_TEMPLATE`, and it is
 *    required rather than optional so that a reader cannot forget it exists. A
 *    screen must render `resolveTemplate(AO_TEMPLATE, run.overlay)` and never
 *    `AO_TEMPLATE` directly, or it prints the packet under names the operator
 *    replaced.
 */
export type {
  SlotStatus,
  SlotState,
  StoredPage,
  PageShortfall,
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

/**
 * WHETHER THIS ORDER ALREADY HOLDS A BERKAS, and what to say when it does.
 *
 * From the leaf module rather than from `../browser/runtime.ts` for the same
 * reason `slot-key.ts` and `captures.ts` are: the ingest screen screens a
 * hand-over as it happens, `node --test` drives that logic, and neither should
 * drag IndexedDB and the Web Worker client in behind it. The runtime re-exports
 * the same names, so the two cannot fork.
 */
export {
  DuplicateDocumentError,
  documentDigest,
  fileDigest,
  heldDocuments,
  findInOtherOrders,
  screenDigested,
  screenDocuments,
  type AcceptedDocument,
  type HeldDocument,
  type OrderMatch,
  type RefusedDocument,
  type StoredOrder,
  type UsedElsewhere,
  type Screening,
} from "../browser/intake.ts";

/**
 * ONE OPERATOR GESTURE ON THIS ORDER'S FORM, as a value.
 *
 * Type-only here, and from the leaf module rather than from
 * `../browser/runtime.ts`, so a screen can name the edit it is about to make
 * without pulling IndexedDB and the Web Worker client into a `node --test`
 * process. The engine that applies it (`applySectionEdit`) is imported from
 * `../browser/sections.ts` by whatever actually needs to run it.
 */
export type { SectionEdit } from "../browser/sections.ts";

/**
 * ONE OPERATOR GESTURE AT KONFIG EXCEL OR INPUT EPIC, as a value.
 *
 * Type-only and from the leaf module, exactly as `SectionEdit` above is and for
 * the same reason: a screen names the edit it is about to make without pulling
 * IndexedDB and the Web Worker client into a `node --test` process.
 *
 * `configEntryId` and `epicEntryId` are VALUES and come from the storage layer,
 * because they are the identity the `DecisionLossError` guard itself uses. A
 * screen that addressed a row by any other spelling would compose a decision
 * the guard could not recognise, and the opt-in protecting it could never name
 * it.
 */
export type { ConfigEdit, EpicEdit } from "../browser/config.ts";
export {
  CONFIG_RESEARCHED_ID,
  EPIC_BASIS_ID,
  configEntryId,
  epicEntryId,
} from "../storage/runs.ts";

import type { BrowserRun, SlotState } from "../browser/runtime.ts";
import type { ConfigEdit, EpicEdit } from "../browser/config.ts";
import type { SectionEdit } from "../browser/sections.ts";
import type { PutRunOptions } from "../storage/runs.ts";

export type { PutRunOptions };

/**
 * An order in the device's list: its name, when it was made, and the content
 * digest of every berkas it holds. The digests are what let a hand-over tell
 * the operator a file was already used in another order. It IS `StoredOrder`,
 * named here for what the list is used as.
 */
export type RunSummary = StoredOrder;

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
   *
   * `options.removingSections` is its twin one level up, and it is a SECOND
   * opt-in rather than the same one widened: it names overlay node ids whose
   * stored name or existence this write drops, and a write that reverts a
   * heading the operator renamed without naming it is refused
   * (`SectionLossError`). `removing` is about a potongan, this is about a
   * name; a single option would let a caller discard a crop while meaning to
   * discard a heading.
   */
  saveRun(run: BrowserRun, options?: PutRunOptions): Promise<BrowserRun>;
  /**
   * One edit to this order's own form, applied to what is STORED.
   *
   * IT TAKES AN EDIT AND NOT A RUN, and a screen must not route around it with
   * `saveRun({ ...run, overlay: next })`. `ingestDocument` holds the run lock
   * for minutes over a long document and advances the revision once per page,
   * so a run React is holding while that runs is many revisions stale and the
   * write is refused -- the operator would be told the order changed underneath
   * them for renaming a heading, and lose the rename. An edit carries no
   * revision, so it is applied to the current record instead of being compared
   * against it.
   *
   * It also computes both of `putRun`'s opt-ins itself. Removing a judul drops
   * every capture under it and discards the operator's naming work, and a
   * screen assembling that write by hand would have to know about
   * `CaptureLossError` and `SectionLossError` to get it past storage.
   *
   * Returns the STORED run, revision advanced. The caller must keep it.
   */
  editSections(runId: string, edit: SectionEdit): Promise<BrowserRun>;
  /**
   * One edit to this order's KONFIG EXCEL state: the workbook it was handed,
   * what the scans said about each isian, and what the operator ruled.
   *
   * IT TAKES AN EDIT AND NOT A RUN, on `editSections`' argument exactly. A
   * screen holds a `BrowserRun` for as long as the operator is looking at it,
   * an ingest advances the revision once per page across minutes, and
   * Konfig Excel is a screen of amber rows the operator works down while the
   * tool is still busy -- so `saveRun({ ...run, konfigurasi: next })` is
   * refused as stale on the ordinary path, not on a corner case.
   *
   * It computes `putRun`'s `removingDecisions` itself, by calling the same
   * `discardedDecisions` the storage guard runs. Replacing a workbook
   * legitimately discards every ruling made about the old one, and a screen
   * assembling that write by hand would have to know about `DecisionLossError`
   * to get it past storage.
   *
   * Returns the STORED run, revision advanced. The caller must keep it.
   */
  editConfig(runId: string, edit: ConfigEdit): Promise<BrowserRun>;
  /** The same, one checkpoint up: the EPIC basis, its captures, its findings. */
  editEpic(runId: string, edit: EpicEdit): Promise<BrowserRun>;
  /**
   * The bytes of the operator's workbook, or of one tangkapan layar EPIC.
   *
   * They go in the SAME blob store the PDFs do, under their own id with this
   * run's id alongside, so `deleteRun` sweeps them with the order and there is
   * no second cleanup path to forget. They are NOT added to
   * `BrowserRun.sources`: a workbook is not a berkas of the order, nothing
   * renders or crops it, and listing it there would put it on the film strip
   * and into `Zone.pageIndex`'s arithmetic.
   */
  putCheckpointFile(
    runId: string,
    id: string,
    name: string,
    bytes: ArrayBuffer,
  ): Promise<void>;
  /** Those bytes back, for the download. Null when they are gone. */
  getCheckpointFile(
    id: string,
  ): Promise<{ name: string; bytes: ArrayBuffer } | null>;
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
   * WHETHER THE AI MAY PROPOSE ANYTHING OUT OF ONE BERKAS.
   *
   * IT IS NOT "READ THIS BERKAS" AND IT NEVER RE-READS ONE. Every berkas is
   * rendered and OCR'd whatever this says -- that is what keeps the denah, the
   * film strip, snapping and line citations working on a fenced document -- so
   * this writes one boolean and touches no page. The screens must not print it
   * as "dilewati" or "gagal": the berkas was read, the model simply is not
   * asked about it.
   *
   * Takes ids and not a run, exactly as `editSections` does and for the same
   * reason: the runtime re-reads inside its own lock, so a press made during a
   * long ingest is queued rather than refused. Returns the STORED run, revision
   * advanced. The caller must keep it.
   */
  setDocumentAi(
    runId: string,
    sourceId: string,
    ai: boolean,
  ): Promise<BrowserRun>;
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
