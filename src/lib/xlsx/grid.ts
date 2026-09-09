/**
 * THE GRID: an A1 address, and the cells one sheet actually holds.
 *
 * This is the bottom of `src/lib/xlsx/` and it knows nothing about OOXML, zip
 * archives or the model. It exists so that everything above it -- the reader,
 * the patcher, the listing the model reads, and every stage in
 * `src/lib/config/` -- counts columns the same way and refuses a malformed
 * address in the same place.
 *
 * ## WHY AN ADDRESS IS THE UNIT
 *
 * `src/lib/config/types.ts` states the rule this file serves: the model is
 * shown the workbook's real cells with their real addresses and answers with a
 * CELL ADDRESS, never a value out of the air. That is `locate.ts`'s design
 * wearing different clothes -- there OCR supplies every line with a real box
 * and the model answers with a line range, so the rectangle is arithmetic on
 * measured geometry rather than a number a language model invented.
 *
 * An address is only worth that much if it can be CHECKED, which is why
 * `parseRef` throws rather than returning a fallback. A silently-coerced
 * address is this project's failure class in miniature: `parseRef("E9x")`
 * returning `{col: 5, row: 9}` would let a hallucinated reference resolve to a
 * real cell, and the operator would meet a recommendation attached to a field
 * the model never actually read. There is no correct guess for a malformed
 * address, so there is no guess.
 *
 * ## COLUMN MATH IS BIJECTIVE BASE-26, AND IT IS NOT DECORATIVE
 *
 * The third real client workbook, read 2026-09-09, is transposed: its field
 * names run ACROSS columns E to AN, so a `colToNumber` that stopped being
 * right after Z would misplace two thirds of that order's fields, quietly,
 * into cells that exist. Note that this numbering has no zero digit -- "Z" is
 * 26 and "AA" is 27, not 26*1 + 0 -- which is exactly the off-by-one an
 * ordinary base conversion produces.
 */

import type { CellRef } from "../config/types.ts";

/**
 * The only shape a cell address may have.
 *
 * Anchored at both ends deliberately: an unanchored test would accept
 * `"Sheet1!E9"` and `"E9:E12"`, and both of those are things a model has a
 * standing temptation to answer with. A sheet-qualified address or a range is
 * refused here rather than half-understood upstream.
 *
 * Three letters is Excel's own ceiling (XFD, column 16384) and seven digits
 * comfortably clears its 1048576 rows, so nothing an operator's workbook can
 * legally contain is rejected by the pattern.
 */
const REF_PATTERN = /^([A-Z]{1,3})([0-9]{1,7})$/;

const COLUMN_PATTERN = /^[A-Z]{1,3}$/;

/**
 * HOW THE TEXT WAS ARRIVED AT, for a reader deciding whether to trust it.
 *
 * `"date"` is here because a date is the one value in a spreadsheet whose
 * stored form and displayed form share no digits at all: the second real
 * workbook holds a start date as the number 46255. A consumer that cannot tell
 * a date cell from a number cell would show an operator a bare five-digit
 * integer where their own Excel shows a date, and would then compare that
 * integer against a date read off a scan and report a mismatch that is not
 * one.
 *
 * `"formula"` wins over every other kind when a cell carries one, because the
 * fact that matters downstream about such a cell is not how it renders but
 * that overwriting it destroys a computation.
 */
export type CellKind = "text" | "number" | "date" | "boolean" | "formula";

/**
 * One non-empty cell.
 *
 * `text` is what a person reads -- a date already formatted, a number already
 * rendered -- because that is the only form in which a comparison against a
 * scanned document means anything. `raw` carries the stored value when it
 * differs from `text`, so a date's serial and a boolean's `1` survive for
 * anything that needs to reason about the sheet rather than about what it
 * says. `raw` is absent, not equal to `text`, when there is nothing to add.
 */
export type Cell = {
  /** The A1 address, sheet-relative: `"E9"`, `"AH5"`. */
  ref: CellRef;
  /** 1-based, matching the address. */
  row: number;
  /** 1-based, `A` = 1, matching the address. */
  col: number;
  /** What a person reads: dates formatted, numbers rendered. */
  text: string;
  /** The stored value before formatting, when it differs from `text`. */
  raw?: string;
  kind: CellKind;
};

/**
 * One worksheet, as everything above this layer sees it.
 *
 * `cells` is row-major so a listing reads down the sheet the way a person
 * does, and `byRef` is the O(1) check on a model's answer: validating an
 * address against the grid is the whole reason the model is allowed to name
 * one.
 *
 * DUPLICATE ADDRESSES ARE PRESERVED IN `cells` AND ARE NOT AN ERROR HERE, and
 * that is a deliberate service to `./write.ts`. A patcher whose cell-matching
 * fails can silently APPEND a second `<row r="9">` carrying a second `E9`;
 * Excel then opens the file and shows one of them. Nothing about that file
 * looks wrong, which makes it precisely the failure this project is organised
 * against. The patcher's post-write verification has to be able to COUNT
 * occurrences of an address to catch it, so this layer must not quietly fold
 * them together. `byRef` therefore holds the FIRST occurrence in document
 * order, not the last: an appended duplicate leaves the stale value in `byRef`
 * as well as a second entry in `cells`, so a verification that only checks the
 * value still fails rather than reading back the new value and passing.
 */
export type Sheet = {
  name: string;
  /** Every non-empty cell, row-major. Duplicated addresses are kept. */
  cells: Cell[];
  /** First occurrence per address. O(1) validation of a model's answer. */
  byRef: Map<CellRef, Cell>;
  /**
   * The extent of the non-empty cells, `"A1:E35"`, or `""` for a sheet with
   * none. Computed from what was actually read rather than copied from the
   * sheet's own `<dimension>` element, which producers are free to overstate
   * and which would then advertise addresses the listing cannot show.
   */
  dimension: string;
  /** Highest 1-based row holding a non-empty cell; 0 when there are none. */
  rows: number;
  /** Highest 1-based column holding a non-empty cell; 0 when there are none. */
  cols: number;
  /** Merged ranges verbatim, `"A1:C1"`. */
  merges: string[];
};

/** Every sheet of one workbook, in workbook order. */
export type Workbook = {
  sheets: Sheet[];
  /** The same names, in the same order, for a screen that only needs them. */
  sheetNames: string[];
};

/**
 * `"A"` -> 1, `"Z"` -> 26, `"AA"` -> 27, `"AN"` -> 40.
 *
 * Throws on anything that is not one to three capital letters. Returning 0 or
 * NaN for junk would push a malformed address one layer further in, where it
 * becomes a cell that exists.
 */
export function colToNumber(col: string): number {
  if (!COLUMN_PATTERN.test(col)) {
    throw new Error(`not a column: ${JSON.stringify(col)}`);
  }
  let n = 0;
  for (let i = 0; i < col.length; i += 1) {
    n = n * 26 + (col.charCodeAt(i) - 64);
  }
  return n;
}

/**
 * The inverse. 1 -> `"A"`, 27 -> `"AA"`.
 *
 * The `n -= 1` before each digit is the bijective-base-26 correction: without
 * it 27 comes out as `"BA"`, which is a real column three letters away from
 * the one meant.
 */
export function numberToCol(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`column numbers are 1-based integers, not ${JSON.stringify(n)}`);
  }
  let rest = n;
  let out = "";
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(65 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

/**
 * `"E9"` -> `{col: 5, row: 9}`. Throws on anything else, including `"A0"`.
 *
 * `"A0"` matches the address pattern and is still not a cell, because rows are
 * 1-based. It is worth its own rejection rather than being allowed through as
 * row 0: a zero row survives arithmetic without complaining and reappears as
 * an off-by-one somewhere with no address left to blame.
 */
export function parseRef(ref: CellRef): { col: number; row: number } {
  const found = REF_PATTERN.exec(ref);
  if (!found) throw new Error(`not a cell address: ${JSON.stringify(ref)}`);
  const row = Number(found[2]);
  if (row < 1) {
    throw new Error(`rows are 1-based, so ${JSON.stringify(ref)} is not a cell address`);
  }
  return { col: colToNumber(found[1]), row };
}

/** `(5, 9)` -> `"E9"`. Throws on a non-positive or fractional coordinate. */
export function formatRef(col: number, row: number): CellRef {
  if (!Number.isInteger(row) || row < 1) {
    throw new Error(`rows are 1-based integers, not ${JSON.stringify(row)}`);
  }
  return `${numberToCol(col)}${row}`;
}

/**
 * The non-throwing half, for validating something that came off the wire.
 *
 * A model's reply, a stored decision and a route body all arrive as `unknown`,
 * and each of them needs to ask this question without a `try`/`catch` around
 * the answer.
 */
export function isCellRef(value: unknown): value is CellRef {
  if (typeof value !== "string") return false;
  const found = REF_PATTERN.exec(value);
  return found !== null && Number(found[2]) >= 1;
}
