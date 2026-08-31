/**
 * The two pieces of the sign-in page that read attacker-supplied query string
 * values. Kept out of `page.tsx` so `node --test` can drive them: this module
 * has no imports at all, so it loads with no Next runtime and no bundler.
 */

/**
 * `callbackUrl` arrives from the query string, so it is attacker-supplied: a
 * link to `/signin?callbackUrl=https://evil.example` would otherwise turn this
 * page into an open redirect that borrows the app's own hostname, which is
 * worth more to a phisher than a redirect from anywhere else.
 *
 * Only a same-origin absolute path is accepted. `//evil.example` is
 * protocol-relative, and `/\evil.example` is treated as protocol-relative by
 * some browsers, so both are refused alongside anything carrying a scheme.
 * Anything refused becomes `/`, which is the app itself: a failure here sends
 * the operator somewhere harmless rather than nowhere.
 */
export function safeCallbackUrl(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

/**
 * Auth.js redirects failures to `pages.error` as `?error=<code>`, and
 * `src/lib/auth/config.ts` points that at the sign-in page.
 *
 * `AccessDenied` is the one an operator will actually see: it is what the
 * `signIn` callback returns for an account that is not on the allowlist, so it
 * gets the sentence that tells them what to do about it.
 *
 * An unrecognised code is shown verbatim rather than swallowed. "Something went
 * wrong" would hide the only string that makes the failure searchable.
 */
export function signInErrorMessage(
  raw: string | string[] | undefined,
): string | null {
  const code = Array.isArray(raw) ? raw[0] : raw;
  if (!code) return null;
  switch (code) {
    case "AccessDenied":
      return (
        "That Google account is not on the allowlist. Ask an admin to add it, " +
        "then sign in again."
      );
    case "Configuration":
      return (
        "Sign-in is not configured on this deployment. AUTH_SECRET, " +
        "AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET all have to be set; see " +
        "docs/runbook-deploy.md."
      );
    case "Verification":
      return "That sign-in link has already been used or has expired.";
    default:
      return `Sign-in failed (${code}).`;
  }
}
