/**
 * The orders saved on this device. IT GATES ITSELF, like every other page that
 * can reach client material.
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
 * regression the whole design is organised against, and it would be invisible
 * in review: the page renders identically for a signed-in operator either way.
 * `src/app/page.tsx` carries the longer version of this argument, including
 * the part proxy could never do -- it verifies the session JWT and stops, so
 * it cannot tell a currently-allowlisted operator from one who was removed
 * this morning and still holds a valid twelve-hour token.
 *
 * NOTE what this page exposes if the gate is dropped. The list itself is read
 * from IndexedDB in the visitor's own browser, so an unauthorised visitor
 * would see their own empty device rather than somebody else's orders -- which
 * is exactly the reasoning that makes it tempting to skip the gate here. It is
 * still wrong: the page names the product, states how work is stored, and is
 * one edit away from carrying something read server-side. The rule is that
 * every page behind the login checks, not that every page has already been
 * proven to leak.
 *
 * ## The refusal is NOT written again here
 *
 * `src/app/page.tsx` renders three different refusal screens, told apart by
 * whether the cause is a decision (not on the allowlist), the account (no
 * email) or a fault (the allowlist could not be read). Rewriting any of that
 * here would give one refusal two wordings and let them drift. So a refused
 * visitor is sent to `/`, which says why, in the guard's own sentence -- and
 * an unauthenticated one is sent to sign in directly rather than through it.
 *
 * That is not the loop `page.tsx` warns about. There, redirecting a refused
 * operator would bounce them back to the page they were refused from; here the
 * destination is a different route that answers rather than refuses again.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { Otak } from "@/components/operator/icons";
import { RiwayatScreen } from "@/components/operator/riwayat";
import { authorize } from "@/lib/auth/require-user";

// The gate reads the session cookie, so this page can never be prerendered.
// Without this it builds as a static route and a static shell is a page whose
// HTML was produced before anyone signed in.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Riwayat Order - TV Validator",
};

export default async function RiwayatPage() {
  const result = await authorize();

  if (!result.ok) {
    // Sign-in is what an unauthenticated visitor needs, and `/` would only
    // forward them here anyway. No `callbackUrl`: `/` is the sign-in page's
    // default destination and a hand-built one here would be a second place to
    // get the open-redirect sanitising right.
    if (result.reason === "unauthenticated") redirect("/signin");
    redirect("/");
  }

  return (
    <>
      {/* THE APPLICATION STRIP. Glass, because it stays still while the list
          scrolls under it -- the one question the design system asks before
          handing out a material.

          IT IS A THIRD COPY OF THIS BAR, and `src/app/admin/page.tsx` already
          records the same thing about its own: "this wants to be the product's
          one shared strip rather than a local copy". Repeated rather than
          extracted here because the extraction is its own change across three
          files, and a half-done one would leave the product with a shared
          strip AND two local ones. Note the difference from the workspace's:
          no account menu, because the way to this page IS that menu, and a
          menu whose only new entry points at the page you are standing on is
          furniture. */}
      {/* THE WORKSPACE'S OWN MEASURE, `max-w-[92rem] px-5`, NOT the admin
          page's `max-w-4xl`. This list used to live inside the operator column
          at that width, and it is a grid of order cards rather than a register
          or a form: narrowing it squeezes each card until the "+2 berkas lagi"
          that says an order is a BUNDLE is the first thing CSS truncates away.
          Measured at 1440: at `max-w-4xl` the count is clipped mid-word. */}
      <header className="lt-rail border-b">
        <div className="mx-auto flex h-14 w-full max-w-[92rem] items-center justify-between gap-5 px-5">
          <Link href="/" className="lt-wordmark inline-flex items-center gap-2">
            <Otak size={24} />
            TV VALIDATOR
          </Link>
          {/* THE ORDER YOU WERE IN IS NOT CARRIED BACK BY THIS KEY, and that
              is worth knowing rather than hiding. Which run is open lives in
              the workspace's URL fragment, a fragment does not survive a
              navigation to another route, so this lands on a fresh workspace.
              Nothing is lost -- every order is on the device, and the rows
              below are the way back INTO one, which is the move this page
              exists for. The browser's own Back button returns to the exact
              order, fragment and all, because the workspace writes it with
              `history.replaceState`. */}
          <Link href="/" className="lt-btn">
            Kembali ke aplikasi
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[92rem] flex-col gap-6 px-5 py-6">
        <RiwayatScreen />
      </main>
    </>
  );
}
