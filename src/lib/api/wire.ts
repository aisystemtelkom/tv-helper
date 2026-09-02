/**
 * THE WIRE CONTRACT the model-backed routes share, in exactly one copy.
 *
 * `/api/propose` and `/api/extract` are handed the same thing by the browser:
 * the run's OCR'd pages, as text and boxes. Neither route ever sees a pixel --
 * the render and the OCR happen in the tab, which is what keeps the scans on
 * the operator's device -- so this file is the whole description of what
 * leaves it.
 *
 * WHY IT IS NOT COPIED INTO EACH ROUTE. Two copies of a validator are two
 * validators that can disagree, and the disagreement is silent: the route
 * with the weaker copy spends the credential on pages the other one would
 * have refused, and answers with citations of text that is not where it says
 * it is. That is this project's recorded failure class (AGENTS.md, "the
 * failure class this project cares about"), and it is the same argument the
 * 2026-09-03 findings make about `NEVER_EXTRACTED` living in two places.
 *
 * `src/app/api/propose/handler.ts` re-exports `WirePage` and
 * `assertRunGlobalIndexes` under their original names, because its tests and
 * its own callers name them there.
 */

import { classifyPages, type Ask, type DocType } from "../pipeline/classify.ts";
import { assertLinesWellFormed } from "../pipeline/geometry.ts";
import type { Line } from "../pipeline/geometry.ts";

/**
 * One page as the browser sends it.
 *
 * `index` IS THE RUN-GLOBAL PAGE NUMBER: the page's position in
 * `BrowserRun.pages`, which is append-only. It is NOT `StoredPage.index`,
 * which is the page's number within its own source document and restarts at 0
 * for every file. `locateSlot` copies the `index` it is given straight into
 * `Zone.pageIndex`, so sending the wrong one here would point every zone
 * after the first document at the wrong page -- the crop would still render,
 * still look like a crop, and cite the wrong file. `assertRunGlobalIndexes`
 * below refuses the request rather than trusting the caller to have read this
 * paragraph.
 *
 * `sourceName` and `pageInDoc` are the page's identity OUTSIDE this run's
 * bundle-global numbering, and they are optional because only the browser
 * knows them for certain. `/api/extract` writes them into the citation it
 * returns, since a citation naming only a bundle-global page number sends a
 * reviewer to the wrong document for every page after the first source file
 * (AGENTS.md, exporters). When they are absent the route DERIVES `pageInDoc`
 * from the position among the pages carrying the same `sourceId`, which is
 * true while a document's pages are appended in order -- the ingest loop
 * walks one PDF page by page, so they are -- and never invents a
 * `sourceName`.
 */
export type WirePage = {
  index: number;
  sourceId: string;
  width: number;
  height: number;
  lines: Line[];
  sourceName?: string;
  pageInDoc?: number;
};

/**
 * The contract the model-backed routes rest on, checked instead of assumed.
 *
 * The browser is asked to send `run.pages` in order, so a page's position in
 * the array IS its run-global index. If that ever stops being true, every
 * zone a route returns is silently attributed to the wrong page, and a
 * reviewer opens the wrong document. A 400 is enormously better.
 */
export function assertRunGlobalIndexes(pages: WirePage[]): void {
  pages.forEach((page, position) => {
    if (page.index !== position) {
      throw new Error(
        `pages[${position}] carries index ${page.index}. \`index\` must be the ` +
          "page's run-global position in BrowserRun.pages, not its number " +
          "within its own source document.",
      );
    }
  });
}

/**
 * Every page's shape, geometry and numbering, checked before a single token
 * is spent on any of it.
 *
 * THE SHAPE OF A LINE, not just that lines exist. `/api/propose` was careful
 * about the page NUMBERING contract twice over and took a `Line` on trust,
 * and the whole pipeline counts in lines: `locateSlot` numbers them for the
 * model, the model answers with a range of them, and `boxForLineRange` turns
 * that range back into the rectangle a validator ends up signing.
 * `extractFields` numbers them the same way and validates the range the model
 * cites against them. A page whose lines are numbered any other way, or carry
 * a NaN or an off-page box, produces a plausible citation of the wrong text.
 *
 * WRAPPED SO THE MESSAGE NAMES THE PAGE AND THE WAY OUT. The bare rule
 * ("lines[1].box is 0x12") is written for whoever is debugging a producer;
 * what reaches an operator here is a 400 on a run they have already ingested,
 * and the only two facts they can act on are which page is bad and that the
 * fix is to re-ingest. A run stored before the Gemini migration can trip this
 * -- the tesseract producer never validated its own boxes -- and re-ingesting
 * is what such a run needs anyway, because zones measured by one engine and
 * crops cut against another are the mixing that migration forbids.
 *
 * Deliberately ALL-OR-NOTHING rather than degrading per page. Excusing one
 * page would drop it from the search pool, and every slot or field that lives
 * on it would then report "searched and not found" -- which is a false
 * statement, and the exact thing `AskFailed` below exists to prevent
 * elsewhere.
 */
export function assertWirePages(pages: WirePage[]): void {
  for (const page of pages) {
    if (typeof page?.index !== "number" || typeof page?.sourceId !== "string") {
      throw new Error("every page needs a numeric index and a sourceId");
    }
    if (!Array.isArray(page.lines)) throw new Error("every page needs lines");
    // The page's own size, checked before the lines are, because
    // `assertLinesWellFormed` bounds every box against it: `x + w > undefined`
    // is false, so an absent width would make the on-page rule pass over
    // anything at all. `wholePageZone` also writes these two numbers straight
    // into a zone box, and a NaN box is the shape `cropToPng` used to encode
    // as an empty picture.
    if (
      !Number.isFinite(page.width) ||
      !Number.isFinite(page.height) ||
      page.width <= 0 ||
      page.height <= 0
    ) {
      throw new Error(
        `page ${page.index} needs a positive width and height in pixels`,
      );
    }
    // `sourceName` and `pageInDoc` are the two fields on `WirePage` that reach
    // an operator VERBATIM: `/api/extract` copies them into the citation and
    // `src/lib/export/xlsx.ts` renders the cell note as
    // `${sourceName} p${pageInDoc + 1}`. Unchecked, `pageInDoc: "not a number"`
    // was accepted and printed "s1 pnot a number1"; the interesting case is a
    // wrong-but-numeric one, which prints a page number that reads perfectly
    // and does not exist in that file. Every other field on this type was
    // validated on exactly that argument -- a page numbered any other way
    // returns a plausible citation of the wrong text -- and these two were the
    // exemption.
    if (page.sourceName !== undefined && typeof page.sourceName !== "string") {
      throw new Error(
        `page ${page.index} has a non-string sourceName. It is printed into ` +
          "the citation an operator reads, so it is the document's name or " +
          "it is absent.",
      );
    }
    if (page.pageInDoc !== undefined) {
      if (!Number.isInteger(page.pageInDoc) || page.pageInDoc < 0) {
        throw new Error(
          `page ${page.index} has pageInDoc ${JSON.stringify(page.pageInDoc)}. ` +
            "It is the page's 0-based number within its own source document.",
        );
      }
      // BOUNDED, not equated. The derivation this backs up (position among
      // the pages sharing a `sourceId`) is the same rule, so equality would
      // hold today for every producer -- but `/api/extract` deliberately lets
      // what the browser sends win over what is derived, because the browser
      // is the side that knows the real page number, and asserting equality
      // would make the field a no-op. The bound catches the failure the field
      // was added for (task-11 finding 2): a caller that sent the RUN-GLOBAL
      // index here, which for every document after the first is a number the
      // file does not have.
      const inDoc = pages.filter((p) => p.sourceId === page.sourceId).length;
      if (page.pageInDoc >= inDoc) {
        throw new Error(
          `page ${page.index} says it is page ${page.pageInDoc} of its own ` +
            `document, which this run carries ${inDoc} page(s) of. ` +
            "`pageInDoc` is the page's number within its source document, " +
            "not its run-global index.",
        );
      }
    }
    try {
      assertLinesWellFormed(page.lines, page.width, page.height);
    } catch (error) {
      throw new Error(
        `page ${page.index} has unusable line geometry: ` +
          `${error instanceof Error ? error.message : String(error)}. This run ` +
          "cannot be searched as stored; remove it and add the documents again.",
      );
    }
  }
  // Checked HERE, before the gate spends anything, because a caller that
  // numbered its pages the other way would otherwise pay for a full search
  // and receive citations pointing at the wrong documents.
  assertRunGlobalIndexes(pages);
}

/**
 * "The model could not be reached" wrapped so it cannot be mistaken for "the
 * model answered and found nothing".
 *
 * THIS DISTINCTION IS THE WHOLE POINT. Both arrive at the same `catch`, and
 * treating them alike produces the project's signature failure: a missing
 * credential came back 200 OK with every slot marked `"outstanding"`, which
 * means SEARCHED AND NOT FOUND and drives the dokumen tambahan loop. The
 * operator would have been sent to hunt for documents to fill slots that were
 * never actually searched, and nothing anywhere would have looked wrong. On
 * `/api/extract` the same shape would be a page of `not-found` fields -- an
 * operator told the bundle does not contain a customer name nothing ever read.
 *
 * So a throw from `ask` is tagged here, rethrown past the per-slot and
 * per-group handlers, and becomes a 503 that says the run was not changed. A
 * reply that arrives and is unusable is a different thing and is still
 * reported per slot or per field.
 */
export class AskFailed extends Error {
  // An explicit field, NOT a TypeScript parameter property: these modules are
  // executed by `node --test`, whose strip-only type stripping rejects
  // `constructor(readonly reason: unknown)` outright.
  reason: unknown;

  constructor(reason: unknown) {
    super("the model could not be reached");
    this.name = "AskFailed";
    this.reason = reason;
  }
}

/** Tags provider failures so a per-slot or per-field `catch` cannot swallow one. */
export function guardAsk(ask: Ask): Ask {
  return async (prompt: string) => {
    try {
      return await ask(prompt);
    } catch (error) {
      throw new AskFailed(error);
    }
  };
}

/** How much of a page classify sees. Headings live at the top. */
export const HEAD_LINES = 12;

/**
 * Document types per page, classified ONE SOURCE DOCUMENT AT A TIME.
 *
 * Per document rather than over the concatenation because a span is a run of
 * pages within one file: a span crossing a file boundary is never a
 * legitimate answer. `scripts/generate.mjs` classifies the same way.
 *
 * Classification is asked in LOCAL positions (0..n-1 within the document) and
 * mapped straight back to the run-global index, which is the same round trip
 * `locateSlot` and `extractFields` both make for their pool.
 */
export async function classifyByDocType(
  pages: WirePage[],
  ask: Ask,
): Promise<Map<DocType, Set<number>>> {
  const byType = new Map<DocType, Set<number>>();
  const sources = [...new Set(pages.map((p) => p.sourceId))];

  for (const sourceId of sources) {
    const own = pages.filter((p) => p.sourceId === sourceId);
    if (own.length === 0) continue;

    const heads = own.map((page, position) => ({
      index: position,
      head: page.lines
        .slice(0, HEAD_LINES)
        .map((l) => l.text)
        .join(" "),
    }));

    let spans;
    try {
      spans = await classifyPages(heads, ask);
    } catch (error) {
      // Never reached the model: that is fatal for the request, not a
      // document that merely would not classify.
      if (error instanceof AskFailed) throw error;
      // A document that will not classify still has pages worth searching:
      // ranking is a preference, never a filter, so an unclassified document
      // simply loses its head start. Failing the whole request instead would
      // cost the operator every slot.
      continue;
    }

    for (const span of spans) {
      const set = byType.get(span.docType) ?? new Set<number>();
      for (let p = span.fromPage; p <= span.toPage; p++) {
        const page = own[p];
        if (page) set.add(page.index);
      }
      byType.set(span.docType, set);
    }
  }

  return byType;
}
