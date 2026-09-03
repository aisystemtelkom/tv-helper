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
 *     properties to reference, no `.lt-paper`, no `.lt-kop`, no `.lt-btn`, and
 *     no reset. Every value below is written out.
 *   - `next/font` is not applied either, because it is the layout that carries
 *     the font variables. A system stack is the honest answer; loading a
 *     webfont from anywhere would break this project's standing proof that
 *     `performance.getEntriesByType("resource")` shows no host but this one.
 *   - It must not import `chrome.tsx`. A shared component is one more thing
 *     that can be the reason this screen fails to render, on the screen whose
 *     whole job is to render when something else did not.
 *
 * THE HEXADECIMALS ARE THE DESIGN TOKENS, CONVERTED. `globals.css` states them
 * in oklch, and these are those exact values in sRGB, recomputed when the
 * palette moved to Tinta Arsip: the ground went dark verdigris and
 * `--paper-edge` went cool, so the older constants here were quietly a
 * different product's colours. If a token moves again, these move with it, or
 * this screen stops being the same object as the other four sheets.
 *
 * THE ONE RULE SET THIS FILE DEFINES is the button's press. Everything else is
 * a style attribute, but a control that does not answer the hand is the single
 * most reliable sign that nobody finished an interface, and `:active` cannot
 * be written as a style attribute. Six lines of CSS in the document is not a
 * stylesheet and fetches nothing.
 *
 * `metadata` exports are unsupported in a Client Component, so the tab is
 * named with React's own `<title>`, which React hoists into the head.
 *
 * The browser's default focus ring is deliberately left alone here. Nothing
 * resets it, and on this page an untouched UA ring is more reliable than one
 * this file invents.
 */

/** --surface: the table. */
const GROUND = "#172621";
/** --paper, --paper-ink, --paper-ink-2, --paper-edge: the sheet and its ink. */
const PAPER = "#fcfbf8";
const PAPER_INK = "#272018";
const PAPER_INK_2 = "#60574e";
const PAPER_EDGE = "#778385";
/** --gap AS IT IS REBOUND ON PAPER. The table's red measures 2.6:1 here. */
const GAP_ON_PAPER = "#992728";
/** --petrol and --petrol-ink: identity, never status, so a primary control can
 *  never be mistaken for a decision that is owed. */
const PETROL = "#007389";
const PETROL_LIFT = "#006177";
const PETROL_INK = "#f6fbfc";
/** --ink, --ink-3, --surface-sunk, --line-strong: on the table, not the sheet. */
const INK = "#f7f5ef";
const INK_3 = "#ada398";
const SUNK = "#050d16";
const LINE_STRONG = "#8b7d70";

const SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const PRESS = `
.ge-btn { transition: box-shadow 90ms ease, transform 90ms ease; }
.ge-btn:hover { background: ${PETROL_LIFT}; }
.ge-btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 0 ${PAPER_INK}; }
`;

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
          color: INK,
          font: `400 15px/1.55 ${SANS}`,
        }}
      >
        <title>Aplikasi berhenti - tv-validator</title>
        <style>{PRESS}</style>

        {/* Lifted off the geometric centre by one step of the space scale,
            the same offset the other four sheets take. */}
        <div style={{ width: "100%", maxWidth: "30rem", marginBottom: "3rem" }}>
          <div
            style={{
              background: PAPER,
              color: PAPER_INK,
              border: `2px solid ${PAPER_EDGE}`,
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            {/* The kop, and it carries the fault across its full width. A
                stamped docket says what is wrong in its title bar, not in a
                mark beside a heading that somebody has to find. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.5rem 0.75rem",
                background: GAP_ON_PAPER,
                color: PAPER,
                borderBottom: `2px solid ${PAPER_INK}`,
                boxShadow: `0 3px 0 0 ${PAPER_INK}`,
                font: `700 13px/1.4 ${SANS}`,
              }}
            >
              {/* THE WORDMARK IS THE ONLY THING HERE ALLOWED UPPERCASE, and it
                  carries the tracking with it, exactly as `.lt-wordmark` does:
                  it quotes a name. The state word beside it is a label, and
                  this product never shouts a label to give it rank, so the
                  transform sits on the span and not on the bar, which is where
                  it was turning `gagal` into `GAGAL`. */}
              <span
                style={{
                  font: `700 15px/1.4 ${MONO}`,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                tv-validator
              </span>
              <span style={{ marginInlineStart: "auto", fontWeight: 600 }}>
                gagal
              </span>
            </div>

            <div style={{ marginTop: 3, padding: "1.5rem" }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  lineHeight: 1.25,
                  letterSpacing: "-0.015em",
                  color: PAPER_INK,
                }}
              >
                Aplikasi berhenti.
              </h1>

              <p style={{ margin: "1.5rem 0 0", color: PAPER_INK_2 }}>
                Dokumen dan hasil kerja Anda tetap tersimpan di peramban ini.
              </p>

              <button
                type="button"
                className="ge-btn"
                onClick={() => retry()}
                style={{
                  margin: "1.5rem 0 0",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: "2.5rem",
                  padding: "0 0.9rem",
                  border: `2px solid ${PAPER_INK}`,
                  borderRadius: 0,
                  background: PETROL,
                  boxShadow: `3px 3px 0 0 ${PAPER_INK}`,
                  color: PETROL_INK,
                  font: `700 13px/1.2 ${SANS}`,
                  cursor: "pointer",
                }}
              >
                Coba lagi
              </button>
            </div>
          </div>

          {/* Off the sheet: the exception and the digest that ties this screen
              to a line in the server log are the deployer's half of the story,
              and they never share a paragraph with the sentence the operator
              has to act on. */}
          <details style={{ marginTop: "1rem", fontSize: 13 }}>
            <summary style={{ cursor: "pointer", color: INK_3 }}>
              Detail teknis
            </summary>
            <pre
              style={{
                margin: "0.5rem 0 0",
                padding: "0.5rem",
                maxHeight: "10rem",
                overflow: "auto",
                whiteSpace: "pre-wrap",
                background: SUNK,
                border: `2px solid ${LINE_STRONG}`,
                borderRadius: 4,
                font: `400 12px/1.5 ${MONO}`,
                color: INK,
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
