/**
 * CHECKPOINT 3: does the EPIC system's own screen show what the workbook says?
 *
 * ## THE YARDSTICK IS THE WORKBOOK HERE, NOT THE SCANS
 *
 * This is not `./config-compare.ts` with different nouns, and reading it that
 * way is the mistake a later reader will make. The two stages run one after the
 * other, both answer once per field, and both spell their verdicts `cocok`,
 * `beda` and `tidak-ditemukan`. WHICH SIDE IS BEING JUDGED HAS SWAPPED. At
 * Checkpoint 2 the scanned documents are the evidence and the workbook is the
 * claim, so `beda` means the sheet is wrong and the recommendation is an edit
 * to a cell. Here the workbook is the evidence and the EPIC screen is the
 * claim, so `beda` means the SCREEN is wrong and the recommendation is
 * something a person retypes into EPIC. Nothing this module returns is ever
 * written into a workbook: an `EpicEntry` carries no `valueRef` and cannot
 * reach `patchWorkbook`.
 *
 * `types.ts` says the same thing in the domain's own words; this is the same
 * warning at the one place a change could quietly invert it.
 *
 * ## THE FOURTH VERDICT, WHICH THE MODEL WILL NEVER VOLUNTEER
 *
 * The client asked for it by name: *"Dikasihtau juga kalo ada yang gak ketemu
 * di excel"*. `tidak-ada-di-excel` is a value VISIBLE IN EPIC that the workbook
 * has no field for, and it is the only entry with no `fieldId`, because there
 * is no field to point at -- which is the whole content of the finding. A model
 * handed a list of fields and asked to rule on each one answers about those
 * fields and stops, so the prompt asks for the leftovers as a separate list, in
 * its own sentence, or the finding does not exist.
 *
 * ## THE MODEL JUDGES; THIS MODULE CHECKS THE ADDRESSING
 *
 * `locate.ts`'s division of labour, one product layer up. There the model is
 * never asked for a pixel coordinate: it reads numbered lines and answers with
 * a line range, and the rectangle is derived from the lines' own boxes. Here it
 * is never asked to invent a capture or a line number: it reads numbered lines
 * off the captures and answers with a capture position and a line range, and
 * every one of those is checked against the capture that really exists before
 * it is trusted. A citation naming a capture nobody supplied, a reversed range,
 * or a line the capture does not have is DROPPED WHILE THE VERDICT SURVIVES --
 * `fields.ts`' rule exactly, for its reason: a false citation is worse than
 * none, because a reviewer cannot tell it from a real one without re-running
 * the pipeline, while the verdict beside it may be perfectly good.
 *
 * WHAT IS NOT RE-ADJUDICATED HERE IS THE COMPARISON ITSELF. If the model says
 * `cocok` and hands back a value spelled differently from the cell, this module
 * keeps the verdict. Re-deciding it would mean writing a string-equality rule
 * over `Rp 5.000.000` against `5000000` and `20 Agustus 2026` against a date
 * serial's rendering, which is the semantic step the model is here to do; a
 * comparison built out of `===` and a normaliser would be confidently wrong in
 * exactly the places a person would not check. The check this module owns is
 * provenance, and provenance is checkable.
 *
 * ## CAPTURES ARE ADDRESSED BY POSITION IN THE PROMPT AND BY ID IN THE ANSWER
 *
 * The prompt numbers captures 0, 1, 2 by their position in the listing, for the
 * reason `buildLocatePrompt` and `sections.ts` both renumber locally: a listing
 * whose first label is not 0 has been measured to make the model answer one
 * below the item it clearly meant. `foldEpicReply` maps that position back to
 * `EpicCapture.id`, and `EpicCitation.captureId` is an id rather than an index
 * because captures are removed ONE AT A TIME -- an index stored in an entry
 * would go on resolving after the capture above it was deleted, and point at
 * the wrong screen with nothing throwing.
 *
 * ## A SCREENSHOT REACHES THIS STAGE AS TEXT, AND ONLY AS TEXT
 *
 * `EpicCapture` is an image: it has a width, a height and bytes in the blob
 * store. This module never receives any of that. It takes `capture.lines`, the
 * recogniser's output, and its `Ask` is `(prompt: string) => Promise<string>`
 * with no image parameter anywhere -- so AGENTS.md's "only the OCR stage sends
 * images" survives a checkpoint whose whole input is screenshots, and survives
 * it by construction rather than by care. Do not add an image parameter here to
 * "read the screen properly"; send the capture to `/api/ocr` like every other
 * page and let this stage read what came back.
 *
 * ## THE STRINGS HERE ARE DEPLOYER-FACING ENGLISH
 *
 * Every `reason` this module writes is English, like every other string under
 * `src/lib/pipeline/`. The operator UI is Bahasa Indonesia, so a panel that
 * prints one of these raw puts English in a Bahasa screen: render the sentence
 * off the VERDICT, and keep `reason` for the case a reader needs to know which
 * way a reply went wrong.
 */

import { z } from "zod";

import type {
  ConfigField,
  EpicCapture,
  EpicCitation,
  EpicEntry,
} from "../config/types.ts";
import type { Ask } from "./classify.ts";
import { extractJson } from "./json.ts";

export type EpicCompareDeps = {
  fields: readonly ConfigField[];
  captures: readonly EpicCapture[];
  ask: Ask;
};

/**
 * How many `tidak-ada-di-excel` findings one reply may name.
 *
 * A cap in the SCHEMA, so an over-long list fails loudly rather than being
 * truncated: a reply carrying eighty leftovers has transcribed the screen
 * instead of answering the question, and quietly keeping the first forty of
 * those would hand an operator forty decisions drawn from a misunderstanding.
 * Forty is generous against the real material -- one EPIC screen shows on the
 * order of a dozen labelled values, and the workbook is supposed to cover most
 * of them.
 */
export const MAX_EXTRA = 40;

/** Said out loud rather than left as an empty list. See `unread`. */
const NO_CAPTURES =
  "no EPIC screen capture was supplied, so nothing was read and no field " +
  "could be checked against EPIC at all";

/**
 * The three numbers a citation is made of, shared by both halves of the reply.
 *
 * Spread into both schemas rather than written twice, so the answer half and
 * the leftovers half cannot come to disagree about what a citation looks like.
 * All three are optional AND nullable because a model declining to cite writes
 * either shape, and neither is a malformed reply; `citationFor` is where the
 * combinations are ruled on.
 */
const CITE = {
  capture: z.number().int().min(0).nullable().optional(),
  from: z.number().int().min(0).nullable().optional(),
  to: z.number().int().min(0).nullable().optional(),
};

const Reply = z.object({
  fields: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(["cocok", "beda", "tidak-ditemukan"]),
      epicValue: z.string().nullable().optional(),
      ...CITE,
    }),
  ),
  /**
   * OPTIONAL, and an absent list is not an empty one being hidden: a model
   * that found no leftovers may simply omit the key, and refusing that reply
   * would throw away every field answer beside it over a missing bracket.
   */
  extra: z
    .array(
      z.object({
        label: z.string(),
        epicValue: z.string().nullable().optional(),
        ...CITE,
      }),
    )
    .max(MAX_EXTRA)
    .optional(),
});

type Answer = z.infer<typeof Reply>["fields"][number];
type Leftover = NonNullable<z.infer<typeof Reply>["extra"]>[number];
type CiteClaim = { capture?: number | null; from?: number | null; to?: number | null };

/**
 * Case-folded, whitespace-collapsed, and stripped of the punctuation a form
 * label wears: `"Nama Pelanggan :"` and `"nama pelanggan"` are one name.
 *
 * MORE AGGRESSIVE THAN `sections.ts`' `fold`, DELIBERATELY, BECAUSE THE ERROR
 * POINTS THE OTHER WAY. There, folding guards a substring rule that is the only
 * thing standing between the model and a fabricated heading, so every tolerance
 * added is a class of invention it stops catching. Here the comparison decides
 * whether a leftover DUPLICATES a field the workbook already has, and a false
 * match costs one redundant finding while a missed match costs the operator a
 * second row for a field they are already deciding on, two rows apart, saying
 * different things about the same name. Erring toward "these are the same
 * label" is the safe direction of this particular check and only this one.
 */
function foldLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s:.,;-]+/, "")
    .replace(/[\s:.,;-]+$/, "")
    .trim();
}

/**
 * One claimed citation, checked against the captures that really exist.
 *
 * Three outcomes, and the difference between the second and the third is the
 * distinction `CitationOutcome` in `fields.ts` exists to preserve: `{}` is the
 * model declining to cite, which is a normal reply about a value it could not
 * pin to a line, while `{ reason }` is a citation it OFFERED and this module
 * refused. Collapsing those two would tell an operator "no citation" in both
 * cases and hide the one that says something about the reply's quality.
 */
function citationFor(
  claim: CiteClaim,
  captures: readonly EpicCapture[],
): { citation?: EpicCitation; reason?: string } {
  const { capture, from, to } = claim;

  if (
    (capture === undefined || capture === null) &&
    (from === undefined || from === null) &&
    (to === undefined || to === null)
  ) {
    return {};
  }
  // A HALF-ANSWER IS NOT A NON-ANSWER. All three missing is a decision not to
  // cite; some of them missing is a citation the model began and could not
  // finish, which is worth recording rather than rounding down to silence.
  if (
    capture === undefined ||
    capture === null ||
    from === undefined ||
    from === null ||
    to === undefined ||
    to === null
  ) {
    return {
      reason:
        "the citation is incomplete: it names " +
        [
          capture === undefined || capture === null ? null : `capture ${capture}`,
          from === undefined || from === null ? null : `line ${from}`,
          to === undefined || to === null ? null : `line ${to}`,
        ]
          .filter((part) => part !== null)
          .join(" and ") +
        " and leaves the rest blank",
    };
  }

  // BY POSITION, because that is how the prompt numbered them. The id below is
  // the only thing that leaves this function.
  const found = captures[capture];
  if (!found) {
    return {
      reason:
        `cited capture ${capture}, which is not one of the ${captures.length} ` +
        "screen captures it was shown",
    };
  }
  if (from > to) {
    return { reason: `cited lines ${from}-${to} of capture ${capture}, a reversed range` };
  }

  // BY LINE NUMBER, never by array position. A caller's `lines` is a plain
  // array and nothing here guarantees `lines[k].i === k`; reading a range
  // positionally off a capture numbered some other way quotes text that is not
  // the text the citation points at, which is a citation that passes
  // validation and lies.
  const byNumber = new Map(found.lines.map((line) => [line.i, line]));
  const cited: string[] = [];
  for (let i = from; i <= to; i += 1) {
    const line = byNumber.get(i);
    if (!line) {
      return {
        reason:
          `cited lines ${from}-${to} of capture ${capture}, which has no line ${i}`,
      };
    }
    cited.push(line.text);
  }

  return {
    citation: {
      captureId: found.id,
      from,
      to,
      // THE CAPTURE'S OWN WORDS, never the model's. `text` is what an operator
      // reads instead of navigating to the screenshot, so quoting the reply
      // back at them would show them the answer twice and the evidence never.
      text: cited.join("\n"),
    },
  };
}

/**
 * Every field, unchecked, with one sentence saying why.
 *
 * NOT AN EMPTY LIST, which is what a caller would otherwise hand the panel: an
 * order with no entries reads as "Checkpoint 3 has not run yet", and an order
 * whose entries all say `tidak-ditemukan` with no captures reads as what it is.
 * The distinction is the one AGENTS.md draws between `OUTSTANDING` and
 * `MANUAL`, and between `tidak ditemukan` and `belum digambar`: "we looked and
 * found nothing" and "nothing was ever looked at" are different facts and only
 * one of them is a reason to go and fetch something.
 */
function unread(fields: readonly ConfigField[], reason: string): EpicEntry[] {
  return fields.map((field) => ({
    fieldId: field.id,
    label: field.label,
    excelValue: field.excelValue,
    verdict: "tidak-ditemukan" as const,
    reason,
    decision: "belum" as const,
  }));
}

/**
 * THE QUESTION LEADS AND THE LISTING FOLLOWS.
 *
 * The ordering `locate.ts` paid for three times over: every arrangement that
 * put the pages before the question earned Gemini's ~90% prefix discount and
 * turned an intermittent extent failure into a certain one. Read
 * "## The prefix-cache experiment" in that file's header before moving these
 * two blocks to save tokens here.
 *
 * The capture's NAME is deliberately not in the listing. It is a filename the
 * operator's browser chose, it is often the customer's name, and the one thing
 * it could do to a reply is offer a plausible value that is not on the screen
 * at all.
 */
export function buildEpicPrompt(
  fields: readonly ConfigField[],
  captures: readonly EpicCapture[],
): string {
  const listing = captures
    .map((capture, position) => {
      if (capture.lines.length === 0) {
        // SAID OUT LOUD rather than emitted as a bare header with nothing
        // under it. A capture the recogniser read no text on is a fact about
        // the screenshot, and a silent gap in the listing reads as a capture
        // that was withheld -- while the numbering still has to advance,
        // because the position of every capture after it is the answer's
        // address.
        return `--- capture ${position} ---\n(no text was recognised on this screen capture)`;
      }
      return (
        `--- capture ${position} ---\n` +
        capture.lines.map((line) => `${line.i}: ${line.text}`).join("\n")
      );
    })
    .join("\n\n");

  const wanted = fields
    .map((field) => {
      const rows = [`- id: ${field.id}`, `  field: "${field.label}"`];
      // The row a multi-row workbook files this field under -- an SID, a
      // location. Two fields sharing a name and differing only by row is the
      // normal shape of two of the three real workbooks, so the model is told
      // which is which rather than left to merge them.
      if (field.group) rows.push(`  row: ${field.group}`);
      rows.push(
        field.excelValue === ""
          ? "  the workbook cell is EMPTY"
          : `  the workbook says: "${field.excelValue}"`,
      );
      return rows.join("\n");
    })
    .join("\n");

  return [
    "Below are screen captures of the EPIC ordering system, read by OCR, and",
    "the order-configuration workbook that describes the same order. Judge",
    "what the screens show against the workbook.",
    "",
    "THE WORKBOOK IS THE YARDSTICK. For each field below, say whether EPIC",
    "shows the same value, a different one, or nothing at all.",
    "",
    "FIELDS",
    wanted,
    "",
    "Answer each field with one of:",
    '  "cocok"            EPIC shows the value the workbook says.',
    '  "beda"             EPIC shows something else. Give `epicValue`, spelled',
    "                     exactly as the capture spells it, and cite where you",
    "                     read it.",
    '  "tidak-ditemukan"  You read every capture and this field is on none of',
    "                     them.",
    "",
    'A field whose workbook cell is EMPTY is "beda" when EPIC shows a value for',
    'it, and "tidak-ditemukan" when EPIC shows nothing either. Some fields',
    "carry a `row`, meaning one service of a multi-service order; two fields",
    "may share a name and differ only by row, so answer each under its own id.",
    "",
    "THEN, SEPARATELY, LIST WHAT EPIC SHOWS THAT NO FIELD ABOVE COVERS. Give",
    "EPIC's own label for it, transcribed off the capture, and the value",
    "standing beside it. Leave out anything a field above already covers, and",
    "leave out furniture: menu items, buttons, column headings with nothing",
    "under them, page numbers, and labels with no value beside them. Name at",
    `most ${MAX_EXTRA}.`,
    "",
    "Captures are numbered by their position in the listing below: the first",
    "shown is capture 0, the second is capture 1, and so on. `capture`, `from`",
    "and `to` are where you read a value -- that position number, and an",
    "inclusive range of the line numbers printed in the listing.",
    "",
    "Reply with JSON only:",
    '{"fields":[{"id":"<one of the ids above>","verdict":"beda",' +
      '"epicValue":"...","capture":0,"from":7,"to":8}],',
    ' "extra":[{"label":"...","epicValue":"...","capture":0,"from":11,"to":11}]}',
    "",
    "Give one entry per field, using the id exactly as written above. Omit",
    '`epicValue` and the citation for "tidak-ditemukan". Reply with an empty',
    "`extra` list when every value on the screens is already a field above.",
    "",
    listing,
  ].join("\n");
}

/**
 * One field's answer, checked and turned into the entry an operator rules on.
 *
 * `label` and `excelValue` are read off the FIELD and never off the reply. The
 * model is being asked what EPIC shows; it is not being asked what the workbook
 * is called or what the cell holds, and a reply that says otherwise is a reply
 * that has drifted. Taking the workbook's half of the row from the workbook is
 * what makes the row's own claim -- "the sheet says X and the screen says Y" --
 * true by construction on the side this module can be sure about.
 */
function entryFor(
  field: ConfigField,
  answer: Answer | undefined,
  captures: readonly EpicCapture[],
): EpicEntry {
  const base = {
    fieldId: field.id,
    label: field.label,
    excelValue: field.excelValue,
    decision: "belum" as const,
  };

  // A KEY THE REPLY NEVER MENTIONS IS NOT A KEY NOBODY ASKED ABOUT.
  // `locateSlots` makes the same promise and for the same reason: the caller
  // has to say something about every field it was asked to check, and "the
  // model went quiet about this one" has to arrive as a reason on a row rather
  // than as a row that is simply not there.
  if (!answer) {
    return {
      ...base,
      verdict: "tidak-ditemukan",
      reason:
        "the model answered about the other fields and said nothing about " +
        "this one, so no capture was reported either way for it",
    };
  }

  const value = (answer.epicValue ?? "").trim();

  // A DISAGREEMENT WITH NOTHING ON THE OTHER SIDE OF IT IS NOT A DISAGREEMENT.
  // `beda` is the one verdict that carries a recommendation -- somebody retypes
  // `epicValue` into EPIC -- so a `beda` with no value is a row whose Terima
  // button has nothing to apply. Recorded as the fact that is actually known:
  // the field was searched for and nothing usable came back.
  if (answer.verdict === "beda" && value === "") {
    return {
      ...base,
      verdict: "tidak-ditemukan",
      reason:
        "the model said EPIC disagrees with the workbook but gave no value " +
        "for what EPIC shows, so there is nothing to compare against and " +
        "nothing to act on",
    };
  }

  if (answer.verdict === "tidak-ditemukan") {
    // NO `epicValue` AND NO CITATION, whatever the reply attached to them. The
    // type says `epicValue` is absent for this verdict, and a citation would
    // point at where a value that was not found was not found. Carrying either
    // one through would put evidence on a row that claims there is none.
    return {
      ...base,
      verdict: "tidak-ditemukan",
      reason: "every capture was read and this field is on none of them",
    };
  }

  const { citation, reason } = citationFor(answer, captures);
  const entry: EpicEntry = { ...base, verdict: answer.verdict };
  if (value !== "") entry.epicValue = value;
  if (citation) entry.citation = citation;
  // Set only for a citation that was OFFERED AND REFUSED, so the absence of a
  // "lihat" link on the row has an explanation somewhere rather than looking
  // like a rendering bug.
  if (reason) entry.reason = reason;
  return entry;
}

/**
 * A model reply -> the entries an operator rules on: one per field, in the
 * workbook's own order, then the leftovers EPIC showed that no field covers.
 *
 * THROWS only when the reply is not a reply: a shape the schema cannot read.
 * That is `sections.ts`' line and `classify.ts`' line -- an ambiguous reply
 * fails loudly at the boundary rather than reaching a schema that will do its
 * best with it. A reply that parses and then says something untrue does NOT
 * throw: the untrue part is dropped with a reason and the rest survives,
 * because one fabricated leftover is no reason to throw away twenty good
 * verdicts.
 *
 * `warn` is a default parameter rather than a required one so the three-argument
 * call is the ordinary one, and it defaults to `console.warn` rather than to
 * silence for the reason `createAllowlist` does the same: a dropped finding is
 * a thing this module decided, and a decision nobody can see is a decision
 * nobody can question. Nothing an operator needs is lost when one is dropped
 * (a leftover naming a real field is already a row of its own, and a blank one
 * says nothing), so the count belongs in the deployer's log rather than on the
 * screen.
 */
export function foldEpicReply(
  fields: readonly ConfigField[],
  captures: readonly EpicCapture[],
  reply: unknown,
  warn: (message: string) => void = console.warn,
): EpicEntry[] {
  const parsed = Reply.parse(reply);

  // THE SECOND, INDEPENDENT GUARD on the no-captures case. `compareToEpic`
  // already refuses to spend a call for it, and this one refuses to believe a
  // reply about it: a `cocok` describing a screen nobody supplied is a
  // fabrication that would read as a checked field. Every entry says the same
  // thing the un-spent path says, so the two cannot drift.
  if (captures.length === 0) return unread(fields, NO_CAPTURES);

  const wanted = new Set(fields.map((field) => field.id));
  const seen = new Map<string, Answer>();
  for (const answer of parsed.fields) {
    // AN ANSWER FOR AN ID NOBODY ASKED FOR is dropped, exactly as `fields.ts`
    // drops an unrequested `fieldKey` and `locateSlots` an unrequested slot: a
    // hallucinated id that reached a caller would name a field the workbook
    // does not have, wearing a `fieldId` some later screen would try to look
    // up.
    if (!wanted.has(answer.id)) continue;
    // A DUPLICATE ID KEEPS THE FIRST. Deterministic beats clever; the
    // alternative is picking by some quality the reply reports about itself,
    // which invites the model to arbitrate a bug in its own output.
    if (seen.has(answer.id)) continue;
    seen.set(answer.id, answer);
  }

  const entries: EpicEntry[] = fields.map((field) =>
    entryFor(field, seen.get(field.id), captures),
  );

  // ONE ENTRY PER FIELD IS A GUARANTEE, so the leftovers go strictly after
  // them: a caller that pairs entries with fields by position for the first
  // `fields.length` rows is right, and a caller that reads `fieldId` is right
  // as well.
  const fieldLabels = new Set(fields.map((field) => foldLabel(field.label)));
  const takenLabels = new Set<string>();
  for (const leftover of parsed.extra ?? []) {
    const entry = leftoverEntry(leftover, captures, fieldLabels, takenLabels, warn);
    if (entry) entries.push(entry);
  }

  return entries;
}

/**
 * One `tidak-ada-di-excel` finding, or `null` when it is dropped.
 *
 * Three drops, each of which produces a specific bad row rather than a crash:
 *
 *  - A BLANK LABEL is a finding with no content. The entry's whole claim is
 *    "EPIC shows something called X that the workbook has no field for", and
 *    with no X there is nothing for an operator to look for on the screen.
 *  - A LABEL THE WORKBOOK ALREADY HAS is a `beda`, not a missing field, and it
 *    already has a row of its own further up. Keeping it would put the same
 *    name in front of the operator twice, once as a field they are deciding on
 *    and once as a field that does not exist, and the two rows would say
 *    contradictory things about the same value.
 *  - A BLANK VALUE is the finding contradicting itself. `epicValue` is what
 *    EPIC shows, and a leftover is by definition a VALUE the workbook has no
 *    field for; a label with nothing beside it is the furniture the prompt
 *    already asks the model to leave out.
 *
 * A leftover that repeats an EARLIER LEFTOVER is dropped by the same rule as
 * the second, which is why `taken` is a set the loop grows rather than a
 * snapshot: one finding, one decision.
 *
 * THE LABEL IS NOT CHECKED AGAINST THE LINES IT CITES, and that is a decision
 * rather than an omission -- `sections.ts` does exactly that to a judul title
 * and calls it the one thing standing between the model and a fabricated
 * heading. The difference is what a fabrication can reach. A judul title is
 * printed into a document a validator signs; a leftover here has no `fieldId`,
 * no `valueRef` and no cell, so it can never be written into the workbook, and
 * it is shown to an operator beside the capture text it was read from. The
 * check would also fail honestly-cited values routinely, because a label on
 * screen and a label in a reply differ by the punctuation and spacing OCR
 * leaves behind. Add it the day a leftover can reach a deliverable.
 */
function leftoverEntry(
  leftover: Leftover,
  captures: readonly EpicCapture[],
  fieldLabels: ReadonlySet<string>,
  taken: Set<string>,
  warn: (message: string) => void,
): EpicEntry | null {
  const label = leftover.label.trim();
  const value = (leftover.epicValue ?? "").trim();
  const drop = (why: string): null => {
    warn(`epic-compare: dropped a "tidak-ada-di-excel" finding, ${why}`);
    return null;
  };

  if (label === "") {
    return drop("because it named no label, so there is nothing to look for");
  }

  const folded = foldLabel(label);
  if (fieldLabels.has(folded)) {
    return drop(
      `because "${label}" is a field the workbook does have, which makes it a ` +
        "disagreement about that field rather than a missing one",
    );
  }
  if (taken.has(folded)) {
    return drop(`because "${label}" was already named by an earlier finding`);
  }
  if (value === "") {
    return drop(
      `because "${label}" came with no value, and a label with nothing beside ` +
        "it is not something the workbook is missing",
    );
  }

  taken.add(folded);

  // NO `fieldId` KEY AT ALL, not one set to undefined: its absence is what
  // says there is no field to point at, and it is how every consumer tells
  // this entry from the other four verdicts.
  const entry: EpicEntry = {
    label,
    excelValue: "",
    verdict: "tidak-ada-di-excel",
    epicValue: value,
    decision: "belum",
  };
  const { citation, reason } = citationFor(leftover, captures);
  if (citation) entry.citation = citation;
  if (reason) entry.reason = reason;
  return entry;
}

/**
 * Checkpoint 3, end to end: one call, one entry per field, plus the leftovers.
 *
 * TWO CASES BUY A LIST RATHER THAN A PROMPT, and both are about not spending a
 * call to be told nothing:
 *
 *  - NO CAPTURES. Asking what a screen nobody supplied shows is waste, and the
 *    answer is already known: every field is unchecked, and `unread` says so on
 *    every row rather than returning an empty list a panel would render as "not
 *    run yet".
 *  - NO FIELDS. There is no yardstick, and this stage's whole job is judging
 *    EPIC against one. The reply could still carry leftovers -- with nothing to
 *    compare against, EVERY value on the screen is a leftover -- and a list of
 *    forty `tidak-ada-di-excel` rows is a transcription of the screenshot
 *    rather than a finding, bought at model prices and paid for again in the
 *    operator's decisions. A workbook that interpreted into no fields is a
 *    Checkpoint 2 that did not happen, and that is where it has to be fixed.
 *
 * Errors are NOT caught. A provider failure propagates to the caller, which is
 * the boundary rule `locateSlots`' header states at length: pipeline code takes
 * an injected `Ask` and must not know who serves it, and a route that turned an
 * outage into "EPIC agrees with everything" would be this project's failure
 * class with a 200 on it.
 */
export async function compareToEpic(deps: EpicCompareDeps): Promise<EpicEntry[]> {
  const { fields, captures, ask } = deps;

  if (captures.length === 0) return unread(fields, NO_CAPTURES);
  if (fields.length === 0) return [];

  return foldEpicReply(
    fields,
    captures,
    extractJson(await ask(buildEpicPrompt(fields, captures))),
  );
}
