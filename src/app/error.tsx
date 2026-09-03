"use client";

/**
 * A thrown render, anywhere under the root layout, including inside the
 * operator app itself.
 *
 * Error boundaries have to be Client Components, which is why this file is one.
 * It wraps `loading`, `not-found`, `page` and every nested layout below it; it
 * does NOT wrap the root layout, and `global-error.tsx` is what catches that.
 *
 * THE OPERATOR NEEDS TWO FACTS AND ONE ACTION. Whether their work survived,
 * and what to press. Both stay on the sheet at rest: a fault never hides
 * behind a disclosure. Everything else here (the exception text, the digest
 * that ties this screen to a line in the Cloud Run log) is written for whoever
 * deploys this app, so it sits off the sheet behind the disclosure. Both
 * audiences are real; they are not the same person.
 *
 * THE KOP CARRIES THE FAULT, which is what makes this screen legible from
 * across the room and what stops the fault being a small mark somebody has to
 * hunt for. IT IS NO LONGER A BAR OF RED, and that correction is the whole of
 * what the glass bench changed here: `globals.css` draws a paper kop as a
 * masthead of plain `--paper-ink` in every state and puts the status in a 4px
 * rule down its leading edge, in the BENCH value of the hue, because the
 * masthead is the one dark ground a sheet contains. A full-width saturated bar
 * under light text is the gesture the client named; the leading rule is the
 * loudest of the three status channels and costs the sheet no fill at all.
 * Nothing in this file spells any of that out: `data-owes="fault"` is the
 * whole of it.
 *
 * The sheet is the same one `signin/page.tsx` documents. Neither of the two
 * classes that file names needs what it used to: `.lt-kotak` takes the recess
 * from the token rebind, and `.lt-kop` is down to a single declaration, which
 *
 * `retry()` rather than `reset()`. Next passes both, and both are real, but
 * they answer different questions: `reset()` re-renders the boundary's
 * children from what the client already has, while `retry()` re-fetches them
 * first. Nearly every failure that reaches this screen is a server render that
 * did not complete, so re-rendering the same payload would fail identically,
 * with a button that looks like it does nothing. Verified against
 * node_modules/next/dist/client/components/error-boundary.js, which passes
 * `reset` and `retry` side by side.
 */


import { Btn, TechnicalDetail } from "@/components/operator/chrome";

/**
 * What a kop costs on paper, in one place, and it is now ONE declaration
 * rather than two.
 *
 * The `color: var(--paper)` that used to sit beside this is gone:
 * `globals.css` gives `.lt-paper .lt-kop` a legend of its own and states in
 * its own comment that the inline copy is what that rule makes redundant. An
 * inline style restating a class is a second place to keep a colour in step.
 *
 * WHAT THE STYLESHEET DOES NOT DO IS REBIND `--ink` ON THE BAR. `.lt-paper`
 * rebinds it to `--paper-ink`, which is also the masthead's own ground, so
 * `.lt-wordmark` -- which paints `color: var(--ink)` -- is ink on ink at 1:1
 * without this line. The bench rule `.lt-kop[data-owes] > *` happens to hand
 * the same value to the children of a bar that REPORTS something, so on
 * `error.tsx` this restates it; a bar that reports nothing has no rule to
 * match it at all, and that is `not-found.tsx` and `loading.tsx`. It is
 * written identically in all three so that a screen gaining or losing
 * `data-owes` cannot make the wordmark disappear. `signin/page.tsx` carries
 * the same constant. If `globals.css` ever adds `--ink: var(--paper)` to
 * `.lt-paper .lt-kop`, all four go.
 */
/**
 * Next's own source carries "Docs say this is an Error object, but we don't
 * guarantee that": whatever was thrown arrives here unchanged, so a thrown
 * string or a thrown object with no `message` must not throw a second time
 * inside the screen that exists to report the first one.
 */
function describe(error: unknown): string {
  const parts: string[] = [];
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest?: unknown }).digest ?? "")
      : "";
  if (digest) parts.push(`digest=${digest}`);
  parts.push(
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error ?? "(tidak ada keterangan)"),
  );
  return parts.join("\n");
}

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="mb-12 flex w-full max-w-[30rem] flex-col gap-4">
        <div className="lt-paper overflow-hidden">
          {/* The bar carries it, not a mark beside a heading that somebody has
              to find. `data-owes` is the whole declaration: `globals.css` draws
              the masthead, hangs the correction pen down its leading edge, and
              rebinds the ink ladder so the wordmark is legible on it. Nothing
              is spelled out here any more. */}
          <div className="lt-kop" data-owes="fault">
            <span className="lt-wordmark">tv-validator</span>
            <span className="lt-kop-right">gagal</span>
          </div>

          {/* `.lt-paper-body`, not `.lt-slab-body` under a `p-6` that overrode
              it. A sheet takes the sheet's own padding step, and the 3px the
              slab body used to hold clear was room for a double-ruled kop that
              no longer exists: a paper masthead carries no bottom border. */}
          <div className="lt-paper-body flex flex-col gap-6">
            {/* An h1, not the shared `Title`: this is the top of the document
                and `Title` renders an h2. */}
            <h1 className="lt-title">Halaman gagal ditampilkan.</h1>

            <p className="lt-lede">
              Keputusan yang sudah tersimpan tetap ada di peramban ini. Yang
              belum tersimpan perlu diulang.
            </p>

            <Btn tone="primary" className="self-start" onClick={() => retry()}>
              Coba lagi
            </Btn>
          </div>
        </div>

        {/* On the table, not on the sheet: the disclosure is drawn in the
            table's own ink and would be unreadable on paper. The escape
            hatch lives here too, quietly, because a retry that keeps failing
            needs somewhere else to go and this boundary also wraps pages that
            are not the app's root. */}
        <TechnicalDetail>{describe(error)}</TechnicalDetail>
        {/* A plain anchor, and NOT `next/link`, on purpose. This screen is
            rendering because the React tree threw; asking the client router to
            perform the escape is asking the thing that just failed to carry
            the operator out. A full document load needs none of it.

            `text-ink-2`, not an inline `style`: `@theme inline` in
            `globals.css` declares `--color-ink-2`, so the utility exists and
            resolves the token at the element it lands on. It is `--ink-2`
            rather than the `--ink-3` of `.lt-note` because this is a control
            the operator is meant to find and press, which is the same
            distinction `.lt-disclose > summary` is drawn on. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="self-start text-[0.8125rem] text-ink-2 underline underline-offset-2"
        >
          Kembali ke aplikasi
        </a>
      </div>
    </main>
  );
}
