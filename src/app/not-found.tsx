/**
 * A URL that matches nothing.
 *
 * Until this file existed, a mistyped address dropped the operator onto Next's
 * unbranded English default: no product name, no Bahasa, and no way back into
 * the app. For a product organised against quiet failure, the failure screens
 * are not polish.
 *
 * It renders inside the root layout, so it inherits the table and the
 * self-hosted type, and the message is a sheet lying on that table, opening
 * with the same kop as `signin`, `error`, `global-error` and `loading`. That
 * file's header comment carries the one thing to know before editing any of
 * them: which classes survive the paper rebind and which do not.
 *
 * THE KOP IS NEUTRAL HERE, on purpose, and under the glass bench that is a
 * plain masthead of ink with no leading rule at all. Nothing failed. A
 * mistyped address is not a fault of the app's, and spending the correction
 * pen on it is how red stops meaning anything by the time something really
 * does break. The figure on the right is the one thing worth quoting to an
 * administrator, and it is set in the mono because it is a figure.
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

import { Otak } from "@/components/operator/icons";

/**
 * THE WORDMARK IS "TV VALIDATOR", WITH NO DASH AND WITH THE BRAIN BESIDE IT,
 * and it is the same lockup EVERY paper sheet in `src/app/` opens with. The
 * count that used to stand here ("all five") went stale the moment a sixth
 * sheet grew a kop, so the set is named rather than counted. The dash was a
 * package name wearing a product's clothes. `.lt-wordmark` already sets the
 * caps and the tracking, so the string is written out in full only so a reader
 * of this file sees the name the operator sees.
 *
 * NOTHING HERE SPELLS OUT AN INK, AND A CONSTANT THAT USED TO IS GONE.
 * `.lt-paper` rebinds `--ink` to `--paper-ink`, which is also the masthead's
 * own ground, so `.lt-wordmark` -- which paints `color: var(--ink)` -- was ink
 * on ink at 1:1, and four screens each carried their own copy of the fix.
 * `globals.css` gives `.lt-paper .lt-kop` a legend of its own now
 * (`--ink: var(--paper)`, measured at 15.65:1 on the bar) and the copies went
 * with it. `Otak` paints `currentColor`, so the same rule carries the mark.
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="mb-12 flex w-full max-w-[30rem] flex-col gap-4">
        <div className="lt-paper overflow-hidden">
          <div className="lt-kop">
            <span className="lt-wordmark inline-flex items-center gap-2">
              <Otak size={24} />
              TV VALIDATOR
            </span>
            {/* `.lt-kop-right` rather than a margin utility: one class puts
                the state at the same end of every kop in the product. */}
            <span className="lt-figure lt-kop-right">404</span>
          </div>

          {/* `.lt-paper-body`, not `.lt-slab-body` under a `p-6` that overrode
              it. A sheet takes the sheet's own padding step, and the 3px the
              slab body used to hold clear was room for a double-ruled kop that
              no longer exists: a paper masthead carries no bottom border. */}
          <div className="lt-paper-body flex flex-col gap-6">
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
