/**
 * AMEND THE OPERATOR'S OWN WORKBOOK. NEVER AUTHOR ONE.
 *
 * Checkpoint 2 hands back the same `.xlsx` the operator gave us with the cells
 * they approved rewritten and nothing else changed. That sentence is the whole
 * specification, and every rule below is one way of failing to keep it.
 *
 * The distinction matters because AGENTS.md records, on 2026-09-09, that this
 * program must never generate, write, offer or read a spreadsheet -- a decision
 * about a DELIVERABLE the tool used to invent from nothing. The client's later
 * instruction the same day reverses the scope, not the reasoning: the workbook
 * is an operator-supplied INPUT, and what is offered back is that input with
 * named cells amended. So there is still no spreadsheet library here. `exceljs`
 * stays out; `xlsx` (SheetJS) stays out for the additional reason AGENTS.md
 * gives independently. This module edits OOXML text inside `jszip`, which the
 * lockfile already pinned for `docx`.
 *
 * ## WHY PATCH RATHER THAN REBUILD
 *
 * A rebuilt workbook loses the column widths, the number formats, the data
 * validations, the merged cells and the print settings EPIC's own template
 * carries, and it loses them in a file that opens cleanly. That is this
 * project's stated failure class wearing a spreadsheet icon. So every zip part
 * this module does not have a reason to touch is handed back with its content
 * unchanged: `sharedStrings.xml`, `styles.xml`, `printerSettings1.bin`, the
 * theme, the doc properties. Only the worksheet parts carrying an edit are
 * rewritten, and inside those, only the cells named.
 *
 * ## WHY `t="inlineStr"` AND NOT A SHARED STRING
 *
 * The obvious way to write text into a cell is to append it to
 * `xl/sharedStrings.xml` and point `<v>` at the new index. That part carries
 * `count` and `uniqueCount` attributes, an append has to maintain both, and
 * getting either wrong produces -- again -- a file that opens and is wrong.
 * An inline string is self-contained: the text lives in the cell, no other part
 * has anything to say about it, and the string table is left exactly as it was
 * even when the value we overwrite was the last reference to one of its
 * entries. An orphaned shared string is inert; a miscounted table is not.
 *
 * ## WHAT SURVIVES A REWRITE AND WHAT MUST NOT
 *
 *  - `s="..."` SURVIVES. It is the cell's style index -- its number format,
 *    its font, its borders, its fill. Dropping it makes the amended cell look
 *    unlike every other cell in its column, which reads to an operator as the
 *    tool having damaged their file.
 *  - `<f>` IS DROPPED. Leaving the formula behind means Excel recomputes over
 *    the value we just wrote the moment the file is opened, so the workbook
 *    shows the old answer, the operator sees their approval silently undone,
 *    and nothing anywhere reports a failure.
 *  - `t="..."` IS REPLACED, never kept. A cell left saying `t="s"` while
 *    holding an inline string makes Excel read the string as a shared-string
 *    INDEX, which lands on whatever entry happens to sit there.
 *  - `cm`, `vm` and `ph` are dropped with the value they annotated. They are
 *    indexes into cell-metadata and rich-value parts this module does not
 *    maintain, and an index pointing at metadata for a value that no longer
 *    exists is worse than its absence.
 *
 * ## THE VERIFICATION IS THE POINT OF THIS MODULE
 *
 * `verifyPatchedSheet` re-scans the XML this module just produced, from
 * scratch, and refuses to hand it back unless every edited address occurs
 * EXACTLY ONCE, holds EXACTLY the intended text, carries no formula, sits in
 * the row its own address names, and unless the rows of the sheet run in
 * strictly increasing order with no index repeated.
 *
 * That is not belt-and-braces. The first draft of this module matched rows
 * with a regular expression and, when the expression missed -- a row start tag
 * written `<row  r="9"  spans="1:5" >` misses a `<row r="9">` pattern, and
 * Excel writes both shapes -- it fell through to appending a fresh
 * `<row r="9">` at the end of `<sheetData>`. The result was a workbook with two
 * rows numbered 9, which Excel opens without complaint and reads according to
 * its own tie-breaking. A wrong value in a cell a validator signs, produced by
 * the step whose job was to correct that cell. The scanner below no longer uses
 * a pattern to find a row, and the verification exists so that a future one
 * cannot reintroduce the same file: if the patch does not land where it was
 * meant to, this module throws instead of returning bytes.
 *
 * ## MEASURED, 2026-09-09
 *
 * The three real client workbooks are all ordinary OOXML written by Excel: one
 * worksheet part each, an explicit `<dimension>`, every row carrying `r`, no
 * `<f>`, no self-closing `<row/>`, no inline strings, and used ranges of
 * `A1:E35`, `A1:P4` and `A1:AN8`. Their three layouts are wildly different --
 * labels down a column, headers across a row, and a fully transposed sheet --
 * which is exactly why none of that is assumed anywhere here: the fourth
 * workbook is not one of these three, so the self-closing row, the absent
 * dimension, the empty `<sheetData/>` and the formula cell are all handled
 * despite none of them appearing in the sample.
 */

import JSZip from "jszip";

import type { CellRef } from "../config/types.ts";
import { formatRef, parseRef } from "./grid.ts";

/**
 * One cell to overwrite: which sheet, which address, what text.
 *
 * `value` is always a STRING, and that is deliberate rather than lazy. The
 * values this feature writes come from OCR of a scan or from an operator's
 * typing, so the tool never knows that `"46255"` was meant as a date or that
 * `"1.500.000"` was meant as a number, and a guess that happens to be wrong
 * changes what the cell MEANS while looking entirely deliberate. Writing text
 * and keeping the cell's own number format is the honest option: the operator
 * sees what they approved, spelled the way they approved it.
 */
export type CellEdit = { sheet: string; ref: CellRef; value: string };

/** Every refusal this module raises. Never a silent no-op, never a repair. */
export class WorkbookPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbookPatchError";
  }
}

/** Excel's own limits. Past either, the file exists and will not open. */
const MAX_COLUMN = 16384; // XFD
const MAX_ROW = 1048576;

/**
 * Characters XML 1.0 cannot carry at all, escaped or not.
 *
 * Tab, newline and carriage return are legal and are deliberately absent from
 * this class: a multi-line address typed into a cell is a real thing an
 * operator does. Everything else in the C0 range would produce an archive
 * Excel refuses outright, so it is refused here instead, naming the cell, while
 * there is still somebody to tell.
 */
const FORBIDDEN_IN_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

const WORKSHEET_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";

/* ------------------------------------------------------------------ *
 * The public entry point
 * ------------------------------------------------------------------ */

/**
 * Rewrite `edits` into `bytes` and return the amended archive.
 *
 * An empty edit list returns the caller's own bytes, unchanged and un-rezipped.
 * That is preferred over a round trip: a workbook nobody edited should be the
 * same file it was, byte for byte, so an operator who downloads before deciding
 * anything gets their own upload back rather than a re-deflated copy of it that
 * differs from the original by every checksum they might compare.
 */
export async function patchWorkbook(
  bytes: Uint8Array,
  edits: readonly CellEdit[],
): Promise<Uint8Array> {
  if (edits.length === 0) return bytes;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    throw new WorkbookPatchError(
      `the workbook could not be opened as an OOXML archive: ${reasonOf(error)}`,
    );
  }

  const parts = await worksheetParts(zip);

  // Grouped by sheet, in the order the sheets were first named, so the error
  // an operator sees names the first sheet that is wrong rather than an
  // arbitrary one.
  const bySheet = new Map<string, CellEdit[]>();
  for (const edit of edits) {
    checkEditShape(edit);
    const list = bySheet.get(edit.sheet);
    if (list === undefined) {
      bySheet.set(edit.sheet, [edit]);
      continue;
    }
    if (list.some((other) => other.ref === edit.ref)) {
      // Two edits for one address is a caller bug with no safe reading.
      // Taking the last would write one of two operator decisions and report
      // success for both, which is the failure this whole module is built
      // against. Scanned out of the sheet's own list rather than looked up by
      // a composite key, because a sheet name may legally contain whatever
      // separator that key would have joined on.
      throw new WorkbookPatchError(
        `${edit.sheet}!${edit.ref} is named by two edits at once; there is no way to tell which value was meant`,
      );
    }
    list.push(edit);
  }

  for (const [sheet, sheetEdits] of bySheet) {
    const path = parts.get(sheet);
    if (path === undefined) throw new WorkbookPatchError(unknownSheetMessage(sheet, parts));
    const file = zip.file(path);
    if (file === null) {
      throw new WorkbookPatchError(
        `sheet "${sheet}" names the part ${path}, which this archive does not contain`,
      );
    }
    const before = await file.async("string");
    const after = patchSheetXml(before, sheetEdits);
    verifyPatchedSheet(after, sheet, sheetEdits);
    zip.file(path, after);
  }

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/* ------------------------------------------------------------------ *
 * Resolving a sheet NAME to a worksheet part
 * ------------------------------------------------------------------ */

/**
 * `sheet name -> zip path`, read the way the format says to read it.
 *
 * NOT by assuming `xl/worksheets/sheetN.xml` matches the Nth `<sheet>` element.
 * It routinely does not: `sheetId` is Excel's own creation counter, so a
 * workbook whose first two sheets were deleted has a single sheet with
 * `sheetId="3"`, and one of the three real client workbooks is exactly that.
 * The only thing that binds a name to a part is the `r:id` on the `<sheet>`
 * element and the matching `<Relationship>` in `xl/_rels/workbook.xml.rels`.
 */
async function worksheetParts(zip: JSZip): Promise<Map<string, string>> {
  const workbookFile = zip.file("xl/workbook.xml");
  if (workbookFile === null) {
    throw new WorkbookPatchError("this archive has no xl/workbook.xml, so it is not a workbook");
  }
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (relsFile === null) {
    throw new WorkbookPatchError(
      "this archive has no xl/_rels/workbook.xml.rels, so no sheet name can be resolved to a part",
    );
  }

  const relsXml = await relsFile.async("string");
  const targets = new Map<string, string>();
  for (const rel of scanChildren(relsXml, "Relationship", 0, relsXml.length)) {
    const id = attributeOf(rel.startTag, "Id");
    const type = attributeOf(rel.startTag, "Type");
    const target = attributeOf(rel.startTag, "Target");
    if (id === null || target === null) continue;
    if (type !== null && decodeXmlText(type) !== WORKSHEET_REL_TYPE) continue;
    targets.set(decodeXmlText(id), resolvePartPath(decodeXmlText(target)));
  }

  const workbookXml = await workbookFile.async("string");
  const parts = new Map<string, string>();
  for (const sheet of scanChildren(workbookXml, "sheet", 0, workbookXml.length)) {
    const rawName = attributeOf(sheet.startTag, "name");
    const rawId = attributeOf(sheet.startTag, "r:id");
    if (rawName === null) continue;
    const name = decodeXmlText(rawName);
    if (rawId === null) {
      throw new WorkbookPatchError(
        `sheet "${name}" carries no r:id, so its worksheet part cannot be identified`,
      );
    }
    const path = targets.get(decodeXmlText(rawId));
    if (path === undefined) {
      throw new WorkbookPatchError(
        `sheet "${name}" points at relationship ${decodeXmlText(rawId)}, which names no worksheet`,
      );
    }
    parts.set(name, path);
  }
  return parts;
}

/**
 * A relationship `Target` as a path inside the archive.
 *
 * Targets are relative to the part that declares them, which for
 * `xl/_rels/workbook.xml.rels` means relative to `xl/`. A leading `/` makes it
 * package-absolute instead. Both shapes are written by real producers.
 */
function resolvePartPath(target: string): string {
  const decoded = safeDecodeUri(target);
  if (decoded.startsWith("/")) return decoded.slice(1);
  const segments = `xl/${decoded}`.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A Target that is not valid percent-encoding is a Target meant literally.
    return value;
  }
}

/**
 * The refusal an operator sees when an edit names a sheet the workbook has not
 * got. It lists what the workbook DOES have, and calls out a name that differs
 * only in case, because that is the mistake that actually happens and "no such
 * sheet: Sheet1" beside a workbook containing `sheet1` reads as a tool fault.
 */
function unknownSheetMessage(sheet: string, parts: Map<string, string>): string {
  const known = [...parts.keys()];
  const nearly = known.find((name) => name.toLowerCase() === sheet.toLowerCase());
  const listed = known.length === 0 ? "none" : known.map((name) => `"${name}"`).join(", ");
  const hint =
    nearly === undefined ? "" : ` (this workbook spells it "${nearly}"; sheet names are case-sensitive here)`;
  return `no sheet named "${sheet}" in this workbook; it has ${listed}${hint}`;
}

/* ------------------------------------------------------------------ *
 * Validating one edit before anything is written
 * ------------------------------------------------------------------ */

function checkEditShape(edit: CellEdit): void {
  let parsed: { col: number; row: number };
  try {
    parsed = parseRef(edit.ref);
  } catch (error) {
    throw new WorkbookPatchError(
      `${edit.sheet}!${edit.ref} is not a cell address: ${reasonOf(error)}`,
    );
  }
  if (parsed.col > MAX_COLUMN || parsed.row > MAX_ROW) {
    throw new WorkbookPatchError(
      `${edit.sheet}!${edit.ref} is past the end of a worksheet (Excel stops at XFD1048576)`,
    );
  }
  if (FORBIDDEN_IN_XML.test(edit.value)) {
    throw new WorkbookPatchError(
      `the value for ${edit.sheet}!${edit.ref} carries a control character XML cannot represent, so the workbook would not open`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * The pure half: one worksheet part in, one worksheet part out
 * ------------------------------------------------------------------ */

/**
 * Apply `edits` to one worksheet part's XML and return the new XML.
 *
 * Exported separately from `patchWorkbook` so the whole of the interesting
 * behaviour can be tested against a string, with no archive, no async and no
 * jszip: the ordering rules, the style preservation, the formula drop and the
 * duplicate-row hazard are all properties of this function alone.
 *
 * Every edit is assumed to have passed `checkEditShape` and to name this sheet.
 */
export function patchSheetXml(xml: string, edits: readonly CellEdit[]): string {
  const sheetData = findSheetData(xml);
  let document = sheetData.expanded;

  const rows = segment(document, sheetData.innerStart, sheetData.innerEnd, "row", (element) => {
    const raw = attributeOf(element.startTag, "r");
    if (raw === null) {
      // Legal OOXML: a row with no `r` takes its index from its position. No
      // producer this project has met writes one, and guessing an index here
      // would put an operator's approved value in a row chosen by arithmetic
      // nobody checked. Refuse instead.
      throw new WorkbookPatchError(
        "this worksheet has a <row> with no r attribute, so its index is implied rather than stated and cannot be patched safely",
      );
    }
    const index = Number.parseInt(raw, 10);
    if (!Number.isInteger(index) || index < 1) {
      throw new WorkbookPatchError(`this worksheet has a <row r="${raw}">, which is not a row index`);
    }
    return index;
  });

  // Group by row so a row is parsed and rebuilt once however many of its cells
  // are edited, and so the cells inserted into one row are ordered against each
  // other rather than only against what was already there.
  const byRow = new Map<number, CellEdit[]>();
  for (const edit of edits) {
    const { row } = parseRef(edit.ref);
    const list = byRow.get(row);
    if (list) list.push(edit);
    else byRow.set(row, [edit]);
  }

  for (const [rowIndex, rowEdits] of [...byRow].sort((a, b) => a[0] - b[0])) {
    const position = rows.items.findIndex((item) => item.key === rowIndex);
    if (position === -1) {
      insertInOrder(rows, rowIndex, newRow(rowIndex, rowEdits));
    } else {
      rows.items[position].text = patchRow(rows.items[position].text, rowIndex, rowEdits);
    }
  }

  document =
    document.slice(0, sheetData.innerStart) + rebuild(rows) + document.slice(sheetData.innerEnd);

  return updateDimension(document, edits);
}

/**
 * `<sheetData>`, with a self-closing one expanded into an open/close pair.
 *
 * A workbook whose only sheet is empty is written `<sheetData/>`, and it is the
 * shape a patcher meets exactly once: the first time somebody hands over a
 * template with nothing filled in yet.
 */
function findSheetData(xml: string): { expanded: string; innerStart: number; innerEnd: number } {
  const found = scanChildren(xml, "sheetData", 0, xml.length);
  if (found.length === 0) {
    throw new WorkbookPatchError("this worksheet part has no <sheetData>, so it holds no cells");
  }
  if (found.length > 1) {
    throw new WorkbookPatchError(
      "this worksheet part has more than one <sheetData>, which no reader can resolve",
    );
  }
  const element = found[0];
  if (!element.selfClosing) {
    return { expanded: xml, innerStart: element.innerStart, innerEnd: element.innerEnd };
  }
  const expanded = `${xml.slice(0, element.start)}<sheetData></sheetData>${xml.slice(element.end)}`;
  const innerStart = element.start + "<sheetData>".length;
  return { expanded, innerStart, innerEnd: innerStart };
}

/** A whole row that did not exist, with its cells already in column order. */
function newRow(rowIndex: number, edits: readonly CellEdit[]): string {
  const cells = [...edits]
    .sort((a, b) => parseRef(a.ref).col - parseRef(b.ref).col)
    .map((edit) => inlineStringCell(edit.ref, null, edit.value))
    .join("");
  // No `spans` attribute: it is an optional hint, and an omitted hint is
  // honest where a computed one would be one more thing to keep true.
  return `<row r="${rowIndex}">${cells}</row>`;
}

/** One existing row, with the named cells replaced or inserted in column order. */
function patchRow(rowXml: string, rowIndex: number, edits: readonly CellEdit[]): string {
  const element = scanChildren(rowXml, "row", 0, rowXml.length)[0];
  const cells = segment(rowXml, element.innerStart, element.innerEnd, "c", (child) => {
    const raw = attributeOf(child.startTag, "r");
    if (raw === null) {
      throw new WorkbookPatchError(
        `row ${rowIndex} has a <c> with no r attribute, so its column is implied rather than stated and cannot be patched safely`,
      );
    }
    const parsed = parseRef(decodeXmlText(raw));
    if (parsed.row !== rowIndex) {
      throw new WorkbookPatchError(
        `row ${rowIndex} holds a cell addressed ${raw}, which belongs to a different row`,
      );
    }
    return parsed.col;
  });

  // `<row r="7"/>` is a row Excel wrote because it carries a height or a style
  // and no cells, and it is a row an operator's blank template is full of.
  // Left self-closing, the cells below would be appended AFTER it and the
  // `</row>` this function adds would close nothing: an unparseable file if you
  // are lucky, and a row's worth of values in the wrong place if you are not.
  let startTag = element.selfClosing ? element.startTag.replace(/\/>$/, ">") : element.startTag;
  for (const edit of edits) {
    const { col } = parseRef(edit.ref);
    const existing = cells.items.findIndex((item) => item.key === col);
    if (existing === -1) {
      insertInOrder(cells, col, inlineStringCell(edit.ref, null, edit.value));
      startTag = widenSpans(startTag, col);
    } else {
      const previous = scanChildren(
        cells.items[existing].text,
        "c",
        0,
        cells.items[existing].text.length,
      )[0];
      cells.items[existing].text = inlineStringCell(
        edit.ref,
        styleOf(previous.startTag),
        edit.value,
      );
    }
  }

  return `${startTag}${rebuild(cells)}</row>`;
}

/**
 * The cell as this module writes it: the address, the style it already had,
 * and the text inline.
 *
 * `xml:space="preserve"` is not decoration. Without it a value the operator
 * typed with a leading or trailing space comes back trimmed, which is a quiet
 * change to a value somebody approved character by character.
 */
function inlineStringCell(ref: CellRef, style: string | null, value: string): string {
  const styled = style === null ? "" : ` s="${style}"`;
  return `<c r="${ref}"${styled} t="inlineStr"><is><t xml:space="preserve">${escapeXmlText(value)}</t></is></c>`;
}

/**
 * The style index to carry over, or nothing.
 *
 * Only a plain integer is carried. `s` is an index into `cellXfs` and nothing
 * else is a valid one, so anything that is not an integer is a cell we do not
 * understand, and copying an attribute value we cannot read into a file we are
 * about to declare verified is the wrong way round.
 */
function styleOf(startTag: string): string | null {
  const raw = attributeOf(startTag, "s");
  if (raw === null) return null;
  return /^\d+$/.test(raw) ? raw : null;
}

/**
 * Widen a row's `spans="a:b"` hint so it still covers its own cells.
 *
 * `spans` is advisory and Excel recomputes it, so a stale one costs nothing at
 * open time. It is kept true anyway for the reason the dimension is: a file
 * that says something false about itself is a file the next reader has to know
 * to distrust, and this module's whole claim is that its output can be trusted.
 */
function widenSpans(startTag: string, col: number): string {
  const spans = attributeOf(startTag, "spans");
  if (spans === null) return startTag;
  const match = spans.match(/^(\d+):(\d+)$/);
  if (match === null) return startTag;
  const from = Math.min(Number(match[1]), col);
  const to = Math.max(Number(match[2]), col);
  return startTag.replace(/(\sspans=")[^"]*(")/, `$1${from}:${to}$2`);
}

/**
 * Grow `<dimension ref="...">` to cover every edited address.
 *
 * Excel tolerates a stale dimension and recomputes the used range, so this is
 * not what stops the file breaking. It is what stops the file LYING: every
 * other reader of an xlsx -- including the reader in this same directory --
 * is entitled to believe it, and a dimension that stops one column short of a
 * value an operator approved is a value that silently does not exist.
 *
 * A worksheet with no `<dimension>` at all is left without one. Absent is not a
 * false statement; inventing one would be a new claim this module would then
 * have to keep true for parts of the sheet it never looked at.
 */
function updateDimension(xml: string, edits: readonly CellEdit[]): string {
  const found = scanChildren(xml, "dimension", 0, xml.length);
  if (found.length === 0) return xml;
  const element = found[0];
  const ref = attributeOf(element.startTag, "ref");
  if (ref === null) return xml;

  const corners = decodeXmlText(ref).split(":");
  let minCol: number;
  let minRow: number;
  let maxCol: number;
  let maxRow: number;
  try {
    const first = parseRef(corners[0]);
    const last = parseRef(corners[corners.length - 1]);
    minCol = Math.min(first.col, last.col);
    minRow = Math.min(first.row, last.row);
    maxCol = Math.max(first.col, last.col);
    maxRow = Math.max(first.row, last.row);
  } catch {
    // A dimension this module cannot read is a dimension it must not rewrite.
    return xml;
  }

  for (const edit of edits) {
    const { col, row } = parseRef(edit.ref);
    minCol = Math.min(minCol, col);
    minRow = Math.min(minRow, row);
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);
  }

  const next = `${formatRef(minCol, minRow)}:${formatRef(maxCol, maxRow)}`;
  if (next === decodeXmlText(ref)) return xml;
  const rewritten = element.startTag.replace(/(\sref=")[^"]*(")/, `$1${next}$2`);
  return xml.slice(0, element.start) + rewritten + xml.slice(element.start + element.startTag.length);
}

/* ------------------------------------------------------------------ *
 * The verification. Nothing leaves this module without passing it.
 * ------------------------------------------------------------------ */

/**
 * Re-read the produced XML and refuse it unless every claim holds.
 *
 * Deliberately independent of how the patch was made: it re-scans from the
 * document text with the same scanner a reader would use, and it checks
 * properties of the WHOLE sheet, not only of the cells that were touched. The
 * defect this exists for did not corrupt the cell it was aiming at -- it left
 * that one alone and added a second row with the same index somewhere else --
 * so a check scoped to the edited cells would have passed on the broken file.
 *
 * The five claims, and the file each one refuses:
 *
 *  1. Row indexes strictly increase.        Two rows numbered 9; Excel picks.
 *  2. Every cell sits in the row it names.  A value in a neighbouring row.
 *  3. Every address occurs exactly once.    Two E9s; Excel picks.
 *  4. Cells ascend by column within a row.  Readers that trust the order skip.
 *  5. Each edited cell holds exactly its
 *     value, as an inline string, with no
 *     formula left behind.                 The approval silently undone.
 */
export function verifyPatchedSheet(
  xml: string,
  sheetName: string,
  edits: readonly CellEdit[],
): void {
  const sheetData = scanChildren(xml, "sheetData", 0, xml.length)[0];
  if (sheetData === undefined) {
    throw new WorkbookPatchError(`the patched sheet "${sheetName}" has lost its <sheetData>`);
  }

  const texts = new Map<string, string>();
  const tags = new Map<string, string>();
  const bodies = new Map<string, string>();
  let previousRow = 0;

  for (const row of scanChildren(xml, "row", sheetData.innerStart, sheetData.innerEnd)) {
    const raw = attributeOf(row.startTag, "r");
    if (raw === null) {
      throw new WorkbookPatchError(
        `the patched sheet "${sheetName}" has a <row> with no r attribute`,
      );
    }
    const rowIndex = Number.parseInt(raw, 10);
    if (rowIndex <= previousRow) {
      throw new WorkbookPatchError(
        previousRow === rowIndex
          ? `the patched sheet "${sheetName}" has two rows numbered ${rowIndex}; Excel would open it and choose between them`
          : `the patched sheet "${sheetName}" has row ${rowIndex} after row ${previousRow}, so its rows are out of order`,
      );
    }
    previousRow = rowIndex;

    let previousCol = 0;
    for (const cell of scanChildren(xml, "c", row.innerStart, row.innerEnd)) {
      const rawRef = attributeOf(cell.startTag, "r");
      if (rawRef === null) {
        throw new WorkbookPatchError(
          `the patched sheet "${sheetName}" has a cell with no r attribute in row ${rowIndex}`,
        );
      }
      const ref = decodeXmlText(rawRef);
      const parsed = parseRef(ref);
      if (parsed.row !== rowIndex) {
        throw new WorkbookPatchError(
          `the patched sheet "${sheetName}" holds ${ref} inside row ${rowIndex}`,
        );
      }
      if (parsed.col <= previousCol) {
        throw new WorkbookPatchError(
          `the patched sheet "${sheetName}" has ${ref} out of column order in row ${rowIndex}`,
        );
      }
      previousCol = parsed.col;
      if (texts.has(ref)) {
        throw new WorkbookPatchError(
          `the patched sheet "${sheetName}" holds ${ref} twice; Excel would open it and choose between them`,
        );
      }
      texts.set(ref, cellText(xml, cell));
      tags.set(ref, cell.startTag);
      bodies.set(ref, xml.slice(cell.innerStart, cell.innerEnd));
    }
  }

  for (const edit of edits) {
    const tag = tags.get(edit.ref);
    if (tag === undefined) {
      throw new WorkbookPatchError(
        `${sheetName}!${edit.ref} was edited and is not in the patched sheet`,
      );
    }
    if (!/\st="inlineStr"/.test(tag)) {
      throw new WorkbookPatchError(
        `${sheetName}!${edit.ref} was written as an inline string and does not say so`,
      );
    }
    const body = bodies.get(edit.ref) ?? "";
    if (/<f[\s/>]/.test(body)) {
      throw new WorkbookPatchError(
        `${sheetName}!${edit.ref} still carries a formula, so Excel would recompute over the written value`,
      );
    }
    const actual = texts.get(edit.ref) ?? "";
    if (actual !== edit.value) {
      throw new WorkbookPatchError(
        `${sheetName}!${edit.ref} reads ${JSON.stringify(actual)} after patching, not ${JSON.stringify(edit.value)}`,
      );
    }
  }
}

/** The text a person would read out of a cell, for the inline-string case. */
function cellText(xml: string, cell: Element): string {
  const inline = scanChildren(xml, "is", cell.innerStart, cell.innerEnd);
  if (inline.length === 0) return "";
  let out = "";
  for (const run of scanChildren(xml, "t", inline[0].innerStart, inline[0].innerEnd)) {
    out += decodeXmlText(xml.slice(run.innerStart, run.innerEnd));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * A small XML scanner
 * ------------------------------------------------------------------ */

type Element = {
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
  startTag: string;
  selfClosing: boolean;
};

/**
 * Every direct occurrence of `<name ...>` between two offsets.
 *
 * A scanner rather than a regular expression, and that is the whole lesson of
 * this module. `<row r="9">`, `<row  r="9"  spans="1:5" >` and `<row r="9"/>`
 * are the same element written three legal ways, Excel writes more than one of
 * them, and a pattern written against the first quietly stops finding rows the
 * moment it meets the second. What it stops doing is FINDING; what the caller
 * then does is APPEND.
 *
 * Safe for the four element names used here (`row`, `c`, `is`, `t`,
 * `sheetData`, `dimension`, `sheet`, `Relationship`) because none of them
 * nests inside itself, and because XML forbids a literal `<` inside text, so a
 * closing tag cannot appear inside a value.
 */
function scanChildren(xml: string, name: string, from: number, to: number): Element[] {
  const out: Element[] = [];
  const open = `<${name}`;
  const close = `</${name}>`;
  let cursor = from;
  while (cursor < to) {
    const at = xml.indexOf(open, cursor);
    if (at === -1 || at >= to) break;
    const after = xml[at + open.length];
    // `<sheet` must not match `<sheetData`, and `<c` must not match `<cols`.
    if (after !== undefined && !/[\s/>]/.test(after)) {
      cursor = at + open.length;
      continue;
    }
    const tagEnd = endOfStartTag(xml, at, name);
    const selfClosing = xml[tagEnd - 1] === "/";
    if (selfClosing) {
      out.push({
        start: at,
        end: tagEnd + 1,
        innerStart: tagEnd + 1,
        innerEnd: tagEnd + 1,
        startTag: xml.slice(at, tagEnd + 1),
        selfClosing: true,
      });
      cursor = tagEnd + 1;
      continue;
    }
    const closeAt = xml.indexOf(close, tagEnd + 1);
    if (closeAt === -1 || closeAt >= to) {
      throw new WorkbookPatchError(`a <${name}> element is not closed inside the range scanned`);
    }
    out.push({
      start: at,
      end: closeAt + close.length,
      innerStart: tagEnd + 1,
      innerEnd: closeAt,
      startTag: xml.slice(at, tagEnd + 1),
      selfClosing: false,
    });
    cursor = closeAt + close.length;
  }
  return out;
}

/** The `>` that ends a start tag, skipping any `>` inside a quoted value. */
function endOfStartTag(xml: string, open: number, name: string): number {
  let quote: string | null = null;
  for (let i = open + 1; i < xml.length; i += 1) {
    const ch = xml[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") return i;
  }
  throw new WorkbookPatchError(`a <${name}> start tag is never closed`);
}

/**
 * One attribute's raw value, still XML-escaped.
 *
 * The leading `\s` is what keeps `r` from matching the `r` of `xr:uid` and `s`
 * from matching the `s` of `spans`.
 */
function attributeOf(startTag: string, name: string): string | null {
  const pattern = new RegExp(`\\s${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}="([^"]*)"`);
  const match = startTag.match(pattern);
  return match === null ? null : match[1];
}

/* ------------------------------------------------------------------ *
 * Ordered children, rebuilt without offset arithmetic
 * ------------------------------------------------------------------ */

/**
 * A run of ordered elements plus the raw text around them.
 *
 * `gaps` is one longer than `items`: `gaps[0]` precedes the first item and
 * `gaps[i + 1]` follows item `i`. Rebuilding from this rather than splicing a
 * string at computed offsets is what removes the whole class of bug where an
 * earlier edit shifts a later edit's indexes -- which, in the shape it took
 * here, silently wrote a cell into the wrong row.
 *
 * The gaps are almost always empty (Excel writes no whitespace between rows)
 * and are preserved anyway, so a hand-written or pretty-printed workbook comes
 * back looking the way its author left it.
 */
type Segments = { gaps: string[]; items: Array<{ key: number; text: string }> };

function segment(
  xml: string,
  from: number,
  to: number,
  name: string,
  keyOf: (element: Element) => number,
): Segments {
  const elements = scanChildren(xml, name, from, to);
  const gaps: string[] = [];
  const items: Array<{ key: number; text: string }> = [];
  let cursor = from;
  for (const element of elements) {
    gaps.push(xml.slice(cursor, element.start));
    items.push({ key: keyOf(element), text: xml.slice(element.start, element.end) });
    cursor = element.end;
  }
  gaps.push(xml.slice(cursor, to));
  return { gaps, items };
}

function rebuild(segments: Segments): string {
  let out = segments.gaps[0];
  for (let i = 0; i < segments.items.length; i += 1) {
    out += segments.items[i].text + segments.gaps[i + 1];
  }
  return out;
}

/**
 * Put a new element before the first one with a greater key.
 *
 * THROWS rather than appending when the key is already present. Appending is
 * precisely the behaviour that produced two rows numbered 9, so the one place
 * that could do it refuses to.
 */
function insertInOrder(segments: Segments, key: number, text: string): void {
  const at = segments.items.findIndex((item) => item.key > key);
  if (segments.items.some((item) => item.key === key)) {
    throw new WorkbookPatchError(`refusing to insert a second element keyed ${key}`);
  }
  const position = at === -1 ? segments.items.length : at;
  segments.items.splice(position, 0, { key, text });
  segments.gaps.splice(position + 1, 0, "");
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXmlText(xml: string): string {
  return xml.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
