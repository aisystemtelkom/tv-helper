/**
 * The allowlist: who is permitted to use this app, and with what role.
 *
 * Operators sign in with ordinary gmail accounts, so domain restriction is
 * impossible and this list is load-bearing rather than optional. It is the
 * only thing this app persists server-side; documents and runs stay in the
 * browser's IndexedDB.
 *
 * This module is deliberately free of Firestore, Next, and Auth.js imports.
 * It takes an `AllowlistReader` and a clock, which is what lets the tests run
 * the whole decision surface -- including the Firestore-unreachable path --
 * with no GCP credentials anywhere.
 */

/** Roles, most privileged first. `admin` and `owner` may edit the allowlist. */
export const ROLES = ["owner", "admin", "member"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" && (ROLES as readonly string[]).includes(value)
  );
}

export function isAdminRole(role: Role): boolean {
  return role === "owner" || role === "admin";
}

export type AllowlistEntry = {
  /** Normalized email. Doubles as the Firestore document id. */
  email: string;
  role: Role;
  /** Email of the admin who added this entry, or null for unknown/imported. */
  addedBy: string | null;
  /** ISO 8601, or null when the stored record predates the field. */
  addedAt: string | null;
};

/**
 * The storage seam. `src/lib/auth/firestore.ts` is the production
 * implementation; the tests pass a fake, including one that throws.
 */
export type AllowlistReader = {
  get(email: string): Promise<AllowlistEntry | null>;
  list(): Promise<AllowlistEntry[]>;
  put(entry: AllowlistEntry): Promise<void>;
  remove(email: string): Promise<void>;
};

export type AllowlistDecision =
  | { allowed: true; email: string; role: Role; via: "bootstrap" | "allowlist" }
  | {
      allowed: false;
      email: string;
      /**
       * `not-listed` is a real answer from a reachable store. `lookup-failed`
       * means the store did not answer. Keeping them apart is the difference
       * between "revoked" and "Firestore is down", which is exactly what an
       * operator locked out at 9am needs the log to say.
       */
      reason: "not-listed" | "lookup-failed" | "no-email";
    };

/**
 * The hardcoded bootstrap owner, admitted EVEN IF Firestore is empty or
 * unreachable.
 *
 * DO NOT REMOVE THIS. It looks like a smell and it is the only thing standing
 * between an empty collection (or a mis-scoped IAM binding, or a Firestore
 * outage) and the owner being locked out of the very admin page that would fix
 * it. Without it the only way back in is a redeploy.
 *
 * The check short-circuits BEFORE the store is consulted, on purpose: a
 * Firestore call that hangs must not delay or deny this address either.
 * Consequently this address always resolves to `owner` and cannot be demoted
 * or removed through the admin page. That is intended.
 */
export const BOOTSTRAP_OWNER_EMAIL = "aisystemtelkom@gmail.com";

/**
 * Cache TTL. Revocation lands within this window rather than at JWT expiry.
 *
 * The trade is explicit: one Firestore read per minute per instance per email
 * instead of one read per request, in exchange for up to 60s of lag in both
 * directions (a removal keeps working for up to a minute, an addition takes up
 * to a minute to appear). Do not "fix" the lag by shortening JWT lifetime --
 * that is a different mechanism solving a different problem.
 */
export const ALLOWLIST_TTL_MS = 60_000;

/** Lowercase and trim. Firestore document ids are case-sensitive; emails are not. */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Coerce a stored role. An unrecognised string (a typo in the console, a field
 * renamed by hand) degrades to the least privileged role rather than being
 * guessed upward, and says so in the log. Denying outright would lock a real
 * operator out over a typo; silently promoting would be the wrong-and-quiet
 * failure this project cares most about.
 */
export function coerceRole(
  value: unknown,
  email: string,
  warn: (message: string) => void = console.warn,
): Role {
  if (isRole(value)) return value;
  warn(
    `[allowlist] ${email} has role ${JSON.stringify(value)}, which is not one ` +
      `of ${ROLES.join(", ")}. Treating it as "member".`,
  );
  return "member";
}

export type AllowlistOptions = {
  ttlMs?: number;
  now?: () => number;
  warn?: (message: string) => void;
};

export type Allowlist = {
  /** The authorization question. Cached for `ttlMs`. */
  lookup(email: string | null | undefined): Promise<AllowlistDecision>;
  /** Everything in the store, plus the bootstrap owner, sorted by email. */
  list(): Promise<AllowlistEntry[]>;
  add(entry: {
    email: string;
    role: Role;
    addedBy: string | null;
  }): Promise<AllowlistEntry>;
  remove(email: string): Promise<void>;
  /** Drop one cached answer. Used after a write so the admin sees their edit. */
  invalidate(email: string): void;
  /** Drop every cached answer. */
  clear(): void;
};

type CacheSlot = { at: number; decision: AllowlistDecision };

export function createAllowlist(
  reader: AllowlistReader,
  options: AllowlistOptions = {},
): Allowlist {
  const ttlMs = options.ttlMs ?? ALLOWLIST_TTL_MS;
  const now = options.now ?? Date.now;
  const warn = options.warn ?? console.warn;

  // Module-scoped state is real here because this runs in the ordinary server
  // runtime. The same cache in `src/proxy.ts` would be unreliable or simply
  // absent -- Next's own reference says proxy is invoked separately from render
  // code and must not rely on shared modules or globals.
  const cache = new Map<string, CacheSlot>();

  async function readFresh(email: string): Promise<AllowlistDecision> {
    let entry: AllowlistEntry | null;
    try {
      entry = await reader.get(email);
    } catch (error) {
      warn(
        `[allowlist] lookup of ${email} failed, denying: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { allowed: false, email, reason: "lookup-failed" };
    }
    if (!entry) return { allowed: false, email, reason: "not-listed" };
    return {
      allowed: true,
      email,
      role: coerceRole(entry.role, email, warn),
      via: "allowlist",
    };
  }

  return {
    async lookup(raw) {
      const email = normalizeEmail(raw);
      if (!email) return { allowed: false, email, reason: "no-email" };

      // See BOOTSTRAP_OWNER_EMAIL. Before the store, never after it.
      if (email === BOOTSTRAP_OWNER_EMAIL) {
        return { allowed: true, email, role: "owner", via: "bootstrap" };
      }

      const hit = cache.get(email);
      if (hit && now() - hit.at < ttlMs) return hit.decision;

      const decision = await readFresh(email);

      // A store failure is not an answer, so it is not cached. Caching it
      // would turn a five-second Firestore blip into a one-minute outage for
      // everyone, and would keep re-serving a denial after the store recovers.
      if (!(decision.allowed === false && decision.reason === "lookup-failed")) {
        cache.set(email, { at: now(), decision });
      }
      return decision;
    },

    async list() {
      const stored = await reader.list();
      const merged = stored.filter((e) => e.email !== BOOTSTRAP_OWNER_EMAIL);
      merged.push({
        email: BOOTSTRAP_OWNER_EMAIL,
        role: "owner",
        addedBy: null,
        addedAt: null,
      });
      return merged.sort((a, b) => a.email.localeCompare(b.email));
    },

    async add({ email, role, addedBy }) {
      const normalized = normalizeEmail(email);
      if (!normalized || !normalized.includes("@")) {
        throw new Error(`"${email}" is not an email address.`);
      }
      if (!isRole(role)) {
        throw new Error(`"${role}" is not one of ${ROLES.join(", ")}.`);
      }
      if (normalized === BOOTSTRAP_OWNER_EMAIL) {
        throw new Error(
          `${BOOTSTRAP_OWNER_EMAIL} is the hardcoded bootstrap owner. Its ` +
            "access does not come from this collection, so writing it here " +
            "would change nothing.",
        );
      }
      const entry: AllowlistEntry = {
        email: normalized,
        role,
        addedBy: normalizeEmail(addedBy) || null,
        addedAt: new Date(now()).toISOString(),
      };
      await reader.put(entry);
      cache.delete(normalized);
      return entry;
    },

    async remove(email) {
      const normalized = normalizeEmail(email);
      if (normalized === BOOTSTRAP_OWNER_EMAIL) {
        throw new Error(
          `${BOOTSTRAP_OWNER_EMAIL} cannot be removed. It is admitted by ` +
            "code, not by this collection, so deleting a row here would " +
            "report success and revoke nothing.",
        );
      }
      await reader.remove(normalized);
      cache.delete(normalized);
    },

    invalidate(email) {
      cache.delete(normalizeEmail(email));
    },

    clear() {
      cache.clear();
    },
  };
}
