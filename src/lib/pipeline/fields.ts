import { z } from "zod";
import { canonicalEntity, sameEntity } from "./abbrev.ts";
import { extractJson } from "./json.ts";
import type { Ask } from "./classify.ts";
import type { OcrPage } from "./locate.ts";

export type FieldValue = {
  fieldKey: string;
  value: string;
  /**
   * Set only by `reconcileFieldValues`, and only when two spellings of this
   * fieldKey turned out to denote DIFFERENT things. It carries every
   * distinct spelling that disagreed, and the entry's `value` is then blank
   * on purpose: shipping either candidate would be a coin toss printed as
   * evidence. Consumers that report unfilled fields read this to say why the
   * cell is empty, which is the difference between a gap the operator can
   * act on and one that looks like nothing was tried.
   */
  conflict?: string[];
  /**
   * Why `conflict` is set, in a sentence a consumer can print. Absent means
   * `reconcileFieldValues` set it, and the reason is its own: two documents
   * answered this key differently.
   *
   * It exists because a second producer of conflicts arrived --
   * `verify.ts`'s crop-level re-read, where a key was found ONCE and read
   * twice -- and the standing wording ("found more than once and the answers
   * disagree") is a plainly false statement about that case. A false
   * explanation beside a blank cell is the same failure class as a false
   * citation beside a filled one: the operator acts on it and cannot tell it
   * apart from a true one without rerunning the pipeline.
   */
  conflictReason?: string;
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
    // These documents abbreviate freely and inconsistently -- the same
    // organisation appears in full on one page and as initials on the next --
    // so a model told nothing about it treats the two as different answers
    // and picks whichever it saw first. Saying it plainly costs a handful of
    // tokens. The last sentence is the load-bearing one: "return the fullest
    // form" on its own invites the model to expand an abbreviation out of its
    // own knowledge, which would put an unsourced name in a cell that carries
    // a citation.
    "These documents abbreviate freely. A short form and its expansion denote",
    "the same thing: an organisation may be written in full, shortened, or as",
    "initials on different pages, and a document type may be named in full on",
    "one page and by its initials on another. When a field's answer appears in",
    "more than one form, return the FULLEST form THE DOCUMENT ITSELF PRINTS,",
    "and cite the lines that print it. Never expand an abbreviation the text",
    "does not expand, and never shorten a name the text gives in full.",
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
 * Collapses repeated answers for one fieldKey into the single entry that
 * ships, and turns a genuine disagreement into a blank that says so.
 *
 * WHY THIS EXISTS. Nothing upstream promises one entry per fieldKey. A model
 * reply may cite the same field twice, one run's grouped extraction calls can
 * each answer the same key, and a dokumen tambahan round adds documents that
 * answer keys an earlier round already answered. Every consumer downstream
 * then builds `new Map(values.map(v => [v.fieldKey, v]))` -- the docx header
 * and the xlsx exporter both do -- and a Map keeps the LAST entry. So the
 * duplicates survived all the way to the deliverable and were then resolved
 * by array order, silently, with the losing spelling never mentioned
 * anywhere. That is the wrong-and-quiet shape exactly: a workbook that opens
 * fine, carrying one of two answers, with no record that there were two.
 *
 * WHAT IT DOES INSTEAD. Entries for one key are compared with `sameEntity`,
 * so `PT Bank Contoh Nusantara Tbk`, `Bank Contoh Nusantara` and `BCN` count
 * as one answer rather than three conflicting ones. When they agree,
 * `canonicalEntity` picks the fullest spelling and the entry that actually
 * carries that spelling supplies the citation -- so the value and the lines
 * cited for it are always the same text. When they do NOT agree, the key
 * ships blank with `conflict` listing every spelling, because choosing
 * between two different customers is the operator's call and not this
 * function's.
 *
 * THIS RUNS OVER EVERY fieldKey, WHATEVER IT HOLDS, and that is what makes
 * `sameEntity`'s containment rule this function's problem rather than
 * `abbrev.ts`'s alone. Nothing here knows whether a key holds a customer
 * name, a quote number or a price; the template's backed keys are name-like
 * today and its unbacked rows -- `MPLS VPN IP Address`, `MPLS VPN IP
 * Bandwidth`, the charge rows -- are not, and adding one of those is a
 * one-line template edit that would never think to revisit this file. So the
 * restriction is enforced where the values are, in `abbrev.ts`'s
 * `isNameLike`: containment merges only spellings whose identity is carried
 * by words. A numeric key that arrives here later gets a conflict the
 * operator settles, which is the outcome this function exists to produce,
 * rather than a silent merge of two different numbers.
 *
 * Order is preserved: keys come back in the order they were first seen, and
 * ties inside a key keep the earlier entry, so an earlier round outranks a
 * later one when nothing else separates them.
 */
export function reconcileFieldValues(values: FieldValue[]): FieldValue[] {
  const groups = new Map<string, FieldValue[]>();
  for (const value of values) {
    const group = groups.get(value.fieldKey);
    if (group) group.push(value);
    else groups.set(value.fieldKey, [value]);
  }

  const reconciled: FieldValue[] = [];
  for (const [fieldKey, group] of groups) {
    const answered = group.filter((v) => v.value.trim() !== "");
    // Nothing was actually answered: keep one blank entry so the key's place
    // in the list is unchanged and the outstanding report still names it.
    if (answered.length === 0) {
      reconciled.push(group[0]);
      continue;
    }

    const spellings: string[] = [];
    for (const v of answered) {
      const trimmed = v.value.trim();
      if (!spellings.includes(trimmed)) spellings.push(trimmed);
    }

    const canonical = canonicalEntity(spellings);
    // Every spelling is checked against the one that would ship, not
    // pairwise: "does the whole group agree with the answer this puts in the
    // cell" is the question the deliverable actually turns on.
    const agree = spellings.every((s) => sameEntity(s, canonical));
    if (!agree) {
      reconciled.push({ fieldKey, value: "", conflict: spellings });
      continue;
    }

    // The citation has to point at the text that prints the value being
    // shipped. Taking the first entry's citation regardless would produce a
    // note naming lines that spell the name a different way -- a citation
    // that passes every validity check and still does not support the cell.
    const carrier =
      answered.find((v) => v.value.trim() === canonical) ?? answered[0];
    // Rebuilt field by field rather than spread, so a `conflict` from an
    // earlier pass cannot ride along on a key this pass settled: running this
    // over an already-reconciled list has to leave it settled.
    reconciled.push(
      carrier.source
        ? { fieldKey, value: canonical, source: carrier.source }
        : { fieldKey, value: canonical },
    );
  }

  return reconciled;
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
