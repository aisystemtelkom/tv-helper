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
 *
 * ## The refused screen is three different screens
 *
 * It used to be one: `result.message` in an amber block, whatever the reason.
 * So during a Firestore outage every operator saw a message styled exactly
 * like "you are not on the list", and an outage got reported as a permissions
 * problem by everyone at once. A refusal and a fault are different objects
 * here, told apart by the heading, by the action, by whether the signed-in
 * address is quoted, and by whether the correction pen appears at all:
 *
 *   not-listed     a decision, working as designed. No colour, and the remedy
 *                  is an admin, so the screen carries the address to quote.
 *   no-email       the Google account gave nothing to match. No colour either:
 *                  the operator can act on it, with a different account.
 *   lookup-failed  the ALLOWLIST is unreadable. Nothing here is about this
 *                  operator, so this one wears the pen, quotes no address, and
 *                  is the only case where trying again is the right move.
 *
 * THE SENTENCE ITSELF IS NOT WRITTEN HERE. `guard.ts` owns it, in Bahasa, and
 * it carries a separate `detail` for whoever deployed the app. This page owns
 * the SHAPE of the refusal and renders those two halves apart. Re-writing the
 * sentence here would give one refusal two wordings, and the API refusal and
 * this screen would drift.
 *
 * There is a fourth screen, and it is the admitted one: while the bootstrap
 * `AUTH_DISABLED` mode is on, the guard says yes to everybody, and the app
 * used to open for any visitor with nothing on screen to say so. See the band
 * at the foot of this file.
 */

import { redirect } from "next/navigation";

import { OperatorApp } from "@/components/operator/operator-app";
import { Interruption, TechnicalDetail } from "@/components/operator/chrome";
import { authorize, type DenialReason } from "@/lib/auth/require-user";
import { auth } from "@/lib/auth";

// The gate reads the session cookie, so this page can never be prerendered.
// Without this it builds as a static route (`○ /` in the build output), and a
// static shell is a page whose HTML was produced before anyone signed in.
export const dynamic = "force-dynamic";

/** A control printed on paper: dark ink on the sheet, not a lit key on the table. */
const ACTION_CLASS =
  "inline-flex items-center justify-center self-start rounded-[4px] border " +
  "px-4 py-2 text-[0.9375rem] font-semibold transition-opacity hover:opacity-90";
const ACTION_STYLE = {
  background: "var(--paper-ink)",
  color: "var(--paper)",
  borderColor: "var(--paper-ink)",
};

type Refusal = {
  /** Short, and complementary to the guard's sentence rather than a repeat. */
  title: string;
  action: { label: string; href: string };
  /**
   * The correction pen. It means the APP is at fault, not this account, which
   * is why an operator who was simply never added does not get it: nothing is
   * broken there, and red on a healthy screen teaches an operator to stop
   * reading red.
   */
  fault: boolean;
  /**
   * Whether to print the signed-in address. It belongs on a refusal that is
   * ABOUT the account, where the operator's next move is to quote it to an
   * admin. Printing it under "the allowlist could not be read" would say the
   * account is the problem, which is the exact confusion this screen was split
   * up to end.
   */
  account: boolean;
};

function refusalFor(reason: DenialReason): Refusal {
  switch (reason) {
    case "not-listed":
      return {
        title: "Akun Anda belum punya izin.",
        action: { label: "Masuk dengan akun lain", href: "/signin" },
        fault: false,
        account: true,
      };
    case "no-email":
      return {
        title: "Akun ini tidak bisa dikenali.",
        action: { label: "Masuk dengan akun lain", href: "/signin" },
        fault: false,
        account: false,
      };
    case "lookup-failed":
      return {
        title: "Aplikasi tidak bisa memeriksa izin Anda.",
        action: { label: "Coba lagi", href: "/" },
        fault: true,
        account: false,
      };
    default:
      // `not-admin` never reaches here (that is the admin page's answer), and
      // `unauthenticated` is redirected above. A reason added later lands here
      // rather than rendering an empty screen.
      return {
        title: "Akses ditolak.",
        action: { label: "Masuk dengan akun lain", href: "/signin" },
        fault: true,
        account: true,
      };
  }
}

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

    // DISPLAY ONLY, and only on the path where access has already been
    // refused. `auth()` answers "who is this", which is not the question the
    // guard just answered, and nothing below it decides anything: the address
    // is here so the operator can paste the right one into a message to an
    // admin. The refusal itself was decided above, by the guard, against the
    // allowlist.
    const session = await auth();
    const email = session?.user?.email?.trim() ?? "";
    const refusal = refusalFor(result.reason);

    return (
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="mb-[8vh] flex w-full max-w-[30rem] flex-col gap-4">
          <div className="lt-paper flex flex-col gap-5 p-8">
            {/* The refusal is the heading. On this screen nothing else is the
                point, and the product's own name is the last thing the
                operator needs: they already know what they were trying to
                open. */}
            <h1
              className={`lt-title${refusal.fault ? " border-s-2 ps-3" : ""}`}
              style={{
                color: "var(--paper-ink)",
                // The correction pen is a rule on paper, never a fill and
                // never a text colour: `--gap` measures 2.6:1 here, right for
                // a stroke and well under AA for words.
                borderInlineStartColor: refusal.fault
                  ? "var(--gap)"
                  : undefined,
              }}
            >
              {refusal.title}
            </h1>

            {/* The address, set as a figure and selectable in one gesture,
                because the operator's next move is to quote it to an admin.
                An account with no email address at all says so in the
                sentence instead of printing an empty register row. */}
            {refusal.account && email ? (
              <div className="flex flex-col gap-1">
                <span
                  className="text-[0.8125rem]"
                  style={{ color: "var(--paper-ink-2)" }}
                >
                  akun
                </span>
                <span
                  className="lt-figure text-[1.0625rem] font-semibold break-all select-all"
                  style={{ color: "var(--paper-ink)" }}
                >
                  {email}
                </span>
              </div>
            ) : null}

            {/* The guard's own sentence, in the guard's own words. It is
                already Bahasa, it already names the one thing the operator can
                do next, and it is the same sentence an API caller is handed,
                so a refusal reads identically wherever it surfaces. */}
            <p
              className="text-[0.9375rem] leading-6"
              style={{ color: "var(--paper-ink-2)" }}
            >
              {result.message}
            </p>

            {/* A plain anchor rather than `next/link`, because two of the
                three destinations need a full document load to mean anything:
                "Coba lagi" after an unreadable allowlist has to reach the
                server again, and a client navigation from `/` to `/` may not.
                */}
            <a
              href={refusal.action.href}
              className={ACTION_CLASS}
              style={ACTION_STYLE}
            >
              {refusal.action.label}
            </a>

            <p
              className="lt-wordmark border-t pt-4 text-[0.75rem]"
              style={{
                borderColor: "var(--paper-edge)",
                color: "var(--paper-ink-2)",
              }}
            >
              tv-validator
            </p>
          </div>

          {/* The guard's own sentence is written for whoever runs this
              deployment: it names the Firestore binding. It belongs off the
              sheet, behind the disclosure, and only where there is a fault to
              explain. An account that was never added to the allowlist is the
              system working, and has nothing technical to say about itself. */}
          {refusal.fault ? (
            <TechnicalDetail>
              {`reason=${result.reason} status=${result.status}\n${result.message}`}
            </TechnicalDetail>
          ) : null}
        </div>
      </main>
    );
  }

  // THE BOOTSTRAP MODE USED TO RENDER THE WHOLE APP WITH NO INDICATION AT ALL.
  // While `AUTH_DISABLED` is on, the guard returns ok for everyone, with an
  // empty email and `via: "auth-disabled"`, so the operator app opened for any
  // visitor and looked exactly like a signed-in session. That is the product's
  // own failure class (wrong and quiet) pointed at the client's documents, so
  // it says so in a band that pushes the app down rather than overlaying it,
  // and cannot be scrolled past.
  //
  // THE BAND IS HANDED TO THE APP, not stacked on top of it. Rendered here it
  // sat above the application strip and pushed the wordmark, the open run and
  // the phase nav down the page on every screen, so a deployment warning was
  // the first thing the product said about itself. `OperatorApp` places it
  // inside its own sticky header, under the strip, where it is still
  // undismissable and still cannot be scrolled past.
  if (result.user.via === "auth-disabled") {
    return (
      <OperatorApp
        notice={
          <Interruption
            detail={
              "AUTH_DISABLED=true dan AUTH_GOOGLE_ID kosong: mode bootstrap " +
              "sekali pakai, setiap permintaan dilayani tanpa autentikasi. " +
              "Selesaikan langkah 5 di docs/runbook-deploy.md, lalu deploy ulang."
            }
          >
            Aplikasi ini sedang berjalan tanpa pemeriksaan akun. Siapa pun yang
            bisa membuka alamat ini bisa membuka dokumen di dalamnya. Jangan
            memuat dokumen pelanggan sampai administrator menyalakan lagi
            pemeriksaan akun.
          </Interruption>
        }
      />
    );
  }

  // THE ACCOUNT IS HANDED DOWN, not fetched again. This component already
  // holds the authorized user, and without it the strip calls
  // `/api/auth/session` for itself: a round trip to learn something this render
  // already knows, and one that comes back without the allowlist role, so the
  // strip cannot tell an admin from a member and offers the allowlist link to
  // everybody. `isAdmin` is passed explicitly rather than left undefined,
  // because undefined deliberately means "nobody told us" and shows the link.
  return (
    <OperatorApp
      account={{
        email: result.user.email,
        name: result.user.name,
        isAdmin: result.user.isAdmin,
      }}
    />
  );
}
