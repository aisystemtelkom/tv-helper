/**
 * Auth.js configuration. Google is the only provider and the OAuth code
 * exchange happens server-side.
 *
 * That is a deliberate choice over Firebase Auth's client SDK, which would put
 * `identitytoolkit.googleapis.com` into the page's request path and break the
 * `performance.getEntriesByType("resource")` check this project treats as
 * standing proof that the browser talks to nothing but this app. With the
 * server-side flow the only external hop is a top-level redirect during login,
 * not a resource request on the working page.
 */

import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

import { allowlist } from "./instance.ts";

/**
 * Session lifetime. This is hygiene, not the revocation mechanism: removing
 * someone from the allowlist takes effect within `ALLOWLIST_TTL_MS` because
 * every request re-checks the list, so there is no reason to shorten this
 * further and no reason to trust it to end access.
 */
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

export const authConfig: NextAuthConfig = {
  /**
   * OUR OWN SIGN-IN PAGE, AND THIS IS NOT COSMETIC.
   *
   * Auth.js's built-in sign-in page renders each OAuth provider's logo from
   * `https://authjs.dev/img/providers/<id>.svg` (see
   * `@auth/core/lib/pages/signin.js`, which hardcodes that host and falls back
   * to it because the bundled Google provider sets only `brandColor`). That is
   * a third-party host in the request path of a page this app serves, which is
   * the exact defect Firebase Auth was rejected for a few lines above. Shipping
   * the default page would have made that rejection incoherent.
   *
   * `src/app/signin/page.tsx` serves the same flow with no external reference.
   * `error` points at it too, so the whole signed-out surface is ours: an
   * account refused by the `signIn` callback below lands there as
   * `?error=AccessDenied` and is told it is not on the allowlist.
   *
   * `src/proxy.ts` must keep `signin` in its negative matcher, or this page
   * redirects to itself.
   */
  pages: {
    signIn: "/signin",
    error: "/signin",
  },

  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Only what the allowlist and the header need. Anything wider would ask
      // an operator to consent to more than this app uses.
      authorization: {
        params: { scope: "openid email profile", prompt: "select_account" },
      },
    }),
  ],

  // Signed JWTs, so there is no session store to run, back up, or pay for.
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },

  // Cloud Run terminates TLS and forwards the original host, so the callback
  // URL has to be derived from the forwarded headers. Set `AUTH_URL` to the
  // service URL as well; see docs/runbook-deploy.md.
  trustHost: true,

  callbacks: {
    /**
     * Refuse to mint a session for an account that is not on the list. This is
     * a convenience, not the boundary: `src/lib/auth/guard.ts` re-checks on
     * every request that matters, which is what makes revocation land within a
     * minute instead of at token expiry.
     */
    async signIn({ user }) {
      const decision = await allowlist().lookup(user.email);
      if (!decision.allowed) {
        console.warn(
          `[auth] refused sign-in for ${decision.email || "(no email)"}: ${decision.reason}`,
        );
        return false;
      }
      console.info(
        `[auth] sign-in ${decision.email} as ${decision.role} via ${decision.via}`,
      );
      return true;
    },

    /**
     * The JWT stays minimal on purpose. Nothing authorization-relevant is
     * copied into it: a role baked into a token is a role that keeps working
     * for as long as the token lives, which is the lag this design set out to
     * avoid.
     */
    async session({ session, token }) {
      if (session.user) session.user.email = token.email ?? session.user.email;
      return session;
    },
  },
};
