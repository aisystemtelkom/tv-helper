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
      { error: "unauthenticated", message: "Sign in with Google to continue." },
      { status: 401 },
    );
  }

  const signIn = new URL("/api/auth/signin", request.url);
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
   * in front of the vendored tesseract wasm and `ind.traineddata` under
   * `/tesseract/`. Those are fetched by a Web Worker that does not carry the
   * session cookie the way a document request does, and a redirect there is an
   * OCR failure with no obvious cause.
   *
   * `api/auth` is excluded because the sign-in flow itself must be reachable
   * while signed out; excluding it is what stops the redirect loop.
   *
   * Adding a route that must be public means editing this line -- and per the
   * warning at the top of the file, editing this line is exactly what cannot be
   * allowed to decide whether that route is protected. It is not; the guard is.
   */
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|tesseract/).*)",
  ],
};
