import { z } from "zod";
import type { Box } from "./render.ts";
import { boxForLineRange, type Line } from "./geometry.ts";
import { extractJson } from "./json.ts";
import type { Ask } from "./classify.ts";

export type OcrPage = {
  index: number;
  width: number;
  height: number;
  lines: Line[];
};

export type Zone = {
  pageIndex: number;
  box: Box;
  lineRange: [number, number];
};

export type LocateResult = {
  zone: Zone;
  text: string;
  confidence: "high" | "low";
} | null;

/**
 * A crop flush against the glyphs looks clipped once it is a picture in a
 * Word table. Twelve pixels at 300 DPI is about 1mm of white space.
 */
export const CROP_PADDING_PX = 12;

const Reply = z.object({
  pageIndex: z.number().int().min(0).nullable(),
  from: z.number().int().min(0).nullable(),
  to: z.number().int().min(0).nullable(),
  confidence: z.enum(["high", "low"]),
});

/**
 * Page headers are numbered by their *position in this listing* (0, 1, 2...
 * in the order shown), never by the page's true index in the source
 * document. A pool like the Surat Penunjukan's `[23, 24, 25, 26]` would
 * otherwise be the only pool whose first page is not labeled "page 0" --
 * measured behaviour (see task-7-report.md) is that the model then answers
 * with a `pageIndex` one below the true page it clearly meant (its chosen
 * `from`/`to` lines matched the intended page's content exactly, just under
 * the wrong label), consistent with treating a non-zero first label as a
 * 1-based ordinal to be converted to 0-based rather than an opaque id to
 * echo back. Every other pool offered so far happens to start at 0, which
 * hides this: a "-1 conversion" and "copy the label verbatim" habit produce
 * the same answer when the first label is already 0. Local, always-0-based
 * position numbering removes the ambiguity outright instead of trying to
 * out-word it, and costs nothing -- `locateSlot` maps the reply straight
 * back to `pages[reply.pageIndex].index` for the true page identity.
 *
 * ## Known defect: running page footers get swallowed. Do not "fix" it blind.
 *
 * The boundary paragraph below stops the block at "the next heading, the next
 * unrelated section, or the end of the page". A running page footer is none of
 * those, and the model duly runs into it. Measured on the sample bundle: for
 * `KB / TTD Pejabat` the model answers lines 1-16 of the contract's last page,
 * where lines 7-15 are the signature block (ending at y=1493 of a 3507px page)
 * and line 16 is the initialling-and-page-number strip at y=3216. The union is
 * 9.5in tall for a signature block the human cropped at 1.3in: six inches of
 * blank paper in the deliverable. `SP / TTD`, `KB / Jangka Waktu`,
 * `KB / Detail` and `KB / ToP (1)` end on their page's footer the same way.
 *
 * The obvious repair -- naming a running header/footer as a stop condition in
 * the boundary paragraph -- was written and A/B'd against the real bundle
 * (same OCR, same model, same settings, cached old replies vs fresh new ones)
 * and **reverted, because it regressed a slot that passes today**. It did trim
 * the footers (`SP / TTD` 7.79in -> 2.32in, `KB / TTD Pejabat` 9.48in ->
 * 3.20in), but it also moved answers on nine of the twelve scored slots, and
 * `KB / Para Pihak` went from lines 11-42 -- which contains the whole
 * ground-truth crop, the recital paragraphs at lines 13-40 -- to lines 5-8,
 * the title block, which contains none of it. A containment pass turned into
 * an unambiguous miss. Adding one sentence here is not a local edit; it
 * re-rolls every slot.
 *
 * A geometric trim in `locateSlot` (drop a leading/trailing line that sits in
 * a y-band repeating across the pool's pages) was measured too, and does not
 * work either without tuning constants to this one bundle: the KB footer band
 * sits at 91.7-92.7% of page height while `KB / Detail`'s last body line sits
 * at 90.4%, so any threshold that catches the footer is a few pixels away from
 * silently deleting real evidence -- and per the 2026-08-31 corrections spec
 * the tool must be document-agnostic, which a constant fitted to this bundle's
 * footer geometry is not.
 *
 * So this stays open on purpose. Whoever takes it: re-run `pnpm measure:locate`
 * as part of the change, not after it.
 */
export function buildLocatePrompt(
  slotLabel: string,
  hint: string,
  pages: OcrPage[],
): string {
  const listing = pages
    .map(
      (p, position) =>
        `--- page ${position} ---\n` +
        p.lines.map((l) => `${l.i}: ${l.text}`).join("\n"),
    )
    .join("\n\n");

  return [
    `Find the section of this document that answers the field "${slotLabel}".`,
    `What that field means: ${hint}`,
    "",
    "The pages below are OCR text with every line numbered. Choose the whole",
    "labelled block or section that contains this field, not the single line",
    "that states it. The result is cropped out and pasted into a validation",
    "document as evidence, so it must carry enough surrounding context for a",
    "reviewer to see what they are looking at without opening the source.",
    "",
    "Include the section heading or label line, every line of that block, and",
    "stop at the natural boundary: the next heading, the next unrelated",
    "section, or the end of the page. When the field sits inside a table or a",
    "numbered clause, return the whole table or clause. Prefer taking a few",
    "lines too many over cutting the block short. Do not run on into an",
    "unrelated section.",
    "",
    "Pages are numbered by their position in this list: the first page shown",
    "is page 0, the second is page 1, and so on, regardless of where each",
    "page sits in the original document.",
    "",
    'Reply with JSON only: {"pageIndex":0,"from":7,"to":8,"confidence":"high"}',
    "(pageIndex is that position number, not a document page number.)",
    'If no page contains it, reply {"pageIndex":null,"from":null,"to":null,',
    '"confidence":"low"}.',
    "",
    listing,
  ].join("\n");
}

export async function locateSlot(
  slotLabel: string,
  hint: string,
  pages: OcrPage[],
  ask: Ask,
): Promise<LocateResult> {
  const reply = Reply.parse(
    extractJson(await ask(buildLocatePrompt(slotLabel, hint, pages))),
  );

  if (reply.pageIndex === null || reply.from === null || reply.to === null) {
    return null;
  }

  // reply.pageIndex is a position in `pages` (see buildLocatePrompt's header
  // comment), not the page's own true index -- look it up by array position,
  // then use the page's real `.index` below for anything that leaves this
  // function.
  const page = pages[reply.pageIndex];
  if (!page) {
    throw new Error(
      `model returned pageIndex ${reply.pageIndex}, which is not a position in the ` +
        `${pages.length} pages offered (0-${pages.length - 1})`,
    );
  }

  const bounds: Box = { x: 0, y: 0, w: page.width, h: page.height };
  const box = boxForLineRange(
    page.lines,
    reply.from,
    reply.to,
    CROP_PADDING_PX,
    bounds,
  );

  return {
    zone: { pageIndex: page.index, box, lineRange: [reply.from, reply.to] },
    // Sorted by line number rather than trusting `page.lines`' array order.
    // `groupWordsIntoLines` is the only producer today and it emits lines in
    // `i` order, so this is currently a no-op -- but `OcrPage.lines` is a
    // plain `Line[]` a caller supplies, and the moment one is assembled from
    // a cache, a merge, or a re-ordered subset, an unsorted array turns this
    // join into scrambled evidence text. The box above is safe either way
    // (`unionBoxes` is order-independent); only the text is exposed. Scrambled
    // text is the wrong-and-quiet shape exactly: nothing throws, the crop
    // still looks right, and the transcript beside it silently disagrees
    // with the picture.
    text: page.lines
      .filter((l) => l.i >= reply.from! && l.i <= reply.to!)
      .sort((a, b) => a.i - b.i)
      .map((l) => l.text)
      .join("\n"),
    confidence: reply.confidence,
  };
}
