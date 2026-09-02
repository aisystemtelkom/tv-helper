import type { Metadata } from "next";
import {
  Atkinson_Hyperlegible_Next,
  Atkinson_Hyperlegible_Mono,
} from "next/font/google";

import "./globals.css";

/**
 * THE TYPEFACES ARE A FUNCTIONAL CHOICE, not a stylistic one.
 *
 * This product exists because a person has to tell a right page number from a
 * wrong one, and a right crop from a plausible wrong one, in small type read
 * off a photocopy. Atkinson Hyperlegible was drawn by the Braille Institute
 * for exactly that: every character is shaped so it cannot be mistaken for
 * another one, which is the difference between `1` and `l`, `0` and `O`, and
 * `rn` and `m` in a quote number a validator will sign.
 *
 * Two members of one family, and the split carries meaning:
 *
 *   SANS  is the application talking to the operator.
 *   MONO  is the document's own voice: identifiers, citations, page and line
 *         numbers, the packet's section names, and the wordmark.
 *
 * So mono never sets prose or a button label. Using a monospace face to make
 * a small label look technical is the habit this replaces.
 *
 * `next/font` downloads both AT BUILD TIME and serves them from this app's own
 * origin. That is what keeps the standing proof true:
 * `performance.getEntriesByType("resource")` on any page of this app shows no
 * host but this one. A `<link>` to fonts.googleapis.com would break it
 * silently, and so would any icon font or CDN stylesheet.
 */
/*
 * `adjustFontFallback: false` and an explicit `fallback` are a pair, and both
 * are deliberate.
 *
 * Next normally synthesises a metric-matched local fallback so the swap from
 * system font to webfont does not reflow the page. It has no metrics for
 * either Atkinson family and says so at build time ("Failed to find font
 * override values ... Skipping generating a fallback font"). Leaving that
 * warning in place would mean a real build warning nobody reads; turning it
 * off silently would hide a real one later. Stating it here accepts the small
 * first-paint shift and, in exchange, names a fallback stack that is actually
 * legible rather than letting the browser pick its default serif, which is the
 * failure this file already had once.
 *
 * The stacks below are written out inline rather than hoisted into a constant
 * because `next/font` reads its arguments at build time and rejects anything
 * that is not a literal ("Font loader values must be explicitly written
 * literals"), so the duplication is the API's, not a preference.
 */
const ui = Atkinson_Hyperlegible_Next({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "Segoe UI", "Arial", "sans-serif"],
  adjustFontFallback: false,
});

const figure = Atkinson_Hyperlegible_Mono({
  variable: "--font-figure",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: "tv-validator",
  description:
    "Menyusun DOKUMEN VALIDASI dari berkas order hasil pemindaian, satu potongan bukti yang dipastikan pada satu waktu",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      className={`${ui.variable} ${figure.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
