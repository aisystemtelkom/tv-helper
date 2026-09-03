/**
 * A URL that matches nothing.
 *
 * Until this file existed, a mistyped address dropped the operator onto Next's
 * unbranded English default: no product name, no Bahasa, and no way back into
 * the app. For a product organised against quiet failure, the failure screens
 * are not polish.
 *
 * It renders inside the root layout, so it inherits the graphite table and the
 * self-hosted type, and the message is a sheet lying on that table, opening
 * with the same kop as `signin`, `error`, `global-error` and `loading`. That
 * file's header comment carries the one thing to know before editing any of
 * them: which classes survive the paper rebind and which two do not.
 *
 * THE KOP IS NEUTRAL HERE, on purpose. Nothing failed. A mistyped address is
 * not a fault of the app's, and spending the correction pen on it is how red
 * stops meaning anything by the time something really does break. The figure
 * on the right is the one thing worth quoting to an administrator.
 *
 * TWO THINGS TO KNOW BEFORE EDITING THIS FILE.
 *
 * There is no `metadata` export. Next resolves a title for `not-found.js` from
 * the layout above it, and the file that would own a 404 title of its own is
 * `global-not-found.js`, which is experimental and needs a flag in
 * `next.config.ts`. An export here would look like it works and quietly do
 * nothing, so the root layout's title stands instead.
 *
 * A signed-out visitor never reaches this screen. `src/proxy.ts` matches every
 * path that is not explicitly public, so a mistyped URL with no session cookie
 * is redirected to `/signin` first, carrying the mistyped path as its
 * `callbackUrl`. This page is what a SIGNED-IN operator sees.
 */

import Link from "next/link";
import type { CSSProperties } from "react";

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
const KOP_ON_PAPER = {
  color: "var(--paper)",
  "--ink": "var(--paper)",
} as CSSProperties;

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="mb-12 flex w-full max-w-[30rem] flex-col gap-4">
        <div className="lt-paper overflow-hidden">
          <div className="lt-kop" style={KOP_ON_PAPER}>
            <span className="lt-wordmark">tv-validator</span>
            {/* `.lt-kop-right` rather than a margin utility: one class puts
                the state at the same end of every kop in the product. */}
            <span className="lt-figure lt-kop-right">404</span>
          </div>

          <div className="lt-slab-body flex flex-col gap-6 p-6">
            {/* An h1, not the shared `Title`: this is the top of the document
                and `Title` renders an h2. */}
            <h1 className="lt-title">Halaman tidak ada.</h1>

            <p className="lt-lede">
              Alamat yang Anda buka tidak cocok dengan halaman mana pun.
            </p>

            {/* Nothing is broken on this screen, only missing, so the router is
                safe to use here. `error.tsx` deliberately does not, and says
                why. */}
            <Link href="/" className="lt-btn self-start" data-tone="primary">
              Kembali ke aplikasi
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
