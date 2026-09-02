/**
 * What `/admin` shows while it waits for Firestore.
 *
 * The page is `force-dynamic` and awaits a network read before it can render
 * anything, so on a Cloud Run cold start the admin used to get a blank white
 * document for several seconds and then the whole page at once. A blank page
 * is indistinguishable from a broken one, which on an access-control screen is
 * the wrong thing to leave a person guessing about.
 *
 * It draws the strip, the heading and an empty register at the same measure as
 * the real page, so the content arrives into the shape that is already there
 * rather than pushing it around. NOTHING HERE ANIMATES: motion in this product
 * answers an action, and waiting for a database is not one. The sentence in
 * the live region is what says work is happening.
 *
 * The strip is a copy of the one in `page.tsx` rather than an import. A
 * loading file is rendered instead of the page, not around it, so sharing the
 * markup would mean importing a module whose other exports are route config.
 * The report that landed this screen asks for one shared application strip,
 * which is where both copies should end up.
 */

import Link from "next/link";

/** The register's own ruling, so the real rows land where these ones were. */
const RULE = "1px solid var(--paper-edge)";

export default function Loading() {
  return (
    <>
      <header className="lt-rail border-b">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
          <Link href="/" className="lt-wordmark">
            tv-validator
          </Link>
          <Link href="/" className="lt-btn">
            Kembali ke aplikasi
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-8">
        <div className="flex flex-col gap-1">
          <h1 className="lt-title">Daftar Izin Akses</h1>
          <p className="lt-lede" role="status">
            Membaca daftar izin akses dari server. Ini bisa memakan beberapa
            detik kalau aplikasinya baru dinyalakan.
          </p>
        </div>

        <div
          className="lt-paper px-5 py-4"
          style={{ color: "var(--paper-ink-2)" }}
          aria-hidden="true"
        >
          <div className="py-2 text-[0.8125rem] font-semibold">Alamat email</div>
          {[0, 1, 2, 3].map((line) => (
            <div key={line} style={{ borderTop: RULE, height: "2.75rem" }} />
          ))}
        </div>
      </main>
    </>
  );
}
