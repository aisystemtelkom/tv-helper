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
 * nothing to fetch. The Google button is therefore a word, not a mark, and the
 * type is this app's own self-hosted family.
 *
 * THE FORM IS A SHEET OF PAPER ON THE TABLE. It is the one document on this
 * page, so it is the one thing that is lit and casts a shadow, and everything
 * written on it takes the paper's own ink (`--paper-ink`), never the graphite
 * ground's `--ink`, which on this sheet is very nearly the sheet itself.
 *
 * IT IS DELIBERATELY NOT REDIRECTED FOR AN ALREADY-SIGNED-IN VISITOR. The
 * obvious improvement ("you are signed in, go to /") closes the only escape
 * the refused screen has: `/` sends an operator who is signed in but not
 * allowlisted here, offering "Masuk dengan akun lain", and a redirect back to
 * `/` would turn those two pages into a loop.
 */

import Link from "next/link";

import { isAuthDisabled } from "@/lib/auth/guard";
import { signIn } from "@/lib/auth";
import { TechnicalDetail } from "@/components/operator/chrome";

import {
  safeCallbackUrl,
  signInErrorDetail,
  signInErrorMessage,
} from "./query.ts";

// Reads the query string and mints a CSRF-bearing form, so it can never be
// prerendered. Stated rather than inferred, so a refactor cannot turn one
// operator's sign-in form into a cached one.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Masuk - tv-validator",
};

/**
 * A control printed on paper, which is the inverse of a control on the table:
 * dark ink pressed into the sheet rather than a lit key on a dark panel.
 * `.lt-btn` cannot be used here because its ink is the graphite ground's, and
 * on `--paper` that is a white button on a white sheet.
 */
const ACTION_CLASS =
  "inline-flex w-full items-center justify-center rounded-[4px] border " +
  "px-4 py-2.5 text-[0.9375rem] font-semibold transition-opacity " +
  "hover:opacity-90";
const ACTION_STYLE = {
  background: "var(--paper-ink)",
  color: "var(--paper)",
  borderColor: "var(--paper-ink)",
};

/**
 * The correction pen on paper is a RULE, never a fill and never a text colour.
 * `--gap` measures 2.6:1 against `--paper`, which is right for a 2px stroke
 * and well under AA for a sentence, so the sentence stays in `--paper-ink`.
 */
const REFUSAL_CLASS = "border-s-2 ps-3 text-[0.9375rem] leading-6";
const REFUSAL_STYLE = {
  borderInlineStartColor: "var(--gap)",
  color: "var(--paper-ink)",
};

export default async function SignInPage(props: PageProps<"/signin">) {
  const params = await props.searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const message = signInErrorMessage(params.error);
  const disabled = isAuthDisabled();

  // Both halves of the deployer's story, in one disclosure rather than two.
  // The bootstrap note is written here rather than in `query.ts` because it
  // describes this deployment's state, not a failed sign-in attempt.
  const notes = [
    signInErrorDetail(params.error),
    disabled
      ? "AUTH_DISABLED=true dan AUTH_GOOGLE_ID kosong: mode bootstrap " +
        "sekali pakai, setiap permintaan dilayani tanpa autentikasi. " +
        "Selesaikan langkah 5 di docs/runbook-deploy.md, lalu deploy ulang."
      : null,
  ].filter((note): note is string => note !== null);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      {/* Lifted off the geometric centre. Flush to the top of a 1080px office
          monitor is the cheapest possible signal that nobody looked at this
          screen, and dead centre reads as a dialog rather than as a page. */}
      <div className="mb-[8vh] flex w-full max-w-[26rem] flex-col gap-4">
        <div className="lt-paper flex flex-col gap-6 p-8">
          <div className="flex flex-col gap-2">
            {/* The product name is the heading, because this page IS the
                identity page. Uppercase and tracked out is sanctioned here
                and in one other place only: a wordmark is a quotation, not a
                label given rank by being shouted. */}
            <h1
              className="lt-wordmark text-[1.375rem]"
              style={{ color: "var(--paper-ink)" }}
            >
              tv-validator
            </h1>
            <p
              className="text-[0.9375rem] leading-6"
              style={{ color: "var(--paper-ink-2)" }}
            >
              Gunakan Akun Google yang sudah didaftarkan administrator.
            </p>
          </div>

          {/* The refusal sits ABOVE the button. An operator who arrives at
              /signin?error=... arrives because something already failed, and
              that outranks the control they have already pressed once. */}
          {message ? (
            <p role="alert" className={REFUSAL_CLASS} style={REFUSAL_STYLE}>
              {message}
            </p>
          ) : null}

          {disabled ? (
            <div className="flex flex-col gap-4">
              <p className={REFUSAL_CLASS} style={REFUSAL_STYLE}>
                Aplikasi ini sedang berjalan tanpa pemeriksaan akun, jadi tidak
                ada yang perlu Anda masukkan di sini. Siapa pun yang bisa
                membuka alamat ini sudah bisa memakai aplikasi.
              </p>
              {/* This mode used to leave the page with no action at all, which
                  sends the operator away to guess at a URL. The guard admits
                  everyone while it is on, so the honest next step is the app
                  itself. */}
              <Link href="/" className={ACTION_CLASS} style={ACTION_STYLE}>
                Buka aplikasi
              </Link>
            </div>
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
              className="flex flex-col gap-3"
            >
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <button
                type="submit"
                className={ACTION_CLASS}
                style={ACTION_STYLE}
              >
                Masuk dengan Google
              </button>

              {/* Where they will land, when it is not simply the app. The
                  value has already been through `safeCallbackUrl`, so one that
                  was rewritten reads `/` and this line does not render at all:
                  the page never promises a destination it will not use. */}
              {callbackUrl !== "/" ? (
                <p
                  className="text-[0.8125rem] leading-5"
                  style={{ color: "var(--paper-ink-2)" }}
                >
                  Setelah masuk, Anda dibawa ke{" "}
                  <span className="lt-figure break-all">{callbackUrl}</span>
                </p>
              ) : null}
            </form>
          )}

          {/* The consent, and the document being consented to. This is the
              only page in the product where consent is actually given, and
              until now the policy was linked from nowhere at all. In bootstrap
              mode the sentence is dropped and the link kept: nobody is signing
              in, so nothing is being shared, and saying otherwise would be a
              claim this page cannot make. */}
          <p
            className="border-t pt-4 text-[0.8125rem] leading-5"
            style={{
              borderColor: "var(--paper-edge)",
              color: "var(--paper-ink-2)",
            }}
          >
            {disabled ? null : (
              <>
                Yang dibagikan saat masuk hanya alamat email dan nama Akun
                Google Anda.{" "}
              </>
            )}
            <a
              href="/privacy"
              className="underline underline-offset-2"
              style={{ color: "var(--paper-ink)" }}
            >
              Kebijakan Privasi
            </a>
          </p>
        </div>

        {/* Off the sheet, on the table: variable names, a runbook step and a
            raw Auth.js code are the deployer's half of the story, and they
            never share a paragraph with the sentence the operator has to act
            on. It sits outside `.lt-paper` because `TechnicalDetail` is drawn
            in the graphite ground's ink, which is unreadable on paper. */}
        {notes.length > 0 ? (
          <TechnicalDetail>{notes.join("\n\n")}</TechnicalDetail>
        ) : null}
      </div>
    </main>
  );
}
