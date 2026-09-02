/**
 * A URL that matches nothing.
 *
 * Until this file existed, a mistyped address dropped the operator onto Next's
 * unbranded English default: no product name, no Bahasa, and no way back into
 * the app. For a product organised against quiet failure, the failure screens
 * are not polish.
 *
 * It renders inside the root layout, so it inherits the graphite table and the
 * self-hosted type, and the message is a sheet lying on that table like every
 * other message in this product.
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

const ACTION_CLASS =
  "inline-flex items-center justify-center self-start rounded-[4px] border " +
  "px-4 py-2 text-[0.9375rem] font-semibold transition-opacity hover:opacity-90";
const ACTION_STYLE = {
  background: "var(--paper-ink)",
  color: "var(--paper)",
  borderColor: "var(--paper-ink)",
};

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="mb-[8vh] flex w-full max-w-[30rem] flex-col gap-5 p-8 lt-paper">
        <h1 className="lt-title" style={{ color: "var(--paper-ink)" }}>
          Halaman ini tidak ada.
        </h1>

        <p
          className="text-[0.9375rem] leading-6"
          style={{ color: "var(--paper-ink-2)" }}
        >
          Alamat yang Anda buka tidak cocok dengan halaman mana pun di aplikasi
          ini. Pekerjaan Anda tetap tersimpan di peramban ini.
        </p>

        {/* Nothing is broken on this screen, only missing, so the router is
            safe to use here. `error.tsx` deliberately does not, and says why. */}
        <Link href="/" className={ACTION_CLASS} style={ACTION_STYLE}>
          Kembali ke aplikasi
        </Link>

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
    </main>
  );
}
