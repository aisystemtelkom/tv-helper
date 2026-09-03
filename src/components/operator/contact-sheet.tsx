"use client";

/**
 * LEMBAR PERIKSA: every capture the packet will carry, in template order.
 *
 * The sheet is one scrolling column and it never hides a capture behind a
 * filter, because the whole argument for a contact sheet is that a SYSTEMATIC
 * failure -- every crop landing at the top of its page, three captures citing
 * one page, every range running on into a footer -- is visible here in one
 * sweep and would take eleven screens of drilling to notice one slot at a
 * time.
 *
 * Three things in this file are load-bearing, and each replaces something that
 * looked reasonable and did not work.
 *
 * THE INDEX RAIL replaces twelve identical anchor pills. A pill said "KB" and
 * a number; it could not say anything about the evidence, so the operator had
 * to open all twelve to learn what the sheet already knew. The rail carries
 * one `Denah` per capture instead: a plan of the cited page with the cut drawn
 * on it. Stacked in a column those silhouettes ARE the systematic-failure
 * detector the old comment claimed the sheet was, and a capture with no zone
 * yet is a `Missing` hatch, a deliberately different shape, because on a fresh
 * run that is every row and it is the first thing a new operator ever sees.
 *
 * THE NON-FILLABLE SET IS DEMOTED HARD. `AO_TEMPLATE` declares 24 slots and
 * only 11 of them can be backed by a document; three sections declare no slots
 * at all. Rendering those as plates made more than half of the operator's
 * primary screen furniture they had to scroll past to find work. A slot no PDF
 * can back is one ruled line, which the plate draws itself; a SECTION in which
 * nothing can be backed never reaches the plate at all, because a heading and
 * a paragraph of guidance about crops that will never exist is furniture with
 * a title. Those are gathered into one block at the end, one line per section,
 * and the reclaimed space goes to the crops.
 *
 * THE SHEET'S OWN CONTROLS LIVE IN THE RAIL. Expand-all, the count of crops
 * still being cut and the keyboard legend used to be a ruled row across the top
 * of the plate column: about 84px of chrome between the operator and the first
 * picture, on the one screen whose whole argument is that the picture must be
 * big enough to judge. The rail is a sticky column, so anything put at the top
 * of it pushes nothing down. The legend went behind a question mark, because it
 * reads the same words on every order and the app says the same thing out loud,
 * in a live region, at the moment a decision key is refused. The count of crops
 * still being cut did NOT: it is a measurement of this run, and a picture that
 * has not appeared cannot have been reviewed.
 *
 * SECTION HEADINGS LOST THEIR LEDE for the same reason and by the same test.
 * `guidanceFor` rendered under all five headings, once above the first crop,
 * and said the identical two sentences on every order in this product's life.
 * The title and the accept-all control now share one row and the guidance sits
 * behind the title's own mark, which is about 90px per heading down to 46px.
 *
 * BULK ACCEPT IS TWO STEPS ON PURPOSE. Accepting several crops with one click
 * is the shortest path in the whole product from "nobody looked" to "a crop of
 * the wrong page inside a document a validator signs", so the button reveals a
 * confirmation naming the fields it would accept, and only the second click
 * commits. It also refuses while any of those crops is still being cut: a
 * proposal whose picture has not appeared cannot have been reviewed.
 *
 * THE HEAD IS WHAT IS MISSING, and it is part of this screen now rather than a
 * phase of its own. `head` renders above the index rail and the plates, inside
 * the scrolling column, so it is the first thing read on arriving at Periksa
 * and then it gets out of the way; it is not pinned, because it is a briefing,
 * not chrome. The sheet stays agnostic about what is in it: today the shell
 * passes the dokumen tambahan block, and everything below still works with the
 * prop absent. The one thing this file owes it is the KEYBOARD: `j`, `k` and
 * the decision keys are ignored while focus is inside the head or inside any
 * open dialog, because a shortcut that fires on a screen the operator is not
 * looking at decides evidence they cannot see.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";

import { AO_TEMPLATE } from "@/lib/forms/template";
import { resolvePage } from "@/lib/ui/evidence";
import type { BrowserRun, SlotState } from "@/lib/ui/runtime";
import {
  proposedIndexesIn,
  sheetSections,
  unmatchedStates,
  type SheetSection,
  type SlotAggregate,
} from "@/lib/ui/slots";

import {
  Btn,
  Hint,
  Mark,
  Notice,
  STATUS_WORDS,
  TechnicalDetail,
} from "./chrome";
import { Denah, Missing } from "./denah";
import { Paraf } from "./icons";
import { ProposalPlate, type PlateActions } from "./proposal-plate";
import { useCropThumbs } from "./use-crop-thumbs";

/* ------------------------------------------------------------------ *
 * The shapes this screen works in.
 * ------------------------------------------------------------------ */

/**
 * One capture: one picture the deliverable will carry, and one decision.
 *
 * `slotIndex` is the position in `run.slots`, which is what every action names
 * a capture by. It is carried rather than recovered with `indexOf` for the
 * reason `slots.ts` spells out at length: the two captures of one slot are two
 * entries whose objects the contract does not promise are distinct.
 */
type Capture = {
  slotIndex: number;
  /** `SlotDef.key`, which is also the id of the plate this capture sits in. */
  plateKey: string;
  sectionTitle: string;
  fieldLabel: string;
  /** The field name, plus the capture ordinal when the slot holds several. */
  caption: string;
  state: SlotState;
};

/** A row of the index rail. `capture` is null for one the run never got. */
type RailRow = { ordinal: number; total: number; capture: Capture | null };

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * A label the operator can read.
 *
 * `konfigurasi.quote` is declared as `{{quote}}`, a token the exporter
 * substitutes. Printing it raw leaks the template's own syntax onto the
 * screen, so it is named by what it is instead.
 */
function displayLabel(label: string): string {
  return /^\{\{.+\}\}$/.test(label) ? "(nomor quote)" : label;
}

function captionFor(
  entry: SlotAggregate,
  ordinal: number,
  total: number,
): string {
  const label = displayLabel(entry.def.label);
  return total > 1 ? `${label} (potongan ${ordinal} dari ${total})` : label;
}

/**
 * Every capture of one slot, INCLUDING the ones the run holds no state for.
 *
 * A two-capture slot that only ever received one state is half a field, and
 * dropping the missing half from the map would be the wrong-and-quiet failure
 * in miniature: a rail that accounts for eleven captures of a twelve-capture
 * packet and looks complete.
 */
function rowsFor(entry: SlotAggregate, sectionTitle: string): RailRow[] {
  const total = Math.max(entry.required, entry.states.length);
  return Array.from({ length: total }, (_, i) => {
    const placed = entry.states[i];
    return {
      ordinal: i + 1,
      total,
      capture: placed
        ? {
            slotIndex: placed.index,
            plateKey: entry.def.key,
            sectionTitle,
            fieldLabel: displayLabel(entry.def.label),
            caption: captionFor(entry, i + 1, total),
            state: placed.state,
          }
        : null,
    };
  });
}

/**
 * Is the top of this capture on screen, with room under it?
 *
 * The picture is at the top of a capture, so a plate scrolled past its own top
 * is showing the operator its buttons rather than its evidence. Asking for the
 * whole element instead would make the decision keys permanently inert on a
 * whole-page capture, which is taller than a 1366x768 viewport.
 */
function topIsVisible(element: Element, offset: number): boolean {
  const rect = element.getBoundingClientRect();
  return rect.top >= offset - 24 && rect.top <= window.innerHeight - 120;
}

/** What the operator has to check in this kind of section, not what it is. */
function guidanceFor(layout: SheetSection["layout"]): string {
  return layout === "images"
    ? "Setiap potongan di sini adalah satu halaman penuh, memang begitu bentuknya. Yang perlu Anda periksa hanya satu hal: apakah halamannya benar."
    : "Potongan di sini adalah area di dalam halaman. Periksa halamannya, lalu periksa apakah areanya memuat seluruh keterangan dan tidak terbawa ke bagian lain.";
}

/**
 * How far down the page a sticky application strip reaches.
 *
 * MEASURED, never assumed. The sheet used to scroll its sections to a fixed
 * `scroll-mt-24` (96px) while the strip above it wraps to two or three rows on
 * a 1366px panel, which is the width half this audience works on: clicking a
 * section anchor put that section's heading and its accept control UNDER the
 * strip, and the operator landed mid-plate with no idea which section they
 * were in. A `ResizeObserver` costs nothing and cannot drift from the header
 * it is measuring.
 */
function useStickyOffset(): number {
  const [offset, setOffset] = useState(96);

  useEffect(() => {
    const header = Array.from(document.querySelectorAll("header")).find(
      (element) => getComputedStyle(element).position === "sticky",
    );
    // The observer is the only thing that writes the offset, including the
    // first time: `ResizeObserver` delivers a measurement as soon as it starts
    // observing, so the effect body itself never sets state. With no sticky
    // strip at all there is nothing to clear, and body is observed only so
    // that the zero is written once.
    const read = () =>
      setOffset(header ? Math.round(header.getBoundingClientRect().height) : 0);
    const observer = new ResizeObserver(read);
    observer.observe(header ?? document.body);
    return () => observer.disconnect();
  }, []);

  return offset;
}

/* ------------------------------------------------------------------ *
 * The screen.
 * ------------------------------------------------------------------ */

type SheetProps = {
  run: BrowserRun;
  actions: PlateActions;
  onAcceptSection: (slotIndexes: number[]) => void;
  /** Captures whose write has not resolved yet: the paraf stays unfinished. */
  pending?: ReadonlySet<number>;
  /** Captures decided in this session: the paraf draws once, on the click. */
  fresh?: ReadonlySet<number>;
  /** Rendered above the sheet: what is still missing, and the tambahan question. */
  head?: ReactNode;
};

/**
 * A different run is a different packet, and every piece of state this screen
 * keeps (the keyboard cursor, an open bulk confirmation, expand-all) is about
 * THIS packet. Keying on the run id says so in React's own terms and resets
 * all of it at once, which is why nothing below clears state in an effect.
 */
export function ContactSheet(props: SheetProps) {
  return <Sheet key={props.run.id} {...props} />;
}

function Sheet({
  run,
  actions,
  onAcceptSection,
  pending,
  fresh,
  head,
}: SheetProps) {
  const thumbs = useCropThumbs(run);
  const sections = useMemo(() => sheetSections(run, AO_TEMPLATE), [run]);
  const orphans = useMemo(() => unmatchedStates(run, AO_TEMPLATE), [run]);
  const offset = useStickyOffset();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const wrappers = useRef(new Map<string, HTMLDivElement>());
  const confirmBoxRef = useRef<HTMLDivElement | null>(null);

  /** Which section's bulk accept is waiting for its second click. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /**
   * Every settled capture open at full size.
   *
   * The plate collapses a settled capture to a proof on its own, per capture,
   * and offers its own per-capture toggle. This is the sheet-wide override, and
   * it exists for one moment: the pass an operator makes before export, when
   * every crop has to be visible again whatever its state.
   */
  const [expandAll, setExpandAll] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [said, setSaid] = useState<{ text: string; seq: number }>({
    text: "",
    seq: 0,
  });

  const say = useCallback((text: string) => {
    setSaid((prev) => ({ text, seq: prev.seq + 1 }));
  }, []);

  /** Sections that actually ask the operator for something. */
  const workSections = useMemo(
    () =>
      sections.filter((section) => section.entries.some((e) => e.def.fillable)),
    [sections],
  );
  /** Sections the packet ships blank: no slot in them can be backed by a PDF. */
  const manualSections = useMemo(
    () =>
      sections.filter((section) => !section.entries.some((e) => e.def.fillable)),
    [sections],
  );

  const captures = useMemo(() => {
    const out: Capture[] = [];
    for (const section of workSections) {
      for (const entry of section.entries) {
        if (!entry.def.fillable) continue;
        for (const row of rowsFor(entry, section.title)) {
          if (row.capture) out.push(row.capture);
        }
      }
    }
    return out;
  }, [workSections]);

  /*
   * "Is this capture's crop actually on screen?", which is what makes a
   * decision key live. A capture whose PAGE would not render counts as drawn
   * for this purpose: its picture is never coming, the plate says so and
   * disables Terima itself, and treating it as undrawn would leave the
   * keyboard silently inert over a row the operator can still redraw or
   * reject.
   */
  const drawn = useCallback(
    (slotIndex: number) =>
      Boolean(thumbs.urls[String(slotIndex)]) ||
      Boolean(thumbs.failed[String(slotIndex)]),
    [thumbs],
  );

  const waitingCount = captures.filter(
    (c) => c.state.status === "proposed",
  ).length;
  const unsearchedCount = captures.filter(
    (c) => c.state.status === "pending",
  ).length;
  const gapCount = workSections.reduce(
    (total, section) =>
      total +
      section.entries.filter(
        (e) =>
          e.def.fillable &&
          (e.status === "outstanding" || e.status === "partial"),
      ).length,
    0,
  );
  const cutting = captures.filter(
    (c) => c.state.zone && !drawn(c.slotIndex),
  ).length;

  /* The cursor is a position in `captures`, so it survives a decision (which
     changes statuses, never positions) and is clamped rather than trusted. */
  const at = Math.min(cursor, Math.max(0, captures.length - 1));

  // One announcement, when the last crop lands. The count itself is on screen
  // and changes a dozen times, so putting it in a live region would read every
  // intermediate value aloud.
  const wasCutting = useRef(cutting);
  useEffect(() => {
    if (wasCutting.current > 0 && cutting === 0) {
      say("Semua potongan sudah tampil.");
    }
    wasCutting.current = cutting;
  }, [cutting, say]);

  // The confirmation appears without navigation, so the keyboard goes to it.
  // The block itself is the fallback target, not an afterthought: revealing it
  // unmounts the button that was just clicked, and when a crop is still being
  // cut the confirm button is disabled and refuses focus, so without this the
  // keyboard would land on <body> in front of a block nobody announced.
  useEffect(() => {
    if (!confirming) return;
    const box = confirmBoxRef.current;
    if (!box) return;
    const button = box.querySelector<HTMLButtonElement>(
      "[data-confirm]:not(:disabled)",
    );
    (button ?? box).focus();
  }, [confirming]);

  const elementFor = useCallback((capture: Capture): HTMLElement | null => {
    const wrapper = wrappers.current.get(capture.plateKey);
    if (!wrapper) return null;
    // The plate marks each capture block where it can, which matters for the
    // two-capture ToP row: the plate is one element and its second crop can be
    // off screen while its first is not. Without the mark the whole plate
    // stands in, which is exact for every single-capture slot.
    return (
      wrapper.querySelector<HTMLElement>(
        `[data-capture-index="${capture.slotIndex}"]`,
      ) ?? wrapper
    );
  }, []);

  const scrollTo = useCallback(
    (element: HTMLElement) => {
      const top =
        window.scrollY + element.getBoundingClientRect().top - offset - 16;
      // Instant, not smooth. The one thing that moves in this product is the
      // paraf being drawn, and it moves because the operator made it move.
      window.scrollTo({ top: Math.max(0, top) });
    },
    [offset],
  );

  const goTo = useCallback(
    (position: number) => {
      const capture = captures[position];
      if (!capture) return;
      setCursor(position);
      wrappers.current.get(capture.plateKey)?.focus({ preventScroll: true });
      const element = elementFor(capture);
      if (element) scrollTo(element);
    },
    [captures, elementFor, scrollTo],
  );

  /**
   * FOCUS MUST SURVIVE A DECISION.
   *
   * Accepting unmounts the button that was clicked (the proposed branch is
   * replaced by the settled one), which drops focus to `<body>` and restarts
   * the next Tab at the top of the document. This moves the cursor to the next
   * capture that still owes a decision and takes focus there instead, but only
   * when focus was lost or was inside this sheet, so an operator who has
   * already clicked somewhere else is left where they put themselves.
   */
  const advanceFrom = useCallback(
    (slotIndex: number) => {
      const from = captures.findIndex((c) => c.slotIndex === slotIndex);
      const start = from >= 0 ? from : at;
      const order = [
        ...captures.slice(start + 1),
        ...captures.slice(0, start + 1),
      ];
      const next = order.find(
        (c) => c.state.status === "proposed" && c.slotIndex !== slotIndex,
      );
      const target = next ?? captures[start];
      if (!target) return;
      setCursor(captures.indexOf(target));

      requestAnimationFrame(() => {
        const active = document.activeElement;
        const lost =
          !active ||
          active === document.body ||
          !active.isConnected ||
          Boolean(rootRef.current?.contains(active));
        if (!lost) return;
        const wrapper = wrappers.current.get(target.plateKey);
        wrapper?.focus({ preventScroll: true });
        // Only when it is not already there. A settled capture collapses to a
        // proof, so the sheet gets shorter under the operator's hand; jumping
        // as well, when the next thing to decide is already in front of them,
        // would move the page for no reason.
        const element = elementFor(target);
        if (element && !topIsVisible(element, offset)) scrollTo(element);
      });
    },
    [captures, at, elementFor, offset, scrollTo],
  );

  /**
   * The actions the plates get, with the list's own bookkeeping attached.
   *
   * Redraw is deliberately not routed: it leaves the sheet for the zone
   * editor, so there is nothing here to advance to.
   */
  const routed: PlateActions = useMemo(
    () => ({
      ...actions,
      onAccept: (index) => {
        actions.onAccept(index);
        advanceFrom(index);
      },
      onReject: (index) => {
        actions.onReject(index);
        advanceFrom(index);
      },
      onUnfill: (index) => {
        actions.onUnfill(index);
        advanceFrom(index);
      },
    }),
    [actions, advanceFrom],
  );

  /**
   * THE KEYBOARD, because this is the screen that owns the list.
   *
   * A DECISION KEY IS INERT WHILE THE CROP IS NOT ON SCREEN. Nobody may rule
   * on evidence they cannot see, so the key scrolls the capture into view and
   * says so instead of deciding; pressing it again then decides. "On screen"
   * is the capture's own top edge sitting below the application strip with
   * room under it, because the picture is at the top of a capture and a plate
   * scrolled past its own top is showing the operator its buttons, not its
   * evidence.
   *
   * The arrows only move the cursor when focus is already inside the sheet.
   * Swallowing ArrowDown globally would take normal page scrolling away from
   * everyone who has not engaged with the list; `j` and `k` scroll nothing, so
   * they need no such fence.
   *
   * THE HEAD AND ANY OPEN DIALOG TAKE THE KEYBOARD WITH THEM. These listeners
   * are on `window`, so without this a `1` typed while the operator is reading
   * the head, or while the dokumen tambahan dialog is open over the sheet,
   * would accept a crop that is behind a scrim and out of sight. That is the
   * decision-key rule ("you may not rule on evidence you cannot see") applied
   * to the two surfaces that sit in front of the sheet rather than in it.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (confirming) return;
      if (captures.length === 0) return;

      // A modal is open somewhere: it owns the keyboard until it closes. The
      // popup only exists in the DOM while the dialog is open, so this costs
      // one selector on a keypress and needs no state of its own.
      if (document.querySelector("[data-slot='dialog-content']")) return;

      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.closest("input, textarea, select, [contenteditable=true]")
      ) {
        return;
      }

      const headEl = headRef.current;
      const active = document.activeElement;
      if (
        (target && headEl?.contains(target)) ||
        (active && headEl?.contains(active))
      ) {
        return;
      }

      const inSheet = Boolean(
        document.activeElement &&
          rootRef.current?.contains(document.activeElement),
      );

      if (event.key === "j" || (event.key === "ArrowDown" && inSheet)) {
        event.preventDefault();
        goTo(Math.min(at + 1, captures.length - 1));
        return;
      }
      if (event.key === "k" || (event.key === "ArrowUp" && inSheet)) {
        event.preventDefault();
        goTo(Math.max(at - 1, 0));
        return;
      }

      if (event.key !== "1" && event.key !== "2" && event.key !== "3") return;
      const capture = captures[at];
      if (!capture) return;
      event.preventDefault();

      const named = `${capture.caption} di ${capture.sectionTitle}`;
      const element = elementFor(capture);
      if (!element || !topIsVisible(element, offset)) {
        if (element) scrollTo(element);
        say(
          `Potongan untuk ${named} belum terlihat. Lembar digulir ke potongan itu, tekan lagi untuk memutuskan.`,
        );
        return;
      }

      if (event.key === "2") {
        routed.onRedraw(capture.slotIndex);
        return;
      }
      if (capture.state.status !== "proposed") {
        say(`${named} tidak sedang menunggu keputusan Anda.`);
        return;
      }
      if (event.key === "1") {
        // The same bar the plate's own Terima applies, said in words: a
        // picture that has not appeared cannot have been looked at, and a
        // zone whose page the run no longer holds never will appear.
        const zone = capture.state.zone;
        if (zone && resolvePage(run, zone.pageIndex) === null) {
          say(
            `Halaman untuk ${named} sudah tidak ada di pekerjaan ini, jadi tidak ada yang bisa Anda nilai. Gambar ulang areanya.`,
          );
          return;
        }
        if (!drawn(capture.slotIndex)) {
          say(`Potongan untuk ${named} belum selesai digambar.`);
          return;
        }
        routed.onAccept(capture.slotIndex);
        say(`${named} diterima.`);
        return;
      }
      routed.onReject(capture.slotIndex);
      say(
        `${named} ditolak, bagian ini masuk ke daftar yang belum ada buktinya di atas lembar ini.`,
      );
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    at,
    captures,
    confirming,
    drawn,
    elementFor,
    goTo,
    offset,
    routed,
    run,
    say,
    scrollTo,
  ]);

  const registerWrapper = (key: string) => (element: HTMLDivElement | null) => {
    if (element) wrappers.current.set(key, element);
    else wrappers.current.delete(key);
  };

  const jumpTo = (id: string) => {
    const element = document.getElementById(id);
    if (element) scrollTo(element);
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-6">
      {/* ABOVE BOTH COLUMNS, and inside the scroll. The head is what is still
          missing: it is read once on arrival and then it has to leave, so it
          must not become a second sticky band above a sheet whose own index
          rail is already pinned. Placing it here rather than inside the plate
          column also keeps it clear of the rail, which would otherwise sit
          beside a block that has nothing to do with it. */}
      {head ? <div ref={headRef}>{head}</div> : null}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <IndexRail
          run={run}
          sections={workSections}
          hasManual={manualSections.length > 0}
          orphanCount={orphans.length}
          cursorSlotIndex={captures[at]?.slotIndex ?? null}
          pending={pending}
          offset={offset}
          expandAll={expandAll}
          onToggleExpandAll={() => setExpandAll((was) => !was)}
          cutting={cutting}
          onPickCapture={(slotIndex) => {
            const position = captures.findIndex((c) => c.slotIndex === slotIndex);
            if (position >= 0) goTo(position);
          }}
          onPickAnchor={jumpTo}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-8">
          {run.pages.length === 0 ? (
            <Notice tone="stop">
              Pekerjaan ini belum berisi satu halaman pun, jadi tidak ada yang
              bisa diperiksa. Muat berkas PDF dulu di langkah Muat.
            </Notice>
          ) : null}

          {/* It does not name where the button is. The search moved to the Muat
              screen and a tambahan round starts from the head of this one, so a
              sentence pointing at one fixed place would be wrong half the
              time. */}
          {run.pages.length > 0 &&
          captures.length > 0 &&
          unsearchedCount === captures.length ? (
            <Notice>
              Belum ada satu pun usulan di lembar ini: {unsearchedCount} potongan
              masih belum dicari.{" "}
              <Hint label="Cara mengisi lembar ini">
                Jalankan pencarian untuk bagian itu, lalu usulannya muncul di
                lembar ini.
              </Hint>
            </Notice>
          ) : null}

          {/* AN ABSENT WARNING IS NOT A CONFIRMATION, so the cleared state is
              said out loud, and it says the same breath what is NOT cleared:
              an operator scanning a sheet with no amber left on it would
              otherwise conclude they were finished while two slots with no
              evidence at all sat below. Not shown on a run nothing has searched
              yet, where "nothing is waiting on you" would be true and useless. */}
          {run.pages.length > 0 &&
          captures.length > 0 &&
          waitingCount === 0 &&
          unsearchedCount < captures.length ? (
            <Notice tone={gapCount > 0 ? "warn" : "info"}>
              {/* The affirmative clear stands whole: an absent warning is not a
                  confirmation, so this sentence is the confirmation. The count
                  beside it stands too. What went behind the mark is the part
                  that would read the same on every order. */}
              Tidak ada usulan yang menunggu keputusan Anda.
              {gapCount > 0 ? (
                <>
                  {` ${gapCount} bagian masih belum ada buktinya. `}
                  <Hint label="Kenapa itu masih perlu Anda selesaikan">
                    Bagian itu tidak akan mengisi dirinya sendiri.
                    {head
                      ? " Selesaikan di daftar yang belum ada buktinya, di baris paling atas lembar ini."
                      : ""}
                  </Hint>
                </>
              ) : null}
            </Notice>
          ) : null}

          {workSections.map((section) => {
            const waiting = proposedIndexesIn(section);
            const undrawn = waiting.filter((index) => !drawn(index)).length;

            return (
              <section
                key={section.title}
                id={`bagian-${slug(section.title)}`}
                className="flex flex-col gap-5"
                style={{ scrollMarginTop: offset + 16 }}
              >
                <header
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b pb-2"
                  style={{ borderColor: "var(--line)" }}
                >
                  <div className="flex min-w-0 items-center gap-1">
                    <h2 className="lt-title lt-figure">{section.title}</h2>
                    {/* Five copies of one paragraph, said in the same words on
                        every order, one of them directly above the first crop.
                        What varies is which KIND of section this is, and the
                        title already says that. */}
                    <Hint label={`Yang perlu diperiksa di ${section.title}`}>
                      {guidanceFor(section.layout)}
                    </Hint>
                  </div>

                  {waiting.length > 0 && confirming !== section.title ? (
                    <Btn onClick={() => setConfirming(section.title)}>
                      {/* Terima leaves a paraf in the mark box, so the button
                          that accepts several at once draws the several parafs
                          it is about to leave. */}
                      <Paraf />
                      Terima semua {waiting.length} di {section.title}
                    </Btn>
                  ) : null}
                </header>

                {confirming === section.title ? (
                  <BulkConfirm
                    ref={confirmBoxRef}
                    section={section}
                    indexes={waiting}
                    undrawn={undrawn}
                    onCancel={() => setConfirming(null)}
                    onCommit={() => {
                      setConfirming(null);
                      onAcceptSection(waiting);
                      say(
                        `${waiting.length} usulan di ${section.title} diterima sekaligus.`,
                      );
                    }}
                  />
                ) : null}

                {/* Every entry, fillable or not, in template order. A slot no
                    PDF can back is demoted by the plate itself, to one ruled
                    line, so the sheet does not need a second way of saying it
                    and the packet's own order survives. */}
                {section.entries.map((entry) => {
                  const isCursor = captures[at]?.plateKey === entry.def.key;

                  return (
                    <div
                      key={entry.def.key}
                      ref={registerWrapper(entry.def.key)}
                      id={`bagian-${slug(entry.def.key)}`}
                      tabIndex={-1}
                      role="group"
                      aria-label={displayLabel(entry.def.label)}
                      className="border-s-2 ps-3"
                      style={{
                        scrollMarginTop: offset + 16,
                        // The cursor is INK, never amber. A keyboard position is
                        // not a decision that is owed, and letting the two share
                        // a colour makes a focused row read as work.
                        borderInlineStartColor: isCursor
                          ? "var(--ink)"
                          : "transparent",
                      }}
                    >
                      <ProposalPlate
                        run={run}
                        entry={entry}
                        thumbs={thumbs}
                        actions={routed}
                        pending={pending}
                        fresh={fresh}
                        expanded={expandAll}
                      />
                    </div>
                  );
                })}
              </section>
            );
          })}

          {manualSections.length > 0 ? (
            <section
              id="bagian-diisi-manual"
              className="flex flex-col gap-3"
              style={{ scrollMarginTop: offset + 16 }}
            >
              <div className="flex items-center gap-1">
                <h2 className="lt-title">Bagian yang diisi manual</h2>
                {/* The list below changes with the template; this explanation of
                    it does not, so it goes behind the mark and the names stay. */}
                <Hint label="Kenapa bagian ini dikirim kosong">
                  Bagian berikut tetap ada di DOKUMEN VALIDASI, lengkap dengan
                  judul dan kotaknya, tapi dikirim kosong. Tidak ada dokumen
                  order yang bisa mendukungnya, jadi Anda yang mengisinya setelah
                  berkas hasil dibuat.
                </Hint>
              </div>
              <ManualLines
                rows={manualSections.map((section) => ({
                  title: section.title,
                  fields:
                    section.entries.length === 0
                      ? "(hanya judul bagian)"
                      : section.entries
                          .map((entry) => displayLabel(entry.def.label))
                          .join(", "),
                }))}
              />
            </section>
          ) : null}

          {orphans.length > 0 ? (
            <Orphans run={run} states={orphans} offset={offset} />
          ) : null}

          {/* Keyboard feedback only. Everything else on this screen is visible,
              and a live region that repeated it would read the sheet twice. */}
          <div className="sr-only" role="status" aria-live="polite">
            <p key={said.seq}>{said.text}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The index rail.
 * ------------------------------------------------------------------ */

function IndexRail({
  run,
  sections,
  hasManual,
  orphanCount,
  cursorSlotIndex,
  pending,
  offset,
  expandAll,
  onToggleExpandAll,
  cutting,
  onPickCapture,
  onPickAnchor,
}: {
  run: BrowserRun;
  sections: SheetSection[];
  hasManual: boolean;
  orphanCount: number;
  cursorSlotIndex: number | null;
  pending?: ReadonlySet<number>;
  offset: number;
  expandAll: boolean;
  onToggleExpandAll: () => void;
  /** Captures whose zone is placed and whose picture has not been cut yet. */
  cutting: number;
  onPickCapture: (slotIndex: number) => void;
  onPickAnchor: (id: string) => void;
}) {
  return (
    <nav
      aria-label="Peta lembar periksa"
      className="w-full shrink-0 lg:sticky lg:max-h-[calc(100vh-8rem)] lg:w-[13rem] lg:overflow-y-auto"
      style={{ top: offset + 16 }}
    >
      {/* THE SHEET'S CONTROLS, AT THE TOP OF A STICKY COLUMN. They were a ruled
          row across the plate column, about 84px the operator scrolled past to
          reach the first picture on every visit. Here they cost the crops
          nothing: the rail is beside the sheet, not above it. */}
      <div
        className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b pb-2"
        style={{ borderColor: "var(--line)" }}
      >
        <Btn on={expandAll} onClick={onToggleExpandAll}>
          {expandAll ? "Ringkas yang sudah selesai" : "Buka semua potongan"}
        </Btn>

        {/* The legend reads the same words on every order, and pressing a
            decision key on a capture that is not on screen already says so out
            loud in the sheet's own live region. So it hides, and it hides
            behind a real button rather than a hover: this is the one control on
            the screen a keyboard operator most needs to be able to reach. */}
        <Hint label="Pintasan papan tik">
          <span className="flex flex-col gap-1.5">
            <span>
              <Key>j</Key> <Key>k</Key> pindah potongan, <Key>1</Key> terima,{" "}
              <Key>2</Key> gambar ulang, <Key>3</Key> bukan ini.
            </span>
            <span>
              Tombol keputusan tidak bekerja selama potongannya belum terlihat di
              layar.
            </span>
          </span>
        </Hint>

        {/* A MEASUREMENT OF THIS RUN, so it never hides. A picture that has
            not appeared cannot have been looked at, which is also why each
            section's bulk accept refuses while any of its own crops is still
            being cut, and why a decision key over an undrawn capture scrolls
            instead of deciding. */}
        {cutting > 0 ? (
          <span
            className="w-full text-[0.8125rem]"
            style={{ color: "var(--ink)" }}
          >
            {cutting} potongan belum selesai digambar.
          </span>
        ) : null}
      </div>

      {/* Below 1024px there is no room for a column beside the sheet, so the
          rail lies down into a strip above it and drops the labels: the denah
          and the mark are what carry the pattern, and both survive at 34px. */}
      <div className="flex gap-6 overflow-x-auto pb-2 lg:flex-col lg:gap-4 lg:overflow-x-visible lg:pb-0">
        {sections.map((section) => (
          <div key={section.title} className="flex shrink-0 flex-col gap-1.5">
            <button
              type="button"
              onClick={() => onPickAnchor(`bagian-${slug(section.title)}`)}
              className="lt-figure w-full text-start text-[0.8125rem] font-bold"
              style={{ color: "var(--ink-2)" }}
            >
              {section.title}
            </button>

            <ul className="flex gap-2 lg:flex-col lg:gap-0.5">
              {section.entries
                .filter((entry) => entry.def.fillable)
                .flatMap((entry) => rowsFor(entry, section.title))
                .map((row, i) => (
                  <li key={`${section.title}-${i}`}>
                    <RailRowButton
                      run={run}
                      sectionTitle={section.title}
                      row={row}
                      pending={pending}
                      isCursor={
                        row.capture !== null &&
                        row.capture.slotIndex === cursorSlotIndex
                      }
                      onPick={onPickCapture}
                    />
                  </li>
                ))}
            </ul>
          </div>
        ))}

        {hasManual || orphanCount > 0 ? (
          <div className="flex shrink-0 flex-col justify-end gap-1">
            {hasManual ? (
              <button
                type="button"
                onClick={() => onPickAnchor("bagian-diisi-manual")}
                className="text-start text-[0.8125rem]"
                style={{ color: "var(--ink-3)" }}
              >
                Bagian yang diisi manual
              </button>
            ) : null}
            {orphanCount > 0 ? (
              <button
                type="button"
                onClick={() => onPickAnchor("bagian-di-luar-templat")}
                className="text-start text-[0.8125rem]"
                style={{ color: "var(--gap)" }}
              >
                Tidak masuk dokumen ({orphanCount})
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </nav>
  );
}

/**
 * One capture in the rail: the plan of its page, and the state it is in.
 *
 * The denah is the whole point of this column. Twelve of them stacked answer
 * "is every crop landing at the top of its page?" and "do three captures cite
 * one page?" by shape, in one sweep, which no arrangement of page numbers
 * does. A capture with no zone gets `Missing` instead, a different silhouette,
 * so a fresh run reads as untouched rather than as twelve blank pages.
 */
function RailRowButton({
  run,
  sectionTitle,
  row,
  pending,
  isCursor,
  onPick,
}: {
  run: BrowserRun;
  sectionTitle: string;
  row: RailRow;
  pending?: ReadonlySet<number>;
  isCursor: boolean;
  onPick: (slotIndex: number) => void;
}) {
  const capture = row.capture;
  const zone = capture?.state.zone;
  const resolved = zone ? resolvePage(run, zone.pageIndex) : null;
  const status = capture?.state.status ?? "pending";
  const caption = capture
    ? capture.caption
    : `potongan ${row.ordinal} dari ${row.total}`;
  const where = resolved
    ? `, halaman ${resolved.pageInDoc + 1} dari ${resolved.pagesInDoc}`
    : "";

  return (
    <button
      type="button"
      disabled={!capture}
      onClick={() => capture && onPick(capture.slotIndex)}
      aria-label={`${sectionTitle}, ${caption}, ${STATUS_WORDS[status]}${where}`}
      aria-current={isCursor ? "true" : undefined}
      title={`${caption}${where}`}
      className="flex w-full items-center gap-2 rounded-[2px] px-1 py-1 text-start disabled:cursor-default"
      style={
        isCursor
          ? { background: "color-mix(in oklch, var(--ink), transparent 90%)" }
          : undefined
      }
    >
      {/* The graphics are hidden from assistive technology because the button
          already carries the whole row as one label; announcing the plan and
          the mark separately would read every row three times. */}
      <span aria-hidden="true" className="flex items-center gap-2">
        {zone && resolved ? (
          <Denah page={resolved.page} cut={zone.box} size="sm" label={caption} />
        ) : (
          <Missing height={34} label={caption} />
        )}
        <Mark
          status={status}
          saved={capture ? !pending?.has(capture.slotIndex) : true}
        />
      </span>
      <span
        className="lt-figure hidden min-w-0 flex-1 truncate text-[0.75rem] lg:block"
        style={{ color: "var(--ink-2)" }}
      >
        {capture ? capture.fieldLabel : caption}
        {row.total > 1 ? (
          <span style={{ color: "var(--ink-3)" }}> {row.ordinal}</span>
        ) : null}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * The pieces below the sheet's own hierarchy.
 * ------------------------------------------------------------------ */

/** A key in the shortcut legend. Mono, because it is a thing to be typed. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd
      className="lt-figure rounded-[2px] border px-1 text-[0.75rem]"
      style={{ borderColor: "var(--line)", color: "var(--ink)" }}
    >
      {children}
    </kbd>
  );
}

/**
 * The second click of a bulk accept.
 *
 * It names every field it would accept, because "Terima semua 4 di KB" names a
 * count and a section and no evidence at all, and the whole hazard is that one
 * of those four is a crop of the wrong page. It refuses while a crop is still
 * being cut for the same reason: a picture that has not appeared cannot have
 * been looked at, and this is the one control that accepts several at once.
 */
function BulkConfirm({
  ref,
  section,
  indexes,
  undrawn,
  onCancel,
  onCommit,
}: {
  ref: Ref<HTMLDivElement>;
  section: SheetSection;
  indexes: number[];
  undrawn: number;
  onCancel: () => void;
  onCommit: () => void;
}) {
  // Named from `entry.states`, which is where `proposedIndexesIn` reads the
  // indexes from too. Never from the state keys: a two-capture slot is keyed
  // `<slot>#1` / `#2`, which equals no `SlotDef.key`, and deriving either half
  // of this pair that way has already shipped a button that offered to accept
  // two proposals in a section holding three.
  const names = new Map<number, string>();
  for (const entry of section.entries) {
    const total = Math.max(entry.required, entry.states.length);
    entry.states.forEach((placed, i) => {
      names.set(placed.index, captionFor(entry, i + 1, total));
    });
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label={`Konfirmasi terima semua usulan di ${section.title}`}
      className="lt-panel flex flex-col gap-3 p-4"
    >
      <p className="max-w-[74ch] text-sm" style={{ color: "var(--ink)" }}>
        Anda akan menerima {indexes.length} usulan di {section.title} sekaligus,
        tanpa membukanya satu per satu. Potongan yang belum Anda lihat ikut
        diterima, dan potongan yang belum diperiksa di dalam dokumen yang
        ditandatangani adalah persis kegagalan yang dicegah langkah ini.
      </p>

      <ul className="lt-figure flex flex-col gap-1 text-[0.8125rem]">
        {indexes.map((index) => (
          <li key={index} style={{ color: "var(--ink)" }}>
            {names.get(index) ?? `bagian ke-${index + 1}`}
          </li>
        ))}
      </ul>

      {undrawn > 0 ? (
        <Notice tone="stop">
          {undrawn} dari {indexes.length} potongan belum tampil di layar, jadi
          belum bisa diterima sekaligus. Tunggu gambarnya muncul, atau putuskan
          satu per satu di bawah.
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Btn
          tone="primary"
          data-confirm=""
          disabled={undrawn > 0}
          onClick={onCommit}
        >
          Ya, terima {indexes.length} usulan ini
        </Btn>
        <Btn onClick={onCancel}>Batal</Btn>
      </div>
    </div>
  );
}

/**
 * The sections nothing can be found for: one ruled line each, and nothing else.
 *
 * Four of the template's twelve sections hold only `fillable: false` slots and
 * three hold no slots at all, so seven of them ask the operator for nothing.
 * As full sections they were most of the scroll length of the primary screen,
 * carrying the same headings and the same weight as the five that hold work.
 * They are still ACCOUNTED FOR, by name, because they do appear in the
 * exported packet and the operator is the one who fills them.
 */
function ManualLines({ rows }: { rows: { title: string; fields: string }[] }) {
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col">
        {rows.map((row, i) => (
          <li
            key={`${row.title}-${i}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b py-1.5"
            style={{ borderColor: "var(--line)" }}
          >
            <span
              className="lt-figure text-[0.875rem]"
              style={{ color: "var(--ink-2)" }}
            >
              {row.title}
            </span>
            <span
              className="lt-figure text-[0.8125rem]"
              style={{ color: "var(--ink-3)" }}
            >
              {row.fields}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Captures the exporter will not place: an integrity notice, last.
 *
 * The tool is document-agnostic and the template can be edited between runs,
 * so a stored run can outlive the slot list that made it. These are listed
 * because a confirmed capture quietly vanishing from the deliverable is the
 * failure this whole product is organised against. The consequence leads; the
 * key, which explains it to a developer and not to an operator, sits behind
 * the disclosure.
 */
function Orphans({
  run,
  states,
  offset,
}: {
  run: BrowserRun;
  states: SlotState[];
  offset: number;
}) {
  return (
    <section
      id="bagian-di-luar-templat"
      className="flex flex-col gap-3"
      style={{ scrollMarginTop: offset + 16 }}
    >
      <h2 className="lt-title">Potongan yang tidak akan masuk ke dokumen</h2>

      <Notice tone="stop">
        {/* The count and the reason stay: both are what this run actually did.
            Only the sentence explaining why the list exists at all, which is
            true of every run this product will ever have, is behind the mark. */}
        {states.length} potongan di pekerjaan ini tidak akan muncul di DOKUMEN
        VALIDASI. Bagiannya sudah tidak ada di templat, jadi tidak ada tempat
        untuk memasangnya.{" "}
        <Hint label="Kenapa daftar ini ada">
          Daftar ini ada supaya tidak ada keputusan Anda yang hilang tanpa Anda
          tahu.
        </Hint>
      </Notice>

      <ul className="flex flex-col">
        {states.map((state, i) => {
          const zone = state.zone;
          const resolved = zone ? resolvePage(run, zone.pageIndex) : null;
          const name = state.label || state.key;
          return (
            <li
              key={`${state.key}-${i}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b py-2"
              style={{ borderColor: "var(--line)" }}
            >
              <span aria-hidden="true">
                {zone && resolved ? (
                  <Denah
                    page={resolved.page}
                    cut={zone.box}
                    size="sm"
                    label={name}
                  />
                ) : (
                  <Missing height={34} label={name} />
                )}
              </span>
              <Mark status={state.status} />
              <span
                className="lt-figure text-[0.875rem]"
                style={{ color: "var(--ink)" }}
              >
                {name}
              </span>
              {resolved ? (
                <span
                  className="lt-figure text-[0.8125rem]"
                  style={{ color: "var(--ink-2)" }}
                >
                  hal {resolved.pageInDoc + 1}/{resolved.pagesInDoc}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      <TechnicalDetail>
        {states.map((state) => state.key).join("\n")}
      </TechnicalDetail>
    </section>
  );
}
