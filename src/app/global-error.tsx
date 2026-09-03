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
 *   - It must not import `chrome.tsx`, and it must not import `icons.tsx`
 *     either. A shared component is one more thing that can be the reason this
 *     screen fails to render, on the screen whose whole job is to render when
 *     something else did not. So the brain beside the wordmark is transcribed
 *     inline, exactly as the colours below are, and it moves when `Otak` in
 *     `src/components/operator/icons.tsx` moves.
 *
 * THE HEXADECIMALS ARE THE MEJA KACA TOKENS, CONVERTED. `globals.css` states
 * them in oklch; a custom property cannot reach a document that has no
 * stylesheet, so this file states the same colours in sRGB. They were
 * recomputed when the palette became the glass bench: the ground is now a
 * traverse across 58 degrees of hue rather than a green field, a sheet is
 * generously cut rather than square, and a control is a pressed key rather
 * than a stamped plate. The constants that were here before were the previous
 * system's, so this screen looked like a different product the moment it
 * fired. If a token moves again, these move with it, or that is true again.
 *
 * THE CONVERSION WAS CHECKED AGAINST RATIOS `globals.css` ALREADY RECORDS,
 * which is what makes it a transcription rather than an eyeballed match. On
 * these literals: `--paper-ink` on `--paper` measures 15.65:1 and the masthead
 * the same figure inverted, `--gap` (bench) on the masthead 7.56:1,
 * `--petrol-ink` on `--petrol` 9.26:1, the paper petrol lip against the sheet
 * 4.05:1, `--paper-edge` against the sheet 3.50:1 and against the ground at
 * its lightest 4.13:1, and `--ink` in the recess 17.34:1. Every one of those
 * is the number the stylesheet quotes for the same pair, so the palettes are
 * the same palette.
 *
 * ONE PAIR IS MEASURED HERE RATHER THAN QUOTED, and it is flagged as such so
 * that the sentence above stays a checkable claim: `--ink-2` is what the
 * disclosure's label wears and `globals.css` records it on the rail (7.27:1)
 * and not on the bare ground, where it measures 9.32:1. Comfortably clear
 * either way, but it is this file's own figure.
 *
 * THE RULE SET THIS FILE DEFINES is the press, the disclosure, and the two
 * accessibility preferences the system answers everywhere else. NONE of them
 * can be written as a style attribute, which is the test for what belongs in
 * there: `:hover` and `:active` are states, a media query is a condition, and
 * a disclosure's marker and chevron are pseudo-elements. A control that does
 * not answer the hand is the single most reliable sign that nobody finished an
 * interface, and dropping the two preferences would make this the one screen
 * in the product that ignores them. A few dozen lines of CSS in the document
 * is not a stylesheet and fetches nothing.
 *
 * `metadata` exports are unsupported in a Client Component, so the tab is
 * named with React's own `<title>`, which React hoists into the head.
 *
 * The browser's default focus ring is deliberately left alone here. Nothing
 * resets it, and on this page an untouched UA ring is more reliable than one
 * this file invents.
 */

/* ---- the ground ---------------------------------------------------------
   The three ramp stops and the two corner glows, transcribed from `:root` and
   from the `body::before` rule that paints them. The glows sit in OPPOSITE
   corners, which is what turns a lit edge into a traverse. A flat fill would
   have the right colour in it and still read as a different product, because
   the journey is the most recognisable thing about this ground. */
/** --ground-1: oklch(0.235 0.040 206). */
const GROUND_1 = "#002327";
/** --ground-2: oklch(0.185 0.045 244). */
const GROUND_2 = "#001425";
/** --ground-3: oklch(0.140 0.030 264). */
const GROUND_3 = "#040915";
/** --glow-1: oklch(0.375 0.063 196), painted at 30%. */
const GLOW_1 = "rgba(2, 75, 76, 0.3)";
/** --glow-2: oklch(0.310 0.075 252), painted at 30%. */
const GLOW_2 = "rgba(15, 49, 85, 0.3)";
/** --surface: oklch(0.190 0.045 244). The opaque stand-in for the table, on
 *  `html`, so an overscroll bounce is the product's own colour rather than the
 *  browser's white. */
const SURFACE = "#011526";
/** --surface-sunk: oklch(0.185 0.030 244). The recess `.lt-well` cuts. */
const SUNK = "#06141f";
/** --edge: a 12% white film, the hairline a solid block is drawn with. */
const EDGE = "rgba(255, 255, 255, 0.12)";

/* ---- paper --------------------------------------------------------------- */
/** --paper: oklch(0.988 0.004 91). */
const PAPER = "#fcfbf8";
/** --paper-ink: oklch(0.245 0.018 245). Also the masthead's own ground. */
const PAPER_INK = "#192129";
/** --paper-ink-2: oklch(0.455 0.018 245). */
const PAPER_INK_2 = "#4f5860";
/** --paper-edge: oklch(0.620 0.020 232). */
const PAPER_EDGE = "#7b8990";

/* ---- ink on the table ---------------------------------------------------- */
/** --ink: oklch(0.975 0.006 220). */
const INK = "#f3f8fa";
/** --ink-2: oklch(0.845 0.014 222). 9.32:1 on the ground at its lightest.
 *
 *  THE DISCLOSURE'S LABEL TAKES THIS AND NOT `--ink-3`, and that is a decision
 *  the product already made rather than a preference of this file's.
 *  `TechnicalDetail` in `chrome.tsx` records it: `--ink-3` "is the floor ink
 *  for quiet TEXT and was never the right value for a control the operator is
 *  meant to find and press", and the summary here is exactly such a control on
 *  exactly the screen that comment names. `.lt-disclose > summary` paints
 *  `--ink-2`. */
const INK_2 = "#c3ced3";

/* ---- the signals --------------------------------------------------------- */
/** --gap-bench: oklch(0.775 0.125 24). THE BENCH VALUE, not the sheet's, and
 *  that is exactly the distinction `globals.css` freezes `--gap-bench` for:
 *  this rule is drawn on the masthead, which is the one DARK ground a sheet
 *  contains, and a sheet's own red measures 2.06:1 there. */
const GAP_BENCH = "#fc958f";
/** --petrol: oklch(0.800 0.115 200). Identity and the one action a screen
 *  wants, never status, so a primary control can never be mistaken for a
 *  decision that is owed. */
const PETROL = "#4dd4db";
/** color-mix(in srgb, white 14%, var(--petrol)): the primary key under a hand. */
const PETROL_HOVER = "#66dae0";
/** --petrol-lip AS IT IS REBOUND ON PAPER: oklch(0.575 0.095 202). On a white
 *  sheet a bright face cannot clear 3:1 against the paper, so the lip's 1.5px
 *  ring is the control's whole WCAG boundary and it takes the sheet's darker
 *  value rather than the bench's. */
const PETROL_LIP = "#108991";
/** --petrol-ink: oklch(0.235 0.040 228). A saturated fill ALWAYS carries dark
 *  text, and there is no exception for a colour that looks dark enough. */
const PETROL_INK = "#05222d";

const SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** --lip-h, declared once for the reason `globals.css` declares it once: the
 *  shadow offset, the margin that reserves room for a shadow taking no layout
 *  space, and the `:active` translate that has to move the face by EXACTLY the
 *  shelf's height are three numbers that have to agree, and nothing else makes
 *  them agree. */
const LIP_H = 4;
/** The width of a kop's leading rule, and it is DELIBERATELY NOT `LIP_H` even
 *  though both are 4. `globals.css` writes this one as a literal `4px` inside
 *  `.lt-paper .lt-kop[data-owes]` and reserves `--lip-h` for the control; they
 *  are two unrelated measurements that happen to agree today, and sharing one
 *  constant means a taller key silently widens the fault rule on the screen
 *  that reports a fault. */
const LEADING_RULE = 4;
/** --plate and --plate-press, with `--lip` resolved to the paper petrol lip.
 *  Pressed, the shelf is gone, because the face is standing on it. */
const PLATE = `0 0 0 1.5px ${PETROL_LIP}, 0 ${LIP_H}px 0 0 ${PETROL_LIP}`;
const PLATE_PRESS = `0 0 0 1.5px ${PETROL_LIP}`;
/** --lift: the only drop shadow on a solid object, and it belongs to paper
 *  alone, because a sheet is the one thing here physically lying on something
 *  else. */
const LIFT =
  "0 18px 40px -18px rgba(2, 8, 16, 0.75), 0 3px 10px -6px rgba(2, 8, 16, 0.5)";
/** --ease. One curve for everything that moves: fast out of the gate, settled
 *  at the end. A key being pressed, not an object being animated. */
const EASE = "cubic-bezier(0.2, 0.9, 0.3, 1)";

/** The ground, layer for layer, in the order `body::before` paints them. */
const GROUND = [
  `radial-gradient(130% 95% at 8% -12%, ${GLOW_1} 0%, transparent 58%)`,
  `radial-gradient(110% 85% at 104% 108%, ${GLOW_2} 0%, transparent 60%)`,
  `linear-gradient(168deg, ${GROUND_1} 0%, ${GROUND_2} 46%, ${GROUND_3} 100%)`,
].join(", ");

/**
 * THE PRESS IS A KEY GOING DOWN ONTO ITS OWN LIP, transcribed from `.lt-btn`.
 * The face moves by exactly the shelf's height, until the shelf is gone.
 *
 * THE DISCLOSURE IS THE SECOND THING THAT CANNOT BE A STYLE ATTRIBUTE, and it
 * is here because of a defect the product has already paid for once.
 * `TechnicalDetail` in `chrome.tsx` records it: a bare `<summary>` renders the
 * browser's own triangle, "the most reliable sign on the web that nobody
 * styled a page, and this one shipped on the failure screens". This IS a
 * failure screen, and the marker and the chevron are a pseudo-element apiece,
 * so a style attribute cannot reach either. `.lt-disclose` is transcribed
 * whole: the label is `--ink-2` and not the floor ink, because a summary is a
 * control the operator is meant to find and press rather than quiet text.
 *
 * THE TWO MEDIA QUERIES ARE THE SYSTEM'S OWN ANSWERS rather than inventions
 * for this file, and both carry a reason worth keeping. Under reduced motion
 * the shelf STAYS and the press answers with tone instead: removing only the
 * transform would collapse the lip under a face that had not moved, so the key
 * would appear to GROW four pixels, and zeroing the transition alone would
 * make the same movement instant, which is a jump rather than less motion. The
 * chevron's rotation is a transition and is simply dropped, which is what
 * `globals.css` does with the same selector. Under increased contrast the 12%
 * film that draws the recess takes its full weight, because a 12% hairline is
 * one you can see and not one you can rely on.
 */
const SHEET_CSS = `
.ge-btn { transition: transform 90ms ${EASE}, box-shadow 90ms ${EASE}, background-color 120ms ${EASE}; }
.ge-btn:hover { background: ${PETROL_HOVER}; }
.ge-btn:active { transform: translateY(${LIP_H}px); box-shadow: ${PLATE_PRESS}; }
.ge-disclose > summary {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  cursor: pointer;
  list-style: none;
  padding: 0.45rem 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: ${INK_2};
}
.ge-disclose > summary::-webkit-details-marker { display: none; }
.ge-disclose > summary::marker { content: ""; }
.ge-disclose > summary::before {
  content: "";
  width: 0.45rem;
  height: 0.45rem;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  border-end-end-radius: 2px;
  transform: rotate(-45deg);
  transition: transform 120ms ${EASE};
}
.ge-disclose[open] > summary::before { transform: rotate(45deg); }
.ge-disclose > summary:hover { color: ${INK}; }
@media (prefers-reduced-motion: reduce) {
  .ge-btn { transition: none; }
  .ge-btn:active { transform: none; box-shadow: ${PLATE}; filter: brightness(0.92); }
  .ge-disclose > summary::before { transition: none; }
}
@media (prefers-contrast: more) {
  .ge-well { border-color: rgba(255, 255, 255, 0.4); }
}
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
    <html lang="id" style={{ colorScheme: "dark", background: SURFACE }}>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "3rem 1.5rem",
          color: INK,
          font: `400 15px/1.55 ${SANS}`,
          WebkitFontSmoothing: "antialiased",
          background: GROUND,
          /* `fixed` here, where `globals.css` uses a fixed pseudo-element
             instead. Its two reasons for the pseudo-element are the repaint
             cost on a column that scrolls a metre at a time, and giving a
             backdrop-filter a real painted layer to sample. This page is one
             card, it carries no glass at all, and a style attribute cannot
             declare a pseudo-element, so neither reason reaches this file. */
          backgroundAttachment: "fixed",
        }}
      >
        <title>Aplikasi berhenti - TV Validator</title>
        <style>{SHEET_CSS}</style>

        {/* Lifted off the geometric centre by one step of the space scale, and
            standing in the same 30rem column as the other four sheets. */}
        <div
          style={{
            width: "100%",
            maxWidth: "30rem",
            marginBottom: "3rem",
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
          }}
        >
          {/* `.lt-paper`: the block radius, the sheet's own 1.5px edge, and the
              one drop shadow a solid object is allowed. */}
          <div
            style={{
              background: PAPER,
              color: PAPER_INK,
              border: `1.5px solid ${PAPER_EDGE}`,
              borderRadius: 20,
              boxShadow: LIFT,
              /* Which is also what rounds the masthead's top corners, so no
                 second radius has to be kept in step with this one. */
              overflow: "hidden",
            }}
          >
            {/* `.lt-paper .lt-kop`: a masthead, the one place in this system
                where a solid bar survives, because on white there is nothing
                else a header cap can be. A bar of INK, never of hue.

                THE FAULT IS THE 4px LEADING RULE, NOT THE BAR. A full-width
                red bar under light text is the exact gesture that was
                rejected, and it is what this file used to draw. The rule is
                the loudest of the status channels and the one that reads at a
                glance, and it costs the screen no saturated fill at all. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.625rem 0.95rem",
                background: PAPER_INK,
                color: PAPER,
                boxShadow: `inset ${LEADING_RULE}px 0 0 0 ${GAP_BENCH}`,
                font: `700 13px/1.4 ${SANS}`,
              }}
            >
              {/* THE WORDMARK IS THE ONLY THING HERE ALLOWED UPPERCASE, and it
                  carries the tracking with it, exactly as `.lt-wordmark` does:
                  it quotes a name. The state word beside it is a label, and
                  this product never shouts a label to give it rank, so the
                  transform sits on the span and not on the bar, which is where
                  it was turning "gagal" into "GAGAL".

                  THE NAME IS "TV VALIDATOR", WITH NO DASH. The dash was a
                  package name wearing a product's clothes. */}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  font: `700 15px/1.4 ${MONO}`,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {/* THE BRAIN, TRANSCRIBED, FOR THE SAME REASON THE COLOURS ARE.
                    This screen replaces the layout, so it may not import
                    `icons.tsx` any more than it may import `chrome.tsx` or
                    reach `globals.css`: a shared module is one more thing that
                    can be the reason the screen whose whole job is to render
                    when something else did not fails to render. So `Otak`'s
                    five paths are copied out of
                    `src/components/operator/icons.tsx` exactly as the tokens
                    above are copied out of the stylesheet, on the same 20
                    grid, at the same 1.5 stroke, painting `currentColor` so
                    the masthead's own ink carries it. If the mark is redrawn
                    there, it is redrawn here, or this screen goes back to
                    looking like a different product. */}
                <svg
                  width={24}
                  height={24}
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  aria-hidden="true"
                >
                  <path d="M10 4.4c-1.0-1.3-3.3-1.1-3.9.4-1.7 0-2.8 1.7-2.0 3.1-1.2 1.0-1.1 2.9.2 3.7-.1 1.6 1.5 2.8 3.0 2.3.5 1.1 1.9 1.5 2.7.7" />
                  <path d="M10 4.4c1.0-1.3 3.3-1.1 3.9.4 1.7 0 2.8 1.7 2.0 3.1 1.2 1.0 1.1 2.9-.2 3.7.1 1.6-1.5 2.8-3.0 2.3-.5 1.1-1.9 1.5-2.7.7" />
                  <path d="M10 4.4v10.2" />
                  <path d="M6.2 8.0c1.8 0 2.8 1.0 2.8 2.4" />
                  <path d="M13.8 8.0c-1.8 0-2.8 1.0-2.8 2.4" />
                </svg>
                TV VALIDATOR
              </span>
              {/* `.lt-kop-right`: the same end of every kop in the product. */}
              <span style={{ marginInlineStart: "auto", fontWeight: 600 }}>
                gagal
              </span>
            </div>

            {/* `.lt-paper-body`: the sheet's own padding step. */}
            <div
              style={{
                padding: "1.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
              }}
            >
              {/* `.lt-title`. An h1, not the shared `Title`: this is the top of
                  the document and `Title` renders an h2. */}
              <h1
                style={{
                  margin: 0,
                  fontSize: "1.3125rem",
                  fontWeight: 700,
                  lineHeight: 1.25,
                  letterSpacing: "-0.018em",
                  color: PAPER_INK,
                }}
              >
                Aplikasi berhenti.
              </h1>

              {/* `.lt-lede`. */}
              <p style={{ margin: 0, maxWidth: "66ch", color: PAPER_INK_2 }}>
                Dokumen dan hasil kerja Anda tetap tersimpan di peramban ini.
              </p>

              {/* `.lt-btn[data-tone="primary"]`: a pressed key. The control
                  radius, 44px minimum, and a solid lip in a darker shade of the
                  control's own colour sitting hard beneath it with no blur.
                  `alignSelf` is what `self-start` does on the other sheets: a
                  single action is never full width. */}
              <button
                type="button"
                className="ge-btn"
                onClick={() => retry()}
                style={{
                  alignSelf: "flex-start",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: "2.75rem",
                  marginBottom: LIP_H,
                  padding: "0 1.1rem",
                  border: 0,
                  borderRadius: 14,
                  background: PETROL,
                  boxShadow: PLATE,
                  color: PETROL_INK,
                  font: `700 0.875rem/1.2 ${SANS}`,
                  letterSpacing: 0,
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
              has to act on. It sits outside the paper because it is drawn in
              the table's ink, which is unreadable on a sheet.

              `.lt-disclose`, transcribed into `SHEET_CSS` rather than styled
              here: the browser's own triangle and the set's chevron are both
              pseudo-elements and a style attribute reaches neither. Everything
              this element used to carry inline now lives in that rule. */}
          <details className="ge-disclose">
            <summary>Detail teknis</summary>
            {/* `.lt-well` and `.lt-figure`: a recess, because this is something
                the machine read rather than something the app is telling you,
                and the mono is the document's own voice. 13px, not the 12 this
                was: every small string in this product is safety copy and
                nothing here is set below 13. */}
            <pre
              className="ge-well"
              style={{
                margin: "0.5rem 0 0",
                padding: "0.5rem",
                maxHeight: "10rem",
                overflow: "auto",
                whiteSpace: "pre-wrap",
                background: SUNK,
                border: `1px solid ${EDGE}`,
                borderRadius: 14,
                boxShadow: "inset 0 2px 5px -2px rgba(0, 0, 0, 0.45)",
                font: `400 0.8125rem/1.5 ${MONO}`,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.005em",
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
