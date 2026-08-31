/**
 * The one process-wide `Allowlist`, and therefore the one 60s cache.
 *
 * Built lazily so that a missing GCP credential fails the request that needs
 * it rather than the build that collects the routes -- the same reasoning
 * `src/lib/model.ts` records for the Gemini client.
 */

import { createAllowlist, type Allowlist } from "./allowlist.ts";
import { firestoreAllowlistReader } from "./firestore.ts";

let instance: Allowlist | null = null;

export function allowlist(): Allowlist {
  instance ??= createAllowlist(firestoreAllowlistReader());
  return instance;
}
