import { z } from "zod";
import { extractJson } from "./json.ts";
import type { Ask } from "./classify.ts";
import type { OcrPage } from "./locate.ts";

export type FieldValue = {
  fieldKey: string;
  value: string;
  source?: {
    pageIndex: number;
    lineRange: [number, number];
    // The page's identity outside this run's bundle-global numbering: the
    // source file it actually came from, and its 0-based page number within
    // that file. Optional because `citedSource` below only knows the
    // position within whatever pool it was given -- the caller
    // (generate.mjs's extractTextFields) is the one that can resolve these,
    // once it remaps that position back to the page's true identity. Without
    // them, a citation naming only a bundle-global page number sends a
    // reviewer to the wrong document for every page after the first source
    // file (task-11 finding 2).
    sourceName?: string;
    pageInDoc?: number;
  };
};

/**
 * Filenames carry the two ids reliably enough to prefill, and not reliably
 * enough to trust. Returning "" rather than a guess is deliberate: the
 * operator confirms every header field, and a blank invites that while a
 * plausible wrong value does not.
 */
export function deriveIdsFromFilenames(names: string[]): {
  idEpic: string;
  quote: string;
} {
  const joined = names.join(" ");
  // No \b anchors: "_" is a word character, so \bLOP\d+\b never matches
  // inside LOP999001_EXISTING_... which is exactly the shape of these names.
  return {
    idEpic: joined.match(/LOP\d{4,}/)?.[0] ?? "",
    quote: joined.match(/\d-\d{9,}/)?.[0] ?? "",
  };
}

const Reply = z.object({
  values: z.array(
    z.object({
      fieldKey: z.string(),
      value: z.string(),
      pageIndex: z.number().int().min(0).nullable(),
      from: z.number().int().min(0).nullable(),
      to: z.number().int().min(0).nullable(),
    }),
  ),
});

/**
 * Page headers are numbered by their *position in this listing* (0, 1, 2...
 * in the order shown), never by the page's true index in the source
 * document -- exactly `locate.ts`'s convention (see `buildLocatePrompt`'s
 * header comment there), and for the same measured reason: a pool whose
 * first page isn't labelled "page 0" got answered one position off, because
 * "convert a non-zero first label to 0-based" and "echo the label back" are
 * indistinguishable until the first label actually is non-zero. Leaving this
 * function to echo whatever `p.index` happens to hold reopens exactly that
 * ambiguity for whichever caller doesn't pre-renumber. Local, always-0-based
 * position numbering removes it outright; the caller maps a returned
 * `pageIndex` back to the page's true identity (`pages[pageIndex].index`).
 */
export async function extractFields(
  keys: string[],
  pages: OcrPage[],
  ask: Ask,
): Promise<FieldValue[]> {
  const listing = pages
    .map(
      (p, position) =>
        `--- page ${position} ---\n` +
        p.lines.map((l) => `${l.i}: ${l.text}`).join("\n"),
    )
    .join("\n\n");

  const prompt = [
    "Extract these fields from the numbered OCR lines below.",
    `Fields: ${keys.join(", ")}`,
    "",
    "Report only fields the text actually contains. Omit anything you would",
    "have to infer. For each one, cite the page and line range it came from.",
    "",
    "Pages are numbered by their position in this list: the first page shown",
    "is page 0, the second is page 1, and so on, regardless of where each",
    "page sits in the original document.",
    "",
    'Reply with JSON only: {"values":[{"fieldKey":"cc","value":"PT X",',
    '"pageIndex":0,"from":3,"to":3}]}',
    "(pageIndex is that position number, not a document page number.)",
    "",
    listing,
  ].join("\n");

  const parsed = Reply.parse(extractJson(await ask(prompt)));

  return parsed.values
    .filter((v) => keys.includes(v.fieldKey) && v.value.trim() !== "")
    .map((v) => ({
      fieldKey: v.fieldKey,
      value: v.value,
      source: citedSource(v, pages),
    }));
}

/**
 * Trusts a citation only after it checks out, because it flows straight into
 * an xlsx cell note a reviewer relies on: a hallucinated page, an
 * out-of-range line, or a reversed range must not read as a real citation.
 * The value itself survives a bad citation -- dropping the whole entry over
 * one bad citation would discard a good extracted value for no reason, and
 * a false citation is worse than none, since a reviewer cannot tell it apart
 * from a real one without rerunning the pipeline.
 */
function citedSource(
  v: { pageIndex: number | null; from: number | null; to: number | null },
  pages: OcrPage[],
): FieldValue["source"] {
  if (v.pageIndex === null || v.from === null || v.to === null) {
    return undefined;
  }
  // pageIndex is a position in `pages` (see this file's header comment on
  // extractFields), so an out-of-range one means the model cited a page it
  // was never offered.
  const page = pages[v.pageIndex];
  if (!page) return undefined;
  if (v.from > v.to) return undefined;
  const lineIndices = new Set(page.lines.map((l) => l.i));
  if (!lineIndices.has(v.from) || !lineIndices.has(v.to)) return undefined;

  return { pageIndex: v.pageIndex, lineRange: [v.from, v.to] };
}
