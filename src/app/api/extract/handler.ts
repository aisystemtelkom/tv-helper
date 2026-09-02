/**
 * `/api/extract`: the values half of the run, and the only thing in this app
 * that can autofill the export step from what the documents actually say.
 *
 * WHY IT IS A SERVER ROUTE, and why it is a SEPARATE one from `/api/propose`.
 * Same reason for the first: `src/lib/model.ts` is the only file that may
 * know how the model is reached, and it is server-side because the credential
 * is, so the browser renders and OCRs on the device and asks this route what
 * the text says. Separate from propose because the two run at different
 * times over different things -- propose is re-run PER OUTSTANDING SLOT as
 * the operator works through the dokumen tambahan loop, while extraction runs
 * ONCE over the whole run after the last tambahan round, since
 * `reconcileFieldValues` can only settle two documents' answers to one key if
 * it sees both. Folding them together would either re-extract every field on
 * every slot re-search (~40-46k input tokens a time, measured below) or
 * extract before the last document arrived.
 *
 * WHAT LEAVES THE DEVICE, EXACTLY. OCR LINE TEXT AND ITS BOXES, exactly as at
 * `/api/propose`: `classifyPages` and `extractFields` build TEXT prompts and
 * this route never touches pixels. Anything added here that sends an image
 * would move this project's data boundary.
 *
 * WHAT IT COSTS. Each key group carries the whole run's OCR listing. Measured
 * on the sample bundle: ~73k characters over 29 pages and 1,288 lines, about
 * 19-21k input tokens, and today exactly two groups -- so ~40-46k input
 * tokens per request, against propose's ~150-160k for a full first pass. Plus
 * one classify call per source document. `route.ts` logs every call and the
 * request's total, the same way propose does.
 *
 * The control flow is separated from `route.ts` so
 * `src/app/api/extract/extract.test.mts` can execute the authorization gate,
 * the page-numbering guard and the whole disposition table with no Next
 * runtime, no bundler and no credential.
 */

import type { ApiGate } from "@/lib/auth/guard";

// Relative, with explicit `.ts`, and never through the `@/` alias: this file
// is executed directly by `node --test` (see the note above), which resolves
// neither a bare alias nor an extensionless specifier.
import {
  AskFailed,
  assertRunGlobalIndexes,
  assertWirePages,
  classifyByDocType,
  guardAsk,
  type WirePage,
} from "../../../lib/api/wire.ts";
import { AO_TEMPLATE, type Template } from "../../../lib/forms/template.ts";
import type { Ask } from "../../../lib/pipeline/classify.ts";
import {
  ANSWERED_BY_REQUEST_REASON,
  DISAGREEING_DOCUMENTS_REASON,
  NEVER_EXTRACTED,
  NEVER_EXTRACTED_REASON,
  NEVER_HIGH_CONFIDENCE,
  NEVER_HIGH_CONFIDENCE_REASON,
  extractTextFields,
  templateFieldKeys,
  type FieldPage,
} from "../../../lib/pipeline/extract.ts";
import type {
  CitationClaim,
  CitedSource,
  FieldValue,
} from "../../../lib/pipeline/fields.ts";

export type ExtractBody = {
  runId: string;
  pages: WirePage[];
  /**
   * fieldKeys the ORDER REQUEST already answered, which are therefore not
   * hunted for in the scans at all. Not an optimisation: a value sitting in a
   * spreadsheet the operator handed us must not also be searched for in a
   * 29-page scan, because the hunt can succeed -- plausibly, with a citation
   * that passes validation -- and then two answers have to be reconciled by
   * machinery that cannot know the request is the authority (2026-09-03
   * findings, section 2).
   */
  answered?: string[];
};

/**
 * WHAT BECAME OF ONE FIELD. Six outcomes, because they are six different
 * things to a human validator and collapsing any two of them is how a wrong
 * value gets signed.
 *
 *   cited             found, and the citation it came with checked out
 *   uncited           found, and the model named no page or lines at all
 *   citation-invalid  found, and the citation did NOT check out -- a page it
 *                     was never shown, a reversed range, a line the page does
 *                     not have. A different thing from `uncited`: the model
 *                     was confabulating around this answer on the record, and
 *                     that is evidence about the VALUE, not just about the
 *                     reference. Distinguishing these two is the blocker the
 *                     2026-09-03 findings named (section 4), and it is why
 *                     `CitationOutcome` exists in `fields.ts`.
 *   conflict          found more than once, and the answers denote different
 *                     things. Ships blank with every spelling listed, because
 *                     choosing between two customers is the operator's call.
 *   not-found         searched every page and the text does not contain it.
 *   not-searched      nothing looked. `namaProyek` (see `NEVER_EXTRACTED`),
 *                     and any key the order request already answered.
 *
 * `not-found` and `not-searched` are the pair this project has already been
 * bitten by at `/api/propose`: reporting an unsearched slot as searched sent
 * an operator hunting for documents to fill it.
 */
export type FieldDisposition =
  | "cited"
  | "uncited"
  | "citation-invalid"
  | "conflict"
  | "not-found"
  | "not-searched";

export type ExtractedField = {
  fieldKey: string;
  /** Blank for every status but `cited`, `uncited` and `citation-invalid`. */
  value: string;
  status: FieldDisposition;
  /**
   * `high` ONLY for a value whose citation checked out and whose key is not
   * capped -- see `NEVER_HIGH_CONFIDENCE`. Everything else is `low`, which is
   * the UI's cue to make the operator look.
   */
  confidence: "high" | "low";
  /** Why, in a sentence a UI can print. Absent only for a clean `cited`. */
  reason?: string;
  /** The validated citation. Present exactly when status is `cited`. */
  source?: CitedSource;
  /** What the model claimed, when it claimed something that did not check out. */
  claimed?: CitationClaim;
  /** Every disagreeing spelling, when status is `conflict`. */
  conflict?: string[];
};

export type ExtractResult = { fields: ExtractedField[] };

/**
 * The browser's pages as the extraction path reads them.
 *
 * `pageInDoc` IS DERIVED WHEN THE CALLER DID NOT SEND IT: a page's position
 * among the pages carrying the same `sourceId`. That is true while a
 * document's pages are appended in run order, which the ingest loop does
 * because it walks one PDF page by page. `sourceName` falls back to the
 * `sourceId` rather than to a guessed filename -- it identifies the document
 * unambiguously within the run, and inventing a nicer-looking name for a
 * citation is the false-citation failure `fields.ts` calls worse than none.
 */
export function toFieldPages(pages: WirePage[]): FieldPage[] {
  const seenPerSource = new Map<string, number>();
  return pages.map((page) => {
    const seen = seenPerSource.get(page.sourceId) ?? 0;
    seenPerSource.set(page.sourceId, seen + 1);
    return {
      index: page.index,
      width: page.width,
      height: page.height,
      lines: page.lines,
      sourceName: page.sourceName ?? page.sourceId,
      pageInDoc: page.pageInDoc ?? seen,
    };
  });
}

/** One key's disposition, read off the value the pipeline produced for it. */
function dispositionOf(fieldKey: string, found: FieldValue | undefined): ExtractedField {
  if (!found) {
    return {
      fieldKey,
      value: "",
      status: "not-found",
      confidence: "low",
      reason: "searched every page, not found",
    };
  }

  if (found.conflict?.length) {
    return {
      fieldKey,
      value: "",
      status: "conflict",
      confidence: "low",
      reason:
        `${found.conflictReason ?? DISAGREEING_DOCUMENTS_REASON} ` +
        `(${found.conflict.map((value) => JSON.stringify(value)).join(" vs ")}); ` +
        "ships blank until the operator picks one",
      conflict: found.conflict,
    };
  }

  // `reconcileFieldValues` keeps a blank entry for a key nothing answered, so
  // that a caller's outstanding report still names it. An empty value here is
  // that entry, and it means the same as no entry at all.
  if (found.value.trim() === "") {
    return {
      fieldKey,
      value: "",
      status: "not-found",
      confidence: "low",
      reason: "searched every page, not found",
    };
  }

  const citation = found.citation;
  if (citation?.status === "cited") {
    return {
      fieldKey,
      value: found.value,
      status: "cited",
      confidence: "high",
      source: found.source ?? citation.source,
    };
  }
  if (citation?.status === "invalid") {
    return {
      fieldKey,
      value: found.value,
      status: "citation-invalid",
      confidence: "low",
      reason: `the citation did not check out: ${citation.reason}`,
      claimed: citation.claimed,
    };
  }
  return {
    fieldKey,
    value: found.value,
    status: "uncited",
    confidence: "low",
    reason: "the model gave no page or line numbers for this value",
  };
}

/**
 * THE TWO POISONED FIELDS, enforced here rather than trusted upstream.
 *
 * Both have shipped a wrong customer-facing value before, and both are held
 * down upstream by things that can be edited without anyone thinking about
 * this route: `namaProyek` by a Set in `extract.ts`, `cc` by a sentence in
 * `Template.fieldHints`. This is the second net, at the point where a value
 * becomes something an operator sees.
 *
 *   namaProyek  never comes back as a value at all. On the full pool it
 *               reliably answered with the master contract's scope title and
 *               carried a citation that PASSED validation, in the two
 *               most-read cells in the deliverables. It is reported
 *               `not-searched` carrying the recorded reason, so the blank is
 *               explained rather than silent.
 *   cc          comes back, and never at `high`. A validated citation proves
 *               the lines exist, not that they name the subscriber rather
 *               than a distribution list -- which is exactly the mistake that
 *               shipped, matching a printed email's own `Cc:` header.
 */
export function applyPoisonedFieldRules(fields: ExtractedField[]): ExtractedField[] {
  return fields.map((field) => {
    if (NEVER_EXTRACTED.has(field.fieldKey)) {
      return {
        fieldKey: field.fieldKey,
        value: "",
        status: "not-searched",
        confidence: "low",
        reason: NEVER_EXTRACTED_REASON,
      };
    }
    if (NEVER_HIGH_CONFIDENCE.has(field.fieldKey) && field.value !== "") {
      return {
        ...field,
        confidence: "low",
        reason: field.reason
          ? `${field.reason}; ${NEVER_HIGH_CONFIDENCE_REASON}`
          : NEVER_HIGH_CONFIDENCE_REASON,
      };
    }
    return field;
  });
}

/**
 * The extraction itself.
 *
 * EVERY BACKED KEY THE TEMPLATE DECLARES COMES BACK, including the ones
 * nothing searched for. A key missing from the response is a key the UI
 * cannot say anything about, and "we did not look" is one of the six things
 * this route exists to say.
 */
export async function extractValues(
  body: ExtractBody,
  rawAsk: Ask,
  template: Template = AO_TEMPLATE,
): Promise<ExtractResult> {
  assertRunGlobalIndexes(body.pages);

  const keys = templateFieldKeys(template);
  const answered = new Set(body.answered ?? []);

  const notSearched = (fieldKey: string, reason: string): ExtractedField => ({
    fieldKey,
    value: "",
    status: "not-searched",
    confidence: "low",
    reason,
  });

  if (body.pages.length === 0) {
    // NOT `not-found`. Nothing was read, so saying the bundle does not contain
    // a customer name would be a statement about documents no one opened.
    return {
      fields: applyPoisonedFieldRules(
        keys.map((key) =>
          notSearched(key, "no pages were sent with this run; nothing was read"),
        ),
      ),
    };
  }

  // Every model call goes through the tagged wrapper, so a provider failure
  // cannot be reported as a field that was searched and not found.
  const ask = guardAsk(rawAsk);

  const byType = await classifyByDocType(body.pages, ask);
  const values = await extractTextFields({
    template,
    byType,
    pages: toFieldPages(body.pages),
    ask,
    answered,
  });

  const found = new Map(values.map((value) => [value.fieldKey, value]));

  const fields = keys.map((key) => {
    if (NEVER_EXTRACTED.has(key)) return notSearched(key, NEVER_EXTRACTED_REASON);
    if (answered.has(key)) return notSearched(key, ANSWERED_BY_REQUEST_REASON);
    return dispositionOf(key, found.get(key));
  });

  return { fields: applyPoisonedFieldRules(fields) };
}

export type ExtractDeps = {
  /** The authorization gate. `requireApiUser` in production. */
  gate: () => Promise<ApiGate>;
  /** The model call. Only reached once `gate` has admitted the caller. */
  extract: (body: ExtractBody) => Promise<ExtractResult>;
  /** Turns a provider failure into an operator-readable 503. */
  unreachable: (error: unknown) => Response;
  /** A reply that arrived and could not be used. Not the same as 503. */
  unusable?: (error: unknown) => Response;
  /** Malformed request. Separate from the two above: it is the caller's. */
  badRequest?: (error: unknown) => Response;
};

function defaultBadRequest(error: unknown): Response {
  return Response.json(
    {
      error: "bad-request",
      message: "The request body is not a valid extraction request.",
      cause: error instanceof Error ? error.message : String(error),
    },
    { status: 400 },
  );
}

/**
 * A reply that arrived and could not be parsed, kept DISTINCT from a provider
 * that could not be reached.
 *
 * Unlike `/api/propose`, which searches slot by slot and can lose one slot to
 * a bad reply while keeping the rest, extraction asks for a whole key group at
 * once: a reply that will not parse costs that group and, since the groups run
 * in sequence, the request. Reporting that as a 503 would tell the operator to
 * check their credential, and reporting it as a body full of `not-found` would
 * tell them the documents do not contain values nothing managed to read. So it
 * is its own status, with the run explicitly unchanged and a retry the obvious
 * next step.
 */
function defaultUnusable(error: unknown): Response {
  return Response.json(
    {
      error: "unusable-reply",
      message:
        "The model answered and the reply could not be used. Nothing in your " +
        "run has been changed; try again.",
      cause: error instanceof Error ? error.message : String(error),
    },
    { status: 502 },
  );
}

/** Shape-checks the body before a single token is spent on it. */
export function parseExtractBody(value: unknown): ExtractBody {
  const body = value as Partial<ExtractBody>;
  if (!body || typeof body !== "object") throw new Error("body is not an object");
  if (typeof body.runId !== "string" || body.runId === "") {
    throw new Error("runId is required");
  }
  if (!Array.isArray(body.pages)) throw new Error("pages must be an array");
  if (body.answered !== undefined) {
    if (!Array.isArray(body.answered) || !body.answered.every((k) => typeof k === "string")) {
      throw new Error("answered must be an array of fieldKeys");
    }
  }
  // The same page contract `/api/propose` enforces, in the same one copy --
  // see `src/lib/api/wire.ts`. Checked HERE, before the gate lets anything
  // spend the credential on it: the whole pipeline counts in lines, and a page
  // numbered any other way buys a full extraction and returns citations of
  // text that is not where they say it is.
  assertWirePages(body.pages as WirePage[]);
  return body as ExtractBody;
}

/**
 * THE ORDER IS THE POINT, and it is the same order `/api/propose` and
 * `/api/chat` use: the gate runs before the body is read and before anything
 * reaches `src/lib/model.ts`. Moving it after either would still return 401 to
 * an anonymous caller while letting them spend the credential first.
 */
export function createExtractHandler(deps: ExtractDeps) {
  const badRequest = deps.badRequest ?? defaultBadRequest;
  const unusable = deps.unusable ?? defaultUnusable;

  return async function POST(req: Request): Promise<Response> {
    // 1. AUTHORIZE. First, unconditionally, in the handler itself.
    const gate = await deps.gate();
    if (gate.response) return gate.response;

    // 2. Only then read and validate what the caller sent.
    let body: ExtractBody;
    try {
      body = parseExtractBody(await req.json());
    } catch (error) {
      return badRequest(error);
    }

    // 3. Only then spend the credential. A provider that could not be reached
    //    arrives here tagged; unwrap it so the 503 names the real cause rather
    //    than the wrapper. Anything else got an answer it could not use, which
    //    is a different thing and says so.
    try {
      return Response.json(await deps.extract(body));
    } catch (error) {
      if (error instanceof AskFailed) return deps.unreachable(error.reason);
      return unusable(error);
    }
  };
}
