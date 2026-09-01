/**
 * `/api/propose`: the only thing in this app that moves a slot to "proposed".
 *
 * WHY IT IS A SERVER ROUTE. The browser runtime deliberately never asks the
 * model anything -- `src/lib/model.ts` is the only file that may know how the
 * model is reached, and it is server-side because the credential is. So the
 * browser does the rendering and the OCR on the device, and asks this route
 * "where in these pages is each of these slots?".
 *
 * WHAT LEAVES THE DEVICE, EXACTLY. OCR LINE TEXT AND ITS BOXES. Not the PDF,
 * not a page image, not a crop: `classifyPages` and `locateSlot` build TEXT
 * prompts, and this route never touches pixels. That is the whole point of
 * doing the render and the OCR in the tab. Anything added here that sends an
 * image would move this project's data boundary, so do not add one without
 * the client's approval on the record.
 *
 * The control flow is separated from `route.ts` for the same reason
 * `/api/chat` is: so `src/app/api/propose/propose.test.mts` can execute the
 * authorization gate and the page-numbering guard with no Next runtime, no
 * bundler and no credential. `route.ts` is the production binding and nothing
 * else.
 */

import type { ApiGate } from "@/lib/auth/guard";

// Relative, with explicit `.ts`, and never through the `@/` alias: this file
// is executed directly by `node --test` (see the note above), which resolves
// neither a bare alias nor an extensionless specifier.
import { slotKeyOf } from "../../../lib/browser/slot-key.ts";
import {
  AO_TEMPLATE,
  type SectionDef,
  type SlotDef,
  type Template,
} from "../../../lib/forms/template.ts";
import { classifyPages, type Ask, type DocType } from "../../../lib/pipeline/classify.ts";
import type { Line } from "../../../lib/pipeline/geometry.ts";
import { locateSlot, type OcrPage, type Zone } from "../../../lib/pipeline/locate.ts";

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
 */
export type WirePage = {
  index: number;
  sourceId: string;
  width: number;
  height: number;
  lines: Line[];
};

export type ProposeBody = {
  runId: string;
  pages: WirePage[];
  /** `SlotState.key`s still wanting a zone, e.g. `kbLanjutan.top#1`. */
  wanted: string[];
};

export type Proposal = {
  /** The `SlotState.key` this answers, ordinal suffix included. */
  key: string;
  zone: Zone;
  text: string;
  confidence: "high" | "low";
};

export type ProposeResult = {
  proposals: Proposal[];
  /** Searched and not found, with why. Drives the dokumen tambahan loop. */
  outstanding: { key: string; reason: string }[];
};

/**
 * The contract the whole route rests on, checked instead of assumed.
 *
 * The browser is asked to send `run.pages` in order, so a page's position in
 * the array IS its run-global index. If that ever stops being true, every
 * zone this route returns is silently attributed to the wrong page, and a
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
 * "The model could not be reached" wrapped so it cannot be mistaken for "the
 * model answered and found nothing".
 *
 * THIS DISTINCTION IS THE WHOLE POINT. Both arrive at the same `catch`, and
 * treating them alike produces the project's signature failure: a missing
 * credential came back 200 OK with every slot marked `"outstanding"`, which
 * means SEARCHED AND NOT FOUND and drives the dokumen tambahan loop. The
 * operator would have been sent to hunt for documents to fill slots that were
 * never actually searched, and nothing anywhere would have looked wrong.
 *
 * So a throw from `ask` is tagged here, rethrown past the per-slot handlers,
 * and becomes a 503 that says the run was not changed. A reply that arrives
 * and is unusable is a different thing and is still reported per slot.
 */
class AskFailed extends Error {
  // An explicit field, NOT a TypeScript parameter property: this file is
  // executed by `node --test`, whose strip-only type stripping rejects
  // `constructor(readonly reason: unknown)` outright.
  reason: unknown;

  constructor(reason: unknown) {
    super("the model could not be reached");
    this.name = "AskFailed";
    this.reason = reason;
  }
}

/** Tags provider failures so a per-slot `catch` cannot swallow one. */
function guardAsk(ask: Ask): Ask {
  return async (prompt: string) => {
    try {
      return await ask(prompt);
    } catch (error) {
      throw new AskFailed(error);
    }
  };
}

/** How much of a page classify sees. Headings live at the top. */
const HEAD_LINES = 12;

/**
 * Document types per page, classified ONE SOURCE DOCUMENT AT A TIME.
 *
 * Per document rather than over the concatenation because a span is a run of
 * pages within one file: a span crossing a file boundary is never a
 * legitimate answer. `scripts/generate.mjs` classifies the same way.
 *
 * Classification is asked in LOCAL positions (0..n-1 within the document) and
 * mapped straight back to the run-global index, which is the same round trip
 * `locateSlot` makes for its pool.
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

/**
 * Every page, the slot's preferred document type first.
 *
 * A PREFERENCE, NOT A FILTER. The 2026-08-31 corrections retired pool
 * narrowing: the tool is document-agnostic and must find a slot in whatever
 * documents were supplied, so every page stays in the pool and only the order
 * changes. Narrowing is what let the customer name match a printed email's own
 * `Cc:` header and ship the wrong customer on both deliverables.
 */
export function rankedPool(
  slot: SlotDef,
  pages: WirePage[],
  byType: Map<DocType, Set<number>>,
): OcrPage[] {
  const preferred = slot.docType ? byType.get(slot.docType) : undefined;
  const head: WirePage[] = [];
  const tail: WirePage[] = [];

  for (const page of pages) {
    (preferred?.has(page.index) ? head : tail).push(page);
  }

  return [...head, ...tail].map((page) => ({
    // Carried through unchanged: `locateSlot` maps the model's pool POSITION
    // back to this number, which is what lands in `Zone.pageIndex`.
    index: page.index,
    width: page.width,
    height: page.height,
    lines: page.lines,
  }));
}

/**
 * A whole page, as a zone.
 *
 * `lineRange` covers every line the page has, so the citation the contact
 * sheet renders says so rather than claiming a region.
 */
function wholePageZone(page: WirePage): Zone {
  return {
    pageIndex: page.index,
    box: { x: 0, y: 0, w: page.width, h: page.height },
    lineRange: [0, Math.max(0, page.lines.length - 1)],
  };
}

/**
 * `layout: "images"` slots, taken WHOLE and with no model call.
 *
 * THIS ROUTE USED TO SEND THEM THROUGH `locateSlot` LIKE EVERYTHING ELSE, and
 * that is a category error `scripts/generate.mjs` has routed around since it
 * was written: a human filling the sample screenshots the entire page, so
 * there is no region inside the page to find, and asking for one returns a
 * plausible-looking fragment every time. It is how those slots failed the
 * first measurement run, and routing them out of the model took that gate from
 * 6/12 to 9/12. Four of this template's twelve captures are whole-page
 * (`ba.permintaan`, `sp.1`, `sp.2`, `email.1`), so a third of the deliverable's
 * evidence was a fragment of the right page presented as the page.
 *
 * Which page is `classifyPages`'s question, not `locateSlot`'s, and a slot
 * with no candidate is reported OUTSTANDING rather than given an arbitrary
 * page: plausible wrong evidence is the failure this project is organised
 * against, and an unclassified page is exactly that.
 *
 * WHERE THIS DELIBERATELY DIFFERS FROM `generate.mjs`. There, a slot's
 * position among its section's same-docType siblings counts only the slots
 * being filled THIS ROUND, because a tambahan round searches only the pages
 * the tambahan supplied. This route is always offered the whole run, so the
 * position is the slot's FIXED ordinal in the template instead. Counting only
 * the wanted ones here would hand `sp.2` the very page `sp.1` already holds
 * whenever the operator re-runs the search with `sp.1` confirmed.
 */
function wholePageProposals(
  section: SectionDef,
  captureKeys: Map<string, string[]>,
  pages: WirePage[],
  byType: Map<DocType, Set<number>>,
  proposals: Proposal[],
  outstanding: { key: string; reason: string }[],
): void {
  const fillable = section.slots.filter((slot) => slot.fillable);
  const seenOfType = new Map<DocType | null, number>();

  for (const slot of fillable) {
    // Advanced for EVERY fillable sibling, wanted or not, so the ordinal is
    // the slot's place in the template rather than in this request.
    const position = seenOfType.get(slot.docType) ?? 0;
    seenOfType.set(slot.docType, position + 1);

    const keys = captureKeys.get(slot.key);
    if (!keys) continue;

    const candidates = slot.docType
      ? pages.filter((page) => byType.get(slot.docType as DocType)?.has(page.index))
      : [];
    const page = candidates[position];

    if (!page) {
      for (const key of keys) {
        outstanding.push({
          key,
          reason: slot.docType
            ? `no ${slot.docType} page ${position} among the ${pages.length} pages searched`
            : "whole-page slot with no document type to identify its page",
        });
      }
      continue;
    }

    const [first, ...rest] = keys;
    proposals.push({
      key: first,
      zone: wholePageZone(page),
      text: page.lines.map((line) => line.text).join("\n"),
      // The classifier answered, not the locator. High because nothing was
      // guessed: the page is taken whole, so there is no extent to be wrong
      // about -- only the identification, which the operator still reviews.
      confidence: "high",
    });
    for (const key of rest) {
      outstanding.push({
        key,
        reason:
          "this slot holds more than one capture and a whole-page section " +
          "supplies one page per slot; add it by hand or supply a dokumen " +
          "tambahan",
      });
    }
  }
}

/**
 * The search itself.
 *
 * ONE MODEL CALL PER TEMPLATE SLOT, not per capture, and NONE AT ALL for a
 * `layout: "images"` section -- see `wholePageProposals`. A slot whose
 * `SlotDef.crops` is 2 is wanted as two `SlotState`s (`#1`, `#2`) but its
 * `hint` describes only the first of them -- deliberately, and measured:
 * naming both captures in one hint made the call land on the second and drop
 * the first. So the answer fills the lowest-numbered wanted capture and the
 * rest are returned OUTSTANDING, which is what hands them to the dokumen
 * tambahan loop and to manual selection instead of quietly leaving them
 * `pending` forever.
 */
export async function proposeZones(
  body: ProposeBody,
  rawAsk: Ask,
  template: Template = AO_TEMPLATE,
): Promise<ProposeResult> {
  assertRunGlobalIndexes(body.pages);

  // Every model call in this function goes through the tagged wrapper, so a
  // provider failure cannot be reported as a slot that was searched.
  const ask = guardAsk(rawAsk);

  const proposals: Proposal[] = [];
  const outstanding: { key: string; reason: string }[] = [];

  if (body.pages.length === 0 || body.wanted.length === 0) {
    return { proposals, outstanding };
  }

  // Wanted capture keys, grouped under the template key they belong to and
  // kept in the order the run stores them so `#1` is filled before `#2`.
  const wantedBySlot = new Map<string, string[]>();
  for (const key of body.wanted) {
    const slotKey = slotKeyOf(key);
    const list = wantedBySlot.get(slotKey);
    if (list) list.push(key);
    else wantedBySlot.set(slotKey, [key]);
  }

  const defs = new Map(
    template.sections.flatMap((section) =>
      section.slots.map((slot) => [slot.key, { section, slot }] as const),
    ),
  );

  const byType = await classifyByDocType(body.pages, ask);

  // Whole-page sections first, and out of the model's way entirely. Handled
  // per SECTION rather than per slot because "SP" and "SP (lanjutan)" mean
  // consecutive pages of one document, which is a fact about the section.
  const imageSections = new Set(
    [...wantedBySlot.keys()]
      .map((key) => defs.get(key)?.section)
      .filter(
        (section): section is SectionDef =>
          section !== undefined && section.layout === "images",
      ),
  );
  for (const section of imageSections) {
    wholePageProposals(
      section,
      wantedBySlot,
      body.pages,
      byType,
      proposals,
      outstanding,
    );
  }

  for (const [slotKey, captureKeys] of wantedBySlot) {
    const entry = defs.get(slotKey);
    const slot = entry?.slot;
    // Already answered above, deterministically. Sending it on to `locateSlot`
    // is the defect `wholePageProposals` exists to stop.
    if (entry?.section.layout === "images") continue;
    if (!slot || !slot.fillable) {
      for (const key of captureKeys) {
        outstanding.push({
          key,
          reason: slot
            ? "this slot is completed by hand, not from a document"
            : "no slot with this key in the template",
        });
      }
      continue;
    }

    const pool = rankedPool(slot, body.pages, byType);

    let found;
    try {
      found = await locateSlot(slot.label, slot.hint, pool, ask);
    } catch (error) {
      // The model was never reached. Reporting this slot "outstanding" would
      // tell the operator it is not in the bundle, which nobody has checked.
      if (error instanceof AskFailed) throw error;
      // One slot's failure costs that slot, not the run. By this point the
      // request may have spent a dozen calls on slots that succeeded, and the
      // operator finishes the document by hand anyway.
      const cause = error instanceof Error ? error.message : String(error);
      for (const key of captureKeys) {
        outstanding.push({ key, reason: `search failed: ${cause}` });
      }
      continue;
    }

    if (!found) {
      for (const key of captureKeys) {
        outstanding.push({ key, reason: "searched every page, not found" });
      }
      continue;
    }

    const [first, ...rest] = captureKeys;
    proposals.push({
      key: first,
      zone: found.zone,
      text: found.text,
      confidence: found.confidence,
    });
    for (const key of rest) {
      outstanding.push({
        key,
        reason:
          "this slot holds more than one capture and the search answers one " +
          "of them; add it by hand or supply a dokumen tambahan",
      });
    }
  }

  return { proposals, outstanding };
}

export type ProposeDeps = {
  /** The authorization gate. `requireApiUser` in production. */
  gate: () => Promise<ApiGate>;
  /** The model call. Only reached once `gate` has admitted the caller. */
  search: (body: ProposeBody) => Promise<ProposeResult>;
  /** Turns a provider failure into an operator-readable 503. */
  unreachable: (error: unknown) => Response;
  /** Malformed request. Separate from `unreachable`: it is the caller's. */
  badRequest?: (error: unknown) => Response;
};

function defaultBadRequest(error: unknown): Response {
  return Response.json(
    {
      error: "bad-request",
      message: "The request body is not a valid proposal request.",
      cause: error instanceof Error ? error.message : String(error),
    },
    { status: 400 },
  );
}

/** Shape-checks the body before a single token is spent on it. */
export function parseProposeBody(value: unknown): ProposeBody {
  const body = value as Partial<ProposeBody>;
  if (!body || typeof body !== "object") throw new Error("body is not an object");
  if (typeof body.runId !== "string" || body.runId === "") {
    throw new Error("runId is required");
  }
  if (!Array.isArray(body.pages)) throw new Error("pages must be an array");
  if (!Array.isArray(body.wanted)) throw new Error("wanted must be an array");
  if (!body.wanted.every((key) => typeof key === "string")) {
    throw new Error("wanted must be an array of slot keys");
  }
  for (const page of body.pages) {
    if (typeof page?.index !== "number" || typeof page?.sourceId !== "string") {
      throw new Error("every page needs a numeric index and a sourceId");
    }
    if (!Array.isArray(page.lines)) throw new Error("every page needs lines");
  }
  // Checked HERE, before the gate spends anything, because a caller that
  // numbered its pages the other way would otherwise pay for a full search
  // and receive zones pointing at the wrong documents.
  assertRunGlobalIndexes(body.pages as WirePage[]);
  return body as ProposeBody;
}

/**
 * THE ORDER IS THE POINT, and it is the same order `/api/chat` uses: the gate
 * runs before the body is read and before anything reaches
 * `src/lib/model.ts`. Moving it after either would still return 401 to an
 * anonymous caller while letting them spend the credential first.
 */
export function createProposeHandler(deps: ProposeDeps) {
  const badRequest = deps.badRequest ?? defaultBadRequest;

  return async function POST(req: Request): Promise<Response> {
    // 1. AUTHORIZE. First, unconditionally, in the handler itself.
    const gate = await deps.gate();
    if (gate.response) return gate.response;

    // 2. Only then read and validate what the caller sent.
    let body: ProposeBody;
    try {
      body = parseProposeBody(await req.json());
    } catch (error) {
      return badRequest(error);
    }

    // 3. Only then spend the credential. A provider that could not be reached
    //    arrives here tagged; unwrap it so the 503 names the real cause
    //    rather than the wrapper.
    try {
      return Response.json(await deps.search(body));
    } catch (error) {
      return deps.unreachable(error instanceof AskFailed ? error.reason : error);
    }
  };
}
