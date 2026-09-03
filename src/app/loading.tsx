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
 * NOTHING HERE MOVES AND THERE IS NO SPINNER. A spinner claims progress it
 * cannot measure. The one orchestrated motion in this product answers an
 * operator's own click (the paraf being drawn), and the only other motion is
 * countable (one tick per stored page); a placeholder that pulses is neither,
 * so it would be the first thing in the product that moves to no purpose.
 *
 * The cold-start sentence stays on screen rather than going behind a question
 * mark: it is the reason this screen is still here, which is the one class of
 * explanation that never hides.
 */

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

export default function Loading() {
  return (
    <main
      className="flex flex-1 flex-col items-center justify-center px-6 py-12"
      aria-busy="true"
    >
      <div className="mb-12 flex w-full max-w-[30rem] flex-col gap-4">
        <div className="lt-paper overflow-hidden">
          <div className="lt-kop" style={KOP_ON_PAPER}>
            <span className="lt-wordmark">tv-validator</span>
            <span className="lt-kop-right">memuat</span>
          </div>

          {/* Announced, because the screen changes without a navigation and a
              keyboard or screen reader user has nothing else to go on. */}
          <div
            className="lt-slab-body flex flex-col gap-2 p-6"
            role="status"
          >
            {/* An h1, not the shared `Title`: this is the top of the document
                and `Title` renders an h2. */}
            <h1 className="lt-title">Memuat aplikasi.</h1>
            <p className="lt-note">
              Bisa beberapa detik saat server baru dinyalakan.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
