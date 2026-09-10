/**
 * WHAT COUNTS AS THE SAME DOCUMENT, in one place, because two places would
 * disagree.
 *
 * An operator hands documents over one at a time, over minutes, while an
 * earlier one is still being read. That is the whole point of the queue in
 * `operator-app.tsx`: some people drag a bundle in at once and some drop the
 * merged contract, then the SPLITBA, then the email print-out, each as they
 * find it. A hand-over that spread out is a hand-over where the same berkas
 * gets handed over twice, and it is not a careless operator who does it -- it
 * is the one who cannot remember whether the file they dropped four minutes
 * ago was `scan.pdf` or `scan (1).pdf`.
 *
 * WHY THIS IS THIS PROJECT'S FAILURE CLASS AND NOT A TIDINESS PROBLEM. A run
 * that holds one document twice reads back as a bundle with twice the pages,
 * and every page of the copy is a plausible answer to every slot. The model is
 * then asked to locate `KB / Nomor` in a pool holding two identical page 3s;
 * it answers with one of them, correctly, and the packet ships a crop that is
 * right. Then the operator removes one copy -- and `removeSource` renumbers
 * every surviving zone, which is correct, and the crop the human accepted was
 * cut from the copy that just went. Nothing crashes. Nothing looks wrong. The
 * cheapest moment to close that is the moment the second copy is dropped.
 *
 * IDENTITY IS THE BYTES, NEVER THE FILE NAME, and both halves of that are
 * deliberate:
 *
 *  - A renamed copy is the same document. `scan.pdf` and `scan (1).pdf` out of
 *    a downloads folder are the single commonest way this happens, and a
 *    name check does not see it at all.
 *  - Two different documents may share a name. `document.pdf` from two
 *    different emails is one order's merged contract and its SPLITBA, and
 *    refusing the second would refuse a real document -- which is the same
 *    failure pointed the other way, since the bagian living in it then ship
 *    `tidak ditemukan` for a reason the operator reads as "the document does
 *    not contain it". That case stays an ADVISORY on the ingest screen (see
 *    `RunContents`), never a refusal.
 *
 * SHA-256 IS AVAILABLE HERE BY THE SAME LICENCE `crypto.randomUUID` IS. Both
 * are `crypto`, both need a secure context, and this app already mints every
 * run id, source id and page id with `randomUUID`. So there is no fallback
 * digest and there must not be one: a second algorithm would give one document
 * two identities depending on which context read it, and a duplicate would
 * slip through in exactly the deployment where nothing else worked either.
 */

import type { RunSource } from "./types.ts";

/**
 * The content hash of one document, as lowercase hex.
 *
 * Takes bytes rather than a `File` so the caller decides how many times a
 * multi-megabyte scan is read off disk. `ingestDocument` already holds the
 * buffer it is about to store, and hands it straight here.
 */
export async function documentDigest(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** `documentDigest` over a file the operator handed over. */
export async function fileDigest(file: File): Promise<string> {
  return documentDigest(await file.arrayBuffer());
}

/**
 * A document this order already holds, or has already been promised.
 *
 * `digest` is optional for one reason and it is not a convenience: a run
 * ingested before this existed carries sources with no digest at all, and
 * those genuinely cannot be matched against anything. Absent means UNKNOWN,
 * so such a source never matches and never blocks a hand-over. It does not
 * mean "no duplicate".
 */
export type HeldDocument = { name: string; digest?: string };

/** A file that passed, with the identity it passed under. */
export type AcceptedDocument = { file: File; name: string; digest: string };

/**
 * A file that was refused, and the one already held that it repeats.
 *
 * `held` is what the operator is told, because "you already have this" is
 * only useful if it says which one -- and under a byte identity the two names
 * are routinely different, which is the whole reason the refusal is worth
 * printing rather than swallowing.
 */
export type RefusedDocument = {
  name: string;
  held: string;
  /** True when the repeat came from the same hand-over, not from the order. */
  inSameDrop: boolean;
};

export type Screening = {
  accepted: AcceptedDocument[];
  refused: RefusedDocument[];
};

/**
 * Which of these files this order may take, and which repeat something it
 * already has.
 *
 * ORDER IS PRESERVED and the FIRST copy wins. Dropping the same file twice in
 * one selection accepts one of them, and it is the one the operator sees first
 * in their own file list, so the refusal names a berkas that is visibly going
 * to be loaded rather than one that is not.
 *
 * `held` must carry everything already promised, not only what is stored: the
 * queue and the file currently being read are both documents this order is
 * getting, and neither is in `run.sources` yet. Screening against storage
 * alone accepts a duplicate of the file being read at that very moment, which
 * is the easiest one of all to hand over twice.
 */
export async function screenDocuments(
  files: readonly File[],
  held: readonly HeldDocument[],
): Promise<Screening> {
  const digested: AcceptedDocument[] = [];
  for (const file of files) {
    digested.push({
      file,
      name: file.name || "document.pdf",
      digest: await fileDigest(file),
    });
  }
  return screenDigested(digested, held);
}

/**
 * The same decision over berkas that have already been hashed.
 *
 * IT EXISTS BECAUSE THE ANSWER HAS TO BE ASKED TWICE, and the second asking
 * must not re-read fifty megabytes off the device. Hashing is asynchronous, so
 * two hand-overs made a moment apart -- the button and then a drag, which is
 * exactly how somebody makes sure -- are each screened against a queue that
 * neither has been added to yet, and both pass. The shell asks again at the
 * instant it appends, which is the one moment that can see the other's result.
 *
 * A SECOND COPY OF THE RULE WOULD BE A SECOND RULE. This is the whole of what
 * "already have it" means in this product, so both askings go through here
 * rather than one of them re-deriving it against a hand-built Map.
 */
export function screenDigested(
  candidates: readonly AcceptedDocument[],
  held: readonly HeldDocument[],
): Screening {
  const accepted: AcceptedDocument[] = [];
  const refused: RefusedDocument[] = [];

  // Only the ones that can be matched. A source with no digest is unknown,
  // and treating unknown as "not a duplicate" is the safe direction: the cost
  // is a document loaded twice on a run that predates this check, against
  // refusing a document the order does not have.
  const known = new Map<string, string>();
  for (const one of held) {
    if (one.digest && !known.has(one.digest)) known.set(one.digest, one.name);
  }

  for (const one of candidates) {
    const already = known.get(one.digest);
    if (already !== undefined) {
      refused.push({
        name: one.name,
        held: already,
        // Read off where the match came from rather than guessed from the
        // names: two copies of one berkas in one hand-over usually share a
        // name and two copies across hand-overs usually do not, but neither is
        // reliable and the sentence the operator reads differs.
        inSameDrop: accepted.some((other) => other.digest === one.digest),
      });
      continue;
    }
    known.set(one.digest, one.name);
    accepted.push(one);
  }

  return { accepted, refused };
}

/** The `HeldDocument` view of an order's stored sources. */
export function heldDocuments(
  sources: readonly RunSource[],
): HeldDocument[] {
  return sources.map((source) => ({
    name: source.name,
    ...(source.digest ? { digest: source.digest } : {}),
  }));
}

/**
 * An order on this device, as far as knowing which documents it holds.
 *
 * `listRuns` in `./runtime.ts` produces exactly this for every stored order.
 * `documents` goes through `heldDocuments`, so a source written before digests
 * existed arrives with none and matches nothing, by the rule stated on
 * `HeldDocument`.
 */
export type StoredOrder = {
  id: string;
  createdAt: number;
  label: string;
  documents: readonly HeldDocument[];
};

/** One other order holding a document the operator just handed over. */
export type OrderMatch = {
  runId: string;
  /** The order's name in the riwayat, so the two screens name it alike. */
  label: string;
  createdAt: number;
  /**
   * What THAT order calls the document. Under a byte identity it is routinely
   * a different name from the one just handed over, and printing only the new
   * name would read as the app confusing two files.
   */
  heldAs: string;
};

/** A berkas handed over to this order that another order already holds. */
export type UsedElsewhere = {
  /** The name it was handed over under, just now. */
  name: string;
  /** Every other order holding it, newest first. Never a sample. */
  orders: OrderMatch[];
};

/**
 * WHICH OTHER ORDERS ON THIS DEVICE ALREADY HOLD THESE DOCUMENTS.
 *
 * The sibling of `screenDigested`, and deliberately not a second copy of it:
 * the same identity (the bytes, never the name), a different consequence.
 *
 * ## A NOTICE, NEVER A REFUSAL
 *
 * A document this order already holds is refused, for the reasons at the top
 * of this file. A document ANOTHER order holds is ordinary: one customer's
 * master contract, a standing letter of appointment, a SPLITBA reissued for a
 * second service all recur across that customer's orders, and refusing the
 * second order its own evidence would ship every bagian inside it as `tidak
 * ditemukan`. What the operator is owed is the fact -- this file was used
 * before, here, under this name -- and a way to go and look, because the
 * likeliest reason a file comes back is that this order was already done once.
 *
 * ## THIS DEVICE ONLY, AND THE SENTENCE SAYS SO
 *
 * Orders live in this browser's IndexedDB and nowhere else; there is
 * deliberately no server copy (AGENTS.md, "The client constraint"). So this can
 * only see orders on this device, and a colleague's order on another computer
 * is invisible to it. The screen's sentence names the scope ("di perangkat
 * ini"), so a silence never reads as "never used anywhere".
 *
 * ## THE OPEN ORDER IS SKIPPED, AND THAT IS NOT WHAT KEEPS THIS HONEST
 *
 * The property that matters is upstream: the shell only asks about candidates
 * that already PASSED `screenDigested` against everything this order holds or
 * has been promised, so none of them can be in the order being built.
 * `openRunId` states the same exclusion by id, for a caller that forgot to
 * screen first and would otherwise be told a file it holds was used elsewhere
 * by itself.
 */
export function findInOtherOrders(
  candidates: readonly { name: string; digest: string }[],
  orders: readonly StoredOrder[],
  openRunId: string | null,
): UsedElsewhere[] {
  const holders = new Map<string, OrderMatch[]>();
  for (const order of orders) {
    if (order.id === openRunId) continue;
    // Once per ORDER. A run that predates the in-order refusal may hold one
    // document twice, and listing that order twice would read as two orders.
    const counted = new Set<string>();
    for (const document of order.documents) {
      if (!document.digest || counted.has(document.digest)) continue;
      counted.add(document.digest);
      const list = holders.get(document.digest) ?? [];
      list.push({
        runId: order.id,
        label: order.label,
        createdAt: order.createdAt,
        heldAs: document.name,
      });
      holders.set(document.digest, list);
    }
  }

  const found: UsedElsewhere[] = [];
  for (const candidate of candidates) {
    const list = holders.get(candidate.digest);
    if (!list) continue;
    found.push({
      name: candidate.name,
      orders: [...list].sort((a, b) => b.createdAt - a.createdAt),
    });
  }
  return found;
}

/**
 * The backstop, thrown by `ingestDocument` inside the run lock.
 *
 * THE SCREEN'S CHECK IS NOT ENOUGH ON ITS OWN, and this is not belt and
 * braces. `screenDocuments` runs against what one tab believes; the write runs
 * against what is stored, and between the two sit a second tab on the same
 * order and a queue that was screened before the run it is being screened
 * against had finished growing. The check that decides whether bytes land in
 * storage has to be the one that reads storage.
 *
 * ITS MESSAGE IS ENGLISH BECAUSE IT IS NOT THE OPERATOR'S SENTENCE. The shell
 * catches this class by name and writes the Bahasa refusal itself, naming both
 * berkas; this text is what reaches `Detail teknis` if anything ever fails to.
 */
export class DuplicateDocumentError extends Error {
  /** The file that was refused. */
  readonly candidate: string;
  /** The source already in the run that it repeats. */
  readonly held: string;
  readonly digest: string;

  constructor(candidate: string, held: string, digest: string) {
    super(
      `${candidate} is byte-for-byte the document this run already holds as ` +
        `${held} (sha256 ${digest.slice(0, 12)}), so it was not ingested. ` +
        "Loading it twice would double every page it contains, give the " +
        "model two identical candidates for every slot, and leave any zone " +
        "confirmed on the copy pointing at a different scan once the copy " +
        "was removed.",
    );
    this.name = "DuplicateDocumentError";
    this.candidate = candidate;
    this.held = held;
    this.digest = digest;
  }
}
