/**
 * The wait, when the server has not answered yet.
 *
 * The case this exists for is a cold Cloud Run start: `/` gates itself with
 * `authorize()`, which reads Firestore, and until this file existed the
 * operator watched a blank white page while that happened. It wraps every
 * route under the root segment, so the same thing is true of a first hit on
 * `/admin`, which is `force-dynamic` and also waits on Firestore.
 *
 * IT IS THE SAME SHEET AS THE OTHER FOUR, and that is the change worth
 * recording. It used to be a skeleton of the application strip and the review
 * rows: grey bars in the shape of a screen that is being redesigned around it.
 * A skeleton is a promise about the layout that arrives next, so a stale one
 * is a lie told at a moment when the operator has nothing else to read, and
 * keeping it true means editing this file every time a screen moves. The sheet
 * promises only what is already known, which is the product's name and the
 * fact that it is coming.
 *
 * NOTHING HERE MOVES, AND THE PRODUCT'S SPINNER DELIBERATELY DOES NOT COME
 * HERE. `.lt-spinner` exists now and is right where an operator kicked
 * something off and might look away while it runs, which is why the ingest and
 * export panels carry it. Two reasons it is wrong on this sheet. It is drawn
 * in `--petrol`, which `.lt-paper` does NOT rebind, so a petrol ring on warm
 * white is a pale smudge well under the 3:1 a non-text graphic owes. And there
 * is nothing here to keep watching: nobody pressed anything, the sheet is
 * already the whole answer, and the heading below says so in words.
 *
 * THE WAIT IS SAID IN THE OPERATOR'S TERMS, NOT IN OURS. The sentence read
 * "Bisa beberapa detik saat server baru dinyalakan", which teaches a person
 * about our hosting while they are waiting to open an order. Whether a machine
 * somewhere is warming up is the deployer's fact; how long this might take is
 * theirs. It stays on screen rather than going behind a question mark, because
 * the reason this screen exists at all is to say the wait is normal.
 */

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
export default function Loading() {
  return (
    <main
      className="flex flex-1 flex-col items-center justify-center px-6 py-12"
      aria-busy="true"
    >
      <div className="mb-12 flex w-full max-w-[30rem] flex-col gap-4">
        <div className="lt-paper overflow-hidden">
          <div className="lt-kop">
            <span className="lt-wordmark inline-flex items-center gap-2">
              <Otak size={24} />
              TV VALIDATOR
            </span>
            <span className="lt-kop-right">memuat</span>
          </div>

          {/* Announced, because the screen changes without a navigation and a
              keyboard or screen reader user has nothing else to go on.

              `.lt-paper-body`, not `.lt-slab-body` under a `p-6` that overrode
              it. A sheet takes the sheet's own padding step, and the 3px the
              slab body used to hold clear was room for a double-ruled kop that
              no longer exists: a paper masthead carries no bottom border. */}
          <div className="lt-paper-body flex flex-col gap-2" role="status">
            {/* An h1, not the shared `Title`: this is the top of the document
                and `Title` renders an h2. */}
            <h1 className="lt-title">Memuat aplikasi.</h1>
            <p className="lt-note">
              Biasanya cepat, tapi bisa memakan waktu beberapa detik.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
