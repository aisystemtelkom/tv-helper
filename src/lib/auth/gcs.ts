/**
 * The Cloud Storage-backed `AllowlistReader`.
 *
 * The whole allowlist is ONE JSON object, not one object per email. It is read
 * whole on every lookup that misses the 60s cache in `allowlist.ts`, which for
 * a list of operators is the right trade: a few kilobytes, well inside the free
 * tier, against the per-entry object listing a document-per-email layout would
 * need for the admin page.
 *
 * ## Why this exists at all, when `firestore.ts` is right there
 *
 * `roles/editor` -- which is what this project's deploying account holds --
 * CANNOT create a Firestore database. `datastore.databases.create` is withheld,
 * and so is `resourcemanager.projects.setIamPolicy`, so the account cannot
 * grant itself the role either. Verified against the live project rather than
 * inferred from the role's name:
 *
 *     curl -X POST ".../projects/$P:testIamPermissions" \
 *       -d '{"permissions":["datastore.databases.create"]}'   # -> absent
 *
 * Editor CAN create a bucket and read and write its objects. So this module is
 * the store an Editor-only project can actually have. `firestore.ts` remains
 * the better one where the role allows it, and `instance.ts` picks between
 * them; neither is deprecated.
 *
 * Secret Manager is NOT an alternative here, and the reason is easy to get
 * backwards: `secretmanager.versions.access` is deliberately excluded from
 * Editor, and the default compute service account carries Editor too, so
 * switching service accounts does not help.
 *
 * ## Concurrency
 *
 * A read-modify-write over a shared object is a lost update waiting to happen:
 * two admins each adding an operator would write a document holding their own
 * edit and not the other's, and both would report success. Every write
 * therefore carries an `ifGenerationMatch` precondition naming the generation
 * it read, which GCS rejects with 412 if anything landed in between. Same
 * shape as the `rev` check in `src/lib/storage/runs.ts`, for the same reason.
 */

import { GoogleAuth } from "google-auth-library";

import {
  coerceRole,
  normalizeEmail,
  type AllowlistEntry,
  type AllowlistReader,
} from "./allowlist.ts";

/** The bucket holding the allowlist object. Selects this store when set. */
export const ALLOWLIST_BUCKET = process.env.ALLOWLIST_BUCKET ?? "";

/** The object name inside that bucket. */
export const ALLOWLIST_OBJECT = process.env.ALLOWLIST_OBJECT ?? "allowlist.json";

/**
 * Wall-clock ceiling on one storage call, for the reason `firestore.ts`
 * records: a partition must become `lookup-failed` promptly rather than
 * hanging a page load behind a retry ladder.
 */
export const GCS_TIMEOUT_MS = Number(process.env.ALLOWLIST_TIMEOUT_MS ?? 5000);

/**
 * How many times a write retries after losing a generation race. Three covers
 * the contention this store will ever see (two admins on one page); an
 * unbounded loop would turn a persistent 412 into a hang.
 */
const WRITE_ATTEMPTS = 3;

/** Read AND write: this store is edited from the admin page, not just read. */
const SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";

let auth: GoogleAuth | null = null;

/**
 * Built lazily rather than at import time, so a missing credential fails the
 * request that needs it instead of the build that collects the routes.
 */
function tokens(): GoogleAuth {
  auth ??= new GoogleAuth({ scopes: [SCOPE] });
  return auth;
}

async function authorization(): Promise<string> {
  const token = await tokens().getAccessToken();
  if (!token) throw new Error("no access token for Cloud Storage");
  return `Bearer ${token}`;
}

function requireBucket(): string {
  if (!ALLOWLIST_BUCKET) {
    throw new Error(
      "ALLOWLIST_BUCKET is not set, so the Cloud Storage allowlist has no " +
        "bucket to read. Set it, or leave it unset to use the Firestore store.",
    );
  }
  return ALLOWLIST_BUCKET;
}

function objectUrl(kind: "media" | "upload"): string {
  const bucket = encodeURIComponent(requireBucket());
  const name = encodeURIComponent(ALLOWLIST_OBJECT);
  return kind === "media"
    ? `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${name}?alt=media`
    : `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${name}`;
}

/**
 * The two things this module reaches the outside world with. Injected for the
 * same reason `Ask` and `CanvasFactory` are elsewhere in this codebase: the
 * whole surface below -- the 404-as-empty rule, the generation race, the
 * refusal to read corrupt JSON as empty -- is testable with `node --test` and
 * no GCP credential anywhere.
 */
export type GcsDeps = {
  authorization: () => Promise<string>;
  fetchImpl: typeof fetch;
};

async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GCS_TIMEOUT_MS);
  try {
    return await work(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} did not answer within ${GCS_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** The stored document. `entries` is keyed by normalized email. */
type StoredDoc = { entries: Record<string, unknown> };

/**
 * What a read returns. `generation` is `"0"` when the object does not exist
 * yet, which is exactly the precondition value GCS wants for "create only if
 * still absent", so the empty case needs no special branch at the call site.
 */
type Snapshot = { doc: StoredDoc; generation: string };

function parseDoc(text: string): StoredDoc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A corrupt object must not read as "nobody is on the allowlist", which
    // would silently deny every operator while looking like a normal empty
    // store. Throw, so the decision surfaces as `lookup-failed`.
    throw new Error(
      `${ALLOWLIST_OBJECT} is not valid JSON. Refusing to treat it as empty.`,
    );
  }
  const entries =
    typeof parsed === "object" &&
    parsed !== null &&
    "entries" in parsed &&
    typeof (parsed as StoredDoc).entries === "object" &&
    (parsed as StoredDoc).entries !== null
      ? (parsed as StoredDoc).entries
      : {};
  return { entries };
}

async function read(deps: GcsDeps): Promise<Snapshot> {
  return withTimeout(async (signal) => {
    const response = await deps.fetchImpl(objectUrl("media"), {
      headers: { Authorization: await deps.authorization() },
      signal,
      cache: "no-store",
    });
    if (response.status === 404) {
      // Not an error: an allowlist nobody has edited yet. The bootstrap owner
      // in `allowlist.ts` is what keeps this state usable.
      return { doc: { entries: {} }, generation: "0" };
    }
    if (!response.ok) {
      throw new Error(
        `allowlist read failed: ${response.status} ${response.statusText}`,
      );
    }
    const generation = response.headers.get("x-goog-generation") ?? "0";
    return { doc: parseDoc(await response.text()), generation };
  }, "allowlist read");
}

/** Returns false on a lost generation race, so the caller can retry. */
async function write(
  deps: GcsDeps,
  doc: StoredDoc,
  generation: string,
): Promise<boolean> {
  return withTimeout(async (signal) => {
    const url = `${objectUrl("upload")}&ifGenerationMatch=${encodeURIComponent(generation)}`;
    const response = await deps.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: await deps.authorization(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(doc, null, 2),
      signal,
    });
    if (response.status === 412) return false;
    if (!response.ok) {
      throw new Error(
        `allowlist write failed: ${response.status} ${response.statusText}`,
      );
    }
    return true;
  }, "allowlist write");
}

/**
 * Read, apply `change`, write back under the generation that was read. Retries
 * from a fresh read on a lost race, because the change is expressed as a
 * function of the current document rather than as a precomputed result.
 */
async function mutate(
  deps: GcsDeps,
  change: (doc: StoredDoc) => void,
): Promise<void> {
  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt += 1) {
    const { doc, generation } = await read(deps);
    change(doc);
    if (await write(deps, doc, generation)) return;
  }
  throw new Error(
    `allowlist write lost ${WRITE_ATTEMPTS} generation races. Another admin ` +
      "is editing concurrently; try again.",
  );
}

/**
 * A stored row to an `AllowlistEntry`. Mirrors `firestore.ts`'s `toEntry`: an
 * unrecognised role degrades to `member` with a warning rather than being
 * guessed upward, and a non-string `addedAt` becomes null rather than
 * rendering as "[object Object]" in the admin table.
 */
function toEntry(email: string, raw: unknown): AllowlistEntry {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    email,
    role: coerceRole(data.role, email),
    addedBy: typeof data.addedBy === "string" ? data.addedBy : null,
    addedAt: typeof data.addedAt === "string" ? data.addedAt : null,
  };
}

/**
 * Rejects a key that would shadow a prototype member. `__proto__` is the one
 * that matters: assigning it on a plain object literal does not create an own
 * property, so a stored entry under that key would vanish on write and could
 * never be removed.
 */
function assertUsableAsKey(email: string): void {
  if (!email || email === "__proto__" || email === "constructor") {
    throw new Error(`"${email}" cannot be used as an allowlist key.`);
  }
}

export function gcsAllowlistReader(
  overrides: Partial<GcsDeps> = {},
): AllowlistReader {
  const deps: GcsDeps = {
    authorization: overrides.authorization ?? authorization,
    fetchImpl: overrides.fetchImpl ?? fetch,
  };
  return {
    async get(email) {
      const id = normalizeEmail(email);
      assertUsableAsKey(id);
      const { doc } = await read(deps);
      if (!Object.prototype.hasOwnProperty.call(doc.entries, id)) return null;
      return toEntry(id, doc.entries[id]);
    },

    async list() {
      const { doc } = await read(deps);
      // Capped for the same reason `firestore.ts` caps its query: the admin
      // page renders every row.
      return Object.keys(doc.entries)
        .slice(0, 500)
        .map((email) => toEntry(email, doc.entries[email]));
    },

    async put(entry) {
      const id = normalizeEmail(entry.email);
      assertUsableAsKey(id);
      await mutate(deps, (doc) => {
        doc.entries[id] = {
          role: entry.role,
          addedBy: entry.addedBy,
          addedAt: entry.addedAt,
        };
      });
    },

    async remove(email) {
      const id = normalizeEmail(email);
      assertUsableAsKey(id);
      await mutate(deps, (doc) => {
        delete doc.entries[id];
      });
    },
  };
}
