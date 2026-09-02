import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  PatchType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  patchDetector,
  patchDocument,
} from "docx";
import type { IPatch, ParagraphChild } from "docx";
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

const HEADER_FIELD_NAMES = [
  "idEpic",
  "namaProyek",
  "quote",
  "cc",
  "order",
  "jenisOrder",
] as const satisfies readonly (keyof HeaderFields)[];

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
 *
 * The template path does not use these: it reads the same two elements out of
 * the operator's own template (`manifest.page`) instead, which is the only
 * way a differently-set-up form gets the right column width. These stay as
 * the constructed path's constants and as its fallback.
 */
const TWIPS_PER_INCH = 1440;
const PAGE_SIZE = { width: 11901, height: 16817 };
const PAGE_MARGIN = { top: 873, right: 907, bottom: 941, left: 1026 };

const twipsToDocxPx = (twips: number) => (twips / TWIPS_PER_INCH) * DOCX_PX_PER_INCH;

/**
 * The widest an image can render before Word clips it. A crop is cut at its
 * true physical size at `CROP_DPI` and docx does not shrink an oversized
 * inline image to fit its column -- the excess just runs off the page. A
 * rendered A4 page at 300 DPI is 8.267in wide; the margins above leave only
 * about 6.92in of that. Four of the eleven fillable slots are whole-page
 * captures, so an uncapped width is most of the document's visual content,
 * not an edge case.
 */
const USABLE_WIDTH_PX = twipsToDocxPx(
  PAGE_SIZE.width - PAGE_MARGIN.left - PAGE_MARGIN.right,
);
const USABLE_HEIGHT_PX = twipsToDocxPx(
  PAGE_SIZE.height - PAGE_MARGIN.top - PAGE_MARGIN.bottom,
);

/**
 * Word's default table cell margin, one side, in twips (0.075in).
 *
 * Used because the manifest records a cell's declared `<w:tcW>` and not the
 * table's `<w:tblCellMar>`. Reading the real margin would need a manifest
 * field and a version bump; the default is what every table in both samples
 * uses, and being 216 twips (0.15in) conservative on a table that sets a
 * LARGER margin is the safe direction -- a slightly small picture rather than
 * a table pushed off the page.
 */
const DEFAULT_CELL_MARGIN_TWIPS = 108;

/**
 * One picture, scaled down (never up) until it fits inside `maxWidthPx` x
 * `maxHeightPx`, both dimensions together so the aspect ratio survives.
 *
 * Both caps are load-bearing and both are measured. Word does not shrink an
 * oversized inline image to its container; it clips it, and an image wider
 * than its table cell widens the table off the page instead. Against the two
 * human samples our crops went out at 5.93-6.92in wide with a median height
 * of 7.48in and a max of 9.80in, where the humans' run 1.60-5.93in wide and
 * never exceed 6.27in tall.
 *
 * The cap is the page's text column (and, in a table, the cell), NOT the
 * humans' 6.27in. Their crops are smaller because they captured tighter
 * regions, not because they scaled anything down; shrinking a whole-page
 * capture to a human's median would just make it unreadable. The fix for an
 * oversized crop is a tighter located extent, which is `locateSlot`'s job.
 */
function scaledImageRun(
  slot: FilledSlot,
  maxWidthPx: number,
  maxHeightPx: number,
): ImageRun {
  const width = toDocxPx(slot.widthPx);
  const height = toDocxPx(slot.heightPx);
  const scale = Math.min(1, maxWidthPx / width, maxHeightPx / height);

  return new ImageRun({
    // Required in docx v9. Omitting it names the part
    // word/media/<hash>.undefined, which has no content type, and Word
    // refuses to open the file.
    type: "png",
    data: slot.png,
    transformation: { width: width * scale, height: height * scale },
  });
}

function imageParagraph(slot: FilledSlot): Paragraph {
  return new Paragraph({
    children: [scaledImageRun(slot, USABLE_WIDTH_PX, USABLE_HEIGHT_PX)],
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

// -------------------------------------------------------------------------
// The template path
// -------------------------------------------------------------------------

/**
 * The anchor manifest `scripts/make-docx-template.mjs` writes beside the
 * template it strips. This file owns the shape; the script writes plain JSON
 * against it and the two are kept honest by `version`.
 */
export const TEMPLATE_MANIFEST_VERSION = 1;

export type DocxTemplateRow = {
  index: number;
  /** The row's first-cell text, or the literal `{{quote}}` when that text
   *  was this order's own quote number and is therefore per-order data. */
  label: string;
  /** Placeholder key sitting in the row's value cell. */
  key: string;
  /** Placeholder key sitting in the LABEL cell, present only for a per-order
   *  label the prep script had to scrub. */
  labelKey?: string;
  /** The value cell's declared width in twips, when it declares one in dxa. */
  cellWidthTwips?: number;
};

export type DocxTemplateSection = {
  index: number;
  /** The numbered heading this section hangs off, verbatim. */
  heading: string;
  layout: "images" | "table";
  /** True for the second and later tables under ONE heading. The sample's KB
   *  heading carries two, which `AO_TEMPLATE` names "KB" and "KB
   *  (lanjutan)", so the second cannot be title-matched exactly. */
  continuation: boolean;
  /** `layout: "table"` only. */
  rows?: DocxTemplateRow[];
  /** `layout: "images"` only: the placeholder key, and how many indented
   *  paragraphs the section has for pictures. */
  key?: string;
  paragraphs?: number;
};

export type DocxTemplateManifest = {
  version: number;
  source?: string | null;
  page?: {
    widthTwips: number;
    heightTwips: number;
    marginTwips: { top: number; right: number; bottom: number; left: number };
  } | null;
  header: Partial<Record<keyof HeaderFields, string>>;
  sections: DocxTemplateSection[];
};

export type DocxTemplate = {
  /** The stripped `.template.docx`. */
  docx: Uint8Array | ArrayBuffer;
  /** Its `.template.json`, parsed. */
  manifest: DocxTemplateManifest;
};

const normalizeLabel = (text: string) => text.replace(/\s+/g, " ").trim();

/** Children for one anchor: the crops it holds, stacked, or nothing. */
function cropChildren(
  crops: FilledSlot[],
  maxWidthPx: number,
  maxHeightPx: number,
): ParagraphChild[] {
  // An anchor with no crop still has to be patched: the alternative is
  // leaving its placeholder unmatched, and docx renders an unmatched
  // placeholder as the literal text "{{s3.r1}}" in a cell a validator signs.
  // An empty run leaves the cell blank, which is what the sample's own
  // unfilled rows are.
  if (crops.length === 0) return [new TextRun("")];

  const children: ParagraphChild[] = [];
  for (const [i, crop] of crops.entries()) {
    // A line break, not a second paragraph. `PatchType.PARAGRAPH` replaces
    // the placeholder RUN and leaves the paragraph's own `<w:pPr>` alone --
    // its ListParagraph style, its indent, its cell alignment -- which is
    // most of what the template is for. `PatchType.DOCUMENT` would let each
    // crop be its own paragraph but replaces that `<w:pPr>` with docx's
    // defaults. The sample's two-picture ToP cell stacks them vertically, and
    // a `<w:br/>` between two inline pictures stacks them the same way.
    if (i > 0) children.push(new TextRun({ break: 1 }));
    children.push(scaledImageRun(crop, maxWidthPx, maxHeightPx));
  }
  return children;
}

const paragraphPatch = (children: ParagraphChild[]): IPatch => ({
  type: PatchType.PARAGRAPH,
  children,
});

/**
 * Pairs `template.sections` with `manifest.sections` positionally and returns
 * one patch per placeholder.
 *
 * Positional, because a table row's label is not always stable: the sample
 * labels one Konfigurasi row with the order's own quote number. Verified by
 * text anyway, because positional matching on its own is exactly the
 * plausible-wrong-answer shape this project is organised against -- a
 * template whose rows are in a different order than the `Template` would put
 * every crop one row off and still open cleanly in Word.
 */
function buildPatches(
  template: Template,
  header: HeaderFields,
  byKey: Map<string, FilledSlot[]>,
  manifest: DocxTemplateManifest,
): Record<string, IPatch> {
  const patches: Record<string, IPatch> = {};

  for (const field of HEADER_FIELD_NAMES) {
    const key = manifest.header?.[field];
    if (!key) {
      throw new Error(
        `docx template manifest has no anchor for the header field ` +
          `"${field}". Re-run scripts/make-docx-template.mjs: its header ` +
          `table needs all six of ${HEADER_FIELD_NAMES.join(", ")}.`,
      );
    }
    patches[key] = paragraphPatch([new TextRun(header[field])]);
  }

  if (manifest.sections.length !== template.sections.length) {
    throw new Error(
      `docx template has ${manifest.sections.length} sections and the ` +
        `"${template.id}" form declares ${template.sections.length}. They ` +
        `must correspond one to one and in order.\n` +
        `  template: ${manifest.sections.map((s) => s.heading).join(" | ")}\n` +
        `  form:     ${template.sections.map((s) => s.title).join(" | ")}`,
    );
  }

  const page = manifest.page;
  const usableWidthPx = page
    ? twipsToDocxPx(page.widthTwips - page.marginTwips.left - page.marginTwips.right)
    : USABLE_WIDTH_PX;
  const usableHeightPx = page
    ? twipsToDocxPx(page.heightTwips - page.marginTwips.top - page.marginTwips.bottom)
    : USABLE_HEIGHT_PX;

  for (const [i, section] of template.sections.entries()) {
    const found = manifest.sections[i];
    const where = `section ${i} ("${section.title}")`;

    if (found.layout !== section.layout) {
      throw new Error(
        `${where}: the form declares layout "${section.layout}" and the ` +
          `template has "${found.layout}" under the heading ` +
          `"${found.heading}".`,
      );
    }

    // A continuation is the second or later table under ONE heading, so it
    // has no heading text of its own to compare against. The sample's KB
    // heading carries two tables and the form calls them "KB" and "KB
    // (lanjutan)"; requiring the form's title to START with the heading is
    // as much as can honestly be checked there.
    const title = normalizeLabel(section.title);
    const heading = normalizeLabel(found.heading);
    const titleOk = found.continuation ? title.startsWith(heading) : title === heading;
    if (!titleOk) {
      throw new Error(
        `${where}: the template's heading here reads "${found.heading}"` +
          `${found.continuation ? " (a continuation table under it)" : ""}. ` +
          `A template built from a different order's form does not fit this ` +
          `form; build one from a form with these sections.`,
      );
    }

    if (found.layout === "images") {
      if (!found.key) throw new Error(`${where}: images section has no anchor key`);
      const crops = section.slots.flatMap((slotDef) => byKey.get(slotDef.key) ?? []);
      patches[found.key] = paragraphPatch(
        cropChildren(crops, usableWidthPx, usableHeightPx),
      );
      continue;
    }

    const rows = found.rows ?? [];
    if (section.slots.length > rows.length) {
      throw new Error(
        `${where}: the form declares ${section.slots.length} rows and the ` +
          `template's table has ${rows.length}. Every declared row needs a ` +
          `row to land in.`,
      );
    }

    for (const [j, row] of rows.entries()) {
      const slotDef = section.slots[j];
      if (slotDef && normalizeLabel(row.label) !== normalizeLabel(slotDef.label)) {
        throw new Error(
          `${where}, row ${j}: the form calls it "${slotDef.label}" and the ` +
            `template's row reads "${row.label}". Rows are paired by ` +
            `position, so a mismatch here means every crop after it would ` +
            `land in the wrong row.`,
        );
      }
      // A row past the form's last slot is left blank rather than refused:
      // the sample's SBR Pricing table carries a fourth, unlabelled row that
      // `AO_TEMPLATE` does not transcribe, and dropping its placeholder would
      // print "{{s9.r3}}" in the deliverable.
      const crops = slotDef ? (byKey.get(slotDef.key) ?? []) : [];
      // `w:tcW` is the cell's TOTAL width, margins included, and a picture is
      // laid out inside the margins. Capping at the declared width therefore
      // still overflows the content box by the two margins and widens the
      // table -- the exact symptom the cap exists to prevent -- so the
      // margins come off first. It has not shown up on the sample because its
      // crops are far under the cap (4.44in in a 9128-twip / 6.34in cell).
      const cellWidthPx = row.cellWidthTwips
        ? twipsToDocxPx(Math.max(1, row.cellWidthTwips - DEFAULT_CELL_MARGIN_TWIPS * 2))
        : usableWidthPx;
      patches[row.key] = paragraphPatch(
        cropChildren(crops, Math.min(cellWidthPx, usableWidthPx), usableHeightPx),
      );

      if (row.labelKey) {
        const label = (slotDef?.label ?? row.label).replace("{{quote}}", header.quote);
        patches[row.labelKey] = paragraphPatch([new TextRun(label)]);
      }
    }
  }

  return patches;
}

async function buildFromTemplate(
  template: Template,
  header: HeaderFields,
  filled: FilledSlot[],
  docxTemplate: DocxTemplate,
): Promise<Uint8Array> {
  const { docx, manifest } = docxTemplate;

  if (manifest?.version !== TEMPLATE_MANIFEST_VERSION) {
    throw new Error(
      `docx template manifest is version ${manifest?.version}; this build ` +
        `reads version ${TEMPLATE_MANIFEST_VERSION}. Re-run ` +
        `scripts/make-docx-template.mjs against the source form.`,
    );
  }

  // A crop whose key names no slot in this form would be dropped silently,
  // and a dropped crop is missing evidence in a document that looks
  // complete -- the same failure `SlotDef.crops` exists to prevent.
  const slotKeys = new Set(
    template.sections.flatMap((s) => s.slots.map((slotDef) => slotDef.key)),
  );
  const stray = [...new Set(filled.map((f) => f.key))].filter((k) => !slotKeys.has(k));
  if (stray.length > 0) {
    throw new Error(
      `${stray.length} filled slot(s) name no slot in the "${template.id}" ` +
        `form and would go nowhere: ${stray.join(", ")}`,
    );
  }

  const patches = buildPatches(template, header, groupByKey(filled), manifest);

  // GUARD 1: a patch key the template does not contain. docx accepts it
  // silently -- the crop is simply never placed and the document comes out
  // looking finished with a piece of evidence missing.
  const detected = new Set(await patchDetector({ data: docx }));
  const unknown = Object.keys(patches).filter((key) => !detected.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `${unknown.length} anchor(s) in the manifest are not in the template ` +
        `docx: ${unknown.join(", ")}. The two files are out of step; ` +
        `re-run scripts/make-docx-template.mjs to regenerate both.`,
    );
  }

  // GUARD 2: a placeholder the patches do not cover. docx leaves it in the
  // output as the literal text "{{key}}", so a validator would be signing a
  // page with "{{kb.nomor}}" printed in a cell.
  const uncovered = [...detected].filter((key) => !(key in patches));
  if (uncovered.length > 0) {
    throw new Error(
      `${uncovered.length} placeholder(s) in the template docx have no ` +
        `patch: ${uncovered.join(", ")}. They would print as literal ` +
        `"{{...}}" text. The manifest is out of step with the template; ` +
        `re-run scripts/make-docx-template.mjs to regenerate both.`,
    );
  }

  const out = await patchDocument({ outputType: "uint8array", data: docx, patches });

  // And the same question asked of the ANSWER rather than of the inputs,
  // because the two guards above reason about key sets while this reads the
  // file that is about to be handed to a human. Cheap, and it is the only
  // check that survives a change in how docx matches a placeholder.
  const leftover = await patchDetector({ data: out });
  if (leftover.length > 0) {
    throw new Error(
      `the patched document still contains ${leftover.length} unreplaced ` +
        `placeholder(s): ${leftover.join(", ")}`,
    );
  }

  return out;
}

/**
 * The DOKUMEN VALIDASI packet.
 *
 * Two paths, and the template one is the good one.
 *
 * WITH `docxTemplate`, this patches the operator's own stripped Form Validasi:
 * `word/header1.xml` and its DOKUMEN VALIDASI banner, `theme1.xml`,
 * `styles.xml` with the sample's Calibri-at-12pt `Normal` and its `TableGrid`
 * borders, numbering, fontTable, settings, customXml and the `<w:sectPr>`
 * all survive, because they are never rebuilt.
 *
 * "Survive" measured, on the bundle-one sample end to end: theme1, styles,
 * numbering, fontTable, settings and customXml come out byte for byte
 * identical to the human original. `header1.xml` comes out 88 bytes shorter
 * and semantically identical -- docx re-serializes every `word/*.xml` and its
 * writer escapes an apostrophe inside an attribute value as `&apos;`, which
 * that part's `w:dataBinding w:prefixMappings` contains. Worth knowing before
 * anyone reads "byte for byte" as covering all seven parts.
 *
 * WITHOUT it, the document is constructed from `Template` as it always was.
 * That path is KEPT WORKING rather than removed, for two reasons: there is no
 * committable template (the two sample forms share three section names out of
 * eleven and twelve, and `documents/` is gitignored client material, so a
 * template is a per-run operator input that a caller may simply not have),
 * and the operator UI calls the three-argument form today. It is the lesser
 * output and the 2026-09-03 findings say exactly how: no header part, no
 * theme, no `Normal` style so Word's own default font applies, and no table
 * borders. Prefer the template whenever there is one.
 */
export async function buildDocx(
  template: Template,
  header: HeaderFields,
  filled: FilledSlot[],
  docxTemplate?: DocxTemplate,
): Promise<Uint8Array> {
  if (docxTemplate) {
    return await buildFromTemplate(template, header, filled, docxTemplate);
  }

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
