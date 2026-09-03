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
 * IT IS THE SAME OBJECT AS THE REAL PAGE, NOT A ROUGH DRAWING OF ONE. That is
 * the whole reason it earns its place: a glass strip, a page header, then a
 * slab opening with a kop and a sheet lying in its body. If the register grows
 * a second block, or the kop starts carrying something, this file has to grow
 * it too, or the content will land somewhere other than where the wait put it.
 *
 * WHAT IT STILL DOES NOT DRAW, stated rather than left to be discovered: the
 * register's slab body opens with the sentence about who may change access and
 * closes with the "N orang terdaftar" line, and neither is here. So the sheet
 * arrives lower than this skeleton puts it. Both are copy rather than shape,
 * and copying them would print a claim about the register above a register
 * nobody has read yet, which is the trade this file keeps taking. The shape
 * above the sheet is what a second block or a taller kop would move, and that
 * is the part worth keeping in step.
 *
 * THE KOP OWES NOTHING, AND SAYS SO BY BEING PLAIN. Nothing has been read yet,
 * so there is no count for its right-hand slot and no state for its leading
 * rule. Inventing either -- a spinner, a zero, an amber bar -- would be the
 * screen making a claim it cannot support, on the one page where a wrong claim
 * is a claim about who can sign in.
 *
 * The strip is a copy of the one in `page.tsx` rather than an import. A
 * loading file is rendered instead of the page, not around it, so sharing the
 * markup would mean importing a module whose other exports are route config.
 * The report that landed this screen asks for one shared application strip,
 * which is where both copies should end up.
 */

import Link from "next/link";

/** The four ruled lines the real rows land on. */
const LINES = [0, 1, 2, 3];

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
        {/* The page's own header, at the measure `page.tsx` uses, and not a
            slab for the reason given there: it names the page rather than
            being a block on it. */}
        <div className="flex flex-col gap-1">
          <h1 className="lt-title">Daftar Izin Akses</h1>
          <p className="lt-lede" role="status">
            Membaca daftar izin akses dari server. Ini bisa memakan beberapa
            detik kalau aplikasinya baru dinyalakan.
          </p>
        </div>

        <section className="lt-slab">
          <div className="lt-kop">
            <span>Orang yang punya akses</span>
          </div>

          <div className="lt-slab-body flex flex-col gap-4">
            {/* Hidden from assistive technology as one object. The sentence
                above is already announced, and four empty ruled lines have
                nothing to read out. */}
            <div className="lt-paper lt-paper-body" aria-hidden="true">
              <div className="py-2 text-[0.8125rem] font-semibold text-ink-2">
                Alamat email
              </div>
              {LINES.map((line) => (
                // `.lt-paper-rule` rather than a border spelled out here: the
                // stylesheet owns what a rule on a sheet looks like, and the
                // real register's rows are drawn with the same class, so the
                // lines do not shift when the rows arrive.
                <div key={line} className="lt-paper-rule h-11" />
              ))}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
