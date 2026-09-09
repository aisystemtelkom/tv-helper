/**
 * THE SHEET AS THE TEXT A MODEL READS, and the reason the model can never
 * invent a cell.
 *
 * This is `buildLocatePrompt`'s device wearing different clothes. There, OCR
 * supplies every word with a real glyph box, the model is shown those words
 * grouped into NUMBERED LINES, and it answers with a LINE RANGE; the rectangle
 * is then the union of those lines' own boxes, so the model never touches a
 * pixel coordinate. Here the workbook supplies every non-empty cell with a real
 * address, the model is shown those cells grouped BY ROW with their addresses,
 * and it answers with a CELL ADDRESS. `Sheet.byRef` is then the check: an
 * address the sheet does not have, or a label whose text is not the text
 * standing at the address it cites, is dropped with a reason rather than shown
 * to an operator. The model does only the semantic step -- which of these cells
 * is a field name and which cell holds its value -- which is the part a
 * language model is good at.
 *
 * ## Why the shape has to survive into the text, and not just the contents
 *
 * "STRUKTUR EXCEL RANDOM" is the client's own instruction, and the three real
 * client workbooks read on 2026-09-09 are laid out three genuinely different
 * ways:
 *
 *   1. labels down one column with values in another, a four-column header row
 *      above them, 35 rows;
 *   2. field names across one header row with a type-hint row above it and one
 *      DATA ROW PER SERVICE below, 16 columns, two of which are date serials;
 *   3. fully transposed: `Nomor` / `Item I` / `Item II` / `Keterangan` as ROW
 *      labels down one column, the field names running ACROSS columns E to AN,
 *      and the data in two rows near the top.
 *
 * Nothing here hard-codes any of them, and nothing should. But a listing that
 * prints one address per line would flatten all three into the same shapeless
 * column of addresses, and the layout is precisely the question being asked. So
 * cells are grouped by row, and the two-dimensional shape is on the page.
 *
 * The corollaries are the small rules below, each of which exists because
 * dropping it makes the picture lie rather than makes it shorter:
 *
 *  - **A COLUMN GAP IS PRINTED, NEVER CLOSED UP.** Layout 3 has a label in
 *    column B and its first value in column E; layout 1 has labels in C and
 *    values in E with an empty D between. Rendered as `B5: ... | E5: ...` those
 *    read as neighbours, and "the values are two columns to the right of the
 *    label" -- the whole content of the answer -- is gone. The gap marker names
 *    the empty addresses it stands for, which is a second, deliberate gain: a
 *    `ConfigField.valueRef` is allowed to point at an EMPTY cell, because an
 *    empty cell EPIC expects filled is exactly what Checkpoint 2 is for, and a
 *    model that has never been shown that address cannot cite it. A row is
 *    padded out to the sheet's last column for that reason and no other; see
 *    `renderRow`, and note that layout 1 puts its VALUE column last, so the
 *    unfilled cell is exactly the one that would fall off the end.
 *  - **A ROW GAP IS PRINTED FOR THE SAME REASON.** Layout 3's data sits in rows
 *    5-6 under labels in rows 1-4; a workbook with a blank spacer row between
 *    two blocks would otherwise read as one continuous table.
 *  - **CELL TEXT IS FLATTENED BEFORE IT IS PRINTED.** Excel cells carry hard
 *    line breaks (alt+enter), and one of those in a listing whose whole
 *    structure is one row per line turns the rest of that row into what looks
 *    like a new row. That is the wrong-and-quiet shape exactly: nothing throws,
 *    the listing still looks like a listing, and the shape it describes is not
 *    the workbook's.
 *
 * ## What is printed is `Cell.ref`, not a recomputed address
 *
 * The address a cell is shown under is the string the model will echo back and
 * the string `Sheet.byRef` will be looked up with. Printing anything else --
 * even a provably equivalent `formatRef(cell.col, cell.row)` -- would put a
 * second address derivation between the listing and the validation, and the two
 * would agree on every workbook anybody tested. Column gaps are computed from
 * `col`/`row` because a gap is arithmetic, not an identity.
 */

import { formatRef, type Cell, type Sheet } from "./grid.ts";

/**
 * The most cells one listing may carry.
 *
 * A RUNAWAY GUARD, NOT A BUDGET, in the same sense as
 * `GEMINI_MAX_OUTPUT_TOKENS`. Measured on 2026-09-09 by rendering all three
 * real client workbooks through this function, the sheets hold **115, 58 and
 * 159** non-empty cells (35x5, 4x16 and 6x40). 4000 is 25x the largest of
 * them, so on a real workbook this never fires and the listing is complete.
 * What it stops is one pathological sheet -- an export with a hundred thousand
 * styled-but-meaningless cells, a pasted CSV dump -- turning one Checkpoint 2
 * into a bill nobody authorised.
 *
 * The number is also the right order for the cost the listing sits in. At the
 * ~20 characters a rendered cell averages, 4000 cells is about 80k characters,
 * or roughly 20k tokens: comparable to the 23k-token page listing `locate`
 * already sends, which AGENTS.md records as the second largest line on a run's
 * bill. A cap that allowed ten times this would be a cap in name only.
 */
export const MAX_LISTING_CELLS = 4000;

/**
 * The most merged ranges one listing may name.
 *
 * Merges are listed at all because A MERGED LABEL CELL IS A REAL LAYOUT SIGNAL,
 * and the transposed workbook demonstrates it: its only merge is `A1:A4`, one
 * cell spanning the four rows that carry `Nomor` / `Item I` / `Item II` /
 * `Keterangan` -- the spine of the whole layout, and invisible in a cell list,
 * where it is a single value sitting in `A1` with three empty rows under it. A
 * model shown that and not the merge has to guess whether `A1` labels one row
 * or four.
 *
 * They still get their own bound rather than eating the cell budget, because
 * merges are metadata a spreadsheet accumulates cheaply: the other two real
 * workbooks merge nothing at all, so there is no measured upper end to lean on
 * and the cap is a guard rather than a fitted number.
 *
 * `listingTruncated` counts this cap as well as the cell cap; see its comment.
 */
export const MAX_LISTING_MERGES = 200;

/**
 * The most characters of one cell's text that reach the listing.
 *
 * Measured, not chosen by taste: the longest single value in the three real
 * workbooks is a street address at about 100 characters, and 120 clears it with
 * room for the longer spellings that the same field takes elsewhere. A cell
 * that runs past this is prose, and the question this listing exists to ask --
 * which cell is a field name and which cell holds its value -- does not turn on
 * the tail of a paragraph.
 *
 * THE CUT IS MARKED, WITH THE COUNT OF WHAT WAS CUT, because a silently
 * shortened value read as a complete one is this project's failure class in
 * miniature: the model would compare the scans against a value the workbook
 * does not hold and report `beda` on a field that matches perfectly.
 *
 * Truncating here cannot corrupt a comparison, and that is worth stating
 * because it looks as though it could. `ConfigField.excelValue` is filled from
 * the `Cell` itself by the caller, never scraped back out of this string, so
 * the full value is always what is compared and always what an operator sees.
 * And `assertInterpreted`'s containment rule survives a cut label unharmed: a
 * label the model echoes from a truncated rendering is a PREFIX of the cell's
 * real text, so it is still a substring of the cell it cites.
 */
export const MAX_CELL_TEXT = 120;

/**
 * One cell's text, made safe to print on a line of a row-per-line listing.
 *
 * THE NEWLINE IS THE ONE THAT MATTERS. A spreadsheet cell can hold a hard line
 * break (alt+enter), and Indonesian address cells routinely do. This listing's
 * entire structure is one row of the sheet per line of text, so an unflattened
 * break splits one row into two and everything after it reads as a row the
 * workbook does not have -- addresses that all still validate against `byRef`,
 * describing a layout that never existed.
 *
 * Every C0 control character and DEL goes the same way, not just the newline.
 * They are invisible, so a value carrying one differs from the value printed
 * here in a way no reader of either can see, and this file's whole claim is
 * that what the model reads is what the sheet holds.
 *
 * An empty rendering is printed as `(blank)` rather than dropped. A cell the
 * reader kept whose text renders to nothing is a real thing -- a formula
 * returning `""`, a cell carrying only a style -- and hiding it would silently
 * shift every gap marker in its row, which is to say it would make the picture
 * of the layout wrong in exactly the way this file exists to prevent.
 */
function cellText(cell: Cell): string {
  // Stripped by code point rather than by a character class, so that this file
  // does not have to carry a literal NUL and DEL inside a regex to name them.
  // A source file with raw control bytes in it is one `git diff` away from
  // being unreviewable, and an editor that helpfully normalises them would
  // silently change what this function matches.
  const flat = [...cell.text]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? " " : ch;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (flat === "") return "(blank)";
  if (flat.length <= MAX_CELL_TEXT) return flat;
  return `${flat.slice(0, MAX_CELL_TEXT)}... (+${flat.length - MAX_CELL_TEXT} chars cut)`;
}

/**
 * A cell's kind, annotated only when it is not plain text.
 *
 * Two things downstream turn on it, so it is worth the token. A model deciding
 * which column holds VALUES is helped by seeing that a column is uniformly
 * numeric or date-typed, which is how layout 2's two date-serial columns
 * announce themselves. And `formula` is a warning a person needs before a cell
 * is patched: `src/lib/xlsx/write.ts` strips the `<f>` element when it
 * overwrites, so accepting a recommendation on a computed cell replaces a
 * formula with a constant, and that is a decision rather than an edit.
 *
 * Plain text is left unannotated because it is the overwhelming majority and an
 * annotation on every cell would be noise paid for by the token.
 */
function kindTag(cell: Cell): string {
  return cell.kind === "text" ? "" : ` (${cell.kind})`;
}

/** `<D2 empty>` for one column, `<F2:AM2 empty>` for a run of them. */
function columnGap(fromCol: number, toCol: number, row: number): string {
  return fromCol === toCol
    ? `<${formatRef(fromCol, row)} empty>`
    : `<${formatRef(fromCol, row)}:${formatRef(toCol, row)} empty>`;
}

/** `<row 7 empty>` for one row, `<rows 7-11 empty>` for a run of them. */
function rowGap(fromRow: number, toRow: number): string {
  return fromRow === toRow
    ? `<row ${fromRow} empty>`
    : `<rows ${fromRow}-${toRow} empty>`;
}

/**
 * One row of the sheet as one line of the listing.
 *
 * `lastCol` is the sheet's own last column, and the row is padded out to it
 * with a trailing gap marker. THAT TRAILING MARKER IS THE ONE THAT LOOKED
 * OPTIONAL AND IS NOT, and the first real workbook is why: its layout is a
 * label in column C, a note in D and THE VALUE IN E, which is the sheet's last
 * column. A cell holding no value is not in `Sheet.cells` at all, so a field
 * nobody has filled in yet renders as a row that simply stops after `D7` -- and
 * a `ConfigField.valueRef` of `E7` is then an address the model was never
 * shown. It would have to invent it, which is the one thing this whole file is
 * built to make impossible, and an unfilled cell EPIC expects filled is not an
 * edge case here: it is exactly what Checkpoint 2 exists to catch.
 *
 * No LEADING marker is emitted for the same situation on the other side,
 * because there is nothing to state: an address carries its own column, so a
 * row that opens at `C3` has already said that A and B are empty. A trailing
 * run has no such anchor after it.
 */
function renderRow(cells: readonly Cell[], lastCol: number): string {
  const row = cells[0].row;
  const parts: string[] = [`r${row}`];
  let previousCol = 0;
  for (const cell of cells) {
    if (previousCol > 0 && cell.col > previousCol + 1) {
      parts.push(columnGap(previousCol + 1, cell.col - 1, row));
    }
    parts.push(`${cell.ref}: ${cellText(cell)}${kindTag(cell)}`);
    previousCol = cell.col;
  }
  if (lastCol > previousCol) parts.push(columnGap(previousCol + 1, lastCol, row));
  return parts.join(" | ");
}

function mergeLine(sheet: Sheet): string {
  // "none" rather than an omitted line. An absent line is ambiguous between
  // "this sheet merges nothing" and "this listing does not report merges", and
  // the model has no way to tell which, so it would have to assume the second.
  if (sheet.merges.length === 0) return "merged: none";
  const shown = sheet.merges.slice(0, MAX_LISTING_MERGES);
  const tail =
    shown.length < sheet.merges.length
      ? ` (${shown.length} of ${sheet.merges.length} shown)`
      : "";
  return `merged: ${shown.join(", ")}${tail}`;
}

/**
 * One sheet, rendered as the addressed listing a model is asked to read.
 *
 * DETERMINISTIC BY CONSTRUCTION: the same `Sheet` renders to the same string,
 * every time. Nothing here reads a clock, a random source or the iteration
 * order of `byRef`, and the cells are sorted into row-major order here rather
 * than trusted to arrive that way. `Sheet.cells` is documented as row-major and
 * `read.ts` emits it that way today, but this function is also handed sheets
 * assembled by hand and by tests, and a listing whose rows arrive out of order
 * is a wrong picture of the layout that nothing downstream could catch -- the
 * addresses would all still validate against `byRef`.
 *
 * Determinism is not tidiness here. It is what lets a cached model reply, a
 * re-run of the same order, and a diff between two runs mean anything at all.
 */
export function sheetListing(sheet: Sheet): string {
  // Sorted THEN sliced, so an over-cap sheet loses its LAST rows rather than an
  // arbitrary scatter of cells. A hole in the middle of a listing is invisible;
  // a missing tail is announced by the marker below and is where a reader would
  // look for it.
  const ordered = [...sheet.cells].sort(
    (a, b) => a.row - b.row || a.col - b.col,
  );
  const shown = ordered.slice(0, MAX_LISTING_CELLS);

  const byRow = new Map<number, Cell[]>();
  for (const cell of shown) {
    const row = byRow.get(cell.row);
    if (row) row.push(cell);
    else byRow.set(cell.row, [cell]);
  }

  // `previousRow` starts at 0, so empty rows ABOVE the first populated one get
  // no marker: the `r5` label has already said the listing starts at row 5,
  // exactly as an address says which column a row opens at. Rows below the last
  // populated one are likewise left unsaid, and that is the one asymmetry with
  // `renderRow`'s trailing column pad -- a row is padded because a value cell
  // in the sheet's last column is a real thing an operator has not filled in,
  // whereas an entirely empty row past the end of the data is not a field.
  const body: string[] = [];
  let previousRow = 0;
  for (const [row, cells] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    if (previousRow > 0 && row > previousRow + 1) {
      body.push(rowGap(previousRow + 1, row - 1));
    }
    body.push(renderRow(cells, sheet.cols));
    previousRow = row;
  }

  // An empty sheet says so. Silence would read as a listing that failed to
  // render, and the operator-facing consequence of the two is opposite: one is
  // "this sheet has nothing in it, you handed over the wrong one", the other is
  // "this tool is broken".
  if (body.length === 0) body.push("(no non-empty cells)");

  if (shown.length < ordered.length) {
    const last = shown[shown.length - 1];
    body.push(
      `<TRUNCATED: ${shown.length} of ${ordered.length} non-empty cells shown. ` +
        (last
          ? `Nothing after ${last.ref} is listed.>`
          : "Nothing is listed.>"),
    );
  }

  return [
    `--- sheet "${sheet.name}" ---`,
    `dimension ${sheet.dimension} (${sheet.rows} rows x ${sheet.cols} columns), ` +
      `${sheet.cells.length} non-empty cells`,
    mergeLine(sheet),
    "",
    ...body,
  ].join("\n");
}

/**
 * Would `sheetListing` leave something out?
 *
 * THIS EXISTS SO THE OPERATOR CAN BE TOLD, and that is the whole point of it.
 * A truncated listing compared against the scans produces a Checkpoint 2 that
 * opens cleanly, lists a screenful of fields, and is silently a comparison of a
 * FRACTION of their workbook -- every field past the cut reported as neither
 * matching nor mismatching, because it was never seen. That reads to a person
 * exactly like a workbook with fewer fields in it. It is this project's central
 * failure class (wrong-and-quiet: a deliverable that looks complete and is
 * missing evidence), so the caller is given the fact rather than left to infer
 * it from a cell count.
 *
 * IT COUNTS BOTH CAPS, and that is not pedantry. A sheet whose cells all fit
 * but whose merges do not still produces a listing that describes less than the
 * sheet, and a predicate that answered `false` there would be a truncation
 * marked as full coverage -- the same lie in a smaller font.
 */
export function listingTruncated(sheet: Sheet): boolean {
  return (
    sheet.cells.length > MAX_LISTING_CELLS ||
    sheet.merges.length > MAX_LISTING_MERGES
  );
}
