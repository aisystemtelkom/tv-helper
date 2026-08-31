/**
 * The sign-in page, served by this app.
 *
 * IT EXISTS TO KEEP A THIRD-PARTY HOST OUT OF THE REQUEST PATH. Auth.js's
 * built-in page renders each provider's logo from
 * `https://authjs.dev/img/providers/<id>.svg` -- `@auth/core/lib/pages/signin.js`
 * hardcodes that host, and the bundled Google provider sets only `brandColor`,
 * so nothing overrides it. One `<img>` to authjs.dev is the same defect that
 * got Firebase Auth rejected, on the one page every operator is guaranteed to
 * load. `pages.signIn` in `src/lib/auth/config.ts` points here instead, so
 * `/api/auth/signin` redirects here rather than rendering that page.
 *
 * There is deliberately no logo, no icon font and no external stylesheet here.
 * The check this project treats as standing proof --
 * `performance.getEntriesByType("resource")` showing only this host -- has to
 * pass on this page too, and the cheapest way to keep it passing is to leave
 * nothing to fetch.
 */

import { isAuthDisabled } from "@/lib/auth/guard";
import { signIn } from "@/lib/auth";

import { safeCallbackUrl, signInErrorMessage } from "./query.ts";

// Reads the query string and mints a CSRF-bearing form, so it can never be
// prerendered. Stated rather than inferred, so a refactor cannot turn one
// operator's sign-in form into a cached one.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in - tv-helper",
};

export default async function SignInPage(props: PageProps<"/signin">) {
  const params = await props.searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const error = signInErrorMessage(params.error);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">tv-helper</h1>
        <p className="text-sm text-neutral-600">
          Sign in with the Google account an admin has added to the allowlist.
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {error}
        </p>
      ) : null}

      {isAuthDisabled() ? (
        <p className="rounded border border-red-400 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
          AUTH_DISABLED is set and no OAuth client is configured, so there is
          nothing here to sign in to and every request is being served without
          authentication. This is the one-shot bootstrap deploy mode; finish
          step 5 in docs/runbook-deploy.md and redeploy.
        </p>
      ) : (
        <form
          action={async (formData: FormData) => {
            "use server";
            // Re-sanitized here rather than trusted from the form: a Server
            // Function is a POST anyone can shape, and this value becomes a
            // redirect target.
            await signIn("google", {
              redirectTo: safeCallbackUrl(
                formData.get("callbackUrl")?.toString(),
              ),
            });
          }}
        >
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <button
            type="submit"
            className="w-full rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Sign in with Google
          </button>
        </form>
      )}

      <p className="text-sm text-neutral-500">
        Signing in shares your Google account&rsquo;s email address and name
        with this app, and nothing else.
      </p>
    </main>
  );
}
