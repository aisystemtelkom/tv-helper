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
 */
export function buildExtractRequest(
  run: BrowserRun,
  answered: readonly string[] = [],
): ExtractRequest {
  const nameOf = new Map(run.sources.map((s) => [s.id, s.name]));
  return {
    runId: run.id,
    pages: run.pages.map((page, position) => ({
      index: position,
      sourceId: page.sourceId,
      width: page.widthPx,
      height: page.heightPx,
      lines: page.lines,
      sourceName: nameOf.get(page.sourceId),
    })),
    ...(answered.length > 0 ? { answered: [...answered] } : {}),
  };
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
