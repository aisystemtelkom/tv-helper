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
 * and what to press. Everything else here (the exception text, the digest that
 * ties this screen to a line in the Cloud Run log) is written for whoever
 * deploys this app, so it sits off the sheet behind the disclosure. Both
 * audiences are real; they are not the same person.
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

import { TechnicalDetail } from "@/components/operator/chrome";

const ACTION_CLASS =
  "inline-flex items-center justify-center self-start rounded-[4px] border " +
  "px-4 py-2 text-[0.9375rem] font-semibold transition-opacity hover:opacity-90";
const ACTION_STYLE = {
  background: "var(--paper-ink)",
  color: "var(--paper)",
  borderColor: "var(--paper-ink)",
};

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
      <div className="mb-[8vh] flex w-full max-w-[30rem] flex-col gap-4">
        <div className="lt-paper flex flex-col gap-5 p-8">
          {/* A fault, so it carries the correction pen, and the pen is a rule:
              `--gap` measures 2.6:1 on paper, right for a stroke and well
              under AA for a sentence. */}
          <h1
            className="lt-title border-s-2 ps-3"
            style={{
              color: "var(--paper-ink)",
              borderInlineStartColor: "var(--gap)",
            }}
          >
            Halaman ini gagal ditampilkan.
          </h1>

          <p
            className="text-[0.9375rem] leading-6"
            style={{ color: "var(--paper-ink-2)" }}
          >
            Aplikasi berhenti saat menyiapkan halaman ini. Keputusan yang sudah
            tersimpan tetap ada di peramban ini. Keputusan yang belum sempat
            tersimpan perlu Anda ulangi.
          </p>

          <button
            type="button"
            onClick={() => retry()}
            className={ACTION_CLASS}
            style={ACTION_STYLE}
          >
            Coba lagi
          </button>

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

        {/* On the table, not on the sheet: the disclosure is drawn in the
            graphite ground's ink and would be unreadable on paper. The
            escape hatch lives here too, quietly, because a retry that keeps
            failing needs somewhere else to go and this boundary also wraps
            pages that are not the app's root. */}
        <TechnicalDetail>{describe(error)}</TechnicalDetail>
        {/* A plain anchor, and NOT `next/link`, on purpose. This screen is
            rendering because the React tree threw; asking the client router to
            perform the escape is asking the thing that just failed to carry
            the operator out. A full document load needs none of it. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="self-start text-[0.8125rem] underline underline-offset-2"
          style={{ color: "var(--ink-2)" }}
        >
          Kembali ke aplikasi
        </a>
      </div>
    </main>
  );
}
