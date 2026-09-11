"use client";

/**
 * The browser runtime: the pipeline `pnpm generate` runs headlessly in Node,
 * run instead inside the operator's own browser, with every run persisted on
 * the device.
 *
 * This is the whole public surface. Everything under `src/lib/browser/` other
 * than this file is an implementation detail, and `src/lib/storage/runs.ts`
 * is the IndexedDB layer under it.
 *
 * Five invariants hold this together. Each of them exists because breaking
 * it produces a run that still opens, still looks complete, and carries the
 * wrong evidence:
 *
 *  1. `BrowserRun.pages` is APPEND-ONLY. A zone's `pageIndex` is a position
 *     in it, so ingesting a dokumen tambahan adds to the end and never
 *     reorders or removes. Enforced, not just intended: a write that does not
 *     carry every stored page is refused with `PageLossError`.
 *  1b. A WRITE THAT IS BEHIND IS REFUSED, not applied. Every run carries a
 *     `rev` stamped by storage; `saveRun` and each page of an ingest check it
 *     inside their own transaction and throw `StaleRunWriteError` on a
 *     mismatch. Without it, saving a `BrowserRun` captured before an ingest
 *     deleted every page that ingest had written and resolved successfully.
 *     Callers must keep what `saveRun` returns -- the object they passed in
 *     is one revision behind as soon as it resolves.
 *  1c. `slots` IS NOT DERIVABLE FROM THE TEMPLATE ANY MORE. A lanjutan is
 *     discovered, not declared, so a discovered capture exists only in the
 *     stored list. A write that drops one carrying a zone without naming it is
 *     refused with `CaptureLossError` -- otherwise a routine
 *     rebuild-from-template save deletes a crop the operator accepted, at the
 *     correct revision, with every page present, and reports success.
 *  1d. NOR IS `overlay`, and it never was. It is the only place a heading the
 *     operator renamed or a judul they added exists, and the same
 *     rebuild-from-template save reverts every one of them just as quietly.
 *     A write that drops one without naming it in `removingSections` is
 *     refused with `SectionLossError`.
 *  1e. NOR ARE `konfigurasi` AND `epic`. They hold what the operator RULED at
 *     Konfig Excel and Input EPIC -- a recommendation taken or refused, a
 *     value they typed, the one re-search this order is allowed -- and nothing
 *     anywhere re-derives a judgement. The same rebuild-from-template save
 *     reverts every one of them just as quietly, and a lost `setuju` is a cell
 *     that silently stays wrong in a workbook the operator hands back to EPIC.
 *     A write that drops one without naming it in `removingDecisions` is
 *     refused with `DecisionLossError`.
 *  2. INGESTING IS ADDITIVE. A later document can only add pages and fill
 *     slots; it never touches a zone an operator already confirmed. That is
 *     the foundation of the dokumen tambahan loop (2026-08-31 corrections,
 *     section 4).
 *  3. NO RENDERED PAGE IS KEPT. An upright 300 DPI page is 2480x3507, about
 *     35MB as RGBA, and a bundle is 29 of them. What is stored is OCR lines;
 *     pixels are produced on demand by `pageBitmap` and are the caller's to
 *     release.
 *
 * What this module does NOT do: it never asks the model anything. Slots are
 * seeded `"pending"` and stay there until something else -- a server route,
 * since `src/lib/model.ts` is the only file that may know how the model is
 * reached -- proposes a zone and writes the run back through `saveRun`.
 */

import { emptyConfigCheck, emptyEpicCheck } from "../config/types.ts";
import { emptyOverlay } from "../forms/overlay.ts";
import { AO_TEMPLATE, type Template } from "../forms/template.ts";
import {
  appendPage,
  getPage,
  getRun,
  getSource,
  listRunMeta,
  putRun,
  putSource,
  deleteSource,
  deleteRun as deleteRunRecords,
  type PutRunOptions,
  type RunMeta,
} from "../storage/runs.ts";
import {
  applyConfigEdit,
  applyEpicEdit,
  checkpointFileIds,
  type ConfigEdit,
  type EpicEdit,
} from "./config.ts";
import {
  DuplicateDocumentError,
  documentDigest,
  heldDocuments,
  type StoredOrder,
} from "./intake.ts";
import { applySectionEdit, type SectionEdit } from "./sections.ts";
import { removeSource, withSourceAi } from "./sources.ts";
import { ingestSource, renderPageBitmap } from "./worker-client.ts";
import type {
  BrowserRun,
  RunSource,
  SlotState,
  StoredPage,
} from "./types.ts";

export type {
  BrowserRun,
  PageShortfall,
  RunSource,
  SlotState,
  SlotStatus,
  StoredPage,
} from "./types.ts";

/**
 * The five ways a write is refused, re-exported because they are part of this
 * surface: a UI that treats them as generic failures tells the operator
 * nothing useful, and the one useful thing to say ("this run changed
 * underneath you, reload") is only sayable if the type is reachable.
 */
export {
  CaptureLossError,
  DecisionLossError,
  PageLossError,
  SectionLossError,
  StaleRunWriteError,
} from "../storage/runs.ts";
export type { PutRunOptions } from "../storage/runs.ts";

/**
 * THE FOURTH REFUSAL, and it is a refusal for the same reason the other three
 * are: what it prevents does not look like a failure.
 *
 * A run holding one document twice has twice the pages, offers the model two
 * identical candidates for every bagian, and turns a crop the operator
 * accepted into a picture of a different scan the moment the copy is removed.
 * See `src/lib/browser/intake.ts` for why identity is the bytes rather than
 * the berkas name, and for the screening a UI does before it ever gets here.
 */
export {
  DuplicateDocumentError,
  documentDigest,
  fileDigest,
  findInOtherOrders,
  heldDocuments,
  screenDigested,
  screenDocuments,
  type AcceptedDocument,
  type HeldDocument,
  type OrderMatch,
  type RefusedDocument,
  type Screening,
  type StoredOrder,
  type UsedElsewhere,
} from "./intake.ts";

/**
 * How a capture's ordinal is separated from its template key, and how the two
 * are read back apart. See `SlotState.key`.
 *
 * These live in a pure leaf module so `/api/propose` can apply the SAME rule
 * server-side: this file carries `"use client"`, and a server route importing
 * from it would receive a client reference instead of a function. Re-exported
 * here so browser callers keep importing them from the runtime.
 */
export {
  CAPTURE_SEPARATOR,
  captureKeyFor,
  captureOrdinalOf,
  nextCaptureOrdinal,
  slotKeyOf,
} from "./slot-key.ts";

/**
 * Appending a discovered lanjutan, and removing one the operator rejected.
 *
 * In their own pure module for the same reason `slot-key.ts` is: they are
 * needed where IndexedDB is not. `src/lib/ui/propose.ts` folds a route's
 * answer into a run and is driven by `node --test`, and this file carries
 * `"use client"` and pulls in the storage layer and the worker client.
 */
export {
  withDiscoveredCaptures,
  withoutCapture,
  withoutCapturesAfter,
  type DiscoveredCapture,
} from "./captures.ts";

/**
 * What removing a source document costs, without removing it.
 *
 * Pure, and re-exported here so the document manager can price the question
 * before it asks it. The removal itself is `removeDocument` below, which is
 * this arithmetic plus two storage writes.
 */
export {
  aiExcludedSources,
  sourceRemovalCost,
  type SourceRemoval,
} from "./sources.ts";

/**
 * One operator gesture on this order's form, as a VALUE.
 *
 * Pure, and re-exported for the reason `captures.ts` and `sources.ts` are: the
 * arithmetic is testable where IndexedDB is not, and `editSections` below is
 * the two storage calls around it. A screen composes a `SectionEdit` and hands
 * it over; it never composes a run.
 */
export {
  applySectionEdit,
  type MintId,
  type SectionEdit,
  type SectionEditResult,
} from "./sections.ts";

/**
 * One operator gesture at Konfig Excel or Input EPIC, as a VALUE.
 *
 * Pure, and re-exported for the reason `sections.ts` is: the arithmetic is
 * testable where IndexedDB is not, and `editConfig`/`editEpic` below are the two
 * storage calls around it. A screen composes a `ConfigEdit`; it never composes
 * a run.
 *
 * `configEntryId` and `epicEntryId` come from the STORAGE layer rather than
 * being restated here, because they are the identity `discardedDecisions`
 * itself uses to decide whether a write drops a ruling. One spelling, in one
 * place, is what stops a screen addressing a row by a name the guard would not
 * recognise.
 */
export {
  ConfigEditError,
  applyConfigEdit,
  applyEpicEdit,
  checkpointFileIds,
  type ConfigEdit,
  type ConfigEditResult,
  type EpicEdit,
} from "./config.ts";
export {
  CONFIG_RESEARCHED_ID,
  EPIC_BASIS_ID,
  configEntryId,
  epicEntryId,
} from "../storage/runs.ts";

/**
 * EXACTLY ONE `SlotState` PER FILLABLE SLOT, all `"pending"`.
 *
 * ONE, NOT A DECLARED COUNT, and the change is the whole point of this
 * feature. `SlotDef.crops` used to say that the `KB (lanjutan)` ToP row holds
 * two pictures, and this function seeded two states up front. An operator
 * testing the tool found what that produces: the sheet showed "ToP 1" and "ToP
 * 2" with the second permanently missing, and they said -- correctly -- that
 * the document holds only ONE ToP. The sample's two pictures are one payment
 * clause split by a page break, which is a fact about that contract's page
 * breaks and not about the form. The sheet was asserting a capture existed
 * before anyone had looked for it, and nothing ever searched for it, so it
 * reported "1 of 2" for ever by construction.
 *
 * A continuation is now APPENDED when one is found (`withDiscoveredCaptures`),
 * for any slot, with nothing declared anywhere. That is what makes "there can
 * be more than 1 lanjutan" and "any section could be more than a page" the
 * same code path.
 *
 * Non-fillable slots are left out. The form ships `Konfigurasi (Excel dari
 * EPIC)` and `Konfigurasi` as deliberately empty judul that the operator
 * completes from EPIC by hand; putting their bagian in the work list would ask
 * the operator to hunt for evidence that is known not to be in the bundle.
 * `scripts/generate.mjs` skips them on the same test.
 */
export function seedSlots(template: Template = AO_TEMPLATE): SlotState[] {
  const slots: SlotState[] = [];

  for (const section of template.sections) {
    for (const slot of section.slots) {
      if (!slot.fillable) continue;
      // The template key VERBATIM: capture 1 wears no ordinal, so a run that
      // never grows a lanjutan carries exactly the keys it always did.
      slots.push({ key: slot.key, label: slot.label, status: "pending" });
    }
  }

  return slots;
}

/**
 * The slots that were searched and not found: the list the operator is asked
 * "is there a dokumen tambahan for these?" about.
 *
 * `"pending"` is deliberately excluded. A slot nobody has looked for yet is
 * not evidence that is missing, and offering it as one would ask the operator
 * to supply documents for work that has not been done -- and, at the end of a
 * run, would let an unsearched slot ship as a considered blank.
 */
export function outstandingSlots(run: BrowserRun): SlotState[] {
  return run.slots.filter((slot) => slot.status === "outstanding");
}

/**
 * One freshly OCR'd page folded into a run.
 *
 * Exported because this is where "additive" is actually implemented, and an
 * invariant that only exists inside a function that needs IndexedDB, a Web
 * Worker and a real PDF to reach is an invariant nothing checks. Everything
 * it must not do is testable here in isolation:
 *
 *  - it APPENDS. Earlier pages keep their positions, so `Zone.pageIndex`
 *    keeps meaning what it meant.
 *  - it does not touch `slots`. A dokumen tambahan cannot cost the operator a
 *    zone they already confirmed.
 *  - it does not touch other sources, and records `pageCount` on this one
 *    from the document's own length rather than from how far the ingest has
 *    got, so an interrupted run says how long the document is.
 */
export function withAppendedPage(
  run: BrowserRun,
  page: StoredPage,
  sourcePageCount: number,
): BrowserRun {
  return {
    ...run,
    sources: run.sources.map((source) =>
      source.id === page.sourceId
        ? { ...source, pageCount: sourcePageCount }
        : source,
    ),
    pages: [...run.pages, page],
  };
}

function newRun(id: string): BrowserRun {
  return {
    id,
    createdAt: Date.now(),
    // Revision 0 is "not stored yet", which is the only revision that is
    // allowed to create a run. If one already exists under this id, writing
    // this is refused rather than allowed to flatten it.
    rev: 0,
    sources: [],
    pages: [],
    slots: seedSlots(),
    // EMPTY, NEVER ABSENT. `resolveTemplate` returns the base BY IDENTITY for
    // an empty overlay, so a run nobody has renamed anything on behaves and
    // renders exactly as it did before overlays existed -- while every reader
    // is spared a `?.` that would eventually be forgotten somewhere it mattered.
    overlay: emptyOverlay(AO_TEMPLATE),
    // EMPTY, NEVER ABSENT, on the same rule. An order that has not reached
    // Konfig Excel has no workbook and no rulings, and that is a real state
    // rather than a missing one -- so it is a value every reader can walk,
    // never a key they have to remember might not be there.
    konfigurasi: emptyConfigCheck(),
    epic: emptyEpicCheck(),
  };
}

/**
 * A run's small half, listed field by field so tsc names anything new.
 *
 * THE FIELD-BY-FIELD LIST IS THE MECHANISM, not a style. A rest-spread here
 * would carry whatever `BrowserRun` happens to hold, which reads as
 * future-proof and is the opposite: the day a field is added, nothing fails,
 * and the way this project finds out is a device that quietly stopped storing
 * something. `overlay` is here because the type made it impossible not to
 * notice, which is exactly why it is required rather than optional.
 *
 * `konfigurasi` and `epic` are here for the same reason and arrived the same
 * way: both were declared required on `BrowserRun`, and this function stopped
 * compiling until they were listed. That is the mechanism working, not a
 * coincidence. Both belong in the SMALL half -- `listRunMeta` reads it for
 * every run on the device -- so nothing page-scale may be added to either; see
 * the note on `BrowserRun.epic` for the one field that can grow and where its
 * bytes actually live.
 */
function metaOf(run: BrowserRun): RunMeta {
  return {
    id: run.id,
    createdAt: run.createdAt,
    rev: run.rev,
    sources: run.sources,
    slots: run.slots,
    overlay: run.overlay,
    konfigurasi: run.konfigurasi,
    epic: run.epic,
  };
}

/**
 * The label a run wears in the operator's list of saved work.
 *
 * Bahasa Indonesia, because this string is read by an operator rather than by
 * a developer: it is the only text on a row they choose between. Everything
 * else in this module stays English, as code does.
 */
function labelFor(sources: RunSource[]): string {
  if (sources.length === 0) return "(belum ada dokumen)";
  const [first, ...rest] = sources;
  return rest.length === 0
    ? first.name
    : `${first.name} +${rest.length} berkas lagi`;
}

/**
 * Serialises this tab's writes per run.
 *
 * Ordering only. Two writes that overlap would otherwise interleave their
 * IndexedDB transactions, and an ingest writes after every page for minutes
 * on end, which is exactly when a UI is most likely to save a slot edit as
 * well.
 *
 * WHAT IT CANNOT DO, and what does it instead. A lock cannot help a caller
 * that saves a `BrowserRun` it captured before an ingest started: that object
 * genuinely does not have the new pages, so serialising it merely decides
 * when the loss happens. Nor does this lock exist in a second tab. The
 * revision check in `putRun`/`appendPage` covers both -- it runs inside the
 * write's own transaction, so a stale save is REFUSED rather than ordered --
 * and this lock is now only about keeping this tab's own writes tidy.
 */
const locks = new Map<string, Promise<unknown>>();

function withRunLock<T>(runId: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(runId);
  const result = previous ? previous.then(action, action) : action();
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  locks.set(runId, tail);
  void tail.then(() => {
    if (locks.get(runId) === tail) locks.delete(runId);
  });
  return result;
}

/**
 * Every order on this device, as the riwayat lists it and as a hand-over is
 * checked against.
 *
 * `documents` RIDES ALONG BECAUSE IT WAS ALREADY IN HAND. `listRunMeta` reads
 * each order's sources, digests included, to build the label, and this used to
 * throw the digests away. A hand-over asking "has another order used this
 * file?" needs exactly them, and a second listing would read every order on
 * the device again to answer a question the first read already had the data
 * for. See `findInOtherOrders` in `./intake.ts`.
 */
export async function listRuns(): Promise<StoredOrder[]> {
  const meta = await listRunMeta();
  return meta.map((run) => ({
    id: run.id,
    createdAt: run.createdAt,
    label: labelFor(run.sources),
    documents: heldDocuments(run.sources),
  }));
}

/**
 * Takes one source document back out of an open order.
 *
 * THE INVERSE OF `ingestDocument`, and it is not symmetrical with it, because
 * ingesting appends to the end of a list other things index into and removing
 * takes something out of the middle. `removeSource` in `./sources.ts` does the
 * arithmetic (renumber the surviving pages, move every surviving zone with
 * them, drop the evidence that lived inside the removed document rather than
 * repointing it at a different scan); this function is the two writes.
 *
 * THE RUN IS RE-READ INSIDE THE LOCK rather than taken as an argument. A
 * screen holds a `BrowserRun` in React state for as long as the operator is
 * looking at it, and this is a destructive whole-array write: doing it against
 * a copy captured before, say, an ingest finished would be refused by the
 * revision check, which is correct but is a failure the operator would have to
 * understand. Reading here means the removal is computed against what is
 * actually stored, so it either applies or the run is gone.
 *
 * ORDER MATTERS BETWEEN THE TWO WRITES. The run write goes first and the PDF
 * bytes second: the bytes are re-renderable input, so a failure after the run
 * write leaves a few megabytes nothing references. The reverse leaves a run
 * pointing at pages whose source is gone, and `pageBitmap` can no longer
 * re-render a page the operator is looking at.
 */
export async function removeDocument(
  runId: string,
  sourceId: string,
): Promise<BrowserRun> {
  return withRunLock(runId, async () => {
    const stored = await getRun(runId);
    if (!stored) {
      throw new Error(
        `Order ${runId} tidak ada lagi, jadi dokumennya tidak bisa dihapus.`,
      );
    }

    const { run, removedPageIds, removedCaptureKeys } = removeSource(
      stored,
      sourceId,
    );
    // Not in this run. Returning what is stored is the honest answer: two tabs
    // removing the same document should not make the second one an error.
    if (removedPageIds.length === 0 && run === stored) return stored;

    const saved = await putRun(run, {
      removing: removedCaptureKeys,
      removingPages: removedPageIds,
    });
    await deleteSource(sourceId);
    return saved;
  });
}

/**
 * One edit to this order's own form: a heading renamed, a judul moved, removed,
 * restored, added, or a usulan ruled on.
 *
 * ## IT TAKES AN EDIT, NOT A RUN, AND THAT IS THE WHOLE DESIGN
 *
 * The natural API is for the screen to build `{ ...run, overlay: next }` and
 * call `saveRun`. It fails in the one situation the operator is most likely to
 * be in. `ingestDocument` holds the run lock for MINUTES over a 151-page
 * document and advances the revision once per page, so a `BrowserRun` React is
 * holding while that runs is dozens of revisions stale -- and `putRun` refuses
 * it with `StaleRunWriteError`. The operator would be told the order changed
 * underneath them for renaming a heading while a document was being read, and
 * the rename would be lost.
 *
 * A `SectionEdit` carries no revision. It is applied to whatever is STORED at
 * the moment the lock is taken, which turns a refused write into a QUEUED one.
 * That is also why the run is re-read here rather than accepted as an argument,
 * exactly as `removeDocument` re-reads for its own (different) reason.
 *
 * ## THE CALLER MUST KEEP WHAT COMES BACK
 *
 * It is the stored run, revision advanced. The object the screen was holding is
 * one revision behind the moment this resolves, and saving that one throws:
 *
 *     setRun(await editSections(run.id, { tag: "rename-section", id, title }));
 *
 * The two opt-ins `putRun` needs are computed by `applySectionEdit` and passed
 * straight through, never invented here. A judul removal drops the states under
 * it (`removing`) and discards the operator's own naming work (`removingSections`),
 * and both refusals exist precisely so that a write which loses something has
 * to say what.
 */
export async function editSections(
  runId: string,
  edit: SectionEdit,
): Promise<BrowserRun> {
  return withRunLock(runId, async () => {
    const stored = await getRun(runId);
    if (!stored) {
      throw new Error(
        `Order ${runId} tidak ada lagi, jadi judulnya tidak bisa diubah.`,
      );
    }

    const { run, removing, removingSections } = applySectionEdit(stored, edit);
    // Identity means the edit asked for something the order already is -- a
    // judul moved past the end of the packet, a removal of something already
    // removed. Writing anyway would advance the revision and refuse whatever
    // the screen is holding, which is a real cost for a press that did nothing.
    if (run === stored) return stored;

    return putRun(run, { removing, removingSections });
  });
}

/**
 * The two checkpoint edits, which are `editSections` wearing different words.
 *
 * ## RE-READ INSIDE THE LOCK, FOR THE REASON `editSections` GIVES
 *
 * `ingestDocument` holds the run lock for MINUTES over a 151-page document and
 * advances the revision once per page, so a `BrowserRun` React is holding while
 * that runs is dozens of revisions stale and `putRun` refuses it. Konfig Excel
 * is a screen of amber rows the operator works down while the tool is still
 * busy, so this is not a corner case here -- it is the ordinary path. An edit
 * carries no revision and is applied to whatever is STORED at the moment the
 * lock is taken, which turns a refused write into a QUEUED one.
 *
 * ## THE OPT-IN IS COMPUTED BY THE EDIT, NEVER INVENTED HERE
 *
 * `applyConfigEdit` / `applyEpicEdit` derive `removingDecisions` by calling
 * `discardedDecisions`, which is the very function `putRun` runs to decide
 * whether to refuse the write. A screen assembling that list by hand would have
 * to know about `DecisionLossError` to get an ordinary workbook replacement
 * past storage.
 *
 * ## THE BYTES ARE SWEPT AFTER THE RUN WRITE, NOT BEFORE IT
 *
 * A replaced workbook, or a capture the operator removed, leaves bytes in the
 * `sources` blob store that nothing references any more. They go in a second
 * write, ordered AFTER the run write for exactly the reason `removeDocument`
 * gives: the bytes are re-suppliable input rather than evidence, so a failure
 * after the run write leaves a few megabytes nothing points at, which
 * `deleteRun` collects. The reverse order would leave the run naming bytes that
 * are gone, and a download the operator is about to press would fail.
 *
 * THE CALLER MUST KEEP WHAT COMES BACK. It is the stored run, revision
 * advanced, and the object the screen was holding is one behind the moment this
 * resolves.
 */
async function editCheckpoint(
  runId: string,
  gone: string,
  apply: (stored: BrowserRun) => { run: BrowserRun; removingDecisions: string[] },
): Promise<BrowserRun> {
  return withRunLock(runId, async () => {
    const stored = await getRun(runId);
    if (!stored) throw new Error(gone);

    const { run, removingDecisions } = apply(stored);
    // Identity means the order already is what the press asked for -- the same
    // workbook handed over twice, a decision pressed twice, a capture removed
    // in another tab. Writing anyway would advance the revision and refuse
    // whatever the screen is holding, for a press that did nothing.
    if (run === stored) return stored;

    const kept = new Set(checkpointFileIds(run));
    const orphaned = checkpointFileIds(stored).filter((id) => !kept.has(id));

    const saved = await putRun(run, { removingDecisions });
    for (const id of orphaned) await deleteSource(id);
    return saved;
  });
}

export async function editConfig(
  runId: string,
  edit: ConfigEdit,
): Promise<BrowserRun> {
  return editCheckpoint(
    runId,
    `Order ${runId} tidak ada lagi, jadi konfigurasinya tidak bisa diubah.`,
    (stored) => applyConfigEdit(stored, edit),
  );
}

export async function editEpic(
  runId: string,
  edit: EpicEdit,
): Promise<BrowserRun> {
  return editCheckpoint(
    runId,
    `Order ${runId} tidak ada lagi, jadi pemeriksaan EPIC-nya tidak bisa diubah.`,
    (stored) => applyEpicEdit(stored, edit),
  );
}

/**
 * The bytes of one checkpoint file: the operator's workbook, or one tangkapan
 * layar EPIC.
 *
 * ## THE EXISTING `sources` BLOB STORE, KEYED BY THIS RUN
 *
 * Not a fourth object store, and not `BrowserRun.sources`. The store already
 * holds "bytes belonging to a run, read only on demand", which is exactly what
 * these are, and it carries a `byRun` index -- so `deleteRun` sweeps a
 * workbook and every screenshot away with the order they belong to and THERE IS
 * NO NEW CLEANUP PATH TO FORGET. A new store would need its own sweep in
 * `deleteRun`, and the day somebody forgot it an abandoned order would keep
 * paying for the origin's quota until a write failed on an order the operator
 * did care about.
 *
 * `BrowserRun.sources` is the other half of that sentence and is deliberately
 * untouched. A workbook is NOT a berkas of the order: no page of it is
 * rendered, nothing crops it, and listing it there would put it on the film
 * strip, into `Zone.pageIndex`'s arithmetic and into every search pool. The
 * `sources` STORE is a place to keep bytes; `BrowserRun.sources` is a claim
 * about what documents this order is made of.
 *
 * `id` is the caller's own -- `ConfigWorkbook.id` or `EpicCapture.id` -- so the
 * record and the thing that names it agree by construction. `runId` is what
 * makes the sweep work, and passing the wrong one would leave the bytes to be
 * collected by a run that does not use them.
 */
export async function putCheckpointFile(
  runId: string,
  id: string,
  name: string,
  bytes: ArrayBuffer,
): Promise<void> {
  await putSource({ id, runId, name, bytes });
}

/** Those bytes back, for a download or a re-read. Null when they are gone. */
export async function getCheckpointFile(
  id: string,
): Promise<{ name: string; bytes: ArrayBuffer } | null> {
  const stored = await getSource(id);
  return stored ? { name: stored.name, bytes: stored.bytes } : null;
}

/**
 * WHETHER THE AI MAY PROPOSE ANYTHING OUT OF ONE BERKAS.
 *
 * ## What this does NOT do, which is most of it
 *
 * IT DOES NOT RE-READ, RE-RENDER OR UN-READ ANYTHING. The operator's own
 * semantics: a berkas marked "tanpa AI" is still rendered and still OCR'd, so
 * the denah still draws, the film strip still counts it, snapping an area to
 * its lines still works, and a citation off it still names real baris. What
 * they withdrew is the MODEL -- classifying, ranking, locating, walking a
 * lanjutan, extracting a value. So `ingestDocument` is untouched by this
 * feature, the worker protocol gains nothing, and this function writes one
 * boolean.
 *
 * ## Shaped exactly like `editSections`, for the same reason
 *
 * THE RUN IS RE-READ INSIDE THE LOCK rather than taken as an argument. A screen
 * holds a `BrowserRun` in React state for as long as the operator is looking at
 * it, and `ingestDocument` advances the revision once per page across minutes:
 * a run captured before a 151-page read is dozens of revisions stale, and
 * `putRun` would refuse it. The operator would be told the order changed
 * underneath them for ticking a berkas while a document was being read. Reading
 * here turns a refused write into a queued one.
 *
 * THE CALLER MUST KEEP WHAT COMES BACK. It is the stored run, revision
 * advanced, and the object the screen was holding is one behind the moment this
 * resolves.
 *
 * NO OPT-IN IS PASSED TO `putRun` because none is owed: this changes one field
 * of one `RunSource` and drops no page, no capture and no heading. If a future
 * edit here ever did, the guards would refuse it, which is the correct outcome
 * and not one to route around.
 */
export async function setDocumentAi(
  runId: string,
  sourceId: string,
  ai: boolean,
): Promise<BrowserRun> {
  return withRunLock(runId, async () => {
    const stored = await getRun(runId);
    if (!stored) {
      throw new Error(
        `Order ${runId} tidak ada lagi, jadi dokumennya tidak bisa diubah.`,
      );
    }

    // Identity means the berkas already stands where the press asked it to, or
    // this order no longer holds it. Writing anyway would advance the revision
    // and refuse whatever the screen is holding, for a press that did nothing.
    const next = withSourceAi(stored, sourceId, ai);
    if (next === stored) return stored;

    return putRun(next);
  });
}

export async function loadRun(id: string): Promise<BrowserRun | null> {
  return getRun(id);
}

/**
 * Persists a run, and hands back the version that is now stored.
 *
 * THE RETURN VALUE IS NOT OPTIONAL TO USE. `run.rev` records which stored
 * version this object was built from, and a save advances it, so the object
 * passed in here is stale the moment this resolves. A caller that keeps
 * rendering the old object and saves it again gets a `StaleRunWriteError` on
 * that second save. Keep what comes back:
 *
 *     setRun(await saveRun({ ...run, slots: next }));
 *
 * REFUSES A WRITE THAT SILENTLY DROPS A CAPTURE, too. `run.slots` stopped
 * being derivable from the template the day a lanjutan became something
 * discovered, so a shorter array is now a real loss rather than a no-op.
 * Removing one is a stated intention: pass its key in `options.removing`,
 * which `withoutCapture` hands back for exactly this call.
 *
 * REFUSES A STALE WRITE rather than performing it. If anything else wrote to
 * this run since `run` was read -- an `ingestDocument` that finished
 * underneath the screen, or another tab -- this throws
 * `StaleRunWriteError` and changes nothing. That is deliberate and is the
 * point of the whole mechanism: the old behaviour was to accept the write and
 * delete every page the ingest had added, reporting success. A caller that
 * catches it should re-read with `loadRun` and re-apply the edit; retrying
 * with the same object cannot work, because the object is missing whatever
 * the other writer added.
 */
export async function saveRun(
  run: BrowserRun,
  options: PutRunOptions = {},
): Promise<BrowserRun> {
  return withRunLock(run.id, () => putRun(run, options));
}

/** An empty run, persisted, with every fillable slot seeded `"pending"`. */
export async function createRun(id: string = crypto.randomUUID()): Promise<BrowserRun> {
  return withRunLock(id, () => putRun(newRun(id)));
}

/** Deletes a run, its pages, and the PDFs it holds. */
export async function deleteRun(id: string): Promise<void> {
  await withRunLock(id, () => deleteRunRecords(id));
}

/**
 * Renders and OCRs every page of `file` in a Web Worker and APPENDS them to
 * the run.
 *
 * Additive, always. Existing pages keep their positions, so every zone
 * already found or confirmed still points where it did; slots are untouched
 * here entirely. Uploading a second document can therefore never cost the
 * operator work they have already accepted, which is what makes the dokumen
 * tambahan loop safe to run as many times as the operator has documents.
 *
 * The run is created if `runId` names one that does not exist yet, so a UI
 * can mint an id and ingest in one step.
 *
 * REFUSES A DOCUMENT THIS RUN ALREADY HOLDS, by content and not by name, with
 * `DuplicateDocumentError` and without writing anything. See the check inside
 * the lock below, and `src/lib/browser/intake.ts` for why a second copy is a
 * wrong-and-quiet failure rather than untidiness.
 *
 * Each page is persisted as it finishes rather than at the end. A 29-page
 * bundle is minutes of OCR, and a tab reloaded partway through should keep
 * the pages it has already paid for. That also means an interrupted ingest
 * leaves a source whose `pageCount` is larger than the number of pages
 * actually stored for it -- which is the truth, and is visible, rather than a
 * record that claims to be complete.
 *
 * `onProgress` fires per page because a bundle is minutes of work: without it
 * the tab looks hung. It counts pages RELEASED by `ingestPdf`, which reads up
 * to `DEFAULT_CONCURRENCY` pages at once but hands them over strictly in
 * ascending index -- so the bar never goes backwards and never runs ahead of
 * what is actually stored, even though several pages are in flight behind it.
 *
 * `deps.ingestSource` IS INJECTABLE SO A TEST CAN EXECUTE THIS FUNCTION, and
 * that is not a nicety. The revision sequence below used to be wrong in a way
 * that discarded every page of every ingest, and it survived because
 * `persistence.test.mts` RE-STATED the sequence of writes by hand instead of
 * running it: the hand-written mirror was correct while the code was not, and
 * a green suite said so. Everything else here -- pdf.js, the canvas, OCR --
 * is already behind the worker, so this one argument is all that stands
 * between the real function and `node --test`.
 */
export type IngestDeps = {
  ingestSource: typeof ingestSource;
};

export async function ingestDocument(
  runId: string,
  file: File,
  onProgress?: (done: number, total: number) => void,
  deps: IngestDeps = { ingestSource },
): Promise<BrowserRun> {
  const sourceId = crypto.randomUUID();
  const name = file.name || "document.pdf";

  // Read once, outside the lock, and used twice: the digest below and the
  // bytes the worker re-renders from are the same buffer. Holding the lock
  // across a multi-megabyte disk read would serialise every other tab on this
  // order behind it for no reason.
  const bytes = await file.arrayBuffer();
  const digest = await documentDigest(bytes);

  return withRunLock(runId, async () => {
    const loaded = await getRun(runId);
    let run: BrowserRun = loaded ?? newRun(runId);

    /*
     * THE DUPLICATE CHECK IS HERE, INSIDE THE LOCK, AGAINST WHAT IS STORED.
     *
     * The ingest screen screens a hand-over before it queues it (see
     * `screenDocuments`), and that is the check the operator actually
     * experiences: it refuses in a sentence, instantly, without paying for
     * anything. This one is not a second copy of it. It is the check that
     * decides whether bytes land in storage, and it is the only one that can
     * see a second tab on the same order or a queue that was screened before
     * the run it was screened against had finished growing.
     *
     * A run that holds one document twice does not fail: it reads back as a
     * longer bundle, offers the model two identical candidates for every
     * bagian, and turns a crop the operator accepted into a picture of a
     * different scan as soon as the copy is removed and `removeSource`
     * renumbers what is left.
     */
    const held = run.sources.find((source) => source.digest === digest);
    if (held) throw new DuplicateDocumentError(name, held.name, digest);

    // Stored before the worker is asked for anything: the worker reads the
    // bytes from IndexedDB itself rather than being sent tens of megabytes
    // through postMessage on every request.
    //
    // AFTER THE DUPLICATE CHECK, NOT BEFORE IT. This write used to sit above
    // the lock, which was harmless while nothing could refuse the ingest;
    // a refusal there would leave the rejected document's bytes on the device
    // referenced by nothing, counting against an origin quota that a 29-page
    // bundle already fills tens of megabytes at a time.
    await putSource({ id: sourceId, runId, name, bytes });

    const source: RunSource = { id: sourceId, name, pageCount: 0, digest };
    run = await putRun({ ...run, sources: [...run.sources, source] });

    // Writes are chained rather than awaited inside the callback: the worker
    // posts page results as it finishes them and does not wait for this side,
    // so two page messages can arrive while an earlier write is still in
    // flight, and IndexedDB writes to one run must not interleave.
    let writes: Promise<void> = Promise.resolve();
    let writeError: unknown;

    // The arrival-order net, and it guards the one thing in this file that
    // fails silently. `order` below is the page's ARRIVAL position and
    // `withAppendedPage` pushes to the END of `run.pages`, both ignoring the
    // page's own `index`; `Zone.pageIndex` is a position in that array. So a
    // page arriving out of order does not produce a mis-ordered list -- it
    // repoints every zone the run already holds at a different scan, and the
    // deliverable opens fine with a crop of the wrong page in it.
    //
    // `ingestPdf` buffers and releases in ascending index for exactly this
    // reason, and `postMessage` preserves order on the way here, so this
    // should never fire. It is here because the consequence of the day one of
    // those two stops being true is invisible, and because a source's pages
    // are always 0..n-1 of that document, which makes the check one integer.
    //
    // Recorded, not thrown: this callback runs inside the worker client's
    // `message` listener, where a throw is an uncaught error that leaves the
    // ingest promise pending forever -- a progress bar that simply stops. The
    // page is dropped instead and the error is raised below, once the worker
    // has finished and every page that DID arrive in order is committed.
    let expectedIndex = 0;
    let orderError: unknown;

    try {
      await deps.ingestSource(sourceId, (page, done, total) => {
        if (page.index !== expectedIndex) {
          orderError ??= new Error(
            `Pages arrived out of order: expected page ${expectedIndex} of ` +
              `${name}, got ${page.index}. This run kept the ${expectedIndex} ` +
              "page(s) that did arrive in order and took no more, because " +
              "appending a page out of order repoints every zone already " +
              "found at the wrong scan.",
          );
          return;
        }
        expectedIndex += 1;

        const stored: StoredPage = {
          id: crypto.randomUUID(),
          sourceId,
          index: page.index,
          widthPx: page.widthPx,
          heightPx: page.heightPx,
          lines: page.lines,
          // Carried through rather than recomputed: this side holds no pixels
          // and could not measure it a second time even if it wanted to. Only
          // written when the page actually came back short, so a page that
          // passed carries no key -- see `PageShortfall`.
          ...(page.short ? { short: page.short } : {}),
        };

        const order = run.pages.length;
        // `total` comes with every page message, so the source's length is
        // recorded from the first page on rather than only at the end.
        //
        // The revision is advanced HERE, synchronously, rather than read back
        // out of the write below: `writes` is a chain, so these callbacks run
        // ahead of the writes they queue, and a revision taken from the last
        // completed write would be several pages behind by the time the next
        // callback needs it. Advancing in queue order is correct because the
        // chain executes in exactly that order -- and if it ever did not, the
        // check inside `appendPage` would refuse the write rather than let a
        // page land under a revision nothing agreed on.
        //
        // TWO DIFFERENT NUMBERS, and conflating them cost a whole bundle.
        // `base` is the revision this write is BASED ON -- what is stored
        // right now -- and it is what `appendPage` compares against. `run.rev`
        // is what the run BECOMES once that write lands, which is what the
        // next callback must build on. Handing `appendPage` the advanced
        // number made `expected` one ahead of storage on the very first page,
        // so every append of every ingest was refused: 29 pages of OCR ran, a
        // normal progress bar ticked to the end, and the run was left holding
        // zero pages.
        const base = run.rev ?? 0;
        run = { ...withAppendedPage(run, stored, total), rev: base + 1 };

        const meta: RunMeta = { ...metaOf(run), rev: base };
        writes = writes.then(() => {
          // Once one page write has failed, every later one is refused too:
          // its expected revision names a version that was never written. The
          // first error is the real one, so stop rather than bury it under a
          // cascade of stale-revision errors that describe the consequence
          // instead of the cause. Pages already committed stay committed.
          if (writeError !== undefined) return;
          return appendPage(meta, stored, order).then(
            () => undefined,
            (error: unknown) => {
              writeError ??= error;
            },
          );
        });

        onProgress?.(done, total);
      });
    } finally {
      // In a `finally` so a worker that dies mid-bundle still leaves the
      // pages it did finish committed, and so no write outlives the lock
      // that serialises it.
      await writes;
    }

    // The order error first: a write that failed after a page was dropped is
    // the consequence, and the cause is the one worth reporting.
    if (orderError) throw orderError;
    if (writeError) throw writeError;

    return run;
  });
}

/**
 * A page bitmap for display and for cropping, rendered on demand.
 *
 * Rendered at `DEFAULT_DPI`, the same scale OCR measured every zone box in,
 * so a box maps to bitmap pixels one to one. Nothing is cached: 35MB a page
 * times 29 pages is not a cache, it is the whole memory budget.
 *
 * THE CALLER MUST `close()` THE BITMAP when it is done with it.
 */
export async function pageBitmap(
  runId: string,
  pageId: string,
): Promise<ImageBitmap> {
  const page = await getPage(pageId);
  if (!page) throw new Error(`page ${pageId} is not stored on this device.`);
  // A page from another run would render perfectly and be the wrong document.
  if (page.runId !== runId) {
    throw new Error(
      `page ${pageId} belongs to run ${page.runId}, not ${runId}.`,
    );
  }
  return renderPageBitmap(page.sourceId, page.index);
}
