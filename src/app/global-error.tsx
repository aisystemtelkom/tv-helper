"use client";

/**
 * The last screen. It catches a throw in the ROOT LAYOUT itself, which is the
 * one place `error.tsx` cannot reach, and it replaces the layout rather than
 * rendering inside it.
 *
 * SO NOTHING FROM THE REST OF THE APP IS AVAILABLE HERE, and that is not a
 * style choice to be tidied away later:
 *
 *   - It must render its own `<html>` and `<body>`.
 *   - `globals.css` is not applied. Next's own note: "global-error and the
 *     built-in 500 page render their own document and do not include your
 *     global styles". So there are no `--surface` / `--paper` custom
 *     properties to reference, no `.lt-paper`, and no reset. Every value below
 *     is written out, and the hexadecimals are the same colours the token file
 *     defines in oklch: #19201d is `--surface`, #fcfbf8 is `--paper`, #24201a
 *     is `--paper-ink`, #fb766a is `--gap`.
 *   - `next/font` is not applied either, because it is the layout that carries
 *     the font variables. A system stack is the honest answer; loading a
 *     webfont from anywhere would break this project's standing proof that
 *     `performance.getEntriesByType("resource")` shows no host but this one.
 *   - It must not import `chrome.tsx`. A shared component is one more thing
 *     that can be the reason this screen fails to render, on the screen whose
 *     whole job is to render when something else did not.
 *
 * `metadata` exports are unsupported in a Client Component, so the tab is
 * named with React's own `<title>`, which React hoists into the head.
 *
 * The browser's default focus ring is deliberately left alone here. Nothing
 * resets it, and on this page an untouched UA ring is more reliable than one
 * this file invents.
 */

const GROUND = "#19201d";
const PAPER = "#fcfbf8";
const PAPER_INK = "#24201a";
const PAPER_INK_2 = "#5b5650";
const PAPER_EDGE = "#7f7973";
const GAP = "#fb766a";
const SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // Next's own source carries "Docs say this is an Error object, but we don't
  // guarantee that", so this screen never assumes it can read `.message`.
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest?: unknown }).digest ?? "")
      : "";
  const detail = [
    digest ? `digest=${digest}` : "",
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error ?? "(tidak ada keterangan)"),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <html lang="id" style={{ colorScheme: "dark" }}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "3rem 1.5rem",
          background: GROUND,
          color: PAPER,
          font: `400 15px/1.55 ${SANS}`,
        }}
      >
        <title>Aplikasi berhenti - tv-validator</title>

        <div style={{ width: "100%", maxWidth: "30rem", marginBottom: "8vh" }}>
          <div
            style={{
              background: PAPER,
              color: PAPER_INK,
              border: `1px solid ${PAPER_EDGE}`,
              borderRadius: 2,
              padding: "2rem",
              boxShadow:
                "0 1px 0 rgba(6, 9, 8, 0.8), 0 18px 36px -18px rgba(4, 6, 5, 0.92)",
            }}
          >
            {/* The correction pen is a rule, never a fill: this red measures
                2.6:1 on this paper, which is right for a stroke and well under
                AA for words. */}
            <h1
              style={{
                margin: 0,
                borderInlineStart: `2px solid ${GAP}`,
                paddingInlineStart: "0.75rem",
                fontSize: "1.25rem",
                fontWeight: 700,
                lineHeight: 1.25,
                letterSpacing: "-0.015em",
                color: PAPER_INK,
              }}
            >
              Aplikasi berhenti sepenuhnya.
            </h1>

            <p style={{ margin: "1.25rem 0 0", color: PAPER_INK_2 }}>
              Halaman ini tidak bisa ditampilkan sama sekali. Dokumen dan hasil
              kerja Anda tetap tersimpan di peramban ini. Muat ulang halaman,
              dan jika tetap gagal hubungi administrator.
            </p>

            <button
              type="button"
              onClick={() => retry()}
              style={{
                margin: "1.25rem 0 0",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0.5rem 1rem",
                border: `1px solid ${PAPER_INK}`,
                borderRadius: 4,
                background: PAPER_INK,
                color: PAPER,
                font: `600 15px/1.4 ${SANS}`,
                cursor: "pointer",
              }}
            >
              Coba lagi
            </button>

            <p
              style={{
                margin: "1.5rem 0 0",
                paddingTop: "1rem",
                borderTop: `1px solid ${PAPER_EDGE}`,
                font: `700 12px/1.4 ${MONO}`,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: PAPER_INK_2,
              }}
            >
              tv-validator
            </p>
          </div>

          {/* Off the sheet: the exception and the digest that ties this screen
              to a line in the server log are the deployer's half of the story,
              and they never share a paragraph with the sentence the operator
              has to act on. */}
          <details style={{ marginTop: "1rem", fontSize: 13 }}>
            <summary style={{ cursor: "pointer", color: "#98a19d" }}>
              Detail teknis
            </summary>
            <pre
              style={{
                margin: "0.5rem 0 0",
                padding: "0.5rem",
                maxHeight: "10rem",
                overflow: "auto",
                whiteSpace: "pre-wrap",
                background: "#111714",
                border: "1px solid #4d4842",
                borderRadius: 4,
                font: `400 12px/1.5 ${MONO}`,
                color: "#f1f5f3",
              }}
            >
              {detail}
            </pre>
          </details>
        </div>
      </body>
    </html>
  );
}
