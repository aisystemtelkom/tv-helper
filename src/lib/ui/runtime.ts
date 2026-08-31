/**
 * THE SEAM between this UI track and the browser-runtime track.
 *
 * The agreed interface is `src/lib/browser/runtime.ts`, which a sibling track
 * is implementing concurrently. That path does not exist in this branch, so
 * every type below is a MIRROR of the agreed contract, copied verbatim, and
 * `src/lib/ui/stub-runtime.ts` is a fake implementation the UI is developed
 * against.
 *
 * WHY THE MIRROR RATHER THAN AN IMPORT. Creating `src/lib/browser/runtime.ts`
 * here would collide with the file the runtime track is adding at exactly that
 * path -- a both-added merge conflict over a file this track does not own.
 * Mirroring costs one file and conflicts with nothing.
 *
 * HOW TO SNAP THE TWO TOGETHER AT MERGE. Two edits, both in files this track
 * owns:
 *
 *   1. In THIS file, delete the mirrored type block and re-export instead:
 *
 *        export type {
 *          SlotStatus, SlotState, StoredPage, BrowserRun,
 *        } from "../browser/runtime.ts";
 *
 *      `tsc` then proves the mirror was accurate: every consumer is typed
 *      against the real declarations, and any drift becomes a compile error
 *      rather than a runtime surprise.
 *
 *   2. In `src/components/operator/operator-app.tsx`, pass the real module to
 *      `<RuntimeProvider runtime={...}>` in place of `createStubRuntime()`.
 *      The shape it must satisfy is `Runtime` below, whose members are the
 *      contract's free functions gathered into one object so the UI can be
 *      driven by a fake without a module mock.
 *
 * Nothing else in this track imports the runtime directly. That is deliberate:
 * the swap is meant to be two edits, not a search.
 */

import type { Line } from "../pipeline/geometry.ts";
import type { Zone } from "../pipeline/locate.ts";

export type { Line, Zone };

/* -------------------------------------------------------------------------
 * MIRROR OF THE CONTRACT. Keep identical to src/lib/browser/runtime.ts.
 * ---------------------------------------------------------------------- */

export type SlotStatus =
  | "pending" // not searched yet
  | "proposed" // model proposed a zone, awaiting the operator
  | "confirmed" // operator accepted or redrew it
  | "outstanding" // searched, not found - drives the dokumen tambahan loop
  | "unfilled"; // operator declined to supply more documents; ships empty

export type SlotState = {
  key: string;
  label: string;
  status: SlotStatus;
  zone?: Zone; // from src/lib/pipeline/locate.ts
  text?: string; // the OCR text the zone covers, for the operator to judge
  origin?: "llm" | "human";
};

export type StoredPage = {
  id: string;
  sourceId: string;
  index: number;
  widthPx: number;
  heightPx: number;
  lines: Line[]; // from src/lib/pipeline/geometry.ts
};

export type BrowserRun = {
  id: string;
  createdAt: number;
  sources: { id: string; name: string; pageCount: number }[];
  pages: StoredPage[];
  slots: SlotState[];
};

/* ---------------------------------------------------------------------- */

export type RunSummary = { id: string; createdAt: number; label: string };

/**
 * The contract's free functions, gathered into one object.
 *
 * The contract declares them as module-level exports; this UI takes them as a
 * value so a screen can be driven by the stub, and so the live/stub choice is
 * made in one place instead of by whichever module happened to import first.
 * A module of free functions satisfies this type as-is.
 */
export type Runtime = {
  outstandingSlots(run: BrowserRun): SlotState[];
  listRuns(): Promise<RunSummary[]>;
  loadRun(id: string): Promise<BrowserRun | null>;
  saveRun(run: BrowserRun): Promise<void>;
  /**
   * Renders + OCRs every page of `file` in a Web Worker and appends them to
   * the run. `onProgress` reports page-level progress so the UI can show a bar.
   */
  ingestDocument(
    runId: string,
    file: File,
    onProgress?: (done: number, total: number) => void,
  ): Promise<BrowserRun>;
  /** A page bitmap for display and for cropping. Rendered on demand. */
  pageBitmap(runId: string, pageId: string): Promise<ImageBitmap>;
};
