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

/**
 * A refusal, in two halves, because it has two audiences.
 *
 * `message` is the sentence an OPERATOR reads. Bahasa Indonesia, and it names
 * the one thing they can do next, which is nearly always "ask an administrator
 * to add your address". It must stand alone: a caller is free to render
 * nothing else.
 *
 * `detail` is for whoever DEPLOYED the app: a binding, a service account, a
 * path into the runbook. It is rendered SEPARATELY (`TechnicalDetail` in
 * `src/components/operator/chrome.tsx` is the pattern, and
 * `src/app/signin/query.ts` splits its own failures the same way), never
 * appended to the operator's sentence. `lookup-failed` used to carry "check
 * the Firestore binding" inside the refusal itself, which told an operator to
 * go and repair a database they have never heard of.
 */
export type DenialText = {
  message: string;
  detail?: string;
};

export type AuthorizeResult =
  | { ok: true; user: AuthorizedUser }
  | {
      ok: false;
      status: 401 | 403;
      reason: DenialReason;
      message: string;
      /**
       * Deployer-facing, and absent on the refusals an operator causes.
       * Render it apart from `message` or not at all; never concatenate it.
       */
      detail?: string;
    };

const DENIAL_TEXT: Record<DenialReason, DenialText> = {
  unauthenticated: {
    message: "Anda belum masuk. Masuk dengan Google untuk melanjutkan.",
  },
  "no-email": {
    message:
      "Akun Google Anda tidak memberikan alamat email, jadi tidak ada yang " +
      "bisa dicocokkan dengan daftar izin akses. Masuk lagi memakai akun " +
      "Google yang punya alamat email.",
  },
  "not-listed": {
    message:
      "Alamat email ini belum terdaftar di daftar izin akses. Minta " +
      "administrator menambahkannya, lalu masuk lagi.",
  },
  "lookup-failed": {
    message:
      "Daftar izin akses tidak dapat dibaca, jadi akses ditolak. Ini masalah " +
      "server, bukan masalah izin Anda. Coba lagi beberapa saat lagi, dan " +
      "beri tahu administrator kalau tetap gagal.",
    // Same register as the sign-in page's technical half: an Indonesian
    // sentence carrying the names a deployer needs to search for.
    detail:
      "Firestore: pembacaan daftar izin akses gagal, jadi semua akun selain " +
      "pemilik bootstrap ditolak. Periksa binding Firestore dan akses " +
      "service account ke koleksi allowlist. Lihat docs/runbook-deploy.md.",
  },
  "not-admin": {
    message:
      "Halaman ini hanya untuk administrator. Minta bantuan administrator " +
      "untuk perubahan ini, lalu kembali ke halaman utama untuk melanjutkan " +
      "order Anda.",
  },
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

/**
 * What a route handler gets back from `apiUser()`. Exactly one side is
 * populated, so `if (gate.response) return gate.response;` is the whole
 * calling convention and TypeScript narrows `gate.user` after it.
 */
export type ApiGate =
  | { user: AuthorizedUser; response: null }
  | { user: null; response: Response };

export type Guard = {
  /** Non-throwing. Route handlers and pages that render their own denial. */
  authorize(): Promise<AuthorizeResult>;
  /** Throws `AuthorizationError` unless the caller is on the allowlist. */
  requireUser(): Promise<AuthorizedUser>;
  /** Throws `AuthorizationError` unless the caller is an admin or the owner. */
  requireAdmin(): Promise<AuthorizedUser>;
  /** Non-throwing, for route handlers: the caller, or the Response to send. */
  apiUser(): Promise<ApiGate>;
};

/**
 * The denial a route handler sends. JSON rather than an HTML sign-in page,
 * because an API caller following a redirect to markup gets a confusing 200
 * instead of an error. `src/proxy.ts` sends the same shape for the same reason,
 * so a caller sees one answer whether or not proxy ran.
 *
 * That second sentence is a standing obligation, not an observation: proxy
 * HAND-COPIES the unauthenticated body, `message` string and all, because it
 * runs in a runtime this module is deliberately kept out of. Change the
 * `unauthenticated` text here and proxy's copy has to move with it, or one
 * request in two answers in a different language.
 */
export function denialResponse(result: AuthorizeResult): Response | null {
  if (result.ok) return null;
  return Response.json(
    {
      error: result.reason,
      message: result.message,
      // Only when there is one, so a caller can test for the key rather than
      // rendering an empty `Detail teknis` disclosure on every refusal.
      ...(result.detail ? { detail: result.detail } : {}),
    },
    { status: result.status },
  );
}

/** Thrown by `requireUser` / `requireAdmin`. Carries the HTTP status to send. */
export class AuthorizationError extends Error {
  readonly status: 401 | 403;
  readonly reason: DenialReason;
  /**
   * The deployer's half of the refusal, kept off `message` on purpose:
   * `src/app/admin/actions.ts` returns `error.message` straight to the screen,
   * so anything folded into it is read by an operator.
   */
  readonly detail?: string;

  constructor(
    status: 401 | 403,
    reason: DenialReason,
    message: string,
    detail?: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
    this.reason = reason;
    this.detail = detail;
  }
}

function deny(
  status: 401 | 403,
  reason: DenialReason,
): AuthorizeResult & { ok: false } {
  const text = DENIAL_TEXT[reason];
  return {
    ok: false,
    status,
    reason,
    message: text.message,
    // Spread rather than assigned, so a refusal with no deployer half has no
    // `detail` KEY at all. `detail: undefined` is a different object under
    // `assert.deepEqual` and a different JSON body.
    ...(text.detail ? { detail: text.detail } : {}),
  };
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
      throw new AuthorizationError(
        result.status,
        result.reason,
        result.message,
        result.detail,
      );
    }
    return result.user;
  }

  async function requireAdmin(): Promise<AuthorizedUser> {
    const user = await requireUser();
    if (!user.isAdmin) {
      const text = DENIAL_TEXT["not-admin"];
      throw new AuthorizationError(403, "not-admin", text.message, text.detail);
    }
    return user;
  }

  async function apiUser(): Promise<ApiGate> {
    const result = await authorize();
    if (result.ok) return { user: result.user, response: null };
    // `denialResponse` returns null only for an ok result, which this branch
    // has already excluded.
    return { user: null, response: denialResponse(result) as Response };
  }

  return { authorize, requireUser, requireAdmin, apiUser };
}
