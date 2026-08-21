"use client";

/**
 * Extracts plain text from Office documents.
 *
 * Gemma has no way to open a spreadsheet -- it reads images and text. Both
 * converters here run in the browser, so the file never leaves the machine.
 *
 * Note on the spreadsheet library: the obvious choice, `xlsx` (SheetJS), is
 * frozen on npm at 0.18.5 with two unpatched HIGH advisories (prototype
 * pollution, ReDoS) whose fixes ship only via the vendor's own CDN. Parsing
 * untrusted user files is exactly that threat model, so this uses `exceljs`.
 */

/** Enough context for the model without flooding an 8K window. */
const MAX_ROWS = 200;
const MAX_CHARS = 20_000;

const truncate = (text: string, note: string) =>
  text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[${note}]` : text;

/** Renders a workbook as CSV per sheet, which models read reliably. */
export const extractSpreadsheetText = async (file: Blob): Promise<string> => {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  const sheets: string[] = [];

  workbook.eachSheet((sheet) => {
    const rows: string[] = [];
    let truncatedRows = false;

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS) {
        truncatedRows = true;
        return;
      }

      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map(formatCell).join(","));
    });

    const body = rows.join("\n");
    const suffix = truncatedRows
      ? `\n[truncated at ${MAX_ROWS} rows of ${sheet.rowCount}]`
      : "";

    sheets.push(`## Sheet: ${sheet.name}\n${body}${suffix}`);
  });

  if (sheets.length === 0) return "[The spreadsheet has no readable sheets.]";

  return truncate(sheets.join("\n\n"), "truncated: spreadsheet too large");
};

const formatCell = (value: unknown): string => {
  if (value === null || value === undefined) return "";

  // ExcelJS returns objects for formulas, hyperlinks, and rich text.
  if (typeof value === "object") {
    const cell = value as Record<string, unknown>;
    if (typeof cell.result === "string" || typeof cell.result === "number") {
      return String(cell.result);
    }
    if (typeof cell.text === "string") return cell.text;
    if (Array.isArray(cell.richText)) {
      return cell.richText
        .map((part) => (part as { text?: string }).text ?? "")
        .join("");
    }
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return "";
  }

  const text = String(value);
  // Quote anything that would corrupt the CSV shape.
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const extractDocumentText = async (file: Blob): Promise<string> => {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });

  const text = value.trim();
  if (!text) return "[The document contains no extractable text.]";

  return truncate(text, "truncated: document too long");
};
