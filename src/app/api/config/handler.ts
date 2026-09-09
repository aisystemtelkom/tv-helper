/**
 * `/api/config`: CHECKPOINT 2. Does the operator's own order-configuration
 * workbook agree with the scans the order was raised from?
 *
 * ## THE WORKBOOK BYTES NEVER REACH THIS ROUTE
 *
 * Said first because it is the thing most likely to be "fixed" by somebody
 * adding a file upload. The browser opens the `.xlsx` on the device with
 * `src/lib/xlsx/read.ts` over `jszip` and posts only each cell's TEXT and its
 * ADDRESS. No archive, no bytes, no filename contents. That is the same shape
 * `/api/propose` and `/api/extract` already have -- the render and the OCR
 * happen in the tab and only line text leaves it -- and it is what keeps the
 * client's "documents stay on the device" constraint true for a file type that
 * arrived after the constraint was written. `src/app/privacy/page.tsx` states
 * it to the operator in both languages, so a change here silently makes that
 * page a lie.
 *
 * The amended workbook is patched in the tab as well (`src/lib/xlsx/write.ts`),
 * out of the operator's own bytes, which never came here to be patched.
 *
 * ## ONE ROUTE, TWO JOBS
 *
 * INTERPRET ("what fields does this sheet hold?") and COMPARE ("what do the
 * scans say about each of them?") are one route because they are always spent
 * together on a first upload -- an operator who hands over a workbook pays for
 * both, and neither is separately gated, which is the same argument
 * `src/lib/cost.ts` makes for billing them to one `"config"` row. The second is
 * then spent ALONE on the one re-search, which is the whole reason `fields` is
 * a body key rather than something this route re-derives: re-interpreting the
 * sheet to re-search four fields would pay for the reading again and, worse,
 * would mint new `ConfigField.id`s and orphan every decision the operator had
 * already made against the old ones.
 *
 *   sheet present   interpret, then compare what was interpreted
 *   fields present  compare only, optionally as the one widened re-search
 *
 * Exactly one of the two, checked below. Both is a caller that has not decided
 * which job it wants; neither is a request with nothing to compare.
 *
 * ## WHAT IT COSTS
 *
 * The compare call carries the whole run's page listing, exactly as
 * `/api/extract`'s does: ~23k input tokens for the 29-page sample bundle and
 * proportionally more for the 151-page one. Interpretation carries a cell
 * listing instead, which is small. `MAX_FIELDS_PER_CALL` in
 * `src/lib/pipeline/config-compare.ts` chunks a workbook too large for one
 * reply, and EVERY CHUNK RE-SENDS THE PAGE LISTING -- so a 72-field workbook is
 * two copies of the bundle, not two small calls. `route.ts` logs every call and
 * the request's total the way `/api/propose` and `/api/extract` do.
 *
 * The control flow is separated from `route.ts` for the same reason every other
 * route here separates it: `src/app/api/config/config.test.mts` executes the
 * authorization gate, every validation below and the 502/503 split with no Next
 * runtime, no bundler and no credential.
 */

import type { ApiGate } from "@/lib/auth/guard";

// Relative, with explicit `.ts`, and never through the `@/` alias: this file is
// executed directly by `node --test` (see the note above), which resolves
// neither a bare alias nor an extensionless specifier.
import {
  AskFailed,
  assertRunGlobalIndexes,
  assertWirePages,
  guardAsk,
  type WirePage,
} from "../../../lib/api/wire.ts";
import type {
  CellRef,
  ConfigEntry,
  ConfigField,
} from "../../../lib/config/types.ts";
import type { Ask } from "../../../lib/pipeline/classify.ts";
import { compareToDocuments } from "../../../lib/pipeline/config-compare.ts";
import {
  interpretWorkbook,
  type UnusableField,
} from "../../../lib/pipeline/config-interpret.ts";
import {
  formatRef,
  isCellRef,
  parseRef,
  type Cell,
  type CellKind,
  type Sheet,
} from "../../../lib/xlsx/grid.ts";

/**
 * ONE WORKSHEET AS THE BROWSER SENDS IT: a `Sheet` with its index left off.
 *
 * `Sheet.byRef` is a `Map`, and a `Map` does not survive `JSON.stringify` -- it
 * serialises as `{}`. So it is not sent, and the wire type does not have it.
 *
 * IT IS REBUILT HERE RATHER THAN SENT IN SOME OTHER SHAPE, and that is the
 * point rather than a workaround. `byRef` is what every anti-fabrication check
 * in `src/lib/pipeline/config-interpret.ts` consults: whether a `labelRef` is a
 * cell that exists, whether it holds text, and whether the model's `label` is
 * really a substring of what is printed there. An index supplied by the caller
 * could disagree with the cells sitting beside it in the same body, and the
 * disagreement would be silent and total -- the listing the model reads comes
 * from `cells`, and the check on its answer would come from somewhere else.
 * Derived from `cells`, the two cannot come apart.
 *
 * `dimension`, `rows` and `cols` ARE sent and are checked against `cells` for
 * the same reason rather than trusted: `rows` and `cols` widen the window
 * `inSheet` accepts a `valueRef` in (see `BLANK_MARGIN`), so an inflated pair
 * would let a far-corner address the model invented resolve to "inside the
 * sheet", and all three are printed into the listing's header as facts about a
 * sheet nobody here can see.
 */
export type WireSheet = {
  name: string;
  /** Every non-empty cell, row-major, duplicated addresses kept. */
  cells: Cell[];
  dimension: string;
  rows: number;
  cols: number;
  merges: string[];
};

export type ConfigBody = {
  runId: string;
  pages: WirePage[];
  /** Present to INTERPRET: the workbook sheet, read on the device. */
  sheet?: WireSheet;
  /** Present to COMPARE only: fields already interpreted and stored. */
  fields?: ConfigField[];
  /** The one re-search. Compare only these fields, with the widened question. */
  retry?: boolean;
};

export type ConfigResult = {
  /** What the sheet holds. Present exactly when the request carried a `sheet`. */
  fields?: ConfigField[];
  /** What the model named and the grid refused. Same presence rule. */
  unusable?: UnusableField[];
  /** `Interpretation.note`, the one sentence an empty `fields` cannot say. */
  note?: string;
  entries: ConfigEntry[];
};

/**
 * How many cells one request may carry.
 *
 * A CEILING ON MEMORY, NOT A BUDGET, exactly as `MAX_PNG_BYTES` is at
 * `/api/ocr`: the body is parsed into memory before anything looks at it, and
 * on a shared Cloud Run container an unbounded array of objects is an OOM
 * shape that kills every other operator's in-flight request along with this
 * one.
 *
 * 20,000 against the real material: the three client workbooks read 2026-09-09
 * hold on the order of 140, 64 and 240 non-empty cells. It is also five times
 * `MAX_LISTING_CELLS`, which is the cap on what the model is actually shown --
 * so nothing above this number could change an answer even if it were
 * accepted. It would only be carried, parsed and held.
 */
export const MAX_WIRE_CELLS = 20_000;

/**
 * How many already-interpreted fields one compare request may carry.
 *
 * 500 IS `MAX_FIELDS` IN `src/lib/pipeline/config-interpret.ts`, deliberately
 * the same number: that stage refuses a reply naming more than 500 fields, so a
 * body carrying more than 500 did not come from it. Kept as its own constant
 * rather than imported because the two are the same number for different
 * reasons -- one bounds what a model may claim, this bounds what a caller may
 * post -- and a route that imported the model's cap would silently follow it
 * anywhere it moved.
 *
 * The largest real workbook interprets to about 72 fields.
 */
export const MAX_WIRE_FIELDS = 500;

/** The five `CellKind`s, as a runtime check on a closed union. */
const CELL_KINDS: readonly CellKind[] = [
  "text",
  "number",
  "date",
  "boolean",
  "formula",
];

/**
 * The wire sheet, checked and turned into the `Sheet` the pipeline reads.
 *
 * EVERY RULE HERE IS ABOUT SOMETHING THAT REACHES A PROMPT OR A CHECK ON ITS
 * ANSWER. This is not schema tidiness: `sheetListing` prints these fields into
 * the question, and `validateInterpretation` judges the reply against the same
 * values. A body whose cells and whose grid disagree buys a reading of one
 * sheet checked against another.
 */
export function assertWireSheet(value: unknown): asserts value is WireSheet {
  if (!value || typeof value !== "object") throw new Error("sheet is not an object");
  const sheet = value as Partial<WireSheet>;

  if (typeof sheet.name !== "string" || sheet.name === "") {
    throw new Error("sheet.name is required; it is stored on the order and named on screen");
  }
  if (!Array.isArray(sheet.cells)) throw new Error("sheet.cells must be an array");
  if (sheet.cells.length > MAX_WIRE_CELLS) {
    throw new Error(
      `sheet "${sheet.name}" carries ${sheet.cells.length} cells, past the ` +
        `${MAX_WIRE_CELLS}-cell ceiling. The model is shown at most ` +
        "MAX_LISTING_CELLS of them in any case, so a sheet this size is not a " +
        "sheet this checkpoint can say anything more about.",
    );
  }
  if (typeof sheet.dimension !== "string") {
    throw new Error("sheet.dimension must be a string");
  }
  if (!Array.isArray(sheet.merges) || sheet.merges.some((m) => typeof m !== "string")) {
    // Printed verbatim into the listing the model reads. A non-string prints as
    // "[object Object]" beside real merged ranges, which reads as a fact about
    // the sheet.
    throw new Error("sheet.merges must be an array of range strings");
  }
  if (sheet.merges.length > MAX_WIRE_CELLS) {
    throw new Error(
      `sheet "${sheet.name}" declares ${sheet.merges.length} merged ranges, ` +
        "which is more ranges than the cell ceiling allows cells",
    );
  }
  if (!Number.isInteger(sheet.rows) || (sheet.rows as number) < 0) {
    throw new Error("sheet.rows must be the highest 1-based row holding a cell, or 0");
  }
  if (!Number.isInteger(sheet.cols) || (sheet.cols as number) < 0) {
    throw new Error("sheet.cols must be the highest 1-based column holding a cell, or 0");
  }

  let rows = 0;
  let cols = 0;
  let previousRow = 0;
  let previousCol = 0;

  sheet.cells.forEach((cell, at) => {
    const where = `sheet.cells[${at}]`;
    if (!cell || typeof cell !== "object") throw new Error(`${where} is not an object`);

    if (!isCellRef(cell.ref)) {
      throw new Error(
        `${where}.ref is ${JSON.stringify(cell.ref)}, which is not a cell ` +
          "address. Every address in this request is checked against the grid " +
          "before a model answer citing it is believed, and there is no correct " +
          "guess for a malformed one.",
      );
    }
    // THE PAIR MUST AGREE WITH THE ADDRESS, because the two are read by
    // different consumers. `byRef` is rebuilt below from `ref`, and the
    // listing's own row grouping counts with `row`/`col`; a disagreeing pair
    // therefore puts a cell in one place in the question and another place in
    // the check on the answer, and neither of them complains.
    const at1 = parseRef(cell.ref);
    if (cell.row !== at1.row || cell.col !== at1.col) {
      throw new Error(
        `${where} says it is at row ${JSON.stringify(cell.row)} column ` +
          `${JSON.stringify(cell.col)} and its address ${cell.ref} says row ` +
          `${at1.row} column ${at1.col}`,
      );
    }
    if (typeof cell.text !== "string") {
      throw new Error(`${where}.text must be the cell's rendered text`);
    }
    if (cell.raw !== undefined && typeof cell.raw !== "string") {
      throw new Error(`${where}.raw must be the stored value as text, or absent`);
    }
    if (!CELL_KINDS.includes(cell.kind)) {
      // A CLOSED UNION, checked at the boundary. `kindTag` annotates every cell
      // whose kind is not `"text"`, so an unknown kind is printed into the
      // prompt as a parenthesised fact about that cell -- and the one kind that
      // changes what a reader should do with a value, `"date"`, is exactly the
      // one a wrong tag would hide.
      throw new Error(
        `${where}.kind is ${JSON.stringify(cell.kind)}; it is one of ` +
          CELL_KINDS.join(", "),
      );
    }

    // ROW-MAJOR, which is the order `Sheet.cells` is documented to be in and
    // the order `read.ts` sorts into. It is load-bearing twice: `sheetListing`
    // reads down the sheet the way a person does, and `byRef` keeps the FIRST
    // occurrence of a duplicated address in DOCUMENT order, so a reordered
    // array changes both the question and which of two cells the answer is
    // checked against.
    if (at1.row < previousRow || (at1.row === previousRow && at1.col < previousCol)) {
      throw new Error(
        `${where} is ${cell.ref}, which comes before ` +
          `${formatRef(previousCol, previousRow)} in the sheet. sheet.cells is ` +
          "row-major.",
      );
    }
    previousRow = at1.row;
    previousCol = at1.col;

    if (at1.row > rows) rows = at1.row;
    if (at1.col > cols) cols = at1.col;
  });

  // DERIVED AND COMPARED, never overwritten. `rows` and `cols` grow the window
  // `inSheet` will accept a `valueRef` in, so an inflated pair is how an
  // invented far-corner address becomes "inside the sheet" and reaches an
  // operator as an ordinary recommendation. Silently replacing them with the
  // derived pair would be its own quiet failure: the caller believes it sent a
  // sheet, and which of the two halves of its body is the true one is not
  // knowable here.
  if (sheet.rows !== rows || sheet.cols !== cols) {
    throw new Error(
      `sheet "${sheet.name}" declares ${sheet.rows} rows and ${sheet.cols} ` +
        `columns and its cells reach row ${rows}, column ${cols}. They must ` +
        "agree: the pair widens which addresses a model answer may name.",
    );
  }
  const dimension = sheet.cells.length === 0 ? "" : `A1:${formatRef(cols, rows)}`;
  if (sheet.dimension !== dimension) {
    throw new Error(
      `sheet "${sheet.name}" declares dimension ${JSON.stringify(sheet.dimension)} ` +
        `and its cells reach ${JSON.stringify(dimension)}. The dimension is the ` +
        "extent of the NON-EMPTY cells, not the worksheet's own declared grid.",
    );
  }
}

/**
 * The wire sheet as a `Sheet`, with `byRef` built from the cells themselves.
 *
 * First occurrence per address wins, which is `read.ts`'s own rule and is not
 * arbitrary: a workbook can carry two cells claiming one address, and the
 * patcher's verification counts occurrences to catch exactly that. Taking the
 * LAST one here would read back an appended duplicate's value and make a
 * damaged sheet look clean.
 */
export function toSheet(wire: WireSheet): Sheet {
  const byRef = new Map<CellRef, Cell>();
  for (const cell of wire.cells) if (!byRef.has(cell.ref)) byRef.set(cell.ref, cell);

  return {
    name: wire.name,
    cells: wire.cells,
    byRef,
    dimension: wire.dimension,
    rows: wire.rows,
    cols: wire.cols,
    merges: wire.merges,
  };
}

/**
 * A stored field list, checked before it is compared against anything.
 *
 * ONE COPY, SHARED WITH `/api/epic`, for the reason `src/lib/api/wire.ts`
 * states about `assertWirePages`: two copies of a validator are two validators
 * that can disagree, and the disagreement is silent -- the route with the
 * weaker copy spends the credential on fields the other one would have refused.
 * It lives here because this is the route that MINTS these fields; Checkpoint 3
 * borrows the same list to judge EPIC against.
 *
 * `id` IS THE LOAD-BEARING ONE. `foldCompareReply` and `foldEpicReply` both key
 * the model's answers by it and both return one entry per input field, and the
 * operator's decisions are stored against it. Two fields sharing an id take one
 * answer between them and one decision between them, which is a wrong
 * recommendation shown against a field nobody judged.
 */
export function assertConfigFields(value: unknown): asserts value is ConfigField[] {
  if (!Array.isArray(value)) throw new Error("fields must be an array");
  if (value.length > MAX_WIRE_FIELDS) {
    throw new Error(
      `fields carries ${value.length} entries, past the ${MAX_WIRE_FIELDS} ` +
        "ceiling. The interpretation stage refuses a reply naming more than " +
        "that, so a list this long did not come from it.",
    );
  }

  const seen = new Set<string>();
  value.forEach((field, at) => {
    const where = `fields[${at}]`;
    if (!field || typeof field !== "object") throw new Error(`${where} is not an object`);
    const one = field as Partial<ConfigField>;

    if (typeof one.id !== "string" || one.id === "") {
      throw new Error(`${where}.id is required; every answer and every decision is keyed by it`);
    }
    if (seen.has(one.id)) {
      throw new Error(
        `${where}.id ${JSON.stringify(one.id)} is used by an earlier field. ` +
          "Two fields sharing an id share the model's answer and the " +
          "operator's decision between them.",
      );
    }
    seen.add(one.id);

    if (typeof one.sheet !== "string" || one.sheet === "") {
      throw new Error(`${where}.sheet is required; an edit is addressed sheet-and-cell`);
    }
    if (typeof one.label !== "string" || one.label.trim() === "") {
      throw new Error(
        `${where}.label is required; it is what the row is called on screen ` +
          "and in the question, and a blank one is a decision the operator " +
          "cannot identify",
      );
    }
    // Checked even though this route never writes a cell: a field carrying an
    // address the grid could not hold did not come from `interpretWorkbook`,
    // which refuses one, and the workbook patcher downstream will be handed
    // exactly these two addresses.
    if (!isCellRef(one.labelRef)) {
      throw new Error(`${where}.labelRef is ${JSON.stringify(one.labelRef)}, not a cell address`);
    }
    if (!isCellRef(one.valueRef)) {
      throw new Error(`${where}.valueRef is ${JSON.stringify(one.valueRef)}, not a cell address`);
    }
    if (typeof one.excelValue !== "string") {
      throw new Error(
        `${where}.excelValue must be the cell's text, and "" for an empty ` +
          "cell. An empty cell is a real state and is the case this checkpoint " +
          "exists to fill.",
      );
    }
    if (one.group !== undefined && typeof one.group !== "string") {
      throw new Error(`${where}.group must be the row's own identifying value, or absent`);
    }
  });
}

/** Shape-checks the body before a single token is spent on it. */
export function parseConfigBody(value: unknown): ConfigBody {
  const body = value as Partial<ConfigBody>;
  if (!body || typeof body !== "object") throw new Error("body is not an object");
  if (typeof body.runId !== "string" || body.runId === "") {
    throw new Error("runId is required");
  }
  if (!Array.isArray(body.pages)) throw new Error("pages must be an array");
  // The same page contract `/api/propose` and `/api/extract` enforce, from the
  // same one copy in `src/lib/api/wire.ts`, and checked here for the same
  // reason: the comparison cites a page and a line range out of this listing,
  // and a page numbered any other way buys a full comparison and returns
  // citations of text that is not where they say it is.
  assertWirePages(body.pages as WirePage[]);

  // EXACTLY ONE JOB PER REQUEST. Both is a caller that has not decided whether
  // it is re-reading the workbook or re-searching the scans, and the two mint
  // different `ConfigField.id`s -- answering it with an interpretation would
  // orphan every decision already made against the ids it also sent. Neither is
  // a request with nothing to compare, which would come back as an empty
  // `entries` array reading exactly like a workbook with no fields in it.
  const hasSheet = body.sheet !== undefined;
  const hasFields = body.fields !== undefined;
  if (hasSheet === hasFields) {
    throw new Error(
      hasSheet
        ? "send either sheet (to interpret the workbook) or fields (to compare " +
          "an interpretation that already exists), never both"
        : "send either sheet (to interpret the workbook) or fields (to compare " +
          "an interpretation that already exists); this request carries neither",
    );
  }

  if (hasSheet) assertWireSheet(body.sheet);
  if (hasFields) assertConfigFields(body.fields);

  if (body.retry !== undefined) {
    if (typeof body.retry !== "boolean") {
      throw new Error("retry is true, false, or absent");
    }
    // `retry` WIDENS THE QUESTION OVER FIELDS THAT CAME BACK NOT-FOUND, so it
    // is only meaningful beside a field list the caller has already had
    // verdicts for. Beside a sheet there are no verdicts yet: the whole
    // workbook would be asked the second-pass question on its first pass, and
    // the operator's one re-search would be spent before they had seen a
    // result to re-search from.
    if (hasSheet && body.retry) {
      throw new Error(
        "retry is the one re-search over fields whose verdict was " +
          "tidak-ditemukan, so it cannot accompany a sheet that has not been " +
          "interpreted or compared yet",
      );
    }
  }

  return body as ConfigBody;
}

/**
 * The checkpoint itself: interpret if asked, then compare.
 *
 * `mintId` is injected so the suite can predict a `ConfigField.id` and assert
 * about a decision keyed by one, exactly as `validateInterpretation` takes it
 * for the same reason. In production it is `crypto.randomUUID`.
 */
export async function checkConfig(
  body: ConfigBody,
  rawAsk: Ask,
  mintId: () => string = () => crypto.randomUUID(),
): Promise<ConfigResult> {
  // Over the FULL array, before anything is filtered out of it: `index` is the
  // page's position in `run.pages`, and that is only checkable against the
  // run-global list.
  assertRunGlobalIndexes(body.pages);

  /**
   * THE PAGES THE MODEL MAY BE ASKED ABOUT. See `WirePage.searchable`.
   *
   * ON THE FLAG, NEVER ON `lines.length`. An empty page is a page the
   * recogniser found no text on, which is a fact about the document; an
   * excluded page is a decision the operator took when they marked a berkas
   * "tanpa AI". Filtering on emptiness would search a berkas they fenced off as
   * soon as it had text on it, and this route is the quiet half of that choice
   * -- a value read out of a fenced document arrives as an ordinary
   * recommendation the operator accepts into their own workbook.
   *
   * When that leaves nothing, `compareToDocuments` answers every field with
   * `tidak-ditemukan` carrying its own `NOTHING_SEARCHABLE` reason naming the
   * fence. That is the stage's decision and its header argues it: the verdict
   * union has no member for "nothing was read", and the reason is what tells
   * the operator whether to fetch a document or lift a fence. Do not add a
   * branch here that answers it differently.
   */
  const searchable = body.pages.filter((page) => page.searchable !== false);

  // Every model call goes through the tagged wrapper, so a provider failure
  // cannot be reported as a field that was searched and not found -- the
  // recorded 200-with-every-slot-outstanding failure `src/lib/api/wire.ts`
  // exists to prevent.
  const ask = guardAsk(rawAsk);

  if (body.sheet !== undefined) {
    const interpretation = await interpretWorkbook({
      sheet: toSheet(body.sheet),
      ask,
      mintId,
    });

    // COMPARED IMMEDIATELY, against what was just interpreted rather than
    // against what the caller sent: the fields the operator will rule on are
    // the ones that survived validation, and re-posting them to be compared
    // would be a second request that could carry a different list.
    const entries = await compareToDocuments({
      fields: interpretation.fields,
      pages: searchable,
      ask,
    });

    return {
      fields: interpretation.fields,
      unusable: interpretation.unusable,
      // ALWAYS, INCLUDING WHEN THE LIST IS EMPTY. "No fields" has several
      // completely different causes -- a blank sheet, a model that named none,
      // a model that named twenty and cited a cell for none of them -- and an
      // empty array cannot tell them apart.
      note: interpretation.note,
      entries,
    };
  }

  const entries = await compareToDocuments({
    fields: body.fields ?? [],
    pages: searchable,
    ask,
    retry: body.retry === true,
  });

  return { entries };
}

export type ConfigDeps = {
  /** The authorization gate. `requireApiUser` in production. */
  gate: () => Promise<ApiGate>;
  /** The model calls. Only reached once `gate` has admitted the caller. */
  check: (body: ConfigBody) => Promise<ConfigResult>;
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
      message: "The request body is not a valid konfigurasi check.",
      cause: error instanceof Error ? error.message : String(error),
    },
    { status: 400 },
  );
}

/**
 * A reply that arrived and could not be parsed, kept DISTINCT from a provider
 * that could not be reached.
 *
 * The two failures this route can have look identical from a `catch` and are
 * nothing alike to an operator. A 503 says check the credential; this says the
 * model answered nonsense and the same request is worth making again. Reporting
 * either one as a 200 full of `tidak-ditemukan` would be the third and worst
 * option: `tidak-ditemukan` means SEARCHED AND NOT FOUND everywhere in this
 * product, and it is what sends an operator to hunt for another document.
 */
function defaultUnusable(error: unknown): Response {
  return Response.json(
    {
      error: "unusable-reply",
      message:
        "The model answered and the reply could not be used. Nothing in your " +
        "order has been changed; try again.",
      cause: error instanceof Error ? error.message : String(error),
    },
    { status: 502 },
  );
}

/**
 * THE ORDER IS THE POINT, and it is the order every route here uses: the gate
 * runs before the body is read and before anything reaches
 * `src/lib/model.ts`. Moving it after either would still return 401 to an
 * anonymous caller while letting them spend the credential first.
 */
export function createConfigHandler(deps: ConfigDeps) {
  const badRequest = deps.badRequest ?? defaultBadRequest;
  const unusable = deps.unusable ?? defaultUnusable;

  return async function POST(req: Request): Promise<Response> {
    // 1. AUTHORIZE. First, unconditionally, in the handler itself. `src/proxy.ts`
    //    would also refuse an anonymous caller, but proxy is an optimization and
    //    not the boundary -- see the note at the top of that file.
    const gate = await deps.gate();
    if (gate.response) return gate.response;

    // 2. Only then read and validate what the caller sent.
    let body: ConfigBody;
    try {
      body = parseConfigBody(await req.json());
    } catch (error) {
      return badRequest(error);
    }

    // 3. Only then spend the credential. A provider that could not be reached
    //    arrives here tagged; unwrap it so the 503 names the real cause rather
    //    than the wrapper. Anything else got an answer it could not use, which
    //    is a different thing and says so.
    try {
      return Response.json(await deps.check(body));
    } catch (error) {
      if (error instanceof AskFailed) return deps.unreachable(error.reason);
      return unusable(error);
    }
  };
}
