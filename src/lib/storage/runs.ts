/**
 * On-device storage for validation runs.
 *
 * Everything a run holds -- the uploaded PDFs, the OCR lines, the zones an
 * operator confirmed -- stays in IndexedDB on the machine that uploaded it.
 * Inference is the only thing that leaves this app, and it leaves server-side;
 * no document is ever uploaded. That constraint is why this file exists at all
 * instead of a table somewhere.
 *
 * ## Why a second database rather than a store in "tv-helper"
 *
 * `src/lib/storage/indexeddb.ts` opens the database named `tv-helper` at
 * version 1 for the chat scaffolding's key/value history. Adding an object
 * store to it means bumping DB_VERSION in both files at once and keeping them
 * in step forever: whichever module opens the older version after the other
 * has upgraded gets a `VersionError` and fails, not gracefully. A separate
 * database has no such coupling, costs nothing, and disappears cleanly with
 * the scaffolding it deliberately does not touch.
 *
 * ## Why three stores rather than one record per run
 *
 * - `runs` holds only the small part: id, timestamp, source list, slot list.
 *   `listRuns` reads all of these, so they must not drag every page's OCR
 *   lines along -- a bundle is 29 pages of them.
 * - `pages` holds one record per page, so appending a page during a long
 *   ingest is one insert rather than a rewrite of the whole run.
 * - `sources` holds the PDF bytes, which are tens of megabytes and are read
 *   only when a page is re-rendered.
 *
 * ## Runs in a Web Worker too
 *
 * `indexedDB` is available on `WorkerGlobalScope`, and the render/OCR worker
 * reads source bytes through this module directly. Passing tens of megabytes
 * of PDF through `postMessage` on every page view instead would copy them
 * each time. So nothing here may touch `window`, `document`, or any other
 * main-thread-only global.
 */

import { emptyConfigCheck, emptyEpicCheck, labelKey } from "../config/types.ts";
import type {
  ConfigCheck,
  ConfigEntry,
  EpicCheck,
  EpicEntry,
} from "../config/types.ts";
import { emptyOverlay } from "../forms/overlay.ts";
import type { NodeId, TemplateOverlay } from "../forms/overlay.ts";
import { AO_TEMPLATE } from "../forms/template.ts";
import type { BrowserRun, StoredPage } from "../browser/types.ts";

const DB_NAME = "tv-helper-runs";
const DB_VERSION = 1;

const RUNS = "runs";
const PAGES = "pages";
const SOURCES = "sources";

/** The index both `pages` and `sources` carry, so a run's rows can be found. */
const BY_RUN = "byRun";

/** A run's small half: everything except the pages and the PDF bytes. */
export type RunMeta = Omit<BrowserRun, "pages">;

/**
 * A run's small half AS A RECORD ON THIS DEVICE MAY ACTUALLY BE SHAPED.
 *
 * `BrowserRun.overlay` is REQUIRED, and every record written from here on
 * carries one -- but records written before the field existed do not, and an
 * `as IDBRequest<RunMeta>` cast over a raw IndexedDB read is a promise this
 * module makes rather than one the database keeps. Reading those through the
 * required type would be exactly the lie the type is there to prevent: every
 * consumer would be told an overlay is present, and the first one to touch it
 * would meet `undefined` several call frames from the read.
 *
 * So the raw reads are typed as this, and `readMeta` is the ONE place the
 * upgrade happens.
 *
 * `konfigurasi` and `epic` join it on the same terms and for the same reason.
 * Every order written before Konfig Excel and Input EPIC existed genuinely
 * has neither, and there are real ones on real devices; the honest shape of
 * the record is optional and the honest shape of the type every consumer sees
 * is required, which is what this pair of declarations buys.
 */
type StoredRunMeta = Omit<RunMeta, "overlay" | "konfigurasi" | "epic"> & {
  overlay?: TemplateOverlay;
  konfigurasi?: ConfigCheck;
  epic?: EpicCheck;
};

/**
 * A stored record as the rest of the app is allowed to see it: the revision
 * this read actually saw, and an overlay that is definitely there.
 *
 * UPGRADED ON READ, AND NEVER WRITTEN BACK ON READ. Repairing the record here
 * would mean a write, a write bumps `rev`, and a bumped `rev` can collide with
 * an ingest running in another tab -- which would turn "open an order to look
 * at it" into an operation that can be refused. The upgrade is deterministic
 * and free (`resolveTemplate` short-circuits an empty overlay to the base by
 * identity), so it costs nothing to redo on every read and lands on disk with
 * the next ordinary save.
 *
 * `emptyOverlay(AO_TEMPLATE)` is why this file knows the form exists at all.
 * That is a real coupling and it is the smallest one available: the
 * alternative is an optional field, which is the defect this whole comment is
 * about.
 *
 * `emptyConfigCheck()` and `emptyEpicCheck()` are cheaper still -- they read
 * nothing and depend on nothing -- but they are governed by the same two rules.
 * UPGRADED HERE AND ONLY HERE, and NOT WRITTEN BACK. An order that predates
 * Konfig Excel has no workbook and no rulings, so the empty value is not a
 * guess about what it held; it is what it held.
 */
function readMeta(stored: StoredRunMeta): RunMeta {
  return {
    ...stored,
    // Stamped, not passed through: this is the number a later write is checked
    // against, so it has to be the one this read actually saw -- including the
    // 0 that stands for a record written before runs carried a revision.
    rev: revOf(stored),
    overlay: stored.overlay ?? emptyOverlay(AO_TEMPLATE),
    konfigurasi: stored.konfigurasi ?? emptyConfigCheck(),
    epic: stored.epic ?? emptyEpicCheck(),
  };
}

/**
 * A write refused because the run moved on underneath the writer.
 *
 * Its own class so a UI can tell this apart from a quota failure or a closed
 * database and say the one useful thing -- "this run changed since you loaded
 * it; reload" -- instead of a generic failure. Catching it and retrying with
 * the same object would be wrong: the object is missing whatever the other
 * writer added, which is the entire point.
 */
export class StaleRunWriteError extends Error {
  readonly runId: string;
  /** The revision the writer believed was current. */
  readonly expected: number;
  /** The revision actually stored, or `null` when the run is not stored. */
  readonly actual: number | null;

  constructor(runId: string, expected: number, actual: number | null) {
    super(
      actual === null
        ? `run ${runId} is not stored (it was deleted, or never saved), but ` +
            `this write is based on revision ${expected}. Writing it would ` +
            "resurrect a deleted run. Reload before saving."
        : `run ${runId} has moved on: this write is based on revision ` +
            `${expected}, but revision ${actual} is stored. Something else ` +
            "wrote to this run -- most likely an ingest that finished after " +
            "this object was read. Re-read the run with getRun and re-apply " +
            "the change; saving this object would discard the other write.",
    );
    this.name = "StaleRunWriteError";
    this.runId = runId;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * A run that would silently lose pages it is not carrying.
 *
 * The second net under `StaleRunWriteError`, and independent of it: this one
 * fires on what the write would DO rather than on where it came from, so a
 * caller that assembled a short `pages` array through some other mistake --
 * a bad filter, a partially-loaded run -- is caught even when its revision
 * is perfectly current.
 *
 * ONE WRITE IS ALLOWED TO SHED PAGES, and it has to say which. Removing a
 * source document from an open order is a real operation now (see
 * `PutRunOptions.removingPages`), so the rule is no longer "pages never leave"
 * but "pages never leave SILENTLY". A write naming ids sheds exactly those and
 * is still refused on any page it did not name.
 */
export class PageLossError extends Error {
  readonly runId: string;
  /** The page ids stored for this run that the incoming run does not carry. */
  readonly missing: string[];

  constructor(runId: string, missing: string[]) {
    super(
      `run ${runId} would lose ${missing.length} stored page(s) ` +
        `(${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}) ` +
        "because this write does not carry them and did not name them. A " +
        "zone's pageIndex is a position in that array, so dropping a page " +
        "repoints every zone after it. Re-read the run and re-apply the " +
        "change; if the removal is deliberate, name the ids in " +
        "`removingPages` and remap the zones first (`removeSource`).",
    );
    this.name = "PageLossError";
    this.runId = runId;
    this.missing = missing;
  }
}

/**
 * A write that would silently drop a capture the operator has evidence for.
 *
 * THE THIRD NET, AND THE ONE THAT ONLY BECAME NECESSARY WHEN A LANJUTAN
 * STOPPED BEING DECLARED. While `run.slots` was a pure function of the
 * template, a writer that rebuilt it rebuilt it identically; there was nothing
 * to lose and this class would have had nothing to catch. A DISCOVERED capture
 * exists only in the stored array, so any rebuild-from-template write --
 * a template migration, a "reset this run", a merge helper that maps over
 * `AO_TEMPLATE.sections` -- arrives at the CORRECT revision, carrying EVERY
 * page, and simply short. `StaleRunWriteError` does not see it and
 * `PageLossError` does not see it. It would delete a crop a human accepted and
 * report success, which is this project's failure shape exactly.
 *
 * DROPPED OR EMPTIED, BOTH. The check compares EVIDENCE, not key presence,
 * because the writer it was built for does not drop a key at all: a rebuild
 * from `AO_TEMPLATE.sections` emits capture 1 under the template key verbatim
 * (that is how `seedSlots` keys it) with no `zone`, so every key is carried
 * and every accepted crop is gone. Only the `#2`/`#3` keys such a writer fails
 * to emit would be caught by a key-only comparison, which is the smaller half
 * of the same loss.
 *
 * NOT an append-only rule. "Bukan ini" really does discard evidence -- on a
 * lanjutan by removing the row, on capture 1 by clearing its zone and leaving
 * the row the template still asks for -- and pretending otherwise would be a
 * lie the code then has to work around. The rule is that such a removal must
 * SAY SO: pass the key in `putRun`'s `removing` option and the write is
 * allowed. Only the silent shortfall is refused.
 *
 * Zone-carrying states only. A capture nobody has found evidence for costs
 * nothing to re-seed, and refusing those would block the legitimate case where
 * a template stops declaring a slot.
 */
export class CaptureLossError extends Error {
  readonly runId: string;
  /**
   * Keys of stored, zone-carrying slot states whose evidence this write
   * discards: dropped from the array, or carried back with no zone.
   */
  readonly missing: string[];

  constructor(runId: string, missing: string[]) {
    super(
      `run ${runId} would lose ${missing.length} capture(s) carrying evidence ` +
        `(${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}) ` +
        "because this write drops them or carries them back without their " +
        "zone. A lanjutan is discovered, not declared, so it exists only in " +
        "the stored slot list and a write rebuilt from the template silently " +
        "deletes it. If you meant to remove a capture, name it in putRun's " +
        "`removing` option; otherwise re-read the run and re-apply the change.",
    );
    this.name = "CaptureLossError";
    this.runId = runId;
    this.missing = missing;
  }
}

/**
 * A write that would silently drop work the OPERATOR AUTHORED: a judul or a
 * bagian they renamed, or a judul they added to this order by hand.
 *
 * THE FOURTH NET, AND IT GUARDS `overlay` FOR THE REASON `CaptureLossError`
 * GUARDS `slots`. The writer both were built for is the same one. A rebuild
 * from `AO_TEMPLATE.sections` emits `overlay: emptyOverlay(...)` exactly as
 * readily as it emits zone-less captures: it arrives at the CORRECT revision,
 * carrying EVERY page and EVERY capture key, reverts every heading the operator
 * renamed, deletes every judul they added, and reports success.
 *
 * WHAT INVERTED, and why this is not simply `CaptureLossError` widened. That
 * class deliberately ignores a state carrying no zone, justified above as "a
 * capture nobody has found evidence for costs nothing to re-seed". THAT
 * PREMISE IS STILL TRUE OF `SlotState`, because nothing an operator authors
 * lives there -- a rename writes a patch, never a state. It is false one level
 * up: `run.overlay` is the ONLY place their naming work exists, and nothing
 * re-seeds a name.
 *
 * AUTHORSHIP, NOT PRESENCE, which is the same line drawn one level up. A
 * `ProposedSection` may be dropped freely: it is a usulan nobody has ruled on,
 * the overlay equivalent of a capture with no zone. Adding `removed: true` is
 * the operator DELETING, which is a write and not a loss. Reordering loses
 * nothing.
 */
export class SectionLossError extends Error {
  readonly runId: string;
  /** Overlay node ids whose stored authorship this write discards. */
  readonly missing: NodeId[];

  constructor(runId: string, missing: NodeId[]) {
    super(
      `run ${runId} would lose ${missing.length} operator-authored name(s) ` +
        `(${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}) ` +
        "because this write does not carry them and did not name them. A run's " +
        "overlay is the only place a renamed or added judul exists, so a write " +
        "rebuilt from AO_TEMPLATE reverts every heading at the correct " +
        "revision with every page and every capture present. If you meant to " +
        "drop them, name the ids in putRun's `removingSections` option; " +
        "otherwise re-read the run and re-apply the change.",
    );
    this.name = "SectionLossError";
    this.runId = runId;
    this.missing = missing;
  }
}

/**
 * Which of `stored`'s authored names `incoming` throws away.
 *
 * EVERY REFUSAL NAMES AN ID, and that is a structural requirement rather than
 * a nicety: `removingSections` is a list of ids, so a loss this function could
 * not name would be a refusal no legitimate caller could ever opt out of.
 *
 * That is exactly why `overlay.order` is NOT compared here. Its ids name
 * sections that still exist, so a dropped order has no id to hand back, and
 * "reordering loses nothing" is the rule the design states for it. The
 * consequence is stated rather than hidden: a writer that drops a stored
 * `order` while keeping every patch reverts the operator's arrangement, and
 * nothing here stops it. No writer produces that shape today -- the
 * rebuild-from-template one drops the patches too, and is caught on those.
 *
 * DROPPED AND REVERTED ARE ONE SHAPE, not two. The patch IS the name: an
 * overlay carries no copy of the base's title to compare against, so losing
 * the patch is precisely what reverting the heading means. A patch that
 * carries a DIFFERENT title is an edit, and edits are what this file is for.
 *
 * EXPORTED FOR THE STUB RUNTIME, which models this refusal rather than
 * accepting a write the real store would reject. A fake that is more permissive
 * than production hides exactly the bug the guard exists to catch, and this app
 * ran on that fake for an entire track.
 */
export function discardedAuthorship(
  stored: TemplateOverlay,
  incoming: TemplateOverlay | undefined,
): NodeId[] {
  const lost: NodeId[] = [];

  // AN INCOMING RUN WITH NO OVERLAY AT ALL CARRIES NOTHING, so it loses
  // everything and is refused BY NAME. The type says the field is required, so
  // this can only arrive from an object that was cast, parsed, or hand-built --
  // and a property read that threw `Cannot read properties of undefined` from
  // inside a readwrite transaction would refuse the write with a sentence that
  // names neither the run nor what it was about to drop.
  const nextSections = new Map(Object.entries(incoming?.sections ?? {}));
  // Maps rather than the records themselves, for the reason `resolveTemplate`
  // gives: a stored id that happens to name something on Object.prototype
  // ("constructor", "toString") reads back as a value that is not a patch, and
  // asking it for `.title` answers undefined rather than throwing. That would
  // report a patch as lost that is sitting right there.
  for (const [id, patch] of Object.entries(stored.sections)) {
    if (patch.title === undefined) continue;
    if (nextSections.get(id)?.title === undefined) lost.push(id);
  }

  const nextSlots = new Map(Object.entries(incoming?.slots ?? {}));
  for (const [id, patch] of Object.entries(stored.slots)) {
    const next = nextSlots.get(id);
    // Two independently authored strings on one node, so they are checked
    // independently: a write that keeps the renamed label and drops the
    // operator's own catatan has still thrown away something they typed, and
    // reporting the id once is enough to refuse it.
    const droppedLabel = patch.label !== undefined && next?.label === undefined;
    const droppedCatatan =
      patch.catatan !== undefined && next?.catatan === undefined;
    if (droppedLabel || droppedCatatan) lost.push(id);
  }

  const kept = new Set((incoming?.added ?? []).map((section) => section.id));
  for (const section of stored.added) {
    if (!kept.has(section.id)) lost.push(section.id);
  }

  return lost;
}

/**
 * A write that would silently drop something the OPERATOR DECIDED at
 * Konfig Excel or Input EPIC: a recommendation they took, one they refused, a
 * value they typed themselves, or the one re-search this order is allowed.
 *
 * THE FIFTH NET, AND IT GUARDS A RULING WHERE `SectionLossError` GUARDS A NAME
 * AND `CaptureLossError` GUARDS A PICTURE. The writer all three were built for
 * is still the same one: anything that rebuilds a run from the compile-time
 * form -- a migration, a "reset this order", a helper that maps over
 * `AO_TEMPLATE.sections` -- emits `konfigurasi: emptyConfigCheck()` and
 * `epic: emptyEpicCheck()` exactly as readily as it emits `emptyOverlay(...)`.
 * It arrives at the CORRECT revision, carrying every page, every capture and
 * every heading, and simply short every answer a person gave.
 *
 * WHAT THAT COSTS, WHICH IS WHY IT IS ITS OWN NET. `run.konfigurasi.entries` is
 * the only place a decision on an isian exists. `pendingEdits` reads them to
 * decide which cells of the operator's workbook to amend, so a lost `setuju` is
 * a cell that silently stays wrong in a workbook the operator downloads and
 * hands back to EPIC; a lost `tolak` is a question they already answered being
 * put to them again, in a screen whose amber count is supposed to mean "a
 * decision is owed here"; and a lost `manual` is a value they TYPED, which no
 * model call and no re-search can reconstruct at all.
 *
 * `researched` is in the same class for a different reason. It is a spent
 * budget -- the client's instruction says the re-search may be paid for once
 * per order -- so a write that quietly turns it back to `false` does not lose
 * data, it refunds money that was already spent and invites the operator to
 * spend it again.
 */
export class DecisionLossError extends Error {
  readonly runId: string;
  /** Decision ids whose stored ruling this write discards. */
  readonly missing: string[];

  constructor(runId: string, missing: string[]) {
    super(
      `run ${runId} would lose ${missing.length} operator decision(s) ` +
        `(${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}) ` +
        "because this write does not carry them and did not name them. A " +
        "ruling on an isian, and a value the operator typed, live nowhere but " +
        "run.konfigurasi and run.epic, so a write rebuilt from the template " +
        "reverts every one of them at the correct revision with every page, " +
        "every capture and every heading present. If you meant to discard " +
        "them -- a replacement workbook is the case this exists for -- name " +
        "the ids in putRun's `removingDecisions` option; otherwise re-read the " +
        "run and re-apply the change.",
    );
    this.name = "DecisionLossError";
    this.runId = runId;
    this.missing = missing;
  }
}

/**
 * The two namespaces a decision id is minted in, so the halves cannot collide.
 *
 * A `ConfigField.id` is minted per order when a workbook is interpreted and
 * this module knows nothing about its shape, so the namespace has to do the
 * separating rather than a hoped-for difference between two id alphabets.
 */
const CONFIG_ENTRY_PREFIX = "konfigurasi/entry/";
const EPIC_ENTRY_PREFIX = "epic/entry/";

/**
 * The two SENTINEL ids, for the losses that are a field moving backwards rather
 * than a row going missing.
 *
 * Every refusal has to name an id, because `removingDecisions` is a list of
 * ids: a loss this module could not name would be a refusal no legitimate
 * caller could ever opt out of. `researched` and `basis` are single fields with
 * no row of their own, so they are given a stable name here rather than being
 * left unnameable. Stable is the operative word -- these strings are written
 * into an opt-in by callers and compared here, so they are constants and not
 * something either side spells out by hand.
 */
export const CONFIG_RESEARCHED_ID = "konfigurasi/researched";
export const EPIC_BASIS_ID = "epic/basis";

/** How one Konfig Excel isian is addressed, in an opt-in and in an edit alike. */
export function configEntryId(entry: ConfigEntry): string {
  return `${CONFIG_ENTRY_PREFIX}${entry.field.id}`;
}

/**
 * How one Input EPIC finding is addressed.
 *
 * `fieldId` WHEN THERE IS ONE, THE LABEL WHEN THERE IS NOT, and the second half
 * is forced by the domain rather than chosen: a `tidak-ada-di-excel` entry is
 * EPIC showing something the workbook has no field for, so there is no
 * `ConfigField.id` to point at -- that absence is the whole content of the
 * finding. The two are kept in separate sub-namespaces (`f:` and `l:`) so a
 * field id and a label that happen to read alike cannot answer to one string.
 *
 * THE LABEL HALF GOES THROUGH `labelKey`, AND THAT IS NOT TIDINESS. The label
 * of a `tidak-ada-di-excel` finding is raw transcription: `buildEpicPrompt`
 * asks the model to read EPIC's own label off the capture. Keyed verbatim, an
 * operator's ruling was addressed by a string the next comparison could spell
 * differently -- `"Nama Pelanggan :"` for `"Nama Pelanggan:"` -- and the
 * ruling would then be lost SILENTLY, because under the new spelling it reads
 * as a new finding rather than a missing one and `discardedDecisions` cannot
 * refuse a loss it cannot name. Review confirmed the path; `labelKey` in
 * `src/lib/config/types.ts` is the one copy of the rule.
 *
 * THE COST, STATED RATHER THAN HIDDEN: two `tidak-ada-di-excel` findings
 * carrying the SAME label are one id, so a decision on either reads as a
 * decision on both. `EpicEntry` has no id field in the contract
 * (`src/lib/config/types.ts`), and inventing a positional one here would be
 * worse -- a re-comparison that reordered the findings would silently move
 * every ruling onto a different row. Adding an `id` to `EpicEntry`, minted
 * where the entries are, is the real fix and is a change to that file.
 */
export function epicEntryId(entry: EpicEntry): string {
  return entry.fieldId === undefined
    ? `${EPIC_ENTRY_PREFIX}l:${labelKey(entry.label)}`
    : `${EPIC_ENTRY_PREFIX}f:${entry.fieldId}`;
}

/** Everything `discardedDecisions` needs, which a `BrowserRun` satisfies. */
export type DecisionRecord = {
  konfigurasi?: ConfigCheck;
  epic?: EpicCheck;
};

/**
 * Which of `stored`'s operator decisions `incoming` throws away.
 *
 * ## THE AUTHORSHIP LINE, DRAWN EXPLICITLY
 *
 * This is `discardedAuthorship`'s line one field over, and the same sentence
 * settles it: what did a PERSON decide, versus what costs only a model call to
 * make again.
 *
 * GUARDED, because a person did it:
 *  - a `ConfigEntry` or `EpicEntry` whose `decision` is anything but `"belum"`.
 *    That is precisely "somebody ruled on this": `setuju` and `tolak` are a
 *    pair and neither is a default, and `manual` is a value they typed.
 *  - a `manual` entry carried back without its `manualValue`, which is the
 *    same loss wearing the decision's clothes. `discardedAuthorship` checks a
 *    patch's `label` and `catatan` independently for exactly this reason.
 *  - `ConfigCheck.researched === true` turning back to false. A spent budget
 *    that silently comes back is not a budget, and the client named it: the
 *    re-search may be paid for once per order.
 *  - `EpicCheck.basis` moving AWAY from an answered value back to `"belum"`.
 *    The operator answered a question -- is there a newer workbook -- and a
 *    write that forgets the answer does not merely re-ask it: while `basis`
 *    stands at `"belum"` Input EPIC has no yardstick, and the repair a
 *    hurried operator reaches for is "lanjutkan", which judges EPIC against
 *    Konfig Excel's workbook whether or not that is the one they meant.
 *
 * FREE TO DROP, because nothing a person did is in it:
 *  - an entry still at `"belum"`, and every `verdict`, `documentValue`,
 *    `epicValue`, `citation` and `reason` on ANY entry. Those are the model's
 *    answers. They cost a call to make again, not a person's decision, which is
 *    the same line `overlay.proposed` is on one level up and the same line
 *    `CaptureLossError` draws between a capture carrying a zone and one that
 *    does not.
 *  - `ConfigCheck.workbook` and `EpicCheck.captures`. Both are INPUT the
 *    operator can hand over again, exactly as a berkas is, and neither carries
 *    a judgement. The residual is real and is stated rather than hidden: a
 *    write that drops every capture while no ruling has been made yet is not
 *    refused here, and what it costs is the operator taking the screenshots
 *    again. Guarding them would mean refusing `removeEpicCapture`, which is a
 *    gesture the operator makes on purpose.
 *
 * EXPORTED, so `src/lib/browser/config.ts` computes each edit's opt-in BY
 * CALLING THIS -- the very function `putRun` will run to decide whether to
 * refuse the write. Deriving the opt-in from the guard is what makes it
 * impossible for the two to disagree, and it is why `sections.ts` calls
 * `discardedAuthorship` rather than hand-listing ids.
 *
 * AN INCOMING RUN WITH NEITHER FIELD CARRIES NOTHING, so it loses everything
 * and is refused BY NAME. The type says both are required, so that can only
 * arrive from an object that was cast, parsed or hand-built -- and a property
 * read that threw from inside a readwrite transaction would refuse the write
 * with a sentence naming neither the run nor what it was about to drop.
 */
export function discardedDecisions(
  stored: DecisionRecord,
  incoming: DecisionRecord | undefined,
): string[] {
  const lost: string[] = [];

  // GUARDED ON THE STORED HALF FIRST, per field. A record written before
  // Konfig Excel existed holds no `konfigurasi` at all, and something that
  // never held a decision cannot lose one -- so it is skipped outright rather
  // than compared against an invented empty, exactly as `putRun` skips a
  // pre-overlay record.
  if (stored.konfigurasi) {
    const next = incoming?.konfigurasi;
    const carried = new Map(
      (next?.entries ?? []).map((entry) => [configEntryId(entry), entry]),
    );
    for (const entry of stored.konfigurasi.entries) {
      if (entry.decision === "belum") continue;
      const id = configEntryId(entry);
      const kept = carried.get(id);
      // DROPPED AND REVERTED ARE ONE SHAPE, as they are for an overlay patch.
      // The entry IS the ruling: there is no copy of it anywhere else, so
      // carrying the row back at `"belum"` is precisely what un-deciding it
      // means. A DIFFERENT decision is an edit, and edits are ordinary work.
      if (!kept || kept.decision === "belum") {
        lost.push(id);
        continue;
      }
      if (entry.decision === "manual" && kept.manualValue === undefined) {
        lost.push(id);
      }
    }
    // `!== true` rather than `=== false`: an incoming half that is missing
    // entirely has not kept the budget either.
    if (stored.konfigurasi.researched && next?.researched !== true) {
      lost.push(CONFIG_RESEARCHED_ID);
    }
  }

  if (stored.epic) {
    const next = incoming?.epic;
    const carried = new Map(
      (next?.entries ?? []).map((entry) => [epicEntryId(entry), entry]),
    );
    for (const entry of stored.epic.entries) {
      if (entry.decision === "belum") continue;
      const id = epicEntryId(entry);
      const kept = carried.get(id);
      if (!kept || kept.decision === "belum") {
        lost.push(id);
        continue;
      }
      if (entry.decision === "manual" && kept.manualValue === undefined) {
        lost.push(id);
      }
    }
    if (stored.epic.basis !== "belum" && (next?.basis ?? "belum") === "belum") {
      lost.push(EPIC_BASIS_ID);
    }
  }

  return lost;
}

/**
 * The revision an object was built from, with a missing one read as 0.
 *
 * Absent means either a run built by hand that was never stored, or a record
 * written before runs carried a revision at all. Both are correctly treated
 * as the oldest possible revision: the first can only create, and the second
 * matches the 0 that `readRev` reports for that stored record too, so an
 * existing run upgrades on its next write instead of becoming unwritable.
 */
function revOf(meta: { rev?: number } | undefined | null): number {
  return meta?.rev ?? 0;
}

/**
 * A page as stored.
 *
 * `order` is the page's position in `BrowserRun.pages` and exists because
 * IndexedDB returns index matches in key order, not insertion order, so
 * without it the array would come back reordered -- and a reordered
 * `pages` array silently repoints every `Zone.pageIndex`. It is an
 * implementation detail: `loadRun` sorts by it and strips it.
 */
type PageRecord = StoredPage & { runId: string; order: number };

export type StoredSource = {
  id: string;
  runId: string;
  name: string;
  /** The original PDF, byte for byte, so a page can be re-rendered on demand. */
  bytes: ArrayBuffer;
};

/**
 * A stored page as the rest of the app sees it: the bookkeeping columns
 * dropped, field by field rather than by rest-spread, so that adding a field
 * to `StoredPage` fails to compile here instead of silently not being read
 * back.
 *
 * AN OPTIONAL FIELD DEFEATS THAT GUARD, which is worth knowing before you add
 * one. `short` was added to `StoredPage` as `short?:` and this function
 * compiled unchanged: the write stored it, this read dropped it, and a page
 * the device knew it had misread came back looking clean. Nothing failed.
 * `persistence.test.mts` pins the round trip for exactly that reason -- a
 * type cannot check this one, so a test has to.
 */
function toStoredPage(record: PageRecord): StoredPage {
  return {
    id: record.id,
    sourceId: record.sourceId,
    index: record.index,
    widthPx: record.widthPx,
    heightPx: record.heightPx,
    lines: record.lines,
    // Absent, not `undefined`, when the page passed: see `PageShortfall`.
    ...(record.short ? { short: record.short } : {}),
  };
}

const promisify = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

let connection: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new Error(
        "IndexedDB is unavailable here. Runs are stored on the device, so " +
          "this module only works in a browser tab or a Web Worker -- never " +
          "during server rendering.",
      ),
    );
  }

  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RUNS)) {
        db.createObjectStore(RUNS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PAGES)) {
        db.createObjectStore(PAGES, { keyPath: "id" }).createIndex(
          BY_RUN,
          "runId",
        );
      }
      if (!db.objectStoreNames.contains(SOURCES)) {
        db.createObjectStore(SOURCES, { keyPath: "id" }).createIndex(
          BY_RUN,
          "runId",
        );
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);

    // A second tab holding an older version blocks the upgrade indefinitely.
    // Surface it instead of hanging on a promise that never settles.
    request.onblocked = () =>
      reject(
        new Error(
          "IndexedDB upgrade is blocked by another open tab. Close other " +
            "tv-helper tabs and reload.",
        ),
      );
  }).catch((error) => {
    // Let the next call retry rather than caching a rejected connection.
    connection = undefined;
    throw error;
  });

  return connection;
}

/**
 * Runs `action` inside one transaction over `stores` and does not resolve
 * until the transaction has actually COMMITTED.
 *
 * Waiting for `oncomplete` rather than for the last request's `onsuccess` is
 * the difference between "the write happened" and "the write was accepted";
 * a quota failure aborts at commit time, after every individual request has
 * already reported success. A caller that returned early would report a
 * saved run that is not there after a reload.
 */
async function transact<T>(
  stores: string[],
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDatabase();
  const tx = db.transaction(stores, mode);

  const settled = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(
        tx.error ??
          new Error("IndexedDB write aborted, likely out of disk quota."),
      );
  });

  // An unobserved rejected promise is an unhandled rejection, which in a Web
  // Worker is an error event with no context at all. A readonly transaction's
  // outcome is never awaited; a readwrite one is not awaited either when
  // `action` itself throws, which is how the revision checks below refuse a
  // write. Attaching this handler does not stop `await settled` from seeing
  // the rejection -- `.catch` derives a new promise and leaves the original
  // rejected -- so the caller still learns about a failed commit.
  void settled.catch(() => {});

  let result: T;
  try {
    result = await action(tx);
  } catch (error) {
    // Nothing half-written survives a refusal. The checks below throw before
    // issuing any write, so this is belt and braces -- but a future check
    // added after the first `put` would silently commit part of a rejected
    // write without it, which is precisely the failure shape this module is
    // written against.
    try {
      tx.abort();
    } catch {
      // Already finished; there is nothing to abort.
    }
    throw error;
  }

  if (mode === "readwrite") await settled;
  return result;
}

/** Every run's small half, newest first. Never reads a page or a PDF. */
export async function listRunMeta(): Promise<RunMeta[]> {
  const rows = await transact([RUNS], "readonly", (tx) =>
    promisify(tx.objectStore(RUNS).getAll() as IDBRequest<StoredRunMeta[]>),
  );
  return rows.map(readMeta).sort((a, b) => b.createdAt - a.createdAt);
}

/** A whole run, pages included, or null. PDF bytes are never loaded here. */
export async function getRun(id: string): Promise<BrowserRun | null> {
  return transact([RUNS, PAGES], "readonly", async (tx) => {
    const meta = await promisify(
      tx.objectStore(RUNS).get(id) as IDBRequest<StoredRunMeta | undefined>,
    );
    if (!meta) return null;

    const records = await promisify(
      tx.objectStore(PAGES).index(BY_RUN).getAll(id) as IDBRequest<
        PageRecord[]
      >,
    );

    // `readMeta` stamps the revision and upgrades a record written before runs
    // carried an overlay. THE UPGRADE IS NOT WRITTEN BACK: see that function.
    return {
      ...readMeta(meta),
      pages: records.sort((a, b) => a.order - b.order).map(toStoredPage),
    };
  });
}

/**
 * Persists a run, but only if the run has not moved on since it was read.
 *
 * ## What this used to do, and what it cost
 *
 * It replaced a run wholesale: every stored page not present in `run.pages`
 * was DELETED. That made a stale write catastrophic and silent. An operator
 * uploads a 29-page bundle; `ingestDocument` OCRs it for three minutes,
 * appending pages as it goes; the UI is meanwhile holding the `BrowserRun` it
 * loaded before the upload, and the moment the operator accepts a zone it
 * saves that object. Every page the ingest had written was deleted, the save
 * resolved, and the run still opened and still looked complete. The comment
 * here used to name that hazard and tell callers to re-read -- but the UI
 * cannot re-read an object React is already rendering, and a rule that is
 * only ever documented is a rule that eventually gets broken by the one
 * caller that did not read the comment.
 *
 * ## The two checks
 *
 * 1. REVISION. `run.rev` is the revision the caller read (absent = 0, the
 *    oldest possible). It is compared against what is stored INSIDE the same
 *    readwrite transaction as the write, so the read and the write cannot be
 *    separated by another writer -- including one in another tab, which the
 *    per-run lock in `runtime.ts` cannot see at all. A mismatch throws
 *    `StaleRunWriteError` and writes nothing. A run that is not stored may
 *    only be written by a caller at revision 0, so a save cannot resurrect a
 *    deleted run either.
 *
 * 2. PAGE LOSS. Even at the correct revision, a write that does not carry
 *    every stored page is refused with `PageLossError` rather than deleting
 *    the difference. Pages are append-only -- `Zone.pageIndex` is a position
 *    in that array -- so there is no such thing as a legitimate page removal
 *    short of deleting the whole run, which `deleteRun` does. The old
 *    comment's argument for deleting (orphans would be handed back as
 *    current) is answered better this way: nothing is orphaned, because
 *    nothing is dropped.
 *
 * 3. CAPTURE LOSS. A write that drops a stored slot state CARRYING A ZONE,
 *    or that carries one back with its zone gone, is refused with
 *    `CaptureLossError` unless it names that key in `options.removing`. This
 *    is the same shape as check 2, for the list that stopped being derivable
 *    when a lanjutan became something discovered rather than declared: see the
 *    class comment.
 *
 * 4. SECTION LOSS. A write that drops a heading the operator renamed or a
 *    judul they added is refused with `SectionLossError` unless it names those
 *    node ids in `options.removingSections`. Same shape again, for the one
 *    place an operator's naming work lives.
 *
 * 5. DECISION LOSS. A write that drops a ruling the operator made at
 *    Konfig Excel or Input EPIC -- a recommendation taken or refused, a value
 *    they typed, the one re-search this order is allowed, or their answer to
 *    "is there a newer workbook" -- is refused with `DecisionLossError` unless
 *    it names those ids in `options.removingDecisions`. Same shape a fourth
 *    time, for the one place an operator's judgements about the workbook live.
 *
 * All five are refusals, not repairs. Merging the caller's slots onto the
 * stored pages would let the save appear to succeed while quietly discarding
 * whichever of the two writers' slot edits lost, and a validator signs what
 * comes out of here.
 *
 * Returns the run as now stored, with `rev` advanced. THE CALLER MUST KEEP
 * IT: the object it passed in is stale the instant this resolves, and saving
 * that one again throws.
 *
 * Source BYTES are untouched here. `BrowserRun.sources` carries no bytes, so
 * writing this object over the `sources` store would wipe the PDFs and break
 * `pageBitmap` later, at display time, far from the cause.
 */
export type PutRunOptions = {
  /**
   * Slot-state keys whose stored EVIDENCE this write deliberately discards:
   * the state is dropped from the array, or carried back without its zone.
   *
   * The opt-in that turns a silent shortfall into a stated intention. Only a
   * stored state carrying a zone needs naming; everything else may come and go
   * with the template.
   *
   * BOTH SHAPES NEED NAMING because both are the same loss. "Bukan ini" on
   * capture 1 keeps the row -- the template still asks for that bagian -- and
   * clears its zone, which deletes an accepted crop exactly as removing the
   * row would; a rebuild-from-template writer produces the same shape by
   * accident, which is the case this net was built for.
   */
  removing?: readonly string[];

  /**
   * `StoredPage.id` of every page this write deliberately deletes.
   *
   * THE ONE LEGITIMATE PAGE REMOVAL, and it arrived later than this file did.
   * `BrowserRun.pages` is append-only and `PageLossError` above says there is
   * no legitimate single-page removal, only `deleteRun`. That was true only
   * while nothing had asked for one: the operator can now take a single source
   * document back out of an open order (`removeSource` in
   * `src/lib/browser/sources.ts`), which is a real thing to want -- realising
   * halfway through that a scan is the wrong document does not become less
   * true because two crops were accepted from it first.
   *
   * SO THE GUARD IS WIDENED, NOT BYPASSED, and the shape is the whole point.
   * It is a LIST OF IDS and never a boolean or a count. A caller passing ids
   * is saying "I know about exactly these and I mean them", so a write that
   * ALSO loses pages it never knew about still fails on the ones it did not
   * name. `removingPages: true` would be a bypass with a polite name, and the
   * next person to meet `PageLossError` would reach for it.
   *
   * The named records are deleted inside this write's own transaction, so a
   * crash cannot leave the run pointing at pages that are gone or pages
   * orphaned under a run that no longer lists them. Every surviving page is
   * re-`put` with its new `order` in the same pass, which is what keeps
   * `Zone.pageIndex` meaning what it says -- and remapping the zones
   * themselves is the caller's job, done in `removeSource` where a test can
   * read the arithmetic.
   */
  removingPages?: readonly string[];

  /**
   * Overlay node ids whose stored NAME or EXISTENCE this write deliberately
   * discards: a heading the operator renamed and this write un-renames, or a
   * judul they added and this write drops.
   *
   * TWO OPT-INS, NOT ONE, and they are deliberately not folded together.
   * `removing` is about a POTONGAN -- a picture a human accepted -- and this
   * is about a NAME. One option covering both would let a caller that meant to
   * drop a heading quietly discard a crop as well, on an opt-in it had already
   * written for the other reason. They are different losses and they are
   * confirmed separately.
   *
   * A LIST OF IDS AND NEVER A BOOLEAN, for the reason `removingPages` gives
   * above: a caller naming ids is saying "I know about exactly these and I
   * mean them", so a write that ALSO loses a name it never knew about still
   * fails on the one it did not name.
   *
   * Deleting a judul the operator authored is the write this exists for, and
   * it is the one edit that has to say so out loud -- because dropping a judul
   * without dropping the states under it leaves those crops orphaned, which is
   * the loss wearing a different coat.
   */
  removingSections?: readonly NodeId[];

  /**
   * Decision ids whose stored RULING this write deliberately discards: an
   * isian the operator had ruled on and this write returns to `belum`, a value
   * they typed and this write drops, the spent re-search, or their answer to
   * "is there a newer workbook".
   *
   * A THIRD OPT-IN, NOT A WIDENING OF EITHER OF THE OTHER TWO, and the
   * argument is the one `removingSections` already makes against being folded
   * into `removing`. `removing` is about a POTONGAN, `removingSections` is
   * about a NAME, and this is about a JUDGEMENT. One option covering two of
   * them would let a caller that meant to replace a workbook quietly discard a
   * crop or a heading as well, on an opt-in it had already written for the
   * other reason. They are different losses and they are confirmed separately.
   *
   * A LIST OF IDS AND NEVER A BOOLEAN, for the reason `removingPages` gives:
   * a caller naming ids is saying "I know about exactly these and I mean
   * them", so a write that ALSO loses a decision it never knew about still
   * fails on the one it did not name.
   *
   * THE WRITE THIS EXISTS FOR is the operator handing over a REPLACEMENT
   * workbook. Every ruling was made about the cells of the old one, so they
   * genuinely do not survive it -- and that is a decision a person takes with
   * their eyes open, which is exactly the kind of loss that has to say so out
   * loud rather than being a side effect of writing a shorter array. Mint the
   * ids with `configEntryId` / `epicEntryId`, or let
   * `src/lib/browser/config.ts` compute them by calling `discardedDecisions`.
   */
  removingDecisions?: readonly string[];
};

export async function putRun(
  run: BrowserRun,
  options: PutRunOptions = {},
): Promise<BrowserRun> {
  const ids = new Set(run.pages.map((p) => p.id));
  if (ids.size !== run.pages.length) {
    throw new Error(
      `run ${run.id} has duplicate page ids; one page would silently ` +
        "overwrite another, and every zone pointing past it would shift.",
    );
  }

  const { pages, ...meta } = run;
  const expected = revOf(run);
  const next = expected + 1;

  await transact([RUNS, PAGES], "readwrite", async (tx) => {
    const runs = tx.objectStore(RUNS);
    const stored = await promisify(
      runs.get(run.id) as IDBRequest<StoredRunMeta | undefined>,
    );

    if (!stored) {
      if (expected !== 0) throw new StaleRunWriteError(run.id, expected, null);
    } else if (revOf(stored) !== expected) {
      throw new StaleRunWriteError(run.id, expected, revOf(stored));
    }

    // Read from the SAME transaction as the write, for the same reason the
    // revision is: a check done in a separate transaction cannot see a second
    // tab, and this list is now the only place a discovered capture lives.
    if (stored) {
      /*
       * THE SECTION CHECK COMES BEFORE THE CAPTURE CHECK, and the ordering is
       * an argument rather than a preference.
       *
       * The writer both nets were built for -- a rebuild from
       * `AO_TEMPLATE.sections` -- trips BOTH. Only one error can be thrown, so
       * the one thrown decides what the next person reads. The overlay is the
       * ROOT CAUSE (the write was assembled from the compile-time form, so it
       * could not have carried this order's names) and the captures are the
       * larger, louder CONSEQUENCE. Reporting the consequence would send a
       * reader hunting for a lanjutan bug that is not there.
       *
       * It is also the cheapest of the three: a handful of object keys against
       * a walk of every slot and every page.
       *
       * A record stored before overlays existed carries none, and something
       * that never held a name cannot lose one, so it is skipped outright
       * rather than compared against an invented empty.
       */
      if (stored.overlay) {
        const named = new Set(options.removingSections ?? []);
        const lost = discardedAuthorship(stored.overlay, run.overlay).filter(
          (id) => !named.has(id),
        );
        if (lost.length > 0) throw new SectionLossError(run.id, lost);
      }

      /*
       * THE DECISION CHECK SITS BETWEEN THEM, on the same argument.
       *
       * The rebuild-from-template writer trips all three, and only one error
       * can be thrown. The overlay above is the ROOT CAUSE and is reported
       * first. Of the two consequences that remain, this one is the smaller
       * and quieter -- a handful of rulings against a walk of every slot -- and
       * the captures are the larger, louder one, so they stay last for the
       * reason they were already last.
       *
       * It also earns its place ahead of the capture check for a second
       * reason: nothing about `konfigurasi` or `epic` is derivable from
       * `AO_TEMPLATE` at all, so a write that carries the right overlay and
       * still drops these was assembled by something in Konfig Excel or
       * Input EPIC -- and naming that, rather than a lanjutan that is fine,
       * points the next reader at the code that produced the write.
       *
       * Guarded per field inside `discardedDecisions`: an order stored before
       * either checkpoint existed holds neither, and something that never held
       * a decision cannot lose one.
       */
      if (stored.konfigurasi || stored.epic) {
        const named = new Set(options.removingDecisions ?? []);
        const lost = discardedDecisions(stored, run).filter(
          (id) => !named.has(id),
        );
        if (lost.length > 0) throw new DecisionLossError(run.id, lost);
      }

      const allowed = new Set(options.removing ?? []);
      // COMPARED ON THE EVIDENCE, NOT ON THE KEY. A key-presence check catches
      // only the writer that drops a state, and the writer this net was built
      // for -- a rebuild from `AO_TEMPLATE.sections` -- does not drop one: it
      // emits capture 1 under the template key verbatim (that is how
      // `seedSlots` keys it) with no `zone`. Every one of those keys IS
      // carried, so a key-only check passes while every accepted capture-1
      // crop is erased at the correct revision with every page present, and
      // the write reports success. The invariant is the one `types.ts` states
      // -- a whole-array write may not drop a state that carries a zone -- and
      // a state carried back with its zone removed has dropped exactly that.
      const carried = new Map(run.slots.map((slot) => [slot.key, slot]));
      const dropped = (stored.slots ?? [])
        .filter((slot) => slot.zone && !carried.get(slot.key)?.zone)
        .map((slot) => slot.key)
        .filter((key) => !allowed.has(key));
      if (dropped.length > 0) throw new CaptureLossError(run.id, dropped);
    }

    const store = tx.objectStore(PAGES);
    const existing = await promisify(
      store.index(BY_RUN).getAllKeys(run.id) as IDBRequest<IDBValidKey[]>,
    );
    const shedding = new Set(options.removingPages ?? []);
    const gone = existing
      .map((key) => String(key))
      .filter((key) => !ids.has(key));
    const missing = gone.filter((key) => !shedding.has(key));
    if (missing.length > 0) throw new PageLossError(run.id, missing);

    // Deleted in this transaction, alongside the run record that stops listing
    // them. Two transactions would leave a window in which the run is short
    // and its pages are not, or the reverse.
    for (const key of gone) store.delete(key);

    // Re-put with `order` recomputed from the array's new positions, which is
    // what makes a removal safe at all: `order` is what `Zone.pageIndex`
    // refers to, and the caller has already moved every surviving zone to
    // match. A page that merely shifted up is rewritten here, unchanged
    // except for that number.
    pages.forEach((page, order) => {
      store.put({ ...page, runId: run.id, order } satisfies PageRecord);
    });

    runs.put({ ...meta, rev: next } satisfies RunMeta);
  });

  return { ...run, rev: next };
}

/**
 * Appends ONE page and updates the run's small half, in one transaction.
 *
 * `putRun` would do the same thing by rewriting every page record the run
 * owns. That is O(pages) per page and O(pages^2) over an ingest, which for a
 * 29-page bundle is 435 writes of OCR lines to store 29. This is the path a
 * long ingest takes, so that a tab reloaded three minutes in keeps the pages
 * it already paid four seconds each for.
 *
 * `order` must be the page's position in `BrowserRun.pages` -- the caller
 * knows it, because it is appending to that array in the same step -- and
 * must never be reused: it is what `Zone.pageIndex` refers to.
 *
 * REVISION-CHECKED like `putRun`, and for the reason that makes the check
 * work at all: this is the write an ingest performs, once per page, for
 * minutes. If it did not advance the run's revision, a `BrowserRun` read
 * before the ingest would still look current when the ingest finished, and
 * saving it would delete every page the ingest had appended -- the exact
 * failure the revision exists to stop. So each page moves the run forward,
 * and anything holding an older copy is refused.
 *
 * The run must already be stored: an append has nothing to append to
 * otherwise, and inventing the run here would hide the ordering mistake that
 * led to it. Returns the meta as now stored, revision advanced.
 */
export async function appendPage(
  run: RunMeta,
  page: StoredPage,
  order: number,
): Promise<RunMeta> {
  const expected = revOf(run);
  const next = expected + 1;
  let written: RunMeta | null = null;

  await transact([RUNS, PAGES], "readwrite", async (tx) => {
    const runs = tx.objectStore(RUNS);
    const raw = await promisify(
      runs.get(run.id) as IDBRequest<StoredRunMeta | undefined>,
    );
    if (!raw) throw new StaleRunWriteError(run.id, expected, null);
    if (revOf(raw) !== expected) {
      throw new StaleRunWriteError(run.id, expected, revOf(raw));
    }
    // Read through the same upgrade every other read uses, so a run stored
    // before overlays existed is carried forward as an EMPTY overlay rather
    // than as a hole. This one is a write anyway -- the revision is advancing
    // in the same transaction -- so stamping the upgrade costs nothing extra
    // and is the migration landing where migrations are free.
    const stored = readMeta(raw);

    tx.objectStore(PAGES).put({
      ...page,
      runId: run.id,
      order,
    } satisfies PageRecord);
    // THE WRITE COMES FROM `stored`, NOT FROM THE CALLER, and so does the
    // return below. `run` is a whole `RunMeta`: it carries `slots`, `overlay`,
    // `konfigurasi` and `epic` as they were when the ingest STARTED, and an
    // ingest legitimately changes none of them. Writing the caller's copy hands
    // a minutes-old slot array, a minutes-old overlay and a minutes-old set of
    // Konfig Excel rulings back to the store on every page, so an edit made
    // while a 151-page document is being read is reverted by the next page with
    // nothing raised: the revision is correct, every page is present, and every
    // one of `putRun`'s nets is satisfied because this function is not
    // `putRun`. Taking all four from `stored` is what makes an operator's
    // Terima, pressed during an ingest, survive the next page.
    //
    // `sources` is the one part an ingest does change (`withAppendedPage`
    // updates `pageCount`), so it alone is taken from the caller.
    runs.put({ ...stored, sources: run.sources, rev: next } satisfies RunMeta);
    written = { ...stored, sources: run.sources, rev: next };
  });

  // THE RETURN MUST MATCH THE WRITE. Returning `{ ...run, rev: next }` hands the
  // caller its own pre-ingest arrays stamped with the ADVANCED revision, which
  // then passes every guard on the next ordinary save and writes the stale
  // arrays back. That is the same loss, moved one function outward, and it is
  // the shape that made this worth fixing before anything could edit a run
  // mid-ingest.
  if (!written) throw new Error(`appendPage(${run.id}) committed no run record`);
  return written;
}

/** One page by its own id, without loading the run it belongs to. */
export async function getPage(
  pageId: string,
): Promise<(StoredPage & { runId: string }) | null> {
  const record = await transact([PAGES], "readonly", (tx) =>
    promisify(
      tx.objectStore(PAGES).get(pageId) as IDBRequest<PageRecord | undefined>,
    ),
  );
  if (!record) return null;
  return { ...toStoredPage(record), runId: record.runId };
}

export async function putSource(source: StoredSource): Promise<void> {
  await transact([SOURCES], "readwrite", (tx) => {
    tx.objectStore(SOURCES).put(source);
  });
}

export async function getSource(id: string): Promise<StoredSource | null> {
  const source = await transact([SOURCES], "readonly", (tx) =>
    promisify(
      tx.objectStore(SOURCES).get(id) as IDBRequest<StoredSource | undefined>,
    ),
  );
  return source ?? null;
}

/**
 * Deletes ONE source document's stored PDF bytes.
 *
 * Separate from `putRun` on purpose, and ordered AFTER it by the only caller
 * (`removeDocument` in `src/lib/browser/runtime.ts`). The two are not one
 * transaction because they need not be: the bytes are re-renderable input, not
 * evidence. If this half fails, the run is already correct and what is left
 * behind is a few megabytes nothing references, which `deleteRun` collects.
 * If the ORDER were reversed and the run write failed, the run would point at
 * pages whose source bytes were gone, and `pageBitmap` could no longer
 * re-render a page an operator is looking at.
 */
export async function deleteSource(id: string): Promise<void> {
  await transact([SOURCES], "readwrite", (tx) => {
    tx.objectStore(SOURCES).delete(id);
  });
}

/**
 * Deletes a run and everything it owns.
 *
 * The PDFs are the reason this is not optional housekeeping: a 29-page scan
 * bundle is tens of megabytes, and an abandoned run that keeps them forever
 * eats the origin's storage quota until writes start failing on a run the
 * operator does care about.
 */
export async function deleteRun(id: string): Promise<void> {
  await transact([RUNS, PAGES, SOURCES], "readwrite", async (tx) => {
    for (const name of [PAGES, SOURCES]) {
      const store = tx.objectStore(name);
      const keys = await promisify(
        store.index(BY_RUN).getAllKeys(id) as IDBRequest<IDBValidKey[]>,
      );
      for (const key of keys) store.delete(key);
    }
    tx.objectStore(RUNS).delete(id);
  });
}
