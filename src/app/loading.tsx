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


/**
 * What a kop costs on paper, in one place, and it is now ONE declaration
 * rather than two.
 *
 * The `color: var(--paper)` that used to sit beside this is gone:
 * `globals.css` gives `.lt-paper .lt-kop` a legend of its own and states in
 * its own comment that the inline copy is what that rule makes redundant. An
 * inline style restating a class is a second place to keep a colour in step.
 *
 * WHAT THE STYLESHEET DOES NOT DO IS REBIND `--ink` ON THE BAR. `.lt-paper`
 * rebinds it to `--paper-ink`, which is also the masthead's own ground, so
 * `.lt-wordmark` -- which paints `color: var(--ink)` -- is ink on ink at 1:1
 * without this line. The bench rule `.lt-kop[data-owes] > *` happens to hand
 * the same value to the children of a bar that REPORTS something, so on
 * `error.tsx` this restates it; a bar that reports nothing has no rule to
 * match it at all, and that is `not-found.tsx` and `loading.tsx`. It is
 * written identically in all three so that a screen gaining or losing
 * `data-owes` cannot make the wordmark disappear. `signin/page.tsx` carries
 * the same constant. If `globals.css` ever adds `--ink: var(--paper)` to
 * `.lt-paper .lt-kop`, all four go.
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
            <span className="lt-wordmark">tv-validator</span>
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
              Bisa beberapa detik saat server baru dinyalakan.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
