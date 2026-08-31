/**
 * The messages the page and the render/OCR Web Worker exchange.
 *
 * Kept in its own module so both sides compile against one definition. The
 * worker is bundled separately from the page, so a shape that drifted would
 * not fail the build -- it would fail at runtime, on an operator's machine,
 * with a message that had no handler.
 *
 * NOTHING LARGE CROSSES THIS BOUNDARY IN EITHER DIRECTION. A request names a
 * source by id and the worker reads the PDF bytes from IndexedDB itself,
 * because `postMessage` structured-clones its payload and a bundle is tens of
 * megabytes that would be copied on every single page view. The one big reply
 * is a rendered `ImageBitmap`, which is transferable and therefore moved
 * rather than copied.
 */

import type { IngestedPage } from "./ingest.ts";

export type WorkerRequest =
  | { kind: "ingest"; id: number; sourceId: string; lang?: string }
  | { kind: "bitmap"; id: number; sourceId: string; pageIndex: number };

export type WorkerResponse =
  /** One page finished. Sent per page so the UI can move a progress bar. */
  | { kind: "page"; id: number; page: IngestedPage; done: number; total: number }
  /** Every page of the requested source is done. */
  | { kind: "ingested"; id: number; pageCount: number }
  | { kind: "bitmap"; id: number; bitmap: ImageBitmap }
  /**
   * The request failed.
   *
   * A string, not the Error: structured clone drops a custom prototype and
   * an Error crossing a worker boundary arrives stripped of anything that
   * made it actionable. The worker copies `message` verbatim -- the OCR
   * asset-path timeout in `src/lib/pipeline/ocr.ts` says exactly what to run
   * to fix it, and that sentence is the whole value of the error.
   */
  | { kind: "failed"; id: number; message: string };
