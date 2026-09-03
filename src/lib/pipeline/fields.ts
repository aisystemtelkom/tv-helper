import { z } from "zod";
import { canonicalEntity, sameEntity } from "./abbrev.ts";
import { extractJson } from "./json.ts";
import type { Ask } from "./classify.ts";
import type { OcrPage } from "./locate.ts";

/**
 * Where a value read out of the ORDER REQUEST came from, in the shape an xlsx
 * cell note can print: a file, a sheet, a column and the rows it was read
 * from. Built by `src/lib/pipeline/order-request.ts`, which is also where the
 * argument for having this at all is written down.
 *
 * IT IS NOT A CITATION AND DOES NOT GO THROUGH `citedSource`. A citation is a
 * claim a model made about a page, which is why the one below is validated
 * before it is trusted; this is a cell reference into a spreadsheet the
 * operator supplied, so there is nothing to hallucinate and nothing to check.
 * Kept as a separate field rather than folded into `source` for exactly that
 * reason -- `source` promises a `pageIndex` and a `lineRange`, and inventing
 * either for a value that came from a spreadsheet would be a false citation,
 * which this file's own `citedSource` docstring calls worse than none.
 */
export type RequestSource = {
  /** The request file's base name, as the operator passed it. */
  file: string;
  sheet: string;
  /**
   * 1-based worksheet rows, as Excel itself numbers them.
   *
   * A LIST rather than a number: a multi-service request that agrees on a
   * field is backed by every row that carries it, and naming only the first
   * would understate the evidence.
   */
  rows: number[];
  /** Column letter, as Excel itself letters it. */
  column: string;
  /** The header text the request prints over the column, verbatim. */
  header: string;
};

/**
 * A citation that survived validation: the page and lines a value was read
 * from, plus the page's identity outside this run's bundle-global numbering.
 *
 * Named rather than written inline so `CitationOutcome` below can refer to
 * exactly the same shape. `sourceName`/`pageInDoc` stay optional for the
 * reason recorded on `FieldValue.source`.
 */
export type CitedSource = {
  pageIndex: number;
  lineRange: [number, number];
  // The page's identity outside this run's bundle-global numbering: the
  // source file it actually came from, and its 0-based page number within
  // that file. Optional because `citationOutcome` below only knows the
  // position within whatever pool it was given -- the caller
  // (`extractTextFields`) is the one that can resolve these, once it remaps
  // that position back to the page's true identity. Without them, a citation
  // naming only a bundle-global page number sends a reviewer to the wrong
  // document for every page after the first source file (task-11 finding 2).
  sourceName?: string;
  pageInDoc?: number;
};

/** What the model claimed, verbatim, whether or not it checked out. */
export type CitationClaim = {
  pageIndex: number | null;
  from: number | null;
  to: number | null;
};

/**
 * WHAT BECAME OF THE CITATION the model offered for one value.
 *
 * WHY THIS EXISTS, AND WHY `source` ALONE COULD NOT SAY IT. `citedSource`
 * returned `undefined` in two entirely different situations: the model
 * offered NO citation at all, and the model offered one that FAILED
 * VALIDATION -- a page it was never shown, a reversed range, a line the page
 * does not have. Both arrived at every consumer as the same missing field, so
 * "found, uncited" and "found, and the citation was a hallucination" were the
 * same value on the wire and a validator looking at a filled cell with no
 * provenance could not tell which one they were about to sign.
 *
 * They are not the same thing and they do not call for the same action. An
 * uncited value is a value the model read and did not say where from: the
 * operator checks it against the bundle. A value whose citation named a page
 * that was never in the pool is a value the model was, on the record,
 * confabulating around -- the citation is evidence about the ANSWER, not just
 * about the reference -- and it wants a harder look, or none at all.
 *
 * ADDITIVE ON PURPOSE. `source` still means exactly what it always meant and
 * is still set only for a citation that checked out, so every existing
 * consumer (the xlsx cell note, the docx header, `verify.ts`) is unchanged.
 * This is the extra channel `/api/extract` reports to the operator UI on.
 */
export type CitationOutcome =
  | { status: "cited"; source: CitedSource }
  /** The model returned the value with no page or line numbers at all. */
  | { status: "uncited" }
  /**
   * The model named a page and lines, and they did not check out. `reason` is
   * written to be printed beside the value; `claimed` keeps what was said, so
   * a reviewer can see the shape of the mistake rather than being told only
   * that there was one.
   */
  | { status: "invalid"; reason: string; claimed: CitationClaim };

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
  /**
   * The validated citation, and ONLY a validated one. Set exactly when
   * `citation.status === "cited"`, and left absent both when the model gave
   * no citation and when it gave one that failed validation -- which is the
   * ambiguity `citation` below exists to resolve. Every consumer that prints
   * provenance reads this; nothing but `/api/extract` needs to know which of
   * the two absences it is looking at.
   */
  source?: CitedSource;
  /**
   * EVERY validated citation behind this value, in the order the value prints
   * them. Set only for a LIST-VALUED key (see `reconcileFieldValues`' `list`
   * argument), where the cell holds several answers joined by newlines and one
   * `source` would name the lines behind only the first of them.
   *
   * `source` stays set to the first of these, so every existing consumer keeps
   * working and keeps pointing at real lines; a consumer that prints
   * provenance should prefer this when it is present, or it will show a
   * two-contact cell as though one line range backed the whole of it --
   * provenance that is true about part of a cell and read as true about all of
   * it, which is the same failure shape as a citation that is simply wrong.
   */
  sources?: CitedSource[];
  /**
   * What became of the citation the model offered, INCLUDING the two cases
   * `source` cannot tell apart. Optional because a `FieldValue` can be built
   * by hand or by a producer that never asked a model (the order-request
   * reader, `reconcileFieldValues`' conflict entries); absent means nothing
   * is claimed either way.
   */
  citation?: CitationOutcome;
  /**
   * Set instead of `source` when the value came from the order request rather
   * than from a scanned page. The two are mutually exclusive in practice --
   * `scripts/generate.mjs` removes a key the request answered from the list it
   * asks the model for, so no key is searched for twice -- and every consumer
   * that prints provenance reads `source` first and falls back to this.
   */
  requestSource?: RequestSource;
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
    .map((v) => {
      const citation = citationOutcome(v, pages);
      // `source` is set from the outcome rather than beside it, so the two can
      // never drift: a `source` that disagreed with its own citation status
      // would be a citation nothing validated, presented as one that was.
      const value: FieldValue = { fieldKey: v.fieldKey, value: v.value, citation };
      if (citation.status === "cited") value.source = citation.source;
      return value;
    });
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
 * A LIST-VALUED KEY IS THE ONE EXCEPTION, and it is opt-in per key. See
 * `list` below: for a key whose cell legitimately holds SEVERAL answers, two
 * entries that are not the same entity are agreement, not disagreement, and
 * blanking the cell over it hides evidence the documents actually supplied.
 *
 * Order is preserved: keys come back in the order they were first seen, and
 * ties inside a key keep the earlier entry, so an earlier round outranks a
 * later one when nothing else separates them.
 *
 * @param list fieldKeys whose cell holds a LIST rather than one value.
 *
 * MEASURED, on the sample bundle, 2026-09-03: the model answers `picContacts`
 * with two contact people, `sameEntity` correctly reports that two people are
 * not one person, and the key therefore shipped BLANK as a conflict -- while
 * the human-authored sample's own cell holds both of them joined by a
 * newline, and `AO_TEMPLATE.fieldHints.picContacts` already asks for exactly
 * that ("keep every contact listed, one per line"). Nothing was wrong with
 * the extraction or with `sameEntity`; there was simply no way to say that a
 * key holds a set, so agreement-on-a-set was indistinguishable from
 * disagreement-on-a-value.
 *
 * IT IS OPT-IN, AND THE DEFAULT IS THE CONFLICT NET. Marking a key that holds
 * ONE value -- a customer, a quote number, a price -- would silently
 * concatenate two different answers into one cell instead of reporting them,
 * which is precisely the failure this function exists to prevent. The
 * negative tests (`cc` with two customer names still conflicts) are the
 * guard; whoever widens the set keeps them green.
 */
export function reconcileFieldValues(
  values: FieldValue[],
  list: ReadonlySet<string> = new Set(),
): FieldValue[] {
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
      if (list.has(fieldKey)) {
        reconciled.push(joinListValue(fieldKey, spellings, answered));
        continue;
      }
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
    //
    // Which means every field worth keeping has to be named here. `source` was
    // the only one until the order-request reader landed, and a value that
    // arrived through this function without its `requestSource` would ship a
    // cell whose note says nothing -- provenance lost silently, which is the
    // half of "wrong and quiet" that survives even when the value is right.
    const settled: FieldValue = { fieldKey, value: canonical };
    if (carrier.source) settled.source = carrier.source;
    // Carried for the same reason `source` is, and from the same entry: the
    // citation outcome describes THIS spelling's provenance, so taking it
    // from any other entry would explain a value that is not the one being
    // shipped. Dropping it instead would tell `/api/extract` "uncited" about
    // a value whose citation was in fact rejected -- re-collapsing the
    // distinction this file just drew.
    if (carrier.citation) settled.citation = carrier.citation;
    if (carrier.requestSource) settled.requestSource = carrier.requestSource;
    reconciled.push(settled);
  }

  return reconciled;
}

/**
 * The settled entry for a LIST-VALUED key: every distinct spelling joined by
 * newlines, in first-seen order, carrying every one of their citations.
 *
 * THE CELL IS ONLY AS WELL-CITED AS ITS WEAKEST PART, which is why `citation`
 * is not simply taken from the first entry. A cell holding two contacts where
 * one was cited and the other was not is not a cited cell, and reporting it as
 * one would put a `cited`/`high` badge on a value half of which has no
 * provenance at all. So an `invalid` outcome anywhere wins (it is the
 * strongest warning: the model confabulated a reference around one of these
 * answers), a missing or uncited one comes next, and `cited` is reported only
 * when every part of the value earned it.
 */
function joinListValue(
  fieldKey: string,
  spellings: string[],
  answered: FieldValue[],
): FieldValue {
  // One carrier per DISTINCT spelling, so the citations line up with the lines
  // the value actually prints rather than with however many times the model
  // happened to repeat one of them.
  const carriers = spellings.map(
    (spelling) => answered.find((v) => v.value.trim() === spelling) as FieldValue,
  );
  // Newline-joined because that is what the human-authored sample's own
  // "Contact Last Name" cell holds, byte for byte, and what the field hint
  // asks the model for ("one per line").
  const settled: FieldValue = { fieldKey, value: spellings.join("\n") };

  const sources = carriers
    .map((carrier) => carrier.source)
    .filter((source): source is CitedSource => source !== undefined);
  if (sources.length > 0) {
    settled.source = sources[0];
    settled.sources = sources;
  }

  const invalid = carriers.find((carrier) => carrier.citation?.status === "invalid");
  if (invalid?.citation) settled.citation = invalid.citation;
  else if (carriers.every((carrier) => carrier.citation?.status === "cited")) {
    settled.citation = { status: "cited", source: sources[0] };
  } else settled.citation = { status: "uncited" };

  // Provenance for the request-supplied case, taken from the first carrier
  // that has it for the same reason `source` is: it is a reference into a
  // spreadsheet cell, and there is only one field to put it in.
  const requestSource = carriers.find((carrier) => carrier.requestSource);
  if (requestSource?.requestSource) settled.requestSource = requestSource.requestSource;

  return settled;
}

/**
 * Trusts a citation only after it checks out, because it flows straight into
 * an xlsx cell note a reviewer relies on: a hallucinated page, an
 * out-of-range line, or a reversed range must not read as a real citation.
 * The value itself survives a bad citation -- dropping the whole entry over
 * one bad citation would discard a good extracted value for no reason, and
 * a false citation is worse than none, since a reviewer cannot tell it apart
 * from a real one without rerunning the pipeline.
 *
 * IT NOW SAYS WHICH WAY IT FAILED, which is the whole of the 2026-09-03
 * findings' section 4 blocker. Returning `undefined` for both "no citation
 * offered" and "citation rejected" collapsed a distinction an operator needs:
 * see `CitationOutcome`.
 */
export function citationOutcome(
  v: CitationClaim,
  pages: OcrPage[],
): CitationOutcome {
  const claimed: CitationClaim = { pageIndex: v.pageIndex, from: v.from, to: v.to };

  if (v.pageIndex === null && v.from === null && v.to === null) {
    return { status: "uncited" };
  }
  // A HALF-ANSWER IS NOT A NON-ANSWER. All three null is the model declining
  // to cite; some of them null is a citation it started and could not
  // complete, which is a reply worth flagging rather than silently rounding
  // down to "it did not say".
  if (v.pageIndex === null || v.from === null || v.to === null) {
    return {
      status: "invalid",
      reason:
        "the citation is incomplete: it names " +
        [
          v.pageIndex === null ? null : `page ${v.pageIndex}`,
          v.from === null ? null : `line ${v.from}`,
          v.to === null ? null : `line ${v.to}`,
        ]
          .filter((part) => part !== null)
          .join(" and ") +
        " and leaves the rest blank",
      claimed,
    };
  }
  // pageIndex is a position in `pages` (see this file's header comment on
  // extractFields), so an out-of-range one means the model cited a page it
  // was never offered.
  const page = pages[v.pageIndex];
  if (!page) {
    return {
      status: "invalid",
      reason:
        `cited page ${v.pageIndex}, which is not one of the ${pages.length} ` +
        "pages it was shown",
      claimed,
    };
  }
  if (v.from > v.to) {
    return {
      status: "invalid",
      reason: `cited lines ${v.from}-${v.to}, a reversed range`,
      claimed,
    };
  }
  const lineIndices = new Set(page.lines.map((l) => l.i));
  if (!lineIndices.has(v.from) || !lineIndices.has(v.to)) {
    return {
      status: "invalid",
      reason:
        `cited lines ${v.from}-${v.to}, and page ${v.pageIndex} has no line ` +
        `${lineIndices.has(v.from) ? v.to : v.from}`,
      claimed,
    };
  }

  return {
    status: "cited",
    source: { pageIndex: v.pageIndex, lineRange: [v.from, v.to] },
  };
}
