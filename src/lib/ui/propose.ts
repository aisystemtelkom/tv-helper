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
 */

import { captureOrdinalOf, withDiscoveredCaptures } from "./runtime.ts";
import type { BrowserRun, DiscoveredCapture, SlotState } from "./runtime.ts";
import { continuationChecked } from "../browser/captures.ts";

type Zone = NonNullable<SlotState["zone"]>;

export type ProposeRequest = {
  runId: string;
  pages: {
    index: number;
    sourceId: string;
    width: number;
    height: number;
    lines: BrowserRun["pages"][number]["lines"];
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
  continuations: ContinuationAnswer[];
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
 */
export function wantedKeys(run: BrowserRun): string[] {
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
        captureOrdinalOf(slot.key) === 1,
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
 */
export function capturesToWalk(run: BrowserRun): { key: string; zone: Zone }[] {
  return run.slots.flatMap((slot) =>
    slot.zone &&
    !continuationChecked(slot) &&
    (slot.status === "proposed" || slot.status === "confirmed")
      ? [{ key: slot.key, zone: slot.zone }]
      : [],
  );
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
 */
export function buildProposeRequest(run: BrowserRun): ProposeRequest {
  return {
    runId: run.id,
    pages: run.pages.map((page, position) => ({
      index: position,
      sourceId: page.sourceId,
      width: page.widthPx,
      height: page.heightPx,
      lines: page.lines,
    })),
    wanted: wantedKeys(run),
    captures: capturesToWalk(run),
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
 */
export function applyProposals(
  run: BrowserRun,
  response: Pick<ProposeResponse, "proposals" | "outstanding">,
): BrowserRun {
  const proposals = new Map(response.proposals.map((p) => [p.key, p]));
  const outstanding = new Map(response.outstanding.map((o) => [o.key, o]));

  return {
    ...run,
    slots: run.slots.map((slot) => {
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
 * One round's whole answer, in the order the two halves depend on.
 *
 * `applyProposals` first, because a continuation the route found by walking a
 * proposal it made in the same request names a capture that only exists once
 * that proposal has been applied.
 */
export function applyResponse(
  run: BrowserRun,
  response: ProposeResponse,
): BrowserRun {
  return applyContinuations(
    applyProposals(run, response),
    response.continuations ?? [],
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
  signal?: AbortSignal,
): Promise<ProposeResponse> {
  const response = await fetch("/api/propose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildProposeRequest(run)),
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
