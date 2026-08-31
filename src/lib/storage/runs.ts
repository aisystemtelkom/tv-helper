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

  // A readonly transaction's outcome adds nothing once its reads have
  // resolved, but an unobserved rejected promise is an unhandled rejection,
  // which in a Web Worker is an error event with no context at all.
  if (mode !== "readwrite") void settled.catch(() => {});

  const result = await action(tx);
  if (mode === "readwrite") await settled;
  return result;
}

/** Every run's small half, newest first. Never reads a page or a PDF. */
export async function listRunMeta(): Promise<RunMeta[]> {
  const rows = await transact([RUNS], "readonly", (tx) =>
    promisify(tx.objectStore(RUNS).getAll() as IDBRequest<RunMeta[]>),
  );
  return rows.sort((a, b) => b.createdAt - a.createdAt);
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
      pages: records.sort((a, b) => a.order - b.order).map(toStoredPage),
    };
  });
}

/**
 * Persists a run exactly as given: the meta, and `pages` reconciled against
 * what is already stored.
 *
 * REPLACE, not merge. A page record that belongs to this run and is not in
 * `run.pages` is deleted, because the alternative -- keeping it -- makes a
 * page impossible to remove and leaves orphans that `loadRun` would hand back
 * as if they were current. The cost is that a caller holding a stale
 * `BrowserRun` can undo an append by saving it; `runtime.ts` serialises its
 * own writes per run and re-reads before appending for exactly that reason.
 *
 * Source BYTES are untouched here. `BrowserRun.sources` carries no bytes, so
 * writing this object over the `sources` store would wipe the PDFs and break
 * `pageBitmap` later, at display time, far from the cause.
 */
export async function putRun(run: BrowserRun): Promise<void> {
  const ids = new Set(run.pages.map((p) => p.id));
  if (ids.size !== run.pages.length) {
    throw new Error(
      `run ${run.id} has duplicate page ids; one page would silently ` +
        "overwrite another, and every zone pointing past it would shift.",
    );
  }

  const { pages, ...meta } = run;

  await transact([RUNS, PAGES], "readwrite", async (tx) => {
    const store = tx.objectStore(PAGES);
    const existing = await promisify(
      store.index(BY_RUN).getAllKeys(run.id) as IDBRequest<IDBValidKey[]>,
    );
    for (const key of existing) {
      if (!ids.has(String(key))) store.delete(key);
    }

    pages.forEach((page, order) => {
      store.put({ ...page, runId: run.id, order } satisfies PageRecord);
    });

    tx.objectStore(RUNS).put(meta satisfies RunMeta);
  });
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
 */
export async function appendPage(
  run: RunMeta,
  page: StoredPage,
  order: number,
): Promise<void> {
  await transact([RUNS, PAGES], "readwrite", (tx) => {
    tx.objectStore(PAGES).put({
      ...page,
      runId: run.id,
      order,
    } satisfies PageRecord);
    tx.objectStore(RUNS).put(run satisfies RunMeta);
  });
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
