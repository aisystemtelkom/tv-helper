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

import { createGuard, type AuthorizeResult, type AuthorizedUser } from "./guard.ts";
import { allowlist } from "./instance.ts";
import { auth } from "./index.ts";

export {
  AuthorizationError,
  isAuthDisabled,
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
 * Convenience for route handlers:
 *
 *   const gate = await requireApiUser();
 *   if (gate.response) return gate.response;
 *   // gate.user is allowlisted
 */
export async function requireApiUser(): Promise<
  { user: AuthorizedUser; response: null } | { user: null; response: Response }
> {
  const result = await authorize();
  if (result.ok) return { user: result.user, response: null };
  return {
    user: null,
    response: Response.json(
      { error: result.reason, message: result.message },
      { status: result.status },
    ),
  };
}
