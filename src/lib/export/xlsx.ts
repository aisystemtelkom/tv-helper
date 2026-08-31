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

    if (value?.source) {
      const [from, to] = value.source.lineRange;
      // Provenance travels with the value, so a reviewer can check the claim
      // without rerunning anything.
      added.getCell(5).note =
        `page ${value.source.pageIndex}, lines ${from}-${to}`;
    }
  }

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
