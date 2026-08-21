/**
 * An `AsyncStorageLike` backed by IndexedDB.
 *
 * assistant-ui's storage interface is async precisely so it can sit on top of
 * IndexedDB rather than localStorage. That matters here: chat history for a
 * document validator holds base64 image data, and localStorage's ~5 MB origin
 * cap would start throwing `QuotaExceededError` after a handful of scans.
 * IndexedDB quota is measured in hundreds of MB.
 *
 * Like localStorage, this is entirely on-device -- no network, no server.
 */

const DB_NAME = "tv-helper";
const DB_VERSION = 1;
const STORE = "kv";

type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

let connection: Promise<IDBDatabase> | undefined;

const openDatabase = (): Promise<IDBDatabase> => {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);

    // A second tab holding an older version blocks the upgrade indefinitely.
    // Surface it instead of hanging on a promise that never settles.
    request.onblocked = () =>
      reject(
        new Error(
          "IndexedDB upgrade is blocked by another open tab. Close other tv-helper tabs and reload.",
        ),
      );
  }).catch((error) => {
    // Let the next call retry rather than caching a rejected connection.
    connection = undefined;
    throw error;
  });

  return connection;
};

const withStore = async <T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDatabase();
  const transaction = db.transaction(STORE, mode);
  const result = await promisify(action(transaction.objectStore(STORE)));

  if (mode === "readwrite") {
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error("IndexedDB write aborted, likely out of disk quota."),
        );
    });
  }

  return result;
};

/**
 * In-memory fallback for server rendering, where `indexedDB` is undefined.
 * The thread list renders empty on the server and hydrates from the real
 * database on the client.
 */
const memoryStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
};

export const createIndexedDBStorage = (): Storage => {
  if (typeof indexedDB === "undefined") return memoryStorage();

  return {
    async getItem(key) {
      return (await withStore("readonly", (s) => s.get(key))) ?? null;
    },
    async setItem(key, value) {
      await withStore("readwrite", (s) => s.put(value, key));
    },
    async removeItem(key) {
      await withStore("readwrite", (s) => s.delete(key));
    },
  };
};
