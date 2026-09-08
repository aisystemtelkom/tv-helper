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
  OverlayError,
  assertOverlay,
  emptyOverlay,
  resolveTemplate,
  type ProposedSection,
  type TemplateOverlay,
} from "../../../lib/forms/overlay.ts";
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
  discoverSections,
  type DiscoveryPage,
  type UnusableSection,
} from "../../../lib/pipeline/sections.ts";
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
  /**
   * THIS ORDER'S OWN FORM, as a diff against `AO_TEMPLATE`.
   *
   * The route used to search the compile-time template for every caller, which
   * was right for exactly as long as every order shared one form. It does not
   * any more: an operator renames a judul, hides one, adds one. A route reading
   * the constant would search for a bagian this order deleted and report the
   * miss, and would answer under names the operator replaced.
   *
   * OPTIONAL, AND ABSENT MEANS THE UNEDITED FORM. `resolveTemplate` returns the
   * base BY IDENTITY for an empty overlay, so a client that predates this field
   * behaves exactly as it did. `parseProposeBody` runs `assertOverlay` over it
   * before a token is spent, because this is a stored blob arriving from a
   * device and the guard is what turns a mistake into a 400 rather than a
   * TypeError beside a half-billed run.
   */
  overlay?: TemplateOverlay;
  /**
   * `RunSource.id`s to ASK WHAT JUDUL THEY CONTAIN. One model call each.
   *
   * ABSENT OR EMPTY MEANS ASK NOTHING, which keeps a client that predates this
   * field -- and a run whose berkas have all been asked about already -- sending
   * byte for byte the request this route has always taken.
   *
   * THE CLIENT DECIDES WHICH IDS GO IN, and the two rules it applies live in
   * `discoverIds` in `src/lib/ui/propose.ts`: never a berkas the operator
   * marked "tanpa AI" (`RunSource.ai === false`), and never one already
   * carrying `sectionsAskedFor`, which is the cost gate that stops a second
   * press of Baca dengan AI paying for the same answer.
   *
   * THIS ROUTE ENFORCES THE FIRST ANYWAY. A fenced berkas's pages arrive
   * `searchable: false` and are filtered out before discovery is offered any,
   * so an id naming one buys an honest "no pages" note instead of a usulan read
   * out of the one document the operator said the model must not look inside. A
   * route whose correctness rests on the caller having read a paragraph is a
   * route that breaks that promise the first time a script, an older tab or a
   * future screen forgets it.
   *
   * It deliberately does NOT enforce the second. `sectionsAskedFor` is stored
   * on the device and never sent here, and "Cari judul lagi" exists precisely
   * so a person can spend that call again on purpose.
   */
  discover?: string[];
};

/**
 * What one berkas was asked, and what came back.
 *
 * ONE ENTRY PER ID IN `discover`, ALWAYS, including a berkas that yielded
 * nothing and a berkas that had no readable page at all. The client sets
 * `sectionsAskedFor` off this list (`record-proposals`), and that flag records
 * THAT THE QUESTION WAS PUT rather than that the answer was useful -- so an id
 * that quietly fell out of the answer would be asked again on every press, for
 * ever, at one model call a time.
 */
export type DiscoveredSections = {
  sourceId: string;
  /**
   * Ready to file: ids are minted here so the client hands the array straight
   * to `record-proposals` rather than assembling an overlay shape of its own.
   *
   * A `ProposedSection` IS NOT A JUDUL. `resolveTemplate` does not read
   * `overlay.proposed`, so nothing in this array can reach the docx exporter,
   * the xlsx, or the outstanding list until a person moves it into
   * `overlay.added` by accepting it.
   */
  sections: ProposedSection[];
  /** Entries the model named that could not be checked, and why. */
  unusable: UnusableSection[];
  /** One English sentence for the run log; see `SectionDiscovery.note`. */
  note: string;
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
  /**
   * NOT SEARCHED, AND WHY. A different statement from `outstanding`, and the
   * distance between them is the whole reason this list exists.
   *
   * `outstanding` means SEARCHED AND NOT FOUND: the operator sees "tidak
   * ditemukan", and it drives the dokumen tambahan loop, which asks them to go
   * and find another document. This list means nothing looked, so there is no
   * negative answer to report and nothing for the operator to hunt for. It must
   * NEVER be rendered as "tidak ditemukan".
   *
   * Two things land here, and both were reported as a not-found before:
   *
   *  - A BAGIAN INSIDE A JUDUL THE OPERATOR ADDED. An added judul is captured by
   *    hand by construction (`resolveTemplate` gives it no docType, no hint and
   *    a tombstone `ask`), so a search for it cannot exist. Reported as
   *    outstanding it would arrive on EVERY Proses, for ever, on the main path
   *    of the feature that adds one -- telling the operator to go and find a
   *    document for evidence they are holding.
   *  - A KEY THE RESOLVED FORM DOES NOT DECLARE. Once a judul can be deleted per
   *    order, a run's stored slot states outlive the form: the state is still in
   *    `run.slots` and nothing in the template answers to its key. "Searched, not
   *    found" about a bagian the operator themselves removed is simply a lie.
   *
   * IN PRACTICE THIS LIST COMES BACK EMPTY, AND IT STILL HAS TO EXIST.
   * `wantedKeys` and `capturesToWalk` in `src/lib/ui/propose.ts` both filter on
   * `isSearchable`, so the shipped client does not ask about either kind of key
   * -- and if that were the whole story, this route could simply assume it.
   * It may not. A route whose correctness rests on the caller having read a
   * paragraph is a route that answers "tidak ditemukan" the first time a
   * client, a script, an older tab or a future screen forgets one, and that
   * word drives a loop that sends the operator out to find documents. The
   * client's filter saves the tokens; this list is what makes the answer true
   * either way.
   */
  outOfScope: { key: string; reason: string }[];
  /** One entry per capture walked forward, found or not. */
  continuations: ContinuationAnswer[];
  /**
   * ONE ENTRY PER ID IN `body.discover`, in the order they were asked.
   *
   * Empty when nothing was asked, which is the ordinary case: discovery is
   * gated per berkas and a run whose documents have all been asked about pays
   * for nothing here.
   */
  sections: DiscoveredSections[];
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
 * position is the slot's FIXED ordinal instead. Counting only the wanted ones
 * here would hand `sp.2` the very page `sp.1` already holds whenever the
 * operator re-runs the search with `sp.1` confirmed.
 *
 * ## THE ORDINAL IS READ FROM THE SLOT, NOT COUNTED OFF ITS SIBLINGS
 *
 * This used to advance a running counter over the section's fillable slots,
 * keyed by docType, deliberately including the ones this request did not want
 * -- which bought exactly the property in the paragraph above while the section
 * list was a compile-time constant.
 *
 * IT STOPPED BEING SAFE THE DAY A RUN CAN EDIT ITS OWN FORM. Delete `sp.1` for
 * one order and the counter SLIDES `sp.2` onto the first SP page; restore
 * `sp.1` and it slides back, while `sp.2` may still be holding a CONFIRMED crop
 * of that very page. Two headings over one picture, silently, in a document a
 * validator signs -- this project's whole failure class, arriving on the happy
 * path of a feature whose entire point is that the form varies per order.
 * `SlotDef.pageOrdinal` declares the number, so it survives a sibling being
 * removed and a sibling coming back.
 *
 * A fillable whole-page slot that declares none is a TEMPLATE BUG and throws.
 * There is deliberately NO fallback to the counter: a fallback is how the
 * defect above survives a rewrite, quietly, in exactly the orders that edited
 * their form.
 */
function wholePageProposals(
  section: SectionDef,
  captureKeys: Map<string, string[]>,
  pages: WirePage[],
  byType: Map<DocType, Set<number>>,
  proposals: Proposal[],
  outstanding: { key: string; reason: string }[],
): void {
  for (const slot of section.slots) {
    if (!slot.fillable) continue;

    // AN ADDED BAGIAN NEVER PICKS A PAGE. It has no docType (`resolveTemplate`
    // gives it none), so the branch below would report it "whole-page slot with
    // no document type to identify its page" on every Proses for ever -- a
    // not-found about evidence the operator is holding in their hand. It is
    // reported instead as OUT OF SCOPE, by the routing pass in `proposeZones`
    // that runs over every wanted key; reporting it here as well would name it
    // twice. `section.added` is belt and braces for a template built by hand.
    if (slot.added || section.added) continue;

    // See the header. Read, never counted, and a missing one is a bug in the
    // template rather than a fact about this order's documents.
    if (slot.pageOrdinal === undefined) {
      throw new Error(
        `${slot.key}: pageOrdinal is required for a whole-page fillable slot ` +
          `(section "${section.id}", layout "images"), because such a slot ` +
          "picks its page BY POSITION among its document type's pages. " +
          "Declare it on the slot; there is deliberately no fallback to " +
          "counting siblings, which slides onto the wrong page the moment an " +
          "order removes one.",
      );
    }
    const position = slot.pageOrdinal;

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
      // The zone names a page this walk was not given. Recorded, not thrown:
      // the capture is broken for other reasons the operator will see anyway,
      // and `checked: false` keeps it honestly unexamined.
      //
      // A CAPTURE ON A BERKAS MARKED "tanpa AI" LANDS HERE TOO, and `checked:
      // false` is exactly right for it: nothing looked past that rectangle,
      // so nothing may record that it did. `capturesToWalk` drops those on the
      // client so this is normally unreachable for them, but the route may not
      // depend on the client having done it.
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
      slotAsk: entry.slot.ask,
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
 * A fresh `ProposedSection.id`.
 *
 * `u:`-prefixed because that is the one prefix no declared id uses, and
 * injectable so a test can pin what a usulan is called. See `NodeId` in
 * `../../../lib/forms/overlay.ts`.
 */
export type MintProposalId = () => string;

const defaultMintProposalId: MintProposalId = () => `u:${crypto.randomUUID()}`;

/**
 * WHAT JUDUL DOES EACH OF THESE BERKAS CONTAIN, as usulan a person rules on.
 *
 * ## Why this is a phase of `/api/propose` and not a route of its own
 *
 * `route.ts` is ~151 lines of authorization gate, per-call cost logging and
 * `maxDuration`, every line of which a second route would copy -- and a second
 * gate is a second gate to get wrong. It also asks the same question of the
 * same material the search already has in its hands: the run's OCR line text,
 * already validated by `assertWirePages`, already filtered by `searchable`.
 *
 * ## ONE CALL PER BERKAS, AND THE BERKAS IS THE UNIT ON PURPOSE
 *
 * A judul is a run of consecutive pages of ONE document. A span crossing a file
 * boundary is never a legitimate answer -- the last page of a merged contract
 * scan is not continued by the first page of a separate SPLITBA scan, however
 * adjacent their run-global numbers are -- so pooling two documents into one
 * prompt would offer the model an answer it must never give. It is the same
 * grouping `classifyByDocType` and `walkContinuations` both make, for the same
 * reason.
 *
 * ## A FENCED BERKAS IS ANSWERED, NOT SEARCHED
 *
 * Its pages are not in `pages` at all (the caller filtered on
 * `searchable !== false` before this runs), so it gets an entry saying so and
 * costs nothing. Dropping it from the answer instead would leave the client
 * asking again on every press: `sectionsAskedFor` is set off this list.
 *
 * ## A BAD REPLY COSTS ONE BERKAS, A PROVIDER FAILURE COSTS THE REQUEST
 *
 * The same split every other stage here makes, and the reason is the same one
 * `AskFailed` exists for. A reply that will not parse is a fact about one
 * answer and is reported as a note; a provider that could not be reached must
 * not come back as "this berkas has no judul", because that reads as an answer
 * nobody actually got.
 */
async function discoverJudul(
  wanted: readonly string[],
  pages: WirePage[],
  ask: Ask,
  mintId: MintProposalId,
): Promise<DiscoveredSections[]> {
  if (wanted.length === 0) return [];

  const bySource = new Map<string, DiscoveryPage[]>();
  for (const page of pages) {
    const list = bySource.get(page.sourceId) ?? [];
    // `page.index` IS THE RUN-GLOBAL POSITION (`assertRunGlobalIndexes` has
    // already established it), which is what a `ProposedSection.fromPages`
    // entry means and what `acceptProposal` indexes `run.pages` with.
    // `discoverSections` renumbers locally from 0 for the prompt and maps back
    // to this number itself.
    list.push({ index: page.index, lines: page.lines });
    bySource.set(page.sourceId, list);
  }

  const answers: DiscoveredSections[] = [];
  // DE-DUPLICATED, because a repeated id would be two model calls for one
  // answer and then two `record-proposals` edits, the second of which replaces
  // the first. Cheap to refuse here; invisible if it is not.
  for (const sourceId of new Set(wanted)) {
    const own = bySource.get(sourceId) ?? [];
    if (own.length === 0) {
      answers.push({
        sourceId,
        sections: [],
        unusable: [],
        note:
          "this berkas has no page the model may read, so nothing was asked " +
          "about it (it may be marked tanpa AI, or no longer be in this order)",
      });
      continue;
    }

    try {
      const found = await discoverSections(own, ask);
      answers.push({
        sourceId,
        sections: found.sections.map((section) => ({
          id: mintId(),
          title: section.title,
          fromSourceId: sourceId,
          fromPages: section.pages,
          cite: section.cite,
        })),
        unusable: found.unusable,
        note: found.note,
      });
    } catch (error) {
      // Never reached the model: fatal for the request, not a berkas that
      // merely would not answer. Reporting it as an empty judul list would say
      // "this document has no headings" about a call that never happened.
      if (error instanceof AskFailed) throw error;
      answers.push({
        sourceId,
        sections: [],
        unusable: [],
        note: `judul discovery failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
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
  // THIS ORDER'S RESOLVED FORM, and the default is the caller's overlay rather
  // than the compile-time constant. A default parameter may reference an
  // earlier one, so the wire and the explicit argument stay one mechanism:
  // every test and script that hands a `Template` over keeps working
  // unchanged, and a request carrying no overlay resolves to `AO_TEMPLATE` BY
  // IDENTITY.
  template: Template = resolveTemplate(
    AO_TEMPLATE,
    body.overlay ?? emptyOverlay(AO_TEMPLATE),
  ),
  // How many slots one locate call may carry. Defaults to the measured
  // shipped value (1, see MAX_SLOTS_PER_LOCATE_CALL) and is a parameter only
  // so a test can drive BOTH settings end to end: the grouping is one env var
  // away from being live, so "the route still behaves when it is raised" is a
  // property worth a test rather than a hope.
  slotsPerCall: number = MAX_SLOTS_PER_LOCATE_CALL,
  // Injected for the same reason `applySectionEdit` takes a `mintId`: a test
  // that cannot name the usulan it just made cannot assert anything about it.
  mintId: MintProposalId = defaultMintProposalId,
): Promise<ProposeResult> {
  // OVER THE FULL ARRAY, and before anything is filtered out of it. `index`
  // must be the page's position in `run.pages` because that is the number that
  // lands in `Zone.pageIndex`, and a run-global index is only checkable
  // against the run-global list. Filtering first would renumber the check and
  // let a caller's mistake through on any run holding a fenced-off berkas.
  assertRunGlobalIndexes(body.pages);

  /**
   * THE PAGES THE MODEL MAY BE ASKED ABOUT. Every stage below reads this list
   * and none of them reads `body.pages`.
   *
   * The operator marks a berkas "tanpa AI" and its pages arrive
   * `searchable: false`. They were still rendered and still OCR'd on the
   * device, and the operator can still cut a potongan out of them by hand;
   * what they withdrew is the model. So the pages stay in the request -- their
   * positions ARE the numbering the check above just enforced -- and they are
   * simply not offered to any prompt.
   *
   * FILTERED ON THE FLAG, NEVER ON `lines.length`. A page whose recogniser
   * found no text is a fact about the document and is still worth searching
   * around; a fenced page is a decision. `buildProposeRequest` withholds an
   * excluded page's lines at the boundary as well, so the two look alike on
   * the wire, and testing the text rather than the flag would make an
   * unreadable page indistinguishable from a fenced one in both directions.
   */
  const searchable = body.pages.filter((page) => page.searchable !== false);

  // Every model call in this function goes through the tagged wrapper, so a
  // provider failure cannot be reported as a slot that was searched.
  const ask = guardAsk(rawAsk);

  const proposals: Proposal[] = [];
  const outstanding: { key: string; reason: string }[] = [];
  // Keys this route did NOT search, and why. See `ProposeResult.outOfScope`:
  // every one of these used to be reported as a not-found, which is a
  // different and false statement about a bagian nothing ever looked for.
  const outOfScope: { key: string; reason: string }[] = [];

  const defs = new Map(
    template.sections.flatMap((section) =>
      section.slots.map((slot) => [slot.key, { section, slot }] as const),
    ),
  );

  // Nothing to search does not mean nothing to do: a run whose slots are all
  // confirmed can still have captures nobody has looked past, which is the
  // whole point of a second Proses after the operator drew a zone by hand.
  //
  // NO SEARCHABLE PAGE IS THE SAME ANSWER AS NO PAGE AT ALL, and it answers
  // with three EMPTY LISTS on purpose. A key named in neither `outstanding` nor
  // `outOfScope` is left exactly as the run holds it (`applyProposals` changes
  // only what the answer names), so a bagian stays "belum dicari" -- which is
  // the truth. Reporting it `outstanding` would say SEARCHED AND NOT FOUND
  // about pages nothing looked at and would send the operator hunting for a
  // document they are already holding; inventing a third reason would collapse
  // one of the distinctions `outOfScope` exists to keep.
  // JUDUL DISCOVERY RUNS FIRST, AND OUTSIDE EVERY EARLY RETURN BELOW.
  //
  // It is not part of the search and must not be gated on it. A run whose every
  // bagian is already confirmed has `wanted: []` and would take the second
  // early return; a run holding one berkas that is entirely unreadable takes
  // the first. In both, "what judul does this document contain" is still a
  // question worth asking and still one the operator pressed a key to ask, and
  // folding it behind either gate would make the answer depend on how much of
  // the FORM happened to be filled in.
  //
  // Offered `searchable` rather than `body.pages`, so a berkas the operator
  // marked tanpa AI reaches no prompt here either.
  const sections = await discoverJudul(
    body.discover ?? [],
    searchable,
    ask,
    mintId,
  );

  if (body.pages.length === 0 || searchable.length === 0) {
    return { proposals, outstanding, outOfScope, continuations: [], sections };
  }
  if (body.wanted.length === 0) {
    return {
      proposals,
      outstanding,
      outOfScope,
      sections,
      continuations: await walkContinuations(
        body.captures ?? [],
        searchable,
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

  // CLASSIFIES ONLY WHAT MAY BE SEARCHED, which also keeps `classifyPages`'
  // every-page-exactly-once contract intact rather than merely hoping it does.
  // `classifyByDocType` groups by `sourceId` and renumbers each group locally
  // from 0, and the coverage check inside `classifyPages` is against the length
  // of the list it was handed -- so any subset is dense by construction. In
  // practice the flag is per BERKAS, so exclusion drops whole sources and a
  // surviving document is offered entire.
  const byType = await classifyByDocType(searchable, ask);

  // Whole-page sections first, and out of the model's way entirely. Handled
  // per SECTION rather than per slot because "SP" and "SP (lanjutan)" mean
  // consecutive pages of one document, which is a fact about the section.
  //
  // A JUDUL THE OPERATOR ADDED IS SKIPPED HERE ENTIRELY, and it is `layout:
  // "images"` too -- every added judul is, by construction, because that is the
  // only layout `AddedSection` can resolve to. What it has not got is a docType,
  // so `wholePageProposals` could only report it as a whole-page slot whose page
  // cannot be identified. It is answered by hand and reported out of scope by
  // the routing pass below instead.
  const imageSections = new Set(
    [...wantedBySlot.keys()]
      .map((key) => defs.get(key)?.section)
      .filter(
        (section): section is SectionDef =>
          section !== undefined &&
          section.layout === "images" &&
          section.added === undefined,
      ),
  );
  for (const section of imageSections) {
    wholePageProposals(
      section,
      wantedBySlot,
      searchable,
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

  // THIS LOOP IS ALSO THE ROUTING PASS: it walks EVERY wanted key, including
  // the whole-page ones the section loop above has already answered, so it is
  // the one place that can say a key reached no list at all. The order of the
  // branches is load-bearing and reads worst-news-first: out of scope, then
  // already answered, then not searchable, then searched.
  for (const [slotKey, captureKeys] of wantedBySlot) {
    const entry = defs.get(slotKey);

    // NOT SEARCHED IS NOT NOT-FOUND, and these two were reported as not-found
    // until this diff. See `ProposeResult.outOfScope`. They are tested BEFORE
    // the `layout: "images"` skip below, which is the whole reason an added
    // bagian does not fall silently out of both lists: its section is excluded
    // from `imageSections`, so nothing else in this function would ever mention
    // it again.
    if (!entry) {
      for (const key of captureKeys) {
        // Kept verbatim from where this used to be pushed as outstanding: the
        // sentence was right, the list it went in was not.
        outOfScope.push({ key, reason: "no slot with this key in the template" });
      }
      continue;
    }
    if (entry.slot.added || entry.section.added) {
      for (const key of captureKeys) {
        outOfScope.push({
          key,
          reason:
            "the operator added this judul to this order, so its evidence is " +
            "taken by hand rather than searched for",
        });
      }
      continue;
    }

    const slot = entry.slot;
    // Already answered above, deterministically. Sending it on to the model is
    // the defect `wholePageProposals` exists to stop, and it must be stopped
    // HERE rather than by the model declining: asking for a region inside a
    // page that IS the capture returns a plausible-looking fragment every time.
    if (entry.section.layout === "images") continue;
    if (!slot.fillable) {
      for (const key of captureKeys) {
        outstanding.push({
          key,
          reason: "this slot is completed by hand, not from a document",
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
    // whichever of them is first. `searchable` is known non-empty by here, and
    // ranking never drops a page, so this pool always has something in it.
    const pool = rankedPoolForSlot(group[0].slot, searchable, byType);

    // ASKED WITH `slot.ask.label`, NOT WITH A SECTION-PREFIXED ONE, and that
    // is a deliberate difference from `scripts/generate.mjs`. Changing what the
    // model is asked is a prompt change, and AGENTS.md's rule is that a prompt
    // change is not made without re-running the measurement gate. The reply is
    // keyed by `slot.key`, which is unique, so two slots sharing a label ("TTD
    // Pejabat" appears twice in `AO_TEMPLATE`) still cannot have their answers
    // merged.
    //
    // `slot.ask` IS HANDED OVER WHOLE, not spread into a label and a hint. It
    // is the frozen half of the slot; `slot.label` is the operator's, is about
    // to be renameable per order, and must never reach this call.
    const questions: SlotQuestion[] = group.map(({ slot }) => ({
      key: slot.key,
      ask: slot.ask,
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
    searchable,
    ask,
    defs,
  );

  return { proposals, outstanding, outOfScope, continuations, sections };
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
  // ONE MODEL CALL PER ENTRY, so the list is checked before any of them is
  // made. Absent is legitimate and means ask nothing; a malformed one would
  // otherwise reach `discoverJudul`, where `new Set("abc")` walks a string's
  // characters and buys three calls about three berkas that do not exist.
  if (body.discover !== undefined) {
    if (!Array.isArray(body.discover)) {
      throw new Error("discover must be an array of source ids");
    }
    if (!body.discover.every((id) => typeof id === "string" && id !== "")) {
      throw new Error("discover must be an array of source ids");
    }
  }
  // THE FORM, SHAPE-CHECKED FOR THE SAME REASON THE PAGES ARE. An overlay is a
  // blob stored on a device and posted back, and `resolveTemplate` walks it
  // patch by patch: a malformed one would arrive as a TypeError inside
  // `deps.search`, which is the handler's PROVIDER-FAILURE path, and the
  // operator would be told the model could not be reached. `assertOverlay` also
  // refuses any `ask`/`hint`/`docType`/`layout`/`pageOrdinal`/`fillable` key at
  // any depth, which is the fence that keeps an operator's typing out of a
  // prompt. Absent is legitimate and means the unedited form.
  if (body.overlay !== undefined) assertOverlay(body.overlay);
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
      // THE FORM CAN STILL BE REFUSED HERE, and it is the caller's mistake
      // rather than the provider's. `assertOverlay` above checks the SHAPE;
      // `resolveTemplate` checks it against the base it is a diff of, and an
      // overlay written for another template throws `OverlayError` from inside
      // the search. Left to fall through, that would answer 503 and tell the
      // operator the model could not be reached about a body no model ever
      // saw.
      if (error instanceof OverlayError) return badRequest(error);
      return deps.unreachable(error instanceof AskFailed ? error.reason : error);
    }
  };
}
