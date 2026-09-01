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
   * The template slot this fills.
   *
   * Usually a `SlotDef.key` verbatim. A slot whose `SlotDef.crops` is greater
   * than one -- the sample's `KB (lanjutan)` ToP row stacks two pictures cut
   * from two different pages -- gets ONE SlotState PER CAPTURE, keyed
   * `<slotKey>#1`, `<slotKey>#2`, because `zone` here holds a single zone and
   * a one-state-per-slot list would silently drop the second capture. That is
   * the failure this project cares about: a document that opens fine, looks
   * complete, and is missing evidence. Use `slotKeyOf` to get the template key
   * back; do not split the string by hand.
   */
  key: string;
  label: string;
  status: SlotStatus;
  /** From `src/lib/pipeline/locate.ts`. `pageIndex` indexes `BrowserRun.pages`. */
  zone?: Zone;
  /** The OCR text the zone covers, so the operator can judge it without squinting. */
  text?: string;
  origin?: "llm" | "human";
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
   * APPEND-ONLY, and that is load-bearing rather than a convention.
   *
   * A zone records `pageIndex`, which is a position in this array. Ingesting
   * a dokumen tambahan appends its pages to the end; it must never reorder or
   * remove earlier ones, or every zone an operator already confirmed silently
   * starts pointing at a different page. `scripts/generate.mjs` keeps its
   * global page list append-only across rounds for exactly this reason.
   */
  pages: StoredPage[];
  slots: SlotState[];
};
