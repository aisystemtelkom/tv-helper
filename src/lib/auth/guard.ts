/**
 * The authorization boundary.
 *
 * Next 16's own reference is explicit that proxy is NOT this boundary: a
 * matcher change, or a refactor that moves a Server Function to a different
 * route, can silently remove proxy coverage, so authentication and
 * authorization must be verified inside each route handler, server component
 * and Server Function. `src/proxy.ts` therefore only does the cheap
 * unauthenticated redirect; the decision that counts is made here.
 *
 * This file has no Next and no Auth.js imports. Everything it needs arrives as
 * `GuardDeps`, which is what lets the tests exercise the real decision logic --
 * bootstrap owner with Firestore down included -- without a Next runtime or a
 * GCP credential. `src/lib/auth/require-user.ts` binds the production deps.
 */

import {
  isAdminRole,
  normalizeEmail,
  type Allowlist,
  type Role,
} from "./allowlist.ts";

/** The shape we need from an Auth.js session. Structural, so tests can fake it. */
export type SessionLike = {
  user?: {
    email?: string | null;
    name?: string | null;
    image?: string | null;
  } | null;
} | null;

export type AuthorizedUser = {
  email: string;
  name: string | null;
  image: string | null;
  role: Role;
  isAdmin: boolean;
  via: "bootstrap" | "allowlist" | "auth-disabled";
};

export type DenialReason =
  | "unauthenticated"
  | "no-email"
  | "not-listed"
  | "lookup-failed"
  | "not-admin";

export type AuthorizeResult =
  | { ok: true; user: AuthorizedUser }
  | { ok: false; status: 401 | 403; reason: DenialReason; message: string };

const DENIAL_MESSAGE: Record<DenialReason, string> = {
  unauthenticated: "Sign in with Google to continue.",
  "no-email": "Your Google account did not return an email address.",
  "not-listed": "This account is not on the allowlist. Ask an admin to add it.",
  "lookup-failed":
    "The allowlist could not be read, so access is denied. This is a server " +
    "problem, not a permissions one -- check the Firestore binding.",
  "not-admin": "This page is for admins only.",
};

/**
 * The bootstrap deploy escape hatch, used once to mint the Cloud Run URL the
 * OAuth client needs (see docs/runbook-deploy.md -- the redirect URI is
 * circular). Two conditions must hold, not one:
 *
 *   1. `AUTH_DISABLED` is exactly "true", set deliberately, and
 *   2. no Google OAuth client is configured.
 *
 * The second condition is the interlock. Once the real client id is mounted the
 * switch stops working, so a forgotten `AUTH_DISABLED=true` cannot quietly
 * un-gate a live deployment -- which is the failure shape this whole project
 * is organised against. It also means the switch cannot be used to bypass a
 * working install without also tearing out its OAuth config.
 *
 * While it is on, callers are admitted as an anonymous `member`, never an
 * admin, so the allowlist itself stays un-editable during the window.
 */
export function isAuthDisabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.AUTH_DISABLED === "true" && !env.AUTH_GOOGLE_ID;
}

export type GuardDeps = {
  getSession: () => Promise<SessionLike>;
  /**
   * A getter, not the object: the production allowlist builds a Firestore
   * client on first call, and doing that at module scope would move a missing
   * credential from the request that needs it to the build that collects the
   * routes.
   */
  allowlist: () => Allowlist;
  /** Defaults to reading the process environment. */
  authDisabled?: () => boolean;
  warn?: (message: string) => void;
};

export type Guard = {
  /** Non-throwing. Route handlers and pages that render their own denial. */
  authorize(): Promise<AuthorizeResult>;
  /** Throws `AuthorizationError` unless the caller is on the allowlist. */
  requireUser(): Promise<AuthorizedUser>;
  /** Throws `AuthorizationError` unless the caller is an admin or the owner. */
  requireAdmin(): Promise<AuthorizedUser>;
};

/** Thrown by `requireUser` / `requireAdmin`. Carries the HTTP status to send. */
export class AuthorizationError extends Error {
  readonly status: 401 | 403;
  readonly reason: DenialReason;

  constructor(status: 401 | 403, reason: DenialReason, message: string) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
    this.reason = reason;
  }
}

function deny(
  status: 401 | 403,
  reason: DenialReason,
): AuthorizeResult & { ok: false } {
  return { ok: false, status, reason, message: DENIAL_MESSAGE[reason] };
}

export function createGuard(deps: GuardDeps): Guard {
  const authDisabled = deps.authDisabled ?? (() => isAuthDisabled());
  const warn = deps.warn ?? console.warn;

  async function authorize(): Promise<AuthorizeResult> {
    if (authDisabled()) {
      warn(
        "[auth] AUTH_DISABLED=true and no AUTH_GOOGLE_ID: serving this " +
          "request WITHOUT authentication. This is the one-shot bootstrap " +
          "deploy mode. If you are seeing this on a live deployment, the " +
          "OAuth client is not mounted and the app is open.",
      );
      return {
        ok: true,
        user: {
          email: "",
          name: null,
          image: null,
          role: "member",
          isAdmin: false,
          via: "auth-disabled",
        },
      };
    }

    const session = await deps.getSession();
    const email = normalizeEmail(session?.user?.email);
    if (!session?.user) return deny(401, "unauthenticated");
    if (!email) return deny(403, "no-email");

    // Re-checked on every request that matters, not read off the JWT. This is
    // what makes revocation land within the allowlist TTL instead of at token
    // expiry.
    const decision = await deps.allowlist().lookup(email);
    if (!decision.allowed) return deny(403, decision.reason);

    return {
      ok: true,
      user: {
        email: decision.email,
        name: session.user.name ?? null,
        image: session.user.image ?? null,
        role: decision.role,
        isAdmin: isAdminRole(decision.role),
        via: decision.via,
      },
    };
  }

  async function requireUser(): Promise<AuthorizedUser> {
    const result = await authorize();
    if (!result.ok) {
      throw new AuthorizationError(result.status, result.reason, result.message);
    }
    return result.user;
  }

  async function requireAdmin(): Promise<AuthorizedUser> {
    const user = await requireUser();
    if (!user.isAdmin) {
      throw new AuthorizationError(403, "not-admin", DENIAL_MESSAGE["not-admin"]);
    }
    return user;
  }

  return { authorize, requireUser, requireAdmin };
}
