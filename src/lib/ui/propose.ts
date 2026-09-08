/**
 * Asking `/api/propose` to search the run, and folding the answer back in.
 *
 * This is the step that was missing entirely: the browser runtime never asks
 * the model anything (only a server route may reach `src/lib/model.ts`), so
 * without this every slot stayed `"pending"` for ever and the operator had
 * nothing to confirm. The product did not work end to end.
 *
 * `buildProposeRequest` and `applyProposals` are pure so `ui.test.mts` can
 * drive them. Only `requestProposals` touches the network, and it touches
 * exactly one host: this app.
 *
 * IT CARRIES A SECOND QUESTION NOW, and it is not a search. `discover` asks
 * what JUDUL each berkas contains, and the answer comes back as usulan filed in
 * `overlay.proposed` by `applyDiscoveries`. Nothing there can reach a
 * deliverable: `resolveTemplate` does not read that array, so a heading the
 * model named exists only as a decision waiting for a person.
 */

import { captureOrdinalOf, withDiscoveredCaptures } from "./runtime.ts";
import type { BrowserRun, DiscoveredCapture, SlotState } from "./runtime.ts";
import { continuationChecked } from "../browser/captures.ts";
// From the leaf modules rather than from `../browser/runtime.ts`, for the
// reason `captures.ts` is imported that way above: this module is pure and is
// driven by `node --test`, which has neither IndexedDB nor a Web Worker.
import { applySectionEdit } from "../browser/sections.ts";
import { aiExcludedSources } from "../browser/sources.ts";
import { isSearchable } from "../forms/overlay.ts";
import type { ProposedSection, TemplateOverlay } from "../forms/overlay.ts";
import type { Template } from "../forms/template.ts";

type Zone = NonNullable<SlotState["zone"]>;

export type ProposeRequest = {
  runId: string;
  pages: {
    index: number;
    sourceId: string;
    width: number;
    height: number;
    lines: BrowserRun["pages"][number]["lines"];
    /**
     * ABSENT ON EVERY ORDINARY PAGE, and only ever `false`. See
     * `WirePage.searchable` in `src/lib/api/wire.ts`: absent means the page may
     * be searched, so a run with no berkas fenced off sends exactly the body it
     * sent before this field existed.
     */
    searchable?: false;
  }[];
  wanted: string[];
  /**
   * Captures that already hold evidence and have never been checked for a
   * lanjutan, so the route can walk each one forward onto the next page.
   *
   * Sent as well as `wanted`, not instead of it: they are two different
   * questions. `wanted` asks "where is this bagian", which is a search over
   * every page; this asks "does that block run on", which is one page, given.
   */
  captures: { key: string; zone: Zone }[];
  /**
   * THIS ORDER'S OWN FORM, so the route searches for the bagian the operator is
   * actually looking at.
   *
   * The route used to read the compile-time template, which was right for
   * exactly as long as every order shared one. `wantedKeys` already filters on
   * this order's form, so the two would have disagreed the moment a judul was
   * added: the client would ask about a bagian the route could not name, and
   * the answer would come back `outOfScope` on every reading pass.
   */
  overlay: TemplateOverlay;
  /**
   * The berkas to ASK WHAT JUDUL THEY CONTAIN. See `discoverIds`.
   *
   * ALWAYS PRESENT AND OFTEN EMPTY, which is the steady state rather than an
   * edge case: discovery is gated per berkas by `RunSource.sectionsAskedFor`,
   * so a second press of Baca dengan AI on an unchanged order sends nothing
   * here and pays for nothing.
   */
  discover: string[];
};

/**
 * What judul discovery read out of ONE berkas.
 *
 * A HAND-WRITTEN MIRROR of `DiscoveredSections` in
 * `src/app/api/propose/handler.ts`, for the same reason `ProposeResponse` below
 * is one: this is the browser's side of a JSON wire, and importing the route's
 * module would drag the route's imports into the client bundle.
 */
export type DiscoveredSections = {
  sourceId: string;
  /** Ready to file. The route mints the ids. */
  sections: ProposedSection[];
  /** What the model named and the route refused, with why. */
  unusable: { title: string; reason: string }[];
  /** One English sentence for the log. Never rendered to the operator. */
  note: string;
};

/**
 * One lanjutan chain, as the route answers it.
 *
 * `zones` is the WHOLE CHAIN in order, not one answer: the payment clause that
 * prompted this feature runs to two captures on this bundle and the second
 * sample bundle has a slot holding ten. Each is appended as its own capture,
 * so nothing anywhere has to know the number in advance.
 */
export type ContinuationAnswer = {
  /** The `SlotState.key` walked forward from. */
  key: string;
  zones: { zone: Zone; text: string; confidence: "high" | "low" }[];
  /**
   * The walk reached a definitive no. False when it stopped at the chain cap
   * or on an error, which is why it is not simply `zones.length < cap`: "we
   * ran out of budget" must never be recorded as "there is nothing there".
   */
  checked: boolean;
  /** One sentence, with the page and line numbers in it, for the log. */
  reason: string;
};

export type ProposeResponse = {
  proposals: {
    key: string;
    zone: Zone;
    text: string;
    confidence: "high" | "low";
  }[];
  outstanding: { key: string; reason: string }[];
  /**
   * Wanted keys the route DID NOT SEARCH, and why.
   *
   * NEVER RENDER THIS AS `tidak ditemukan`. That word is fixed in
   * `docs/ui-bahasa.md` to mean "searched, no evidence found", and it is what
   * `outstanding` above means. These keys were not searched at all: the bagian
   * belongs to a judul this order ADDED (its evidence is taken by hand), or the
   * key names no bagian in this order's form at all because the operator
   * deleted the judul it belonged to.
   *
   * Before this existed both cases were pushed into `outstanding`, so a judul
   * an operator deleted was reported back to them, on every Proses, for ever,
   * as something the tool had looked for and failed to find. That is a false
   * statement of exactly the class this project is organised against, and it
   * cost nothing to make true.
   *
   * REQUIRED, not optional: a `?` here would let a route that stopped sending
   * it read as a route that searched everything.
   */
  outOfScope: { key: string; reason: string }[];
  continuations: ContinuationAnswer[];
  /**
   * One entry per id sent in `discover`, in the order they were asked.
   *
   * REQUIRED, not optional, for the reason `outOfScope` is: a `?` here would
   * let a route that stopped sending it read as a route that asked and found
   * nothing. `applyDiscoveries` still tolerates it being absent at RUNTIME,
   * which is a different thing -- a tab open across a deploy.
   */
  sections: DiscoveredSections[];
};

/**
 * The slot states worth searching for.
 *
 * `confirmed` and `unfilled` are excluded because both are DECISIONS the
 * operator already made, and a later round may only add: re-searching them
 * would let a model answer overwrite accepted evidence. `proposed` is
 * excluded too -- it is already waiting on a person, and replacing it would
 * discard the very thing they were about to rule on.
 *
 * `outstanding` IS included, because that is the dokumen tambahan loop: the
 * slot was searched and not found, and a document ingested since may hold it.
 *
 * AND THE FORM DECIDES WHETHER THE KEY MAY BE ASKED ABOUT AT ALL, which is the
 * filter this function did without for as long as every run shared one form.
 * `run.slots` is seeded once and then only grown, so it outlives any edit the
 * operator makes to the judul list: a bagian whose judul they DELETED still has
 * its state sitting in the array, and a bagian in a judul they ADDED has one
 * too. Neither is searchable -- one names nothing in this order's form, the
 * other is a tangkapan satu halaman taken by hand -- so sending either as
 * `wanted` bought a route call that could only fail, and the failure came back
 * as "tidak ditemukan", on every reading pass, for ever. That word is fixed in
 * `docs/ui-bahasa.md` to mean SEARCHED AND NOT FOUND, so it was a false
 * statement about work nobody had done, printed to the operator in the one
 * place they go to decide whether to hunt for another document.
 *
 * `isSearchable` strips a capture ordinal itself, so this is safe on any
 * `SlotState.key`.
 */
export function wantedKeys(run: BrowserRun, template: Template): string[] {
  return run.slots
    .filter(
      (slot) =>
        !slot.zone &&
        (slot.status === "pending" || slot.status === "outstanding") &&
        // CAPTURE 1 ONLY. A lanjutan is not a thing a whole-bundle search can
        // find: it is defined by the capture it follows, and asking `locateSlot`
        // for it is what produced the miss this feature was written against
        // (the wide call answered page 20 lines 5-16 against the human's 0-15).
        // A continuation that lost its zone is removed rather than re-searched,
        // so one reaching here at all is a leftover from an older run.
        captureOrdinalOf(slot.key) === 1 &&
        isSearchable(template, slot.key),
    )
    .map((slot) => slot.key);
}

/**
 * Captures worth walking forward from: they hold evidence, and nothing has
 * looked past their page bottom yet.
 *
 * `continuationChecked` is what stops a re-run of Proses paying for the same
 * question twice, and it is also what stops a second chain being appended
 * beside the first. IT ONLY DOES THAT IF EVERY LINK OF A CHAIN CARRIES IT: see
 * `applyContinuations`, which stamps the links it mints as well as the head it
 * walked from. Stamping only the head made a second Proses re-walk every
 * appended capture and append the same evidence again, quadratically -- over
 * bundle two's ten-capture slot, 36 duplicate rows and 36 extra model calls on
 * one press of a button the export screen itself recommends pressing.
 *
 * `proposed` captures from an earlier round are included deliberately: the walk
 * asks about the BLOCK, and whether a person has ruled on the block yet does
 * not change where the page ends.
 *
 * AND THE FORM FILTERS THIS LIST TOO, for a reason that is NOT the same as
 * `wantedKeys`'s and is worse. A capture on a bagian in an ADDED judul holds a
 * zone the operator drew by hand and can perfectly well reach here, and the
 * route would then build a lanjutan prompt out of `ADDED_SLOT_ASK` -- the
 * frozen placeholder `../forms/overlay.ts` says is never sent anywhere,
 * literally the string "added bagian, never searched". A model asked where
 * that continues answers something, and the something is a rectangle appended
 * to a bagian the operator is capturing by hand. A capture under a judul they
 * DELETED is the same shape with no def to build a prompt from at all.
 *
 * AND A CAPTURE SITTING ON A BERKAS MARKED "tanpa AI" IS DROPPED TOO, which is
 * a third reason again. The operator drew that area themselves, so it can
 * perfectly well hold a zone and be `confirmed`; walking it would ask the model
 * what comes after it inside the one document they said it must not look in,
 * and the answer would be a rectangle appended to their own work. It also
 * spares the route a `checkForContinuation` that could only answer "page N is
 * not among the pages supplied", since the page it names is not in the pool the
 * route was given.
 */
export function capturesToWalk(
  run: BrowserRun,
  template: Template,
): { key: string; zone: Zone }[] {
  const fenced = aiExcludedSources(run);
  // `Zone.pageIndex` is a POSITION IN `run.pages`, never `StoredPage.index`,
  // so this indexes the array directly. A zone pointing past the end reads
  // `undefined` and is dropped, which is the safe direction: a capture is
  // walked only when the berkas it sits on is known AND open to the model.
  const openPage = (zone: Zone) => {
    const page = run.pages[zone.pageIndex];
    return page !== undefined && !fenced.has(page.sourceId);
  };

  return run.slots.flatMap((slot) =>
    slot.zone &&
    !continuationChecked(slot) &&
    (slot.status === "proposed" || slot.status === "confirmed") &&
    isSearchable(template, slot.key) &&
    openPage(slot.zone)
      ? [{ key: slot.key, zone: slot.zone }]
      : [],
  );
}

/**
 * THE BERKAS WORTH ASKING FOR JUDUL, and the two rules that decide.
 *
 * ONE MODEL CALL PER ID, so this list is a bill and not a filter over something
 * already paid for.
 *
 * `ai === false` IS DROPPED, and it is the same fence `buildProposeRequest`
 * puts on the pages themselves: the operator marked that berkas "tanpa AI", the
 * sentence on screen says the model does not look inside it, and a usulan
 * quoting its heading would break that promise in the most visible way
 * available -- a heading, in the document's own voice, out of the one file they
 * fenced off. Read `=== false` rather than `!== true`, because absent means
 * DIBACA AI: every order stored before the choice existed must keep being read.
 *
 * `sectionsAskedFor` IS DROPPED, AND THAT IS THE COST GATE. It records that the
 * QUESTION WAS PUT, never that the answer was useful, so a berkas that yielded
 * nothing is not asked again: paying a second time buys the same sentence. It
 * is set by `record-proposals` when the answer is filed, which is why
 * `applyDiscoveries` files EVERY answered berkas including the empty ones.
 *
 * `again` IS "Cari judul lagi", NAMED PER BERKAS, and it lifts only the second
 * rule. A person who has read one berkas's usulan and wants a different answer
 * may spend that call again -- and only that one, because the button they
 * pressed sits under one berkas's list and re-reading the other four would be a
 * bill they did not ask for. NOTHING LIFTS THE FENCE: an id named here that
 * belongs to a berkas marked tanpa AI is still not asked.
 */
export function discoverIds(
  run: BrowserRun,
  options: { again?: readonly string[] } = {},
): string[] {
  const again = new Set(options.again ?? []);
  return run.sources
    .filter(
      (source) =>
        source.ai !== false &&
        (again.has(source.id) || source.sectionsAskedFor !== true),
    )
    .map((source) => source.id);
}

/**
 * The request body.
 *
 * `index` IS THE POSITION IN `run.pages`, deliberately re-derived here with
 * the array index rather than copied from `page.index`. `StoredPage.index` is
 * the page's number within its OWN SOURCE DOCUMENT and restarts at 0 for every
 * file; the number a `Zone.pageIndex` holds -- and therefore the number the
 * route must be given -- is the run-global position. Copying `page.index`
 * here would compile, work perfectly for a single-document run, and point
 * every zone at the wrong page from the second document onward. The route
 * re-checks this and answers 400 rather than trusting it.
 *
 * `template` IS THIS ORDER'S RESOLVED FORM, never the module constant. It is a
 * parameter rather than an import because this module is pure and is driven by
 * `node --test`, and because the caller is the one holding the run whose
 * overlay decides the answer: `resolveTemplate(AO_TEMPLATE, run.overlay)`, or
 * `useRunTemplate(run)` from a screen. Reading the constant here would send the
 * route a `wanted` list describing a form the operator is not looking at.
 *
 * ## A BERKAS MARKED "tanpa AI" LOSES ITS LINES HERE, AT THE BOUNDARY
 *
 * Its pages still travel, because their POSITIONS are the run-global numbering
 * the route checks and every `Zone.pageIndex` is a position in that same list:
 * dropping them would renumber every page after the fenced berkas and point
 * every zone found in a later document at the wrong page. That is this
 * project's failure class, so the pages stay and carry `searchable: false`
 * instead.
 *
 * What does NOT travel is their text. The sentence on screen says the AI does
 * not look inside that berkas, and the honest place to make that true is where
 * the request is built, not three stages downstream in a filter somebody can
 * simplify away. The route filters on the FLAG and never on `lines.length`, so
 * the two halves are independent nets rather than one net counted twice.
 *
 * `searchable` IS OMITTED WHEN IT IS TRUE, which is what keeps a run with
 * nothing fenced off byte-identical to what this function has always sent.
 */
export function buildProposeRequest(
  run: BrowserRun,
  template: Template,
  /**
   * `again` names the berkas whose judul question is to be put a SECOND time
   * ("Cari judul lagi"). It reaches `discoverIds` and nothing else.
   */
  options: { again?: readonly string[] } = {},
): ProposeRequest {
  const fenced = aiExcludedSources(run);

  return {
    runId: run.id,
    pages: run.pages.map((page, position) => {
      const closed = fenced.has(page.sourceId);
      return {
        index: position,
        sourceId: page.sourceId,
        width: page.widthPx,
        height: page.heightPx,
        lines: closed ? [] : page.lines,
        ...(closed ? { searchable: false as const } : {}),
      };
    }),
    wanted: wantedKeys(run, template),
    captures: capturesToWalk(run, template),
    overlay: run.overlay,
    discover: discoverIds(run, options),
  };
}

/**
 * The answer folded into the run.
 *
 * Re-checks each slot's CURRENT status rather than trusting the request it
 * was built from. A search over a 29-page bundle is minutes of model calls,
 * and an operator who confirmed or declined a slot while it ran must not have
 * that decision overwritten by an answer to a question that was asked before
 * they made it.
 *
 * TAKES THE TWO HALVES IT READS, not the whole `ProposeResponse`, and the
 * narrowing is deliberate rather than tidiness. This half fills captures that
 * already exist; the lanjutan half CREATES captures and has to run after it
 * (see `applyResponse`). Typing the parameter as the whole response would let
 * a caller hand this function a `continuations` list and reasonably believe it
 * had been applied, and the symptom would be a discovered lanjutan that
 * vanishes silently -- evidence missing from a packet that looks complete.
 *
 * THE PICK IS WIDENED, NOT DROPPED, and `outOfScope` is in it because this
 * function is the only thing that can act on it. It is the half of the answer
 * that says "these keys were NOT searched": a bagian in a judul the operator
 * added, whose potongan they take by hand, or a key naming no bagian in this
 * order's form at all. The right treatment is to change nothing about them --
 * not to mark them `outstanding` (which is fixed in `docs/ui-bahasa.md` to mean
 * SEARCHED AND NOT FOUND, and would print a false report of work nobody did),
 * and not to reset them to `pending` either, which would throw away a decision
 * the operator has already taken on a bagian they are capturing themselves.
 * The early return below is that rule stated once rather than left to fall out
 * of the fact that the route also omits them from `outstanding`.
 */
export function applyProposals(
  run: BrowserRun,
  response: Pick<ProposeResponse, "proposals" | "outstanding" | "outOfScope">,
): BrowserRun {
  const proposals = new Map(response.proposals.map((p) => [p.key, p]));
  const outstanding = new Map(response.outstanding.map((o) => [o.key, o]));
  // `?? []` so a hand-built response in a test, or a route mid-deploy that
  // predates the field, leaves every slot alone rather than throwing. The wire
  // type keeps it REQUIRED; this is about the value actually arriving.
  const outOfScope = new Set((response.outOfScope ?? []).map((o) => o.key));

  return {
    ...run,
    slots: run.slots.map((slot) => {
      // EXACTLY AS FOUND. Nothing the route declined to search may be moved by
      // its answer, whatever else that answer happens to name.
      if (outOfScope.has(slot.key)) return slot;

      // Only a slot still waiting to be searched may be changed by an answer.
      const open = slot.status === "pending" || slot.status === "outstanding";
      if (!open || slot.zone) return slot;

      const proposal = proposals.get(slot.key);
      if (proposal) {
        return {
          ...slot,
          status: "proposed" as const,
          origin: "llm" as const,
          zone: proposal.zone,
          text: proposal.text,
          // A NEW RECTANGLE HAS NEVER BEEN SEARCHED PAST, and nothing here has
          // to say so any more. The verdict names the zone it was made about,
          // so writing a different zone leaves it naming a rectangle this slot
          // no longer holds, and `continuationChecked` reads that as unchecked.
          // This line used to clear it by hand and was one of three that had to
          // remember; this is the site that needed it most, because it is
          // reached by the ordinary tambahan loop rather than by a hand edit.
        };
      }

      if (outstanding.has(slot.key)) {
        return { ...slot, status: "outstanding" as const };
      }

      return slot;
    }),
  };
}

/**
 * The lanjutan half of the answer, folded in.
 *
 * WHY IT RUNS AFTER `applyProposals` AND NOT BESIDE IT. The route walks the
 * proposals it has just made as well as the captures the browser sent, so an
 * answer can name a capture that did not exist when the request was built.
 * Appending a lanjutan to a parent this run does not hold yet would silently
 * drop it, so the parent has to be in place first. `applyResponse` sequences
 * the two; call that rather than remembering the order.
 *
 * Every appended capture arrives `proposed`, and `withDiscoveredCaptures`
 * refuses to append one whose parent has lost its zone in the meantime. Both
 * are the same rule the proposals half applies: an answer to a question the
 * operator has since settled differently does not get to win.
 */
export function applyContinuations(
  run: BrowserRun,
  answers: readonly ContinuationAnswer[],
): BrowserRun {
  const found: DiscoveredCapture[] = [];
  const checked: string[] = [];

  for (const answer of answers) {
    const last = answer.zones.length - 1;
    // THE CHAIN HEAD IS CHECKED AS SOON AS ANYTHING LOOKED PAST IT, which is
    // either "the walk reached a definitive no" or "the walk found the
    // continuation being appended right here". Only the first used to count,
    // and the second is the common case: a head whose chain grew stayed
    // unstamped, so `capturesToWalk` re-sent it on the next Proses, stage 1
    // fired on it again (a non-terminal link ends at its page bottom BY
    // CONSTRUCTION -- that is why the next link exists), and the identical
    // answer was appended under a fresh ordinal.
    if (answer.checked || answer.zones.length > 0) checked.push(answer.key);
    answer.zones.forEach((zone, at) => {
      found.push({
        after: answer.key,
        zone: zone.zone,
        text: zone.text,
        // Link n's own continuation is link n+1, appended by this same loop, so
        // every link but the last has already been looked past. The last one is
        // checked only when the walk ended on a definitive no; a chain stopped
        // by the cap or by a model error leaves its tail honestly unexamined,
        // and re-walking THAT is work worth paying for a second time.
        continuationChecked: at < last || answer.checked,
      });
    });
  }

  return withDiscoveredCaptures(run, found, checked);
}

/**
 * The judul half of the answer, filed as usulan for a person to rule on.
 *
 * ## `applySectionEdit`, not `editSections`
 *
 * `record-proposals` is the landed edit for exactly this, and its ENGINE is
 * pure: `applySectionEdit` takes a run and an edit and returns a run, and
 * `editSections` is the storage call wrapped around it. This module is pure and
 * is driven by `node --test`, and the run this is folded into is already the
 * freshly re-read one the caller is about to `saveRun` -- the same object
 * `applyProposals` and `applyContinuations` have just returned. Going through
 * storage here instead would write the run three times for one answer, and the
 * second write would be refused as stale by the first.
 *
 * ## EVERY ANSWERED BERKAS IS FILED, INCLUDING THE EMPTY ONES
 *
 * `record-proposals` is what sets `RunSource.sectionsAskedFor`, and that flag
 * records THAT THE QUESTION WAS PUT rather than that the answer was useful. A
 * berkas whose answer was "no headings here" and which was therefore skipped
 * would be asked again on every press of Baca dengan AI, for ever, at one model
 * call each. So an empty `sections` array is filed exactly like a full one.
 *
 * ## A BERKAS THE ORDER NO LONGER HOLDS IS SKIPPED, NOT THROWN OVER
 *
 * A pass takes minutes and the operator can remove a document while it runs.
 * `recordProposals` refuses an answer filed against a berkas the run does not
 * have -- correctly, since its `cite` points into pages that are gone -- and
 * letting that throw here would discard the PROPOSALS half of the same answer,
 * which is minutes of work about documents that are still there.
 *
 * ## NEITHER OPT-IN MAY BE NEEDED, AND THAT IS ASSERTED RATHER THAN ASSUMED
 *
 * `record-proposals` passes `run.slots` through by reference and touches only
 * `overlay.proposed` and one source's flag, so `putRun`'s `removing` and
 * `removingSections` are both empty by construction -- which is what lets the
 * caller save this with a plain `saveRun`. If that ever stops being true the
 * throw below is loud, at the point of the change, instead of a
 * `CaptureLossError` in front of an operator.
 */
export function applyDiscoveries(
  run: BrowserRun,
  answers: readonly DiscoveredSections[],
): BrowserRun {
  const held = new Set(run.sources.map((source) => source.id));
  let next = run;

  for (const answer of answers) {
    if (!held.has(answer.sourceId)) continue;
    const result = applySectionEdit(next, {
      tag: "record-proposals",
      sourceId: answer.sourceId,
      sections: answer.sections,
    });
    if (result.removing.length > 0 || result.removingSections.length > 0) {
      throw new Error(
        "recording usulan judul asked to drop stored work " +
          `(${result.removing.length} potongan, ${result.removingSections.length} ` +
          "nama), which this fold cannot express: the caller saves with a plain " +
          "saveRun and storage would refuse it. Route this through " +
          "editSections instead.",
      );
    }
    next = result.run;
  }

  return next;
}

/**
 * One round's whole answer, in the order the two halves depend on.
 *
 * `applyProposals` first, because a continuation the route found by walking a
 * proposal it made in the same request names a capture that only exists once
 * that proposal has been applied.
 *
 * The whole response goes into `applyProposals`, which is what carries
 * `outOfScope` to the one place that can honour it. Narrowing the argument here
 * would compile and would silently drop the half of the answer that says which
 * keys were never searched.
 */
export function applyResponse(
  run: BrowserRun,
  response: ProposeResponse,
): BrowserRun {
  // The judul half LAST, and it is independent of the two before it: it writes
  // `overlay.proposed` and one flag per berkas, and never touches `run.slots`.
  // Last rather than first only so a throw from it cannot cost the search's
  // answer -- and `?? []` so a tab open across a deploy leaves the usulan alone
  // rather than failing the whole fold.
  return applyDiscoveries(
    applyContinuations(
      applyProposals(run, response),
      response.continuations ?? [],
    ),
    response.sections ?? [],
  );
}

/**
 * Posts to this app's own route. NOT to a model provider.
 *
 * The browser contacts nothing but this app: the credential is server-side,
 * and what crosses this call is OCR line text, never a page image or the PDF.
 */
export async function requestProposals(
  run: BrowserRun,
  template: Template,
  signal?: AbortSignal,
  /** `again` names the berkas to re-ask ("Cari judul lagi"). See `discoverIds`. */
  options: { again?: readonly string[] } = {},
): Promise<ProposeResponse> {
  const response = await fetch("/api/propose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildProposeRequest(run, template, options)),
    signal,
  });

  if (!response.ok) {
    // The route answers JSON on every failure path it owns; a proxy or a
    // platform error may not, so fall back to the status rather than throwing
    // a parse error over the top of the real problem.
    const detail = await response
      .json()
      .then((body: { error?: string }) => body?.error)
      .catch(() => null);
    throw new Error(
      detail ?? `The search failed with HTTP ${response.status}.`,
    );
  }

  return (await response.json()) as ProposeResponse;
}
