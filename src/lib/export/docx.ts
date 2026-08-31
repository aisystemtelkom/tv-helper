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

/**
 * Transcribed from the sample's own `word/document.xml` `<w:sectPr>`:
 * `<w:pgSz w:w="11901" w:h="16817"/>` and
 * `<w:pgMar w:top="873" w:right="907" w:bottom="941" w:left="1026" .../>`.
 * Twips, 1440 per inch. This exporter reproduces that document, so its page
 * geometry should match it rather than silently inherit docx's own A4
 * default (11906 x 16838, 1-inch margins).
 */
const TWIPS_PER_INCH = 1440;
const PAGE_SIZE = { width: 11901, height: 16817 };
const PAGE_MARGIN = { top: 873, right: 907, bottom: 941, left: 1026 };

/**
 * The widest an image can render before Word clips it. A crop is cut at its
 * true physical size at `CROP_DPI` and docx does not shrink an oversized
 * inline image to fit its column -- the excess just runs off the page. A
 * rendered A4 page at 300 DPI is 8.267in wide; the margins above leave only
 * about 6.92in of that. Four of the eleven fillable slots are whole-page
 * captures, so an uncapped width is most of the document's visual content,
 * not an edge case.
 */
const USABLE_WIDTH_PX =
  ((PAGE_SIZE.width - PAGE_MARGIN.left - PAGE_MARGIN.right) /
    TWIPS_PER_INCH) *
  DOCX_PX_PER_INCH;

function imageParagraph(slot: FilledSlot): Paragraph {
  const width = toDocxPx(slot.widthPx);
  const height = toDocxPx(slot.heightPx);
  // Word does not shrink an oversized inline image to its column; the excess
  // is simply clipped. When the rendered width would exceed the usable page
  // width, scale both dimensions down by the same factor so the crop fits
  // and keeps its aspect ratio. A crop already inside the column (the
  // mandated 600px-at-300DPI test is 2in, far below the ~6.92in column) is
  // untouched: this only ever shrinks, never grows, an image.
  const scale = width > USABLE_WIDTH_PX ? USABLE_WIDTH_PX / width : 1;

  return new Paragraph({
    children: [
      new ImageRun({
        // Required in docx v9. Omitting it names the part
        // word/media/<hash>.undefined, which has no content type, and Word
        // refuses to open the file.
        type: "png",
        data: slot.png,
        transformation: {
          width: width * scale,
          height: height * scale,
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
        properties: {
          page: {
            size: { width: PAGE_SIZE.width, height: PAGE_SIZE.height },
            margin: { ...PAGE_MARGIN },
          },
        },
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
