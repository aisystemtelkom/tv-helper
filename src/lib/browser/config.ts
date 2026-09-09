/**
 * THE CHECKPOINT 2 / CHECKPOINT 3 EDIT ENGINE: one operator gesture, expressed
 * as a VALUE, applied to a run.
 *
 * ITS OWN MODULE, PURE, for the reason `sections.ts`, `captures.ts`,
 * `sources.ts` and `slot-key.ts` are: the interesting part is arithmetic over a
 * run, it has to be testable where IndexedDB is not, and the storage calls that
 * perform it (`editConfig` and `editEpic` in `runtime.ts`) are a few lines
 * wrapped around this.
 *
 * ## WHY AN EDIT IS A VALUE AND NOT A RUN
 *
 * The obvious API is `saveRun({ ...run, konfigurasi: next })` from the screen.
 * It is wrong here, and the reason is timing rather than taste.
 * `ingestDocument` holds the run lock for MINUTES over a 151-page document and
 * advances the revision once per page. A React-held `BrowserRun` composed into
 * a new `konfigurasi` during that window is dozens of revisions stale by the
 * time it reaches storage, and `putRun` refuses it -- correctly, and with a
 * sentence the operator has to understand ("this order changed underneath you")
 * for the crime of pressing Terima while a document was being read.
 *
 * A `ConfigEdit` has no revision. It is applied to whatever is STORED at the
 * moment the lock is taken, so a decision queued behind an ingest is a queued
 * write instead of a refused one. That is the same argument `sections.ts`
 * makes, and it bites harder here: Checkpoint 2 is a screen of eleven or twenty
 * amber rows and the operator works down it while the tool is still busy.
 *
 * ## WHAT EVERY EDIT OWES THE STORAGE LAYER
 *
 * `putRun` runs five nets. The one these gestures can trip is
 * `DecisionLossError`, whose opt-in is `removingDecisions`. Every function here
 * therefore returns THAT LIST ALONGSIDE THE RUN, and the caller hands it
 * straight to `putRun`.
 *
 * It is computed with `discardedDecisions`, which is the storage layer's OWN
 * function -- the one `putRun` will run to decide whether to refuse this write.
 * Deriving the opt-in from the guard rather than hand-listing ids is what makes
 * it impossible for the two to disagree: a future edit shape that drops
 * something new is named automatically instead of being refused in front of an
 * operator.
 *
 * Nothing here touches `slots`, `pages` or `overlay`, so `removing`,
 * `removingPages` and `removingSections` are empty BY PROOF rather than by
 * assertion: every gesture passes those three fields through by reference, and
 * the guards that read them compare exactly what they were given.
 *
 * ## THE MESSAGES HERE ARE ENGLISH
 *
 * Deliberately, and on the same rule `trimmedTitle` in `sections.ts` states:
 * the screen validates before it calls, so anything that reaches here is a
 * caller's mistake rather than an operator's typing, and a developer is the
 * person who has to read it. Every operator-facing sentence about a blank
 * value, a missing workbook or a duplicate screenshot belongs on the screen
 * that refused to submit it, in Bahasa.
 */

import type {
  ConfigDecision,
  ConfigEntry,
  ConfigField,
  ConfigWorkbook,
  EpicBasis,
  EpicCapture,
  EpicEntry,
} from "../config/types.ts";
import {
  configEntryId,
  discardedDecisions,
  epicEntryId,
} from "../storage/runs.ts";
import type { BrowserRun } from "./types.ts";

/**
 * A gesture that cannot be applied to this order as it stands.
 *
 * Its own class so a shell can tell it from a storage refusal and say the one
 * useful thing, exactly as `saveFault` in `operator-app.tsx` reads
 * `error.name` for `StaleRunWriteError` and its siblings. A bare `Error` here
 * would fall through to that function's generic sentence, which blames the
 * device's storage for a refusal that is about the edit.
 */
export class ConfigEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigEditError";
  }
}

export type ConfigEditResult = {
  /** The run as it should now be stored. The SAME OBJECT when nothing changed. */
  run: BrowserRun;
  /** `putRun`'s `removingDecisions`: operator rulings this write discards. */
  removingDecisions: string[];
};

// ---------------------------------------------------------------------------
// The two gesture vocabularies
// ---------------------------------------------------------------------------

export type ConfigEdit =
  /** The operator handed a workbook over and it was interpreted. */
  | {
      tag: "attach-workbook";
      workbook: ConfigWorkbook;
      entries: readonly ConfigEntry[];
    }
  /** A comparison against the scans came back. Decisions already made survive. */
  | { tag: "record-comparison"; entries: readonly ConfigEntry[] }
  /** Terima, Tolak, or Ketik sendiri on one isian. */
  | {
      tag: "decide";
      entryId: string;
      decision: ConfigDecision;
      manualValue?: string;
    }
  /** The one re-search this order is allowed has been spent. */
  | { tag: "mark-researched" };

export type EpicEdit =
  /** The answer to "is there a newer workbook", and the workbook if there is. */
  | {
      tag: "set-basis";
      basis: EpicBasis;
      workbook?: ConfigWorkbook;
      fields?: readonly ConfigField[];
    }
  /** One more tangkapan layar EPIC, already recognised. */
  | { tag: "add-capture"; capture: EpicCapture }
  /** One taken back out. */
  | { tag: "remove-capture"; captureId: string }
  /** A comparison against EPIC came back. Decisions already made survive. */
  | { tag: "record-comparison"; entries: readonly EpicEntry[] }
  | {
      tag: "decide";
      entryId: string;
      decision: ConfigDecision;
      manualValue?: string;
    };

/**
 * One Checkpoint 2 gesture, applied to one run.
 *
 * PURE, AND ALWAYS A NEW RUN OBJECT when anything changed. The stored run is
 * never mutated: `editConfig` reads it inside the lock and hands the result to
 * `putRun`, and a caller that mutated in place would have written half the edit
 * before the guards ran.
 */
export function applyConfigEdit(
  run: BrowserRun,
  edit: ConfigEdit,
): ConfigEditResult {
  switch (edit.tag) {
    case "attach-workbook":
      return attachWorkbook(run, edit.workbook, edit.entries);
    case "record-comparison":
      return recordComparison(run, edit.entries);
    case "decide":
      return decideConfig(run, edit.entryId, edit.decision, edit.manualValue);
    case "mark-researched":
      return markResearched(run);
  }
}

/** One Checkpoint 3 gesture, applied to one run. Same rules as above. */
export function applyEpicEdit(
  run: BrowserRun,
  edit: EpicEdit,
): ConfigEditResult {
  switch (edit.tag) {
    case "set-basis":
      return setEpicBasis(run, edit.basis, edit.workbook, edit.fields);
    case "add-capture":
      return addEpicCapture(run, edit.capture);
    case "remove-capture":
      return removeEpicCapture(run, edit.captureId);
    case "record-comparison":
      return recordEpicComparison(run, edit.entries);
    case "decide":
      return decideEpic(run, edit.entryId, edit.decision, edit.manualValue);
  }
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/**
 * Identity, so the runtime can skip the write entirely.
 *
 * A no-op that still saved would advance the revision and refuse whatever the
 * screen is holding, which is a real cost for a press that did nothing. Every
 * gesture below returns this rather than a copy when the order already is what
 * the press asked for -- the same rule `moveSection` and `withSourceAi` follow.
 */
function unchanged(run: BrowserRun): ConfigEditResult {
  return { run, removingDecisions: [] };
}

/**
 * A changed run, with its opt-in derived FROM THE GUARD THAT WILL JUDGE IT.
 *
 * Never a hand-listed set of ids. `discardedDecisions` is what `putRun` runs,
 * so asking it here means the two cannot come to different answers: a gesture
 * that drops a ruling it did not think it was dropping is named automatically
 * rather than being refused in front of an operator.
 */
function decided(run: BrowserRun, next: BrowserRun): ConfigEditResult {
  return { run: next, removingDecisions: discardedDecisions(run, next) };
}

/**
 * Structural equality over PLAIN DATA, which is all of these types are.
 *
 * Every shape in `src/lib/config/types.ts` is JSON: it round-trips through
 * IndexedDB's structured clone on every read, so a structural comparison is
 * exactly the right test of "did this press change anything" and a reference
 * comparison would answer no every time.
 *
 * WHY IT IS WORTH THE LINES. It is what makes the identity rule above real for
 * the two folds -- `record-comparison` on either checkpoint -- where the
 * incoming answer may reproduce the stored one exactly. Without it, a second
 * Proses that found the same twenty values would advance the revision and
 * refuse whatever the screen was holding, for an answer that said nothing new.
 *
 * `undefined` and an absent key are the SAME here, because `putRun` stores
 * these through structured clone and a caller that spread `{ ...entry }` over a
 * field it did not set produces one or the other arbitrarily.
 */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, at) => sameData(item, b[at]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!sameData(left[key], right[key])) return false;
  }
  return true;
}

/**
 * Two ids naming one row make one of them permanently unaddressable.
 *
 * The same defect `restoreSection` guards against when it refuses to seed a
 * second state under a key the run already holds: every screen, every decision
 * and `discardedDecisions` itself key by this string, so a duplicate means a
 * Terima on one row silently rules on the other and one of the two can never be
 * decided at all.
 */
function assertDistinct(ids: string[], what: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new ConfigEditError(
        `${what}: two entries answer to the id "${id}". One of them would be ` +
          "permanently unaddressable, and a decision on either would read as a " +
          "decision on both.",
      );
    }
    seen.add(id);
  }
}

function assertConfigEntries(
  entries: readonly ConfigEntry[],
  what: string,
): void {
  if (!Array.isArray(entries)) {
    throw new ConfigEditError(`${what}: entries must be an array`);
  }
  for (const [at, entry] of entries.entries()) {
    if (!entry?.field?.id) {
      throw new ConfigEditError(
        `${what}: entries[${at}] carries no field id, so nothing could ever ` +
          "address it -- not a decision, not the opt-in that protects one",
      );
    }
  }
  assertDistinct(entries.map(configEntryId), what);
}

function assertEpicEntries(entries: readonly EpicEntry[], what: string): void {
  if (!Array.isArray(entries)) {
    throw new ConfigEditError(`${what}: entries must be an array`);
  }
  for (const [at, entry] of entries.entries()) {
    // A `tidak-ada-di-excel` entry legitimately has no `fieldId` -- that
    // absence IS the finding -- so the label is the only thing left to address
    // it by, and a blank one leaves it unaddressable. See `epicEntryId`.
    if (entry?.fieldId === undefined && !entry?.label) {
      throw new ConfigEditError(
        `${what}: entries[${at}] has neither a fieldId nor a label, so there ` +
          "is no id to decide it under",
      );
    }
  }
  assertDistinct(entries.map(epicEntryId), what);
}

/**
 * One entry with a decision written onto it, and NOTHING ELSE CHANGED.
 *
 * `manualValue` is present exactly when the decision is `"manual"`, which is
 * what `src/lib/config/types.ts` declares -- so it is REMOVED rather than left
 * behind on any other decision. A stale `manualValue` under a `tolak` reads to
 * `effectiveValue` as a value the operator typed and would patch it into the
 * workbook they download.
 */
function withDecision<T extends { decision: ConfigDecision; manualValue?: string }>(
  entry: T,
  decision: ConfigDecision,
  manualValue: string | undefined,
): T {
  const next = { ...entry, decision };
  if (decision === "manual") next.manualValue = manualValue;
  else delete next.manualValue;
  return next;
}

/**
 * What the operator may pass with each decision.
 *
 * `manual` WITHOUT A VALUE is the case worth naming: it would store "the
 * operator typed their own value" with nothing in it, and `effectiveValue`
 * would then patch an empty string into a cell EPIC expects filled. A blank is
 * refused rather than silently read as `tolak`, because those are two different
 * statements and only the operator can say which they meant.
 */
function assertDecision(
  what: string,
  decision: ConfigDecision,
  manualValue: string | undefined,
): void {
  const known: ConfigDecision[] = ["belum", "setuju", "tolak", "manual"];
  if (!known.includes(decision)) {
    throw new ConfigEditError(`${what}: "${String(decision)}" is not a decision`);
  }
  if (decision === "manual") {
    if (typeof manualValue !== "string" || manualValue.trim().length === 0) {
      throw new ConfigEditError(
        `${what}: a "manual" decision carries the value the operator typed, ` +
          "and this one is blank. Keeping the workbook's value is `tolak`.",
      );
    }
    return;
  }
  if (manualValue !== undefined) {
    throw new ConfigEditError(
      `${what}: a "${decision}" decision must not carry a manualValue. It ` +
        "would survive on the entry and be patched into the workbook as a " +
        "value the operator never typed.",
    );
  }
}

/**
 * Every byte this order keeps in the `sources` blob store on the two
 * checkpoints' behalf: the workbook, a newer workbook, and each tangkapan
 * layar EPIC.
 *
 * PURE, and exported so `editConfig`/`editEpic` can compare the STORED run's
 * set against the one they are about to write and delete the difference. That
 * mirrors `removeDocument`, which writes the run first and deletes the PDF
 * second: these bytes are re-suppliable input rather than evidence, so a
 * failure after the run write leaves a few megabytes nothing references, and
 * the reverse would leave the run pointing at bytes that are gone.
 *
 * Nothing here is in `BrowserRun.sources`. A workbook is not a berkas of the
 * order: no page of it is rendered, nothing crops it, and listing it there
 * would put it on the film strip and in every search pool.
 */
export function checkpointFileIds(run: BrowserRun): string[] {
  const ids: string[] = [];
  if (run.konfigurasi.workbook) ids.push(run.konfigurasi.workbook.id);
  if (run.epic.workbook) ids.push(run.epic.workbook.id);
  for (const capture of run.epic.captures) ids.push(capture.id);
  return ids;
}

// ---------------------------------------------------------------------------
// Checkpoint 2
// ---------------------------------------------------------------------------

/**
 * The operator handed a workbook over and it was interpreted.
 *
 * THIS DISCARDS DECISIONS, AND SAYING SO IS THE POINT. Every ruling this order
 * holds was made about the cells of the workbook that is being replaced, so
 * they genuinely do not survive it -- a `setuju` on "Alamat Baru" in the old
 * sheet is not a `setuju` on whatever stands at that name in the new one. The
 * opt-in `decided` computes is what carries that intention past
 * `DecisionLossError`, and the screen owes the operator the sentence before it
 * calls: this is a loss a person takes with their eyes open.
 *
 * ## THE SAME WORKBOOK AGAIN IS A NO-OP, NOT A RESET
 *
 * Identity when the incoming workbook has the same digest AND the same sheet as
 * the one already held. The digest is the bytes (`intake.ts`'s rule, for
 * `intake.ts`'s reason: a renamed copy out of a downloads folder is the same
 * workbook and a name check cannot see it), so re-handing over the file the
 * order already has must not cost the operator eleven decisions. Re-reading the
 * same bytes buys a re-interpretation and nothing else, and the way to fold a
 * fresh reading in WITHOUT losing rulings is `record-comparison`, which exists
 * for exactly that.
 *
 * ## `researched` IS CARRIED ACROSS, NEVER RESET
 *
 * The budget the client named is per ORDER -- *"max sekali aja biar ga boros
 * token"* -- not per workbook. Resetting it here would make "hand the same file
 * over again" the way to buy a second re-search, which is a budget with a
 * bypass. `DecisionLossError` guards the same fact from the other side.
 */
export function attachWorkbook(
  run: BrowserRun,
  workbook: ConfigWorkbook,
  entries: readonly ConfigEntry[],
): ConfigEditResult {
  if (!workbook?.id || !workbook.digest || !workbook.sheet) {
    throw new ConfigEditError(
      "attach-workbook: a workbook needs an id (its key in the sources blob " +
        "store), a digest (its bytes) and the sheet its fields were read from",
    );
  }
  assertConfigEntries(entries, "attach-workbook");

  const held = run.konfigurasi.workbook;
  if (held && held.digest === workbook.digest && held.sheet === workbook.sheet) {
    return unchanged(run);
  }

  return decided(run, {
    ...run,
    konfigurasi: {
      workbook,
      entries: [...entries],
      researched: run.konfigurasi.researched,
    },
  });
}

/**
 * A comparison against the scans, folded in, KEEPING EVERY DECISION ALREADY
 * MADE on a field that survives.
 *
 * THE FOLD IS THE WHOLE FUNCTION. A re-search is offered once per order and the
 * operator may well have ruled on ten rows before spending it; a plain replace
 * would wipe those ten and put them back on the amber list, so the tool would
 * appear to forget work in the one gesture whose entire purpose is to add to
 * it. Matched by `ConfigField.id`, which is stable within one order because it
 * is minted when the workbook is interpreted and nothing re-mints it.
 *
 * THE MODEL'S HALF IS OVERWRITTEN, THE PERSON'S HALF IS KEPT, which is the same
 * line `discardedDecisions` draws: `verdict`, `documentValue`, `citation` and
 * `reason` are what was just paid for and they replace what was there;
 * `decision` and `manualValue` are the operator's and they survive.
 *
 * A FIELD THE NEW READING DOES NOT MENTION IS DROPPED, and if it carried a
 * ruling that is a real loss -- named in the opt-in rather than performed in
 * silence. It happens when a replacement reading interprets the sheet
 * differently, which is a thing the operator should be told about.
 */
export function recordComparison(
  run: BrowserRun,
  entries: readonly ConfigEntry[],
): ConfigEditResult {
  if (!run.konfigurasi.workbook) {
    throw new ConfigEditError(
      "record-comparison: this order holds no workbook, so there is nothing " +
        "these verdicts are about. Attach one first.",
    );
  }
  assertConfigEntries(entries, "record-comparison");

  const held = new Map(
    run.konfigurasi.entries.map((entry) => [configEntryId(entry), entry]),
  );
  const folded = entries.map((entry) => {
    const before = held.get(configEntryId(entry));
    if (!before || before.decision === "belum") return entry;
    return withDecision(entry, before.decision, before.manualValue);
  });

  if (sameData(folded, run.konfigurasi.entries)) return unchanged(run);

  return decided(run, {
    ...run,
    konfigurasi: { ...run.konfigurasi, entries: folded },
  });
}

/**
 * Terima, Tolak, or Ketik sendiri on one isian.
 *
 * `entryId` is `configEntryId(entry)` and never the bare `ConfigField.id`. One
 * string addresses one row here, in the opt-in that protects it, and in the
 * refusal that names it; a second spelling would be a second rule, and the two
 * would agree on every id anybody tested.
 */
export function decideConfig(
  run: BrowserRun,
  entryId: string,
  decision: ConfigDecision,
  manualValue?: string,
): ConfigEditResult {
  assertDecision(`decide ${entryId}`, decision, manualValue);

  const at = run.konfigurasi.entries.findIndex(
    (entry) => configEntryId(entry) === entryId,
  );
  if (at === -1) {
    throw new ConfigEditError(
      `decide: this order holds no isian with id "${entryId}". A replacement ` +
        "workbook re-mints every field id, so a decision composed against the " +
        "previous one addresses nothing; re-read the order.",
    );
  }

  const before = run.konfigurasi.entries[at];
  const next = withDecision(before, decision, manualValue);
  // The same press twice -- a double click, two tabs -- writes nothing, so it
  // cannot cost the screen its revision.
  if (sameData(next, before)) return unchanged(run);

  const entries = [...run.konfigurasi.entries];
  entries[at] = next;
  return decided(run, {
    ...run,
    konfigurasi: { ...run.konfigurasi, entries },
  });
}

/**
 * The one re-search this order is allowed, marked spent.
 *
 * WRITTEN BEFORE THE SEARCH, NOT AFTER IT, by whoever calls this: the budget is
 * about tokens, and a search that ran and then failed to record itself is a
 * search the operator can buy again. It is stored on the order rather than kept
 * in component state for the reason the type gives -- component state is lost
 * on reload, and a budget that resets when the operator refreshes the tab is
 * not a budget.
 *
 * ONE-WAY. There is no `markUnresearched`, and `discardedDecisions` refuses a
 * write that turns it back to false without saying so, because a spent budget
 * silently coming back is the same failure as a decision silently going.
 */
export function markResearched(run: BrowserRun): ConfigEditResult {
  if (run.konfigurasi.researched) return unchanged(run);
  return decided(run, {
    ...run,
    konfigurasi: { ...run.konfigurasi, researched: true },
  });
}

// ---------------------------------------------------------------------------
// Checkpoint 3
// ---------------------------------------------------------------------------

/**
 * The operator's answer to "has the workbook been updated again since
 * Checkpoint 2", and the newer workbook if there is one.
 *
 * ## THE ANSWER IS STORED BECAUSE THE SILENT DEFAULT IS THE FAILURE
 *
 * `basis: "belum"` is not a third option the operator picks; it is the state
 * before they have been asked. An order that quietly assumed `"lanjutkan"`
 * would judge EPIC against a workbook the operator had already replaced, and
 * every verdict on the summary list would be confidently wrong with nothing on
 * screen contradicting it.
 *
 * ## CHANGING THE YARDSTICK CLEARS THE VERDICTS
 *
 * Every entry was judged against the basis that stood when it was computed, so
 * a change of basis makes them statements about a different workbook. They are
 * dropped rather than carried, and the rulings on them go too -- named in the
 * opt-in, because that is exactly the loss a person is choosing when they say
 * "yes, here is a newer one". Carrying them would be worse than losing them: a
 * `setuju` on "EPIC shows X where the sheet says Y" is meaningless once Y comes
 * from a different sheet.
 *
 * THE CAPTURES SURVIVE. A tangkapan layar EPIC is a picture of EPIC, and which
 * workbook it is being compared against does not change what it shows.
 */
export function setEpicBasis(
  run: BrowserRun,
  basis: EpicBasis,
  workbook?: ConfigWorkbook,
  fields?: readonly ConfigField[],
): ConfigEditResult {
  if (basis !== "belum" && basis !== "lanjutkan" && basis !== "baru") {
    throw new ConfigEditError(`set-basis: "${String(basis)}" is not a basis`);
  }
  if (basis === "baru") {
    if (!workbook?.id || !workbook.digest || !workbook.sheet) {
      throw new ConfigEditError(
        'set-basis "baru": the operator said there is a newer workbook, so ' +
          "one has to be supplied. Without it Checkpoint 3 has no yardstick " +
          "at all, and the state that means that is `belum`.",
      );
    }
  } else if (workbook !== undefined || fields !== undefined) {
    throw new ConfigEditError(
      `set-basis "${basis}": a workbook belongs to "baru" alone. Under ` +
        '"lanjutkan" the fields come from Checkpoint 2 with every accepted ' +
        "edit applied (`effectiveFields`), and storing a second copy here " +
        "would give the order two answers that can disagree.",
    );
  }

  const held = run.epic;
  const sameWorkbook =
    basis === "baru"
      ? held.workbook?.digest === workbook?.digest &&
        held.workbook?.sheet === workbook?.sheet
      : held.workbook === undefined;
  if (held.basis === basis && sameWorkbook) return unchanged(run);

  return decided(run, {
    ...run,
    epic: {
      basis,
      // Absent, not `undefined`, so a stored record cannot carry a key whose
      // presence contradicts `basis`. The type says the workbook is present
      // exactly when the basis is "baru".
      ...(basis === "baru" && workbook ? { workbook } : {}),
      fields: basis === "baru" ? [...(fields ?? [])] : [],
      captures: held.captures,
      entries: [],
    },
  });
}

/**
 * One more tangkapan layar EPIC, already rendered and recognised.
 *
 * REFUSES A SECOND COPY BY CONTENT, on the same rule and for the same reason a
 * berkas is refused: the operator screenshots EPIC several times, saves them
 * into one folder, and hands the folder over. Two copies of one screen give the
 * comparison two identical candidates for every value, and removing the
 * duplicate afterwards takes the citation an operator was reading with it.
 * `digest` is the bytes; a name check cannot see a renamed copy.
 *
 * THE SAME CAPTURE ID AGAIN IS A NO-OP RATHER THAN A REFUSAL, because that is
 * what two tabs and a double-press produce, and neither is a mistake worth
 * stopping the operator over.
 *
 * THE ENTRIES ARE LEFT ALONE. A new capture may well hold the value a field was
 * `tidak-ditemukan` for, but clearing the verdicts here would discard every
 * ruling on every screenshot added -- so the operator runs the comparison
 * again, and `record-comparison` folds the fresh answers in while keeping what
 * they already settled.
 */
export function addEpicCapture(
  run: BrowserRun,
  capture: EpicCapture,
): ConfigEditResult {
  if (!capture?.id || !capture.digest) {
    throw new ConfigEditError(
      "add-capture: a tangkapan layar needs an id (its key in the sources " +
        "blob store) and a digest (its bytes)",
    );
  }

  const captures = run.epic.captures;
  if (captures.some((held) => held.id === capture.id)) return unchanged(run);

  const twin = captures.find((held) => held.digest === capture.digest);
  if (twin) {
    throw new ConfigEditError(
      `add-capture: this order already holds "${twin.name}", which is the ` +
        "same image byte for byte. A second copy gives the comparison two " +
        "identical candidates for every value and takes a citation with it " +
        "when it is removed.",
    );
  }

  return decided(run, {
    ...run,
    epic: { ...run.epic, captures: [...captures, capture] },
  });
}

/**
 * One tangkapan layar taken back out.
 *
 * EVERY FINDING READ OFF IT IS RESET, NOT REPOINTED, and that is the same
 * choice `removeSource` makes about a zone found inside a removed document.
 * `EpicCitation.captureId` names this capture; leaving the entry behind would
 * leave a verdict, a value and a "lihat" that point at a picture the order no
 * longer has, and a ruling on that verdict would be a decision about nothing.
 * So those entries go back to `belum-diperiksa` with their `epicValue`,
 * `citation` and `reason` dropped -- and the decisions on them go with them,
 * named in the opt-in rather than performed in silence.
 *
 * A finding read off a DIFFERENT capture is untouched, decision included:
 * nothing about it changed.
 *
 * REMOVING ONE THIS ORDER DOES NOT HOLD CHANGES NOTHING. Two tabs removing the
 * same capture should not make the second an error.
 */
export function removeEpicCapture(
  run: BrowserRun,
  captureId: string,
): ConfigEditResult {
  const captures = run.epic.captures.filter(
    (capture) => capture.id !== captureId,
  );
  if (captures.length === run.epic.captures.length) return unchanged(run);

  const entries = run.epic.entries.map((entry) => {
    if (entry.citation?.captureId !== captureId) return entry;
    return {
      fieldId: entry.fieldId,
      label: entry.label,
      excelValue: entry.excelValue,
      // Rebuilt field by field rather than by deleting keys off a spread, so
      // that a field added to `EpicEntry` later fails to compile here instead
      // of surviving a reset it was never considered for. Same discipline as
      // `metaOf` and `toStoredPage`, and for the same reason.
      verdict: "belum-diperiksa" as const,
      decision: "belum" as const,
    } satisfies EpicEntry;
  });

  return decided(run, { ...run, epic: { ...run.epic, captures, entries } });
}

/**
 * A comparison against EPIC, folded in, KEEPING EVERY DECISION ALREADY MADE.
 *
 * The same rule and the same reason as `recordComparison` one checkpoint down.
 * MATCHED BY `fieldId` WHEN THERE IS ONE AND BY `label` WHEN THERE IS NOT --
 * see `epicEntryId` -- because a `tidak-ada-di-excel` finding has no field to
 * point at, which is the whole content of the finding.
 */
export function recordEpicComparison(
  run: BrowserRun,
  entries: readonly EpicEntry[],
): ConfigEditResult {
  if (run.epic.basis === "belum") {
    throw new ConfigEditError(
      "record-comparison: this order has not been asked which workbook EPIC " +
        "is judged against, so these verdicts are about nothing. Set the " +
        "basis first.",
    );
  }
  assertEpicEntries(entries, "record-comparison");

  const held = new Map(
    run.epic.entries.map((entry) => [epicEntryId(entry), entry]),
  );
  const folded = entries.map((entry) => {
    const before = held.get(epicEntryId(entry));
    if (!before || before.decision === "belum") return entry;
    return withDecision(entry, before.decision, before.manualValue);
  });

  if (sameData(folded, run.epic.entries)) return unchanged(run);

  return decided(run, { ...run, epic: { ...run.epic, entries: folded } });
}

/**
 * Terima, Tolak, or Ketik sendiri on one EPIC finding.
 *
 * `entryId` is `epicEntryId(entry)`. See that function for what it is made of
 * and for the one case it cannot separate: two `tidak-ada-di-excel` findings
 * carrying the same label.
 */
export function decideEpic(
  run: BrowserRun,
  entryId: string,
  decision: ConfigDecision,
  manualValue?: string,
): ConfigEditResult {
  assertDecision(`decide ${entryId}`, decision, manualValue);

  const at = run.epic.entries.findIndex(
    (entry) => epicEntryId(entry) === entryId,
  );
  if (at === -1) {
    throw new ConfigEditError(
      `decide: this order holds no EPIC finding with id "${entryId}". A ` +
        "change of basis clears every finding, so a decision composed before " +
        "one addresses nothing; re-read the order.",
    );
  }

  const before = run.epic.entries[at];
  const next = withDecision(before, decision, manualValue);
  if (sameData(next, before)) return unchanged(run);

  const entries = [...run.epic.entries];
  entries[at] = next;
  return decided(run, { ...run, epic: { ...run.epic, entries } });
}
