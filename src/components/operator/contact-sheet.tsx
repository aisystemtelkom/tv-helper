"use client";

/**
 * LEMBAR PERIKSA: every capture the packet will carry, in template order.
 *
 * ONE CAPTURE IS IN FOCUS AND EVERY OTHER ONE IS A ROW. That is the whole
 * shape of this screen and it is what the client asked for by name: the sheet
 * used to render every capture of every section as a full plate at once, which
 * is a metre of scroll on arrival and reads as a program that shows everything
 * because nobody decided what mattered. The capture under the cursor renders as
 * the full `ProposalPlate`, picture and all; the rest collapse to one line each
 * carrying the plan of their page, their state mark, their name and their page
 * reference. NOTHING IS HIDDEN BY THIS, only made small: every capture still
 * has a row, still says which state it is in, and still shows the shape of the
 * page it was cut from.
 *
 * That last clause is load-bearing, because the obvious version of "show less"
 * here is a filter, and a filter is how an unreviewed capture disappears. The
 * argument for a contact sheet is that a SYSTEMATIC failure (every crop landing
 * at the top of its page, three captures citing one page, every range running
 * on into a footer) is visible in one sweep. A column of rows each carrying its
 * own denah is that sweep, and it is now the whole sheet rather than a rail
 * beside it.
 *
 * THE INDEX RAIL IS GONE, AND ITS ARGUMENT SURVIVED IT. The rail existed to
 * carry one `Denah` per capture in a sticky column, because the plates were too
 * tall to compare: it replaced twelve identical anchor pills that could say
 * nothing about the evidence. Once every settled capture is one line, the rail
 * and the sheet were two lists of the same twelve things side by side, which is
 * the overload the client named. The denah moved INTO the row, so the stack of
 * silhouettes is intact and there is one list instead of two. A capture with no
 * zone is still a `Missing` hatch, a deliberately different shape, because on a
 * fresh run that is every row and it is the first thing a new operator sees.
 *
 * EVERY SECTION IS A SLAB AND ITS NAME IS THE KOP. The packet's own structure
 * is the only grouping this screen is allowed to invent, so the docx sections
 * are the blocks and the kop carries what each one still owes at its right. The
 * kop is the status channel: a 4px amber rule down its leading edge over a 12%
 * tint of its own ground while a section holds a proposal, the same in red when
 * one of its captures can never produce a picture. That reads down a column of
 * stacked slabs at a glance and costs no component a rule to remember. It is
 * deliberately NOT a bar of saturated colour under light text -- the leading
 * rule is the loudest of the three channels the kop has and the one that
 * survives a fast scroll. Red outranks amber, exactly as `owedBy` orders them
 * in the plate: a decision the operator cannot make is not work waiting, it is
 * something broken.
 * `data-owes="done"` is deliberately unused: it paints the kop petrol, and this
 * design's promise is that a finished packet is a screen with NO colour left on
 * it. A section with nothing owed says so in words instead.
 *
 * THE NON-FILLABLE SET IS DEMOTED HARD. `AO_TEMPLATE` declares 24 slots and
 * only 11 of them can be backed by a document; three sections declare no slots
 * at all. Rendering those as plates made more than half of the operator's
 * primary screen furniture they had to scroll past to find work. A slot no PDF
 * can back is one ruled line; a SECTION in which nothing can be backed never
 * reaches a plate at all, because a heading and a paragraph of guidance about
 * crops that will never exist is furniture with a title. Those are gathered
 * into one slab at the end, one line per section, and the space goes to the
 * crop.
 *
 * THE SHEET'S OWN CONTROLS ARE ONE QUIET ROW. Expand-all, the keyboard legend
 * and the count of crops still being cut used to be about 84px of chrome across
 * the top of the plate column, then a block at the head of the rail. They are
 * one right-aligned row now. The legend is behind a question mark, because it
 * reads the same words on every order and the app says the same thing out loud,
 * in a live region, at the moment a decision key is refused. The count of crops
 * still being cut did NOT hide: it is a measurement of this run, and a picture
 * that has not appeared cannot have been reviewed.
 *
 * SECTION GUIDANCE IS BEHIND THE KOP'S OWN MARK, by the same test.
 * `guidanceFor` rendered under all five headings, once above the first crop,
 * and said the identical two sentences on every order in this product's life.
 * What varies is which KIND of section this is, and the title already says that.
 *
 * BULK ACCEPT IS TWO STEPS ON PURPOSE, AND IT SITS BELOW THE ROWS. Accepting
 * several crops with one click is the shortest path in the whole product from
 * "nobody looked" to "a crop of the wrong page inside a document a validator
 * signs", so it is not the first thing the eye lands on in a section, the button
 * reveals a confirmation naming the fields it would accept, and only the second
 * click commits. It also refuses while any of those crops is still being cut: a
 * proposal whose picture has not appeared cannot have been reviewed.
 *
 * THE HEAD IS WHAT IS MISSING, and it is part of this screen now rather than a
 * phase of its own. `head` renders above the sheet, inside the scrolling column,
 * so it is the first thing read on arriving at Periksa and then it gets out of
 * the way; it is not pinned, because it is a briefing, not chrome. The sheet
 * stays agnostic about what is in it: today the shell passes the dokumen
 * tambahan block, and everything below still works with the prop absent. The one
 * thing this file owes it is the KEYBOARD: `j`, `k` and the decision keys are
 * ignored while focus is inside the head or inside any open dialog, because a
 * shortcut that fires on a screen the operator is not looking at decides
 * evidence they cannot see.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode, Ref } from "react";

import { AO_TEMPLATE } from "@/lib/forms/template";
import { resolvePage } from "@/lib/ui/evidence";
import type { BrowserRun, SlotState } from "@/lib/ui/runtime";
import {
  proposedIndexesIn,
  sheetSections,
  unmatchedStates,
  type SheetSection,
  type SlotAggregate,
  captureLabel,
  ordinalOf,
} from "@/lib/ui/slots";

import {
  Btn,
  Hint,
  Mark,
  Notice,
  STATUS_WORDS,
  StateWord,
  TechnicalDetail,
} from "./chrome";
import { Denah, Missing } from "./denah";
import { Paraf, Potongan } from "./icons";
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
  /** The field name, plus the capture ordinal when the slot holds several. */
  caption: string;
  state: SlotState;
};

/** One collapsed line of the sheet. `capture` is null for one the run never got. */
type SheetRow = {
  plateKey: string;
  caption: string;
  ordinal: number;
  capture: Capture | null;
};

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * A label the operator can read.
 *
 * `konfigurasi.quote` is declared as `{{quote}}`, a token the exporter
 * substitutes. Printing it raw leaks the template's own syntax onto the screen,
 * so it is named by the sample's own name for that row instead. `Quote` is one
 * of the header fields `docs/ui-bahasa.md` fixes as transcribed, not invented.
 */
function displayLabel(label: string): string {
  return /^\{\{.+\}\}$/.test(label) ? "Quote" : label;
}

function captionFor(entry: SlotAggregate, ordinal: number): string {
  const label = displayLabel(entry.def.label);
  return captureLabel(label, ordinal);
}

/**
 * Every capture of one slot, ONE ROW PER CAPTURE THE RUN ACTUALLY HOLDS.
 *
 * IT USED TO INVENT ROWS. `Math.max(entry.required, entry.states.length)` drew
 * a row for every capture `SlotDef.crops` declared, so the ToP bagian showed a
 * second, permanently empty row on a contract holding one ToP, the operator
 * report this whole feature comes from. A lanjutan is discovered now, so a row
 * appears when a picture does.
 *
 * The one row with no capture behind it is still real: a slot the template
 * declares that the run has never seen, which happens when a stored run
 * outlives the slot list that made it. It says so rather than being dropped,
 * and it opens the plate that offers to draw it.
 *
 * `ordinal` is the capture's own number, not its position: after a rejected
 * lanjutan is removed, ordinals legitimately have a gap and renumbering them
 * would relabel a picture the operator already accepted.
 */
function rowsFor(entry: SlotAggregate, sectionTitle: string): SheetRow[] {
  const label = displayLabel(entry.def.label);

  if (entry.states.length === 0) {
    return [
      { plateKey: entry.def.key, caption: label, ordinal: 1, capture: null },
    ];
  }

  return entry.states.map((placed) => {
    const ordinal = ordinalOf(placed);
    const caption = captionFor(entry, ordinal);
    return {
      plateKey: entry.def.key,
      caption,
      ordinal,
      capture: {
        slotIndex: placed.index,
        plateKey: entry.def.key,
        sectionTitle,
        caption,
        state: placed.state,
      },
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
    ? "Potongan di sini satu halaman penuh, memang begitu bentuknya. Periksa satu hal: halamannya benar atau tidak."
    : "Potongan di sini area di dalam halaman. Periksa halamannya, lalu apakah areanya memuat seluruh keterangan.";
}

/**
 * How far down the page a sticky application strip reaches.
 *
 * MEASURED, never assumed. The sheet used to scroll to a fixed `scroll-mt-24`
 * (96px) while the strip above it wraps to two or three rows on a 1366px panel,
 * which is the width half this audience works on: scrolling a capture into view
 * then put its kop and its controls UNDER the strip, and the operator landed
 * mid-plate with no idea which section they were in. A `ResizeObserver` costs
 * nothing and cannot drift from the header it is measuring.
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
 * The slab, and the kop that opens it.
 * ------------------------------------------------------------------ */

/**
 * THE KOP'S OWN MARK TAKES THE BAR'S INK, AND THE STYLESHEET NOW OWNS THAT.
 *
 * The defect is worth keeping on the record because it is the kind that gets
 * re-derived: `.lt-hint` is drawn in `--ink-3`, a token for text on the table,
 * and a kop that reports something is a tint of its own block, so a fixed token
 * there is wrong on one of the two grounds. This file used to carry a `KOP_INK`
 * constant that rebound `--ink` and `--ink-3` to `currentColor` on the span
 * holding the mark.
 *
 * It rebound TWO of the five tokens a coloured kop has to move, and it rebound
 * them unconditionally, so on a plain kop the question mark came out at full
 * ink instead of `.lt-hint`'s own quiet value. `.lt-kop[data-owes] > *` in
 * `globals.css` now rebinds all five, on the bar's children and never on the
 * bar itself (the bar's own fill is written in terms of `--mark` and `--gap`,
 * so rebinding them on the element resolves its background to near-white and
 * silently deletes the status channel). Every kop in the product gets it, and a
 * component that forgets cannot be wrong any more. The panel is portalled out
 * of the bar, so it keeps the table's own values either way.
 */

/**
 * EVERY BLOCK ON THIS SCREEN IS A SLAB, and every slab opens with a kop.
 *
 * The kop carries the block's name and, at its right, what the block still owes.
 * That right-hand figure is the block's whole status in words, and the leading
 * rule and faint tint `data-owes` puts on the bar are the same fact at a
 * glance: amber while a decision is owed, red for a fault. A block with neither
 * is the neutral case and most of them are.
 */
function Slab({
  id,
  headingId,
  title,
  voice = "document",
  owes,
  meta,
  hint,
  style,
  children,
}: {
  id?: string;
  headingId: string;
  title: string;
  /**
   * Whose words the title is. `document` is the packet quoted verbatim (`KB`,
   * `BA Permintaan`), which is the mono's whole job; `app` is this interface
   * naming a block of its own, and mono there would only be making a small
   * label look technical, which is the habit the type rule removed.
   */
  voice?: "document" | "app";
  owes?: "decision" | "fault";
  /** What this block still owes, at the kop's right. */
  meta?: ReactNode;
  hint?: ReactNode;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className="lt-slab"
      style={style}
    >
      <div className="lt-kop" data-owes={owes}>
        {/* The size and weight are the kop's own, restated rather than
            inherited: a heading that falls back to a browser default here
            would break the bar. The kop is NOT uppercase and not tracked out,
            so nothing here has to undo either. */}
        <h2
          id={headingId}
          className={`min-w-0 truncate text-[0.8125rem] font-bold ${
            voice === "document" ? "lt-figure" : ""
          }`}
        >
          {title}
        </h2>
        {hint ? <span className="flex items-center">{hint}</span> : null}
        {/* `.lt-kop-right` is the system's own place for what a block owes, so
            every kop in the product lands it on the same pixel. */}
        {meta ? <span className="lt-kop-right shrink-0">{meta}</span> : null}
      </div>
      <div className="lt-slab-body">{children}</div>
    </section>
  );
}

/** A figure inside a kop: mono, so counts line up down the column of slabs. */
function KopFigure({ children }: { children: ReactNode }) {
  return <span className="lt-figure font-bold">{children}</span>;
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

  /** Which section's bulk accept is waiting for its second click. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /**
   * Every capture open at full size.
   *
   * The sheet keeps ONE capture in focus, which is the whole density argument.
   * This is the override, and it exists for one moment: the pass an operator
   * makes before export, when every crop has to be visible again whatever its
   * state.
   */
  const [expandAll, setExpandAll] = useState(false);
  /**
   * THE CURSOR DECIDES WHICH CAPTURE IS THE PICTURE ON THIS SCREEN, so it opens
   * on the first one that owes a decision rather than on the first one in the
   * packet.
   *
   * It used to start at zero unconditionally, which was free while every plate
   * was rendered at once. Now it chooses the hero object: starting at zero puts
   * a bagian the operator settled yesterday in the one place the eye lands, and
   * makes them hunt for the work the amber kops are already pointing at. The
   * lazy initialiser runs once per run (`ContactSheet` keys on the run id), so
   * it is a starting position and never a rule that fights the operator.
   */
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      captures.findIndex((c) => c.state.status === "proposed"),
    ),
  );
  /**
   * A bagian opened by clicking its row rather than by the cursor.
   *
   * The cursor is a position in `captures`, and a bagian the run holds no state
   * for has no capture to point at: without this, the one row that offers to
   * draw a missing bagian could never be opened. `null` means "follow the
   * cursor", which is the normal case, and every cursor move clears it so the
   * two can never disagree about what is on screen.
   */
  const [pinned, setPinned] = useState<string | null>(null);
  const [said, setSaid] = useState<{ text: string; seq: number }>({
    text: "",
    seq: 0,
  });

  const say = useCallback((text: string) => {
    setSaid((prev) => ({ text, seq: prev.seq + 1 }));
  }, []);

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

  /**
   * A CAPTURE WHOSE PICTURE IS NEVER COMING, and the reason the collapse needs
   * this at all.
   *
   * A zone pointing at a page the run no longer holds, or at a page that will
   * not render, is a fault: `ProposalPlate` paints its own kop red for it. That
   * was enough while every plate was open. Collapsed, a capture whose crop
   * failed to cut is a row with a normal plan, a normal state word and a normal
   * page number, which is a wrong-and-quiet surface built by the very thing
   * meant to tidy up. So the row says it, and the section's kop carries it.
   */
  const cropFailed = useCallback(
    (slotIndex: number) => Boolean(thumbs.failed[String(slotIndex)]),
    [thumbs],
  );
  const faultedCapture = useCallback(
    (state: SlotState, slotIndex: number) => {
      const zone = state.zone;
      if (!zone) return false;
      return (
        resolvePage(run, zone.pageIndex) === null || cropFailed(slotIndex)
      );
    },
    [run, cropFailed],
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

  /**
   * The one bagian rendered as a plate. Everything else is a row.
   *
   * Expand-all suspends it: that pass wants every picture at once, so no single
   * capture is in focus and the key is null.
   */
  const openKey = expandAll ? null : (pinned ?? captures[at]?.plateKey ?? null);

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
      // Back to following the cursor: the plate that opens is this one.
      setPinned(null);
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
      setPinned(null);

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
        // row, so the sheet gets shorter under the operator's hand; jumping as
        // well, when the next thing to decide is already in front of them,
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
   * on evidence they cannot see, so the key opens the capture, scrolls it into
   * view and says so instead of deciding; pressing it again then decides. "On
   * screen" means two things now: this capture's bagian is the one rendered as
   * a plate, and its own top edge is sitting below the application strip with
   * room under it. The second half is because the picture is at the top of a
   * capture and a plate scrolled past its own top is showing the operator its
   * buttons, not its evidence. The first half is new with the collapse, and it
   * is the same rule: a row is a name and a plan, not a picture to rule on.
   *
   * The arrows only move the cursor when focus is already inside the sheet.
   * Swallowing ArrowDown globally would take normal page scrolling away from
   * everyone who has not engaged with the list; `j` and `k` scroll nothing, so
   * they need no such fence.
   *
   * THE HEAD AND ANY OPEN DIALOG TAKE THE KEYBOARD WITH THEM. These listeners
   * are on `window`, so without this a `1` typed while the operator is reading
   * the head, or while the dokumen tambahan dialog is open over the sheet,
   * would accept a crop that is behind a scrim and out of sight.
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
      // Closed, or open but scrolled off: one branch, because the remedy is the
      // same and so is the reason. Clearing the pin is what opens it, since the
      // cursor is on this capture already.
      const closed = !expandAll && openKey !== capture.plateKey;
      if (closed || !element || !topIsVisible(element, offset)) {
        if (closed) setPinned(null);
        if (element) scrollTo(element);
        say(
          `Potongan ${named} belum terlihat. Lembar digulir ke sana, tekan lagi untuk memutuskan.`,
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
            `Halaman untuk ${named} sudah tidak ada, jadi tidak ada yang bisa Anda nilai. Gambar ulang areanya.`,
          );
          return;
        }
        if (!drawn(capture.slotIndex)) {
          say(`Potongan ${named} belum selesai digambar.`);
          return;
        }
        routed.onAccept(capture.slotIndex);
        say(`${named} diterima.`);
        return;
      }
      routed.onReject(capture.slotIndex);
      say(`${named} ditolak, bagian ini masuk ke daftar yang belum ditemukan.`);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    at,
    captures,
    confirming,
    drawn,
    elementFor,
    expandAll,
    goTo,
    offset,
    openKey,
    routed,
    run,
    say,
    scrollTo,
  ]);

  const registerWrapper = (key: string) => (element: HTMLDivElement | null) => {
    if (element) wrappers.current.set(key, element);
    else wrappers.current.delete(key);
  };

  /** Open one bagian, from its own row. */
  const openRow = (row: SheetRow) => {
    const position = row.capture
      ? captures.findIndex((c) => c.slotIndex === row.capture?.slotIndex)
      : -1;
    if (position >= 0) {
      goTo(position);
      return;
    }
    // A bagian with no capture to put the cursor on. See `pinned`.
    setPinned(row.plateKey);
    const wrapper = wrappers.current.get(row.plateKey);
    wrapper?.focus({ preventScroll: true });
    if (wrapper) scrollTo(wrapper);
  };

  return (
    <div ref={rootRef} className="flex flex-col gap-6">
      {/* ABOVE THE SHEET, and inside the scroll. The head is what is still
          missing: it is read once on arrival and then it has to leave, so it
          must not become a sticky band above a sheet the operator is scrolling
          through. */}
      {head ? <div ref={headRef}>{head}</div> : null}

      {run.pages.length === 0 ? (
        <Notice tone="stop">
          Belum ada halaman di order ini. Muat berkas PDF dulu.
        </Notice>
      ) : null}

      {/* It does not name where the button is. The search moved to the Muat
          screen and a tambahan round starts from the head of this one, so a
          sentence pointing at one fixed place would be wrong half the time. */}
      {run.pages.length > 0 &&
      captures.length > 0 &&
      unsearchedCount === captures.length ? (
        <Notice>
          {unsearchedCount} potongan belum dicari.{" "}
          <Hint label="Cara mengisi lembar ini">
            Jalankan Proses untuk bagian itu, lalu usulannya muncul di sini.
          </Hint>
        </Notice>
      ) : null}

      {/* AN ABSENT WARNING IS NOT A CONFIRMATION, so the cleared state is said
          out loud, and it says in the same breath what is NOT cleared: an
          operator scanning a sheet with no amber left on it would otherwise
          conclude they were finished while two bagian with no evidence at all
          sat below. Not shown on a run nothing has searched yet, where "nothing
          is waiting on you" would be true and useless. */}
      {run.pages.length > 0 &&
      captures.length > 0 &&
      waitingCount === 0 &&
      unsearchedCount < captures.length ? (
        <Notice tone={gapCount > 0 ? "warn" : "info"}>
          Tidak ada usulan yang menunggu.
          {gapCount > 0 ? (
            <>
              {` ${gapCount} bagian belum ada buktinya. `}
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

      {/* THE SHEET'S OWN CONTROLS, one row, to the right of the work. A
          MEASUREMENT OF THIS RUN never hides, so the count of crops still being
          cut sits beside them at full ink: a picture that has not appeared
          cannot have been looked at, which is also why bulk accept refuses
          while one of its crops is still being cut and why a decision key over
          an undrawn capture scrolls instead of deciding. */}
      <div className="flex flex-wrap items-center justify-end gap-4">
        {cutting > 0 ? (
          <span className="me-auto text-[0.8125rem] text-ink">
            {cutting} potongan belum tampil.
          </span>
        ) : null}

        {/* NOT `on`, which paints a control amber. Amber means a decision is
            owed on a piece of evidence, and a view toggle owes nothing. */}
        <Btn
          data-flat="true"
          aria-pressed={expandAll}
          onClick={() => setExpandAll((was) => !was)}
        >
          <Potongan />
          {expandAll ? "Ringkas" : "Buka semua"}
        </Btn>

        {/* The legend reads the same words on every order, and pressing a
            decision key on a capture that is not on screen already says so out
            loud in the sheet's own live region. So it hides, and it hides
            behind a real button rather than a hover: this is the one control on
            the screen a keyboard operator most needs to be able to reach. */}
        <Hint label="Pintasan papan tik">
          <span className="flex flex-col gap-2">
            <span>
              <Key>j</Key> <Key>k</Key> pindah, <Key>1</Key> terima,{" "}
              <Key>2</Key> gambar ulang, <Key>3</Key> bukan ini.
            </span>
            <span>Tombol keputusan mati selama potongannya belum terlihat.</span>
          </span>
        </Hint>
      </div>

      {workSections.map((section) => {
        const waiting = proposedIndexesIn(section);
        const undrawn = waiting.filter((index) => !drawn(index)).length;
        const owed = section.entries.filter(
          (entry) =>
            entry.def.fillable &&
            entry.status !== "confirmed" &&
            entry.status !== "unfilled",
        ).length;
        /* A picture that is never coming, counted per capture. It outranks the
           count of proposals in the bar for the same reason `owedBy` does it in
           the plate: a decision the operator cannot make is not work waiting,
           it is something broken. */
        const faults = section.entries.reduce(
          (total, entry) =>
            total +
            (entry.def.fillable
              ? entry.states.filter((placed) =>
                  faultedCapture(placed.state, placed.index),
                ).length
              : 0),
          0,
        );

        return (
          <Slab
            key={section.title}
            id={`bagian-${slug(section.title)}`}
            headingId={`judul-${slug(section.title)}`}
            title={section.title}
            owes={
              faults > 0
                ? "fault"
                : waiting.length > 0
                  ? "decision"
                  : undefined
            }
            style={{ scrollMarginTop: offset + 16 }}
            hint={
              <Hint label={`Yang perlu diperiksa di ${section.title}`}>
                {guidanceFor(section.layout)}
              </Hint>
            }
            meta={
              faults > 0 ? (
                <>
                  <KopFigure>{faults}</KopFigure> gagal
                </>
              ) : waiting.length > 0 ? (
                <>
                  <KopFigure>{waiting.length}</KopFigure> usulan
                </>
              ) : owed > 0 ? (
                <>
                  <KopFigure>{owed}</KopFigure> belum selesai
                </>
              ) : (
                "selesai"
              )
            }
          >
            <ul className="flex flex-col gap-2">
              {section.entries.map((entry) => {
                const open = expandAll
                  ? entry.def.fillable
                  : openKey === entry.def.key;
                // Open and under the cursor are the same thing until
                // expand-all, which opens everything and leaves the keyboard
                // position where it was. The ink rule marks the ONE bagian the
                // keyboard is on, so it may not follow `open`.
                const isCursor = captures[at]?.plateKey === entry.def.key;

                return (
                  <li key={entry.def.key}>
                    <div
                      ref={registerWrapper(entry.def.key)}
                      id={`bagian-${slug(entry.def.key)}`}
                      tabIndex={-1}
                      // The group is the plate: a collapsed line is one button
                      // that already carries its own whole label, and wrapping
                      // it in a named group makes a screen reader read the
                      // bagian twice on every row of the sheet.
                      role={open ? "group" : undefined}
                      aria-label={
                        open ? displayLabel(entry.def.label) : undefined
                      }
                      // THE LEADING RULE, at the width and the shape the rest
                      // of the system draws one: 3px with rounded ends, which
                      // is `.lt-notice`'s rule exactly. It was a 2px square
                      // border, the only leading mark in the product not in
                      // that family (a kop's is 4px, a band's 4px, an
                      // advisory's a 3px pill), and a hard square 2px edge is
                      // the stamped-plate gesture the material rejects.
                      //
                      // It is always drawn, transparent when this is not the
                      // cursor, so a row does not shift sideways when the
                      // keyboard arrives on it.
                      className="rounded-s-[3px] border-s-[3px] ps-4"
                      style={{
                        scrollMarginTop: offset + 16,
                        // The cursor is INK, never amber. A keyboard position
                        // is not a decision that is owed, and letting the two
                        // share a colour makes a focused row read as work.
                        borderInlineStartColor: isCursor
                          ? "var(--ink)"
                          : "transparent",
                      }}
                    >
                      {!entry.def.fillable ? (
                        <ManualRow label={displayLabel(entry.def.label)} />
                      ) : open ? (
                        <ProposalPlate
                          run={run}
                          entry={entry}
                          thumbs={thumbs}
                          actions={routed}
                          pending={pending}
                          fresh={fresh}
                          expanded={expandAll}
                        />
                      ) : (
                        <div className="flex flex-col gap-2">
                          {rowsFor(entry, section.title).map((row) => (
                            <CaptureLine
                              key={`${row.plateKey}-${row.ordinal}`}
                              run={run}
                              row={row}
                              pending={pending}
                              cropFailed={
                                row.capture
                                  ? cropFailed(row.capture.slotIndex)
                                  : false
                              }
                              onOpen={openRow}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* BELOW THE ROWS, deliberately. Accepting several crops at once is
                the shortest path in this product to a wrong page inside a
                signed document, so it is not the first thing the eye lands on
                in a section. */}
            {waiting.length > 0 ? (
              confirming === section.title ? (
                <div className="mt-4">
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
                </div>
              ) : (
                <div className="mt-4 flex justify-end">
                  <Btn onClick={() => setConfirming(section.title)}>
                    {/* Terima leaves a paraf in the mark box, so the button
                        that accepts several at once draws the several parafs it
                        is about to leave. */}
                    <Paraf />
                    Terima semua {waiting.length} di {section.title}
                  </Btn>
                </div>
              )
            ) : null}
          </Slab>
        );
      })}

      {manualSections.length > 0 ? (
        <Slab
          id="bagian-diisi-manual"
          headingId="judul-diisi-manual"
          title="Diisi manual"
          voice="app"
          style={{ scrollMarginTop: offset + 16 }}
          meta={
            <>
              <KopFigure>{manualSections.length}</KopFigure> bagian
            </>
          }
          hint={
            /* The list below changes with the template; this explanation of it
               does not, so it goes behind the mark and the names stay. */
            <Hint label="Kenapa bagian ini dikirim kosong">
              Bagian ini tetap ada di DOKUMEN VALIDASI, lengkap dengan judul dan
              kotaknya, tapi dikirim kosong. Tidak ada dokumen order yang bisa
              mendukungnya, jadi Anda yang mengisinya setelah berkas hasil
              dibuat.
            </Hint>
          }
        >
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
        </Slab>
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
  );
}

/* ------------------------------------------------------------------ *
 * The collapsed line.
 * ------------------------------------------------------------------ */

/**
 * One capture, collapsed: the plan of its page, its state, its name, its page.
 *
 * The denah is the reason this line is worth more than a name. Twelve of them
 * stacked answer "is every crop landing at the top of its page?" and "do three
 * captures cite one page?" by shape, in one sweep, which no arrangement of page
 * numbers does. A capture with no zone gets `Missing` instead, a different
 * silhouette, so a fresh run reads as untouched rather than as twelve blank
 * pages.
 *
 * The page reference is a kotak isian rather than loose text, because it is the
 * figure this product's failure class is named after and twelve of them in one
 * column is how a page that does not belong gets caught.
 *
 * A FAULT IS NEVER COLLAPSED AWAY. The plate reports a picture that is not
 * coming on its own kop; a row has no kop, so it says it in the correction pen,
 * in the same words the plate uses, and the section's bar above it is red for
 * the same capture. Without that, a crop whose page failed to render is a row
 * that looks exactly like a healthy one.
 */
function CaptureLine({
  run,
  row,
  pending,
  cropFailed = false,
  onOpen,
}: {
  run: BrowserRun;
  row: SheetRow;
  pending?: ReadonlySet<number>;
  /** Its page would not render, so the picture is never arriving. */
  cropFailed?: boolean;
  onOpen: (row: SheetRow) => void;
}) {
  const capture = row.capture;
  const zone = capture?.state.zone;
  const resolved = zone ? resolvePage(run, zone.pageIndex) : null;
  const status = capture?.state.status ?? "pending";
  const where = resolved
    ? `, halaman ${resolved.pageInDoc + 1} dari ${resolved.pagesInDoc}`
    : "";
  const fault = !zone
    ? null
    : !resolved
      ? "Halamannya sudah tidak ada"
      : cropFailed
        ? "Halaman gagal dibuka"
        : null;

  return (
    <Btn
      data-flat="true"
      className="w-full justify-start gap-4 py-2 text-start"
      aria-label={`${row.caption}, ${STATUS_WORDS[status]}${where}${
        fault ? `. ${fault}` : ""
      }`}
      title={`${row.caption}${where}`}
      onClick={() => onOpen(row)}
    >
      {/* Hidden from assistive technology because the button already carries
          the whole row as one label; announcing the plan and the mark
          separately would read every row three times. */}
      <span aria-hidden="true" className="flex shrink-0 items-center gap-2">
        {zone && resolved ? (
          <Denah
            page={resolved.page}
            cut={zone.box}
            size="sm"
            label={row.caption}
            decorative
          />
        ) : (
          <Missing height={34} label={row.caption} decorative />
        )}
        <Mark
          status={status}
          saved={capture ? !pending?.has(capture.slotIndex) : true}
        />
      </span>

      <span className="lt-figure min-w-0 flex-1 truncate text-[0.875rem]">
        {row.caption}
      </span>

      {fault ? (
        <span className="shrink-0 text-[0.8125rem] font-semibold text-gap">
          {fault}
        </span>
      ) : (
        <StateWord status={status} />
      )}

      {resolved ? (
        <span className="lt-kotak">
          hal {resolved.pageInDoc + 1}/{resolved.pagesInDoc}
        </span>
      ) : null}
    </Btn>
  );
}

/**
 * A slot no PDF can back, inside a section that holds work.
 *
 * The current template has none: every slot in the five work sections is
 * fillable, and the thirteen that are not live in sections that hold nothing
 * else. The tool is document-agnostic though, so a mixed section is legal, and
 * a slot nobody will ever rule on is one quiet ruled line rather than a plate.
 */
function ManualRow({ label }: { label: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2">
      <div className="flex min-w-0 items-center gap-4">
        <span className="lt-hatch h-4 w-8 shrink-0" aria-hidden="true" />
        <span className="lt-figure truncate text-[0.875rem] text-ink-2">
          {label}
        </span>
      </div>
      <span className="text-[0.8125rem] text-ink-3">diisi manual</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The pieces below the sheet's own hierarchy.
 * ------------------------------------------------------------------ */

/**
 * A key in the shortcut legend. Mono, because it is a thing to be typed.
 *
 * IT IS THE PRESSED KEY THE WHOLE CONTROL FAMILY IS BUILT ON, at legend size.
 * It used to be a 2px outline with its own radius: a decorative hard border,
 * which is the half of the rejected system that had no business surviving, and
 * the one object in the product that literally IS a keycap wearing none of the
 * gesture every button on the screen wears.
 *
 * The face, the ink and the lip are the button's own tokens rather than a
 * hand-picked grey, so the key in the legend and the key under the operator's
 * finger are the same object; `--btn-ink` on `--btn` measures 6.36:1 and the
 * lip's 1.5px ring draws the boundary. `--plate-sm` is the shallower shelf the
 * system declares for exactly this, a pressed thing smaller than a control, and
 * `margin-bottom` reserves its height because a box-shadow takes no layout
 * space -- the same reserve `.lt-btn` makes, derived from the same `--lip-h` so
 * the two cannot drift.
 *
 * NOT a `.lt-btn`: this is a picture of a key, not a control, so it carries no
 * 44px hit area, no hover and no press. The radius is the figure step, which is
 * what a state box and a kotak isian already take, so all three read as one
 * family at one size.
 */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd
      className="lt-figure inline-flex min-w-7 items-center justify-center rounded-sm px-2 py-0.5 text-[0.8125rem] font-bold"
      style={{
        background: "var(--btn)",
        color: "var(--btn-ink)",
        boxShadow: "var(--plate-sm)",
        marginBottom: "calc(var(--lip-h) - 1px)",
      }}
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
 *
 * A SLAB INSIDE A SLAB CASTS NO PLATE. `.lt-slab-flat` keeps the edge and drops
 * the offset, so a nested block sits on the docket rather than lifting off it.
 * It still opens with a kop, and that kop owes a decision: this block IS the
 * question, so it is the one thing on the section that is waiting on a click.
 * The bar is named by a span rather than a heading, because the group already
 * carries the name for a screen reader and a fourth heading level here would
 * put a rung in the outline that leads nowhere.
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
    entry.states.forEach((placed) => {
      names.set(placed.index, captionFor(entry, ordinalOf(placed)));
    });
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label={`Konfirmasi terima semua usulan di ${section.title}`}
      className="lt-slab-flat"
    >
      <div className="lt-kop" data-owes="decision">
        <span className="min-w-0 flex-1 truncate">
          Terima semua di {section.title}
        </span>
        <span className="lt-kop-right shrink-0">
          <span className="lt-figure font-bold">{indexes.length}</span> usulan
        </span>
      </div>

      <div className="lt-slab-body flex flex-col gap-4">
        {/* THE CONSEQUENCE STAYS ON SCREEN. What went behind the mark is the
            argument for why this control asks twice, which reads word for word
            the same on every order; what a click does here does not. */}
        <p className="max-w-[74ch] text-[0.875rem] text-ink">
          Menerima {indexes.length} usulan di {section.title} sekaligus.
          Potongan yang belum Anda lihat ikut diterima.{" "}
          <Hint label="Kenapa ini ditanya dua kali">
            Potongan yang belum diperiksa di dalam dokumen yang ditandatangani
            adalah persis kegagalan yang dicegah langkah ini.
          </Hint>
        </p>

        {/* ONE RULED BOX PER NAME, which is what the rest of the product does
            with a figure quoted out of a document: the page reference on every
            collapsed row, the berkas and baris of every citation. A bare mono
            list read as a code listing, and this is a list the operator is
            asked to READ, one line at a time, before pressing the one control
            that can accept several crops at once. Stacked rather than wrapped,
            so each name keeps its own line and a long one cannot be split
            across a wrap from its neighbour. */}
        <ul className="flex flex-col items-start gap-2">
          {indexes.map((index) => (
            <li key={index} className="lt-kotak">
              {names.get(index) ?? `bagian ke-${index + 1}`}
            </li>
          ))}
        </ul>

        {undrawn > 0 ? (
          <Notice tone="stop">
            {undrawn} dari {indexes.length} potongan belum tampil, jadi belum
            bisa diterima sekaligus. Tunggu, atau putuskan satu per satu.
          </Notice>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Btn
            tone="primary"
            data-confirm=""
            disabled={undrawn > 0}
            onClick={onCommit}
          >
            Ya, terima {indexes.length}
          </Btn>
          <Btn onClick={onCancel}>Batal</Btn>
        </div>
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
    <ul className="flex flex-col">
      {/* A HAIRLINE, NOT A 2px RULE. `--line` is separation between content and
          nothing else, and a 2px border used to divide a list is the decorative
          hard edge the material rejects. Seven of these stacked at 2px read as
          a stamped grid; at 1px they read as a register, which is what a list
          of sections the operator fills in by hand is. */}
      {rows.map((row, i) => (
        <li
          key={`${row.title}-${i}`}
          className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-b border-line py-2 last:border-b-0"
        >
          <span className="lt-figure text-[0.875rem] text-ink-2">
            {row.title}
          </span>
          <span className="lt-figure text-[0.8125rem] text-ink-3">
            {row.fields}
          </span>
        </li>
      ))}
    </ul>
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
 *
 * THE KOP CARRIES THE FAULT, so the sentence under it does not repeat it in
 * red. Two red objects for one fault is how a product teaches an operator that
 * red means nothing; the bar is the signal and the paragraph is the reason.
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
    <Slab
      id="bagian-di-luar-templat"
      headingId="judul-di-luar-templat"
      title="Tidak masuk dokumen"
      voice="app"
      owes="fault"
      style={{ scrollMarginTop: offset + 16 }}
      meta={
        <>
          <KopFigure>{states.length}</KopFigure> potongan
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* The count and the reason stay: both are what this run actually did.
            Only the sentence explaining why the list exists at all, which is
            true of every run this product will ever have, is behind the mark. */}
        <p className="max-w-[74ch] text-[0.875rem] text-ink">
          {states.length} potongan tidak akan masuk ke DOKUMEN VALIDASI.
          Bagiannya sudah tidak ada di templat.{" "}
          <Hint label="Kenapa daftar ini ada">
            Daftar ini ada supaya tidak ada keputusan Anda yang hilang tanpa
            Anda tahu.
          </Hint>
        </p>

        <ul className="flex flex-col gap-2">
          {states.map((state, i) => {
            const zone = state.zone;
            const resolved = zone ? resolvePage(run, zone.pageIndex) : null;
            const name = state.label || state.key;
            return (
              <li
                key={`${state.key}-${i}`}
                className="flex flex-wrap items-center gap-4"
              >
                <span aria-hidden="true" className="flex items-center gap-2">
                  {zone && resolved ? (
                    <Denah
                      page={resolved.page}
                      cut={zone.box}
                      size="sm"
                      label={name}
                      decorative
                    />
                  ) : (
                    <Missing height={34} label={name} decorative />
                  )}
                  <Mark status={state.status} />
                </span>
                <span className="lt-figure min-w-0 flex-1 truncate text-[0.875rem] text-ink">
                  {name}
                </span>
                {resolved ? (
                  <span className="lt-kotak">
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
      </div>
    </Slab>
  );
}
