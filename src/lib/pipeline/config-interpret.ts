/**
 * READING THE OPERATOR'S OWN WORKBOOK: which of its cells are fields?
 *
 * Checkpoint 2 checks an EPIC order-configuration workbook against the scans.
 * Before anything can be compared, something has to say what the workbook
 * CONTAINS -- which cell names a field and which cell holds that field's value
 * -- and nothing in the file says so. There is no schema, no named range and no
 * convention: the client's instruction of 2026-09-09 is *"STRUKTUR EXCEL
 * RANDOM"*, per contract it can differ wildly, table headers on top, on the
 * side, or whatever. So this stage asks.
 *
 * The three real workbooks read on 2026-09-09 are laid out three different
 * ways, which is the whole reason the question is put to a model at all:
 * labels down one column with values in a neighbouring one; a header row of
 * field names with one data row per service under it; and a transposed sheet
 * where the field names run ACROSS the columns and each data ROW is a service.
 * Nothing here hard-codes any of the three, and nothing should.
 *
 * ## Modelled on `./sections.ts`, deliberately and to the letter
 *
 * An injected `Ask = (prompt: string) => Promise<string>`, a zod schema,
 * `extractJson` from `./json.ts`, validation AFTER the parse, every refused
 * entry landing in `unusable` with a reason, and NO IMAGE PARAMETER anywhere.
 * That last absence is load-bearing: AGENTS.md's claim that the reasoning
 * stages are "provably text-only" is checked by reading the signatures in
 * `src/lib/pipeline/`, and this stage extends the claim unchanged rather than
 * putting a hole in it. A workbook is text; there is nothing to look at.
 *
 * ## THE MODEL ANSWERS WITH AN ADDRESS, NEVER WITH A VALUE
 *
 * This is `./locate.ts`'s rule wearing different clothes. There the model is
 * shown numbered OCR lines and answers with a LINE RANGE, never a pixel box,
 * because the rectangle is then the union of real glyph boxes and the model
 * only does the semantic step. Here it is shown the sheet's real cells with
 * their real addresses and answers with a CELL ADDRESS; the value is then read
 * out of the grid by this module. A model that misreads a number cannot put
 * that number in front of an operator, because it is never asked for one.
 *
 * Every address that comes back is checked against the grid before it is
 * trusted, and `label` must be a substring of the text actually standing at
 * `labelRef` -- the same anti-fabrication rule `./sections.ts` applies to a
 * judul title, for the same reason. An invented field name is a row an
 * operator rules on, believing the workbook asked for it.
 *
 * ## AN EMPTY VALUE CELL IS A FIELD, NOT A REJECT
 *
 * The single easiest rule here to "tighten" into a bug. A `valueRef` naming a
 * cell that holds nothing is absent from `Sheet.byRef` entirely, because the
 * reader keeps only non-empty cells -- and an empty cell EPIC expects filled is
 * exactly what Checkpoint 2 exists to fill from the scans. So a `valueRef` is
 * required to be an ADDRESS INSIDE THE SHEET and is NOT required to be a cell
 * that exists. A `labelRef` is the opposite: an empty cell has no field name
 * standing in it to have been read, so it must be a real, non-blank cell.
 *
 * ## THE ENVELOPE THROWS; ONE ENTRY DOES NOT
 *
 * A reply with no JSON in it, or one whose `fields` is not an array, throws --
 * `extractJson`'s own line, and `classifyPages`' and `discoverSections`': an
 * ambiguous reply fails loudly at the boundary rather than reaching code that
 * will do its best with it, because "no fields" and "unreadable reply" are
 * different statements and a caller holding an empty array cannot tell them
 * apart. A reply that parses and says something untrue about ONE entry does not
 * throw: the largest of the three real workbooks holds 72 fields, and one
 * fabricated label is no reason to lose the other 71.
 */

import { z } from "zod";

import type { CellRef, ConfigField } from "../config/types.ts";
import { formatRef, isCellRef, parseRef, type Sheet } from "../xlsx/grid.ts";
import { listingTruncation, sheetListing } from "../xlsx/listing.ts";
import type { Ask } from "./classify.ts";
import { extractJson } from "./json.ts";

/** One field the model named and this module refused, with why. */
export type UnusableField = {
  /** What the model called it, so a log names something a person can find. */
  label: string;
  /** Echoed back exactly as the model wrote them, malformed ones included. */
  labelRef?: string;
  valueRef?: string;
  reason: string;
};

export type Interpretation = {
  fields: ConfigField[];
  unusable: UnusableField[];
  /**
   * ONE SENTENCE, ALWAYS, INCLUDING WHEN THE LIST IS EMPTY.
   *
   * English and deployer-facing, like every other string in
   * `src/lib/pipeline/`. It exists for the reason `SectionDiscovery.note`
   * does: "no fields" has several completely different causes -- the sheet is
   * blank, the model named none, the model named twenty and every one of them
   * cited a cell that is not there -- and an empty array cannot tell them
   * apart. It also carries the one fact the arrays cannot: whether the listing
   * the model read was the whole sheet.
   */
  note: string;
};

/**
 * How many fields one reply may name.
 *
 * Measured rather than guessed: the largest of the three real workbooks is the
 * transposed one, 36 field names across columns E..AN against two data rows,
 * so 72 fields. 500 is seven times that and still refuses a reply that has
 * stopped describing a worksheet and started emitting cells.
 */
const MAX_FIELDS = 500;

/**
 * The longest `label` a reply may carry.
 *
 * A backstop on the reply's size rather than on the sheet's: the substring
 * rule below already bounds a label by the text of the cell it cites, and a
 * cell holding a paragraph of instructions is a cell this stage should not be
 * calling a field in the first place.
 */
const MAX_LABEL = 200;

/** A row's identifying value, not a description of the row. */
const MAX_GROUP = 120;

/**
 * How far past the last non-empty cell a `valueRef` may still sit.
 *
 * `Sheet.dimension` IS THE EXTENT OF THE NON-EMPTY CELLS, not the worksheet's
 * own declared grid -- `read.ts` computes it from what it actually read rather
 * than trusting the file's `<dimension>` element, which producers overstate.
 * That is right for a listing and wrong as a hard bound HERE, and the
 * difference bites exactly on the cells this stage exists to find.
 *
 * Measured against the three real workbooks of 2026-09-09, imagining each of
 * them handed over with its data area still blank, which is an ordinary thing
 * for a fresh order:
 *
 *   labels down a column, values one column over   values 2 columns past the
 *                                                  labels (row 1's header
 *                                                  covers it anyway)
 *   header row of field names, data rows beneath   data 2 rows past the header
 *   transposed, field names across, data rows      data 2 rows past the names
 *
 * So a bound at the extent would refuse EVERY field of two of the three, each
 * with "outside the sheet" as its reason, on a workbook whose only fault is
 * that nobody has filled it in yet. Eight is four times the largest of those
 * and still refuses an invented far-corner address by three orders of
 * magnitude; `ZZ999` is not reachable from any of these sheets.
 *
 * It does NOT apply to `labelRef`, which has to be a cell that really holds
 * text and is checked against `byRef` instead.
 */
const BLANK_MARGIN = 8;

/** What an entry that named no field at all is called in the refusal list. */
const UNNAMED = "(the entry named no field)";

const Envelope = z.object({ fields: z.array(z.unknown()).max(MAX_FIELDS) });

/**
 * One entry, checked for SHAPE only. Everything true about the sheet is
 * checked below, against the sheet, where a failure can name what is really
 * there.
 *
 * `group` is `nullish` rather than `optional` because a model asked for a key
 * "only when the sheet holds more than one data row" answers `null` often
 * enough, and that is packaging, not content: it means the same thing as
 * leaving the key out. `extractJson` draws the same line -- recover from
 * packaging, never from content -- and refusing an otherwise perfect field
 * over a `null` would be recovering from neither.
 */
const Field = z.object({
  label: z.string().min(1).max(MAX_LABEL),
  labelRef: z.string(),
  valueRef: z.string(),
  group: z.string().max(MAX_GROUP).nullish(),
});

/**
 * THE QUESTION LEADS AND THE LISTING FOLLOWS.
 *
 * The ordering the prefix-cache work concluded on, and it is not a matter of
 * taste. Reordering `locate` so its listing led earned Gemini's ~90% prefix
 * discount on 122k tokens a run and turned `KB / Nomor` from an intermittent
 * failure into a certain one in every one of the three arrangements tried. See
 * "## The prefix-cache experiment" in `./locate.ts`'s header before moving
 * these two blocks; `./sections.ts` follows the same rule for the same reason.
 */
export function buildInterpretPrompt(sheet: Sheet): string {
  const listing = sheetListing(sheet);
  const cut = listingTruncation(sheet);

  return [
    "Below is one worksheet of an order-configuration workbook, cell by cell,",
    "each cell with its own address. List the fields this sheet holds. For",
    "each field name the cell that NAMES it and the cell that HOLDS ITS VALUE.",
    "Reply with JSON only.",
    "",
    "THE LAYOUT IS UNKNOWN AND YOU MUST NOT ASSUME ONE. These workbooks are",
    "written differently for every contract, and none of the shapes below is",
    "the usual one. It may be any of:",
    "  - field names down one column, each value in a neighbouring column;",
    "  - a header row of field names, with one data row per service beneath it;",
    "  - transposed: the field names running ACROSS the columns, and each data",
    "    ROW one service.",
    "It may also be none of these. Read the listing and decide which it is.",
    "",
    "Rules:",
    "  - `labelRef` must be an address that appears in the listing below. It is",
    "    where the field's name is printed. Never answer with a cell you cannot",
    "    see, and never invent an address.",
    "  - `label` must be copied verbatim from the cell at `labelRef`. It is a",
    "    quotation, not a description and not a tidied-up version of one.",
    "  - `valueRef` is the cell the value goes in. It MAY be a cell that is",
    "    empty, and therefore absent from the listing, as long as its address",
    "    is inside this sheet: an empty cell that ought to be filled is exactly",
    "    what this is looking for.",
    "  - `valueRef` must never equal `labelRef`, and it must never be the",
    "    `labelRef` of another field.",
    "  - Two fields must never name the same `valueRef`.",
    "  - A title over the whole table, a note, an instruction, a legend and a",
    "    column of row numbers are not fields. Leave them out.",
    "",
    "WHEN THE SHEET HOLDS MORE THAN ONE DATA ROW, every field must carry",
    "`group`: that row's own identifying value as printed on the row itself, a",
    "service id or a location name. Never a row number, never a position,",
    "never an index. The same field name appears once per row, and `group` is",
    "the only thing that tells an operator which service each one belongs to.",
    "Omit `group` when the sheet holds a single data row.",
    "",
    '{"fields":[{"label":"Nama Pelanggan","labelRef":"C9","valueRef":"E9"},' +
      '{"label":"Alamat Instalasi","labelRef":"H4","valueRef":"H6",' +
      '"group":"1209990001"}]}',
    "",
    ...(cut
      ? [
          // SAID OUT LOUD rather than silently handing over a part of the
          // sheet as though it were the sheet. A model that believes it has
          // seen everything answers about what it was given; one told the
          // listing was cut short can at least stop at the edge of it.
          //
          // THE CAUSE COMES FROM `listingTruncation`, not from a sentence
          // written here. This named the cell cap unconditionally, so a sheet
          // whose MERGES were the thing cut was handed a prompt contradicting
          // its own listing, which prints the honest merge count a few lines
          // below.
          `The listing below is not the whole sheet: ${cut}.`,
          "",
        ]
      : []),
    listing,
  ].join("\n");
}

/**
 * Case-folded and whitespace-collapsed, and nothing else.
 *
 * DELIBERATELY THE SAME RULE AS `fold` IN `./sections.ts`, which is private
 * there; if either is ever loosened the other has to move with it, because
 * they are one anti-fabrication rule applied to two kinds of quotation. Not
 * punctuation-stripped and not accent-folded: every tolerance added here is a
 * class of invention the rule stops catching. Case and whitespace are
 * packaging -- a field name printed as "NAMA  PELANGGAN" across a merged cell
 * is the same field name -- which is exactly the line `extractJson` draws.
 */
function fold(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * An address, or `null` if the model did not write one.
 *
 * The `try` is not superstition. `isCellRef` and `parseRef` are one module's
 * two answers to the same question, and this function's whole job is to refuse
 * informatively: a disagreement between them must cost one entry a reason, not
 * throw a `TypeError` out of a validator and take the other seventy-one fields
 * down with it. `./sections.ts` orders its bounds check before its page walk
 * for exactly this reason.
 */
function address(ref: unknown): { col: number; row: number } | null {
  if (!isCellRef(ref)) return null;
  try {
    return parseRef(ref);
  } catch {
    return null;
  }
}

/**
 * Is this address one this sheet could plausibly hold?
 *
 * A cell the sheet actually HOLDS is inside it, always. Everything else is
 * judged against the extent of the non-empty cells grown by `BLANK_MARGIN`,
 * which is what lets an EMPTY `valueRef` be accepted at all: an empty cell is
 * in no map to be found in, and on a workbook nobody has filled in yet the
 * whole data area sits past the last cell carrying text.
 */
function inSheet(sheet: Sheet, ref: CellRef, at: { col: number; row: number }) {
  if (sheet.byRef.has(ref)) return true;
  return (
    at.col >= 1 &&
    at.col <= sheet.cols + BLANK_MARGIN &&
    at.row >= 1 &&
    at.row <= sheet.rows + BLANK_MARGIN
  );
}

/**
 * The merge that COVERS `at` without `at` being its own top-left cell.
 *
 * Excel reads and writes a merged range through its ANCHOR and never displays
 * a covered cell, so a value written to one is invisible in the workbook and is
 * dropped the next time it is saved. A covered cell is also EMPTY in the file,
 * which is why nothing above catches it: it is absent from `byRef`, and the
 * `BLANK_MARGIN` rule that lets a legitimately empty value cell through lets
 * this one through with it.
 *
 * `sheet.merges` are free strings off the wire, so a range this cannot parse is
 * SKIPPED rather than thrown on. One producer's quirk must not cost the other
 * seventy-one fields, which is the same proportionality `validateInterpretation`
 * applies to a single malformed entry.
 */
function coveredCell(
  sheet: Sheet,
  at: { col: number; row: number },
): { range: string; anchor: CellRef } | null {
  for (const range of sheet.merges) {
    const [from, to] = range.split(":");
    if (!isCellRef(from) || !isCellRef(to)) continue;

    const a = parseRef(from);
    const b = parseRef(to);
    const left = Math.min(a.col, b.col);
    const right = Math.max(a.col, b.col);
    const top = Math.min(a.row, b.row);
    const bottom = Math.max(a.row, b.row);

    if (at.col < left || at.col > right || at.row < top || at.row > bottom) {
      continue;
    }
    // The anchor itself is a perfectly good value cell.
    if (at.col === left && at.row === top) continue;
    return { range, anchor: formatRef(left, top) };
  }
  return null;
}

/**
 * How the sheet's own reach is described in a refusal.
 *
 * It names the allowance as well as the extent, because "outside sheet
 * (A1:E35)" beside an answer of `E36` reads as an off-by-one in this code
 * rather than as an address the model invented.
 */
function extentOf(sheet: Sheet): string {
  if (sheet.rows < 1 || sheet.cols < 1) return "it has no non-empty cell";
  return (
    `its non-empty cells reach ${formatRef(sheet.cols, sheet.rows)}, and a ` +
    `value cell may sit up to ${BLANK_MARGIN} rows and columns past that`
  );
}

/** Whatever of the entry can be shown to a person, however malformed it is. */
function reported(entry: unknown): Omit<UnusableField, "reason"> {
  const record =
    typeof entry === "object" && entry !== null
      ? (entry as Record<string, unknown>)
      : {};
  const str = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : undefined;
  const label = str("label")?.trim();
  return {
    label: label !== undefined && label.length > 0 ? label : UNNAMED,
    labelRef: str("labelRef"),
    valueRef: str("valueRef"),
  };
}

/**
 * One entry, checked against the sheet it claims. `null` means it survives.
 *
 * CHECKED, NEVER TRUSTED, and every rule below is here because the reply that
 * breaks it produces a specific wrong-and-quiet outcome rather than a crash:
 * a field name nobody wrote, a recommendation aimed at a cell that is not
 * there, or an edit that lands on top of something the operator needs.
 */
function refuse(
  field: z.infer<typeof Field>,
  sheet: Sheet,
  /** `valueRef` -> the label of the field that claimed it first. */
  claimed: Map<CellRef, string>,
): string | null {
  const labelAt = address(field.labelRef);
  if (labelAt === null) {
    return `labelRef "${field.labelRef}" is not a cell address`;
  }
  const valueAt = address(field.valueRef);
  if (valueAt === null) {
    return `valueRef "${field.valueRef}" is not a cell address`;
  }

  if (!inSheet(sheet, field.labelRef, labelAt)) {
    return (
      `labelRef ${field.labelRef} is outside sheet "${sheet.name}": ` +
      extentOf(sheet)
    );
  }

  // A LABEL CELL MUST REALLY HOLD TEXT, where a value cell need not. There is
  // no field name standing in an empty cell to have been read, so a reply
  // citing one has described the field rather than quoted it -- the same
  // failure as the substring rule below, caught one step earlier and with a
  // reason that says which step it failed at.
  const labelCell = sheet.byRef.get(field.labelRef);
  if (labelCell === undefined || labelCell.text.trim().length === 0) {
    return (
      `labelRef ${field.labelRef} is empty on sheet "${sheet.name}", so there ` +
      "is no field name standing there to have been read"
    );
  }

  if (!inSheet(sheet, field.valueRef, valueAt)) {
    return (
      `valueRef ${field.valueRef} is outside sheet "${sheet.name}", so there ` +
      `is no cell to fill: ${extentOf(sheet)}`
    );
  }

  // A COVERED CELL OF A MERGE IS A CELL EXCEL NEVER SHOWS, so an approved edit
  // written there is a change that silently does not happen -- and is then
  // discarded by the next save. Every other layer would report success: the
  // address parses, it is inside the sheet, `patchWorkbook` writes it, and
  // `verifyPatchedSheet` reads back exactly the intended text. This is the
  // same category of structurally invalid address as a `valueRef` standing on
  // another field's name, and it is refused for the same stated reason: the
  // cost of the rule is a row the operator does not see, and the cost of not
  // having it is a workbook nobody can tell was damaged.
  //
  // REFUSED, NOT REMAPPED TO THE ANCHOR. When the merge is a LABEL's
  // (`C9:E9`), its anchor is the labelRef, so a helpful remap would quietly
  // redirect the operator's decision onto the field's own name.
  const covered = coveredCell(sheet, valueAt);
  if (covered !== null) {
    return (
      `valueRef ${field.valueRef} is inside merged range ${covered.range} but ` +
      `is not its top-left cell ${covered.anchor}, so Excel would never show ` +
      "a value written there"
    );
  }

  if (field.valueRef === field.labelRef) {
    return (
      `valueRef and labelRef are both ${field.labelRef}; accepting the ` +
      "recommendation would overwrite the field's own name with its value"
    );
  }

  // AN EMPTY LABEL IS REFUSED BEFORE THE SUBSTRING RULE, because the substring
  // rule cannot refuse it: `"anything".includes("")` is true, so a label of one
  // space satisfies the one check standing between a fabricated field name and
  // the operator. `z.string().min(1)` does not catch it either -- `" "` is one
  // character -- and `fold` then trims it to nothing. What reaches the screen
  // is a row with no name at all, which the operator has to rule on without
  // being told what it is.
  if (fold(field.label) === "") {
    return "the label is blank, so there is nothing to check against the cell";
  }

  // THE LABEL MUST BE IN THE CELL IT CITES. `./sections.ts` applies this to a
  // judul title and this project has no other defence against either: an
  // invented field name reaches the operator as an ordinary row, they rule on
  // it, and the decision is written into their own workbook. It is also what
  // makes storing the MODEL's wording safe rather than the cell's -- a label
  // that passes can only ever be a slice of what is really printed there.
  if (!fold(labelCell.text).includes(fold(field.label))) {
    return (
      `the label is not in ${field.labelRef}, which reads ` +
      `"${labelCell.text.trim()}", so it was described rather than read`
    );
  }

  // TWO FIELDS, ONE VALUE CELL: THE SECOND ONE GOES, NOT BOTH.
  //
  // A deliberate departure from `refuseOverlaps` in `./sections.ts`, which
  // drops both members of an overlapping pair because which heading the shared
  // page belongs under is precisely what the model got wrong and argument
  // order is not evidence about it. Here the two entries do not disagree about
  // anything: they name the same cell, so they are the same field named twice,
  // and dropping both would leave that cell CHECKED BY NOTHING while the
  // operator's summary counted a full sheet. What must not survive is the
  // pair: `pendingEdits` would emit two `CellEdit`s for one address, and two
  // recommendations aimed at one cell can be contradictory and are applied by
  // arrival order.
  const first = claimed.get(field.valueRef);
  if (first !== undefined) {
    return (
      `valueRef ${field.valueRef} is already the value cell of "${first}"; ` +
      "one cell cannot hold two fields"
    );
  }

  return null;
}

/**
 * THE WHOLE VALIDATION, PURE AND SEPARATELY TESTABLE.
 *
 * Takes the reply already parsed out of the model's text, so every rule here
 * is drivable with a hand-built sheet and a hand-built object and the suite
 * needs no model, no credential and no network.
 *
 * `mintId` is injected for the same reason: `ConfigField.id` is the key every
 * later decision hangs off, so a test that cannot predict it cannot assert
 * about a decision either. An id is minted ONLY for a field that survives, so
 * a caller counting with a counter gets a dense list and a refused entry
 * leaves no hole in it.
 *
 * THROWS only when the reply is not a reply; see the header.
 */
export function validateInterpretation(
  sheet: Sheet,
  reply: unknown,
  mintId: () => string,
): Interpretation {
  const envelope = Envelope.parse(reply);

  const fields: ConfigField[] = [];
  const unusable: UnusableField[] = [];
  const claimed = new Map<CellRef, string>();

  for (const entry of envelope.fields) {
    const shape = Field.safeParse(entry);
    if (!shape.success) {
      unusable.push({
        ...reported(entry),
        reason:
          "the entry is not a field: " +
          shape.error.issues
            .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
            .join("; "),
      });
      continue;
    }

    const field = shape.data;
    const reason = refuse(field, sheet, claimed);
    if (reason !== null) {
      unusable.push({
        label: field.label.trim(),
        labelRef: field.labelRef,
        valueRef: field.valueRef,
        reason,
      });
      continue;
    }

    claimed.set(field.valueRef, field.label.trim());

    const group = field.group?.trim();
    fields.push({
      id: mintId(),
      sheet: sheet.name,
      label: field.label.trim(),
      labelRef: field.labelRef,
      valueRef: field.valueRef,
      // READ OUT OF THE GRID, NEVER OUT OF THE REPLY. The model is not asked
      // what a cell says and could not be believed if it were; `""` is a real
      // state here and means the cell is empty or absent, which is the case
      // Checkpoint 2 exists to fill.
      excelValue: sheet.byRef.get(field.valueRef)?.text ?? "",
      // `undefined` rather than `""`, so `ConfigField.group` is absent exactly
      // when there is no row to name and a UI can branch on its presence.
      ...(group !== undefined && group.length > 0 ? { group } : {}),
    });
  }

  /*
   * A VALUE CELL THAT IS ANOTHER FIELD'S NAME CELL IS REFUSED, AND ONLY THE
   * WRITER IS.
   *
   * Accepting one is how this feature would quietly rename a field in the
   * operator's own workbook: `pendingEdits` turns an approved recommendation
   * into a `CellEdit`, `patchWorkbook` writes it, and the file comes back
   * opening cleanly with a scan's value standing where a field name used to
   * be -- and with the field that owned that name now reading its own value as
   * its label on the next pass. None of the three real layouts puts a value on
   * top of a label, so the cost of this rule is a row the operator does not
   * see; the cost of not having it is a workbook nobody can tell was damaged.
   *
   * A SECOND PASS, so the answer does not depend on which of the two the model
   * happened to list first: the field being NAMED is unharmed either way, and
   * only the one that would do the writing is dropped.
   */
  const labelCells = new Set(fields.map((field) => field.labelRef));
  const kept: ConfigField[] = [];
  for (const field of fields) {
    if (field.valueRef !== field.labelRef && labelCells.has(field.valueRef)) {
      unusable.push({
        label: field.label,
        labelRef: field.labelRef,
        valueRef: field.valueRef,
        reason:
          `valueRef ${field.valueRef} is the labelRef of another field, so ` +
          "filling it would overwrite that field's name",
      });
      continue;
    }
    kept.push(field);
  }

  return {
    fields: kept,
    unusable,
    note: noteFor(sheet, kept, unusable),
  };
}

/**
 * What fields does this ONE worksheet hold, for a person to rule on.
 *
 * The model is reached exactly once, and only when there is something to ask
 * about: a sheet with no non-empty cell buys a sentence rather than a prompt,
 * for the reason `discoverSections` refuses to spend a call on an empty page
 * list.
 */
export async function interpretWorkbook(deps: {
  sheet: Sheet;
  ask: Ask;
  mintId: () => string;
}): Promise<Interpretation> {
  const { sheet, ask, mintId } = deps;

  if (sheet.cells.length === 0) {
    return {
      fields: [],
      unusable: [],
      note: `sheet "${sheet.name}" has no non-empty cell, so nothing was asked`,
    };
  }

  return validateInterpretation(
    sheet,
    extractJson(await ask(buildInterpretPrompt(sheet))),
    mintId,
  );
}

/** The sentence, in the cases the two arrays cannot be told apart by. */
function noteFor(
  sheet: Sheet,
  fields: ConfigField[],
  unusable: UnusableField[],
): string {
  const cells = `${sheet.cells.length} non-empty cell(s)`;
  // A CLAUSE, NOT A SECOND SENTENCE. The note is one sentence by contract, and
  // this is the one fact neither array carries: a caller reading "12 fields"
  // has no way to know the model was shown two thirds of the sheet.
  const cut = listingTruncation(sheet);
  const partial = cut
    ? `, and the listing the model read was cut short (${cut}), so it did ` +
      "not see the whole sheet"
    : "";

  if (fields.length === 0 && unusable.length === 0) {
    return `the model found no field in the ${cells} of sheet "${sheet.name}"${partial}`;
  }
  if (fields.length === 0) {
    return (
      `the model named ${unusable.length} field(s) and none of them could be ` +
      `checked against the cells they cite: ${unusable
        .map((one) => `"${one.label}" (${one.reason})`)
        .join("; ")}${partial}`
    );
  }
  if (unusable.length === 0) {
    return `${fields.length} field(s) read out of sheet "${sheet.name}" (${cells})${partial}`;
  }
  return (
    `${fields.length} field(s) read out of sheet "${sheet.name}" (${cells}); ` +
    `${unusable.length} refused${partial}`
  );
}
