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
 *
 * THE PLAN IS AN INVENTORY, NOT AN EXCEPTION REPORT. It used to answer three
 * questions (which crops, which zones cannot be resolved, which fillable slots
 * ship empty), so the export screen could only report a count. A count is the
 * unit in which the failure this file's own grouping comment describes stays
 * invisible: a two-capture slot shipping one picture appears in no list,
 * contributes one crop, and the packet looks complete. The plan therefore also
 * walks every section and every slot IN TEMPLATE ORDER and records every
 * capture with a standing, whether or not anything is wrong with it. The three
 * original fields are kept, derived from that same single pass, because
 * callers and tests read them.
 */

import type { HeaderFields } from "../export/docx.ts";
import type { FieldValue } from "../pipeline/fields.ts";
import type { SectionDef, Template } from "../forms/template.ts";
import type { Box } from "../pipeline/render.ts";
import { resolvePage } from "./evidence.ts";
import { captureOrdinalOf, slotKeyOf } from "./runtime.ts";
import type { BrowserRun, SlotState } from "./runtime.ts";
import { maxOrdinalOf, unmatchedStates } from "./slots.ts";

export type PlannedCrop = {
  key: string;
  label: string;
  pageId: string;
  box: Box;
  /**
   * The page size the zone's box was measured against, carried so `cropToPng`
   * can refuse to cut it out of a re-render of a different size. Pixels are
   * not stored, only OCR lines, so the bitmap this crop is taken from is a
   * SECOND render of the same PDF page -- and a second render at another DPI
   * would produce a perfectly good picture of the wrong region.
   */
  expect: { width: number; height: number };
  state: SlotState;
  /**
   * Where this capture's state sits in `run.slots`.
   *
   * Carried rather than recovered later with `indexOf`, for the reason
   * `PlacedSlot` in `./slots.ts` spells out: the contract promises key, label
   * and status, it does not promise that two captures of one slot are two
   * distinct objects, and `indexOf` over a shared reference would key both
   * captures' pictures to the first one. The screen keys a thumbnail by it.
   */
  stateIndex: number;
  /** 1-based position within its own slot: the order the docx stacks them. */
  ordinal: number;
};

/**
 * What will become of one capture when the files are written.
 *
 * Five of these are runtime statuses and one is not. `lost` is a capture the
 * operator CONFIRMED whose evidence cannot reach the file: either the run no
 * longer holds the page the zone points at, or the state carries no zone at
 * all. It is deliberately its own word rather than being folded back into a
 * status, because the old plan reported such a slot as `empty` with status
 * `confirmed`, and the screen printed both readings in one row: confirmed, and
 * shipping empty. Whichever half a reader believed, one of them was wrong, and
 * the reassuring one was the false one.
 */
export type CaptureStanding =
  | "ships"
  | "proposed"
  | "pending"
  | "outstanding"
  | "unfilled"
  | "lost";

export type PlannedCapture = {
  /** Position in `run.slots`, or -1 for a capture the run has never seen. */
  stateIndex: number;
  /**
   * WHICH CAPTURE OF ITS SLOT THIS IS, read off the state's own key rather
   * than counted off its position in the list.
   *
   * The two agree until a capture is removed. After that, counting renumbers
   * every survivor -- the picture an operator accepted as "ToP (lanjutan 2)"
   * silently becomes "ToP (lanjutan)" -- and the export screen would then
   * disagree with what they signed off. Ordinals are never re-used, so they
   * are what the label is derived from here and everywhere else.
   */
  ordinal: number;
  standing: CaptureStanding;
  /** Set only when `standing` is `ships`. Nothing else prints a picture. */
  crop: PlannedCrop | null;
  /** For `lost`: the page the zone named, or null when it carried no zone. */
  lostPageIndex: number | null;
  /**
   * The capture holds a zone that will NOT be printed.
   *
   * `onUnfill` patches the status and leaves `zone` in place, so an `unfilled`
   * capture can still carry a rectangle the operator drew and accepted, and
   * the export drops it. Saying so is the whole job of this flag: a picture on
   * the export screen must mean a picture in the docx, or the screen is
   * wrong in the direction that gets a packet signed.
   */
  strandedZone: boolean;
};

export type PlannedSlot = {
  key: string;
  /** The template's own label. May carry `{{quote}}`; see `displayLabel`. */
  label: string;
  fillable: boolean;
  /**
   * The highest capture ordinal this slot holds. What `captureLabel` wants as
   * its `total`, and NOT a count of anything -- see `PlannedCapture.ordinal`.
   *
   * THE TEMPLATE NO LONGER SAYS HOW MANY PICTURES A SLOT NEEDS. It used to
   * (`SlotDef.crops`), and this field was called `required`, and the screen
   * reported "1 dari 2 potongan" on a bagian nobody had ever searched for a
   * second picture of. A lanjutan is discovered now, so the run is the only
   * authority on how many captures exist.
   */
  maxOrdinal: number;
  /** How many of them will carry a picture. */
  ships: number;
  captures: PlannedCapture[];
};

export type PlannedSection = {
  title: string;
  layout: SectionDef["layout"];
  slots: PlannedSlot[];
};

/**
 * EVERY NUMBER SAYS WHETHER IT COUNTS SLOTS OR CAPTURES.
 *
 * The screen used to print "12 confirmed crops - 3 slots shipping empty": two
 * units in one line, which is exactly how a slot shipping one of its two
 * pictures hides. Slots and captures are counted separately here and named
 * separately on screen (`bagian` and `potongan`).
 *
 * All of these count FILLABLE slots only, for the reason `progressOf` gives:
 * the EPIC and spreadsheet rows are cells the operator pastes into by hand, so
 * counting them as missing would report a finished run as unfinished.
 *
 * `capturesExtra` is the reconciliation term: confirmed captures on
 * NON-fillable slots. They do reach the docx and they sit outside every count
 * above, which is why `crops.length` and `capturesShipping` can differ. The
 * old plan had that same gap and no term for it, so the headline count and the
 * list of empties were computed over two different populations with nothing
 * saying so.
 */
export type ExportTally = {
  fillableSlots: number;
  slotsComplete: number;
  slotsPartial: number;
  slotsBlank: number;
  /**
   * Captures the run HOLDS on fillable slots, which is as close to "required"
   * as anything can now get: nothing declares a capture count, so a picture is
   * owed only once something has found one.
   */
  capturesHeld: number;
  capturesShipping: number;
  capturesExtra: number;
};

/**
 * Evidence stored under a key this template does not declare.
 *
 * A stored run can outlive the slot list that made it, and the exporter places
 * a crop by key, so these reach no cell in the deliverable. Dropping them from
 * the plan without a word was the same class of silent loss `unresolved` was
 * written for.
 */
export type Orphan = {
  key: string;
  label: string;
  status: SlotState["status"];
  hasZone: boolean;
};

export type ExportPlan = {
  crops: PlannedCrop[];
  /** Confirmed zones whose page the run no longer holds. */
  unresolved: { key: string; pageIndex: number }[];
  /** Fillable slots shipping with no evidence, and why. */
  empty: { key: string; label: string; status: SlotState["status"] | "pending" }[];
  /** Every section and slot the template declares, in template order. */
  sections: PlannedSection[];
  tally: ExportTally;
  orphans: Orphan[];
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
  const byKey = new Map<string, { state: SlotState; index: number }[]>();
  run.slots.forEach((state, index) => {
    const key = slotKeyOf(state.key);
    const existing = byKey.get(key);
    if (existing) existing.push({ state, index });
    else byKey.set(key, [{ state, index }]);
  });

  const crops: PlannedCrop[] = [];
  const unresolved: { key: string; pageIndex: number }[] = [];
  const empty: ExportPlan["empty"] = [];
  const sections: PlannedSection[] = [];
  const tally: ExportTally = {
    fillableSlots: 0,
    slotsComplete: 0,
    slotsPartial: 0,
    slotsBlank: 0,
    capturesHeld: 0,
    capturesShipping: 0,
    capturesExtra: 0,
  };

  for (const section of template.sections) {
    const planned: PlannedSlot[] = [];

    for (const slot of section.slots) {
      const placed = byKey.get(slot.key) ?? [];
      const maxOrdinal = maxOrdinalOf(placed);
      const captures: PlannedCapture[] = [];
      let ships = 0;

      placed.forEach(({ state, index }) => {
        const ordinal = captureOrdinalOf(state.key);

        if (state.status === "confirmed") {
          const resolved = state.zone
            ? resolvePage(run, state.zone.pageIndex)
            : null;

          if (state.zone && resolved) {
            const crop: PlannedCrop = {
              key: slot.key,
              label: slot.label,
              pageId: resolved.page.id,
              box: state.zone.box,
              expect: {
                width: resolved.page.widthPx,
                height: resolved.page.heightPx,
              },
              state,
              stateIndex: index,
              ordinal,
            };
            crops.push(crop);
            ships += 1;
            captures.push({
              stateIndex: index,
              ordinal,
              standing: "ships",
              crop,
              lostPageIndex: null,
              strandedZone: false,
            });
            return;
          }

          if (state.zone) {
            unresolved.push({ key: slot.key, pageIndex: state.zone.pageIndex });
          }
          captures.push({
            stateIndex: index,
            ordinal,
            standing: "lost",
            crop: null,
            lostPageIndex: state.zone ? state.zone.pageIndex : null,
            strandedZone: false,
          });
          return;
        }

        captures.push({
          stateIndex: index,
          ordinal,
          standing: state.status,
          crop: null,
          lostPageIndex: null,
          strandedZone: Boolean(state.zone),
        });
      });

      if (slot.fillable && ships === 0) {
        empty.push({
          key: slot.key,
          label: slot.label,
          status: placed[0]?.state.status ?? "pending",
        });
      }

      if (slot.fillable) {
        tally.fillableSlots += 1;
        tally.capturesHeld += placed.length;
        tally.capturesShipping += ships;
        // "Complete" is now every capture the run HOLDS shipping a picture,
        // rather than every capture the template declared. A slot whose only
        // capture ships is complete as far as anything knows -- which is why
        // `Progress.uncheckedForContinuation` is reported alongside this, and
        // says how much of that "as far as anything knows" was ever tested.
        if (ships > 0 && ships === placed.length) tally.slotsComplete += 1;
        else if (ships > 0) tally.slotsPartial += 1;
        else tally.slotsBlank += 1;
      } else {
        tally.capturesExtra += ships;
      }

      planned.push({
        key: slot.key,
        label: slot.label,
        fillable: slot.fillable,
        maxOrdinal,
        ships,
        captures,
      });
    }

    sections.push({
      title: section.title,
      layout: section.layout,
      slots: planned,
    });
  }

  const orphans = unmatchedStates(run, template).map((state) => ({
    key: state.key,
    label: state.label || state.key,
    status: state.status,
    hasZone: Boolean(state.zone),
  }));

  return { crops, unresolved, empty, sections, tally, orphans };
}

/**
 * One thing standing between this run and its two files.
 *
 * `stateIndex` is -1 for a fillable slot the run holds no state for at all,
 * which is a real case rather than a defensive one: the template can declare a
 * slot a stored run has never seen.
 */
export type BlockingItem = {
  kind: "proposed" | "pending" | "lost";
  sectionTitle: string;
  label: string;
  ordinal: number;
  /** The slot's highest capture ordinal, for `captureLabel`'s `total`. */
  maxOrdinal: number;
  stateIndex: number;
};

/**
 * WHAT STOPS AN EXPORT, AND WHAT MERELY LEAVES IT INCOMPLETE.
 *
 * Blocking, each for its own reason:
 *
 *  - `proposed`. The design's own rule and the reason this gate exists: the
 *    app never emits a zone nobody ruled on.
 *  - `pending`. A slot nobody has looked for evidence for is not a decision
 *    anyone made. The gate used to read `proposed > 0` and nothing else, so a
 *    run on which the search had never been started was exportable, and it
 *    produced a complete-looking packet containing no evidence whatsoever.
 *    This is the same standard the dokumen tambahan loop applies to
 *    `outstanding`: the operator answers on the record, rather than the packet
 *    answering by default. The remedy is reachable from the review sheet
 *    (search for it, draw it by hand, or ship it empty deliberately).
 *  - `lost`. Evidence the operator personally accepted that cannot reach the
 *    file. It used to render a stop-toned notice beside a live build button,
 *    which teaches an operator that a stop colour stops nothing.
 *
 * NOT blocking, deliberately: `outstanding` and `unfilled`. Both are answers
 * the operator gave. The tambahan loop's whole point is that a slot may ship
 * empty on the record, and `hasUnreviewedProposals` in `./slots.ts` carries
 * the same rule for the same reason.
 */
export function blockingItems(plan: ExportPlan): BlockingItem[] {
  const items: BlockingItem[] = [];

  for (const section of plan.sections) {
    for (const slot of section.slots) {
      // Non-fillable slots are the cells the operator pastes into by hand.
      // Nothing can back them, so nothing about them can be decided here.
      if (!slot.fillable) continue;

      if (slot.captures.length === 0) {
        items.push({
          kind: "pending",
          sectionTitle: section.title,
          label: slot.label,
          ordinal: 1,
          maxOrdinal: slot.maxOrdinal,
          stateIndex: -1,
        });
        continue;
      }

      for (const capture of slot.captures) {
        if (
          capture.standing !== "proposed" &&
          capture.standing !== "pending" &&
          capture.standing !== "lost"
        ) {
          continue;
        }
        items.push({
          kind: capture.standing,
          sectionTitle: section.title,
          label: slot.label,
          ordinal: capture.ordinal,
          maxOrdinal: slot.maxOrdinal,
          stateIndex: capture.stateIndex,
        });
      }
    }
  }

  return items;
}

/**
 * The label as the docx will print it.
 *
 * The Konfigurasi table labels one row with the quote number itself, stored as
 * the literal `{{quote}}`. `buildDocx` substitutes it before writing the cell,
 * so a screen that prints the raw token is showing the operator something the
 * deliverable does not contain.
 */
export function displayLabel(label: string, quote: string): string {
  return label.replace("{{quote}}", quote);
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
    /**
     * The extracted values for column E, when the caller has them.
     *
     * OPTIONAL, AND THE DEFAULT IS STILL AN EMPTY COLUMN, because a blank the
     * operator was warned about is the posture this file already takes for
     * rows no PDF can back. What changed is that the blank is no longer
     * MANDATORY: this used to pass `[]` unconditionally with a comment saying
     * the browser runtime carried no field values, which was true and stopped
     * being true when `/api/extract` shipped. It stayed passing `[]` anyway,
     * so every run's column E was empty by construction whatever the
     * documents said.
     */
    values?: readonly FieldValue[];
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
          // `crop.expect` is the size the zone was measured on. `rendered` is
          // a fresh render of the same page, so handing both over is what
          // turns a DPI or rotation drift into an error instead of a
          // plausible picture of the wrong region.
          png: await cropToPng(rendered, crop.box, crop.expect),
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
    // Column E, from whatever the caller extracted. A row with no value still
    // ships VISIBLY BLANK rather than guessed at, which is the posture this
    // design takes for every row no document can back, and the export screen
    // says which rows those are: a blank column nobody was warned about is
    // the failure this project cares most about.
    xlsx: await buildXlsx(template, [...(deps.values ?? [])]),
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

/**
 * True when both names fall back to the run id, which is a UUID.
 *
 * An operator files these by name and a UUID is unfileable. The screen used to
 * show the name only on the Save button, after the build, so the fallback was
 * discovered at the point where fixing it means building again.
 */
export function namesAreFallback(header: HeaderFields): boolean {
  return !header.idEpic && !header.quote;
}
