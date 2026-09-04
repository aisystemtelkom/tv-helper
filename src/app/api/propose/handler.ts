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
 * not a page image, not a crop: `classifyPages` and `locateSlots` build TEXT
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
import type { Ask, DocType } from "../../../lib/pipeline/classify.ts";
import {
  endedOnDefinitiveNo,
  findContinuations,
  runningFurniture,
} from "../../../lib/pipeline/continuation.ts";
import {
  MAX_SLOTS_PER_LOCATE_CALL,
  locateSlots,
  type OcrPage,
  type SlotOutcome,
  type SlotQuestion,
  type Zone,
} from "../../../lib/pipeline/locate.ts";
// The wire contract, the provider-failure tag and the classify pass are
// SHARED WITH `/api/extract` and live in one copy under `src/lib/api/`. They
// are re-exported below under the names this route's callers and tests
// already use.
import {
  AskFailed,
  assertRunGlobalIndexes,
  assertWirePages,
  classifyByDocType,
  guardAsk,
  type WirePage,
} from "../../../lib/api/wire.ts";

export { assertRunGlobalIndexes, classifyByDocType };
export type { WirePage };

export type ProposeBody = {
  runId: string;
  pages: WirePage[];
  /** `SlotState.key`s still wanting a zone. Capture 1 is the bare slot key. */
  wanted: string[];
  /**
   * Captures that already hold evidence and have not been checked for a
   * lanjutan. Optional so an older client, or a test that only cares about the
   * search, needs no continuation phase at all.
   */
  captures?: { key: string; zone: Zone }[];
};

export type Proposal = {
  /** The `SlotState.key` this answers, ordinal suffix included. */
  key: string;
  zone: Zone;
  text: string;
  confidence: "high" | "low";
};

/** One capture's lanjutan chain. See `walkContinuations`. */
export type ContinuationAnswer = {
  key: string;
  zones: { zone: Zone; text: string; confidence: "high" | "low" }[];
  checked: boolean;
  reason: string;
};

export type ProposeResult = {
  proposals: Proposal[];
  /** Searched and not found, with why. Drives the dokumen tambahan loop. */
  outstanding: { key: string; reason: string }[];
  /** One entry per capture walked forward, found or not. */
  continuations: ContinuationAnswer[];
};

/**
 * Every page, the slot's preferred document type first.
 *
 * A PREFERENCE, NOT A FILTER. The 2026-08-31 corrections retired pool
 * narrowing: the tool is document-agnostic and must find a slot in whatever
 * documents were supplied, so every page stays in the pool and only the order
 * changes. Narrowing is what let the customer name match a printed email's own
 * `Cc:` header and ship the wrong customer on both deliverables.
 *
 * NOT THE SAME FUNCTION AS `rankedPoolForDocTypes` in
 * `src/lib/pipeline/extract.ts`, which is why both carry what they rank in
 * their names. This one ranks for ONE SLOT and reads the preference off
 * `SlotDef.docType`; that one ranks for a GROUP OF FIELD KEYS and is handed
 * the docType list outright. They take their arguments in different orders
 * and neither is a drop-in for the other.
 */
export function rankedPoolForSlot(
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
    // Carried through unchanged: the locate reply names a POSITION in this
    // pool, which is mapped back to this number, which is what lands in
    // `Zone.pageIndex`.
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
 *
 * THE RANGE IS WRITTEN FROM THE ARRAY LENGTH BUT READ BY LINE NUMBER, which
 * only agrees while `lines[k].i === k`. `parseProposeBody` already ran
 * `assertLinesWellFormed` over every page, so this is the second net rather
 * than the first -- but it is the net at the point of use, and it costs one
 * comparison. Without it a page numbered any other way cites a range that
 * simply names different text than the rectangle covers: nothing throws,
 * `boxForLineRange` is never called for a whole-page capture, and the
 * citation under the picture is quietly wrong.
 */
function wholePageZone(page: WirePage): Zone {
  const last = page.lines.length - 1;
  if (last >= 0 && page.lines[last].i !== last) {
    throw new Error(
      `page ${page.index}'s last line is numbered ${page.lines[last].i}, not ` +
        `${last}: a whole-page citation is written from the array length`,
    );
  }
  return {
    pageIndex: page.index,
    box: { x: 0, y: 0, w: page.width, h: page.height },
    lineRange: [0, Math.max(0, last)],
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
    // `seedSlots` seeds one capture per slot, so `rest` is normally empty. It
    // is not dead: a run stored under the old declared-count design still
    // carries `<key>#2` states, and a whole-page section supplies one page per
    // slot. Reported rather than left `pending` for ever, which is what the
    // operator's complaint was about.
    for (const key of rest) {
      outstanding.push({
        key,
        reason:
          "a whole-page section supplies one page per bagian, so this extra " +
          "capture has no page of its own; draw it by hand or supply a " +
          "dokumen tambahan",
      });
    }
  }
}

/**
 * Does each of these captures run on to the next page, and how far?
 *
 * ## Why this is a separate phase rather than more of the search
 *
 * They are two different questions and the difference is measurable. The
 * search asks "where in these 29 pages is the payment clause", a ~20k-token
 * listing that can land on the wrong page. This asks "does that block
 * continue onto page 20", ~760 tokens, 3.8% as much, and the page is GIVEN so
 * it CANNOT land on the wrong one. Asked the wide way, the sample's ToP
 * continuation answers lines 5-16 and fails containment against the human's
 * 0-15 -- the gate's long-standing `KB / ToP (2)` miss. Asked here, given the
 * page, it answers 0-15 exactly. The narrow question is not merely cheaper, it
 * is the one the model gets right.
 *
 * ## Scoped to ONE SOURCE DOCUMENT, which is what `sourceId` is for
 *
 * A chain may not walk out of the file it started in: the last page of a
 * merged contract scan is not continued by the first page of a separate
 * SPLITBA scan, however adjacent their run-global numbers are. Pages are
 * grouped by `sourceId` here and the running-furniture pool is per document
 * too -- pooling the 27-page contract separately from the 2-page SPLITBA is
 * what correctly gives the SPLITBA pages no footer lines at all.
 *
 * ## A provider failure is NOT a chain that ended
 *
 * `findContinuations` turns any error from its confirming call into a
 * "model-error" step and stops the chain, which is right for a malformed reply
 * and catastrophic for a 503: the capture would be recorded as CHECKED, and
 * "we looked and there is no lanjutan" is the one thing this feature must
 * never say falsely. So the `Ask` is watched, and an `AskFailed` is re-thrown
 * to fail the whole request the way a failed locate does.
 */
async function walkContinuations(
  captures: readonly { key: string; zone: Zone }[],
  pages: WirePage[],
  ask: Ask,
  defs: Map<string, { section: SectionDef; slot: SlotDef }>,
): Promise<ContinuationAnswer[]> {
  if (captures.length === 0) return [];

  // Pages of one source document, in run order. `assertRunGlobalIndexes` has
  // already established that `index` is the position in the run, so "in order"
  // is the order they arrive in.
  const bySource = new Map<string, OcrPage[]>();
  for (const page of pages) {
    const list = bySource.get(page.sourceId) ?? [];
    list.push({
      index: page.index,
      width: page.width,
      height: page.height,
      lines: page.lines,
    });
    bySource.set(page.sourceId, list);
  }
  const sourceOfPage = new Map(pages.map((page) => [page.index, page.sourceId]));
  const furnitureBySource = new Map<string, Map<number, Set<number>>>();

  let providerFailure: unknown;
  const watchedAsk: Ask = async (prompt) => {
    try {
      return await ask(prompt);
    } catch (error) {
      if (error instanceof AskFailed) providerFailure ??= error;
      throw error;
    }
  };

  const answers: ContinuationAnswer[] = [];

  for (const capture of captures) {
    const entry = defs.get(slotKeyOf(capture.key));
    if (!entry) {
      answers.push({
        key: capture.key,
        zones: [],
        checked: false,
        reason: "no slot with this key in the template",
      });
      continue;
    }

    const sourceId = sourceOfPage.get(capture.zone.pageIndex);
    const documentPages = sourceId ? bySource.get(sourceId) : undefined;
    if (!sourceId || !documentPages) {
      // The zone names a page this run no longer holds. Recorded, not thrown:
      // the capture is broken for other reasons the operator will see anyway,
      // and `checked: false` keeps it honestly unexamined.
      answers.push({
        key: capture.key,
        zones: [],
        checked: false,
        reason:
          `page ${capture.zone.pageIndex} is not among the ${pages.length} ` +
          "pages supplied, so there is no next page to look at",
      });
      continue;
    }

    let furniture = furnitureBySource.get(sourceId);
    if (!furniture) {
      furniture = runningFurniture(documentPages);
      furnitureBySource.set(sourceId, furniture);
    }

    const walk = await findContinuations({
      slotLabel: entry.slot.label,
      hint: entry.slot.hint,
      zone: capture.zone,
      documentPages,
      furniture,
      // A whole-page capture ends at its page's last content line BY
      // CONSTRUCTION, so the geometric filter says nothing about it and three
      // of bundle one's six false positives were exactly that.
      wholePageCapture: entry.section.layout === "images",
      ask: watchedAsk,
    });
    if (providerFailure) throw providerFailure;

    const last = walk.steps[walk.steps.length - 1];
    answers.push({
      key: capture.key,
      // Read off the STEPS rather than off `walk.zones`, so the text and the
      // confidence that reach the operator are the ones recorded beside the
      // rectangle they describe. The two lists are parallel by construction,
      // and pairing them by index would go quietly wrong the day they are not.
      zones: walk.steps.flatMap((step) =>
        step.outcome === "found" && step.zone
          ? [
              {
                zone: step.zone,
                text: step.text ?? "",
                confidence: step.confidence ?? "low",
              },
            ]
          : [],
      ),
      // Only a definitive no counts as checked, READ OFF THE VERDICT. This was
      // `outcome === "declined" || "model-declined"`, and "declined" covers
      // stage 1's non-answers too: a whole-page capture is declined precisely
      // because the geometric test says nothing about it, so all four of this
      // template's `layout: "images"` captures were being recorded as
      // "diperiksa, tidak ada lanjutan" although nothing had looked. `cap` and
      // `model-error` are non-answers of the same kind, one page later.
      checked: endedOnDefinitiveNo(last),
      reason: last?.reason ?? "nothing to check",
    });
  }

  return answers;
}

/**
 * The search itself.
 *
 * ONE LOCATE CALL PER POOL -- not per capture and not per slot -- and NONE AT
 * ALL for a `layout: "images"` section, which is answered deterministically by
 * `wholePageProposals` before anything reaches the model.
 *
 * HOW MANY MODEL CALLS THAT IS, IS NOT THIS FILE'S DECISION. `locateSlots`
 * splits a pool by `MAX_SLOTS_PER_LOCATE_CALL`, which SHIPS AT 1 because every
 * multi-slot setting measured worse on the gate, so a pool of seven slots is
 * still seven model calls today and the wording above is about the call this
 * route makes, not about the bill. What the grouping does is make the saving
 * one env var away instead of one restructure away: raise the dial and those
 * seven questions become one prompt without another line changing here.
 *
 * ## Why the loop is over POOLS and not over slots
 *
 * A slot's pool is a function of `slot.docType` alone (`rankedPoolForSlot`
 * ranks by it and never filters), so every slot carrying the same docType is
 * searched over a byte-identical page listing. Every fillable `layout: "table"`
 * slot in `AO_TEMPLATE` carries `docType: "KB"`, so one call per slot sent that
 * listing seven times: measured on the 29-page sample bundle, 160.7k input
 * tokens for locate, of which about 138k was six redundant copies. Grouped,
 * and with the dial above raised, that is one call and ~23k.
 *
 * It matters more as bundles grow, which is what makes it worth a restructure
 * rather than a micro-optimisation: `locate` is the only stage whose cost
 * scales with SLOTS TIMES PAGES rather than with pages alone, so it is the line
 * that fails first when an order arrives with sixty pages instead of
 * twenty-nine. The cheaper-looking alternative -- keep seven calls and reorder
 * each prompt so the listing leads, earning Gemini's ~90% prefix discount -- was
 * measured and REVERTED: it works as advertised on cost and turns `KB / Nomor`
 * from an intermittent gate failure into a certain one. See "## The
 * prefix-cache experiment" in `src/lib/pipeline/locate.ts`'s header.
 *
 * The grouping is deliberately across SECTIONS, not within one: `kb.nomor` and
 * `kbLanjutan.detail` live in different sections, share a docType, and so share
 * a call. A per-section loop could never see that.
 *
 * ## What consolidating gives away, and where each piece is rebuilt
 *
 * The per-slot loop bought three properties for free. Each had to be paid for
 * in code, and the third was nearly lost silently:
 *
 *  - A BAD ANSWER COSTS ONE SLOT. `locateSlots` rebuilds this: a malformed
 *    range, or a `pageIndex` naming no page in the pool, fails that entry and
 *    no other, and arrives as `{ok: false, reason}` rather than as a throw.
 *  - A FAILED CALL COSTS ONE SLOT. This one cannot be rebuilt, because a pooled
 *    call either answered or it did not. A call-level failure marks EVERY slot
 *    in that pool outstanding, by name and with the reason -- never silently
 *    dropped, and never costing another pool or a whole-page capture.
 *  - A PROVIDER FAILURE STOPS THE REQUEST. It used to, because `locateSlot`
 *    threw and the `catch` here re-raised `AskFailed`. It NO LONGER DOES BY
 *    ITSELF: `locateSlots` catches per slot at `slotsPerCall <= 1`, so the tag
 *    `guardAsk` raises is swallowed and comes back as
 *    `{ok: false, reason: "the model could not be reached"}` -- which this loop
 *    would push as OUTSTANDING. Measured on the shipped dial before the fix
 *    below: a request whose classify succeeded and whose locate could not reach
 *    the provider answered 200 with every slot "outstanding", which means
 *    SEARCHED AND NOT FOUND, drives the dokumen tambahan loop, and would send
 *    the operator hunting for documents to fill slots nothing ever looked at.
 *    That is the exact defect `AskFailed` was written for, rebuilt one layer
 *    down. `watchedAsk` below restores it, the same way `walkContinuations`
 *    already watches `findContinuations` for the same reason.
 *
 * `scripts/generate.mjs` additionally falls back to one call per slot when the
 * pool call throws. That is right for a headless run which has already spent
 * minutes of OCR and cannot ask anybody anything; it is deliberately NOT done
 * here, where the operator is standing in front of the screen, the pages are
 * already on the device, and pressing Proses again is one click.
 *
 * A LANJUTAN IS NOT SEARCHED FOR HERE. Every slot is wanted as exactly one
 * capture now (`seedSlots` seeds one, `SlotDef.crops` is dead), and the rest of
 * a block that ran past a page bottom is found afterwards by
 * `walkContinuations`, working forward from the capture this search produced.
 * The `kbLanjutan.top` hint still describes only the FIRST capture, which is
 * still deliberate and still measured: naming the remittance block that the
 * sample's second picture holds made this one call land on the account page
 * and drop the clause. One call, one thing.
 */
export async function proposeZones(
  body: ProposeBody,
  rawAsk: Ask,
  template: Template = AO_TEMPLATE,
  // How many slots one locate call may carry. Defaults to the measured
  // shipped value (1, see MAX_SLOTS_PER_LOCATE_CALL) and is a parameter only
  // so a test can drive BOTH settings end to end: the grouping is one env var
  // away from being live, so "the route still behaves when it is raised" is a
  // property worth a test rather than a hope.
  slotsPerCall: number = MAX_SLOTS_PER_LOCATE_CALL,
): Promise<ProposeResult> {
  assertRunGlobalIndexes(body.pages);

  // Every model call in this function goes through the tagged wrapper, so a
  // provider failure cannot be reported as a slot that was searched.
  const ask = guardAsk(rawAsk);

  const proposals: Proposal[] = [];
  const outstanding: { key: string; reason: string }[] = [];

  const defs = new Map(
    template.sections.flatMap((section) =>
      section.slots.map((slot) => [slot.key, { section, slot }] as const),
    ),
  );

  // Nothing to search does not mean nothing to do: a run whose slots are all
  // confirmed can still have captures nobody has looked past, which is the
  // whole point of a second Proses after the operator drew a zone by hand.
  if (body.pages.length === 0) {
    return { proposals, outstanding, continuations: [] };
  }
  if (body.wanted.length === 0) {
    return {
      proposals,
      outstanding,
      continuations: await walkContinuations(
        body.captures ?? [],
        body.pages,
        ask,
        defs,
      ),
    };
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

  // Every table slot still wanting a zone, grouped under the pool it would
  // have searched on its own. The docType IS the group identity because the
  // pool is a function of nothing else; `null` is a real group -- a slot with
  // no preference gets an unranked pool -- and the sentinel below keeps it from
  // colliding with a docType literally named "null".
  const NO_DOC_TYPE = "(no docType)";
  const byPool = new Map<string, { slot: SlotDef; captureKeys: string[] }[]>();

  for (const [slotKey, captureKeys] of wantedBySlot) {
    const entry = defs.get(slotKey);
    const slot = entry?.slot;
    // Already answered above, deterministically. Sending it on to the model is
    // the defect `wholePageProposals` exists to stop, and it must be stopped
    // HERE rather than by the model declining: asking for a region inside a
    // page that IS the capture returns a plausible-looking fragment every time.
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

    const poolKey = slot.docType ?? NO_DOC_TYPE;
    const group = byPool.get(poolKey);
    if (group) group.push({ slot, captureKeys });
    else byPool.set(poolKey, [{ slot, captureKeys }]);
  }

  // A PROVIDER FAILURE MUST NOT ARRIVE HERE AS AN OUTCOME. `locateSlots`
  // catches per slot at the shipped `slotsPerCall` of 1, so the `AskFailed`
  // that `guardAsk` raises no longer reaches this function's own `catch`: it
  // comes back as `{ok: false}` and would be pushed as outstanding. See the
  // header for the measured 200-OK-full-of-outstanding that produced. Watched
  // rather than re-tagged, because the failure has to be recognised wherever
  // the layer below decides to swallow it.
  let providerFailure: unknown;
  const watchedAsk: Ask = async (prompt) => {
    // Already down. The remaining slots of this pool would each buy the same
    // failure, and this function is about to throw it either way.
    if (providerFailure) throw providerFailure;
    try {
      return await ask(prompt);
    } catch (error) {
      if (error instanceof AskFailed) providerFailure ??= error;
      throw error;
    }
  };

  for (const group of byPool.values()) {
    // Every slot in the group ranks the same pool, so it is built once from
    // whichever of them is first. `body.pages` is known non-empty by here, and
    // ranking never drops a page, so this pool always has something in it.
    const pool = rankedPoolForSlot(group[0].slot, body.pages, byType);

    // ASKED WITH `slot.label`, NOT WITH A SECTION-PREFIXED ONE, and that is a
    // deliberate difference from `scripts/generate.mjs`. Changing what the
    // model is asked is a prompt change, and AGENTS.md's rule is that a prompt
    // change is not made without re-running the measurement gate. The reply is
    // keyed by `slot.key`, which is unique, so two slots sharing a label ("TTD
    // Pejabat" appears twice in `AO_TEMPLATE`) still cannot have their answers
    // merged.
    const questions: SlotQuestion[] = group.map(({ slot }) => ({
      key: slot.key,
      label: slot.label,
      hint: slot.hint,
    }));

    let outcomes: Map<string, SlotOutcome>;
    try {
      outcomes = await locateSlots(questions, pool, watchedAsk, slotsPerCall);
    } catch (error) {
      // The model was never reached. Reporting these slots "outstanding" would
      // tell the operator they are not in the bundle, which nobody has checked.
      // Both spellings: thrown straight out of the pooled path, or caught by
      // `locateSlots` and seen only by `watchedAsk`.
      if (error instanceof AskFailed) throw error;
      if (providerFailure) throw providerFailure;
      // The call itself failed -- an unparseable reply, a schema the answer
      // does not fit. Under one call per slot that cost one slot; with one call
      // per pool it costs the pool, so EVERY slot in it is named with the
      // reason rather than quietly left out of both lists. Other pools, and
      // every whole-page capture, are untouched.
      const cause = error instanceof Error ? error.message : String(error);
      for (const { captureKeys } of group) {
        for (const key of captureKeys) {
          outstanding.push({ key, reason: `search failed: ${cause}` });
        }
      }
      continue;
    }
    // A returned map is not evidence the provider answered: at one slot per
    // call every failure is caught below and returned as an outcome.
    if (providerFailure) throw providerFailure;

    for (const { slot, captureKeys } of group) {
      const outcome = outcomes.get(slot.key);
      // `locateSlots` promises an outcome for every key it was handed. A short
      // answer is a bug there rather than a fact about the document, so it is
      // reported by name: a slot that fell out of both lists is a slot the
      // review screen never mentions again.
      if (!outcome) {
        for (const key of captureKeys) {
          outstanding.push({
            key,
            reason: "the search returned no outcome for this slot",
          });
        }
        continue;
      }

      // THE SEARCH FAILED FOR THIS SLOT, WHICH IS NOT THE SAME NEWS AS "NOT IN
      // THESE PAGES", and the wording keeps them apart. A model that looked and
      // found nothing answers null, which arrives as `ok: true` with a null
      // result and is reported below as "searched every page, not found". An
      // `ok: false` is one of: a reply this slot's answer could not be resolved
      // from (a `pageIndex` naming no page in the pool, a reversed range), or a
      // pooled reply that never mentioned this key at all -- and the second is
      // a failure too, not a considered no. `MAX_SLOTS_PER_LOCATE_CALL` records
      // the measurement: asked about seven slots at once the model answers in
      // 382 output tokens and OMITS one, which is silence rather than a verdict.
      // `locateSlots`' own reason is kept inside the prefix so the diagnosis
      // survives to the run log.
      //
      // This slot's alone, either way. The rest of the pool was answered by the
      // same reply and is untouched.
      if (!outcome.ok) {
        for (const key of captureKeys) {
          outstanding.push({ key, reason: `search failed: ${outcome.reason}` });
        }
        continue;
      }

      const found = outcome.result;
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
      // As above: normally empty. A leftover `<key>#2` from an older run is not
      // something a whole-bundle search can answer -- a lanjutan is defined by
      // the capture it follows -- so it is reported and then walked forward
      // from below like any other capture.
      for (const key of rest) {
        outstanding.push({
          key,
          reason:
            "a lanjutan is found by working forward from the capture before it, " +
            "not by searching the bundle; it is checked once the first capture " +
            "is in place",
        });
      }
    }
  }

  // LAST, AND OVER THIS ROUND'S OWN PROPOSALS TOO. A capture the browser has
  // never seen cannot be in `body.captures`, so a first Proses would otherwise
  // find every bagian and check none of them for a lanjutan, and the operator
  // would have to press the button twice to get the second half of a clause.
  const continuations = await walkContinuations(
    [
      ...(body.captures ?? []),
      ...proposals.map((proposal) => ({
        key: proposal.key,
        zone: proposal.zone,
      })),
    ],
    body.pages,
    ask,
    defs,
  );

  return { proposals, outstanding, continuations };
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
  // EVERY PAGE'S SHAPE, GEOMETRY AND NUMBERING, in one shared check, because
  // `/api/extract` rests on exactly the same contract and a second copy of it
  // is a copy that can silently disagree. What it refuses and why is written
  // out in `src/lib/api/wire.ts`; the short version is that the whole pipeline
  // counts in lines, so a page numbered any other way buys a full search and
  // returns a plausible citation of the wrong text. Checked HERE, before the
  // gate lets anything spend the credential on it.
  assertWirePages(body.pages as WirePage[]);
  assertCaptures(body.captures);
  return body as ProposeBody;
}

/**
 * The lanjutan half of the request, shape-checked like the pages are.
 *
 * ABSENT IS FINE, MALFORMED IS NOT. `captures` is optional so a client that
 * only wants the search sends nothing, and the walk over an empty list costs
 * nothing. What must not happen is a malformed one reaching
 * `walkContinuations`: `body.captures ?? []` accepts a string, `for..of` walks
 * its characters, and the first `capture.key` read throws a TypeError that
 * `createProposeHandler` catches on its provider-failure path. The operator
 * would be told the model could not be reached, and would press Proses again
 * for as long as they had patience. A caller's mistake has to answer 400.
 *
 * The zone is checked as far as this route relies on it -- a page number and a
 * line range, both used to pick the page to look at and to renumber lines
 * against it. `boxForLineRange` re-derives the rectangle downstream, so the
 * box is carried but never trusted here.
 */
function assertCaptures(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error("captures must be an array");

  value.forEach((capture, at) => {
    const where = `captures[${at}]`;
    if (!capture || typeof capture !== "object") {
      throw new Error(`${where} is not an object`);
    }
    const { key, zone } = capture as { key?: unknown; zone?: unknown };
    if (typeof key !== "string" || key === "") {
      throw new Error(`${where}.key must be a slot state key`);
    }
    if (!zone || typeof zone !== "object") {
      throw new Error(`${where}.zone is required`);
    }
    const { pageIndex, lineRange } = zone as {
      pageIndex?: unknown;
      lineRange?: unknown;
    };
    if (!Number.isInteger(pageIndex) || (pageIndex as number) < 0) {
      throw new Error(`${where}.zone.pageIndex must be a page number`);
    }
    if (
      !Array.isArray(lineRange) ||
      lineRange.length !== 2 ||
      !lineRange.every((n) => Number.isInteger(n) && n >= 0)
    ) {
      throw new Error(`${where}.zone.lineRange must be two line numbers`);
    }
  });
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
