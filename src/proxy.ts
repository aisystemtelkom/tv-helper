/**
 * PROXY IS NOT THE AUTHORIZATION BOUNDARY.
 *
 * `src/lib/auth/guard.ts`, reached through `requireUser()` / `requireAdmin()`,
 * is. Next 16's own reference says why, and it is not a style preference:
 *
 *   "A matcher change or a refactor that moves a Server Function to a different
 *    route can silently remove Proxy coverage. Always verify authentication and
 *    authorization inside each Server Function rather than relying on Proxy
 *    alone."
 *
 * The same page also warns that proxy "is meant to be invoked separately of
 * your render code and in optimized cases deployed to your CDN [...] you should
 * not attempt relying on shared modules or globals". So the 60s allowlist cache
 * cannot live here either -- module state here is unreliable or simply absent.
 *
 * What this file does, and all it does: turn "no valid session cookie" into a
 * redirect to sign-in (or a 401 for /api), so an unauthenticated visitor gets a
 * login page instead of a rendered shell. It verifies the JWT signature, which
 * is stateless and needs nothing but `AUTH_SECRET`, and it never touches
 * Firestore. Being on the allowlist is a different question and is asked later,
 * by the guard, on every request.
 *
 * NOTE (v16): this file is `proxy.ts`, not `middleware.ts`, and the export is
 * `proxy`. The old convention is deprecated. Verified against
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Auth.js picks the cookie name from whether its URL is https. Rather than
 * re-deriving that here and getting it wrong on one of the two deployments,
 * look at which cookie the browser actually sent.
 */
const SECURE_COOKIE = "__Secure-authjs.session-token";

function usesSecureCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(
      (cookie) =>
        cookie.name === SECURE_COOKIE ||
        // Large sessions are split into `<name>.0`, `<name>.1`, ...
        cookie.name.startsWith(`${SECURE_COOKIE}.`),
    );
}

export async function proxy(request: NextRequest) {
  // Mirrors `isAuthDisabled()` in src/lib/auth/guard.ts. Duplicated rather than
  // imported because proxy must not depend on shared module state; the guard
  // remains the copy that decides anything.
  if (process.env.AUTH_DISABLED === "true" && !process.env.AUTH_GOOGLE_ID) {
    return NextResponse.next();
  }

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  const token = secret
    ? await getToken({
        req: request,
        secret,
        secureCookie: usesSecureCookie(request),
      })
    : null;

  if (token) return NextResponse.next();

  // An API caller following a 307 to an HTML sign-in page gets a confusing
  // 200 full of markup instead of an error. Say 401 and let the caller decide.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: "unauthenticated",
        // Deliberately the same sentence as the guard's `unauthenticated`
        // arm in src/lib/auth/guard.ts. This file cannot import it (Proxy
        // runs in a different runtime), so the two are hand-kept in step,
        // and a request answered in two languages depending on which layer
        // refused it is the reason that coupling is worth the duplication.
        message: "Anda belum masuk. Masuk dengan Akun Google untuk melanjutkan.",
      },
      { status: 401 },
    );
  }

  // `/signin`, this app's own page, not Auth.js's `/api/auth/signin`. The
  // built-in one renders the provider logo from `https://authjs.dev/img/...`,
  // which would put a third party in the request path of a page this app
  // serves. See src/app/signin/page.tsx and `pages` in src/lib/auth/config.ts.
  const signIn = new URL("/signin", request.url);
  signIn.searchParams.set(
    "callbackUrl",
    request.nextUrl.pathname + request.nextUrl.search,
  );
  return NextResponse.redirect(signIn);
}

export const config = {
  /**
   * Negative matcher. Without one, proxy runs on every request including
   * `_next/static`, `_next/image` and everything in `public/`, which would put
   * an auth redirect in front of the CSS and -- the reason this project cares --
   * in front of anything under `public/`. (This used to also exempt the
   * vendored tesseract assets under `/tesseract/`; that engine and its
   * assets were removed when scans moved to Cloud Vision.)
   * redirect to an HTML sign-in page arriving where a wasm binary was expected
   * is an OCR failure with no obvious cause.
   *
   * THAT FAILURE HAS MOVED, AND THE RECORD OF IT IS WHY THIS PARAGRAPH STAYS.
   * Since the Gemini OCR migration the same Web Worker POSTs each rendered page
   * to `/api/ocr` instead of loading a wasm engine, so the request that must
   * not be silently redirected is now an API call. `/api/ocr` is deliberately
   * INSIDE this matcher: the branch above answers any unauthenticated `/api/`
   * request with a 401 JSON body rather than a 307, so the worker sees a status
   * it can report instead of a 200 full of markup. Adding `api/ocr` to the
   * exclusions would remove that refusal for no gain -- the route gates itself
   * with `requireApiUser()` regardless, which is the check that decides.
   *
   * `api/auth` and `signin` are excluded because the sign-in flow itself must
   * be reachable while signed out; excluding both is what stops the redirect
   * loop. `signin` is this app's own page (src/app/signin/page.tsx) and it is
   * where the redirect above points, so dropping it from this list turns every
   * signed-out visit into a redirect to itself.
   *
   * `api/health` is excluded because Cloud Run's probe carries no session
   * cookie. Without the exclusion the branch above answers it 401, the
   * platform reads that as unhealthy, and it restarts a container that was
   * serving every real request correctly. `src/app/api/health/route.ts` is
   * the other half of this and the two must move together; it is also the one
   * route in the app that deliberately does not call the guard.
   *
   * `privacy` is excluded because Google requires a publicly reachable privacy
   * policy URL before it will let the OAuth consent screen be published, and a
   * policy behind a login is not a policy. Publishing is not cosmetic here: in
   * Testing mode only accounts on Google's own test-user list may sign in, so
   * every operator would have to be added in the Cloud console AS WELL AS to
   * this app's allowlist -- which is exactly what the admin page exists to
   * avoid. `src/app/privacy/page.tsx` is the other half of this exclusion and
   * deliberately does not call the guard.
   *
   * Adding a route that must be public means editing this line -- and per the
   * warning at the top of the file, editing this line is exactly what cannot be
   * allowed to decide whether that route is protected. It is not; the guard is.
   */
  matcher: [
    "/((?!api/auth|api/health|signin|privacy|_next/static|_next/image|favicon.ico).*)",
  ],
};
