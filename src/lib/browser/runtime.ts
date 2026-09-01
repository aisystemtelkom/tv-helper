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
 * Three invariants hold this together. Each of them exists because breaking
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

import { AO_TEMPLATE, type Template } from "../forms/template.ts";
import {
  appendPage,
  getPage,
  getRun,
  listRunMeta,
  putRun,
  putSource,
  deleteRun as deleteRunRecords,
  type RunMeta,
} from "../storage/runs.ts";
import { ingestSource, renderPageBitmap } from "./worker-client.ts";
import type {
  BrowserRun,
  RunSource,
  SlotState,
  StoredPage,
} from "./types.ts";

export type {
  BrowserRun,
  RunSource,
  SlotState,
  SlotStatus,
  StoredPage,
} from "./types.ts";

/**
 * The two ways a write is refused, re-exported because they are part of this
 * surface: a UI that treats them as generic failures tells the operator
 * nothing useful, and the one useful thing to say ("this run changed
 * underneath you, reload") is only sayable if the type is reachable.
 */
export { PageLossError, StaleRunWriteError } from "../storage/runs.ts";

/**
 * Separates a multi-capture slot's ordinal from its template key. See
 * `SlotState.key`: the sample's ToP row holds two pictures cut from two
 * different pages, and one `SlotState` per slot would silently ship one of
 * them.
 */
const CAPTURE_SEPARATOR = "#";

/** The template key behind a `SlotState.key`, ordinal suffix removed. */
export function slotKeyOf(slotStateKey: string): string {
  const cut = slotStateKey.lastIndexOf(CAPTURE_SEPARATOR);
  return cut === -1 ? slotStateKey : slotStateKey.slice(0, cut);
}

/**
 * One `SlotState` per capture the template asks for, all `"pending"`.
 *
 * Non-fillable slots are left out. The sample ships MOM, BASO, BA Splitting,
 * SBR Pricing and BA Penjelasan Order as deliberately empty sections that the
 * operator completes by hand; putting them in the work list would ask the
 * operator to hunt for evidence that is known not to be in the bundle.
 * `scripts/generate.mjs` skips them on the same test.
 */
export function seedSlots(template: Template = AO_TEMPLATE): SlotState[] {
  const slots: SlotState[] = [];

  for (const section of template.sections) {
    for (const slot of section.slots) {
      if (!slot.fillable) continue;
      const captures = slot.crops ?? 1;
      if (captures === 1) {
        slots.push({ key: slot.key, label: slot.label, status: "pending" });
        continue;
      }
      for (let n = 1; n <= captures; n++) {
        slots.push({
          key: `${slot.key}${CAPTURE_SEPARATOR}${n}`,
          label: `${slot.label} (${n})`,
          status: "pending",
        });
      }
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
  };
}

/** A run's small half, listed field by field so tsc names anything new. */
function metaOf(run: BrowserRun): RunMeta {
  return {
    id: run.id,
    createdAt: run.createdAt,
    rev: run.rev,
    sources: run.sources,
    slots: run.slots,
  };
}

function labelFor(sources: RunSource[]): string {
  if (sources.length === 0) return "(no documents yet)";
  const [first, ...rest] = sources;
  return rest.length === 0 ? first.name : `${first.name} +${rest.length} more`;
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

export async function listRuns(): Promise<
  { id: string; createdAt: number; label: string }[]
> {
  const meta = await listRunMeta();
  return meta.map((run) => ({
    id: run.id,
    createdAt: run.createdAt,
    label: labelFor(run.sources),
  }));
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
export async function saveRun(run: BrowserRun): Promise<BrowserRun> {
  return withRunLock(run.id, () => putRun(run));
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
 * Each page is persisted as it finishes rather than at the end. A 29-page
 * bundle is minutes of OCR, and a tab reloaded partway through should keep
 * the pages it has already paid for. That also means an interrupted ingest
 * leaves a source whose `pageCount` is larger than the number of pages
 * actually stored for it -- which is the truth, and is visible, rather than a
 * record that claims to be complete.
 *
 * `onProgress` fires per page because OCR of one real page takes 4-5 seconds:
 * without it a bundle looks like a hung tab for several minutes.
 */
export async function ingestDocument(
  runId: string,
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<BrowserRun> {
  const sourceId = crypto.randomUUID();
  const name = file.name || "document.pdf";

  // Stored before the worker is asked for anything: the worker reads the
  // bytes from IndexedDB itself rather than being sent tens of megabytes
  // through postMessage on every request.
  await putSource({ id: sourceId, runId, name, bytes: await file.arrayBuffer() });

  return withRunLock(runId, async () => {
    const loaded = await getRun(runId);
    let run: BrowserRun = loaded ?? newRun(runId);

    const source: RunSource = { id: sourceId, name, pageCount: 0 };
    run = await putRun({ ...run, sources: [...run.sources, source] });

    // Writes are chained rather than awaited inside the callback: the worker
    // posts page results as it finishes them and does not wait for this side,
    // so two page messages can arrive while an earlier write is still in
    // flight, and IndexedDB writes to one run must not interleave.
    let writes: Promise<void> = Promise.resolve();
    let writeError: unknown;

    try {
      await ingestSource(sourceId, (page, done, total) => {
        const stored: StoredPage = {
          id: crypto.randomUUID(),
          sourceId,
          index: page.index,
          widthPx: page.widthPx,
          heightPx: page.heightPx,
          lines: page.lines,
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
        run = { ...withAppendedPage(run, stored, total), rev: (run.rev ?? 0) + 1 };

        const meta = metaOf(run);
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
