/**
 * The app itself. This page processes client documents, so IT GATES ITSELF.
 *
 * `src/proxy.ts` also redirects an unauthenticated visitor away from here, and
 * that is the fast path, not the boundary. Next's own reference:
 *
 *   "A matcher change or a refactor that moves a Server Function to a different
 *    route can silently remove Proxy coverage. Always verify authentication and
 *    authorization inside each Server Function rather than relying on Proxy
 *    alone."
 *
 * Deleting the `authorize()` call below because "proxy already does it" is the
 * regression this whole design is organised against. It would also be invisible
 * in review: the page renders identically for a signed-in operator either way.
 *
 * Note what proxy could never have done here anyway. Proxy verifies the session
 * JWT signature and stops; it never reads Firestore, so it cannot tell a
 * currently-allowlisted operator from one who was removed this morning and
 * still holds a valid twelve-hour token. Only the guard asks that question.
 */

import { redirect } from "next/navigation";

import { authorize } from "@/lib/auth/require-user";

import { Assistant } from "./assistant";

// The gate reads the session cookie, so this page can never be prerendered.
// Without this it builds as a static route (`○ /` in the build output), and a
// static shell is a page whose HTML was produced before anyone signed in.
export const dynamic = "force-dynamic";

export default async function Home() {
  const result = await authorize();

  if (!result.ok) {
    // Not signed in at all: send them to sign in, which is what they need.
    // Signed in but refused: a redirect would bounce them straight back here
    // and look like a loop, so say why instead.
    if (result.reason === "unauthenticated") {
      // No `callbackUrl`: this page IS the sign-in page's default destination,
      // and a hand-built one here would be a second place to get the
      // open-redirect sanitising right.
      redirect("/signin");
    }

    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-8">
        <h1 className="text-xl font-semibold">tv-helper</h1>
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {result.message}
        </p>
        <p className="text-sm">
          <a href="/signin" className="underline">
            Sign in with a different account
          </a>
        </p>
      </main>
    );
  }

  return <Assistant />;
}
