/**
 * The one process-wide `Allowlist`, and therefore the one 60s cache.
 *
 * Built lazily so that a missing GCP credential fails the request that needs
 * it rather than the build that collects the routes -- the same reasoning
 * `src/lib/model.ts` records for the Gemini client.
 *
 * ## Two stores, chosen by whether `ALLOWLIST_BUCKET` is set
 *
 * Firestore is the better store and stays the default. Cloud Storage exists
 * because `roles/editor` cannot create a Firestore database, which is the role
 * this project's deploying account actually holds; see the header of
 * `./gcs.ts` for the permission checks behind that. The choice is made from an
 * environment variable rather than by probing at runtime, because a store that
 * silently falls back would answer "nobody is on the allowlist" during a
 * Firestore outage -- and that reads as a mass revocation rather than as the
 * outage it is.
 */

import { createAllowlist, type Allowlist } from "./allowlist.ts";
import { firestoreAllowlistReader } from "./firestore.ts";
import { ALLOWLIST_BUCKET, gcsAllowlistReader } from "./gcs.ts";

let instance: Allowlist | null = null;

/** Which store `allowlist()` will use. Reported by `/api/health`. */
export function allowlistStore(): "gcs" | "firestore" {
  return ALLOWLIST_BUCKET ? "gcs" : "firestore";
}

export function allowlist(): Allowlist {
  instance ??= createAllowlist(
    allowlistStore() === "gcs"
      ? gcsAllowlistReader()
      : firestoreAllowlistReader(),
  );
  return instance;
}
