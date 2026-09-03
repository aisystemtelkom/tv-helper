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
 * THE FORM IS A SHEET OF PAPER ON THE TABLE, and it opens with a kop: the bar
 * of ink an Indonesian letterhead starts with. The same sheet and the same kop
 * carry `not-found.tsx`, `error.tsx`, `global-error.tsx` and `loading.tsx`, so
 * the five screens a new operator meets before the app itself are one object
 * seen five times rather than five near-misses.
 *
 * WHAT PAPER COSTS, and it is identical on all five of those sheets. Because
 * `.lt-paper` rebinds the ink tokens, `.lt-title`, `.lt-lede`, `.lt-notice`
 * and `.lt-btn[data-tone="primary"]` all read correctly on a sheet with no
 * help at all: petrol and its legend are never rebound, and the edge and the
 * plate the button draws with become the paper's own ink, which is what a
 * control printed on a form looks like. TWO CLASSES DO NEED HELP, and both
 * fail the same way. `.lt-kop` paints `--kop` under `--ink`, and on paper both
 * rebind to `--paper-ink`, so a kop is ink on ink and its legend has to be
 * spelled out as `--paper`. `.lt-kotak` fills with `--surface-sunk`, which is
 * the recess colour of the TABLE and is not a paper token at all.
 *
 * IT IS DELIBERATELY NOT REDIRECTED FOR AN ALREADY-SIGNED-IN VISITOR. The
 * obvious improvement ("you are signed in, go to /") closes the only escape
 * the refused screen has: `/` sends an operator who is signed in but not
 * allowlisted here, offering "Masuk dengan akun lain", and a redirect back to
 * `/` would turn those two pages into a loop.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { isAuthDisabled } from "@/lib/auth/guard";
import { signIn } from "@/lib/auth";
import {
  Btn,
  Lede,
  Notice,
  TechnicalDetail,
} from "@/components/operator/chrome";

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
 * What a kop costs on paper, in one place.
 *
 * `.lt-paper` rebinds `--ink` and `--kop` to `--paper-ink`, so `.lt-kop` alone
 * paints ink on ink. `color` carries the bar itself and survives the fault
 * variant, which sets `color: var(--kop)`; rebinding `--ink` carries every
 * child that names the token, which is how `.lt-wordmark` stops needing a
 * style of its own. If `globals.css` ever gives `.lt-paper .lt-kop` a legend,
 * this constant goes.
 */
/**
 * The kop, on paper: the block's name on the left, whatever it owes on the
 * right.
 *
 * `owes="fault"` turns the whole bar, which is the point of putting the status
 * in the container: an operator who was refused sees it before reading a word,
 * and it is one mechanism rather than a mark on every screen that has to
 * remember to draw itself.
 */
function Kop({ owes, children }: { owes?: "fault"; children?: ReactNode }) {
  return (
    <div className="lt-kop" data-owes={owes}>
      <span className="lt-wordmark">tv-validator</span>
      {/* `.lt-kop-right` rather than a margin utility: one class puts the
          state at the same end of every kop in the product. */}
      {children ? <span className="lt-kop-right">{children}</span> : null}
    </div>
  );
}

/**
 * A value quoted out of the request, in a ruled box.
 *
 * ONLY THE FILL IS SPELLED OUT. `.lt-kotak` takes its ink and its rule from
 * the tokens the sheet already rebinds; what it cannot take is
 * `--surface-sunk`, which is the TABLE's recess and has no paper value, so a
 * kotak on a sheet is a dark box until the fill is dropped.
 */
function Kotak({ children }: { children: ReactNode }) {
  return (
    <span
      className="lt-kotak break-all"
      style={{ background: "transparent", whiteSpace: "normal" }}
    >
      {children}
    </span>
  );
}

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
      {/* Lifted off the geometric centre by one step of the space scale. Dead
          centre reads as a dialog rather than as a page, and flush to the top
          of a 1080px office monitor is the cheapest possible signal that
          nobody looked at this screen. */}
      <div className="mb-12 flex w-full max-w-[30rem] flex-col gap-4">
        <div className="lt-paper overflow-hidden">
          {/* A refused sign-in and a deployment running with no account check
              are both refusals, so the bar carries the correction pen. Neither
              is a decision the operator owes, so neither is ever amber. */}
          <Kop owes={message || disabled ? "fault" : undefined} />

          {/* `.lt-slab-body` for the 3px it holds clear under the kop's double
              rule; the padding is the system's 24px step rather than its own. */}
          <div className="lt-slab-body flex flex-col gap-6 p-6">
            {/* An h1, not the shared `Title`, because this is the top of the
                document and `Title` renders an h2. */}
            <h1 className="lt-title">Masuk</h1>

            <Lede>Pakai Akun Google yang didaftarkan administrator.</Lede>

            {/* The refusal sits ABOVE the button. An operator who arrives at
                /signin?error=... arrives because something already failed, and
                that outranks the control they have already pressed once. A
                refusal never hides behind a disclosure. */}
            {message ? (
              <Notice tone="stop" role="alert">
                {message}
              </Notice>
            ) : null}

            {disabled ? (
              <div className="flex flex-col gap-4">
                <Notice tone="stop">
                  Pemeriksaan akun sedang mati. Siapa pun yang bisa membuka
                  alamat ini sudah bisa memakai aplikasi.
                </Notice>
                {/* This mode used to leave the page with no action at all,
                    which sends the operator away to guess at a URL. The guard
                    admits everyone while it is on, so the honest next step is
                    the app itself. */}
                <Link href="/" className="lt-btn self-start" data-tone="primary">
                  Buka aplikasi
                </Link>
              </div>
            ) : (
              <form
                action={async (formData: FormData) => {
                  "use server";
                  // Re-sanitized here rather than trusted from the form: a
                  // Server Function is a POST anyone can shape, and this value
                  // becomes a redirect target.
                  await signIn("google", {
                    redirectTo: safeCallbackUrl(
                      formData.get("callbackUrl")?.toString(),
                    ),
                  });
                }}
                className="flex flex-col gap-4"
              >
                <input type="hidden" name="callbackUrl" value={callbackUrl} />
                <Btn type="submit" tone="primary" className="self-start">
                  Masuk dengan Google
                </Btn>

                {/* Where they will land, when it is not simply the app. The
                    value has already been through `safeCallbackUrl`, so one
                    that was rewritten reads `/` and this line does not render
                    at all: the page never promises a destination it will not
                    use. */}
                {callbackUrl !== "/" ? (
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="lt-label">tujuan</span>
                    <Kotak>{callbackUrl}</Kotak>
                  </p>
                ) : null}
              </form>
            )}

            {/* The consent, and the document being consented to. This is the
                only page in the product where consent is actually given, and
                until now the policy was linked from nowhere at all. It stays on
                screen at rest: a consent statement is never a hint and never a
                toast. In bootstrap mode the sentence is dropped and the link
                kept: nobody is signing in, so nothing is being shared, and
                saying otherwise would be a claim this page cannot make. */}
            <p
              className="lt-note border-t-2 pt-4"
              style={{ borderColor: "var(--paper-edge)" }}
            >
              {disabled ? null : (
                <>Yang dibagikan hanya alamat email dan nama Akun Google Anda. </>
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
