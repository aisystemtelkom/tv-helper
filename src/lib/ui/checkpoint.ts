/**
 * The wire for Konfig Excel and Input EPIC, and the one place the operator's
 * workbook is opened.
 *
 * Same shape as `extract.ts` and `propose.ts` on purpose: the request builders
 * are PURE so `ui.test.mts` can drive them, and only the three `request*`
 * functions touch the network, each touching exactly one host, which is this
 * app.
 *
 * ## THE WORKBOOK IS OPENED HERE, ON THE DEVICE, AND ONLY ITS TEXT LEAVES
 *
 * `readWorkbook` runs `jszip` in this tab. What crosses the wire is each cell's
 * TEXT and its ADDRESS, never a byte of the `.xlsx`, and the amended workbook
 * is patched back into the operator's own bytes here too. That is the same
 * boundary the locate step already draws when it sends numbered OCR lines
 * rather than page images, and it is the reason
 * `src/app/privacy/page.tsx` can say the konfigurasi is not uploaded while
 * saying plainly that the EPIC captures are.
 *
 * THE EPIC CAPTURES ARE THE EXCEPTION AND IT IS DELIBERATE. A screen capture
 * has no text until something recognises it, so `recogniseCapture` posts the
 * image to this app's own `/api/ocr`, exactly as a rendered page does. The
 * privacy page names it as its own category rather than folding it into the
 * page-image sentence, because "your files stay on the device" would otherwise
 * read as covering it.
 */

import type { Line } from "../pipeline/geometry.ts";
import type {
  ConfigEntry,
  ConfigField,
  ConfigWorkbook,
  EpicEntry,
} from "../config/types.ts";
// From the leaf modules rather than from `./runtime.ts`, for the reason
// `propose.ts` imports them that way: this module is pure apart from its fetch
// sites and is driven by `node --test`, which has neither IndexedDB nor a
// Web Worker.
import { aiExcludedSources } from "../browser/sources.ts";
import type { Sheet } from "../xlsx/grid.ts";
import { readWorkbook } from "../xlsx/read.ts";
import type { BrowserRun } from "./runtime.ts";

/** Mirrors `WireSheet` in `src/app/api/config/handler.ts`. */
export type WireSheet = {
  name: string;
  cells: Sheet["cells"];
  dimension: string;
  rows: number;
  cols: number;
  merges: string[];
};

/** Mirrors `ConfigBody`. */
export type ConfigRequest = {
  runId: string;
  pages: WirePageOut[];
  sheet?: WireSheet;
  fields?: ConfigField[];
  retry?: boolean;
  /** Interpret the sheet and stop. See `buildFieldsOnlyRequest`. */
  compare?: boolean;
};

/** Mirrors `ConfigResult`. */
export type ConfigResponse = {
  fields?: ConfigField[];
  unusable?: { label: string; labelRef?: string; valueRef?: string; reason: string }[];
  note?: string;
  entries: ConfigEntry[];
};

/** Mirrors `EpicBody`. */
export type EpicRequest = {
  runId: string;
  fields: ConfigField[];
  captures: { id: string; name: string; lines: Line[] }[];
};

/** Mirrors `EpicResult`. */
export type EpicResponse = { entries: EpicEntry[] };

/**
 * A page as both checkpoint routes read it.
 *
 * Identical to what `buildExtractRequest` sends, and identical for the reason
 * that file gives at length: a page's POSITION in the array IS its run-global
 * index, and the fenced berkas ("tanpa AI") must reach these routes too. A
 * checkpoint that read a document the operator fenced off would recommend a
 * change to their workbook out of the one berkas they said the model must not
 * look inside, and the recommendation would carry a citation that passes
 * validation.
 *
 * Fenced pages still TRAVEL, because their positions are the numbering. Their
 * lines do not, and they carry `searchable: false`, which the routes filter on.
 */
type WirePageOut = {
  index: number;
  sourceId: string;
  width: number;
  height: number;
  lines: Line[];
  sourceName?: string;
  searchable?: false;
};

function wirePages(run: BrowserRun): WirePageOut[] {
  const nameOf = new Map(run.sources.map((s) => [s.id, s.name]));
  const fenced = aiExcludedSources(run);
  return run.pages.map((page, position) => {
    const excluded = fenced.has(page.sourceId);
    return {
      index: position,
      sourceId: page.sourceId,
      width: page.widthPx,
      height: page.heightPx,
      lines: excluded ? [] : page.lines,
      ...(nameOf.get(page.sourceId)
        ? { sourceName: nameOf.get(page.sourceId) }
        : {}),
      ...(excluded ? { searchable: false as const } : {}),
    };
  });
}

/**
 * The sheet, flattened for JSON.
 *
 * `Sheet.byRef` is a `Map` and does not survive `JSON.stringify`, so it is
 * dropped here and REBUILT on the server from the cells beside it. Rebuilding
 * rather than sending an index is the point: `byRef` is what every
 * anti-fabrication check in `config-interpret.ts` consults, and an index
 * supplied by this side could disagree with the cells it claims to describe.
 */
export function toWireSheet(sheet: Sheet): WireSheet {
  return {
    name: sheet.name,
    cells: sheet.cells,
    dimension: sheet.dimension,
    rows: sheet.rows,
    cols: sheet.cols,
    merges: sheet.merges,
  };
}

/** The first request: read this workbook and check every isian in it. */
export function buildInterpretRequest(
  run: BrowserRun,
  sheet: Sheet,
): ConfigRequest {
  return { runId: run.id, pages: wirePages(run), sheet: toWireSheet(sheet) };
}

/**
 * READ THIS WORKBOOK AND STOP THERE: what isian does it hold?
 *
 * Input EPIC's "yes, I have a newer konfigurasi". EPIC is judged against that
 * workbook, so the SCANS are not part of the question at all, and the
 * comparison the route would otherwise run is the single most expensive call it
 * makes -- one carrying the whole run's page listing, measured at 23k input
 * tokens for a 29-page bundle and several times that for the 151-page one.
 * Input EPIC reads only `fields` from the answer, so every one of those
 * verdicts was paid for and dropped.
 *
 * NO PAGES TRAVEL EITHER, and the flag is what makes that honest.
 *
 * The listing is the whole run's OCR text: several megabytes for the 151-page
 * bundle, posted for a question that cannot read it. Sending an empty array on
 * its OWN would be a lie -- `compareToDocuments` has a free empty-pool branch,
 * so it would buy the same saving by telling the route this order has no
 * readable page, which is true of the bill and false of the order, and is
 * exactly the coincidence a later reader breaks by accident. `compare: false`
 * states the intent instead, the route refuses it without a sheet, and the
 * empty array is then a consequence of the question rather than a claim about
 * the bundle.
 */
export function buildFieldsOnlyRequest(
  run: BrowserRun,
  sheet: Sheet,
): ConfigRequest {
  return {
    runId: run.id,
    pages: [],
    sheet: toWireSheet(sheet),
    compare: false,
  };
}

/**
 * The re-search, over the fields that came back `tidak-ditemukan`.
 *
 * NO `sheet`, because the workbook has already been interpreted and asking
 * again would spend a second model call to be told the same layout. The route
 * refuses `sheet` and `fields` together for that reason.
 *
 * The BUDGET IS NOT HERE. `ConfigCheck.researched` on the stored run is what
 * stops a second press, and it is stored rather than kept in a component
 * because a budget that resets when the operator reloads the tab is not a
 * budget. This function will happily build a second request; the screen must
 * not offer one.
 */
export function buildResearchRequest(
  run: BrowserRun,
  fields: readonly ConfigField[],
): ConfigRequest {
  return {
    runId: run.id,
    pages: wirePages(run),
    fields: [...fields],
    retry: true,
  };
}

export function buildEpicRequest(
  run: BrowserRun,
  fields: readonly ConfigField[],
  captures: readonly { id: string; name: string; lines: Line[] }[],
): EpicRequest {
  return {
    runId: run.id,
    fields: [...fields],
    captures: captures.map((c) => ({ id: c.id, name: c.name, lines: c.lines })),
  };
}

/**
 * The berkas the operator handed over, opened on this device.
 *
 * WHICH SHEET. A workbook may hold several and only one is the order
 * configuration. The FIRST sheet holding any non-empty cell is taken, and the
 * caller is handed every sheet name so the screen can say which was read: all
 * three real client workbooks have exactly one sheet, so anything cleverer
 * would be a rule invented against no evidence, and anything quieter would let
 * an operator with a two-sheet workbook check the wrong one without knowing.
 */
export async function openWorkbook(
  file: File,
): Promise<{ sheet: Sheet; sheetNames: string[] }> {
  const workbook = await readWorkbook(new Uint8Array(await file.arrayBuffer()));
  const sheet =
    workbook.sheets.find((s) => s.cells.length > 0) ?? workbook.sheets[0];
  if (!sheet) {
    throw new Error("Berkas konfigurasi ini tidak punya lembar yang bisa dibaca.");
  }
  return { sheet, sheetNames: workbook.sheetNames };
}

/**
 * `sha256` of the bytes, as `RunSource.digest` is computed.
 *
 * THE SAME IDENTITY RULE BERKAS USE, and for the same reason: a renamed copy
 * out of a downloads folder is the same workbook and a name check cannot see
 * it. `crypto.subtle` needs a secure context, which this app already requires
 * for `crypto.randomUUID`, so there is no fallback digest here either -- a
 * second algorithm would give one workbook two identities depending on which
 * context read it.
 */
export async function digestOf(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The stored record for a workbook, with its bytes already put away. */
export function workbookRecord(
  id: string,
  file: File,
  sheet: Sheet,
  sheetNames: string[],
  digest: string,
): ConfigWorkbook {
  return { id, name: file.name, digest, sheets: sheetNames, sheet: sheet.name };
}

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });

  if (!response.ok) {
    // The routes answer JSON on every failure path they own; a proxy or a
    // platform error may not, so fall back to the status rather than throwing
    // a parse error over the top of the real problem. Same shape as
    // `propose.ts`.
    const detail = await response
      .json()
      .then((body: { message?: string; error?: string }) => body?.message ?? body?.error)
      .catch(() => null);
    throw new Error(detail ?? `Pemeriksaan gagal dengan HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

export function requestConfigCheck(
  request: ConfigRequest,
  signal?: AbortSignal,
): Promise<ConfigResponse> {
  return post<ConfigResponse>("/api/config", request, signal);
}

export function requestEpicCheck(
  request: EpicRequest,
  signal?: AbortSignal,
): Promise<EpicResponse> {
  return post<EpicResponse>("/api/epic", request, signal);
}

/**
 * One tangkapan layar EPIC, recognised.
 *
 * Straight to `/api/ocr`, which already takes raw PNG bytes and answers with
 * this pipeline's numbered `Line[]`. NOTHING HERE GOES THROUGH THE INGEST
 * PATH, and that is the decision worth recording: a `StoredPage` is rendered
 * from a PDF on demand by `renderBitmap`, is cropped, is drawn as a denah and
 * is cited in the deliverable, and every one of those is PDF-shaped. A capture
 * is read for its text and nothing else, so putting it in `BrowserRun.pages`
 * would buy a branch in each of those for no gain and would put a screenshot
 * into `Zone.pageIndex`'s arithmetic.
 *
 * NO COMPLETENESS LADDER EITHER. `ocrPageCompletely`'s two thresholds were
 * calibrated on 300 DPI A4 scans and AGENTS.md records that they do not
 * generalise cleanly even between two bundles of those. A screen capture has
 * entirely different ink -- chrome, whitespace, a form with twenty short
 * fields -- so applying them here would be a calibration with no measurement
 * behind it. What replaces it is the one unambiguous signal: a capture that
 * comes back with ZERO lines is refused by name, because a silently-kept blank
 * capture would make every isian on it report `tidak ditemukan`.
 */
export async function recogniseCapture(
  png: Uint8Array,
): Promise<{ width: number; height: number; lines: Line[] }> {
  const response = await fetch("/api/ocr", {
    method: "POST",
    headers: { "content-type": "image/png" },
    // Narrows a fact that already holds rather than asserting a new one: the
    // bytes come from `canvas.convertToBlob`/`toBlob`, which hand back plain
    // ArrayBuffer-backed views. Same note as `pipeline.worker.ts`.
    body: png as Uint8Array<ArrayBuffer>,
    credentials: "same-origin",
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { message?: string; error?: string }) => body?.message ?? body?.error)
      .catch(() => null);
    throw new Error(
      detail ?? `Tangkapan layar gagal dibaca dengan HTTP ${response.status}.`,
    );
  }

  const body = (await response.json()) as {
    width: number;
    height: number;
    lines: Line[];
  };
  return { width: body.width, height: body.height, lines: body.lines };
}
