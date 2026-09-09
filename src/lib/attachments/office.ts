"use client";

/**
 * Extracts plain text from a Word document.
 *
 * A vision model has no way to open a .docx -- it reads images and text. The
 * converter runs in the browser, so only extracted text is uploaded, never
 * the original file.
 *
 * IT USED TO CONVERT SPREADSHEETS TOO, and that half is deliberately gone:
 * Excel is not an input to this product. The whole surface went with it --
 * the `exceljs` dependency, the `.xlsx` entries in the composer's `accept`
 * list, and the pipeline's own order-request reader.
 */

/** Enough context for the model without flooding an 8K window. */
const MAX_CHARS = 20_000;

const truncate = (text: string, note: string) =>
  text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[${note}]` : text;

export const extractDocumentText = async (file: Blob): Promise<string> => {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({
    arrayBuffer: await file.arrayBuffer(),
  });

  const text = value.trim();
  if (!text) return "[The document contains no extractable text.]";

  return truncate(text, "truncated: document too long");
};
