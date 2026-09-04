/**
 * WHICH ORDER IS OPEN, WRITTEN IN THE ADDRESS BAR, in one place.
 *
 * The workspace is deliberately ONE route (see the head of `operator-app.tsx`)
 * and puts the open run's id in the URL FRAGMENT, so that a reload during a
 * three-minute OCR pass comes back to the same order. Two things have to agree
 * on how that fragment is spelled: the workspace, which writes it and reads it
 * back on boot, and `riwayat.tsx`, which is now a page of its own and links
 * INTO the workspace by it.
 *
 * Two spellings of one address is the same class of defect as two definitions
 * of a slot key: they compile, they agree on every id, and they disagree the
 * first time the separator changes. Hence this file, which is the only place
 * `run/` appears.
 *
 * IT IS A FRAGMENT, NOT A QUERY, AND THAT IS LOAD-BEARING. A fragment is never
 * sent to the server, so a customer's run id cannot reach an access log, and
 * the page it addresses is `force-dynamic` behind the auth gate either way.
 * The run itself is in IndexedDB on the device; this is only the pointer.
 */

/** The fragment body, as `window.location.hash` wants it (no leading `#`). */
export function runFragment(id: string): string {
  return `run/${id}`;
}

/**
 * A link into the workspace at one order.
 *
 * Absolute from the site root, because the only caller is a page that is NOT
 * the workspace and a relative fragment would address itself.
 */
export function runHref(id: string): string {
  return `/#${runFragment(id)}`;
}

/**
 * The run id an address points at, or `""` for none.
 *
 * Takes the raw `window.location.hash`, leading `#` and all, because that is
 * what the caller has. Anything that is not this app's own run fragment is
 * "none" rather than a guess: a stray fragment must not be handed to
 * `loadRun`, which would report a missing order the operator never asked for.
 */
export function runIdFromHash(hash: string): string {
  const match = /^#?run\/(.+)$/.exec(hash);
  return match ? match[1] : "";
}
