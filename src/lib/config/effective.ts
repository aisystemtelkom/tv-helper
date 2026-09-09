/**
 * DECISIONS TURNED INTO CELLS, and into the sheet Checkpoint 3 is judged
 * against. No model, no network, no React: arithmetic over one order's
 * `ConfigCheck`, and nothing else.
 *
 * ## ONE RULE FEEDS BOTH CONSUMERS, ON PURPOSE
 *
 * Two things downstream need to know what a field is worth once the operator
 * has ruled on it. `pendingEdits` produces the cells `patchWorkbook` writes
 * into the operator's own bytes, and `effectiveFields` produces the field list
 * Checkpoint 3 measures EPIC against when the operator answers `lanjutkan`
 * (`EpicBasis` in `types.ts`: no newer workbook exists, so judge against
 * Checkpoint 2's own output). Both are `effectiveValue` applied entry by entry.
 *
 * A SECOND ANSWER TO "what does this field say now" IS THE FAILURE THIS MODULE
 * IS SHAPED TO PREVENT, and it would be a quiet one: the download would carry
 * one value, Checkpoint 3 would judge EPIC against another, and every verdict
 * on that field would be confidently wrong about a workbook the operator has
 * open in front of them. Nothing crashes, nothing is missing, and a human signs
 * it. So the rule is written once, and the summaries count this function's
 * output rather than re-deriving the same decision tree a fourth time.
 *
 * ## AN UNDECIDED FIELD IS NEVER WRITTEN
 *
 * `belum` keeps the workbook's value, exactly as `tolak` does. Nothing else in
 * this repo exports an unconfirmed proposal -- a proposed zone must be accepted
 * by a person before it can reach the docx, and `overlay.proposed` is
 * structurally unable to reach the exporter at all -- and a spreadsheet cell is
 * not the place to start. Silence is not consent.
 */

import type { CellEdit } from "../xlsx/write.ts";
import type {
  ConfigCheck,
  ConfigEntry,
  ConfigField,
  EpicCheck,
} from "./types.ts";

/**
 * What this field's value is once the operator's decision is applied.
 *
 * Four decisions, four rules, and the two that keep `excelValue` are one rule
 * seen from two sides: the operator said no, or the operator has not said
 * anything yet.
 *
 *  - `setuju` takes `documentValue`. The whole content of the decision is
 *    "write what the scans say".
 *  - `tolak` keeps `excelValue`. Always. The cell is left alone.
 *  - `manual` takes `manualValue`, THE EMPTY STRING INCLUDED. Clearing a cell
 *    the workbook filled is a real instruction and a reachable one: EPIC's
 *    template carries fields a particular order does not use, and `""` is how
 *    an operator says so.
 *  - `belum` keeps `excelValue`. See the module header.
 *
 * A `setuju` CARRYING NO RECOMMENDATION IS A BUG UPSTREAM, not a state to
 * design around. `documentValue` is present exactly when `verdict === "beda"`
 * (`types.ts`), so the only ways to arrive here are a screen that offered
 * Terima on an entry with nothing to take, or an order stored under an older
 * shape. It resolves to `excelValue` because that is the direction that writes
 * NOTHING, rather than the one that writes `""` over a filled cell: a decision
 * that means nothing must not be able to empty a cell in a workbook the
 * operator hands to EPIC.
 */
export function effectiveValue(entry: ConfigEntry): string {
  switch (entry.decision) {
    case "setuju":
      return entry.documentValue ?? entry.field.excelValue;
    case "manual":
      return entry.manualValue ?? "";
    case "tolak":
    case "belum":
      return entry.field.excelValue;
    default:
      // Unreachable while `ConfigDecision` is the closed union it is today.
      // A stored order written by a future shape lands here, and it keeps the
      // workbook's value: an unrecognised decision is not consent either.
      return entry.field.excelValue;
  }
}

/**
 * The cells the download must write. Only fields whose decision changes one.
 *
 * A DECISION THAT AGREES WITH THE WORKBOOK WRITES NOTHING, and that is not
 * tidiness. `patchWorkbook` replaces a cell with an inline string and strips
 * any `<f>` it carried, because a formula left in place makes Excel recompute
 * over the value we just wrote. So rewriting a cell to the text it already
 * holds is a DESTRUCTIVE no-op: the cell reads identically afterwards and the
 * formula behind it is gone. The reachable case is an operator opening `Ketik
 * sendiri` and typing back what is already there, and a `setuju` whose
 * recommendation happens to match is the same shape.
 *
 * TWO ENTRIES NAMING ONE CELL ARE NOT COLLAPSED HERE. Interpretation mints one
 * field per label it reads and validates each address on its own, so a pair
 * pointing at one `valueRef` is possible and is a defect somewhere upstream.
 * Silently keeping the last of them is precisely this project's failure class:
 * a workbook that opens cleanly carrying one of two conflicting decisions, with
 * the loser recorded nowhere. Both are emitted instead, and `patchWorkbook`'s
 * post-patch verification refuses the pair loudly when they disagree (it
 * re-reads every edited ref and demands it hold exactly the intended value) and
 * passes when they happen to agree, which is the right answer to both cases.
 */
export function pendingEdits(check: ConfigCheck): CellEdit[] {
  const edits: CellEdit[] = [];
  for (const entry of check.entries) {
    const value = effectiveValue(entry);
    if (value === entry.field.excelValue) continue;
    edits.push({
      sheet: entry.field.sheet,
      ref: entry.field.valueRef,
      value,
    });
  }
  return edits;
}

/**
 * The workbook as it stands after every decision: Checkpoint 3's yardstick.
 *
 * Ids and both addresses ride through untouched. `id` is what an `EpicEntry`
 * points at, and `labelRef`/`valueRef` are what a screen uses to say where in
 * the sheet a value lives; a field is the same field after a decision, so
 * re-minting any of the three would break the link between the two checkpoints
 * for no gain.
 *
 * COMPUTED, NEVER STORED. `EpicCheck.fields` is populated only for
 * `basis: "baru"`, where the operator handed over a newer workbook and it was
 * interpreted afresh; `lanjutkan` reads this instead. Storing it would be
 * storing the same decisions twice, and the copies would part company the
 * moment an operator changed a decision after Checkpoint 3 had begun -- with
 * the stale copy being the one EPIC was judged against, and no screen able to
 * show the difference.
 */
export function effectiveFields(check: ConfigCheck): ConfigField[] {
  return check.entries.map((entry) => ({
    ...entry.field,
    excelValue: effectiveValue(entry),
  }));
}

export type ConfigSummary = {
  total: number;
  cocok: number;
  belumSesuai: number;
  tidakDitemukan: number;
  /**
   * Entries a decision is still owed on. This is what the amber mark counts.
   *
   * `beda` AND `belum`, and nothing else. `--mark` means "a decision is owed
   * here" and nothing else ever, so this counts only the entries where the tool
   * has actually put a recommendation in front of a person.
   *
   * A `tidak-ditemukan` ENTRY IS DELIBERATELY NOT OWED. There is no
   * recommendation to rule on: every searchable page was read and the field is
   * not in them, so the moves available are `Cari sekali lagi` (which
   * `canResearch` counts) and typing a value the operator may not have to hand.
   * Counting it would leave an amber mark standing on every order whose
   * documents simply do not carry a field, permanently, with nothing that
   * clears it -- which is how a mark stops meaning anything, the same argument
   * `hasUnreviewedProposals` makes about not blocking an export on an unchecked
   * capture. It is counted in `tidakDitemukan` instead, so a screen can still
   * say so without claiming a decision is owed.
   *
   * `cocok` owes nothing by definition, and `belum-diperiksa` is not a result
   * at all: it is the state before anything compared this field.
   */
  owed: number;
  /** Fields whose cell the download would change. */
  edits: number;
  /** True when the one re-search is still available AND there is something to spend it on. */
  canResearch: boolean;
};

/**
 * The counts a Checkpoint 2 screen reads, computed in one pass.
 *
 * `edits` is `pendingEdits(check).length` rather than a fifth counter, because
 * "how many cells will the download write" must be the same question the
 * download itself answers. A screen that counted decisions instead would
 * promise an edit for every `setuju` and then hand over a file with fewer, and
 * an operator has no way to see which of the two lied.
 */
export function configSummary(check: ConfigCheck): ConfigSummary {
  let cocok = 0;
  let belumSesuai = 0;
  let tidakDitemukan = 0;
  let owed = 0;

  for (const entry of check.entries) {
    switch (entry.verdict) {
      case "cocok":
        cocok += 1;
        break;
      case "beda":
        belumSesuai += 1;
        if (entry.decision === "belum") owed += 1;
        break;
      case "tidak-ditemukan":
        tidakDitemukan += 1;
        break;
      default:
        break;
    }
  }

  return {
    total: check.entries.length,
    cocok,
    belumSesuai,
    tidakDitemukan,
    owed,
    edits: pendingEdits(check).length,
    // BOTH HALVES ARE REQUIRED. The budget is the client's own: one re-search
    // per order, so that a field the scans do not carry cannot be searched for
    // all afternoon. Offering the key when nothing is `tidak-ditemukan` spends
    // a model call to be told what the run already knows, and spends the order's
    // only retry doing it.
    canResearch: !check.researched && tidakDitemukan > 0,
  };
}

export type EpicSummary = {
  total: number;
  cocok: number;
  belumSesuai: number;
  tidakDitemukan: number;
  tidakAdaDiExcel: number;
  owed: number;
};

/**
 * The same counts for Checkpoint 3, where the yardstick has swapped: there the
 * scans judged the workbook, here the workbook judges EPIC.
 *
 * `owed` KEEPS THE SAME RULE -- `beda` and `belum` -- so the amber mark means
 * one thing across both checkpoints. `tidak-ada-di-excel` is counted and never
 * owed, and that follows from the shape rather than being a policy: an entry
 * with that verdict carries no `fieldId` at all, because there is no field to
 * point at, which `types.ts` records as the whole content of the finding. A
 * decision there could not name a cell to write or a value to keep. It is a
 * finding to read, and it is exactly the finding the client asked for by name.
 *
 * NO `edits` AND NO `canResearch` HERE, and both absences are the contract.
 * The one re-search is Checkpoint 2's budget and lives on `ConfigCheck`, and
 * Checkpoint 3 writes no workbook: the download is Checkpoint 2's output, and
 * what Checkpoint 3 produces is the summary list itself.
 */
export function epicSummary(check: EpicCheck): EpicSummary {
  let cocok = 0;
  let belumSesuai = 0;
  let tidakDitemukan = 0;
  let tidakAdaDiExcel = 0;
  let owed = 0;

  for (const entry of check.entries) {
    switch (entry.verdict) {
      case "cocok":
        cocok += 1;
        break;
      case "beda":
        belumSesuai += 1;
        if (entry.decision === "belum") owed += 1;
        break;
      case "tidak-ditemukan":
        tidakDitemukan += 1;
        break;
      case "tidak-ada-di-excel":
        tidakAdaDiExcel += 1;
        break;
      default:
        break;
    }
  }

  return {
    total: check.entries.length,
    cocok,
    belumSesuai,
    tidakDitemukan,
    tidakAdaDiExcel,
    owed,
  };
}
