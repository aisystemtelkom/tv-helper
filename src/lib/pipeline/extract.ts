/**
 * THE FIELD-EXTRACTION WIRING: which pages a key is shown, in what order,
 * which keys are asked for at all, and how each answer's citation is mapped
 * back to a real page.
 *
 * `fields.ts` owns the prompt and the citation validation. This file owns
 * everything around it, and it lives here rather than in
 * `scripts/generate.mjs` because BOTH callers need exactly this and there
 * must be only one of it: the CLI (`pnpm generate`) and the server route
 * (`/api/extract`), which cannot import a script. The 2026-09-03 findings
 * name the specific hazard -- "the route ships a second copy of
 * `NEVER_EXTRACTED` that can silently disagree with the first" -- and a
 * second copy of that set is a blank cell in one deliverable and a plausible
 * wrong value in the other, from the same bundle, with nothing to show which
 * is which.
 *
 * The wrong-customer regression this file's comments keep returning to lived
 * in this wiring and not in `fields.ts`: ranking, grouping and hint
 * prepending are what decide whether `cc` answers with the subscriber or with
 * a printed email's own `Cc:` header. Read AGENTS.md's "The tool must be
 * document-agnostic" before changing any of it, and re-run
 * `pnpm measure:locate` after.
 */

import type { Template } from "../forms/template.ts";
import type { Ask, DocType } from "./classify.ts";
import {
  extractFields,
  reconcileFieldValues,
  type CitedSource,
  type FieldValue,
} from "./fields.ts";
import type { OcrPage } from "./locate.ts";

/**
 * A page as the extraction path reads one: everything `extractFields` needs,
 * plus the page's identity outside this run's bundle-global numbering.
 *
 * `sourceName` and `pageInDoc` are optional because not every producer knows
 * them, and they are never invented: a citation that names a file and a page
 * number that were guessed is exactly the false citation `fields.ts` calls
 * worse than none.
 */
export type FieldPage = OcrPage & {
  sourceName?: string;
  pageInDoc?: number;
};

/**
 * The docTypes a fieldKey's value is MOST LIKELY to sit in -- the pages put
 * at the front of its pool, never the only pages in it.
 *
 * The entries are unchanged from when this was a filter, and the name is kept
 * for the same reason; what changed is that `rankedPoolForDocTypes` consumes
 * it instead of `poolForDocTypes`, so a key absent here simply gets an
 * unranked pool rather than a different (smaller) one. Every key sees every
 * page either way.
 */
export const FIELD_DOC_TYPES: Record<string, DocType[]> = {
  cc: ["BAPermintaan"],
  alamat: ["BAPermintaan"],
  picContacts: ["Email"],
};

/**
 * The docTypes every `layout: "images"` fillable slot captures -- the pages a
 * key with no `FIELD_DOC_TYPES` entry is shown first.
 */
export function orderPaperworkDocTypes(template: Template): DocType[] {
  const set = new Set<DocType>();
  for (const section of template.sections) {
    if (section.layout !== "images") continue;
    for (const slot of section.slots) {
      if (slot.fillable && slot.docType) set.add(slot.docType);
    }
  }
  return [...set];
}

/**
 * The classified pages for a set of docTypes, ascending by global index. Pure
 * and side-effect free, so it is testable without a model call.
 *
 * `pages` is indexed BY GLOBAL PAGE INDEX, not by position: it is the shape a
 * round's pages take once they are laid out by `.index`, and it is sparse
 * whenever a round holds only some of the run's pages.
 */
export function poolForDocTypes<P>(
  docTypes: Iterable<DocType>,
  byType: ReadonlyMap<DocType, Iterable<number>>,
  pages: readonly P[],
): P[] {
  const wanted = new Set<number>();
  for (const docType of docTypes) {
    for (const index of byType.get(docType) ?? []) wanted.add(index);
  }
  return [...wanted].sort((a, b) => a - b).map((i) => pages[i]);
}

/**
 * The pool a search is offered: EVERY candidate page, with the ones
 * `classify.ts` labelled with a preferred docType moved to the front.
 *
 * Nothing is dropped, and that is the entire point -- this is the function
 * that replaced `poolFor(byType, pages, slot.docType)`, which returned only
 * the matching pages and so decided in advance which document could possibly
 * answer a key. Reintroducing a filter here (an early `return head`, a
 * `.slice`, "the tail is only noise") re-narrows the pool and quietly
 * restores the assumption the tool is supposed to have dropped.
 *
 * NOT THE SAME FUNCTION AS `rankedPoolForSlot` in
 * `src/app/api/propose/handler.ts`, which is why both carry what they rank in
 * their names. That one ranks for ONE SLOT and reads its preference off
 * `SlotDef.docType`; this one ranks for a GROUP OF FIELD KEYS and is handed
 * the docType list outright. The argument orders differ too, so neither is a
 * drop-in for the other and a mix-up would not be a type error.
 */
export function rankedPoolForDocTypes<P extends { index: number }>(
  preferredDocTypes: readonly (DocType | null | undefined)[] | undefined,
  byType: ReadonlyMap<DocType, Iterable<number>>,
  candidates: readonly P[],
): P[] {
  const preferred = new Set<number>();
  for (const docType of preferredDocTypes ?? []) {
    if (!docType) continue;
    for (const index of byType.get(docType) ?? []) preferred.add(index);
  }
  const head: P[] = [];
  const tail: P[] = [];
  for (const page of candidates) {
    (preferred.has(page.index) ? head : tail).push(page);
  }
  return [...head, ...tail];
}

/**
 * Maps a citation's pool POSITION back to that page's true document index.
 * Returns undefined -- drop the citation -- when the position is not one the
 * pool actually holds, instead of the old `pool[i]?.index ?? i` fallback,
 * which wrote the raw local position into the workbook as a bundle-global
 * page number whenever the model cited a position outside the pool.
 */
export function remapCitedPageIndex(
  poolPosition: number,
  pool: readonly { index: number }[],
): number | undefined {
  return pool[poolPosition]?.index;
}

/**
 * Wraps an `ask` so the extraction prompt carries each key's definition.
 *
 * `extractFields` is handed bare key names and builds its prompt from them,
 * which makes "cc" the entire description of the field -- the thinnest hint
 * in the pipeline, and the one that lost to the printed email's own `Cc:`
 * header when the pool stopped being narrowed. The definitions live in
 * `Template.fieldHints`; this is how they reach the model.
 *
 * It PREPENDS rather than splicing into the prompt on purpose. The prompt is
 * `src/lib/pipeline/fields.ts`'s to build, and matching against its interior
 * ("insert after the `Fields:` line") would make this quietly stop working
 * the next time that file is reworded -- quietly, because the call would
 * still succeed and the model would still answer, just without the
 * disambiguation that keeps the customer name right.
 *
 * Returns `ask` unchanged when nothing is described, so a key with no entry
 * costs no wrapper and no prompt text.
 */
export function withFieldHints(
  ask: Ask,
  keys: readonly string[],
  fieldHints: Record<string, string> | undefined,
): Ask {
  const described = keys.filter((key) => fieldHints?.[key]);
  if (described.length === 0) return ask;

  const block = [
    "FIELD DEFINITIONS. These define the fields requested below. Where a",
    "definition and the field's short name disagree, the definition wins, and",
    "text a definition rules out is not an acceptable answer even when it",
    "looks like a match.",
    ...described.map((key) => `  ${key}: ${fieldHints?.[key]}`),
    "",
  ].join("\n");

  return (prompt: string) => ask(`${block}\n${prompt}`);
}

export type KeyGroup = { docTypes: DocType[]; keys: string[] };

/**
 * Groups fieldKeys by the docType set that ranks their pool, so keys with the
 * same ranking cost one extraction call instead of one apiece.
 *
 * This is the multiplier on an extract request's bill. Each group carries the
 * WHOLE run's OCR listing: measured on the sample bundle, ~73k characters
 * over 29 pages and 1,288 lines, or ~19-21k input tokens, per group. Two
 * groups today, so ~40-46k tokens a request. Splitting the keys finer is not
 * free and does not look expensive from here.
 */
export function groupKeysByDocTypes(
  keys: Iterable<string>,
  defaultDocTypes: DocType[],
): KeyGroup[] {
  const groups = new Map<string, KeyGroup>();
  for (const key of keys) {
    const docTypes = FIELD_DOC_TYPES[key] ?? defaultDocTypes;
    const signature = docTypes.join("|");
    const group = groups.get(signature);
    if (group) group.keys.push(key);
    else groups.set(signature, { docTypes, keys: [key] });
  }
  return [...groups.values()];
}

/**
 * Keys deliberately not sent to the model at all, whatever the template says.
 *
 * `namaProyek` is in this set and ships BLANK. It reaches the two most-read
 * cells in the deliverables -- the `NAMA Proyek :` cell in the docx header
 * table and its xlsx row -- and on the full pool it reliably answered with
 * the Surat Penunjukan's subject line: the master contract's scope title, not
 * this order's project name. That wrong value carried a citation that
 * *passed* validation, so it read as sourced evidence rather than a guess
 * (task-11 finding 3).
 *
 * IT WAS BRIEFLY RE-ENABLED and is reverted. The case for re-enabling was
 * that `AO_TEMPLATE.fieldHints.namaProyek` now rules out the agreement title
 * and the appointment letter's subject by name, and one manual run on the
 * sample bundle showed it no longer answering with the master contract. That
 * same run recorded the answer as the request email's own subject line, "not
 * the wording the human-authored sample uses for the same field" -- by its
 * own account not the right value. A key whose best recorded evidence is
 * "differently wrong" does not clear the bar for a cell a validator signs.
 *
 * The bar for taking it back out of this set is a reproducible run that
 * yields the sample's own project name, not an argument that the hint is
 * better. Until then a blank invites the operator to fill it in, and a
 * plausible wrong value does not. Both consumers report it by name with the
 * reason below -- `outstandingFields` in the CLI, the `not-searched`
 * disposition at `/api/extract` -- so blank is never silent.
 */
export const NEVER_EXTRACTED: ReadonlySet<string> = new Set(["namaProyek"]);

/**
 * Why a `NEVER_EXTRACTED` key is blank, for the run's outstanding list and
 * for the route's `not-searched` disposition. The generic "searched, not
 * found" would be a false statement about it: nothing searched for it at all.
 */
export const NEVER_EXTRACTED_REASON =
  "deliberately not extracted; the operator fills this in (see NEVER_EXTRACTED)";

/**
 * Keys that may be extracted but must NEVER be presented at high confidence,
 * however clean their citation looks.
 *
 * `cc` is the customer. On an unnarrowed pool it once matched the printed
 * email's own `Cc:` header and both deliverables shipped a WRONG CUSTOMER
 * (AGENTS.md, "The tool must be document-agnostic"). What holds that down now
 * is a hint, not a smaller haystack, and a hint is a preference the model can
 * still lose track of -- while a validated citation only proves the lines
 * exist, not that they are the subscriber rather than a distribution list. So
 * the cap is on the presentation: a value the operator is invited to skim
 * past is exactly how the wrong customer shipped the first time.
 */
export const NEVER_HIGH_CONFIDENCE: ReadonlySet<string> = new Set(["cc"]);

/** Why a `NEVER_HIGH_CONFIDENCE` key is capped, in a sentence a UI can print. */
export const NEVER_HIGH_CONFIDENCE_REASON =
  "this field has shipped a wrong customer before; confirm it against the " +
  "document even when it is cited";

/**
 * The default `conflictReason`: what a conflict means when the entry does not
 * say, which is `reconcileFieldValues`' own case.
 */
export const DISAGREEING_DOCUMENTS_REASON =
  "found more than once and the answers disagree";

/** Why a key the order request already answered is not searched for again. */
export const ANSWERED_BY_REQUEST_REASON =
  "the order request supplies this value; the scans were not searched for it";

/**
 * The backed xlsx keys a run actually asks the model for: every fieldKey the
 * template declares, minus `NEVER_EXTRACTED` and minus anything already
 * answered. Exported so the exclusion is testable end of chain rather than
 * asserted about a Set nothing reads -- silently dropping this filter is
 * exactly how the blank cell would turn back into a plausible wrong one.
 *
 * `answered` is what the ORDER REQUEST supplied. Removing those keys is not an
 * optimisation, it is the correction the 2026-09-03 findings asked for: a
 * value that is sitting in a cell of a spreadsheet the operator handed us must
 * not ALSO be hunted for in a 29-page scan, because the hunt can succeed --
 * plausibly, with a citation that passes validation -- and then the two
 * answers have to be reconciled by machinery that cannot know the request is
 * the authority. Not asking is the only way to be sure the request wins.
 */
export function extractableFieldKeys(
  template: Template,
  answered: ReadonlySet<string> = new Set(),
): string[] {
  return templateFieldKeys(template).filter(
    (key) => !NEVER_EXTRACTED.has(key) && !answered.has(key),
  );
}

/**
 * EVERY backed fieldKey the template declares, in row order, deduplicated --
 * including the ones nothing will ever ask the model for.
 *
 * The difference from `extractableFieldKeys` is the whole point: a consumer
 * reporting to an operator has to name the keys that were NOT searched as
 * well as the ones that were, or a deliberately blank cell is
 * indistinguishable from one that was searched for and not found. That
 * distinction is `NEVER_EXTRACTED`'s entire reason for existing.
 */
export function templateFieldKeys(template: Template): string[] {
  return [
    ...new Set(
      template.xlsxRows
        .map((row) => row.fieldKey)
        .filter((key): key is string => typeof key === "string" && key !== ""),
    ),
  ];
}

export type ExtractTextFieldsOptions = {
  template: Template;
  /** `classify.ts`'s spans, as docType -> the global indexes carrying it. */
  byType: ReadonlyMap<DocType, Iterable<number>>;
  /** Every page of the run, in run-global order. */
  pages: readonly FieldPage[];
  /** Injected, always: this module never learns who answers. */
  ask: Ask;
  /** fieldKeys the order request already answered. Not searched for again. */
  answered?: ReadonlySet<string>;
  /** Progress, for the CLI. Silent by default so a route logs its own way. */
  log?: (message: string) => void;
};

/**
 * Every backed xlsx value the documents can supply, with its citation mapped
 * back to a real page.
 *
 * `ask` is injected, for the same reason `searchRound` injects `locate`: it
 * makes the whole wiring -- ranking, grouping, hint prepending, citation
 * remapping -- exercisable without a credential. The wrong-customer
 * regression lived in this wiring, not in `extractFields`, so a test that
 * composes the pieces itself would not have caught it.
 *
 * THE RETURNED LIST HOLDS AT MOST ONE ENTRY PER fieldKey. This is the one
 * point where every answer to a key converges -- a model reply that cites the
 * same field twice, two key groups that both answer it, and the documents of
 * every round, since extraction runs once over the whole run's pages after
 * the last tambahan round rather than per round. `reconcileFieldValues` is
 * therefore applied here and nowhere else, and it is what makes two spellings
 * of one answer stop counting as a disagreement (`Bank Contoh Nusantara` and
 * `PT Bank Contoh Nusantara Tbk` are one answer, not two). Drop the call and
 * the duplicates come back, to be resolved by array order inside whichever
 * exporter builds its Map last.
 */
export async function extractTextFields(
  options: ExtractTextFieldsOptions,
): Promise<FieldValue[]> {
  const { template, byType, pages, ask, answered = new Set(), log = () => {} } =
    options;

  const keys = extractableFieldKeys(template, answered);
  const defaultDocTypes = orderPaperworkDocTypes(template);

  if (keys.length === 0) {
    log("  the order request answered every backed key; no model call");
    return [];
  }

  const values: FieldValue[] = [];
  for (const group of groupKeysByDocTypes(keys, defaultDocTypes)) {
    // Every page, ranked -- see `rankedPoolForDocTypes`. `pages` is the whole
    // run's page list, so a key can be answered by a document that arrived in
    // a later round.
    const pool = rankedPoolForDocTypes(group.docTypes, byType, pages);
    if (pool.length === 0) {
      log(`  no pages to search; skipping ${group.keys.join(", ")}`);
      continue;
    }

    log(
      `  extracting ${group.keys.join(", ")} from ${pool.length} pages ` +
        `(${group.docTypes.join("/")} first)...`,
    );

    // Renumbered from 0 because the prompt numbers pages BY POSITION in the
    // listing (see `extractFields`' header comment): a pool whose first page
    // is labelled anything but 0 gets answered one position off.
    const renumbered = pool.map((page, position) => ({ ...page, index: position }));
    const found = await extractFields(
      group.keys,
      renumbered,
      withFieldHints(ask, group.keys, template.fieldHints),
    );

    for (const value of found) {
      if (!value.source) {
        values.push(value);
        continue;
      }
      // Same lookup `remapCitedPageIndex` makes internally, kept here too so
      // the xlsx note can name the page's own file and page number instead of
      // this run's bundle-global index (task-11 finding 2) -- that global
      // index sent a reviewer to the wrong document for every page after the
      // first source file.
      const page = pool[value.source.pageIndex];
      const pageIndex = remapCitedPageIndex(value.source.pageIndex, pool);
      if (pageIndex === undefined) {
        // The value survives, the citation does not -- and it now says WHY
        // rather than arriving indistinguishable from a value the model never
        // cited at all.
        //
        // A SECOND NET, not the first one. `citationOutcome` already rejects a
        // position the pool does not hold, so this branch is only reachable if
        // the pool it validated against and the pool remapped here ever stop
        // being the same array. They are the same array today; the cost of
        // saying so anyway is one comparison, and the cost of being wrong is
        // a raw pool position written into the workbook as though it were a
        // bundle-global page number.
        values.push({
          fieldKey: value.fieldKey,
          value: value.value,
          citation: {
            status: "invalid",
            reason:
              `cited position ${value.source.pageIndex}, which the ` +
              `${pool.length}-page pool it was shown does not hold`,
            claimed: {
              pageIndex: value.source.pageIndex,
              from: value.source.lineRange[0],
              to: value.source.lineRange[1],
            },
          },
        });
        continue;
      }
      const source: CitedSource = {
        ...value.source,
        pageIndex,
        sourceName: page.sourceName,
        pageInDoc: page.pageInDoc,
      };
      // `citation` is rewritten from the remapped source, never left as the
      // pool-local one `extractFields` built: a consumer reading
      // `citation.source` and one reading `source` must not be sent to two
      // different pages.
      values.push({ ...value, source, citation: { status: "cited", source } });
    }
  }

  // `template.fieldLists` is what tells the reconciler that a key's cell holds
  // several answers rather than one, and it is the only reason `picContacts`
  // stops shipping blank -- see `reconcileFieldValues`. Passed from the
  // template rather than read from a constant here so the pipeline never
  // carries one form's key names.
  return reconcileFieldValues(values, template.fieldLists);
}
