/**
 * KONFIG EXCEL AND INPUT EPIC, as data.
 *
 * These are the shapes an order carries once the operator hands over the EPIC
 * order-configuration workbook and, later, their screen captures of EPIC
 * itself. They live one hop below `src/lib/browser/types.ts` for the same
 * reason `overlay.ts` does: storage has to persist them without importing the
 * runtime that imports storage.
 *
 * ## Excel came back, and it came back as a DIFFERENT THING
 *
 * AGENTS.md recorded, on 2026-09-09, that this program must never generate,
 * write, offer or read a spreadsheet. That decision was about a DELIVERABLE:
 * the tool used to author `<ID EPIC>_ORDER_Config.xlsx` from nothing, and the
 * client confirmed the workbook was a miscommunication. The client's
 * instruction of 2026-09-09 (later the same day) reverses the scope, not the
 * reasoning: the workbook is now an operator-supplied INPUT that the tool
 * checks against the scans, and the thing offered back is THAT WORKBOOK with
 * named cells amended. The tool still never authors one.
 *
 * The consequences of that distinction are load-bearing and are enforced in
 * code rather than remembered:
 *
 *  - **No spreadsheet library.** `exceljs` and `xlsx` (SheetJS) both stay out,
 *    the second for the reason AGENTS.md gives independently: frozen at 0.18.5
 *    with two unpatched HIGH advisories served only from the vendor's own CDN.
 *    `src/lib/xlsx/` reads and patches OOXML directly over `jszip`, which the
 *    lockfile already pinned for `docx`.
 *  - **The workbook is never rebuilt, only patched.** `src/lib/xlsx/write.ts`
 *    edits the cells named here inside the operator's own bytes and leaves
 *    every other part of the archive alone. A regenerated workbook would drop
 *    the formatting, the data validations and the print settings that EPIC's
 *    own template carries, and it would do so in a file that opens cleanly.
 *
 * ## The model never invents a cell
 *
 * This is `locate.ts`'s rule wearing different clothes. There, the model is
 * shown OCR lines and answers with a LINE RANGE, never a pixel box. Here it is
 * shown the workbook's real cells, each with its real address, and answers
 * with a CELL ADDRESS, never a value pulled out of the air. Every address that
 * comes back is checked against the grid before it is trusted -- an address
 * the sheet does not have, or a label whose text is not the text standing at
 * that address, is dropped with a reason rather than shown to an operator.
 *
 * That is what makes "STRUKTUR EXCEL RANDOM" tractable. Three real client
 * workbooks, read on 2026-09-09, are laid out three different ways: one is
 * labels down column C with values in column E, one is headers across row 2
 * with a data row per service, and one is transposed -- the field names run
 * ACROSS columns E to AN with `Nomor`/`Item I`/`Item II`/`Keterangan` as ROW
 * labels down column B. Nothing here hard-codes any of them, and nothing
 * should: the layout is the model's job and the addresses are the check on it.
 */

import type { Line } from "../pipeline/geometry.ts";

/**
 * An A1-style cell address, sheet-relative: `"E9"`, `"AH5"`.
 *
 * A bare string rather than a branded type because it crosses the wire, is
 * stored, and is compared by value everywhere. `parseRef` in
 * `src/lib/xlsx/grid.ts` is the one thing that turns it into coordinates, and
 * it refuses anything this shape does not describe.
 */
export type CellRef = string;

/**
 * One field of the workbook: a name, and the cell that holds its value.
 *
 * READ, NEVER INVENTED. `label` is the text standing at `labelRef`, and
 * `assertInterpreted` in `src/lib/pipeline/config-interpret.ts` drops any
 * field whose label is not a substring of the cell it cites -- the same rule
 * `src/lib/pipeline/sections.ts` applies to a judul title, and for the same
 * reason: a fabricated field name in a document a validator signs is a failure
 * nothing downstream can catch.
 */
export type ConfigField = {
  /** Stable within one order, minted when the workbook is first interpreted. */
  id: string;
  /** The sheet the two addresses below belong to. */
  sheet: string;
  /** What the workbook calls this field, read out of `labelRef`. */
  label: string;
  /** Where `label` was read. Checked against the grid before it is trusted. */
  labelRef: CellRef;
  /** The cell holding this field's value, empty cell included. */
  valueRef: CellRef;
  /**
   * What the workbook says today, as the grid renders it -- a date serial
   * already turned into a date, a number already formatted. `""` for a cell
   * that is empty or absent, which is a real state and not a missing field:
   * an empty cell EPIC expects filled is exactly what Konfig Excel is for.
   */
  excelValue: string;
  /**
   * WHICH ROW OF A MULTI-ROW WORKBOOK THIS BELONGS TO, when there is one.
   *
   * Two of the three real workbooks carry one row per SERVICE -- two SIDs, the
   * same twenty field names against each. Without this the operator would meet
   * `Alamat Baru` twice with no way to tell which service each belonged to,
   * and a decision on one would read as a decision on the other. It is the
   * model's own words for the row (an SID, a location name), never an index.
   */
  group?: string;
};

/**
 * WHERE IN THE SCANS A VALUE WAS READ.
 *
 * `pageIndex` is a position in `BrowserRun.pages`, exactly as `Zone.pageIndex`
 * is, so the same rule applies: the array is append-only because this number
 * is a position in it.
 *
 * A CITATION IS NOT PROOF THE VALUE IS RIGHT, and this project has the scar:
 * `namaProyek`'s recorded failure was a citation that PASSED validation beside
 * a wrong value. It is what lets the operator check in one click, which is a
 * better instrument than a warning.
 */
export type ConfigCitation = {
  pageIndex: number;
  /** Inclusive line indexes into that page's `lines`. */
  from: number;
  to: number;
  /** The cited lines' own text, so the operator judges without navigating. */
  text: string;
};

/**
 * WHAT THE SCANS SAY ABOUT ONE FIELD.
 *
 * Three answers and a starting state, deliberately no more. The distinction
 * that matters is the one this codebase already draws between `outstanding`
 * and `outOfScope`: `tidak-ditemukan` means SEARCHED AND NOT FOUND, and it is
 * the only verdict the re-search is offered for.
 */
export type ConfigVerdict =
  /** Nothing has compared this field yet. Never rendered as a result. */
  | "belum-diperiksa"
  /** The scans agree with the workbook. Nothing is owed. */
  | "cocok"
  /**
   * The scans say something else, or the workbook cell is empty and the scans
   * supply a value. One verdict for both because the operator's move is the
   * same in each: take the recommendation, keep what is there, or type their
   * own. `excelValue === ""` is what separates them on screen.
   */
  | "beda"
  /** Every searchable page was read and this field is not in them. */
  | "tidak-ditemukan";

/**
 * WHAT THE OPERATOR DECIDED ABOUT ONE RECOMMENDATION.
 *
 * `setuju` and `tolak` are a pair and neither is a default: a field nobody has
 * ruled on stays `belum`, and `belum` is what the amber mark counts. Silence
 * is never read as consent, for the same reason a proposed zone is never
 * exported unconfirmed.
 */
export type ConfigDecision =
  /** No decision yet. A decision is owed here. */
  | "belum"
  /** Take the recommendation: write the scans' value into the cell. */
  | "setuju"
  /** Keep what the workbook already says. The cell is left alone. */
  | "tolak"
  /** The operator typed a value of their own; it is in `manualValue`. */
  | "manual";

/** One field of the workbook, with what the scans said and what was decided. */
export type ConfigEntry = {
  field: ConfigField;
  verdict: ConfigVerdict;
  /** What the scans say. Present exactly when `verdict === "beda"`. */
  documentValue?: string;
  /** Where that was read. Absent when the model cited a range that failed validation. */
  citation?: ConfigCitation;
  /** Why nothing was found, in the operator's language. `tidak-ditemukan` only. */
  reason?: string;
  decision: ConfigDecision;
  /** What the operator typed. Present exactly when `decision === "manual"`. */
  manualValue?: string;
};

/**
 * The workbook itself: enough to name it, patch it and refuse a second copy.
 *
 * `id` keys the bytes in the `sources` object store, which is keyed by `runId`
 * as well -- so `deleteRun` sweeps a workbook away with the order it belongs
 * to and no separate cleanup exists to be forgotten. The workbook is NOT added
 * to `BrowserRun.sources`: it is not a berkas of the order, no page of it is
 * rendered, and nothing crops it.
 */
export type ConfigWorkbook = {
  /** Its key in the `sources` blob store. */
  id: string;
  name: string;
  /**
   * `sha256` of the bytes. THE SAME IDENTITY RULE BERKAS USE: a renamed copy
   * out of a downloads folder is the same workbook and a name check cannot see
   * it. See `src/lib/browser/intake.ts`.
   */
  digest: string;
  /** Sheet names in workbook order, so a screen can say which one was read. */
  sheets: string[];
  /** Which of them the fields were interpreted out of. */
  sheet: string;
  /**
   * THE ISIAN THIS WORKBOOK'S READING REFUSED, BY NAME.
   *
   * A row `config-interpret.ts` refuses never becomes a `ConfigEntry`, so it is
   * in no stored array and the register cannot show it. Kept only in component
   * state, it survived until the operator reloaded the tab and then the screen
   * read as full coverage of a workbook part of which was never compared --
   * this project's failure class with a spreadsheet on top of it. Found by
   * review.
   *
   * IT LIVES ON THE WORKBOOK RECORD RATHER THAN BESIDE `entries` because that
   * is what scopes it: this record names one digest and one sheet, so the list
   * cannot outlive the reading that produced it or attach itself to a
   * replacement workbook. `attachWorkbook` builds a fresh record per workbook
   * and `recordComparison` keeps the stored one, which is exactly the rule this
   * list needs -- a re-search does not re-read the sheet and must not blank it.
   *
   * NAMES ONLY, AND THAT IS A SIZE DECISION. `ConfigCheck` rides in the run's
   * SMALL half, which `listRunMeta` reads for every order on the device, so
   * what is stored is the shortest thing that answers the operator's question
   * ("which of my isian were not looked at?"). The model's English reasons and
   * its note about the sheet are diagnoses for a deployer, they are the long
   * half, and they stay session-only behind `Detail teknis`.
   *
   * Absent means a reading that predates this field; empty means one that
   * refused nothing. Both render the same, which is nothing.
   */
  unusable?: string[];
};

/** Konfig Excel's whole state, as one order carries it. */
export type ConfigCheck = {
  /** Absent until the operator hands a workbook over. */
  workbook?: ConfigWorkbook;
  entries: ConfigEntry[];
  /**
   * WHETHER THE ONE RE-SEARCH HAS BEEN SPENT.
   *
   * The client's instruction names the budget: *"Bisa coba ulang cari field
   * yang ga ketemu (max sekali aja biar ga boros token)"*. It is stored on the
   * order rather than kept in component state for the reason `hasBeenSearched`
   * is derived rather than kept: component state is lost on reload, and a
   * budget that resets when the operator refreshes the tab is not a budget.
   */
  researched: boolean;
};

/** An order that has not reached Konfig Excel yet. Never `undefined`. */
export function emptyConfigCheck(): ConfigCheck {
  return { entries: [], researched: false };
}

/**
 * One screen capture of EPIC.
 *
 * IT IS NOT A HALAMAN OF THE ORDER, and that is a decision rather than an
 * omission. A `StoredPage` is rendered from a PDF on demand by
 * `renderBitmap`, is cropped, is drawn as a denah and is cited in the
 * deliverable; every one of those is PDF-shaped, and an image in that array
 * would need a branch in each. A capture here is read for its TEXT and nothing
 * else, so it goes through `/api/ocr` -- which already takes raw PNG bytes --
 * and stops there.
 */
export type EpicCapture = {
  /** Its key in the `sources` blob store, so the bytes survive a reload. */
  id: string;
  name: string;
  /** `sha256` of the bytes: the same duplicate rule, for the same reason. */
  digest: string;
  width: number;
  height: number;
  /** What the recogniser read, numbered exactly as a page's lines are. */
  lines: Line[];
};

/** Where in a capture a value was read. */
export type EpicCitation = {
  /** `EpicCapture.id`, not an index: captures can be removed one at a time. */
  captureId: string;
  from: number;
  to: number;
  text: string;
};

/**
 * WHAT EPIC SHOWS FOR ONE FIELD, judged against the workbook.
 *
 * THE YARDSTICK HAS SWAPPED, and reading this as Konfig Excel's verdict is the
 * mistake to avoid. There the scans judged the workbook; here the workbook
 * judges EPIC. So `beda` means the screen and the sheet disagree, and the
 * fourth value has no analogue in Konfig Excel at all.
 */
export type EpicVerdict =
  | "belum-diperiksa"
  /** EPIC shows what the workbook says. */
  | "cocok"
  /** EPIC shows something else. */
  | "beda"
  /** Every capture was read and this field is not on any of them. */
  | "tidak-ditemukan"
  /**
   * EPIC SHOWS SOMETHING THE WORKBOOK HAS NO FIELD FOR.
   *
   * The client asked for this by name: *"Dikasihtau juga kalo ada yang gak
   * ketemu di excel"*. It is the only entry whose `fieldId` is absent, because
   * there is no field to point at -- which is the whole content of the finding.
   */
  | "tidak-ada-di-excel";

export type EpicEntry = {
  /** The `ConfigField.id` judged. Absent only for `tidak-ada-di-excel`. */
  fieldId?: string;
  /** The field's name, or EPIC's own label when the workbook has no field. */
  label: string;
  /** What the workbook says. `""` when there is no field for it. */
  excelValue: string;
  verdict: EpicVerdict;
  /** What EPIC shows. Absent for `tidak-ditemukan`. */
  epicValue?: string;
  citation?: EpicCitation;
  reason?: string;
  decision: ConfigDecision;
  manualValue?: string;
};

/**
 * WHICH WORKBOOK INPUT EPIC IS JUDGING AGAINST.
 *
 * The client's instruction is a question the operator answers: *"Tanya excel
 * config-nya ada update lagi gak sejak output dari step 4? Kalo ada, bisa
 * di-upload yang terbaru. Kalo enggak, berarti langsung pake excel output dari
 * step 4 aja tanpa upload."*
 *
 * `belum` is not a third option the operator picks; it is the state before
 * they have been asked, and Input EPIC cannot compare anything while it
 * stands. Making it explicit rather than inferring it from `workbook` being
 * absent is what stops a silent default: an order that quietly assumed
 * "lanjutkan" would judge EPIC against a workbook the operator had already
 * replaced, and every verdict would be confidently wrong.
 */
export type EpicBasis =
  /** The question has not been put yet. */
  | "belum"
  /** No newer workbook exists: judge against Konfig Excel's own output. */
  | "lanjutkan"
  /** The operator handed over a newer workbook; it is in `workbook`. */
  | "baru";

/** Input EPIC's whole state. */
export type EpicCheck = {
  basis: EpicBasis;
  /**
   * The newer workbook, present exactly when `basis === "baru"`.
   *
   * When `basis === "lanjutkan"` the fields come from `ConfigCheck` with every
   * accepted edit applied, which is what "pake excel output dari step 4" means
   * and is computed by `effectiveFields` in `src/lib/config/effective.ts`
   * rather than stored twice.
   */
  workbook?: ConfigWorkbook;
  /** The fields `basis: "baru"` was interpreted into. Empty for `lanjutkan`. */
  fields: ConfigField[];
  captures: EpicCapture[];
  entries: EpicEntry[];
};

/** An order that has not reached Input EPIC yet. Never `undefined`. */
export function emptyEpicCheck(): EpicCheck {
  return { basis: "belum", fields: [], captures: [], entries: [] };
}

/**
 * TWO SPELLINGS OF ONE FORM LABEL, REDUCED TO ONE KEY.
 *
 * `"Nama Pelanggan :"`, `"NAMA PELANGGAN"` and `"nama  pelanggan"` are one
 * name, and this is the only place that says so.
 *
 * ## Why a `tidak-ada-di-excel` finding needs it
 *
 * That entry has no `ConfigField.id` to be addressed by -- the absence of a
 * field is the whole content of the finding -- so `epicEntryId` in
 * `src/lib/storage/runs.ts` keys it on the LABEL. And the label is not a
 * chosen value: `buildEpicPrompt` asks the model to transcribe EPIC's own
 * label off the screen capture, free-form. So the operator's ruling on such a
 * finding was keyed on raw transcription, and the second comparison -- which
 * an operator runs by design, because adding a capture deliberately leaves the
 * entries alone so the fresh answers can be folded in beside decisions already
 * made -- could read the same label back as `"Nama Pelanggan:"` and lose the
 * ruling. Not refused, either: `discardedDecisions` cannot see a loss it
 * cannot name, and under the new spelling it is a new entry rather than a
 * missing one.
 *
 * ## What it does NOT do
 *
 * It does not merge two DIFFERENT labels. `sameEntity` in
 * `src/lib/pipeline/abbrev.ts` is the module for deciding whether two
 * spellings denote one thing, and its own scars record how expensive an
 * over-eager rule is there. This is deliberately narrower than any of that:
 * case, runs of whitespace, and the punctuation a form label wears at its
 * ends. Nothing here looks inside the words.
 */
export function labelKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s:;.,\-*()[\]]+|[\s:;.,\-*()[\]]+$/g, "")
    .trim();
}
