/**
 * The wait, when the server has not answered yet.
 *
 * The case this exists for is a cold Cloud Run start: `/` gates itself with
 * `authorize()`, which reads Firestore, and until this file existed the
 * operator watched a blank white page while that happened. It wraps every
 * route under the root segment, so the same thing is true of a first hit on
 * `/admin`, which is `force-dynamic` and also waits on Firestore.
 *
 * A SKELETON OF THE SHELL, NOT A SPINNER, AND IT DOES NOT MOVE. A spinner
 * claims progress it cannot measure. The one orchestrated motion in this
 * product answers an operator's own click (the paraf being drawn), and the
 * only other motion is countable (one tick per stored page); a placeholder
 * that pulses is neither, so it would be the first thing in the product that
 * moves to no purpose.
 *
 * The blocks are `.lt-well` rather than `.lt-paper` or `.lt-hatch`, and the
 * distinction is load-bearing in this design: paper is a document, and none of
 * these is one yet; hatching is a DELIBERATE absence, on the record, which is
 * a claim this screen has no right to make. A well is a trough waiting to be
 * filled, which is exactly what is true.
 *
 * The wordmark is real rather than a grey bar, because identity is the one
 * thing that is already known, and a page with nothing legible on it reads as
 * broken rather than as loading.
 */
export default function Loading() {
  return (
    <div className="flex flex-1 flex-col" aria-busy="true">
      <div className="lt-rail border-b">
        <div className="mx-auto flex w-full max-w-[92rem] items-center gap-6 px-5 py-3">
          <span className="lt-wordmark">tv-validator</span>
          <span className="lt-well h-4 w-56" aria-hidden="true" />
          <span className="lt-well ms-auto h-4 w-32" aria-hidden="true" />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-6 px-5 py-8">
        {/* Announced, because the screen changes without a navigation and a
            keyboard or screen reader user has nothing else to go on. */}
        <p role="status" className="lt-note">
          Memuat aplikasi. Saat server baru dinyalakan, ini bisa memakan
          beberapa detik.
        </p>

        <div className="flex flex-col gap-4" aria-hidden="true">
          <div className="flex items-start gap-4">
            <span className="lt-well h-7 w-7 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <span className="lt-well h-5 w-64 max-w-full" />
              <span className="lt-well h-56 w-full" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="lt-well h-7 w-7 shrink-0" />
            <span className="lt-well h-4 w-72 max-w-full" />
          </div>
          <div className="flex items-center gap-4">
            <span className="lt-well h-7 w-7 shrink-0" />
            <span className="lt-well h-4 w-52 max-w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
