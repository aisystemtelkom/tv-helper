/**
 * The allowlist admin page. Admins and the owner only.
 *
 * It renders its own denial rather than throwing, so a member who follows a
 * link here gets a sentence instead of a stack trace. The mutations in
 * `actions.ts` re-check independently -- rendering a page is not what
 * authorizes a write.
 */

import Link from "next/link";

import { isAuthDisabled } from "@/lib/auth/guard";
import { allowlist } from "@/lib/auth/instance";
import { authorize } from "@/lib/auth/require-user";

import { AllowlistEditor } from "./allowlist-editor";

// The page depends on the session cookie, so it can never be prerendered.
// Stated rather than inferred: a future refactor that stops reading cookies at
// render time must not be allowed to turn this into a cached page.
export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Allowlist</h1>
        <p className="text-sm text-neutral-600">
          Who may sign in to tv-helper. Changes take effect within 60 seconds on
          every running instance.
        </p>
      </header>
      {children}
      <footer className="text-sm">
        <Link href="/" className="underline">
          Back to the app
        </Link>
      </footer>
    </main>
  );
}

export default async function AdminPage() {
  const result = await authorize();

  if (!result.ok) {
    return (
      <Shell>
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {result.message}
        </p>
      </Shell>
    );
  }

  if (!result.user.isAdmin) {
    return (
      <Shell>
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {result.user.via === "auth-disabled"
            ? "Authentication is disabled on this deployment, so there is no " +
              "admin to be. Finish the OAuth setup in docs/runbook-deploy.md " +
              "and redeploy."
            : `Signed in as ${result.user.email} (${result.user.role}). This page is for admins only.`}
        </p>
      </Shell>
    );
  }

  let entries;
  try {
    entries = await allowlist().list();
  } catch (error) {
    return (
      <Shell>
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          The allowlist could not be read:{" "}
          {error instanceof Error ? error.message : String(error)}. You are
          seeing this page because{" "}
          {result.user.via === "bootstrap"
            ? "you are the hardcoded bootstrap owner, which is what that rule exists for."
            : "your allowlist entry was still cached."}
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      {isAuthDisabled() ? (
        <p className="rounded border border-red-400 bg-red-50 px-3 py-2 text-sm font-medium text-red-900">
          AUTH_DISABLED is set and no OAuth client is configured. Every request
          is being served without authentication. This is bootstrap mode only.
        </p>
      ) : null}
      <p className="text-sm text-neutral-600">
        Signed in as {result.user.email} ({result.user.role}, via{" "}
        {result.user.via}).
      </p>
      <AllowlistEditor entries={entries} />
    </Shell>
  );
}
