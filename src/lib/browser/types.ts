/**
 * The data shapes shared by the browser runtime and everything that consumes
 * it.
 *
 * They live here, one hop below `runtime.ts`, only so that
 * `src/lib/storage/runs.ts` can persist them without importing the module
 * that imports it. `runtime.ts` re-exports every one of them, so callers
 * should import from there and never from this file.
 */

import type { Line } from "../pipeline/geometry.ts";
import type { Zone } from "../pipeline/locate.ts";

export type SlotStatus =
  /** Not searched yet. */
  | "pending"
  /** The model proposed a zone; the operator has not ruled on it. */
  | "proposed"
  /** The operator accepted the proposal or redrew it by hand. */
  | "confirmed"
  /** Searched, not found. This is what drives the dokumen tambahan loop. */
  | "outstanding"
  /** The operator declined to supply more documents; this slot ships empty. */
  | "unfilled";

export type SlotState = {
  /**
   * WHICH CAPTURE OF WHICH TEMPLATE SLOT THIS IS.
   *
   * Capture 1 is the `SlotDef.key` verbatim. A LANJUTAN -- the rest of one
   * field's evidence, carried onto the next page by a page break -- is keyed
   * `<slotKey>#2`, `<slotKey>#3`, because `zone` here holds a single zone and
   * one state per slot would silently drop the continuation. That is the
   * failure this project cares about: a document that opens fine, looks
   * complete, and is missing evidence.
   *
   * A CONTINUATION IS DISCOVERED, NEVER DECLARED. Nothing in the template says
   * how many captures a slot holds, because nothing can: the same payment
   * clause fits one page on one contract and runs to three on the next. So
   * `seedSlots` seeds exactly ONE state per fillable slot and
   * `src/lib/pipeline/continuation.ts` finds the rest. An operator testing the
   * declared version found what it produces -- a sheet showing "ToP 1" and
   * "ToP 2" with the second permanently missing, on a document holding one
   * ToP.
   *
   * Use `slotKeyOf` for the template key and `captureOrdinalOf` for the
   * ordinal; do not split the string by hand.
   */
  key: string;
  label: string;
  status: SlotStatus;
  /** From `src/lib/pipeline/locate.ts`. `pageIndex` indexes `BrowserRun.pages`. */
  zone?: Zone;
  /** The OCR text the zone covers, so the operator can judge it without squinting. */
  text?: string;
  origin?: "llm" | "human";
  /**
   * WHETHER ANYTHING HAS LOOKED FOR A LANJUTAN AFTER THIS CAPTURE.
   *
   * NOT OPTIONAL POLISH. Dropping the declared capture count trades one
   * failure for another: the old design ASSERTED a capture that might not
   * exist, and a discovered one can SILENTLY MISS one that does. On the second
   * sample bundle that is 33 chances to ship a truncated clause. The only
   * thing that closes it is recording that the search happened, so an
   * unchecked capture reads differently from a checked one and never reads as
   * complete.
   *
   * A FACT ABOUT ONE RECTANGLE, NEVER ABOUT THE SLOT, AND IT NAMES THE
   * RECTANGLE. What was known about the old zone's page bottom says nothing
   * about a new one, and a stale verdict both prints the affirmative on the
   * sheet and excludes the zone from every future walk.
   *
   * It was a boolean once, and that made the invariant a thing every writer
   * had to REMEMBER. Three replace a zone -- a hand redraw, a rejection, and a
   * fresh proposal arriving through the ordinary tambahan loop -- and all three
   * were found carrying a verdict about a rectangle that no longer existed.
   * The third is the one that matters: it needs no unusual operator action at
   * all. A fourth writer would have had to remember too.
   *
   * So it holds the FINGERPRINT of the zone that was walked, and
   * `continuationChecked(slot)` in `src/lib/browser/captures.ts` compares it
   * against the zone the slot holds now. `{ ...slot, zone: next }` written by
   * anybody carries a verdict whose subject no longer matches, and reads as
   * unchecked without that writer doing anything. The rule is enforced where
   * it is READ, which is one place, instead of at every place it is written,
   * which is an open set.
   *
   * Set true in exactly two cases. First, the walk past THIS capture reached a
   * definitive no: `endedOnDefinitiveNo` in
   * `src/lib/pipeline/continuation.ts` says which verdicts those are, and a
   * whole-page capture is NOT one of them -- stage 1 declines it because the
   * test carries no information, not because there is nothing there. Second,
   * the walk found this capture's own lanjutan and the run already holds it, so
   * there is nothing left to look for; leaving the middle of a chain unstamped
   * made the next Proses re-walk it and append the same evidence again.
   *
   * A chain stopped by the cap or by an error leaves its last link false,
   * because "we ran out of budget" is not "there is nothing there".
   */
  continuationCheckedFor?: string;
};

export type StoredPage = {
  id: string;
  /** The `BrowserRun.sources` entry this page was rendered from. */
  sourceId: string;
  /**
   * The page's 0-based number WITHIN ITS OWN SOURCE DOCUMENT, which is what
   * `pageBitmap` re-renders and what a citation has to name.
   *
   * It is NOT the run-global page number. That one is the page's position in
   * `BrowserRun.pages`, and it is what `Zone.pageIndex` refers to. Confusing
   * the two sends a reviewer to the wrong document for every page after the
   * first source file, with nothing looking wrong on the way.
   */
  index: number;
  widthPx: number;
  heightPx: number;
  lines: Line[];
};

export type RunSource = { id: string; name: string; pageCount: number };

export type BrowserRun = {
  id: string;
  createdAt: number;
  /**
   * WHICH STORED VERSION OF THIS RUN THIS OBJECT WAS BUILT FROM.
   *
   * Storage owns it. `getRun` stamps what it read, and every write compares
   * this number against what is stored and refuses when they differ (see
   * `putRun`). It is not a timestamp, a page count, or anything a caller
   * should compute; the only correct thing to do with it is to carry it
   * along unchanged, which `{ ...run, slots }` already does.
   *
   * WHY IT EXISTS. `putRun` replaces a run wholesale, so a `BrowserRun`
   * captured before an `ingestDocument` resolves does not have the pages
   * that ingest appended -- and saving it deleted every one of them and
   * reported success. Minutes of OCR gone, no error, and the run still opens
   * and still looks complete. No amount of caller discipline fixes that: the
   * UI holds a run in React state for as long as the operator is looking at
   * it, and an ingest runs for minutes underneath. A number the write can
   * check does fix it.
   *
   * OPTIONAL, AND STRICTLY: absent means "never came from storage", which is
   * treated as revision 0, the oldest possible. So a hand-built run can
   * create a run that does not exist yet and can never overwrite one that
   * does. The check is never skipped -- a missing `rev` is the most stale
   * value there is, not a waiver.
   */
  rev?: number;
  sources: RunSource[];
  /**
   * A ZONE RECORDS `pageIndex`, WHICH IS A POSITION IN THIS ARRAY, and every
   * rule about this field follows from that one sentence.
   *
   * It was written down as "append-only" while that was the only way to keep
   * the rule true. Ingesting a dokumen tambahan appends to the end and must
   * never reorder or remove what is already here, or every zone an operator
   * already confirmed silently starts pointing at a different page.
   * `scripts/generate.mjs` keeps its global page list append-only across
   * rounds for exactly this reason.
   *
   * THE ONE THING THAT MAY SHORTEN IT is removing a whole source document from
   * an open pekerjaan, and it is allowed only because it does the other half:
   * `removeSource` in `src/lib/browser/sources.ts` renumbers every surviving
   * zone through the same map it renumbers the pages with, drops the evidence
   * that lived inside the removed document rather than repointing it, and
   * names both to `putRun`. Anything that shortens this array WITHOUT moving
   * the zones is the failure this comment exists to prevent, and `putRun`
   * refuses it: a shed page must be named in `removingPages`.
   */
  pages: StoredPage[];
  /**
   * NO LONGER A PURE FUNCTION OF THE TEMPLATE, and that is what makes the
   * guard on it necessary.
   *
   * While every capture was declared, `seedSlots(AO_TEMPLATE)` and the stored
   * array agreed by definition: anything that rebuilt this list rebuilt it
   * identically and there was nothing to lose. Now that a lanjutan is
   * DISCOVERED, any code that regenerates `slots` from the template -- a
   * template migration, a "reset this run", a helper that maps over
   * `AO_TEMPLATE.sections` -- would delete every discovered capture at the
   * CORRECT revision, with every page intact, and `putRun` would report
   * success. Pages intact, revision current, evidence gone.
   *
   * So the invariant, stated as what is true rather than as "append-only",
   * which it is not: A WHOLE-ARRAY WRITE MAY NOT DROP A `SlotState` THAT
   * CARRIES A ZONE. The operator legitimately removes a wrongly-proposed
   * lanjutan, so removal is a real operation -- it just has to SAY which
   * capture it is removing (`putRun`'s `removing` option) instead of being a
   * side effect of writing a shorter array. Enforced in `putRun` with
   * `CaptureLossError`, in the write's own transaction, beside `PageLossError`.
   */
  slots: SlotState[];
};
