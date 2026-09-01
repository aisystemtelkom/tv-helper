/**
 * Cutting the confirmed zones and writing the two deliverables, in the tab.
 *
 * THE FILTER ON `status === "confirmed"` IS THE PRODUCT RULE, not a detail.
 * The design is explicit: a human confirms or corrects every proposed region
 * before either file is written, and the app never emits an unreviewed zone.
 * A proposal that reaches the docx is a picture nobody checked sitting in a
 * document somebody signs.
 *
 * Both files are built here rather than on the server because the documents
 * never leave the device. `docx` and `exceljs` are loaded on demand so a run
 * that never exports never pays for them.
 */

import type { HeaderFields } from "../export/docx.ts";
import type { Template } from "../forms/template.ts";
import type { Box } from "../pipeline/render.ts";
import { resolvePage } from "./evidence.ts";
import { slotKeyOf } from "./runtime.ts";
import type { BrowserRun, SlotState } from "./runtime.ts";
import { templateSlots } from "./slots.ts";

export type PlannedCrop = {
  key: string;
  label: string;
  pageId: string;
  box: Box;
  state: SlotState;
};

export type ExportPlan = {
  crops: PlannedCrop[];
  /** Confirmed zones whose page the run no longer holds. */
  unresolved: { key: string; pageIndex: number }[];
  /** Fillable slots shipping with no evidence, and why. */
  empty: { key: string; label: string; status: SlotState["status"] | "pending" }[];
};

/**
 * What the export will contain, worked out before anything is written so the
 * operator can be shown it and stopped if it is not what they expect.
 *
 * Crops come out in template order, and within a slot in the order the run
 * stores them, because `buildDocx` stacks a two-capture slot's pictures in the
 * order it receives them.
 */
export function planExport(run: BrowserRun, template: Template): ExportPlan {
  // Keyed by TEMPLATE key. A two-capture slot arrives as `<key>#1` / `<key>#2`
  // and grouping on the raw state key matched nothing: with BOTH captures
  // confirmed by the operator, this planned ZERO crops for the slot and listed
  // it under `empty` as `pending`. The docx would have shipped that cell blank
  // over two accepted zones -- a deliverable that looks complete, is missing
  // evidence, and gets signed. That is the failure this project is organised
  // against, so the grouping is not a stylistic choice.
  const byKey = new Map<string, SlotState[]>();
  for (const state of run.slots) {
    const key = slotKeyOf(state.key);
    const existing = byKey.get(key);
    if (existing) existing.push(state);
    else byKey.set(key, [state]);
  }

  const crops: PlannedCrop[] = [];
  const unresolved: { key: string; pageIndex: number }[] = [];
  const empty: ExportPlan["empty"] = [];

  for (const { slot } of templateSlots(template)) {
    const states = byKey.get(slot.key) ?? [];
    let cut = 0;

    for (const state of states) {
      if (state.status !== "confirmed" || !state.zone) continue;
      const resolved = resolvePage(run, state.zone.pageIndex);
      if (!resolved) {
        unresolved.push({ key: slot.key, pageIndex: state.zone.pageIndex });
        continue;
      }
      crops.push({
        key: slot.key,
        label: slot.label,
        pageId: resolved.page.id,
        box: state.zone.box,
        state,
      });
      cut += 1;
    }

    if (slot.fillable && cut === 0) {
      empty.push({
        key: slot.key,
        label: slot.label,
        status: states[0]?.status ?? "pending",
      });
    }
  }

  return { crops, unresolved, empty };
}

export type Deliverables = { docx: Uint8Array; xlsx: Uint8Array };

/**
 * `pageBitmap` is asked for each page ONCE and its crops are all cut before it
 * is released. A 300 DPI A4 page is ~35MB as RGBA, and holding one per slot
 * is how a 29-page bundle turns into a tab that runs out of memory.
 */
export async function buildDeliverables(
  run: BrowserRun,
  template: Template,
  header: HeaderFields,
  plan: ExportPlan,
  deps: {
    pageBitmap: (runId: string, pageId: string) => Promise<ImageBitmap>;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<Deliverables> {
  const { bitmapToRenderedPage } = await import("./crops.ts");
  const { cropToPng } = await import("../export/crop.ts");
  const { buildDocx } = await import("../export/docx.ts");
  const { buildXlsx } = await import("../export/xlsx.ts");

  const order = new Map(plan.crops.map((crop, i) => [crop, i]));
  const byPage = new Map<string, PlannedCrop[]>();
  for (const crop of plan.crops) {
    const existing = byPage.get(crop.pageId);
    if (existing) existing.push(crop);
    else byPage.set(crop.pageId, [crop]);
  }

  const cut: { at: number; png: Uint8Array; crop: PlannedCrop }[] = [];
  let done = 0;
  for (const [pageId, crops] of byPage) {
    const bitmap = await deps.pageBitmap(run.id, pageId);
    try {
      const rendered = bitmapToRenderedPage(bitmap);
      for (const crop of crops) {
        cut.push({
          at: order.get(crop) ?? 0,
          png: await cropToPng(rendered, crop.box),
          crop,
        });
        done += 1;
        deps.onProgress?.(done, plan.crops.length);
      }
    } finally {
      bitmap.close();
    }
  }

  const filled = cut
    .sort((a, b) => a.at - b.at)
    .map(({ png, crop }) => ({
      key: crop.key,
      png,
      widthPx: Math.round(crop.box.w),
      heightPx: Math.round(crop.box.h),
    }));

  return {
    docx: await buildDocx(template, header, filled),
    // Column E is written from extracted field values, and the browser
    // runtime contract carries none: a `BrowserRun` holds pages and slots,
    // not `FieldValue`s. So every backed row ships VISIBLY BLANK rather than
    // guessed at, which is the posture the design already takes for the rows
    // no PDF can back. The export screen says so in as many words -- a blank
    // column nobody was warned about is the failure this project cares most
    // about.
    xlsx: await buildXlsx(template, []),
  };
}

/** `Form_Validasi_<LOP>_<QUOTE>.docx`, falling back to the run id. */
export function deliverableNames(header: HeaderFields, runId: string): {
  docx: string;
  xlsx: string;
} {
  const stem = [header.idEpic, header.quote].filter(Boolean).join("_") || runId;
  return {
    docx: `Form_Validasi_${stem}.docx`,
    xlsx: `${stem}_ORDER_Config.xlsx`,
  };
}
