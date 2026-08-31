/**
 * The Firestore-backed `AllowlistReader`.
 *
 * One collection in the default database, document id = email. A login costs
 * one read against a free-tier allowance of 50,000 reads per day, and the 60s
 * cache in `allowlist.ts` keeps it to roughly one read per minute per instance
 * per signed-in operator.
 *
 * Reached through the service account and Application Default Credentials with
 * the Cloud Datastore User role. No key file is downloaded, and nothing in this
 * file reads a credential itself.
 *
 * The client is built lazily, on first use rather than at import time, for the
 * same reason `src/lib/model.ts` is: a missing credential would otherwise throw
 * while Next collects routes and fail the build instead of the request that
 * actually needs it.
 */

import { Firestore, type DocumentData } from "@google-cloud/firestore";

import {
  coerceRole,
  normalizeEmail,
  type AllowlistEntry,
  type AllowlistReader,
} from "./allowlist.ts";

export const ALLOWLIST_COLLECTION =
  process.env.ALLOWLIST_COLLECTION ?? "allowlist";

/**
 * Wall-clock ceiling on a single allowlist read.
 *
 * The SDK has its own retries, which is the right behaviour for a batch job
 * and the wrong one for a page load: a network partition would otherwise hang
 * the request rather than deny it. A timeout turns "Firestore is unreachable"
 * into `lookup-failed` promptly, which is also what lets the bootstrap owner
 * in without waiting on the retry ladder.
 */
export const FIRESTORE_TIMEOUT_MS = Number(
  process.env.ALLOWLIST_TIMEOUT_MS ?? 5000,
);

let client: Firestore | null = null;

function db(): Firestore {
  client ??= new Firestore({ ignoreUndefinedProperties: true });
  return client;
}

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label} did not answer within ${FIRESTORE_TIMEOUT_MS}ms`,
              ),
            ),
          FIRESTORE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Firestore document ids may not contain "/" and may not be "." or "..".
 * No real email address can, but the id is attacker-influenced (it comes from
 * whatever Google returned), so it is checked rather than assumed.
 */
function assertUsableAsDocId(email: string): void {
  if (!email || email.includes("/") || email === "." || email === "..") {
    throw new Error(`"${email}" cannot be used as a Firestore document id.`);
  }
}

/** A Firestore `Timestamp`, structurally. Kept local so nothing else imports it. */
function hasToDate(value: unknown): value is { toDate(): Date } {
  return (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  );
}

/**
 * `addedAt` is written as an ISO string by `allowlist.add`, but a row typed by
 * hand in the Firestore console will be a `Timestamp`, and one imported from
 * elsewhere could be a `Date`. All three are accepted; anything else becomes
 * null rather than being rendered as "[object Object]" in the admin table.
 */
function toEntry(email: string, data: DocumentData): AllowlistEntry {
  const addedAt: unknown = data.addedAt;
  return {
    email,
    role: coerceRole(data.role, email),
    addedBy: typeof data.addedBy === "string" ? data.addedBy : null,
    addedAt:
      typeof addedAt === "string"
        ? addedAt
        : addedAt instanceof Date
          ? addedAt.toISOString()
          : hasToDate(addedAt)
            ? addedAt.toDate().toISOString()
            : null,
  };
}

export function firestoreAllowlistReader(): AllowlistReader {
  return {
    async get(email) {
      const id = normalizeEmail(email);
      assertUsableAsDocId(id);
      const snapshot = await withTimeout(
        db().collection(ALLOWLIST_COLLECTION).doc(id).get(),
        `allowlist read for ${id}`,
      );
      const data = snapshot.data();
      if (!snapshot.exists || !data) return null;
      return toEntry(id, data);
    },

    async list() {
      // Capped: the admin page renders every row, and an unbounded query is a
      // cost and a render hazard if this collection is ever misused.
      const snapshot = await withTimeout(
        db().collection(ALLOWLIST_COLLECTION).limit(500).get(),
        "allowlist listing",
      );
      return snapshot.docs.map((doc) => toEntry(doc.id, doc.data()));
    },

    async put(entry) {
      assertUsableAsDocId(entry.email);
      await withTimeout(
        db()
          .collection(ALLOWLIST_COLLECTION)
          .doc(entry.email)
          .set({
            role: entry.role,
            addedBy: entry.addedBy,
            addedAt: entry.addedAt,
          }),
        `allowlist write for ${entry.email}`,
      );
    },

    async remove(email) {
      const id = normalizeEmail(email);
      assertUsableAsDocId(id);
      await withTimeout(
        db().collection(ALLOWLIST_COLLECTION).doc(id).delete(),
        `allowlist delete for ${id}`,
      );
    },
  };
}
