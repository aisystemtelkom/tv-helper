/**
 * OCR by Cloud Vision `DOCUMENT_TEXT_DETECTION`: a page image in, this
 * pipeline's own numbered `Line[]` out.
 *
 * Pure in the same sense `classify.ts` and `gemini-ocr.ts` are pure: no
 * provider SDK, no `fetch`, no credential. The caller hands in an already
 * parsed response object, so `src/lib/vision.ts` stays the only file that
 * knows how Cloud Vision is reached and the whole conversion is testable
 * offline against fixture JSON.
 *
 * ## Why this exists, and what it restores
 *
 * The design this pipeline was built on says: **the model is never asked for a
 * pixel coordinate.** OCR supplies every word with a real glyph box, the model
 * is shown those words grouped into numbered lines as TEXT, and it answers
 * with a LINE RANGE; the rectangle is then the union of those lines' own
 * boxes. The Gemini OCR migration inverted that -- the boxes started coming
 * from a generative model -- and `gemini-ocr.ts`'s own header records the
 * inversion honestly.
 *
 * Cloud Vision restores it. It returns per-WORD boxes, which is exactly what
 * `groupWordsIntoLines` was written to consume for tesseract, so this module
 * is mostly a mapping and the geometry path underneath is the original,
 * already-tested one.
 *
 * Measured on four real pages of the sample bundle before this was written,
 * against the cached Gemini reads of the same pages:
 *
 *   page   Vision lines / measured   Vision chars   Gemini lines / interpolated   chars
 *   0      46 / 46                   2618           47 / 38                       2517
 *   5      50 / 50                   2762           50 / 46                       2673
 *   18     50 / 50                   1794           50 / 14                       1748
 *   22     17 / 17                    734           20 /  2                        719
 *
 * Every line measured rather than 72% of them sliced out of paragraph bands,
 * and MORE characters read on every page. `interpolatedLines` is 0 here by
 * construction, and that is the point rather than a coincidence.
 *
 * Cost, for the same 29-page bundle: $1.50 per 1,000 pages, so Rp 718 against
 * the Gemini path's Rp 4,002.
 */

import {
  assertLinesWellFormed,
  groupWordsIntoLines,
  type Line,
  type Word,
} from "./geometry.ts";
import type { Box } from "./render.ts";
import { pageGeometry, type ImageInput, type OcrReport } from "./gemini-ocr.ts";

/**
 * The recognition step, injected.
 *
 * Returns the PARSED `AnnotateImageResponse` for one image -- the element of
 * `responses[0]`, not the envelope -- as `unknown`, because this module
 * validates it rather than trusting a declaration. Declared here and consumed
 * only by `visionOcrPage`, which is what keeps the provider boundary readable:
 * nothing under `src/lib/pipeline/` learns how Vision is reached.
 */
export type AnnotateImage = (image: ImageInput) => Promise<unknown>;

/**
 * Bumped whenever this mapping changes what it makes of an identical response.
 *
 * The OCR caches in both scripts are content-addressed on the page pixels, and
 * that is hazard-free only for a FIXED converter. It is the exact counterpart
 * of `OCR_PROMPT_VERSION` in `gemini-ocr.ts`: Vision has no prompt to version,
 * but it very much has a conversion, and a change to how words become lines
 * changes what the same pixels produce just as surely as a reworded prompt
 * did. Bump it for any change to `wordsFromVisionResponse` or to how
 * `linesFromVisionResponse` groups, orders or numbers.
 */
export const VISION_MAPPING_VERSION = "v1";

/**
 * The one Vision feature this pipeline asks for.
 *
 * `DOCUMENT_TEXT_DETECTION` rather than `TEXT_DETECTION`: the dense-document
 * model is the one tuned for pages of printed text, and it is the only one
 * that returns the full block/paragraph/word/symbol tree this mapping reads.
 * `TEXT_DETECTION` would return a flat list and lose the word boxes' grouping.
 */
export const VISION_FEATURE = "DOCUMENT_TEXT_DETECTION";

/**
 * Indonesian first, English second.
 *
 * A hint, not a filter -- Vision detects language itself and these only break
 * ties. Both are needed because these documents genuinely mix the two: an
 * Indonesian contract with English service names and English-language email
 * headers, which is the same reason `ocr.ts` runs tesseract with `ind`.
 */
export const VISION_LANGUAGE_HINTS = ["id", "en"] as const;

/**
 * A vertex as Vision actually sends one, which is NOT what the reference
 * diagram suggests.
 *
 * `x` AND `y` ARE BOTH OPTIONAL, and a zero is sent as ABSENT rather than as
 * 0. That is a documented protobuf-JSON behaviour and it is the single most
 * likely way this mapping goes silently wrong: a word flush against the left
 * margin comes back as `{"y": 412}` with no `x` at all, and reading `v.x`
 * yields `undefined`, which turns every downstream `Math.min` into `NaN` and
 * every box built from it into a rectangle that fails validation or, worse,
 * one that does not. Every read of a vertex here goes through `coord`.
 */
type Vertex = { x?: number; y?: number };

function coord(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The axis-aligned bounding box of a polygon, or null if it has no usable
 * vertices.
 *
 * MIN/MAX RATHER THAN CORNERS 0 AND 2, because a `boundingBox` is a polygon
 * and is only a rectangle when the text is upright. Skewed or rotated text
 * comes back as a genuine quadrilateral, and reading `vertices[0]` and
 * `vertices[2]` as opposite corners would silently produce a box that is too
 * small, offset, or inverted. This pipeline crops rectangles, so the honest
 * conversion of a quadrilateral is the rectangle that contains it.
 *
 * `render.ts` already turns every page upright before recognition, so skew
 * here should be small -- but "should be small" is not a reason to read a
 * polygon as if it were a rectangle.
 */
function boxFromVertices(vertices: readonly Vertex[] | undefined): Box | null {
  if (!Array.isArray(vertices) || vertices.length === 0) return null;
  const xs = vertices.map((v) => coord(v.x));
  const ys = vertices.map((v) => coord(v.y));
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  // A zero-area box carries no position information a crop could use, and
  // `unionBoxes` would happily absorb it and drag a rectangle to the origin.
  if (!(w > 0) || !(h > 0)) return null;
  return { x, y, w, h };
}

/** What one word contributed, before grouping. */
type MappedWord = Word & { blockIndex: number };

/**
 * Whether this word ENDS its token, so the next word must start a new one.
 *
 * THE RULE IS "ONLY AN ABSENT BREAK GLUES", and it is stated that way round on
 * purpose. Vision reports a `detectedBreak` on the last symbol of a word
 * whenever anything separates it from the next -- a space, the end of a line,
 * a hyphenated split. It reports NOTHING between a token and the punctuation
 * stuck to it, which is the one case that should join.
 *
 * The inverse phrasing was tried and was wrong: treating only SPACE-ish breaks
 * as separators left LINE_BREAK gluing the end of one visual line to the start
 * of the next, producing a single "word" whose box spanned two rows. A test
 * caught it, which is the whole reason the fixtures carry real break types.
 *
 * HYPHEN ends a token here too. A word split across a line break is two
 * fragments in two places on the page, and this pipeline's unit is a
 * rectangle: joining them would produce one box covering both lines and every
 * line between.
 */
function endsToken(word: {
  symbols?: unknown;
  property?: { detectedBreak?: { type?: unknown } };
}): boolean {
  const symbols = Array.isArray(word?.symbols) ? word.symbols : [];
  const last = symbols[symbols.length - 1] as
    | { property?: { detectedBreak?: { type?: unknown } } }
    | undefined;
  const type =
    last?.property?.detectedBreak?.type ?? word?.property?.detectedBreak?.type;
  if (typeof type !== "string" || type === "UNKNOWN") return false;
  return true;
}

/** Do two boxes share any vertical extent? */
function overlapsVertically(a: Box, b: Box): boolean {
  return a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Every word in the response, in reading order, with a real box each.
 *
 * Reading order is Vision's own: it emits blocks top-to-bottom in its detected
 * order, and paragraphs and words within them. `groupWordsIntoLines` sorts by
 * y anyway, so this ordering is a tie-break rather than the source of truth --
 * which matters on the multi-column and tabular contract pages in this bundle,
 * where a naive left-to-right read would interleave two columns.
 */
export function wordsFromVisionResponse(response: unknown): {
  words: MappedWord[];
  blocks: number;
  dropped: number;
} {
  const words: MappedWord[] = [];
  let blocks = 0;
  let dropped = 0;
  // Whether the PREVIOUS word ended with whitespace. Starts true so the first
  // word of the page is never glued to nothing.
  let pendingSpace = true;

  const annotation = (response as { fullTextAnnotation?: unknown } | null)
    ?.fullTextAnnotation as { pages?: unknown } | undefined;
  const pages = Array.isArray(annotation?.pages) ? annotation.pages : [];

  for (const page of pages as Array<{ blocks?: unknown }>) {
    const pageBlocks = Array.isArray(page?.blocks) ? page.blocks : [];
    for (const block of pageBlocks as Array<{ paragraphs?: unknown }>) {
      const blockIndex = blocks;
      blocks += 1;
      const paragraphs = Array.isArray(block?.paragraphs) ? block.paragraphs : [];
      for (const para of paragraphs as Array<{ words?: unknown }>) {
        const paraWords = Array.isArray(para?.words) ? para.words : [];
        for (const word of paraWords as Array<{
          symbols?: unknown;
          boundingBox?: { vertices?: Vertex[] };
        }>) {
          const symbols = Array.isArray(word?.symbols) ? word.symbols : [];
          const text = (symbols as Array<{ text?: unknown }>)
            .map((s) => (typeof s?.text === "string" ? s.text : ""))
            .join("");
          const box = boxFromVertices(word?.boundingBox?.vertices);
          // A word with no glyphs or no usable box is counted and discarded
          // rather than passed on. `groupWordsIntoLines` would place a
          // zero-area box into a row and widen that row's union to reach it.
          if (!text.trim() || !box) {
            dropped += 1;
            continue;
          }

          // GLUED TO THE PREVIOUS WORD when Vision reported no space between
          // them, so a token and its punctuation arrive as one word with one
          // box. `groupWordsIntoLines` joins whatever it is given with single
          // spaces -- it was written for tesseract, which segments on
          // whitespace -- so the joining decision has to be made here, where
          // the break information exists.
          const previous = words[words.length - 1];
          if (
            previous &&
            !pendingSpace &&
            previous.blockIndex === blockIndex &&
            // BELT AND BRACES over the break information. Two fragments that
            // do not share any vertical extent are on different visual lines
            // whatever the breaks say, and merging them would produce one box
            // covering both rows and everything between.
            overlapsVertically(previous.box, box)
          ) {
            previous.text += text;
            previous.box = {
              x: Math.min(previous.box.x, box.x),
              y: Math.min(previous.box.y, box.y),
              w:
                Math.max(previous.box.x + previous.box.w, box.x + box.w) -
                Math.min(previous.box.x, box.x),
              h:
                Math.max(previous.box.y + previous.box.h, box.y + box.h) -
                Math.min(previous.box.y, box.y),
            };
          } else {
            words.push({ text, box, blockIndex });
          }
          pendingSpace = endsToken(word);
        }
      }
    }
  }

  return { words, blocks, dropped };
}

/**
 * One Vision response, converted into the numbered lines the rest of the
 * pipeline counts in, plus the same `OcrReport` shape the Gemini path emits.
 *
 * The report is deliberately the SAME TYPE, and its numbers come from the SAME
 * FUNCTION -- `pageGeometry`, which `gemini-ocr.ts` already exports and uses.
 * That is not code thrift. `scripts/compare-ocr.mjs`, the gate's per-page
 * table and the run logs all read these fields, and the entire case for
 * switching engines rests on comparing them; an engine that computed its own
 * coverage, median line height and density with its own thresholds would be
 * scored against the other one's numbers while measuring something subtly
 * different, which is the quietest way to get a migration wrong.
 */
export function linesFromVisionResponse(
  response: unknown,
  page: { width: number; height: number },
): { lines: Line[]; report: OcrReport } {
  const { words, blocks, dropped } = wordsFromVisionResponse(response);
  const lines = groupWordsIntoLines(words);

  // EVERY LINE IS MEASURED, and this is an assertion rather than a hope.
  // `groupWordsIntoLines` unions real word boxes, so nothing here is sliced
  // out of a band. The Gemini path reports 72% interpolated on this bundle; if
  // `interpolatedLines` below is ever anything but 0, this mapping has started
  // inventing geometry and that number is how anybody would find out.
  for (const line of lines) line.origin = "measured";

  // THE PRODUCER HALF OF THE CONTRACT, ASSERTED WHERE IT IS PRODUCED, which
  // this module was missing and the other two engines have. `gemini-ocr.ts`
  // calls this under exactly that comment and `ocr.ts` drops degenerate
  // tesseract boxes for the same reason; Vision is the third producer and did
  // neither. The dead `page.width` parameter was the tell -- it was accepted
  // and never read, because the call that would consume it was absent.
  //
  // It checks what every consumer downstream assumes and nothing re-checks:
  // contiguous numbering from zero, boxes inside the page, and top-to-bottom
  // order. A page that fails it is a page whose citations would name different
  // text than their rectangles cover.
  assertLinesWellFormed(lines, page.width, page.height);

  const geometry = pageGeometry(lines, page.height);

  return {
    lines,
    report: {
      // Vision's own block count. Not the same quantity as the Gemini path's
      // "entries in the model's reply", but the same KIND: how many regions
      // the engine returned before this module made lines of them.
      blocks,
      // Words, here. The Gemini path counts per-printed-line bands it had to
      // manufacture from paragraph boxes; this engine returns the fragments
      // directly, so the fragment count IS the word count.
      segments: words.length,
      lines: lines.length,
      interpolatedLines: lines.filter((l) => l.origin === "interpolated").length,
      droppedEntries: dropped,
      transcribedChars: geometry.transcribedChars,
      verticalCoverage: geometry.verticalCoverage,
      medianLineHeight: geometry.medianLineHeight,
      // Computed, not hardcoded to 0. A collapsed block is a paragraph
      // returned as one box, which is a GENERATIVE artefact a word-box engine
      // should not be able to produce -- but letting the shared checker say so
      // each run is worth more than asserting it here, because if Vision ever
      // does return one, the same DEGRADED warning fires for the same reason.
      collapsedBlocks: geometry.collapsedBlocks,
      lineDensityRatio: geometry.lineDensityRatio,
      degraded: geometry.reasons.length > 0,
      reasons: geometry.reasons,
    },
  };
}

/**
 * The whole page: recognise, then convert.
 *
 * The mirror of `ocrPageWithGemini`, deliberately the same shape so the two
 * engines are interchangeable at every call site.
 */
export async function ocrPageWithVision(
  image: ImageInput,
  page: { width: number; height: number },
  annotate: AnnotateImage,
): Promise<{ lines: Line[]; report: OcrReport }> {
  return linesFromVisionResponse(await annotate(image), page);
}
