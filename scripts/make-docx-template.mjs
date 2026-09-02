/**
 * `node scripts/make-docx-template.mjs <Form_Validasi.docx> [--out <dir>]`
 *
 * Turns ONE human-authored Form Validasi into the two files
 * `src/lib/export/docx.ts` needs to patch rather than rebuild:
 *
 *   <name>.template.docx  the same file with every picture removed and a
 *                         single-run `{{key}}` placeholder left where each
 *                         picture used to be
 *   <name>.template.json  the anchor manifest: which placeholder key belongs
 *                         to which section heading and which table row
 *
 * WHY A TEMPLATE AT ALL. The 2026-09-03 second-bundle findings measured what
 * our constructed document was missing against the two human samples: no
 * `word/header1.xml` (both samples have one, carrying the DOKUMEN VALIDASI
 * banner), no `theme1.xml`, an empty `<w:docDefaults>` with no `Normal` style
 * so the samples' Calibri-at-12pt fell back to Word's own default, and no
 * `TableGrid` style so our seven tables had no borders where all thirteen
 * tables across the two samples do. Reproducing all of that by construction
 * is a transcription job with no end; patching the real thing keeps it.
 *
 * Measured on the bundle-one sample: stripping all 17 image runs took the
 * file from 1.41MB to 237KB, and patching crops back in preserved
 * `word/header1.xml`, `word/theme/theme1.xml` and `word/styles.xml` byte for
 * byte, along with numbering, fontTable, settings, customXml and the
 * `<w:sectPr>` with its `<w:headerReference>`.
 *
 * WHY IT IS A SCRIPT AND NOT A COMMITTED ASSET. The two bundles we have share
 * three section names out of eleven and twelve, so there is no single
 * template that fits both orders; and `documents/` is gitignored real client
 * material, so nothing derived from it may be committed. The template is
 * therefore a PER-RUN OPERATOR INPUT, produced by hand with this command.
 * Its output is written next to its input (i.e. inside `documents/`) for
 * exactly that reason.
 *
 * This module exports its pure transform so the test suite can drive it on a
 * synthetic docx built in-process: the tests must not read `documents/`, and
 * `pnpm test` makes no API calls and touches no client material.
 */

import { basename, dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";

/**
 * Bumped whenever the manifest's shape changes. `buildDocx` refuses a version
 * it does not know rather than reading a field that has moved: a manifest and
 * a template that disagree place crops in the wrong rows, which is the
 * wrong-and-quiet failure this whole pipeline is organised against.
 */
export const TEMPLATE_MANIFEST_VERSION = 1;

/**
 * The six header cells, keyed by the boilerplate label printed to their left
 * and named by the `HeaderFields` field they fill. The labels are the form's
 * own wording and do not vary by order, unlike the values beside them, which
 * are that order's real customer name and quote number and are exactly what
 * this script replaces with a placeholder.
 */
const HEADER_LABELS = new Map([
  ["ID EPIC", "idEpic"],
  ["NAMA PROYEK", "namaProyek"],
  ["QUOTE", "quote"],
  ["CC", "cc"],
  ["ORDER", "order"],
  ["JENIS ORDER", "jenisOrder"],
]);

const HEADER_FIELDS = [...HEADER_LABELS.values()];

// -------------------------------------------------------------------------
// XML scanning. Deliberately string-level rather than DOM-level: everything
// this script does is a delete or an insert at a known offset, and every byte
// it does not touch has to survive unchanged. A parse/serialize round trip
// through any XML library rewrites attribute order and namespace prefixes
// across the whole part, which is precisely the byte-for-byte preservation
// the template exists to provide.
// -------------------------------------------------------------------------

/**
 * Top-level spans of `<name>` inside `xml`, ignoring occurrences nested
 * inside another `<name>`. Depth-counting on the tag's own name is enough
 * for the shapes here: a `<w:tr>` of a nested table sits inside the outer
 * `<w:tr>`, a nested `<w:tc>` inside the outer `<w:tc>`, and so on.
 *
 * The `(?=[\s/>])` lookahead is load-bearing: `<w:pPr>`, `<w:proofErr>` and
 * `<w:rPr>` all start with `<w:p` or `<w:r`, and a prefix match would count
 * them as opening tags and lose track of depth entirely.
 */
function spansOf(xml, name) {
  const re = new RegExp(`<${name}(?=[\\s/>])[^>]*>|</${name}>`, "g");
  const out = [];
  let depth = 0;
  let start = -1;
  let m;
  while ((m = re.exec(xml))) {
    const isClose = m[0].startsWith("</");
    const selfClosing = !isClose && m[0].endsWith("/>");
    if (selfClosing) {
      if (depth === 0) out.push({ start: m.index, end: m.index + m[0].length });
      continue;
    }
    if (isClose) {
      depth -= 1;
      if (depth === 0) out.push({ start, end: m.index + m[0].length });
    } else {
      if (depth === 0) start = m.index;
      depth += 1;
    }
  }
  return out;
}

/**
 * Top-level `<w:p>` and `<w:tbl>` blocks of a body, in document order, with a
 * shared depth so a paragraph inside a table is not mistaken for a block and
 * the body-level `<w:sectPr>` is not mistaken for a paragraph.
 */
function bodyBlocks(xml) {
  const re = /<(w:p|w:tbl|w:sectPr)(?=[\s/>])[^>]*>|<\/(w:p|w:tbl|w:sectPr)>/g;
  const out = [];
  let depth = 0;
  let start = -1;
  let name = "";
  let m;
  while ((m = re.exec(xml))) {
    const isClose = m[2] !== undefined;
    const selfClosing = !isClose && m[0].endsWith("/>");
    if (selfClosing) {
      if (depth === 0)
        out.push({ name: m[1], start: m.index, end: m.index + m[0].length });
      continue;
    }
    if (isClose) {
      depth -= 1;
      if (depth === 0) out.push({ name, start, end: m.index + m[0].length });
    } else {
      if (depth === 0) {
        start = m.index;
        name = m[1];
      }
      depth += 1;
    }
  }
  return out;
}

const XML_ENTITIES = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&apos;", "'"],
]);

/**
 * The visible text of a fragment, decoded. Decoding matters: the sample's
 * `Price & SA` row label is stored as `Price &amp; SA`, and the manifest is
 * compared against `SlotDef.label`, which spells it with a real ampersand.
 */
function textOf(xml) {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((m) => m[1].replace(/&(amp|lt|gt|quot|apos);/g, (e) => XML_ENTITIES.get(e)))
    .join("");
}

/** Whitespace-insensitive comparison key for a label or a heading. */
export const normalizeLabel = (text) => text.replace(/\s+/g, " ").trim();

/**
 * The body-level `<w:sectPr>`'s page size and margins, in twips.
 *
 * Recorded in the manifest so `buildDocx` can cap a crop against the
 * template's OWN text column without unzipping anything: `jszip` is a
 * devDependency here and the exporter also runs in the browser, so the fewer
 * things it has to open, the better. The bundle-one sample reads
 * `<w:pgSz w:w="11901" w:h="16817"/>` with
 * `<w:pgMar w:top="873" w:right="907" w:bottom="941" w:left="1026"/>`, i.e.
 * a 6.92in text column, which is where the exporter's long-standing
 * hard-coded constants came from in the first place.
 */
function pageGeometry(xml) {
  const at = xml.lastIndexOf("<w:sectPr");
  if (at < 0) return null;
  // Everything after the LAST `<w:sectPr` is that element plus the closing
  // `</w:body></w:document>`, so slicing to the end needs no end-tag search
  // and copes with a self-closing `<w:sectPr/>`.
  const sect = xml.slice(at);
  const attr = (tag, name) => {
    const element = sect.match(new RegExp(`<w:${tag}(?:\\s[^>]*)?>`))?.[0];
    const value = element?.match(new RegExp(`\\sw:${name}="(\\d+)"`))?.[1];
    return value === undefined ? null : Number(value);
  };
  const width = attr("pgSz", "w");
  const height = attr("pgSz", "h");
  const margin = {
    top: attr("pgMar", "top"),
    right: attr("pgMar", "right"),
    bottom: attr("pgMar", "bottom"),
    left: attr("pgMar", "left"),
  };
  if (width === null || height === null) return null;
  if (Object.values(margin).some((v) => v === null)) return null;
  return { widthTwips: width, heightTwips: height, marginTwips: margin };
}

/**
 * ONE run, never two. Word splits a typed string across runs on rsid
 * boundaries, and docx's patcher matches a placeholder inside a single
 * `<w:t>`, so a placeholder that Word has split is a placeholder that will
 * not match -- and an unmatched placeholder is literal `{{key}}` text in the
 * signed deliverable. Emitting it ourselves as one run is what guarantees it.
 *
 * `xml:space="preserve"` because a key is inserted verbatim and a leading or
 * trailing space in one would otherwise be dropped by the reader.
 */
const placeholderRun = (key) =>
  `<w:r><w:t xml:space="preserve">{{${key}}}</w:t></w:r>`;

/** Spans of every `<w:r>` in a fragment, in document order. */
const runSpans = (xml) => spansOf(xml, "w:r");

/**
 * Spans of every `<w:r>` that wraps a `<w:drawing>`. Both samples use
 * `<wp:inline>` exclusively in `word/document.xml`: zero `<wp:anchor>`, zero
 * `<w:pict>`, zero `<mc:AlternateContent>`, so deleting the whole run is
 * exact and cannot orphan a floating shape's anchor.
 *
 * `word/header1.xml` is a different matter and is never touched here: its
 * DOKUMEN VALIDASI banner IS a `<w:drawing>` -- a `wps` text box inside an
 * `<mc:AlternateContent>` -- and stripping it would delete the banner the
 * template exists to keep.
 */
function imageRunSpans(xml) {
  return runSpans(xml).filter((span) =>
    xml.slice(span.start, span.end).includes("<w:drawing>"),
  );
}

/**
 * Applies `{start, end, text}` edits to `xml`, back to front so earlier
 * offsets stay valid.
 *
 * The overlap check is not defensive padding. Deleting a self-closing
 * `<w:hyperlink .../>` as if it were a wrapper once produced an edit whose
 * range ran one character BEFORE its own start, and applied back to front it
 * silently swallowed the placeholder inserted after it -- the CC header cell
 * came out with the customer name correctly removed and no `{{header.cc}}`
 * to put anything back. That is the exact wrong-and-quiet shape this file
 * exists to avoid, and it was invisible until a placeholder count came up
 * one short.
 */
function applyEdits(xml, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  for (const [i, edit] of sorted.entries()) {
    if (edit.end < edit.start) {
      throw new Error(`edit runs backwards: [${edit.start}, ${edit.end})`);
    }
    const previous = sorted[i - 1];
    if (previous && edit.end > previous.start) {
      throw new Error(
        `overlapping edits: [${edit.start}, ${edit.end}) overlaps ` +
          `[${previous.start}, ${previous.end})`,
      );
    }
  }
  let out = xml;
  for (const edit of sorted) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/** An edit that appends a placeholder run to the paragraph at `[start, end)`. */
function appendPlaceholder(xml, paragraph, key) {
  const inner = xml.slice(paragraph.start, paragraph.end);
  const close = inner.lastIndexOf("</w:p>");
  if (close < 0) {
    // A self-closing `<w:p/>` has nowhere to put a run. Rewrite the whole
    // element rather than guessing at its attributes.
    return [
      {
        start: paragraph.start,
        end: paragraph.end,
        text: `${inner.replace(/\/>$/, ">")}${placeholderRun(key)}</w:p>`,
      },
    ];
  }
  return [
    {
      start: paragraph.start + close,
      end: paragraph.start + close,
      text: placeholderRun(key),
    },
  ];
}

/**
 * Edits that make the paragraph read `{{key}}` and nothing else, KEEPING the
 * first run's `<w:rPr>`.
 *
 * Keeping the run properties is the point. The header value cells hold the
 * previous order's real customer name and quote number, so their text has to
 * go -- but the sample writes those cells bold at 11pt (`<w:b/><w:bCs/>`,
 * `<w:sz w:val="22"/>`), and docx's replacer copies the placeholder run's own
 * `w:rPr` onto whatever replaces it. Delete the run and the new value comes
 * out in the document default instead, which is a quieter version of the
 * "the font isn't right" complaint this whole template exists to fix.
 */
function replaceParagraphText(xml, paragraph, key) {
  const inner = xml.slice(paragraph.start, paragraph.end);
  const runs = runSpans(inner);
  const carrier = runs.findIndex((run) => inner.slice(run.start, run.end).includes("<w:t"));
  if (carrier < 0) {
    // Nothing in this paragraph carries text (an empty cell, or one holding
    // only a bookmark), so there is no formatting to preserve either.
    return [
      ...appendPlaceholder(xml, paragraph, key),
      ...runs.map((run) => ({
        start: paragraph.start + run.start,
        end: paragraph.start + run.end,
        text: "",
      })),
    ];
  }
  const edits = [];
  for (const [i, run] of runs.entries()) {
    if (i !== carrier) {
      edits.push({
        start: paragraph.start + run.start,
        end: paragraph.start + run.end,
        text: "",
      });
      continue;
    }
    const runXml = inner.slice(run.start, run.end);
    for (const [n, t] of [...runXml.matchAll(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g)].entries()) {
      edits.push({
        start: paragraph.start + run.start + t.index,
        end: paragraph.start + run.start + t.index + t[0].length,
        text: n === 0 ? `<w:t xml:space="preserve">{{${key}}}</w:t>` : "",
      });
    }
  }
  return edits;
}

/** Top-level paragraphs of a table cell. */
function cellParagraphs(xml, cell) {
  const inner = xml.slice(cell.start, cell.end);
  if (inner.includes("<w:tbl>")) {
    throw new Error(
      "this form nests a table inside a table cell, which the template " +
        "builder does not handle. Flatten it, or extend spansOf's caller.",
    );
  }
  return spansOf(inner, "w:p").map((p) => ({
    start: cell.start + p.start,
    end: cell.start + p.end,
  }));
}

const tableRows = (xml, table) =>
  spansOf(xml.slice(table.start, table.end), "w:tr").map((r) => ({
    start: table.start + r.start,
    end: table.start + r.end,
  }));

const rowCells = (xml, row) =>
  spansOf(xml.slice(row.start, row.end), "w:tc").map((c) => ({
    start: row.start + c.start,
    end: row.start + c.end,
  }));

/**
 * The cell's own declared width in twips, from `<w:tcW w:w="9128"
 * w:type="dxa"/>`. `buildDocx` caps a crop to this, not just to the page
 * column: an inline picture wider than its cell widens the table instead,
 * pushing it off the page. The sample's ToP value cell is 9128 twips
 * (6.34in) inside a 9968-twip (6.92in) text column, and the human crop in it
 * is 4.44in.
 *
 * `w:type` other than `dxa` (`pct`, `auto`) is not a twip measurement, so it
 * is reported as null and the caller falls back to the page column.
 */
function cellWidthTwips(xml, cell) {
  // The TAG first, then each attribute inside it. XML does not order
  // attributes, and one ordered regex over both silently returned null for a
  // producer that writes `w:type` before `w:w` -- which removes the cap
  // entirely and falls back to the page column, the width that lets a picture
  // widen its table off the page.
  const tag = xml.slice(cell.start, cell.end).match(/<w:tcW\s[^>]*\/?>/);
  if (!tag) return null;
  const width = tag[0].match(/\sw:w="(\d+)"/);
  const type = tag[0].match(/\sw:type="(\w+)"/);
  if (!width || type?.[1] !== "dxa") return null;
  return Number(width[1]);
}

const isListParagraph = (xml, block) =>
  xml.slice(block.start, block.end).includes('<w:pStyle w:val="ListParagraph"/>');

/**
 * A section heading, as the samples write one: a numbered ListParagraph that
 * carries text. `<w:numId>` is what separates a heading from the empty
 * ListParagraph paragraphs beneath it, which carry the same style and no
 * number of their own.
 */
function headingText(xml, block) {
  if (block.name !== "w:p") return null;
  const inner = xml.slice(block.start, block.end);
  if (!inner.includes('<w:pStyle w:val="ListParagraph"/>')) return null;
  if (!/<w:numId\s[^>]*w:val="\d+"/.test(inner)) return null;
  const text = normalizeLabel(textOf(inner));
  return text === "" ? null : text;
}

// -------------------------------------------------------------------------
// The transform
// -------------------------------------------------------------------------

/**
 * Reads the body and returns the anchor plan: what to record in the manifest
 * and where each placeholder run goes. Pure and offset-based, so the caller
 * can apply the image-run deletions and the placeholder insertions to the
 * same original string in one pass.
 */
function planAnchors(xml) {
  const bodyOpen = xml.indexOf("<w:body>");
  if (bodyOpen < 0) throw new Error("word/document.xml has no <w:body>");
  const bodyStart = bodyOpen + "<w:body>".length;
  const bodyEnd = xml.lastIndexOf("</w:body>");
  const body = xml.slice(bodyStart, bodyEnd);
  const blocks = bodyBlocks(body).map((b) => ({
    ...b,
    start: bodyStart + b.start,
    end: bodyStart + b.end,
  }));

  const edits = [];
  const sections = [];
  const header = {};
  let headerTableSeen = false;
  let quoteValue = null;

  // Pass 1: the header table. It is the only table that precedes the first
  // numbered heading, and the only one whose rows carry four cells --
  // label, value, label, value.
  for (const block of blocks) {
    if (headingText(xml, block) !== null) break;
    if (block.name !== "w:tbl") continue;
    if (headerTableSeen) continue;
    headerTableSeen = true;
    for (const row of tableRows(xml, block)) {
      const cells = rowCells(xml, row);
      for (let i = 0; i + 1 < cells.length; i += 2) {
        const label = normalizeLabel(textOf(xml.slice(cells[i].start, cells[i].end)))
          .replace(/:\s*$/, "")
          .trim()
          .toUpperCase();
        const field = HEADER_LABELS.get(label);
        if (!field) continue;
        const value = cells[i + 1];
        const paragraphs = cellParagraphs(xml, value);
        if (paragraphs.length === 0) {
          throw new Error(`header cell for "${label}" has no paragraph to anchor`);
        }
        if (field === "quote") {
          quoteValue = normalizeLabel(textOf(xml.slice(value.start, value.end)));
        }
        const key = `header.${field}`;
        header[field] = key;
        // Every run in the value cell goes: those runs ARE the previous
        // order's identifiers. Bundle two's QUOTE cell holds two of them, in
        // two runs, so this cannot stop at the first.
        edits.push(...replaceParagraphText(xml, paragraphs[0], key));
        for (const paragraph of paragraphs.slice(1)) {
          const inner = xml.slice(paragraph.start, paragraph.end);
          for (const run of runSpans(inner)) {
            edits.push({
              start: paragraph.start + run.start,
              end: paragraph.start + run.end,
              text: "",
            });
          }
        }
      }
    }
  }

  const missing = HEADER_FIELDS.filter((f) => header[f] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `the header table is missing ${missing.length} of the six labelled ` +
        `cells (${missing.join(", ")}). Expected a table before the first ` +
        `numbered heading whose rows read "ID EPIC :", "NAMA Proyek :", ` +
        `"QUOTE :", "CC :", "ORDER :", "JENIS ORDER :".`,
    );
  }

  // Pass 2: the numbered headings and what hangs off each one. A heading's
  // group runs to the next heading. A group with at least one table is one
  // manifest entry PER TABLE -- the sample's KB heading carries two, which
  // `AO_TEMPLATE` names "KB" and "KB (lanjutan)" -- and a group with none is
  // a whole-page-capture section whose pictures were plain paragraphs.
  const headingIndexes = blocks
    .map((b, i) => (headingText(xml, b) === null ? -1 : i))
    .filter((i) => i >= 0);

  for (let h = 0; h < headingIndexes.length; h += 1) {
    const from = headingIndexes[h];
    const to = headingIndexes[h + 1] ?? blocks.length;
    const heading = headingText(xml, blocks[from]);
    const group = blocks.slice(from + 1, to);
    const tables = group.filter((b) => b.name === "w:tbl");

    if (tables.length > 0) {
      for (const [nth, table] of tables.entries()) {
        const index = sections.length;
        const rows = [];
        for (const [j, row] of tableRows(xml, table).entries()) {
          const cells = rowCells(xml, row);
          if (cells.length < 2) {
            throw new Error(
              `table row ${j} under "${heading}" has ${cells.length} cells; ` +
                "a checklist row needs a label cell and a value cell",
            );
          }
          const labelCell = cells[0];
          const valueCell = cells[cells.length - 1];
          const labelText = normalizeLabel(
            textOf(xml.slice(labelCell.start, labelCell.end)),
          );
          const row_ = { index: j, label: labelText, key: `s${index}.r${j}` };

          // The sample labels one Konfigurasi row with the ORDER'S OWN QUOTE
          // NUMBER. That is per-order data, not boilerplate: leaving it would
          // both carry a real quote number into the template and make the
          // label disagree with every future order. It becomes a placeholder
          // of its own, and the manifest records it the way `AO_TEMPLATE`
          // already spells it -- the literal token `{{quote}}` -- so the
          // label check in `buildDocx` compares equal.
          if (quoteValue !== null && quoteValue !== "" && labelText === quoteValue) {
            row_.label = "{{quote}}";
            row_.labelKey = `s${index}.r${j}.label`;
            const paragraphs = cellParagraphs(xml, labelCell);
            if (paragraphs.length === 0) {
              throw new Error(`quote-labelled row ${j} has no paragraph to anchor`);
            }
            edits.push(...replaceParagraphText(xml, paragraphs[0], row_.labelKey));
            for (const paragraph of paragraphs.slice(1)) {
              const inner = xml.slice(paragraph.start, paragraph.end);
              for (const run of runSpans(inner)) {
                edits.push({
                  start: paragraph.start + run.start,
                  end: paragraph.start + run.end,
                  text: "",
                });
              }
            }
          }

          const width = cellWidthTwips(xml, valueCell);
          if (width !== null) row_.cellWidthTwips = width;

          const paragraphs = cellParagraphs(xml, valueCell);
          if (paragraphs.length === 0) {
            throw new Error(
              `the value cell of row ${j} under "${heading}" has no ` +
                "paragraph, so there is nowhere to anchor its picture",
            );
          }
          edits.push(...appendPlaceholder(xml, paragraphs[0], row_.key));
          rows.push(row_);
        }
        sections.push({
          index,
          heading,
          layout: "table",
          continuation: nth > 0,
          rows,
        });
      }
      continue;
    }

    // No table: a whole-page-capture section. Its pictures were plain
    // ListParagraph paragraphs beneath the heading, so the count of those is
    // recorded (after the image runs go they are all empty) and the first one
    // takes the anchor. The sample's BA Permintaan has twelve, holding one
    // picture and eleven blank spacers; SP has two, holding two pictures.
    const paragraphs = [];
    for (const block of group) {
      if (block.name !== "w:p" || !isListParagraph(xml, block)) break;
      paragraphs.push(block);
    }
    if (paragraphs.length === 0) {
      throw new Error(
        `section "${heading}" has neither a table nor an indented paragraph ` +
          "beneath its heading, so there is nowhere to anchor a capture. " +
          "Add one empty paragraph under the heading and re-run.",
      );
    }
    const index = sections.length;
    const key = `s${index}.images`;
    edits.push(...appendPlaceholder(xml, paragraphs[0], key));
    sections.push({
      index,
      heading,
      layout: "images",
      continuation: false,
      key,
      paragraphs: paragraphs.length,
    });
  }

  if (sections.length === 0) {
    throw new Error(
      "no numbered section headings found. This script expects a Form " +
        "Validasi whose sections are a numbered list, which is how both " +
        "human samples are written.",
    );
  }

  return { edits, sections, header };
}

/**
 * Unwraps every external hyperlink, leaving its runs in place, and reports
 * the relationship ids to drop. A template that keeps them keeps a live
 * link to the previous order's internal tooling; the sample's one hyperlink
 * targets an internal host and sits in the CC cell, pointing at that
 * customer's record, which has no business travelling with a file the
 * operator hands around.
 *
 * A SELF-CLOSING `<w:hyperlink .../>` is a real shape and the sample has
 * one: it carries an `r:id` and a `w:anchor` and wraps nothing at all. It is
 * deleted whole. Treating it as a wrapper -- looking for a `</w:hyperlink>`
 * that is not there -- is what produced the swallowed-placeholder bug the
 * overlap check in `applyEdits` now catches.
 */
function unwrapHyperlinks(xml) {
  const edits = [];
  const ids = new Set();
  for (const span of spansOf(xml, "w:hyperlink")) {
    const inner = xml.slice(span.start, span.end);
    const id = inner.match(/^<w:hyperlink[^>]*\sr:id="([^"]+)"/)?.[1];
    if (!id) continue; // An internal `w:anchor` link carries no relationship.
    ids.add(id);
    const closeStart = inner.lastIndexOf("</w:hyperlink>");
    if (closeStart < 0) {
      edits.push({ start: span.start, end: span.end, text: "" });
      continue;
    }
    const openEnd = inner.indexOf(">") + 1;
    edits.push({ start: span.start, end: span.start + openEnd, text: "" });
    edits.push({ start: span.start + closeStart, end: span.end, text: "" });
  }
  return { edits, ids };
}

/**
 * Strips one docx to a patchable template and its anchor manifest.
 *
 * @param {Uint8Array|ArrayBuffer|Buffer} bytes the human-authored form
 * @param {{ source?: string }} [meta] recorded in the manifest for provenance
 * @returns {Promise<{ docx: Uint8Array, manifest: object }>}
 */
export async function makeDocxTemplate(bytes, meta = {}) {
  const zip = await JSZip.loadAsync(bytes);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("not a Word document: no word/document.xml");
  const original = await documentFile.async("string");

  const { edits: anchorEdits, sections, header } = planAnchors(original);
  const { edits: linkEdits, ids: hyperlinkIds } = unwrapHyperlinks(original);
  const imageEdits = imageRunSpans(original).map((span) => ({
    start: span.start,
    end: span.end,
    text: "",
  }));

  const patched = applyEdits(original, [...imageEdits, ...linkEdits, ...anchorEdits]);
  zip.file("word/document.xml", patched);

  // Relationships. Only `word/_rels/document.xml.rels` is rewritten, because
  // only `word/document.xml` was edited. Media referenced from any OTHER part
  // -- a header's logo, say -- is kept, which is why the media sweep below
  // works off a keep-set rather than deleting `word/media/*` wholesale.
  const relsPath = "word/_rels/document.xml.rels";
  const relsFile = zip.file(relsPath);
  const keptMedia = new Set();
  let droppedImages = 0;
  if (relsFile) {
    const rels = await relsFile.async("string");
    const rewritten = rels.replace(
      /<Relationship\b[^>]*\/>/g,
      (relationship) => {
        const type = relationship.match(/\sType="([^"]+)"/)?.[1] ?? "";
        const id = relationship.match(/\sId="([^"]+)"/)?.[1] ?? "";
        if (type.endsWith("/image")) {
          droppedImages += 1;
          return "";
        }
        if (type.endsWith("/hyperlink") && hyperlinkIds.has(id)) return "";
        return relationship;
      },
    );
    zip.file(relsPath, rewritten);
  }
  for (const path of Object.keys(zip.files)) {
    if (!path.endsWith(".rels") || path === relsPath) continue;
    for (const m of (await zip.file(path).async("string")).matchAll(
      /<Relationship\b[^>]*\sType="([^"]+)"[^>]*\sTarget="([^"]+)"/g,
    )) {
      if (m[1].endsWith("/image")) keptMedia.add(m[2].replace(/^\.*\//, ""));
    }
  }
  for (const path of Object.keys(zip.files)) {
    if (!path.startsWith("word/media/") || zip.files[path].dir) continue;
    if (keptMedia.has(path.slice("word/".length))) continue;
    zip.remove(path);
  }

  // Provenance. `dc:creator` and `cp:lastModifiedBy` name a real person at
  // the client.
  //
  // `dc:title` is KEPT, and not as a courtesy. The sample's DOKUMEN VALIDASI
  // banner in `word/header1.xml` is a content control BOUND to it --
  // `<w:dataBinding w:xpath="/ns1:coreProperties[1]/ns0:title[1]"/>` -- so
  // blanking the title blanks the banner in every document patched from this
  // template, which is the exact complaint ("no header as well") the template
  // path exists to fix.
  const coreFile = zip.file("docProps/core.xml");
  if (coreFile) {
    const core = await coreFile.async("string");
    zip.file(
      "docProps/core.xml",
      core
        .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/g, "<dc:creator></dc:creator>")
        .replace(
          /<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/g,
          "<cp:lastModifiedBy></cp:lastModifiedBy>",
        ),
    );
  }

  const manifest = {
    version: TEMPLATE_MANIFEST_VERSION,
    source: meta.source ?? null,
    page: pageGeometry(original),
    header,
    sections,
  };

  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { docx: out, manifest, stats: { imageRuns: imageEdits.length, droppedImages } };
}

// -------------------------------------------------------------------------
// CLI
// -------------------------------------------------------------------------

const USAGE = `Usage: node scripts/make-docx-template.mjs <Form_Validasi.docx> [--out <dir>]

Writes <name>.template.docx and <name>.template.json. The default output
directory is the input's own, which for real client material is the
gitignored documents/ -- keep it that way.`;

async function main() {
  const args = process.argv.slice(2);
  let input = null;
  let outDir = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--out") {
      outDir = args[i + 1];
      if (!outDir) throw new Error("--out needs a directory");
      i += 1;
    } else if (args[i].startsWith("--")) {
      throw new Error(`unknown option ${args[i]}`);
    } else if (input === null) {
      input = args[i];
    } else {
      throw new Error("only one input docx at a time");
    }
  }
  if (input === null) throw new Error("no docx given");

  const name = basename(input).replace(/\.docx$/i, "");
  const dir = outDir ?? dirname(input);
  const { docx, manifest, stats } = await makeDocxTemplate(await readFile(input), {
    source: basename(input),
  });

  const docxPath = join(dir, `${name}.template.docx`);
  const jsonPath = join(dir, `${name}.template.json`);
  await writeFile(docxPath, docx);
  await writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // Counts the per-order label anchors too. A count that quietly omits them
  // is a count the operator cannot check against `patchDetector`.
  const anchors = manifest.sections.reduce(
    (n, s) =>
      n +
      (s.layout === "table"
        ? s.rows.length + s.rows.filter((r) => r.labelKey).length
        : 1),
    HEADER_FIELDS.length,
  );
  console.log(`stripped ${stats.imageRuns} image runs, ${stats.droppedImages} image relationships`);
  console.log(
    `${manifest.sections.length} sections, ${anchors} placeholders:\n` +
      manifest.sections
        .map(
          (s) =>
            `  [${s.index}] ${s.heading}${s.continuation ? " (continued)" : ""} ` +
            (s.layout === "table"
              ? `table, ${s.rows.length} rows: ${s.rows.map((r) => r.label || "(unlabelled)").join(" | ")}`
              : `images, ${s.paragraphs} paragraphs`),
        )
        .join("\n"),
  );
  // A row label that looks like an order identifier but is NOT this form's
  // own QUOTE cell is left alone on purpose: bundle two's Konfigurasi table
  // repeats a four-row group once per SID and carries TWO different quote
  // numbers as labels, so substituting the header's single quote into both
  // would print one order's number over another's. Say so rather than
  // scrubbing silently or leaving it unsaid -- the template is client
  // material either way, and the operator should know what is still in it.
  const leftovers = manifest.sections.flatMap((s) =>
    s.layout === "table"
      ? s.rows.filter((r) => /^(1-\d{8,}|LOP\d{4,}|\d{4,}-\d{3,})$/.test(r.label))
      : [],
  );
  if (leftovers.length > 0) {
    console.log(
      `\nNOTE: ${leftovers.length} row label(s) still read as an order ` +
        `identifier and were kept verbatim: ` +
        `${leftovers.map((r) => r.label).join(", ")}. Only the label matching ` +
        `this form's own QUOTE cell becomes a placeholder; the rest are ` +
        `client data. Keep the template beside the documents it came from.`,
    );
  }

  console.log(`\nwrote ${docxPath}\nwrote ${jsonPath}`);
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(`\n${error.message}\n\n${USAGE}`);
    process.exitCode = 1;
  });
}
