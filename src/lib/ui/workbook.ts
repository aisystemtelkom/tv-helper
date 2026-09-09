/**
 * Handing the konfigurasi back, amended.
 *
 * This is the end of Checkpoint 2 and the only place the operator's own bytes
 * are written. Everything it does follows from one sentence: THE TOOL DOES NOT
 * AUTHOR A WORKBOOK, IT AMENDS ONE. So the file that comes back is the file
 * that went in, with the cells the operator approved changed and every other
 * part of the archive untouched -- the formatting, the data validations, the
 * print settings and the styles EPIC's own template carries.
 *
 * Rebuilding instead would lose all of that in a file that opens cleanly,
 * which is this project's failure class wearing a spreadsheet.
 */

import { downloadBytes } from "./crops.ts";
import { pendingEdits } from "../config/effective.ts";
import type { ConfigCheck } from "../config/types.ts";
import { patchWorkbook } from "../xlsx/write.ts";

/** What a downloadable `.xlsx` is called on the wire. */
export const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * `LOP999001_ORDER_Config.xlsx` becomes `LOP999001_ORDER_Config_UPDATED.xlsx`.
 *
 * THE OPERATOR'S OWN NAME IS KEPT, with one suffix. They filed the original
 * under a name their process understands, and a tool that renamed it to
 * something of its own would hand back a file they then have to rename back.
 * The suffix goes before the extension so the file still opens as a workbook
 * by double-click, and a name with no extension at all still gets one.
 */
export function updatedName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}_UPDATED.xlsx`;
  return `${name.slice(0, dot)}_UPDATED${name.slice(dot)}`;
}

/**
 * Why a download cannot happen, in the operator's own language, or null.
 *
 * SEPARATE FROM THE BUILD so the screen can say the sentence BEFORE the
 * operator presses anything, which is what "count, noun, remedy, attached to
 * the control it disables" requires. A build that threw at press time would
 * put the same information behind an action.
 */
export function downloadBlocked(check: ConfigCheck): string | null {
  if (!check.workbook) {
    return "Belum ada berkas konfigurasi untuk order ini.";
  }
  const owed = check.entries.filter((e) => e.decision === "belum").length;
  if (owed > 0) {
    return (
      `${owed} isian masih menunggu keputusan Anda. Tidak ada berkas ` +
      "konfigurasi yang disimpan sebelum setiap isian diputuskan, karena " +
      "nilai yang belum diperiksa di dalam berkas yang dipakai untuk input " +
      "EPIC adalah persis kegagalan yang dicegah langkah ini."
    );
  }
  return null;
}

export type BuiltWorkbook = {
  name: string;
  bytes: Uint8Array;
  /** How many cells this file changes. Zero is a legitimate outcome. */
  changed: number;
};

/**
 * The amended workbook, built from the stored original.
 *
 * `readBytes` is injected rather than imported so `ui.test.mts` can drive this
 * with no IndexedDB; in the app it is `runtime.getCheckpointFile`.
 *
 * A NULL FROM `readBytes` IS A REAL STATE AND IT THROWS IN BAHASA. The bytes
 * live in the browser's own storage, so an operator who cleared site data in
 * another tab genuinely no longer has the file this checkpoint was going to
 * patch. Inventing a workbook from the fields would produce a plausible file
 * that is not theirs and carries none of their formatting; asking for the
 * berkas again is the only honest move.
 *
 * ZERO EDITS IS NOT AN ERROR. A workbook the scans entirely agree with, or one
 * where the operator rejected every recommendation, produces a file identical
 * to the original, and handing it back is correct: refusing would read as the
 * tool having failed. The count is returned so the screen can say so plainly.
 */
export async function buildUpdatedWorkbook(
  check: ConfigCheck,
  readBytes: (id: string) => Promise<{ name: string; bytes: ArrayBuffer } | null>,
): Promise<BuiltWorkbook> {
  const workbook = check.workbook;
  if (!workbook) {
    throw new Error("Belum ada berkas konfigurasi untuk order ini.");
  }

  const stored = await readBytes(workbook.id);
  if (!stored) {
    throw new Error(
      `Berkas konfigurasi "${workbook.name}" sudah tidak ada di perangkat ini, ` +
        "jadi tidak bisa diperbarui. Muat berkasnya sekali lagi di Checkpoint 2.",
    );
  }

  const edits = pendingEdits(check);
  const bytes = await patchWorkbook(new Uint8Array(stored.bytes), edits);
  return { name: updatedName(stored.name), bytes, changed: edits.length };
}

/** Build it and hand it over. The screen keeps the count for its own copy. */
export async function saveUpdatedWorkbook(
  check: ConfigCheck,
  readBytes: (id: string) => Promise<{ name: string; bytes: ArrayBuffer } | null>,
): Promise<BuiltWorkbook> {
  const built = await buildUpdatedWorkbook(check, readBytes);
  downloadBytes(built.name, built.bytes, XLSX_TYPE);
  return built;
}
