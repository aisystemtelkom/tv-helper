/**
 * KONFIG EXCEL: does the operator's order-configuration workbook agree with
 * the scans the order was raised from?
 *
 * The client's instruction, 2026-09-09: compare the uploaded excel config
 * against the documents, say where something does not match, say when a field
 * is not in the documents at all, and offer one re-search over the fields that
 * came back empty. This module is that comparison and nothing else. It decides
 * nothing, writes nothing into a workbook, and every entry it returns carries
 * `decision: "belum"` -- the operator rules on each recommendation, exactly as
 * they rule on every proposed zone.
 *
 * ## Modelled on `./locate.ts` and `./sections.ts`, deliberately
 *
 * An injected `Ask = (prompt: string) => Promise<string>`, a zod `Reply`,
 * `extractJson` from `./json.ts`, validation AFTER the parse, and NO IMAGE
 * PARAMETER anywhere. That last one is a load-bearing absence: AGENTS.md's
 * claim that the reasoning stages are "provably text-only" is checked by
 * reading the signatures in `src/lib/pipeline/`, and this stage extends the
 * claim unchanged rather than putting a hole in it.
 *
 * ## ONE CALL CARRIES EVERY FIELD, AND THAT IS A COST DECISION
 *
 * The listing is the expensive half of this prompt by an order of magnitude:
 * the 29-page sample bundle measures ~23k input tokens as numbered lines, and
 * the second client bundle is 151 pages. A call per field would re-send all of
 * it per field, which for a 35-field workbook is 35 copies of the bundle. So
 * the question names every field at once and the listing is sent once.
 *
 * `locate.ts` measured the accuracy cost of that shape and it is real -- seven
 * questions in one call came back as 382 output tokens with one question simply
 * omitted -- so the two defences that failure calls for are both here:
 * `MAX_FIELDS_PER_CALL` bounds how many questions one reply has to carry, and
 * `foldCompareReply` returns one entry PER INPUT FIELD whatever the reply
 * contained, so a field the model silently skipped arrives as a field the
 * operator is told about rather than as a missing array element.
 *
 * ## THE PAGE NUMBERING TRAP
 *
 * The prompt numbers pages BY POSITION in the listing, starting at 0, and never
 * by the page's run-global index. A pool starting at page 23 made the model
 * answer 22 -- its chosen lines matched the intended page exactly, just under
 * the wrong label, consistent with treating a non-zero first label as a 1-based
 * ordinal to convert -- and it stayed hidden because every other pool happened
 * to start at 0, where "convert to 0-based" and "echo the label back" give the
 * same answer. `buildLocatePrompt`, `extractFields` and `discoverSections` all
 * renumber for the same reason. THIS POOL IS ALWAYS AT RISK OF IT: the caller
 * hands in searchable pages only, so a run with one berkas fenced off as
 * "tanpa AI" produces a pool whose first page is not page 0. `citationFor`
 * below maps the reply's position back to `pages[position].index`.
 *
 * ## `AskFailed` IS NOT CAUGHT HERE, ON PURPOSE
 *
 * Nothing in this module catches around `ask`. A provider failure must not
 * arrive at the operator as forty fields marked "searched and not found" --
 * that is `src/lib/api/wire.ts`'s recorded failure, where a missing credential
 * came back 200 OK with every slot outstanding and sent the operator hunting
 * for documents nothing had read. A throw from `ask` propagates out of
 * `compareToDocuments` untouched and the route turns it into a 503.
 */

import { z } from "zod";

import type { WirePage } from "../api/wire.ts";
import type {
  ConfigCitation,
  ConfigEntry,
  ConfigField,
  ConfigVerdict,
} from "../config/types.ts";
import type { Ask } from "./classify.ts";
import { extractJson } from "./json.ts";

export type CompareDeps = {
  fields: readonly ConfigField[];
  /** Searchable pages only. The CALLER filters on `searchable`, never on lines.length. */
  pages: readonly WirePage[];
  ask: Ask;
  /**
   * The one re-search. Widens the question over fields that came back
   * not-found.
   *
   * IT DOES NOT FILTER, AND IT DOES NOT COUNT. The caller hands in only the
   * fields whose verdict was `tidak-ditemukan`, and the budget the client set
   * ("max sekali aja biar ga boros token") is `ConfigCheck.researched` on the
   * stored run, not a counter in here: a budget that lives in a module a route
   * re-imports per request is not a budget.
   */
  retry?: boolean;
};

/**
 * How many fields one comparison call may be asked about.
 *
 * 40 IS A BOUND WITH AN ARGUMENT BEHIND IT AND NO MEASUREMENT YET, and saying
 * so is the point of this comment. This project has one recorded scar from a
 * constant invented while writing a design ("at most 2 extra lines", AGENTS.md,
 * the measurement gate) and the way that constant survived was by being written
 * down as though it had been measured.
 *
 * What IS known: `locate.ts` measured the failure mode this constant exists to
 * bound. Asked seven questions in one call, the model answered in 382 output
 * tokens and silently omitted one of them -- not a wrong answer, an absent one
 * -- and the omission cost a second slot downstream. Omission scales with how
 * many questions one reply has to carry, so there is a number above which one
 * call stops being safe, and the only honest thing to do is pick one that keeps
 * a typical order in a single call and then check it.
 *
 * What the three real client workbooks hold, read 2026-09-09: one is 35 label
 * rows; one is 16 columns against 2 service rows, so 32 fields; one is
 * transposed with field names across columns E..AN against 2 data rows, so
 * about 72. So 40 puts two of the three in one call and chunks the third into
 * two -- which is the trade this constant is making, stated in the units it is
 * actually making it in.
 *
 * EACH EXTRA CHUNK RE-SENDS THE WHOLE PAGE LISTING. That is the entire cost of
 * lowering this number: a 151-page bundle's listing is the dominant term in
 * every call, so two chunks is roughly twice the input tokens of one. Raise or
 * lower it only against a measured reply, not against this paragraph.
 */
export const MAX_FIELDS_PER_CALL = 40;

/**
 * The three verdicts a reply may carry.
 *
 * `belum-diperiksa` is deliberately absent: it is the state before anything
 * compared this field, and a model that answered with it would be reporting
 * that it had not looked, in a reply produced by looking. Its own doc comment
 * in `../config/types.ts` says it is never rendered as a result.
 *
 * THE WIRE TOKENS ARE THE DOMAIN TOKENS, which is why this is written with
 * `satisfies` rather than as a free-standing tuple. A translation table between
 * "what the model is asked to say" and "what `ConfigVerdict` holds" is a table
 * that can disagree with itself silently, and the disagreement would land as a
 * wrong verdict on a field an operator signs off. Rename a member of
 * `ConfigVerdict` and this line stops compiling instead.
 */
const VERDICTS = [
  "cocok",
  "beda",
  "tidak-ditemukan",
] as const satisfies readonly ConfigVerdict[];

/**
 * The envelope, parsed strictly. THIS IS THE ONE PLACE THIS MODULE THROWS.
 *
 * A reply that is not `{"fields":[...]}` is not a reply about these documents:
 * it is a refusal, a truncation, a prose apology, or JSON of some other shape.
 * `extractJson` draws the same line for the same reason -- recover from
 * packaging, never from content -- and `classifyPages` and `discoverSections`
 * both throw here too.
 *
 * The alternative was considered and is worse. Folding an unreadable reply into
 * one `tidak-ditemukan` per field would hand the operator forty fields marked
 * SEARCHED AND NOT FOUND on the strength of a reply nobody could read, and
 * `tidak-ditemukan` is the verdict that drives them to go and fetch more
 * documents. That is this project's named failure class with extra steps.
 */
const Envelope = z.object({ fields: z.array(z.unknown()) });

/**
 * One answer, parsed per entry so a single bad one costs a single field.
 *
 * THE CITATION FIELDS ARE `unknown` ON PURPOSE, and this is the shape the
 * requirement "drop the citation while keeping the verdict" actually needs.
 * Typing them `z.number().int().min(0)` would make a negative line number, a
 * float, or a stringified `"3"` fail the ENTRY, and the entry carries the
 * verdict -- so a model that found the field, judged it correctly, and then
 * miscounted a line would have its verdict thrown away over the reference. A
 * false citation is worse than none; a lost verdict is worse than an uncited
 * one. So every citation rule lives in `citationFor` below, where failing it
 * costs the citation and nothing else.
 *
 * `documentValue` accepts a number because a workbook value legitimately IS one
 * -- a quote number, a bandwidth, a price -- and a model emitting it as a JSON
 * number rather than a JSON string is a packaging difference, not a different
 * answer. It is stringified, never coerced further.
 */
const Answer = z.object({
  id: z.string(),
  verdict: z.enum(VERDICTS),
  documentValue: z.union([z.string(), z.number()]).nullish(),
  page: z.unknown().optional(),
  from: z.unknown().optional(),
  to: z.unknown().optional(),
});

type Answered = z.infer<typeof Answer>;

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

/**
 * The pages, numbered by POSITION and never by index. See this file's header.
 *
 * Identical in shape to `buildLocatePrompt`'s listing, down to the separator,
 * because it is the same material read for a different question and a second
 * rendering of it would be a second thing to keep in step.
 */
function pageListing(pages: readonly WirePage[]): string {
  return pages
    .map(
      (page, position) =>
        `--- page ${position} ---\n` +
        page.lines.map((line) => `${line.i}: ${line.text}`).join("\n"),
    )
    .join("\n\n");
}

/**
 * The fields, as the question.
 *
 * EVERY OPERATOR-SUPPLIED STRING GOES THROUGH `JSON.stringify`, which is not
 * decoration. `label` and `excelValue` are read out of a spreadsheet cell the
 * client authored: they contain quotes, colons, and -- in a wrapped cell --
 * newlines. Interpolated raw, a two-line address silently becomes two lines of
 * this prompt and the second one reads as a new list item, so the model is
 * answering a question with a field name in it that nobody wrote. Quoting
 * makes every value exactly one unambiguous token.
 *
 * `group` is named `row` here rather than "group" because that is what it is to
 * whoever reads the prompt: two of the three real workbooks carry one row per
 * SERVICE, so the same twenty field names appear twice against two different
 * SIDs. Without it the model would meet `Alamat Baru` twice with nothing to
 * separate them and would answer both from whichever it found first.
 */
function fieldListing(fields: readonly ConfigField[]): string {
  return fields
    .map((field) => {
      const lines = [`- id: ${field.id}`, `  field: ${JSON.stringify(field.label)}`];
      if (field.group !== undefined && field.group !== "") {
        lines.push(`  row: ${JSON.stringify(field.group)}`);
      }
      lines.push(
        field.excelValue.trim() === ""
          ? "  the spreadsheet cell is EMPTY"
          : `  the spreadsheet says: ${JSON.stringify(field.excelValue)}`,
      );
      return lines.join("\n");
    })
    .join("\n");
}

/**
 * What a verdict means and how to cite it. Shared by both passes VERBATIM.
 *
 * Shared rather than restated per pass because these sentences define the reply
 * SHAPE, and `foldCompareReply` validates against exactly one shape. Two
 * wordings of "cite the lines you read it on" is two chances for one of them to
 * describe a reply the fold then rejects, which reaches the operator as every
 * field losing its citation at once -- with nothing anywhere reading as broken.
 */
const REPLY_RULES = [
  "VERDICTS, one per field:",
  '  "cocok"            the documents state this field and it agrees with the',
  "                     spreadsheet.",
  '  "beda"             the documents state something else. This INCLUDES an',
  "                     empty spreadsheet cell for which the documents supply a",
  '                     value: an empty cell is never "cocok" and never',
  '                     "tidak-ditemukan" while the documents say what belongs',
  "                     in it.",
  '  "tidak-ditemukan"  you read every page below and this field is not stated',
  "                     in them.",
  "",
  'For "beda", give `documentValue`: the document\'s own wording, transcribed',
  "from the lines you cite. Never a paraphrase, and never a value you worked out",
  "from somewhere else. A mismatch with nothing to put in the cell is not",
  "something a person can act on and will be discarded.",
  "",
  "Cite the lines you read the answer on, for an agreement as well as a",
  "mismatch, so a person can check it without opening the scan. `page` is the",
  "page's POSITION in the listing below -- the first page shown is page 0 --",
  "and `from` and `to` are the line numbers printed at the start of each line,",
  "inclusive. Cite only lines that actually carry the value. If you cannot,",
  "leave all three out: a citation of lines that do not say it is worse than no",
  "citation at all.",
  "",
  "Answer for every field, using its `id` exactly as written above. Two fields",
  "may carry the same name for two different rows, so the id is the only thing",
  "that tells them apart.",
  "",
  "Reply with JSON only:",
  '{"fields":[{"id":"f1","verdict":"cocok","page":0,"from":7,"to":8},',
  '{"id":"f2","verdict":"beda","documentValue":"BANK CONTOH NUSANTARA",',
  '"page":1,"from":3,"to":4},',
  '{"id":"f3","verdict":"tidak-ditemukan"}]}',
].join("\n");

/**
 * THE QUESTION LEADS AND THE LISTING FOLLOWS, in both passes.
 *
 * Measured, in `locate.ts`: three arrangements that put the listing first were
 * each sampled three times, all three earned Gemini's ~90% prefix discount on
 * 122k tokens a run, and all three turned `KB / Nomor` from an intermittent
 * failure into a certain one. The saving is real and it was reverted. Do not
 * re-derive it here; see "## The prefix-cache experiment" in that file's header.
 *
 * ## THE RETRY PASS ASKS A DIFFERENT QUESTION, WHICH IS THE WHOLE POINT OF IT
 *
 * The client capped the re-search at one attempt to stop it burning tokens, so
 * re-sending the identical prompt would spend the whole budget on a re-roll of
 * the same question -- and the answers this pipeline gets are not stable, so a
 * re-roll would sometimes appear to work, which is worse than never working.
 * The second pass keeps the reply shape byte for byte and changes only what it
 * asks the model to consider: abbreviations, the two languages these documents
 * mix, a value OCR split across a line break, and a value printed in another
 * format. Those four are the ways a value is in the bundle and was not found,
 * as opposed to not being there.
 */
export function buildComparePrompt(
  fields: readonly ConfigField[],
  pages: readonly WirePage[],
  retry: boolean,
): string {
  const opening = retry
    ? [
        "A first pass over these same documents already looked for each field",
        "below and reported that none of them is stated there. Look again, and",
        "look differently: the first pass asked whether the value appears, and",
        "this one asks whether it appears in ANY form the document might print",
        "it in.",
        "",
        `There are ${fields.length} field(s). For each one, consider:`,
        "",
        "  - These documents abbreviate freely and inconsistently. An",
        "    organisation may be written in full on one page and as initials on",
        "    the next.",
        "  - The spreadsheet's name for a field and the document's name for it",
        "    are often different words for one thing, sometimes in different",
        "    languages.",
        "  - A value may be SPLIT ACROSS TWO LINES. The text below is OCR, which",
        "    breaks a wrapped line in two, so a citation covering both lines is",
        "    the right answer rather than a miss.",
        "  - A value may be printed in another format: a date as",
        "    `20 Agustus 2026` rather than `2026-08-20`, a number with or",
        "    without thousands separators, an address with or without its",
        "    locality.",
        "",
        "Report what the document ACTUALLY PRINTS, transcribed from the lines you",
        'cite. Do not widen "found" to mean "something similar is nearby". If a',
        'field is genuinely not in these pages, answer "tidak-ditemukan" again:',
        "that is a useful answer, and a value you assembled rather than read is",
        "not.",
      ]
    : [
        "Check an order-configuration spreadsheet against the scanned documents",
        "the order was raised from.",
        "",
        `There are ${fields.length} field(s) below, each with what the`,
        "spreadsheet holds for it today. For each one, say whether these",
        "documents agree.",
      ];

  return [
    ...opening,
    "",
    "FIELDS",
    fieldListing(fields),
    "",
    REPLY_RULES,
    "",
    pageListing(pages),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

/**
 * Why an entry is `tidak-ditemukan`, in a sentence a caller can print.
 *
 * ENGLISH AND DEPLOYER-FACING, like every other string in
 * `src/lib/pipeline/`. `ConfigEntry.reason`'s own doc comment says "in the
 * operator's language", and that is a description of where the sentence ENDS
 * UP rather than where it is written: `src/lib/ui/config.ts` composes what the
 * operator reads, in Bahasa, out of the verdict and this fact. A Bahasa string
 * in a pipeline module would be the only one in the directory, and AGENTS.md's
 * rule that code and comments are English is what keeps that directory
 * readable by whoever is debugging a model reply.
 *
 * THEY ARE FOUR DIFFERENT FACTS UNDER ONE VERDICT, and keeping them apart is
 * the reason this list exists rather than one generic sentence. `ConfigVerdict`
 * has no member for "nothing was read", so `tidak-ditemukan` -- which is fixed
 * to mean SEARCHED AND NOT FOUND everywhere in this product -- is the only
 * verdict available for a field the model skipped, a field whose answer could
 * not be read, and a field nothing was even asked about. The verdict cannot
 * tell them apart. The reason can, and the operator's next move differs: hunt
 * for another document, or look at why the reply was unusable.
 */
const SEARCHED_AND_ABSENT =
  "every searchable page was read and this field is not stated in them";
const MODEL_SILENT =
  "the model answered for the other fields and never mentioned this one, so " +
  "nothing was reported about it";
const NOTHING_SEARCHABLE =
  "no searchable page was offered to this comparison, so nothing was read; " +
  "every berkas of this order may be fenced off from the model";
const BEDA_WITHOUT_VALUE =
  "the model reported that the documents say something else and gave no value " +
  "from them, so there is nothing to recommend";
const COCOK_ON_EMPTY =
  "the model reported agreement, but the spreadsheet cell is empty and an " +
  "empty cell has nothing for the documents to agree with";

/** A `tidak-ditemukan` entry, which is the only entry that carries a reason. */
function notFound(field: ConfigField, reason: string): ConfigEntry {
  return { field, verdict: "tidak-ditemukan", reason, decision: "belum" };
}

/** A 0-based index the model may legitimately have meant. */
function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * The citation, or nothing. EVERY FAILURE HERE COSTS THE CITATION AND NOTHING
 * ELSE.
 *
 * This is `citationOutcome` in `./fields.ts` wearing the shape `ConfigEntry`
 * can hold, and it enforces the same rules for the same recorded reason: a
 * hallucinated page, a reversed range or an out-of-range line must not read as
 * a real citation, because a reviewer cannot tell a false one from a true one
 * without re-running the pipeline. The value survives the bad citation, since
 * dropping a verdict the model got right over a reference it got wrong helps
 * nobody.
 *
 * WHAT IS LOST RELATIVE TO `citationOutcome`, said out loud: that function
 * distinguishes "no citation offered" from "citation rejected", and this one
 * cannot, because `ConfigEntry.reason` is reserved for `tidak-ditemukan` by its
 * own doc comment and there is no second channel on the type. The type
 * anticipates exactly this -- `citation` is documented as "Absent when the
 * model cited a range that failed validation" -- so the absence is the
 * contract rather than an oversight. If the distinction is ever wanted on
 * screen, it needs a field on `ConfigEntry`, not a reason smuggled onto the
 * wrong verdict.
 *
 * `page` IS A POSITION IN `pages`, NOT A RUN-GLOBAL INDEX. See this file's
 * header: the pool is searchable pages only, so the two differ the moment one
 * berkas is fenced off, and `ConfigCitation.pageIndex` is a position in
 * `BrowserRun.pages`. The mapping happens on the last line and nowhere else.
 */
function citationFor(
  answer: Answered,
  pages: readonly WirePage[],
): ConfigCitation | undefined {
  const given = [answer.page, answer.from, answer.to].filter(
    (value) => value !== undefined && value !== null,
  );
  // No citation offered at all: not an error, and not something to report.
  if (given.length === 0) return undefined;
  // A HALF-ANSWER IS NOT A NON-ANSWER, but it is still not a citation. All
  // three absent is the model declining to cite; some of them absent is a
  // citation it started and could not finish, and there is no honest range to
  // build out of the half it gave.
  if (given.length < 3) return undefined;
  // Covers a negative index, a float, and a stringified number in one rule.
  // The schema deliberately does not: see `Answer`.
  if (!isIndex(answer.page) || !isIndex(answer.from) || !isIndex(answer.to)) {
    return undefined;
  }
  const page = pages[answer.page];
  // A page the pool does not have is a page the model was never shown, which
  // makes the whole answer suspect -- but only the reference is dropped here.
  if (!page) return undefined;
  if (answer.from > answer.to) return undefined;

  // BY LINE NUMBER, never by array position. `assertLinesWellFormed` makes
  // `lines[k].i === k` true for every page that reaches a route, so the two
  // agree there -- but this module takes any caller's pages, and reading a
  // range positionally on a page numbered some other way quotes text that is
  // not the text the model was looking at.
  const byNumber = new Map(page.lines.map((line) => [line.i, line]));
  const text: string[] = [];
  for (let i = answer.from; i <= answer.to; i += 1) {
    const line = byNumber.get(i);
    if (!line) return undefined;
    text.push(line.text);
  }

  // THE TEXT COMES FROM THE PAGE, NEVER FROM THE MODEL. There is no field on
  // `Answer` for it and there must not be: a transcript echoed back by the
  // thing being checked is a transcript that can quietly differ from the lines
  // it names, and the operator reads this text INSTEAD of navigating to the
  // page. That is the same rule `resolveAnswer` applies to a zone's text.
  return { pageIndex: page.index, from: answer.from, to: answer.to, text: text.join("\n") };
}

/** Trimmed and whitespace-collapsed; case is left alone. See `sameText`. */
function fold(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Do these two spellings put the same thing in the cell?
 *
 * DELIBERATELY NARROW: whitespace and nothing else. This is not
 * `sameEntity` from `./abbrev.ts` and must not become it. The only judgement
 * it makes is that a value which differs from the cell by a line break or a
 * double space is not a change worth putting a decision in front of somebody
 * for. Case is significant, because a cell an operator will copy into EPIC is
 * copied verbatim, and so is punctuation, because `Rp 5.000.000` and
 * `Rp 5.000.000.000` differ by a character that means a thousand times.
 */
function sameText(a: string, b: string): boolean {
  return fold(a) === fold(b);
}

/**
 * One field's answer, checked. Never throws: a content failure costs this field
 * and no other.
 */
function resolveEntry(
  field: ConfigField,
  pages: readonly WirePage[],
  answer: Answered | undefined,
  unreadable: string | undefined,
): ConfigEntry {
  if (!answer) return notFound(field, unreadable ?? MODEL_SILENT);

  // A CITATION ON "NOT FOUND" IS A CONTRADICTION, so it is dropped rather than
  // stored. There is nothing to have read the value on if the value is not
  // there, and a `tidak-ditemukan` carrying a page reference is the shape most
  // likely to be the model reaching for somewhere it half-recognised.
  if (answer.verdict === "tidak-ditemukan") {
    return notFound(field, SEARCHED_AND_ABSENT);
  }

  const citation = citationFor(answer, pages);
  const documentValue =
    answer.documentValue === undefined || answer.documentValue === null
      ? ""
      : String(answer.documentValue).trim();

  if (answer.verdict === "cocok") {
    // AN EMPTY CELL CANNOT AGREE WITH ANYTHING, and letting it say so is the
    // exact wrong-and-quiet failure this checkpoint exists to catch: a cell
    // EPIC expects filled, reported as checked and fine, shipped blank in a
    // workbook that opens cleanly. Reporting it as not-found turns a silent
    // pass into a decision owed, and the operator can still keep the blank by
    // rejecting it.
    if (field.excelValue.trim() === "") return notFound(field, COCOK_ON_EMPTY);
    const entry: ConfigEntry = { field, verdict: "cocok", decision: "belum" };
    if (citation) entry.citation = citation;
    return entry;
  }

  // A MISMATCH WITH NOTHING TO RECOMMEND IS NOT ACTIONABLE. `beda` drives a
  // per-field recommendation the operator accepts, rejects or overtypes, and
  // `effectiveValue` writes `documentValue` into the cell on "Terima" -- so an
  // accepted recommendation with no value would blank a filled cell, which is
  // worse than the mismatch it was reporting.
  if (documentValue === "") return notFound(field, BEDA_WITHOUT_VALUE);

  // THE MODEL CONTRADICTING ITSELF IS READ AS AGREEMENT, not as a mismatch.
  // `beda` whose recommendation is what the cell already says would mark the
  // field amber, spend one of the operator's decisions, and produce a no-op
  // edit -- and `--mark` means a decision is owed here and nothing else. The
  // citation is kept: it is still where the value was read.
  if (sameText(documentValue, field.excelValue)) {
    const entry: ConfigEntry = { field, verdict: "cocok", decision: "belum" };
    if (citation) entry.citation = citation;
    return entry;
  }

  const entry: ConfigEntry = {
    field,
    verdict: "beda",
    documentValue,
    decision: "belum",
  };
  if (citation) entry.citation = citation;
  return entry;
}

/** The id an entry claims, when it claims one readably. */
function idOf(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const id = (raw as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/**
 * ONE ENTRY PER INPUT FIELD, IN INPUT ORDER, ALWAYS.
 *
 * That totality is the contract every caller rests on, and it is the same one
 * `locateSlots` keeps for the same reason: a field the reply never mentioned
 * has to arrive as a field with a reason, not as a missing array element. A
 * silently dropped field is a field the operator is never told about, in the
 * one screen they use to decide whether the workbook is ready to go back to
 * EPIC.
 *
 * Four ways a reply can be wrong, each handled per entry:
 *
 *  - AN ANSWER FOR A FIELD NOBODY ASKED ABOUT is ignored. `fields.ts` and
 *    `locateSlots` both do the same: a hallucinated id names a field that this
 *    comparison was never given.
 *  - A REQUESTED FIELD THE REPLY NEVER MENTIONS becomes `tidak-ditemukan` with
 *    a reason saying so, distinct from the reason a model-reported miss gets.
 *  - A DUPLICATE ID keeps the first entry. Deterministic beats clever: picking
 *    by confidence or by verdict invites the model's own output to arbitrate a
 *    bug in the model's own output.
 *  - AN ENTRY THE SCHEMA CANNOT READ costs its own field only, and the field
 *    is told which way the answer was unreadable rather than being reported as
 *    unmentioned. Those are different facts and only one of them is about the
 *    documents.
 *
 * It throws for exactly one thing: a reply that is not `{"fields":[...]}`. See
 * `Envelope`.
 */
export function foldCompareReply(
  fields: readonly ConfigField[],
  pages: readonly WirePage[],
  reply: unknown,
): ConfigEntry[] {
  const envelope = Envelope.parse(reply);

  const answers = new Map<string, Answered>();
  const unreadable = new Map<string, string>();
  for (const raw of envelope.fields) {
    const parsed = Answer.safeParse(raw);
    if (parsed.success) {
      const id = parsed.data.id;
      if (answers.has(id) || unreadable.has(id)) continue;
      answers.set(id, parsed.data);
      continue;
    }
    const id = idOf(raw);
    if (id === null) continue;
    if (answers.has(id) || unreadable.has(id)) continue;
    unreadable.set(
      id,
      "the model answered for this field and the answer could not be read: " +
        parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(entry)"}: ${issue.message}`)
          .join("; "),
    );
  }

  return fields.map((field) =>
    resolveEntry(field, pages, answers.get(field.id), unreadable.get(field.id)),
  );
}

/**
 * Every field of the workbook, judged against the scans, in one call where it
 * fits.
 *
 * CHUNKED ONLY WHEN IT HAS TO BE, and each extra chunk RE-SENDS THE WHOLE PAGE
 * LISTING -- which for a 151-page bundle is the entire cost of the call. That
 * is why `MAX_FIELDS_PER_CALL` is not smaller, and why the recursion below
 * slices the FIELDS and never the pages: a field compared against half the
 * bundle would report "searched and not found" about pages nothing read, which
 * is the one thing `tidak-ditemukan` must never mean.
 *
 * NO MODEL CALL FOR NOTHING, twice over. An empty field list buys nothing, and
 * an empty page list buys a sentence rather than a prompt: asking a model to
 * find values in a listing with no pages in it invites exactly the answer that
 * is most expensive here, a confident value with no source. The fields come
 * back saying nothing was read, which is true, and the reason names the likely
 * cause so the operator is not sent hunting for documents they already gave.
 */
export async function compareToDocuments(
  deps: CompareDeps,
): Promise<ConfigEntry[]> {
  const { fields, pages, ask, retry = false } = deps;

  if (fields.length === 0) return [];
  if (pages.length === 0) {
    return fields.map((field) => notFound(field, NOTHING_SEARCHABLE));
  }

  if (fields.length > MAX_FIELDS_PER_CALL) {
    const out: ConfigEntry[] = [];
    for (let at = 0; at < fields.length; at += MAX_FIELDS_PER_CALL) {
      // Spread so `retry` (and anything added to `CompareDeps` later) reaches
      // every chunk. A chunk asked the first-pass question while the operator
      // had spent their one re-search would look like a re-search and buy them
      // the first pass again.
      out.push(
        ...(await compareToDocuments({
          ...deps,
          fields: fields.slice(at, at + MAX_FIELDS_PER_CALL),
        })),
      );
    }
    return out;
  }

  const reply = extractJson(await ask(buildComparePrompt(fields, pages, retry)));
  return foldCompareReply(fields, pages, reply);
}
