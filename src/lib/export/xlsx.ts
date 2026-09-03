import exceljs from "exceljs";
import type { Template } from "../forms/template.ts";
import type { FieldValue } from "../pipeline/fields.ts";

/**
 * Rows carrying no fieldKey are the EPIC-only ones (Customer Account,
 * Billing Account, Sales Team, LatLong). They stay blank by construction,
 * because nothing can match them, rather than by a check someone can delete.
 */
export async function buildXlsx(
  template: Template,
  values: FieldValue[],
): Promise<Uint8Array> {
  const byKey = new Map(values.map((v) => [v.fieldKey, v]));

  const workbook = new exceljs.Workbook();
  const sheet = workbook.addWorksheet("Order Config");

  sheet.addRow(["Nomor", "Item I", "Item II", "Keterangan", ""]);

  for (const row of template.xlsxRows) {
    const value = row.fieldKey ? byKey.get(row.fieldKey) : undefined;
    const added = sheet.addRow([
      row.nomor ?? "",
      row.itemI ?? "",
      row.itemII ?? "",
      row.keterangan ?? "",
      value?.value ?? "",
    ]);

    if (value?.requestSource) {
      // The deterministic path's provenance. A value read out of the order
      // request has no page and no line range -- there was no OCR and no model
      // call -- so the note names the cell it came from instead: file, sheet,
      // column, header, and every row that carried the same text. Written in
      // the same place and the same style as a citation because a reviewer
      // checking a cell should not have to know which pipeline filled it, only
      // where to look; and a request-supplied cell with NO note would read as
      // an unsourced guess, which is the one thing it is not.
      const { file, sheet, column, header, rows } = value.requestSource;
      added.getCell(5).note =
        `${file} sheet "${sheet}", ` +
        `${rows.length === 1 ? "row" : "rows"} ${rows.join(", ")}, ` +
        `column ${column} (${header})`;
    } else if (value?.source) {
      // EVERY citation behind the cell, not just the first. A list-valued key
      // (`Template.fieldLists`) prints several answers in one cell, and a note
      // naming one line range for all of them is provenance that is true about
      // part of the cell and reads as true about the whole -- the same failure
      // shape as a citation that is simply wrong. `sources` is absent for
      // every single-valued key, where this collapses to exactly the one note
      // it always wrote.
      const cited = value.sources ?? [value.source];
      const notes = cited.map((source) => {
      const [from, to] = source.lineRange;
      const { sourceName, pageInDoc } = source;
      // Name the actual file and its own (1-based) page number when they
      // travelled with the value, not this run's bundle-global page index --
      // that index is 0-based across every PDF on the command line, so for
      // every page after the first source file it sent a reviewer to the
      // wrong document (task-11 finding 2). Fall back to the bundle-global
      // number only when a caller hasn't supplied the page's true identity.
      // THE FALLBACK DELIBERATELY DOES NOT SAY "page". It has only the
      // bundle-global position, which is 0-based AND counted across every PDF
      // on the command line, so rendering it as "page 3" would read as the
      // fourth page of some unnamed document and send a reviewer to neither.
      // Two notes in one sheet reading "contract.pdf p4" and "page 3" for the
      // SAME page is the shape this whole file exists to avoid: a number that
      // is internally consistent and means something else to its reader.
      const location =
        sourceName !== undefined && pageInDoc !== undefined
          ? `${sourceName} p${pageInDoc + 1}`
          : `bundle position ${source.pageIndex} (0-based; the source ` +
            `file did not travel with this value)`;
        return `${location}, lines ${from}-${to}`;
      });
      // Provenance travels with the value, so a reviewer can check the claim
      // without rerunning anything.
      added.getCell(5).note = notes.join("; ");
    }
  }

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
