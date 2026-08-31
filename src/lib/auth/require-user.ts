/**
 * The app-facing authorization helpers. Thin bindings of `createGuard` to the
 * real Auth.js session and the real Firestore-backed allowlist.
 *
 * CALL ONE OF THESE IN EVERY ROUTE HANDLER, SERVER COMPONENT AND SERVER
 * FUNCTION THAT TOUCHES A RUN. `src/proxy.ts` is an optimization, not the gate:
 * Next's own reference warns that a matcher change, or moving a Server Function
 * to another route, can silently remove proxy coverage.
 *
 *   Server component / Server Function : `await requireUser()` (throws)
 *   Route handler                      : `await authorize()` then map to a status
 *   Admin-only                         : `await requireAdmin()` (throws)
 */

import {
  createGuard,
  type ApiGate,
  type AuthorizeResult,
  type AuthorizedUser,
} from "./guard.ts";
import { allowlist } from "./instance.ts";
import { auth } from "./index.ts";

export {
  AuthorizationError,
  isAuthDisabled,
  type ApiGate,
  type AuthorizedUser,
  type AuthorizeResult,
  type DenialReason,
} from "./guard.ts";

const guard = createGuard({
  getSession: () => auth(),
  allowlist,
});

/** Non-throwing. Returns the caller, or the status and reason to send back. */
export function authorize(): Promise<AuthorizeResult> {
  return guard.authorize();
}

/** Throws `AuthorizationError` (401 or 403) unless the caller is allowlisted. */
export function requireUser(): Promise<AuthorizedUser> {
  return guard.requireUser();
}

/** Throws `AuthorizationError` unless the caller's role is `admin` or `owner`. */
export function requireAdmin(): Promise<AuthorizedUser> {
  return guard.requireAdmin();
}

/**
 * The gate for route handlers:
 *
 *   const gate = await requireApiUser();
 *   if (gate.response) return gate.response;
 *   // gate.user is allowlisted
 *
 * This is `guard.apiUser()` bound to the production session and allowlist, so
 * the 401/403 mapping a route sends is the same code path
 * `src/lib/auth/auth.test.mts` drives with no Next runtime.
 */
export function requireApiUser(): Promise<ApiGate> {
  return guard.apiUser();
}
