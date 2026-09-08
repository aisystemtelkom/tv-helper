/**
 * The values half of a run: what `/api/extract` says each header field is.
 *
 * WHY THIS FILE DID NOT EXIST UNTIL NOW, which is worth writing down because
 * the absence was invisible and expensive. `/api/extract` has been built,
 * tested and gated for some time, and NOTHING IN THE APP CALLED IT. The only
 * two fetch sites in the browser were `propose.ts` and the ingest worker, and
 * `src/lib/ui/export.ts` built the workbook with `buildXlsx(template, [])` --
 * a literally empty array. So the header table sat blank and the whole of
 * xlsx column E shipped empty BY CONSTRUCTION, for every run, whatever the
 * documents said.
 *
 * That was not a bug in extraction. It was a missing wire, and it read to an
 * operator exactly like extraction failing: they asked why so little was
 * filled and the honest answer was that nothing had asked.
 *
 * `buildExtractRequest` is pure so `ui.test.mts` can drive it. Only
 * `requestExtraction` touches the network, and it touches exactly one host:
 * this app. Same shape as `propose.ts` on purpose, because the two routes
 * take the same wire contract (`src/lib/api/wire.ts`) and a second way of
 * saying it is a second thing to keep in step.
 */

// From the leaf module rather than from `./runtime.ts`, for the reason
// `propose.ts` imports it that way: this module is pure and is driven by
// `node --test`, which has neither IndexedDB nor a Web Worker.
import { aiExcludedSources } from "../browser/sources.ts";
import type { FieldValue } from "../pipeline/fields.ts";
import type { BrowserRun } from "./runtime.ts";

/** Mirrors `ExtractBody` in `src/app/api/extract/handler.ts`. */
export type ExtractRequest = {
  runId: string;
  pages: {
    index: number;
    sourceId: string;
    width: number;
    height: number;
    lines: BrowserRun["pages"][number]["lines"];
    sourceName?: string;
    /**
     * ABSENT ON EVERY ORDINARY PAGE, and only ever `false`. See
     * `WirePage.searchable` in `src/lib/api/wire.ts`.
     */
    searchable?: false;
  }[];
  answered?: string[];
};

/** Mirrors `FieldDisposition`. Six outcomes, and none of them collapse. */
export type FieldDisposition =
  | "cited"
  | "uncited"
  | "citation-invalid"
  | "conflict"
  | "not-found"
  | "not-searched";

export type ExtractedField = {
  fieldKey: string;
  value: string;
  status: FieldDisposition;
  confidence: "high" | "low";
  reason?: string;
  /**
   * Mirrors `CitedSource` in `src/lib/pipeline/fields.ts`, INCLUDING the two
   * optional members. `sourceName` and `pageInDoc` are the page's identity
   * outside this run's bundle-global numbering, and they are optional because
   * only the caller that remaps a pool position back to a real page can
   * resolve them. A citation naming only `pageIndex` sends a reviewer to the
   * wrong document for every page after the first source file, so a renderer
   * must handle their absence rather than assume them.
   */
  source?: {
    pageIndex: number;
    lineRange: [number, number];
    sourceName?: string;
    pageInDoc?: number;
  };
  /** Mirrors `CitationClaim`: what the model said, verbatim, nulls and all. */
  claimed?: {
    pageIndex: number | null;
    from: number | null;
    to: number | null;
  };
  conflict?: string[];
};

export type ExtractResponse = { fields: ExtractedField[] };

/**
 * The run as the extraction route reads it.
 *
 * A page's POSITION in the array is its run-global index, which is the
 * contract `src/lib/api/wire.ts` checks rather than assumes, and it is the
 * same one `buildProposeRequest` sends. `sourceName` is passed so a citation
 * can name the operator's own file rather than a uuid: the route falls back
 * to the `sourceId` when it is missing, which is unambiguous and unreadable.
 *
 * ## THE "tanpa AI" CHOICE REACHES THIS ROUTE TOO, AND IT IS NOT OPTIONAL
 *
 * This function sent every page unconditionally, and that was the quiet half
 * of the whole feature: an operator fences a berkas off, the search obeys, and
 * the EXTRACTION reads it anyway -- filling xlsx column E and the docx header
 * table with a value carrying a citation that PASSES VALIDATION and points
 * into the one document they were told would not be checked. Nothing looks
 * wrong anywhere, and a validator signs it. The two routes take the same wire
 * contract, so they take the same fence.
 *
 * Fenced pages still travel, and for the same reason as at `/api/propose`:
 * their positions ARE the run-global numbering. Their lines do not, and they
 * carry `searchable: false`, which the route filters on.
 *
 * NO OVERLAY IS SENT, unlike `buildProposeRequest`. `resolveTemplate` passes
 * `xlsxRows` and `fieldHints` through untouched, so this order's form cannot
 * change which keys are asked for or how; the reasoning is written out on
 * `extractValues`' `template` parameter.
 */
export function buildExtractRequest(
  run: BrowserRun,
  answered: readonly string[] = [],
): ExtractRequest {
  const nameOf = new Map(run.sources.map((s) => [s.id, s.name]));
  const fenced = aiExcludedSources(run);
  return {
    runId: run.id,
    pages: run.pages.map((page, position) => {
      const closed = fenced.has(page.sourceId);
      return {
        index: position,
        sourceId: page.sourceId,
        width: page.widthPx,
        height: page.heightPx,
        lines: closed ? [] : page.lines,
        sourceName: nameOf.get(page.sourceId),
        ...(closed ? { searchable: false as const } : {}),
      };
    }),
    ...(answered.length > 0 ? { answered: [...answered] } : {}),
  };
}

/**
 * WHAT AN EXTRACTION IS AN ANSWER ABOUT, as one comparable string.
 *
 * ## The failure this exists to close, traced end to end
 *
 * The shell caches `/api/extract`'s answer so that flicking between Periksa
 * and Berkas does not re-bill a reading of every page in the bundle. That
 * cache was keyed BY RUN ID ALONE, and neither marking a berkas "Tanpa AI" nor
 * removing one from the order invalidated it. So:
 *
 *   1. The operator opens Berkas. The values are read out of every berkas.
 *   2. They go back, mark one berkas Tanpa AI (or delete it outright).
 *   3. They return to Berkas and export.
 *
 * Column E and the docx header table then ship values mined from that berkas,
 * each carrying a citation that PASSES VALIDATION and points into the very
 * document the operator fenced off. The screen says the AI does not look
 * inside that berkas; the deliverable proves it did. Nothing is broken
 * anywhere, and a validator signs it.
 *
 * ## What is in the signature, and what is deliberately not
 *
 * The BERKAS SET AND THEIR FENCES, in stored order, because that is what
 * `buildExtractRequest` turns into a request: a source that is gone sends no
 * pages, and a fenced source sends `searchable: false`. Both change the
 * answer, and both are one press away on another screen.
 *
 * The fence is read through `aiExcludedSources` rather than off `source.ai`,
 * so this and the request it guards cannot disagree about what "fenced" means.
 * `ai` absent means DIBACA AI, and a hand-rolled `!source.ai` here would
 * silently re-read every order stored before the choice existed.
 *
 * NOT the page count. Ingest appends pages one at a time across minutes, so a
 * per-page signature would re-bill a 29-page reading on every page of a
 * dokumen tambahan being read in the background. A run that gains pages inside
 * a berkas it already had gains detail; it does not gain a wrong citation,
 * which is what this guard is for.
 *
 * NOT the run id. The shell holds that separately, because an answer belonging
 * to another order is a different mistake with a different remedy.
 */
export function extractionSignature(run: BrowserRun): string {
  const fenced = aiExcludedSources(run);
  return run.sources
    .map((source) => `${source.id}:${fenced.has(source.id) ? "0" : "1"}`)
    .join("|");
}

/** One reading, remembered with the two facts that say whether it still fits. */
export type ExtractionCache = {
  runId: string;
  /** `extractionSignature` of the run this answer was read out of. */
  sig: string;
  fields: ExtractedField[];
};

/**
 * The remembered reading, or null when it no longer describes this order.
 *
 * THE SIGNATURE IS RECOMPUTED HERE rather than compared by the caller, so
 * there is exactly one place that decides whether a cached reading still fits
 * the run in front of it. A caller that compared the wrong two strings would
 * fail in the quiet direction: it would serve values mined from a berkas the
 * operator has since fenced off or deleted.
 *
 * A MISMATCH IS "NOTHING HAS BEEN READ YET", not "here is something slightly
 * out of date". The screen re-asks, and says so while it does.
 */
export function usableExtraction(
  cache: ExtractionCache | null,
  run: BrowserRun,
): ExtractedField[] | null {
  if (!cache || cache.runId !== run.id) return null;
  return cache.sig === extractionSignature(run) ? cache.fields : null;
}

export async function requestExtraction(
  run: BrowserRun,
  answered: readonly string[] = [],
  signal?: AbortSignal,
): Promise<ExtractResponse> {
  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildExtractRequest(run, answered)),
    signal,
  });

  if (!response.ok) {
    // Same shape as `requestProposals`: the route answers JSON on every
    // failure it owns, a proxy may not, so fall back to the status rather
    // than throwing a parse error over the top of the real problem.
    const detail = await response
      .json()
      .then((body: { error?: string }) => body?.error)
      .catch(() => null);
    throw new Error(
      detail ?? `Pembacaan nilai gagal dengan HTTP ${response.status}.`,
    );
  }

  return (await response.json()) as ExtractResponse;
}

/**
 * What the operator should be told about one field, in the app's own voice.
 *
 * SIX STATUSES DO NOT COLLAPSE INTO "filled" AND "empty", and the reason is
 * the same reason the route reports six: they are different things to a human
 * validator, and two of the pairs are ones this project has already been
 * bitten by.
 *
 * `not-found` against `not-searched` is the pair `/api/propose` was bitten by:
 * reporting an unsearched slot as searched sent an operator hunting for
 * documents to fill a slot nothing had ever looked for.
 *
 * `citation-invalid` against `uncited` is the pair that matters most here.
 * Both leave a value with no usable reference, and they are opposite kinds of
 * evidence: `uncited` is an absence, while `citation-invalid` means the model
 * NAMED A PLACE AND THE PLACE WAS WRONG. That is a confabulation on the
 * record, and it is evidence about the VALUE, not merely about the reference.
 *
 * A CITED FIELD IS NOT TOLD TO "PERIKSA DULU", and that is deliberate. The
 * citation IS the check, and a better one, because it says where to look
 * instead of saying be careful. An operator warned on every filled cell stops
 * reading the warning, which is the same over-warning they objected to
 * elsewhere in the interface.
 *
 * WHAT A VALIDATED CITATION IS NOT: proof the value is right. `namaProyek`'s
 * recorded failure was a citation that PASSED validation while naming the
 * wrong document's title. Validation proves the cited lines exist and hold
 * something matching, never that the model picked the right thing. That is
 * why `confidence` is capped for some keys regardless of citation.
 */
export type FieldNote = {
  /** Print this under the input. Empty string means say nothing. */
  text: string;
  /** True when the operator should look before trusting it. */
  warn: boolean;
};

export function noteForField(field: ExtractedField): FieldNote {
  switch (field.status) {
    case "cited": {
      const s = field.source;
      if (!s) return { text: field.reason ?? "", warn: field.confidence === "low" };
      // `sourceName` and `pageInDoc` may be absent, and a citation that names
      // a page without naming its document is worse than one that admits it
      // only knows the position: for every page after the first source file
      // the bare number points into the wrong document. So the file is named
      // when it is known, and the page number is only printed alongside it.
      const [from, to] = s.lineRange;
      const where =
        s.sourceName && s.pageInDoc !== undefined
          ? `${s.sourceName}, hal ${s.pageInDoc + 1}, baris ${from}-${to}`
          : `baris ${from}-${to}`;
      // Low confidence on a CITED field means the key is capped rather than
      // the citation being doubtful, so it still gets its citation and gains
      // a look-first. High confidence gets the citation alone.
      return field.confidence === "high"
        ? { text: `Terbaca di ${where}.`, warn: false }
        : { text: `Terbaca di ${where}. Periksa dulu.`, warn: true };
    }
    case "citation-invalid": {
      const c = field.claimed;
      const named =
        c && c.pageIndex !== null
          ? ` Model menyebut hal ${c.pageIndex + 1}${
              c.from !== null && c.to !== null ? ` baris ${c.from}-${c.to}` : ""
            }, dan itu tidak cocok.`
          : "";
      return {
        text: `${field.reason ?? "Sumbernya tidak cocok."}${named} Periksa dulu.`,
        warn: true,
      };
    }
    case "uncited":
      return {
        text: `${field.reason ?? "Tidak ada sumber yang bisa ditunjuk."} Periksa dulu.`,
        warn: true,
      };
    case "conflict": {
      const both = field.conflict?.length
        ? ` Ditemukan: ${field.conflict.join(" / ")}.`
        : "";
      return {
        text: `${field.reason ?? "Dokumen tidak sepakat."}${both} Pilih sendiri.`,
        warn: true,
      };
    }
    case "not-found":
      return { text: field.reason ?? "Tidak ada di dokumen ini. Isi sendiri.", warn: false };
    case "not-searched":
      return { text: field.reason ?? "Tidak dicari. Isi sendiri.", warn: false };
  }
}

/**
 * The fields that may be written into a cell, and the ones that may not.
 *
 * THE TRAP THIS FUNCTION EXISTS FOR: `not-searched` arrives with an EMPTY
 * value, and it arrives for two different reasons. One is `namaProyek`, which
 * nothing ever searches. The other is a key THE ORDER REQUEST ALREADY
 * ANSWERED, where the run genuinely holds a value and the route was told not
 * to go hunting for a second one. Writing an empty string into that cell
 * because the status was not `cited` would erase a value the operator gave
 * us, which is worse than never having asked.
 *
 * So only a field that actually carries text is ever written, and every other
 * status leaves whatever is already in the cell alone.
 */
export function fillableValues(
  fields: readonly ExtractedField[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const field of fields) {
    if (field.value.trim() === "") continue;
    out.set(field.fieldKey, field.value);
  }
  return out;
}

/**
 * Column E of the workbook, as `buildXlsx` takes it.
 *
 * THE CITATION TRAVELS WITH THE VALUE, and it did not. The export screen built
 * this list inline and copied across `fieldKey`, `value` and `conflict` only,
 * so `buildXlsx`'s whole note-writing branch (`else if (value?.source)`) was
 * dead in the browser: EVERY cell of the workbook an operator actually
 * produces shipped with no note at all, while the headless `pnpm generate`
 * wrote one on each. AGENTS.md states the rule flatly -- an xlsx cell note
 * must name the source file and its own page number -- and the deliverable
 * that reaches a validator was the one without the audit trail.
 *
 * It is exactly the wrong-and-quiet shape: the number in the cell is the same
 * either way, so the missing half is invisible until somebody tries to check
 * one and finds there is nothing to check it against.
 *
 * `source` IS SET ONLY FOR A VALIDATED CITATION. `/api/extract` fills it on
 * `cited` and on nothing else -- not on `citation-invalid`, where the model
 * named a place and the place was wrong. So a note written from it never
 * points a reviewer at a page the model confabulated, and a cell with no note
 * is a cell with no citation rather than one whose citation was dropped in
 * transit.
 *
 * EVERY FIELD IS CARRIED, blanks included, because `buildXlsx` writes
 * `value?.value ?? ""` and a conflict entry is deliberately a blank value plus
 * both spellings. Dropping those here would take the conflict with them.
 */
export function columnEValues(fields: readonly ExtractedField[]): FieldValue[] {
  return fields.map((field) => ({
    fieldKey: field.fieldKey,
    value: field.value,
    ...(field.conflict ? { conflict: field.conflict } : {}),
    ...(field.source ? { source: field.source } : {}),
  }));
}
