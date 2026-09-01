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

import type { BrowserRun, SlotState } from "./runtime.ts";

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
};

export type ProposeResponse = {
  proposals: {
    key: string;
    zone: NonNullable<SlotState["zone"]>;
    text: string;
    confidence: "high" | "low";
  }[];
  outstanding: { key: string; reason: string }[];
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
        !slot.zone && (slot.status === "pending" || slot.status === "outstanding"),
    )
    .map((slot) => slot.key);
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
 */
export function applyProposals(
  run: BrowserRun,
  response: ProposeResponse,
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
