/**
 * On-device storage for validation runs.
 *
 * Everything a run holds -- the uploaded PDFs, the OCR lines, the zones an
 * operator confirmed -- stays in IndexedDB on the machine that uploaded it.
 * Inference is the only thing that leaves this app, and it leaves server-side;
 * no document is ever uploaded. That constraint is why this file exists at all
 * instead of a table somewhere.
 *
 * ## Why a second database rather than a store in "tv-helper"
 *
 * `src/lib/storage/indexeddb.ts` opens the database named `tv-helper` at
 * version 1 for the chat scaffolding's key/value history. Adding an object
 * store to it means bumping DB_VERSION in both files at once and keeping them
 * in step forever: whichever module opens the older version after the other
 * has upgraded gets a `VersionError` and fails, not gracefully. A separate
 * database has no such coupling, costs nothing, and disappears cleanly with
 * the scaffolding it deliberately does not touch.
 *
 * ## Why three stores rather than one record per run
 *
 * - `runs` holds only the small part: id, timestamp, source list, slot list.
 *   `listRuns` reads all of these, so they must not drag every page's OCR
 *   lines along -- a bundle is 29 pages of them.
 * - `pages` holds one record per page, so appending a page during a long
 *   ingest is one insert rather than a rewrite of the whole run.
 * - `sources` holds the PDF bytes, which are tens of megabytes and are read
 *   only when a page is re-rendered.
 *
 * ## Runs in a Web Worker too
 *
 * `indexedDB` is available on `WorkerGlobalScope`, and the render/OCR worker
 * reads source bytes through this module directly. Passing tens of megabytes
 * of PDF through `postMessage` on every page view instead would copy them
 * each time. So nothing here may touch `window`, `document`, or any other
 * main-thread-only global.
 */

import type { BrowserRun, StoredPage } from "../browser/types.ts";

const DB_NAME = "tv-helper-runs";
const DB_VERSION = 1;

const RUNS = "runs";
const PAGES = "pages";
const SOURCES = "sources";

/** The index both `pages` and `sources` carry, so a run's rows can be found. */
const BY_RUN = "byRun";

/** A run's small half: everything except the pages and the PDF bytes. */
export type RunMeta = Omit<BrowserRun, "pages">;

/**
 * A write refused because the run moved on underneath the writer.
 *
 * Its own class so a UI can tell this apart from a quota failure or a closed
 * database and say the one useful thing -- "this run changed since you loaded
 * it; reload" -- instead of a generic failure. Catching it and retrying with
 * the same object would be wrong: the object is missing whatever the other
 * writer added, which is the entire point.
 */
export class StaleRunWriteError extends Error {
  readonly runId: string;
  /** The revision the writer believed was current. */
  readonly expected: number;
  /** The revision actually stored, or `null` when the run is not stored. */
  readonly actual: number | null;

  constructor(runId: string, expected: number, actual: number | null) {
    super(
      actual === null
        ? `run ${runId} is not stored (it was deleted, or never saved), but ` +
            `this write is based on revision ${expected}. Writing it would ` +
            "resurrect a deleted run. Reload before saving."
        : `run ${runId} has moved on: this write is based on revision ` +
            `${expected}, but revision ${actual} is stored. Something else ` +
            "wrote to this run -- most likely an ingest that finished after " +
            "this object was read. Re-read the run with getRun and re-apply " +
            "the change; saving this object would discard the other write.",
    );
    this.name = "StaleRunWriteError";
    this.runId = runId;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * A run that would silently lose pages it is not carrying.
 *
 * The second net under `StaleRunWriteError`, and independent of it: this one
 * fires on what the write would DO rather than on where it came from, so a
 * caller that assembled a short `pages` array through some other mistake --
 * a bad filter, a partially-loaded run -- is caught even when its revision
 * is perfectly current.
 */
export class PageLossError extends Error {
  readonly runId: string;
  /** The page ids stored for this run that the incoming run does not carry. */
  readonly missing: string[];

  constructor(runId: string, missing: string[]) {
    super(
      `run ${runId} would lose ${missing.length} stored page(s) ` +
        `(${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}) ` +
        "because this write does not carry them. Pages are append-only: a " +
        "zone's pageIndex is a position in that array, so dropping one " +
        "repoints every zone after it. Re-read the run and re-apply the " +
        "change.",
    );
    this.name = "PageLossError";
    this.runId = runId;
    this.missing = missing;
  }
}

/**
 * A write that would silently drop a capture the operator has evidence for.
 *
 * THE THIRD NET, AND THE ONE THAT ONLY BECAME NECESSARY WHEN A LANJUTAN
 * STOPPED BEING DECLARED. While `run.slots` was a pure function of the
 * template, a writer that rebuilt it rebuilt it identically; there was nothing
 * to lose and this class would have had nothing to catch. A DISCOVERED capture
 * exists only in the stored array, so any rebuild-from-template write --
 * a template migration, a "reset this run", a merge helper that maps over
 * `AO_TEMPLATE.sections` -- arrives at the CORRECT revision, carrying EVERY
 * page, and simply short. `StaleRunWriteError` does not see it and
 * `PageLossError` does not see it. It would delete a crop a human accepted and
 * report success, which is this project's failure shape exactly.
 *
 * DROPPED OR EMPTIED, BOTH. The check compares EVIDENCE, not key presence,
 * because the writer it was built for does not drop a key at all: a rebuild
 * from `AO_TEMPLATE.sections` emits capture 1 under the template key verbatim
 * (that is how `seedSlots` keys it) with no `zone`, so every key is carried
 * and every accepted crop is gone. Only the `#2`/`#3` keys such a writer fails
 * to emit would be caught by a key-only comparison, which is the smaller half
 * of the same loss.
 *
 * NOT an append-only rule. "Bukan ini" really does discard evidence -- on a
 * lanjutan by removing the row, on capture 1 by clearing its zone and leaving
 * the row the template still asks for -- and pretending otherwise would be a
 * lie the code then has to work around. The rule is that such a removal must
 * SAY SO: pass the key in `putRun`'s `removing` option and the write is
 * allowed. Only the silent shortfall is refused.
 *
 * Zone-carrying states only. A capture nobody has found evidence for costs
 * nothing to re-seed, and refusing those would block the legitimate case where
 * a template stops declaring a slot.
 */
export class CaptureLossError extends Error {
  readonly runId: string;
  /**
   * Keys of stored, zone-carrying slot states whose evidence this write
   * discards: dropped from the array, or carried back with no zone.
   */
  readonly missing: string[];

  constructor(runId: string, missing: string[]) {
    super(
      `run ${runId} would lose ${missing.length} capture(s) carrying evidence ` +
        `(${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}) ` +
        "because this write drops them or carries them back without their " +
        "zone. A lanjutan is discovered, not declared, so it exists only in " +
        "the stored slot list and a write rebuilt from the template silently " +
        "deletes it. If you meant to remove a capture, name it in putRun's " +
        "`removing` option; otherwise re-read the run and re-apply the change.",
    );
    this.name = "CaptureLossError";
    this.runId = runId;
    this.missing = missing;
  }
}

/**
 * The revision an object was built from, with a missing one read as 0.
 *
 * Absent means either a run built by hand that was never stored, or a record
 * written before runs carried a revision at all. Both are correctly treated
 * as the oldest possible revision: the first can only create, and the second
 * matches the 0 that `readRev` reports for that stored record too, so an
 * existing run upgrades on its next write instead of becoming unwritable.
 */
function revOf(meta: { rev?: number } | undefined | null): number {
  return meta?.rev ?? 0;
}

/**
 * A page as stored.
 *
 * `order` is the page's position in `BrowserRun.pages` and exists because
 * IndexedDB returns index matches in key order, not insertion order, so
 * without it the array would come back reordered -- and a reordered
 * `pages` array silently repoints every `Zone.pageIndex`. It is an
 * implementation detail: `loadRun` sorts by it and strips it.
 */
type PageRecord = StoredPage & { runId: string; order: number };

export type StoredSource = {
  id: string;
  runId: string;
  name: string;
  /** The original PDF, byte for byte, so a page can be re-rendered on demand. */
  bytes: ArrayBuffer;
};

/**
 * A stored page as the rest of the app sees it: the bookkeeping columns
 * dropped, field by field rather than by rest-spread, so that adding a field
 * to `StoredPage` fails to compile here instead of silently not being read
 * back.
 */
function toStoredPage(record: PageRecord): StoredPage {
  return {
    id: record.id,
    sourceId: record.sourceId,
    index: record.index,
    widthPx: record.widthPx,
    heightPx: record.heightPx,
    lines: record.lines,
  };
}

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

let connection: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error(
        "IndexedDB is unavailable here. Runs are stored on the device, so " +
          "this module only works in a browser tab or a Web Worker -- never " +
          "during server rendering.",
      ),
    );
  }

  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RUNS)) {
        db.createObjectStore(RUNS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PAGES)) {
        db.createObjectStore(PAGES, { keyPath: "id" }).createIndex(
          BY_RUN,
          "runId",
        );
      }
      if (!db.objectStoreNames.contains(SOURCES)) {
        db.createObjectStore(SOURCES, { keyPath: "id" }).createIndex(
          BY_RUN,
          "runId",
        );
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);

    // A second tab holding an older version blocks the upgrade indefinitely.
    // Surface it instead of hanging on a promise that never settles.
    request.onblocked = () =>
      reject(
        new Error(
          "IndexedDB upgrade is blocked by another open tab. Close other " +
            "tv-helper tabs and reload.",
        ),
      );
  }).catch((error) => {
    // Let the next call retry rather than caching a rejected connection.
    connection = undefined;
    throw error;
  });

  return connection;
}

/**
 * Runs `action` inside one transaction over `stores` and does not resolve
 * until the transaction has actually COMMITTED.
 *
 * Waiting for `oncomplete` rather than for the last request's `onsuccess` is
 * the difference between "the write happened" and "the write was accepted";
 * a quota failure aborts at commit time, after every individual request has
 * already reported success. A caller that returned early would report a
 * saved run that is not there after a reload.
 */
async function transact<T>(
  stores: string[],
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDatabase();
  const tx = db.transaction(stores, mode);

  const settled = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(
        tx.error ??
          new Error("IndexedDB write aborted, likely out of disk quota."),
      );
  });

  // An unobserved rejected promise is an unhandled rejection, which in a Web
  // Worker is an error event with no context at all. A readonly transaction's
  // outcome is never awaited; a readwrite one is not awaited either when
  // `action` itself throws, which is how the revision checks below refuse a
  // write. Attaching this handler does not stop `await settled` from seeing
  // the rejection -- `.catch` derives a new promise and leaves the original
  // rejected -- so the caller still learns about a failed commit.
  void settled.catch(() => {});

  let result: T;
  try {
    result = await action(tx);
  } catch (error) {
    // Nothing half-written survives a refusal. The checks below throw before
    // issuing any write, so this is belt and braces -- but a future check
    // added after the first `put` would silently commit part of a rejected
    // write without it, which is precisely the failure shape this module is
    // written against.
    try {
      tx.abort();
    } catch {
      // Already finished; there is nothing to abort.
    }
    throw error;
  }

  if (mode === "readwrite") await settled;
  return result;
}

/** Every run's small half, newest first. Never reads a page or a PDF. */
export async function listRunMeta(): Promise<RunMeta[]> {
  const rows = await transact([RUNS], "readonly", (tx) =>
    promisify(tx.objectStore(RUNS).getAll() as IDBRequest<RunMeta[]>),
  );
  return rows
    .map((row) => ({ ...row, rev: revOf(row) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** A whole run, pages included, or null. PDF bytes are never loaded here. */
export async function getRun(id: string): Promise<BrowserRun | null> {
  return transact([RUNS, PAGES], "readonly", async (tx) => {
    const meta = await promisify(
      tx.objectStore(RUNS).get(id) as IDBRequest<RunMeta | undefined>,
    );
    if (!meta) return null;

    const records = await promisify(
      tx.objectStore(PAGES).index(BY_RUN).getAll(id) as IDBRequest<
        PageRecord[]
      >,
    );

    return {
      ...meta,
      // Stamped, not passed through: this is the number a later write is
      // checked against, so it has to be the one this read actually saw --
      // including the 0 that stands for a record written before runs carried
      // a revision.
      rev: revOf(meta),
      pages: records.sort((a, b) => a.order - b.order).map(toStoredPage),
    };
  });
}

/**
 * Persists a run, but only if the run has not moved on since it was read.
 *
 * ## What this used to do, and what it cost
 *
 * It replaced a run wholesale: every stored page not present in `run.pages`
 * was DELETED. That made a stale write catastrophic and silent. An operator
 * uploads a 29-page bundle; `ingestDocument` OCRs it for three minutes,
 * appending pages as it goes; the UI is meanwhile holding the `BrowserRun` it
 * loaded before the upload, and the moment the operator accepts a zone it
 * saves that object. Every page the ingest had written was deleted, the save
 * resolved, and the run still opened and still looked complete. The comment
 * here used to name that hazard and tell callers to re-read -- but the UI
 * cannot re-read an object React is already rendering, and a rule that is
 * only ever documented is a rule that eventually gets broken by the one
 * caller that did not read the comment.
 *
 * ## The two checks
 *
 * 1. REVISION. `run.rev` is the revision the caller read (absent = 0, the
 *    oldest possible). It is compared against what is stored INSIDE the same
 *    readwrite transaction as the write, so the read and the write cannot be
 *    separated by another writer -- including one in another tab, which the
 *    per-run lock in `runtime.ts` cannot see at all. A mismatch throws
 *    `StaleRunWriteError` and writes nothing. A run that is not stored may
 *    only be written by a caller at revision 0, so a save cannot resurrect a
 *    deleted run either.
 *
 * 2. PAGE LOSS. Even at the correct revision, a write that does not carry
 *    every stored page is refused with `PageLossError` rather than deleting
 *    the difference. Pages are append-only -- `Zone.pageIndex` is a position
 *    in that array -- so there is no such thing as a legitimate page removal
 *    short of deleting the whole run, which `deleteRun` does. The old
 *    comment's argument for deleting (orphans would be handed back as
 *    current) is answered better this way: nothing is orphaned, because
 *    nothing is dropped.
 *
 * 3. CAPTURE LOSS. A write that drops a stored slot state CARRYING A ZONE,
 *    or that carries one back with its zone gone, is refused with
 *    `CaptureLossError` unless it names that key in `options.removing`. This
 *    is the same shape as check 2, for the list that stopped being derivable
 *    when a lanjutan became something discovered rather than declared: see the
 *    class comment.
 *
 * All three are refusals, not repairs. Merging the caller's slots onto the
 * stored pages would let the save appear to succeed while quietly discarding
 * whichever of the two writers' slot edits lost, and a validator signs what
 * comes out of here.
 *
 * Returns the run as now stored, with `rev` advanced. THE CALLER MUST KEEP
 * IT: the object it passed in is stale the instant this resolves, and saving
 * that one again throws.
 *
 * Source BYTES are untouched here. `BrowserRun.sources` carries no bytes, so
 * writing this object over the `sources` store would wipe the PDFs and break
 * `pageBitmap` later, at display time, far from the cause.
 */
export type PutRunOptions = {
  /**
   * Slot-state keys whose stored EVIDENCE this write deliberately discards:
   * the state is dropped from the array, or carried back without its zone.
   *
   * The opt-in that turns a silent shortfall into a stated intention. Only a
   * stored state carrying a zone needs naming; everything else may come and go
   * with the template.
   *
   * BOTH SHAPES NEED NAMING because both are the same loss. "Bukan ini" on
   * capture 1 keeps the row -- the template still asks for that bagian -- and
   * clears its zone, which deletes an accepted crop exactly as removing the
   * row would; a rebuild-from-template writer produces the same shape by
   * accident, which is the case this net was built for.
   */
  removing?: readonly string[];
};

export async function putRun(
  run: BrowserRun,
  options: PutRunOptions = {},
): Promise<BrowserRun> {
  const ids = new Set(run.pages.map((p) => p.id));
  if (ids.size !== run.pages.length) {
    throw new Error(
      `run ${run.id} has duplicate page ids; one page would silently ` +
        "overwrite another, and every zone pointing past it would shift.",
    );
  }

  const { pages, ...meta } = run;
  const expected = revOf(run);
  const next = expected + 1;

  await transact([RUNS, PAGES], "readwrite", async (tx) => {
    const runs = tx.objectStore(RUNS);
    const stored = await promisify(
      runs.get(run.id) as IDBRequest<RunMeta | undefined>,
    );

    if (!stored) {
      if (expected !== 0) throw new StaleRunWriteError(run.id, expected, null);
    } else if (revOf(stored) !== expected) {
      throw new StaleRunWriteError(run.id, expected, revOf(stored));
    }

    // Read from the SAME transaction as the write, for the same reason the
    // revision is: a check done in a separate transaction cannot see a second
    // tab, and this list is now the only place a discovered capture lives.
    if (stored) {
      const allowed = new Set(options.removing ?? []);
      // COMPARED ON THE EVIDENCE, NOT ON THE KEY. A key-presence check catches
      // only the writer that drops a state, and the writer this net was built
      // for -- a rebuild from `AO_TEMPLATE.sections` -- does not drop one: it
      // emits capture 1 under the template key verbatim (that is how
      // `seedSlots` keys it) with no `zone`. Every one of those keys IS
      // carried, so a key-only check passes while every accepted capture-1
      // crop is erased at the correct revision with every page present, and
      // the write reports success. The invariant is the one `types.ts` states
      // -- a whole-array write may not drop a state that carries a zone -- and
      // a state carried back with its zone removed has dropped exactly that.
      const carried = new Map(run.slots.map((slot) => [slot.key, slot]));
      const dropped = (stored.slots ?? [])
        .filter((slot) => slot.zone && !carried.get(slot.key)?.zone)
        .map((slot) => slot.key)
        .filter((key) => !allowed.has(key));
      if (dropped.length > 0) throw new CaptureLossError(run.id, dropped);
    }

    const store = tx.objectStore(PAGES);
    const existing = await promisify(
      store.index(BY_RUN).getAllKeys(run.id) as IDBRequest<IDBValidKey[]>,
    );
    const missing = existing
      .map((key) => String(key))
      .filter((key) => !ids.has(key));
    if (missing.length > 0) throw new PageLossError(run.id, missing);

    pages.forEach((page, order) => {
      store.put({ ...page, runId: run.id, order } satisfies PageRecord);
    });

    runs.put({ ...meta, rev: next } satisfies RunMeta);
  });

  return { ...run, rev: next };
}

/**
 * Appends ONE page and updates the run's small half, in one transaction.
 *
 * `putRun` would do the same thing by rewriting every page record the run
 * owns. That is O(pages) per page and O(pages^2) over an ingest, which for a
 * 29-page bundle is 435 writes of OCR lines to store 29. This is the path a
 * long ingest takes, so that a tab reloaded three minutes in keeps the pages
 * it already paid four seconds each for.
 *
 * `order` must be the page's position in `BrowserRun.pages` -- the caller
 * knows it, because it is appending to that array in the same step -- and
 * must never be reused: it is what `Zone.pageIndex` refers to.
 *
 * REVISION-CHECKED like `putRun`, and for the reason that makes the check
 * work at all: this is the write an ingest performs, once per page, for
 * minutes. If it did not advance the run's revision, a `BrowserRun` read
 * before the ingest would still look current when the ingest finished, and
 * saving it would delete every page the ingest had appended -- the exact
 * failure the revision exists to stop. So each page moves the run forward,
 * and anything holding an older copy is refused.
 *
 * The run must already be stored: an append has nothing to append to
 * otherwise, and inventing the run here would hide the ordering mistake that
 * led to it. Returns the meta as now stored, revision advanced.
 */
export async function appendPage(
  run: RunMeta,
  page: StoredPage,
  order: number,
): Promise<RunMeta> {
  const expected = revOf(run);
  const next = expected + 1;

  await transact([RUNS, PAGES], "readwrite", async (tx) => {
    const runs = tx.objectStore(RUNS);
    const stored = await promisify(
      runs.get(run.id) as IDBRequest<RunMeta | undefined>,
    );
    if (!stored) throw new StaleRunWriteError(run.id, expected, null);
    if (revOf(stored) !== expected) {
      throw new StaleRunWriteError(run.id, expected, revOf(stored));
    }

    tx.objectStore(PAGES).put({
      ...page,
      runId: run.id,
      order,
    } satisfies PageRecord);
    runs.put({ ...run, rev: next } satisfies RunMeta);
  });

  return { ...run, rev: next };
}

/** One page by its own id, without loading the run it belongs to. */
export async function getPage(
  pageId: string,
): Promise<(StoredPage & { runId: string }) | null> {
  const record = await transact([PAGES], "readonly", (tx) =>
    promisify(
      tx.objectStore(PAGES).get(pageId) as IDBRequest<PageRecord | undefined>,
    ),
  );
  if (!record) return null;
  return { ...toStoredPage(record), runId: record.runId };
}

export async function putSource(source: StoredSource): Promise<void> {
  await transact([SOURCES], "readwrite", (tx) => {
    tx.objectStore(SOURCES).put(source);
  });
}

export async function getSource(id: string): Promise<StoredSource | null> {
  const source = await transact([SOURCES], "readonly", (tx) =>
    promisify(
      tx.objectStore(SOURCES).get(id) as IDBRequest<StoredSource | undefined>,
    ),
  );
  return source ?? null;
}

/**
 * Deletes a run and everything it owns.
 *
 * The PDFs are the reason this is not optional housekeeping: a 29-page scan
 * bundle is tens of megabytes, and an abandoned run that keeps them forever
 * eats the origin's storage quota until writes start failing on a run the
 * operator does care about.
 */
export async function deleteRun(id: string): Promise<void> {
  await transact([RUNS, PAGES, SOURCES], "readwrite", async (tx) => {
    for (const name of [PAGES, SOURCES]) {
      const store = tx.objectStore(name);
      const keys = await promisify(
        store.index(BY_RUN).getAllKeys(id) as IDBRequest<IDBValidKey[]>,
      );
      for (const key of keys) store.delete(key);
    }
    tx.objectStore(RUNS).delete(id);
  });
}
