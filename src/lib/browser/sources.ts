/**
 * What an order's berkas are, as arithmetic: taking one back out, and deciding
 * whether the model may look inside one.
 *
 * ITS OWN MODULE, PURE, for the reason `captures.ts` and `slot-key.ts` are:
 * the interesting part is arithmetic over a run, it has to be testable where
 * IndexedDB is not, and the storage call that performs it is four lines
 * wrapped around this.
 *
 * WHY THIS IS NOT A FILTER. `BrowserRun.pages` is append-only and its own
 * doc comment says so, because `Zone.pageIndex` IS A POSITION IN THAT ARRAY.
 * Removing a document's pages therefore does two things at once, and the
 * second is invisible:
 *
 *   1. the evidence found INSIDE that document stops existing, which is what
 *      the operator asked for and expects, and
 *   2. every zone found in a LATER document silently starts pointing at a
 *      different page.
 *
 * The second is this project's whole failure class in one line: the packet
 * still opens, every crop is still a crop, and one of them is now a picture of
 * the wrong page with a validator's signature under it. So the pages are not
 * filtered; they are renumbered, and every surviving zone is moved with them.
 *
 * THREE STRUCTURES INDEX INTO `run.pages` BY POSITION, NOT ONE, and for a while
 * this header named only the first of them:
 *
 *   - `SlotState.zone.pageIndex` -- evidence, in `run.slots`;
 *   - `overlay.proposed[].fromPages` and `.cite.pageIndex` -- a usulan waiting
 *     for a decision;
 *   - `overlay.added[].pages` and `.cite.pageIndex` -- what a judul the
 *     operator ADOPTED says it was read from.
 *
 * The overlay was left untouched, and the shape of that is exactly the shape
 * above. Berkas A holds positions 0-4 and berkas B holds 5-14; a usulan out of
 * B names pages [5, 6]; the operator removes A; B is now 0-9 and the usulan
 * still says [5, 6]. The panel draws a denah of B's SIXTH page, prints "dari
 * SPLITBA.pdf hal 6/10" under a heading transcribed from B's FIRST page, and
 * Terima mints whole-page potongan over two pages that do not carry that
 * heading. Nothing throws. The orphan guard in `outstanding-panel.tsx` does not
 * see it either: that finds usulan whose OWN berkas was removed, and this one's
 * berkas is still in the order.
 *
 * So `remapOverlay` moves both of those through the SAME `next[]` map, and the
 * rule for an entry that cannot be moved honestly is stated there.
 *
 * WHAT HAPPENS TO EVIDENCE THAT LIVED IN THE REMOVED DOCUMENT is the other
 * half, and it follows `withoutCapture`'s rule rather than inventing one.
 *
 *   - Capture 1 of a bagian KEEPS ITS ROW and loses its zone, dropping back to
 *     `pending`. The template still asks for that bagian; only the evidence
 *     for it is gone.
 *   - A lanjutan (ordinal 2 and up) is REMOVED OUTRIGHT, and so is every later
 *     capture of the same bagian, exactly as rejecting one does. A lanjutan
 *     exists only because something walked forward from the capture before it
 *     and found more of the same clause IN A DOCUMENT. Take the document away
 *     and the row is a claim about a page break that is no longer in the run.
 *   - The last surviving capture of any bagian that lost a tail has its
 *     `continuationCheckedFor` CLEARED. That field records "the walk past this
 *     rectangle is finished", and one of the two ways it becomes true is "the
 *     lanjutan it found is already held". Once that lanjutan is gone the
 *     recorded fact is false, and `continuationChecked` would not notice: it
 *     compares the fingerprint against this capture's OWN zone, which has not
 *     changed. Leaving it set would print "diperiksa, tidak ada lanjutan" on a
 *     bagian nothing has looked past since the document it was looking in was
 *     removed.
 *
 * Every key whose EVIDENCE this loses comes back in `removedCaptureKeys`, in
 * the shape `putRun`'s `removing` option takes, because a write that drops a
 * zone-carrying state without naming it is refused by `CaptureLossError` and
 * should be.
 */

import type {
  AddedSection,
  ProposedSection,
  TemplateOverlay,
} from "../forms/overlay.ts";
import { zoneFingerprint } from "./captures.ts";
import { captureOrdinalOf, slotKeyOf } from "./slot-key.ts";
import type { BrowserRun, SlotState } from "./types.ts";

/**
 * The berkas the operator has marked "tanpa AI", by `RunSource.id`.
 *
 * ABSENT MEANS DIBACA AI, which is what `RunSource.ai` says and is the reading
 * every run stored before the choice existed needs. So this is written as
 * `=== false` and never as `!ai`: the difference is every order already on a
 * device silently losing its search.
 *
 * A SET OF SOURCE IDS RATHER THAN A PER-PAGE TEST, because the choice is per
 * BERKAS. That is what keeps `classifyPages`' every-page-exactly-once contract
 * safe downstream -- an exclusion drops whole documents, so what survives is a
 * document offered entire rather than one with holes in it.
 */
export function aiExcludedSources(run: BrowserRun): ReadonlySet<string> {
  return new Set(
    run.sources.filter((source) => source.ai === false).map((source) => source.id),
  );
}

/**
 * MAY THE AI PROPOSE ANYTHING OUT OF THIS BERKAS.
 *
 * IT IS NOT "WAS IT READ", and nothing here touches a page. Every berkas is
 * rendered and OCR'd either way -- that is what lets the operator draw an area
 * on a fenced one by hand, and what draws its denah -- so this writes one
 * boolean and moves nothing else. The ingest loop is untouched by the whole
 * feature for exactly that reason.
 *
 * RETURNS THE RUN BY IDENTITY when the answer is already what was asked for, or
 * when this order holds no such berkas -- and "already" is read through the
 * SAME `?? true` default, so re-selecting Dibaca AI on a berkas nobody has
 * touched is a press that writes nothing. `editSections` and `removeDocument`
 * both use identity to mean exactly that, so the storage write can be skipped
 * rather than advancing the revision and refusing whatever the screen is
 * holding.
 */
export function withSourceAi(
  run: BrowserRun,
  sourceId: string,
  ai: boolean,
): BrowserRun {
  const held = run.sources.find((source) => source.id === sourceId);
  if (!held) return run;
  if ((held.ai ?? true) === ai) return run;

  return {
    ...run,
    sources: run.sources.map((source) =>
      source.id === sourceId ? { ...source, ai } : source,
    ),
  };
}

/**
 * Where the page at position `old` ended up, or `null` when there is no honest
 * answer.
 *
 * TWO CAUSES, ONE ANSWER, deliberately collapsed here so that no caller below
 * has to remember the difference: `next[old] === -1` is a page going out with
 * the berkas, and `next[old] === undefined` is a stored number that was already
 * past the end of the array. Both mean "there is no page to point at", and both
 * must produce an ABSENT claim rather than a number: -1 is what `assertPageList`
 * refuses on the way to storage, and an out-of-range index is what draws an
 * empty denah.
 */
function movedTo(next: readonly number[], old: number): number | null {
  const to = next[old];
  if (to === undefined || to < 0) return null;
  return to;
}

/** Every page of a claim, moved, or `null` if any one of them cannot be. */
function movedPages(
  pages: readonly number[],
  next: readonly number[],
): number[] | null {
  const out: number[] = [];
  for (const page of pages) {
    const to = movedTo(next, page);
    if (to === null) return null;
    out.push(to);
  }
  return out;
}

/** Did the removal actually move this claim, or does it read exactly as before. */
function sameNumbers(
  before: readonly number[] | undefined,
  after: readonly number[] | null,
): boolean {
  if (before === undefined) return after === null || after.length === 0;
  if (after === null) return false;
  return (
    before.length === after.length && before.every((page, at) => page === after[at])
  );
}

/**
 * THE OVERLAY'S OWN PAGE NUMBERS, MOVED THROUGH THE SAME MAP AS THE ZONES.
 *
 * A usulan's pages all come out of ONE berkas -- discovery is asked per source
 * and is handed only that source's pages -- so they survive together or go
 * together. That is what makes "all or nothing" the right rule rather than a
 * simplification: there is no legitimate claim with a hole in it.
 *
 * ## What happens to an entry that cannot be moved
 *
 * AN ACCEPTED JUDUL STOPS CLAIMING PAGES. `pages` and `cite` are optional
 * metadata saying "I was read out of these pages"; with the berkas gone there
 * is no true answer, and any number written there would name a page of a
 * DIFFERENT document. So both are dropped and the judul itself stays. ITS
 * EVIDENCE IS ALREADY SAFE and is NOT this function's business: an accepted
 * potongan lives in `run.slots`, which `removeSource` remaps and drops by the
 * same rule as every other capture. Do not "fix" that here a second time.
 * Dropping the whole `AddedSection` would be worse still -- it is a name the
 * operator adopted, so `SectionLossError` refuses that write without an opt-in
 * `removeDocument` deliberately does not pass.
 *
 * A USULAN WHOSE BERKAS IS GONE KEEPS ITS NUMBERS, untouched. `UsulanJudul` in
 * `outstanding-panel.tsx` finds those by `fromSourceId` against the sources the
 * order still holds and offers only "Bukan ini", so the numbers are never read
 * again; rewriting them would make an unanswerable row look answerable, and
 * hiding the row would leave a decision owed that nothing on screen mentions.
 *
 * A USULAN WHOSE BERKAS SURVIVED BUT WHOSE PAGES DID NOT IS DROPPED, and that
 * is the one case with no good answer. It cannot happen from discovery (see
 * above) and can only arrive from a hand-written overlay or a future change,
 * but if it does, the row is answerable on screen -- its berkas is right there
 * -- while its pages name whatever now sits at those positions. Terima would
 * mint potongan of the wrong pages, which is the failure this module exists to
 * prevent, so the usulan ceases to exist instead. Nothing is owed for that:
 * `discardedAuthorship` does not count `overlay.proposed` at all, because a
 * usulan nobody has ruled on costs a model call to remake rather than a
 * person's decision.
 */
/**
 * KONFIG EXCEL's CITATIONS, THROUGH THE SAME `next[]`.
 *
 * `ConfigCitation.pageIndex` is a position in `BrowserRun.pages`, exactly as
 * `Zone.pageIndex` is, so it is subject to the one rule this whole module
 * exists to keep: the only thing allowed to shorten that array is a removal
 * that moves everything pointing into it. This was missed when Konfig Excel
 * landed, and the symptom was the quiet kind -- remove the first berkas of an
 * order and every konfigurasi citation still names its old position, so the
 * operator clicks through to check a recommendation and is shown a page from a
 * different document, with the right berkas name on it.
 *
 * A CITATION WHOSE PAGE IS GONE IS DROPPED, NOT REPOINTED, and the verdict,
 * the value and the operator's decision all stay. Three separate reasons:
 *
 *  - Repointing is the failure itself. There is no page that "took over" from
 *    a deleted one; the nearest surviving index is a different document.
 *  - "A false citation is worse than none" is the rule `fields.ts` already
 *    applies to a citation that fails validation, so the same answer here
 *    keeps one rule rather than two. `Cite` renders the absence.
 *  - Clearing the verdict instead would either destroy an operator's ruling or
 *    trip `DecisionLossError` on the write, and neither is warranted: they
 *    decided what to put in the cell, and that decision did not stop being
 *    theirs because an unrelated berkas left the order.
 *
 * `epic` is deliberately NOT touched. An `EpicCitation` names a `captureId`,
 * and a tangkapan layar is not a page of the order, so nothing in this
 * function's numbering reaches it.
 */
function remapConfigCitations(
  check: BrowserRun["konfigurasi"],
  next: readonly number[],
): BrowserRun["konfigurasi"] {
  let moved = false;
  const entries = check.entries.map((entry) => {
    const cite = entry.citation;
    if (!cite) return entry;

    const at = next[cite.pageIndex];
    if (at === undefined || at === -1) {
      moved = true;
      // Destructured off rather than set to `undefined`, so the key is ABSENT
      // and `"citation" in entry` answers the same as `entry.citation`. The
      // eslint disable is the narrow one: the binding exists only to name what
      // is being dropped, which is what makes the line readable.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { citation, ...rest } = entry;
      return rest;
    }
    if (at === cite.pageIndex) return entry;

    moved = true;
    return { ...entry, citation: { ...cite, pageIndex: at } };
  });

  // Identity when nothing pointed past the removal, so an order that never
  // reached Konfig Excel -- the common case -- is not rewritten at all.
  return moved ? { ...check, entries } : check;
}

function remapOverlay(
  overlay: TemplateOverlay,
  next: readonly number[],
  removedSourceId: string,
): TemplateOverlay {
  const added: AddedSection[] = overlay.added.map((section) => {
    // Nothing claimed, nothing to move. Identity, so a React memo can skip a
    // judul whose heading did not move.
    if (section.pages === undefined && section.cite === undefined) return section;

    const gone = section.fromSourceId === removedSourceId;
    const pages = gone ? null : movedPages(section.pages ?? [], next);
    const citePage =
      gone || section.cite === undefined
        ? null
        : movedTo(next, section.cite.pageIndex);

    // BOTH OR NEITHER. `pages` and `cite` are two halves of one claim, and a
    // judul that still names a page while its citation has been dropped is a
    // half-truth on the sheet that reads exactly like a whole one.
    const keeps =
      !gone && pages !== null && (section.cite === undefined || citePage !== null);
    if (!keeps) {
      // A spread and two deletes rather than a whitelist, because the semantic
      // here is "keep everything, drop these two claims": a field added to
      // `AddedSection` later is a name or a provenance, and inheriting it is
      // the right default. `removeSource`'s slot rebuild takes the opposite
      // shape for the opposite reason.
      const stripped: AddedSection = { ...section };
      delete stripped.pages;
      delete stripped.cite;
      return stripped;
    }

    // NOTHING ACTUALLY MOVED, so nothing is rebuilt: a berkas removed from
    // BEHIND this one shifts none of its pages. Identity again, for the memo.
    if (
      sameNumbers(section.pages, pages) &&
      (section.cite === undefined || section.cite.pageIndex === citePage)
    ) {
      return section;
    }

    const moved: AddedSection = { ...section };
    if (section.pages !== undefined && pages !== null) moved.pages = pages;
    if (section.cite !== undefined && citePage !== null) {
      // The line range is a fact about that page's own text and does not move.
      moved.cite = { ...section.cite, pageIndex: citePage };
    }
    return moved;
  });

  const proposed: ProposedSection[] = [];
  for (const entry of overlay.proposed) {
    if (entry.fromSourceId === removedSourceId) {
      proposed.push(entry);
      continue;
    }
    const pages = movedPages(entry.fromPages, next);
    const citePage = movedTo(next, entry.cite.pageIndex);
    if (pages === null || citePage === null) continue;
    if (sameNumbers(entry.fromPages, pages) && entry.cite.pageIndex === citePage) {
      proposed.push(entry);
      continue;
    }
    proposed.push({
      ...entry,
      fromPages: pages,
      cite: { ...entry.cite, pageIndex: citePage },
    });
  }

  // BY ELEMENT IDENTITY, not by a `changed` flag threaded through both loops. A
  // removal that moved nothing (every entry sits in front of the berkas that
  // went) hands the same overlay object back, which is what the screens compare
  // against.
  const same =
    added.length === overlay.added.length &&
    proposed.length === overlay.proposed.length &&
    added.every((section, at) => section === overlay.added[at]) &&
    proposed.every((entry, at) => entry === overlay.proposed[at]);
  if (same) return overlay;

  return { ...overlay, added, proposed };
}

export type SourceRemoval = {
  /** The run as it should now be stored. Unchanged if `sourceId` is not in it. */
  run: BrowserRun;
  /** `StoredPage.id` of every page that must be deleted alongside the write. */
  removedPageIds: string[];
  /**
   * The `SlotState.key` of every capture this loses evidence from, whether the
   * row went with it or only its zone did. Hand it to `putRun`'s `removing`.
   */
  removedCaptureKeys: string[];
  /** How many captures the operator had already accepted here. For the warning. */
  confirmedLost: number;
};

/**
 * What removing this source would cost, without removing it.
 *
 * The document manager asks before it acts, and it has to ask in numbers: an
 * operator who has spent twenty minutes accepting crops is owed "this takes 4
 * potongan you accepted with it", not a generic confirmation. Same arithmetic
 * as `removeSource`, so the two cannot disagree about what is about to happen.
 */
export function sourceRemovalCost(
  run: BrowserRun,
  sourceId: string,
): { pages: number; captures: number; confirmed: number } {
  const { removedPageIds, removedCaptureKeys, confirmedLost } = removeSource(
    run,
    sourceId,
  );
  return {
    pages: removedPageIds.length,
    captures: removedCaptureKeys.length,
    confirmed: confirmedLost,
  };
}

export function removeSource(
  run: BrowserRun,
  sourceId: string,
): SourceRemoval {
  const empty = {
    run,
    removedPageIds: [],
    removedCaptureKeys: [],
    confirmedLost: 0,
  };
  if (!run.sources.some((source) => source.id === sourceId)) return empty;

  /*
   * THE PAGE MAP IS BUILT ONCE AND EVERY ZONE IS MOVED THROUGH IT.
   *
   * `next[old]` is where the page at position `old` ends up, or -1 if it is
   * one of the ones going. Computing the shift per zone instead ("count the
   * removed pages before me") is the same number and invites the off-by-one
   * that this whole module exists to prevent, so it is done once here where a
   * test can read it.
   */
  const next: number[] = [];
  const removedPageIds: string[] = [];
  const pages: BrowserRun["pages"] = [];
  for (const page of run.pages) {
    if (page.sourceId === sourceId) {
      next.push(-1);
      removedPageIds.push(page.id);
    } else {
      next.push(pages.length);
      pages.push(page);
    }
  }

  const lostEvidence = (slot: SlotState) =>
    slot.zone !== undefined && next[slot.zone.pageIndex] === -1;

  /*
   * WHICH BAGIAN LOSE A TAIL. Collected before the rewrite because the rule is
   * about a slot as a whole ("every capture after the first affected one goes
   * too") and cannot be decided one row at a time in order.
   */
  const cutFrom = new Map<string, number>();
  for (const slot of run.slots) {
    if (!lostEvidence(slot)) continue;
    const key = slotKeyOf(slot.key);
    const ordinal = captureOrdinalOf(slot.key);
    const held = cutFrom.get(key);
    if (held === undefined || ordinal < held) cutFrom.set(key, ordinal);
  }

  const removedCaptureKeys: string[] = [];
  let confirmedLost = 0;
  const slots: SlotState[] = [];

  for (const slot of run.slots) {
    const key = slotKeyOf(slot.key);
    const ordinal = captureOrdinalOf(slot.key);
    const cut = cutFrom.get(key);
    const affected = cut !== undefined && ordinal >= cut;

    if (!affected) {
      /*
       * Untouched by the removal except for where its page now sits -- AND ITS
       * VERDICT MOVES WITH IT.
       *
       * `continuationCheckedFor` holds `zoneFingerprint(zone)`, which is
       * `pageIndex:from-to`, so it is keyed on the exact number being remapped
       * here. Remapping the zone alone leaves a verdict whose subject no
       * longer matches, `continuationChecked` reads that as unchecked, and
       * every capture past the removed document gets re-walked on the next
       * Proses: a narrow model call each, silently, on every removal.
       *
       * Carrying it is also the truthful answer rather than merely the cheap
       * one. The recorded fact is "the walk past this rectangle is finished",
       * and that is a fact about a clause and the page after it. Removing an
       * unrelated earlier document changes neither; only the index moved.
       *
       * Rebuilt through `zoneFingerprint` rather than by editing the string,
       * so the format cannot fork from the one `continuationChecked` compares
       * against.
       */
      if (!slot.zone) {
        slots.push(slot);
        continue;
      }
      const zone = { ...slot.zone, pageIndex: next[slot.zone.pageIndex] };
      slots.push({
        ...slot,
        zone,
        ...(slot.continuationCheckedFor === zoneFingerprint(slot.zone)
          ? { continuationCheckedFor: zoneFingerprint(zone) }
          : {}),
      });
      continue;
    }

    if (slot.zone) {
      removedCaptureKeys.push(slot.key);
      if (slot.status === "confirmed") confirmedLost += 1;
    }

    // A lanjutan goes with the document. Its row is a claim about a page break
    // that is no longer in this run.
    if (ordinal > 1) continue;

    // A WHITELIST, not an omit. `{ zone: _zone, ...rest }` would carry every
    // other field through, which is the wrong default here: a capture with no
    // evidence should hold nothing but its identity and its status, and
    // anything else `SlotState` grows later would arrive attached to a row
    // whose evidence has just been deleted. Listing the three fields that
    // survive means a fourth has to be added deliberately, in a diff somebody
    // reads, rather than inherited by a spread.
    slots.push({
      key: slot.key,
      label: slot.label,
      status: "pending",
    });
  }

  /*
   * THE STAMP ON WHAT SURVIVED. A bagian whose tail was cut has a last
   * surviving capture that may still record "the walk past me is finished",
   * and that was true only while the lanjutan it found was in the run.
   * `continuationChecked` compares the fingerprint against this capture's own
   * zone, which the cut did not touch, so nothing else would ever notice.
   */
  for (const key of cutFrom.keys()) {
    let last = -1;
    for (let i = 0; i < slots.length; i += 1) {
      if (slotKeyOf(slots[i].key) === key) last = i;
    }
    if (last === -1) continue;
    const survivor = { ...slots[last] };
    delete survivor.continuationCheckedFor;
    slots[last] = survivor;
  }

  return {
    run: {
      ...run,
      sources: run.sources.filter((source) => source.id !== sourceId),
      pages,
      slots,
      // THROUGH THE SAME `next[]`, for the same reason and in the same breath.
      // The overlay holds page positions too; see `remapOverlay`.
      overlay: remapOverlay(run.overlay, next, sourceId),
      // AND SO DOES KONFIG EXCEL. Every field of this run that stores a
      // position in `pages` has to move together or not at all; see
      // `remapConfigCitations` for why a citation whose page is gone is
      // dropped rather than repointed.
      konfigurasi: remapConfigCitations(run.konfigurasi, next),
    },
    removedPageIds,
    removedCaptureKeys,
    confirmedLost,
  };
}
