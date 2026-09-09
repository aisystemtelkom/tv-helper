/**
 * READING AN OPERATOR'S WORKBOOK, WITHOUT A SPREADSHEET LIBRARY.
 *
 * `src/lib/config/types.ts` records why Excel came back at all: the client's
 * instruction of 2026-09-09 reversed the SCOPE of the no-Excel decision, not
 * its reasoning. The tool still never authors a workbook. It reads the one the
 * operator hands over, checks it against the scans, and offers back THAT
 * WORKBOOK with named cells amended. So this module reads; `./write.ts`
 * patches; neither ever builds a sheet from nothing.
 *
 * `exceljs` and `xlsx` (SheetJS) both stay out, and this file is the reason
 * that costs nothing: an .xlsx is an ordinary zip of XML parts, and `jszip` is
 * already in the lockfile for `docx`. SheetJS's separate disqualification --
 * frozen on npm at 0.18.5 with two unpatched HIGH advisories whose fixes ship
 * only from the vendor's own CDN -- is untouched by anything here.
 *
 * ## WHAT THE THREE REAL WORKBOOKS TAUGHT THIS FILE
 *
 * Read 2026-09-09, gitignored, three different layouts and no two alike. Every
 * branch below earns its place from one of them:
 *
 *  - All three are plain OOXML: `[Content_Types].xml`, `xl/workbook.xml`,
 *    `xl/worksheets/sheet1.xml`, `xl/sharedStrings.xml`, `xl/styles.xml`, with
 *    the default spreadsheetml namespace and no element prefixes.
 *  - **Sheet names are not file names.** One of them names its only sheet
 *    `metro-e` with `sheetId="3"`. The part it lives in is found through
 *    `xl/_rels/workbook.xml.rels`, never by assuming `sheet1.xml` -- a
 *    workbook whose sheets were reordered or deleted in Excel keeps the old
 *    part names, so the assumption reads the wrong sheet in a file that opens
 *    perfectly.
 *  - **Date serials are real.** The second workbook stores a start date as the
 *    number `46255`, styled through a custom `<numFmt>` (`[$-13809]dd/mm/yyyy`)
 *    AND through built-in format 14. Handing `46255` to an operator, or
 *    comparing it against a date read off a scan, produces a mismatch that is
 *    not one and a recommendation to overwrite a correct cell.
 *  - **Custom format ids collide with built-in ones.** The third workbook
 *    redefines id 44 as a Rupiah accounting format. A custom `<numFmt>` entry
 *    therefore WINS over the built-in table; reading the table first would
 *    have called that column dates.
 *  - Empty styled cells (`<c r="C1" s="9"/>`) are everywhere in the transposed
 *    workbook and carry nothing. They are skipped, and skipping them is what
 *    keeps the listing the model reads down to the cells that say something.
 *  - **A declared `<dimension>` overstates.** The transposed workbook declares
 *    `A1:AN8` and its last cell holding anything is in row 6: row 7 is absent
 *    entirely and row 8 is a single styled, valueless `<c r="T8" s="7"/>`.
 *    `Sheet.dimension` is therefore computed from the cells actually read.
 *    Copying the declared extent would advertise two rows of addresses the
 *    listing cannot show, which is an invitation to name one of them.
 *
 * Measured over those three files: 115, 58 and 159 non-empty cells; computed
 * extents `A1:E35`, `A1:P4` and `A1:AN6`. The four date cells are all in the
 * second, two distinct serials each appearing twice; both round-trip to the
 * same day when checked against an independent anchor.
 *
 * ## NOTHING HERE GUESSES
 *
 * Every refusal is a `WorkbookUnreadable` naming what was wrong, in English,
 * because every alternative is a workbook that reads as complete and is short.
 * A sheet whose part cannot be resolved stops the whole file rather than being
 * dropped: a silently missing sheet is a set of fields the model is never shown
 * and therefore reports as absent, which is indistinguishable to an operator
 * from the workbook genuinely not having them.
 */

import JSZip from "jszip";

import type { CellRef } from "../config/types.ts";
import { formatRef, numberToCol, parseRef, type Cell, type CellKind, type Sheet, type Workbook } from "./grid.ts";

/**
 * The one refusal this module makes, always naming the part that was wrong.
 *
 * It is a distinct type rather than a bare `Error` so a route can answer 400
 * ("this file is not a workbook we can read") instead of 500, and so the
 * operator-facing sentence is composed once, upstream, in Bahasa, from a
 * cause it can actually name.
 */
export class WorkbookUnreadable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbookUnreadable";
  }
}

const WORKBOOK_PART = "xl/workbook.xml";
const WORKBOOK_RELS = "xl/_rels/workbook.xml.rels";
const SHARED_STRINGS_PART = "xl/sharedStrings.xml";
const STYLES_PART = "xl/styles.xml";

/**
 * The highest serial Excel itself will render as a date: 9999-12-31.
 *
 * Above it a date-styled cell shows `####`, so treating a larger number as a
 * date would invent a year no spreadsheet ever displayed. Such a cell falls
 * back to its plain numeric rendering, which is at least what is stored.
 */
const MAX_DATE_SERIAL = 2958465;

const MS_PER_DAY = 86_400_000;

/**
 * What one style index makes a number DISPLAY as, when it is not just a number.
 *
 * `null` covers every format that decorates a number without changing it --
 * currency, thousands separators, colours, alignment. Only `date` and
 * `percent` make the stored number and the shown number different numbers.
 */
type StyleFormat = "date" | "percent" | null;

// ---------------------------------------------------------------------------
// XML, at the level this file needs it
// ---------------------------------------------------------------------------

/**
 * `&amp;` IS UNESCAPED LAST, and the order is the whole point.
 *
 * A document containing `&amp;lt;` means the four literal characters `&lt;`.
 * Unescaping `&amp;` first turns it into `&lt;`, which the next pass then
 * turns into `<` -- so a cell whose text quotes an entity comes back as
 * markup, and in a workbook full of configuration strings that is a value
 * changed in transit with nothing to notice it. Numeric references are decoded
 * before `&amp;` for the same reason and are safe there: `&amp;#65;` contains
 * no `&#` substring for the numeric pass to find.
 */
function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_all, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_all, dec: string) => codePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

/** An out-of-range reference is left as-is rather than throwing on a file we can otherwise read. */
function codePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

/** Attribute soup out of one start tag, values already unescaped. */
function attrs(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const found of source.matchAll(/([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\s*=\s*"([^"]*)"/g)) {
    out[found[1]] = unescapeXml(found[2]);
  }
  return out;
}

/**
 * The text of an `<si>` or an `<is>`: every `<t>` inside, concatenated.
 *
 * RICH TEXT SPLITS ONE STRING ACROSS SEVERAL RUNS. A cell reading
 * `PSB VPN IP KCP Contoh` with two words in bold is stored as three `<r>`
 * elements, so taking only the first `<t>` yields a truncated label -- and a
 * truncated label is worse than none here, because `config-interpret.ts`
 * checks that a field's name is a SUBSTRING of the cell it cites and a prefix
 * passes that check while naming the wrong thing.
 *
 * `<rPh>` is dropped first. It carries a phonetic reading, not the string, and
 * concatenating it would append a second spelling of the same words to every
 * affected cell.
 */
function joinText(fragment: string): string {
  const withoutPhonetics = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const found of withoutPhonetics.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) {
    out += unescapeXml(found[1] ?? "");
  }
  return out;
}

/** The content of the first `<name>` element, or null when the part has none. */
function elementBody(xml: string, name: string): string | null {
  const found = new RegExp(`<${name}\\b[^>]*?(\\/>|>([\\s\\S]*?)<\\/${name}>)`).exec(xml);
  if (!found) return null;
  return found[2] ?? "";
}

// ---------------------------------------------------------------------------
// Shared strings and styles
// ---------------------------------------------------------------------------

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  for (const found of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    out.push(joinText(found[1] ?? ""));
  }
  return out;
}

/**
 * Which cell formats render as a date, indexed by `<c s="...">`.
 *
 * The lookup is deliberately two-stage. A workbook may redefine a built-in id
 * -- the third real workbook redefines 44 as Rupiah accounting -- so an
 * explicit `<numFmt>` wins and the built-in ranges are only the fallback. The
 * other direction, reading the ranges first, calls that Rupiah column a set of
 * dates and turns every price in the sheet into a day in 1900.
 *
 * `<cellStyleXfs>` also holds `<xf>` elements and is NOT this list. Slicing
 * `<cellXfs>` out by name before scanning is what keeps a cell's `s` index
 * pointing at the format it actually carries.
 */
/**
 * WHAT EACH STYLE INDEX DISPLAYS AS: a date, a percent, or a plain number.
 *
 * It answered only the first question for a while, and the second is the same
 * defect one format along. A percent cell stores the FRACTION and displays the
 * hundredths: `E29` of the sample bundle's own configuration workbook holds
 * `0.995` under `numFmtId="10"` (`0.00%`), and Excel shows `99.50%` next to
 * the label `MPLS VPN IP SLG`. Read as a bare number, the operator is shown
 * `0.995` for a value their workbook displays as `99.50%`, and the comparison
 * against a scan that says `99,5%` reports a mismatch and recommends
 * overwriting a cell that was right.
 *
 * CURRENCY AND THOUSANDS SEPARATORS ARE DELIBERATELY NOT HERE. `_-"Rp"* #,##0.00_-`
 * changes how a number is DECORATED, not what it is: 120341172.5 is that
 * number whether or not a spreadsheet paints `Rp` in front of it, and
 * rendering the decoration would put a currency symbol into a cell value that
 * is then compared against a scan, and written back as text. Percent is the
 * only common format where the stored number and the displayed number are
 * different NUMBERS.
 */
function parseDateStyles(xml: string | null): StyleFormat[] {
  if (!xml) return [];

  const custom = new Map<number, string>();
  const numFmts = elementBody(xml, "numFmts");
  if (numFmts) {
    for (const found of numFmts.matchAll(/<numFmt\b([^>]*)>/g)) {
      const attr = attrs(found[1]);
      const id = Number(attr.numFmtId);
      if (Number.isInteger(id) && typeof attr.formatCode === "string") {
        custom.set(id, attr.formatCode);
      }
    }
  }

  const cellXfs = elementBody(xml, "cellXfs");
  if (cellXfs === null) return [];

  const out: StyleFormat[] = [];
  for (const found of cellXfs.matchAll(/<xf\b([^>]*)>/g)) {
    const id = Number(attrs(found[1]).numFmtId ?? "0");
    if (!Number.isInteger(id)) {
      out.push(null);
      continue;
    }
    const code = custom.get(id);
    if (code === undefined) {
      // A CUSTOM CODE WINS OVER THE BUILT-IN TABLE, which is why this branch
      // is only reached when there is none. The third real workbook redefines
      // built-in id 44 as a Rupiah accounting format, and reading the built-in
      // ranges first would have called that column dates.
      out.push(
        isBuiltInDateFormat(id)
          ? "date"
          : isBuiltInPercentFormat(id)
            ? "percent"
            : null,
      );
      continue;
    }
    out.push(formatOf(code));
  }
  return out;
}

/** 9 is `0%` and 10 is `0.00%`. No other built-in id displays a percent. */
function isBuiltInPercentFormat(id: number): boolean {
  return id === 9 || id === 10;
}

/**
 * What a custom format code displays as.
 *
 * DATE IS TESTED FIRST, so the two tests are independent rather than mutually
 * exclusive by luck: a date code may legitimately print a `%` from a quoted
 * literal, and `stripLiterals` is shared so both read the same bare code. An
 * unquoted `%` is Excel's multiply-by-100 marker; a `"%"` inside quotes is a
 * printed character and means nothing.
 */
function formatOf(code: string): StyleFormat {
  const bare = stripLiterals(code);
  if (/[dmyhs]/i.test(bare)) return "date";
  return bare.includes("%") ? "percent" : null;
}

/** 14-22 are the date formats, 45-47 the elapsed-time ones. Every other built-in id is not a date. */
function isBuiltInDateFormat(id: number): boolean {
  return (id >= 14 && id <= 22) || (id >= 45 && id <= 47);
}

/**
 * Does this format code display a date or a time?
 *
 * The test is "an unquoted d, m, y, h or s survives", and every one of the
 * strips below exists because something in a real workbook would otherwise
 * have been read as a date:
 *
 *  - `"..."` quoted literals. `_-"Rp"* #,##0.00_-` is a currency format from
 *    the third workbook; without the strip its `Rp` would be looked at, and a
 *    literal like `"day"` in any format code would decide the question.
 *  - `[...]` sections. `[Red]#,##0` is a plain number format containing a `d`,
 *    and `[$-13809]dd/mm/yyyy` is a real date whose locale bracket must not be
 *    what proves it. The one exception is `[h]`/`[mm]`/`[ss]`, which is
 *    elapsed time -- a bracket that IS the format token -- so it is kept.
 *  - `\x` escapes and `_x` width placeholders, whose next character is a
 *    literal rather than a token, and `*x` fill characters, same.
 */
function isDateFormatCode(code: string): boolean {
  return /[dmyhs]/i.test(stripLiterals(code));
}

/**
 * A format code with everything that is PRINTED stripped out, leaving only the
 * tokens that decide what it displays. See `isDateFormatCode` for why each
 * strip is here.
 */
function stripLiterals(code: string): string {
  let remaining = "";
  for (let i = 0; i < code.length; i += 1) {
    const char = code[i];
    if (char === '"') {
      i += 1;
      while (i < code.length && code[i] !== '"') i += 1;
      continue;
    }
    if (char === "\\" || char === "_" || char === "*") {
      i += 1;
      continue;
    }
    if (char === "[") {
      let end = i + 1;
      while (end < code.length && code[end] !== "]") end += 1;
      const inner = code.slice(i + 1, end);
      i = end;
      if (/^(?:h+|m+|s+)$/i.test(inner)) remaining += inner;
      continue;
    }
    remaining += char;
  }
  return remaining;
}

// ---------------------------------------------------------------------------
// Numbers and dates
// ---------------------------------------------------------------------------

/**
 * A stored number as a person reads it: no exponent, no float noise.
 *
 * Both halves are corrections, not polish. `String(1e21)` is `"1e+21"`, and an
 * operator asked to confirm a bandwidth or a price against a scan cannot
 * compare a value written in exponent notation to one printed on a page.
 * `0.1 + 0.2` stored by a spreadsheet arrives as `0.30000000000000004`, and a
 * comparison stage handed that reports a mismatch against a document that says
 * `0,3` -- which is a recommendation to overwrite a correct cell.
 *
 * `toPrecision(15)` is what collapses the noise: a double carries about 15-17
 * significant decimal digits, so 15 is the widest rounding that is guaranteed
 * to drop the artefacts without touching a value anybody typed. Integers go
 * through `BigInt` instead, which has no exponent form at any magnitude.
 */
function plainNumber(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw.trim();
  if (Number.isInteger(value)) return BigInt(value).toString();
  const precise = value.toPrecision(15);
  return trimTrailingZeros(precise.includes("e") ? expandExponent(precise) : precise);
}

function trimTrailingZeros(text: string): string {
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

/** `"1.00000000000000e-7"` -> `"0.000000100000000000000"`, so the caller can trim it. */
function expandExponent(text: string): string {
  const found = /^(-?)([0-9]+)(?:\.([0-9]+))?e([+-][0-9]+)$/i.exec(text);
  if (!found) return text;
  const sign = found[1];
  const digits = found[2] + (found[3] ?? "");
  const pointAt = found[2].length + Number(found[4]);
  if (pointAt <= 0) return `${sign}0.${"0".repeat(-pointAt)}${digits}`;
  if (pointAt >= digits.length) return `${sign}${digits}${"0".repeat(pointAt - digits.length)}`;
  return `${sign}${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
}

/**
 * A serial number to a calendar date, INCLUDING Excel's 1900 leap-year bug.
 *
 * Excel believes 1900 was a leap year. It was not: 1900 is divisible by 100
 * and not by 400. Serial 60 is a day that never existed, and every serial
 * above it is therefore one greater than a naive count from 1900-01-01 would
 * give. Getting this wrong is a one-day error in exactly one direction, on
 * every date after February 1900 -- which is every date in these workbooks --
 * and a one-day error is the kind that looks like a transcription difference
 * rather than a bug.
 *
 *   59 -> 28/02/1900, 60 -> 29/02/1900 (the phantom), 61 -> 01/03/1900.
 *
 * Serial 60 is rendered as Excel renders it rather than corrected, because the
 * job here is to show the operator what their own spreadsheet shows them.
 *
 * Returns null when the number cannot be a calendar date, and the caller then
 * renders it as a number. A 1900-system serial below 1 is a time of day (0.5
 * is noon) or the zero date Excel writes as `00/01/1900`; printing either as a
 * date would be a fabricated date, and this project's whole failure class is a
 * plausible wrong answer where an honest one was available.
 */
function serialToDate(serial: number, date1904: boolean): { day: number; month: number; year: number } | null {
  const days = Math.floor(serial);
  if (days > MAX_DATE_SERIAL) return null;

  if (date1904) {
    // The 1904 system counts from 1904-01-01 = 0 and has no phantom day.
    if (days < 0) return null;
    return fromUtc(Date.UTC(1904, 0, 1) + days * MS_PER_DAY);
  }
  if (days < 1) return null;
  if (days === 60) return { day: 29, month: 2, year: 1900 };
  const epoch = days > 60 ? Date.UTC(1899, 11, 30) : Date.UTC(1899, 11, 31);
  return fromUtc(epoch + days * MS_PER_DAY);
}

/** UTC throughout, so the machine's timezone cannot move a date across midnight. */
function fromUtc(ms: number): { day: number; month: number; year: number } {
  const at = new Date(ms);
  return { day: at.getUTCDate(), month: at.getUTCMonth() + 1, year: at.getUTCFullYear() };
}

/**
 * DD/MM/YYYY, which is what these workbooks' own headers ask for.
 *
 * Not a locale guess: the second real workbook styles its date column
 * `[$-13809]dd/mm/yyyy` (13809 is Indonesian), and its row 1 type hints name
 * the same shape in words. Rendering 06/09/2026 as 09/06/2026 would be a
 * three-month error that reads as a valid date.
 */
function formatDate(parts: { day: number; month: number; year: number }): string {
  const dd = String(parts.day).padStart(2, "0");
  const mm = String(parts.month).padStart(2, "0");
  const yyyy = String(parts.year).padStart(4, "0");
  return `${dd}/${mm}/${yyyy}`;
}

// ---------------------------------------------------------------------------
// One worksheet
// ---------------------------------------------------------------------------

type SheetContext = {
  sharedStrings: string[];
  dateStyles: StyleFormat[];
  date1904: boolean;
};

/**
 * Turns one worksheet part into cells.
 *
 * Cells are scanned in document order and their addresses are taken from their
 * own `r` attribute. Where a cell has none -- legal in the format, position is
 * then implied -- the position is COUNTED rather than skipped, because a
 * skipped cell is a value that silently is not there and this file has no way
 * to warn about one it never saw.
 */
function parseSheet(name: string, xml: string, context: SheetContext): Sheet {
  const cells: Cell[] = [];
  const body = elementBody(xml, "sheetData") ?? "";

  let row = 0;
  let nextCol = 1;

  const tokens = /<row\b([^>]*?)\/?>|<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
  for (const found of body.matchAll(tokens)) {
    if (found[1] !== undefined) {
      const declared = Number(attrs(found[1]).r);
      row = Number.isInteger(declared) && declared >= 1 ? declared : row + 1;
      nextCol = 1;
      continue;
    }

    const attributes = attrs(found[2] ?? found[3] ?? "");
    const inner = found[4] ?? "";

    let col: number;
    if (attributes.r) {
      const at = parseRef(attributes.r);
      col = at.col;
      row = at.row;
    } else {
      col = nextCol;
    }
    nextCol = col + 1;

    const cell = readCell(formatRef(col, row), col, row, attributes, inner, context);
    if (cell) cells.push(cell);
  }

  // Stable, so two cells claiming one address stay in the order the file wrote
  // them and `byRef` can take the first.
  cells.sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row));

  const byRef = new Map<CellRef, Cell>();
  for (const cell of cells) if (!byRef.has(cell.ref)) byRef.set(cell.ref, cell);

  let rows = 0;
  let cols = 0;
  for (const cell of cells) {
    if (cell.row > rows) rows = cell.row;
    if (cell.col > cols) cols = cell.col;
  }

  return {
    name,
    cells,
    byRef,
    dimension: cells.length === 0 ? "" : `A1:${numberToCol(cols)}${rows}`,
    rows,
    cols,
    merges: parseMerges(xml),
  };
}

function parseMerges(xml: string): string[] {
  const body = elementBody(xml, "mergeCells");
  if (!body) return [];
  const out: string[] = [];
  for (const found of body.matchAll(/<mergeCell\b([^>]*)>/g)) {
    const ref = attrs(found[1]).ref;
    if (ref) out.push(ref);
  }
  return out;
}

/**
 * One `<c>` element to a `Cell`, or null when it holds nothing.
 *
 * A cell is skipped when its rendered text is empty after trimming, and a cell
 * holding a literal `0` is kept -- the two are a real distinction in these
 * workbooks. `0` is an answer somebody entered; an empty cell EPIC expects
 * filled is exactly what Checkpoint 2 exists to find, and it is found by the
 * FIELD having no value, not by a blank row in the listing the model reads.
 *
 * `kind: "formula"` takes precedence over how the value renders, because the
 * fact a consumer must not lose about such a cell is that a patch to it
 * destroys a computation. Its `text` still goes through the same date and
 * number rendering, so what an operator reads is unaffected.
 */
function readCell(
  ref: CellRef,
  col: number,
  row: number,
  attributes: Record<string, string>,
  inner: string,
  context: SheetContext,
): Cell | null {
  const type = attributes.t ?? "n";
  const stored = elementBody(inner, "v");
  const hasFormula = /<f\b[^>]*?(?:\/>|>)/.test(inner);

  let text: string;
  let raw: string | undefined;
  let kind: CellKind;

  if (type === "s") {
    // A MISSING OR EMPTY `<v>` IS NOT INDEX ZERO, and reading it as one is the
    // sharpest edge in this file. `elementBody` returns `""` for a
    // self-closing `<v/>` and `null` for no element at all, and `Number("")`
    // is 0, so without this guard `<c r="E9" t="s"><v/></c>` would resolve to
    // the FIRST string in the shared table -- some other cell's text, rendered
    // in a cell that is actually empty, with nothing anywhere looking wrong.
    // That is this project's failure class exactly, and it is reachable: an
    // empty cell carrying a style is ordinary in these workbooks, and one that
    // is *also* typed `s` is what an editor leaves behind when a value is
    // deleted from a text-formatted cell. The number branch below already
    // guards the same shape; this one did not.
    if (stored === null || stored.trim() === "") return null;
    const index = Number(stored);
    const resolved = Number.isInteger(index) ? context.sharedStrings[index] : undefined;
    // An index the shared string table does not have is a corrupt file, not an
    // empty cell; there is nothing honest to render, so the cell is dropped
    // rather than shown as blank beside a label that promises a value.
    if (resolved === undefined) return null;
    text = resolved;
    kind = "text";
  } else if (type === "inlineStr") {
    text = joinText(elementBody(inner, "is") ?? "");
    kind = "text";
  } else if (type === "str") {
    text = unescapeXml(stored ?? "");
    kind = "formula";
  } else if (type === "b") {
    // Same rule as the two branches around it: a boolean cell with no stored
    // value is empty, not FALSE. Printing FALSE would be this layer answering
    // a question the workbook did not.
    if (stored === null || stored.trim() === "") return null;
    const on = stored.trim() === "1";
    text = on ? "TRUE" : "FALSE";
    raw = on ? "1" : "0";
    kind = "boolean";
  } else if (type === "e") {
    // `#REF!`, `#N/A`. There is no error kind, and there should not be: what a
    // person reads in that cell is the literal, so that is what `text` says.
    text = unescapeXml(stored ?? "");
    kind = "text";
  } else {
    if (stored === null || stored.trim() === "") return null;
    const value = Number(stored);
    const format = context.dateStyles[Number(attributes.s ?? "0")] ?? null;
    const dated =
      format === "date" && Number.isFinite(value)
        ? serialToDate(value, context.date1904)
        : null;
    if (dated) {
      text = formatDate(dated);
      raw = stored.trim();
      kind = "date";
    } else if (format === "percent" && Number.isFinite(value)) {
      /*
       * A PERCENT CELL STORES THE FRACTION AND SHOWS THE HUNDREDTHS, so the
       * stored number and the displayed number are different numbers and this
       * is not formatting.
       *
       * Found by review against the sample bundle's own configuration
       * workbook: `E29` holds `0.995` under built-in format 10 (`0.00%`) and
       * Excel shows `99.50%` beside the label `MPLS VPN IP SLG`. Rendered as
       * `0.995` the operator is shown a number their own file does not
       * display, and the comparison against a scan reading `99,5%` reports a
       * mismatch that is not one and recommends overwriting a correct cell.
       *
       * `raw` keeps the stored fraction, so nothing downstream has lost the
       * number the file actually holds.
       */
      text = `${plainNumber(String(value * 100))}%`;
      raw = stored.trim();
      kind = "number";
    } else {
      text = plainNumber(stored);
      raw = text === stored.trim() ? undefined : stored.trim();
      kind = "number";
    }
  }

  if (hasFormula) kind = "formula";

  // Ends only. An internal newline is content a cell genuinely holds, and a
  // consumer that lays cells out one per line has to escape it rather than
  // have this layer quietly rewrite what the workbook says.
  const trimmed = text.replace(/^\s+|\s+$/g, "");
  if (trimmed === "") return null;

  return raw === undefined ? { ref, row, col, text: trimmed, kind } : { ref, row, col, text: trimmed, raw, kind };
}

// ---------------------------------------------------------------------------
// The workbook
// ---------------------------------------------------------------------------

/** Resolves a relationship target against `xl/`, where the workbook part lives. */
function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = "xl".split("/").concat(target.split("/"));
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

/**
 * Every sheet of one workbook, in workbook order.
 *
 * Refuses rather than returns a partial reading. The three `WorkbookUnreadable`
 * causes -- not a zip, no workbook part, a sheet whose worksheet part cannot be
 * resolved -- are each a file this tool cannot honestly report on, and a
 * partial reading of a configuration workbook is a set of fields reported as
 * absent from documents that in fact contain them.
 */
export async function readWorkbook(bytes: Uint8Array): Promise<Workbook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new WorkbookUnreadable(`this file is not a zip archive, so it is not an .xlsx workbook: ${detail}`);
  }

  const workbookXml = await zip.file(WORKBOOK_PART)?.async("string");
  if (workbookXml === undefined) {
    throw new WorkbookUnreadable(
      `this archive has no ${WORKBOOK_PART}, so it is a zip but not an Excel workbook (an .xlsb or .xls saved with the wrong extension reads this way)`,
    );
  }

  const relsXml = (await zip.file(WORKBOOK_RELS)?.async("string")) ?? "";
  const targets = new Map<string, string>();
  for (const found of relsXml.matchAll(/<Relationship\b([^>]*)>/g)) {
    const attr = attrs(found[1]);
    if (attr.Id && attr.Target) targets.set(attr.Id, resolveTarget(attr.Target));
  }

  const context: SheetContext = {
    sharedStrings: parseSharedStrings((await zip.file(SHARED_STRINGS_PART)?.async("string")) ?? null),
    dateStyles: parseDateStyles((await zip.file(STYLES_PART)?.async("string")) ?? null),
    date1904: /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(workbookXml),
  };

  const declared = [...(elementBody(workbookXml, "sheets") ?? "").matchAll(/<sheet\b([^>]*)>/g)].map((found) =>
    attrs(found[1]),
  );
  if (declared.length === 0) {
    throw new WorkbookUnreadable(`${WORKBOOK_PART} declares no sheets`);
  }

  const sheets: Sheet[] = [];
  for (const [position, attr] of declared.entries()) {
    const name = attr.name ?? `Sheet${position + 1}`;
    const relId = attr["r:id"] ?? attr.id;
    const path = relId ? targets.get(relId) : undefined;
    if (!path) {
      throw new WorkbookUnreadable(
        `sheet ${JSON.stringify(name)} names relationship ${JSON.stringify(relId ?? "(none)")}, which ${WORKBOOK_RELS} does not map to a part`,
      );
    }
    const sheetXml = await zip.file(path)?.async("string");
    if (sheetXml === undefined) {
      throw new WorkbookUnreadable(
        `sheet ${JSON.stringify(name)} points at ${path}, which this archive does not contain`,
      );
    }
    sheets.push(parseSheet(name, sheetXml, context));
  }

  return { sheets, sheetNames: sheets.map((sheet) => sheet.name) };
}
