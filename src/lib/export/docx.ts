import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  WidthType,
} from "docx";
import type { SectionDef, Template } from "../forms/template.ts";

export type FilledSlot = {
  key: string;
  png: Uint8Array;
  widthPx: number;
  heightPx: number;
};

export type HeaderFields = {
  idEpic: string;
  namaProyek: string;
  quote: string;
  cc: string;
  order: string;
  jenisOrder: string;
};

/**
 * docx sizes images in PIXELS AT 96 DPI (it multiplies by 9525 EMU each), not
 * points. Crops are cut at 300 DPI, so converting to points instead renders
 * every image at 75% of its true size, which looks plausible and is wrong.
 */
const CROP_DPI = 300;
const DOCX_PX_PER_INCH = 96;
const toDocxPx = (px: number) => (px / CROP_DPI) * DOCX_PX_PER_INCH;

function imageParagraph(slot: FilledSlot): Paragraph {
  return new Paragraph({
    children: [
      new ImageRun({
        // Required in docx v9. Omitting it names the part
        // word/media/<hash>.undefined, which has no content type, and Word
        // refuses to open the file.
        type: "png",
        data: slot.png,
        transformation: {
          width: toDocxPx(slot.widthPx),
          height: toDocxPx(slot.heightPx),
        },
      }),
    ],
  });
}

/**
 * Groups by key rather than keying one slot per name, because a `SlotDef` can
 * declare `crops: 2` -- the sample's `KB (lanjutan)` ToP row stacks two
 * pictures in a single cell. A `Map<string, FilledSlot>` keeps only the last
 * one and silently drops the other, shipping a document that looks complete
 * and is missing evidence. Insertion order is the stacking order.
 */
function groupByKey(filled: FilledSlot[]): Map<string, FilledSlot[]> {
  const byKey = new Map<string, FilledSlot[]>();
  for (const slot of filled) {
    const existing = byKey.get(slot.key);
    if (existing) existing.push(slot);
    else byKey.set(slot.key, [slot]);
  }
  return byKey;
}

function renderSection(
  section: SectionDef,
  byKey: Map<string, FilledSlot[]>,
  quote: string,
): (Paragraph | Table)[] {
  const heading = new Paragraph({
    text: section.title,
    heading: HeadingLevel.HEADING_2,
  });

  if (section.layout === "images") {
    // An empty section still emits its heading: the sample ships MOM, BASO,
    // and BA Penjelasan Order empty, and the operator fills them by hand.
    return [
      heading,
      ...section.slots
        .flatMap((slotDef) => byKey.get(slotDef.key) ?? [])
        .map(imageParagraph),
    ];
  }

  // A `<w:tbl>` with no `<w:tr>` is schema-invalid and Word refuses the file.
  // The AO template has no slotless table section, but this takes a Template,
  // not that one template.
  if (section.slots.length === 0) return [heading];

  return [
    heading,
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: section.slots.map((slotDef) => {
        const crops = byKey.get(slotDef.key) ?? [];
        return new TableRow({
          children: [
            new TableCell({
              children: [
                // The Konfigurasi table labels one row with the quote number.
                new Paragraph(slotDef.label.replace("{{quote}}", quote)),
              ],
            }),
            new TableCell({
              // A deliberately empty cell is the deliverable for the six EPIC
              // and spreadsheet slots: it is where the operator pastes. Do
              // not omit the row.
              children:
                crops.length > 0
                  ? crops.map(imageParagraph)
                  : [new Paragraph("")],
            }),
          ],
        });
      }),
    }),
  ];
}

export async function buildDocx(
  template: Template,
  header: HeaderFields,
  filled: FilledSlot[],
): Promise<Uint8Array> {
  const byKey = groupByKey(filled);

  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      ["ID EPIC :", header.idEpic, "NAMA Proyek :", header.namaProyek],
      ["QUOTE :", header.quote, "CC :", header.cc],
      ["ORDER :", header.order, "JENIS ORDER :", header.jenisOrder],
    ].map(
      (cells) =>
        new TableRow({
          children: cells.map(
            (text) => new TableCell({ children: [new Paragraph(text)] }),
          ),
        }),
    ),
  });

  const doc = new Document({
    title: template.label,
    sections: [
      {
        children: [
          headerTable,
          ...template.sections.flatMap((section) =>
            renderSection(section, byKey, header.quote),
          ),
        ],
      },
    ],
  });

  // `Packer.toBuffer` asks JSZip for a "nodebuffer", which throws in a browser
  // with no `Buffer` polyfill -- and this pipeline runs in the browser by
  // design. `toArrayBuffer` is the environment-neutral output, and wrapping it
  // is a view, not a copy.
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}
