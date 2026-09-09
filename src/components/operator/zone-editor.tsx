"use client";

/**
 * TANDAI AREA BUKTI: correcting a capture by dragging on the page.
 *
 * The design calls manual selection the TERMINAL STATE of the whole flow, not
 * a fallback, so this screen is built like a work surface rather than like a
 * dialog. THE PAGE IS THE ONE MEMORABLE OBJECT ON IT: it is the only full block
 * here, it is mounted on a stage inside a mat, and it takes as much of the
 * viewport as the readout beside it can spare. Everything else is furniture set
 * into the bench, because a screen that emphasises everything reads as a form.
 *
 * Three things here are requirements rather than polish:
 *
 *  - IT SNAPS TO OCR LINE BOUNDARIES. A crop that slices a line of text in
 *    half is never what anyone wants. Holding the modifier key gives free
 *    pixels, which is what a signature or stamp block needs, because it has no
 *    lines to snap to. The modifier is NAMED, and named per platform (Alt on
 *    Windows, Option on a Mac, which this project has to run on): an
 *    affordance nobody can see is not an affordance. It is named on the mark
 *    beside the toggle it belongs to rather than as standing prose under the
 *    bar, which is a place a person can point at rather than a sentence they
 *    have already stopped reading; a `Hint` is a real button that opens on
 *    hover, on focus and on tap, so it is still reachable from a keyboard and
 *    on a touchscreen.
 *  - THE OPERATOR CAN PICK ANY LOADED PAGE. Manual selection is the designed
 *    terminal state for a slot no document could fill, so the editor has to be
 *    reachable with no starting zone and let the operator go and find the
 *    region themselves.
 *  - OVERLAY GEOMETRY IS EXPRESSED IN PERCENTAGES OF THE PAGE, never in scaled
 *    pixels. The page image is fluid, so a pixel-based overlay would need a
 *    resize listener and would drift from the crop by however much that
 *    listener lagged, and a rectangle drawn a few pixels off the one that gets
 *    cut is a picture of a lie. Percentages also make the zoom control free:
 *    at any container width the same fractions land on the same page pixels.
 *
 * WHY `.lt-paper` IS ON THE SCROLL BOX AND NOT ON THE PAGE FRAME, which looks
 * backwards and is not: `.lt-paper` carries a border of its own (1.5px, and the
 * exact width is not the point), and `getBoundingClientRect` on the frame
 * reports the BORDER box while the page image fills the padding box. Moving the
 * class inward would put that offset between where the operator points and
 * where the rectangle lands, on the one screen whose entire job is that the
 * drawn rectangle and the cut rectangle are the same rectangle. The mat and the
 * stage supply the dark surround instead.
 *
 * WHAT THE REDESIGN CHANGED, and why none of it is cosmetic:
 *
 *  - The page picker was 27 identical buttons carrying a file name truncated
 *    at 18 characters, which is exactly where Indonesian scan names stop
 *    differing. It is now a strip of `Denah` plans, one per page: a signature
 *    block, a Pasal table and a printed email have completely different line
 *    patterns, so the operator finds the page by SHAPE instead of by reading
 *    27 near-identical strings. The number under each glyph is the page's
 *    number INSIDE ITS OWN SOURCE FILE, which is the only number a reviewer
 *    can act on; the number that gets STORED is the run-global position, via
 *    `zonePageRef`. Confusing those two has already shipped a wrong page
 *    reference once, in a cell note that named the run-global index.
 *  - The readout is the same citation register the review plate shows
 *    (`Cite` + `CiteAdvisories` over a real `Citation`), so a hand-drawn zone
 *    is held to the SAME visible standard as a machine-proposed one. It used
 *    to show a pixel count and two mono sentences, and none of the tells:
 *    interpolated line boundaries, a crop covering most of the page, a whole
 *    page capture. A hand-drawn zone is written straight to `confirmed`, so
 *    holding it to a looser standard than a proposal was backwards.
 *  - Guides no longer disappear on pointer-up, and they are derived from the
 *    CITATION rather than from a second, looser threshold. The old canvas drew
 *    a guide for every line overlapping the padded box by 1%, while the
 *    snapper cites lines overlapping the raw drag by `TOUCH_RATIO`. The
 *    picture therefore claimed lines the citation did not carry, which is this
 *    project's failure class in miniature.
 *  - EVERY CONTROL IS IN ONE BAR at the foot of the screen. The view steps and
 *    the whole-page capture used to sit under the picture and the commit in a
 *    bar, so the hand had three places to look. Only the per-line nudges
 *    stayed behind, beside the citation they edit, because they are an edit to
 *    the register rather than an action on the page.
 *
 * WHAT THE DENSITY PASS MOVED, AND THE LINE IT WOULD NOT CROSS.
 *
 * Four things here read word for word the same on every order, on every slot
 * and on every page: how to drag, what a saved area becomes, that the preview
 * is enlarged from the screen raster, and how the free-pixel modifier works.
 * The pass that put all four behind a `Hint` was followed by an operator
 * saying the question marks themselves had become the clutter, so two of the
 * four are now gone rather than hidden: HOW TO DRAG is drawn on the page
 * itself, in place, while there is no rectangle on it, and the note about the
 * preview's resolution explained how this app makes a picture rather than
 * anything a person decides. The two that stayed each change an answer. What a
 * saved area BECOMES says this screen has no second review step. The
 * free-pixel modifier is an affordance that is invisible until it is named,
 * which is a defect this screen has already shipped once.
 *
 * The transcript is a CLOSED disclosure for a stronger reason: OCR text can be
 * right while the rectangle is wrong, so reading the text instead of looking
 * at the picture is exactly the shortcut that lets a wrong page through.
 *
 * THE EDITOR NO LONGER CLOSES ON A COMMIT, AND THAT IS THE LANJUTAN LOOP.
 *
 * The operator asked for it in one sentence: "bisa pilih, ada lanjutan (next
 * page) atau enggak, sampe semua page ke-cover." A lanjutan is the REST OF ONE
 * BAGIAN carried onto the next page by a page break -- the sample's two ToP
 * pictures are items 1-3 and items 4-5 of one Pasal -- so the loop ends when
 * that bagian is complete, never when the document runs out of pages. Saving
 * therefore asks a question instead of leaving, and the answer either reopens
 * this editor on the next page with a whole-page draft armed or closes it.
 *
 * THE EDITOR IS STILL SINGLE-PAGE BY CONSTRUCTION. `pickPage` clears the draft
 * on every page change and `save` emits exactly one `Zone`; a chain is N
 * separate captures, each drawn and committed on its own page, and never a
 * multi-page draft. Every link but the first is minted by
 * `withDiscoveredCaptures`, which is the only thing in this codebase allowed to
 * allocate a `<key>#n`.
 *
 * WHY THE PAGE GOES READ-ONLY AFTER A COMMIT rather than the editor simply
 * closing: the rectangle on screen has to keep being the rectangle on disk
 * while the strip asks about it. So the drag, the per-line nudges, the
 * whole-page key and the commit all go down, each carrying its own reason, and
 * the only things left to press are the two answers and the way out.
 *
 * NOTHING MEASURED OFF THIS RECTANGLE MOVED, and that is the rule rather than
 * a judgement call. The citation register, every advisory under it (a whole
 * page, a crop covering most of one, interpolated line boundaries, a missing
 * line citation, lines visible but uncited), the two page notices, the refused
 * drag, the move warning naming both pages, and the reason the save is
 * disabled are all statements about THIS page and THIS drag. Putting any of
 * them behind a hover would be the wrong-and-quiet failure delivered by the
 * control brought in to tidy up.
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

import { unionBoxes } from "@/lib/pipeline/geometry";
import type { Line } from "@/lib/pipeline/geometry";
import { CROP_PADDING_PX } from "@/lib/pipeline/locate";
import type { Box } from "@/lib/pipeline/render";
import { continuationHint, nextPageInBerkas } from "@/lib/ui/continuation";
import type { ContinuationHint, NextPage } from "@/lib/ui/continuation";
import { pageToDisplayUrl } from "@/lib/ui/crops";
import {
  citeZone,
  hasLineCitation,
  resolvePage,
  textForLineRange,
  zonePageRef,
} from "@/lib/ui/evidence";
import type { BrowserRun, StoredPage, Zone } from "@/lib/ui/runtime";
import { captureOrdinalOf, slotKeyOf } from "@/lib/ui/runtime";
import { useRuntime } from "@/lib/ui/runtime-context";
import { templateSlots } from "@/lib/ui/slots";
import { useRunTemplate } from "@/lib/ui/use-run-template";
import {
  drawZone,
  isMeaningfulDrag,
  linesTouchedBy,
  normalizeBox,
  pageBounds,
  MIN_DRAG_PX,
  TOUCH_RATIO,
  type DrawnZone,
  type Point,
} from "@/lib/ui/snap";

import {
  Advisory,
  Btn,
  Cite,
  CiteAdvisories,
  Hint,
  Lede,
  Note,
  Notice,
  TechnicalDetail,
  shortenFileName,
} from "./chrome";
import { Denah } from "./denah";
import { HalamanUtuh, KunciKeBaris, Potongan } from "./icons";

export type EditorTarget = {
  /** Position in `run.slots`, or null for a capture the run does not hold yet. */
  slotIndex: number | null;
  slotKey: string;
  label: string;
  zone?: Zone;
  /**
   * THE CAPTURE THIS DRAWING CONTINUES, as a `SlotState.key`.
   *
   * Set only by the lanjutan loop below. It is what tells `saveZone` that this
   * save is a LINK -- appended under a fresh `<key>#n` ordinal by
   * `withDiscoveredCaptures`, which is the only thing allowed to mint one --
   * rather than capture 1 of the bagian named by `slotKey`. Writing a link the
   * ordinary way would store it under the parent's own key and one of the two
   * would silently disappear.
   *
   * Capture 1's path is untouched: absent here means exactly what it always
   * meant.
   */
  after?: string;
  /**
   * Which page to open on, when it is not the page the existing zone sits on.
   *
   * The lanjutan loop hands the operator the NEXT page. Without this the editor
   * would open on page 0 of the order and the whole "one keypress" case would
   * become a hunt through a 29-page strip for the page they were already
   * looking at.
   */
  startPageId?: string;
  /**
   * Open with a whole-page draft already drawn, so the common case is one
   * keypress.
   *
   * A lanjutan is the REST of a block, which starts at the top of its page and
   * usually carries the letterhead above it, so the whole page is right far
   * more often than any rectangle this app could guess. It is a DRAFT and not a
   * decision: the operator adjusts it or replaces it by dragging, and nothing
   * is stored until they press the commit.
   */
  armWholePage?: boolean;
};

/**
 * A rectangle the operator is working on.
 *
 * `mode` is wider than `DrawnZone["mode"]` by one member. A `Zone` reopened
 * from the run carries NO record of how it was arrived at, and the old editor
 * declared every reopened zone `"snapped"`, so a hand-drawn free-pixel capture
 * over a signature block came back claiming it followed whole lines, on the
 * one screen whose job is telling the operator exactly what they have.
 * `"existing"` says what is true: not recorded.
 */
type Draft = {
  box: Box;
  lineRange: [number, number];
  mode: DrawnZone["mode"] | "existing";
  /**
   * The operator ASKED for free pixels (the modifier was held, the toggle is
   * off, or they took the whole page) rather than snapping having quietly
   * fallen through for want of a line to snap to. The two look identical in
   * `mode` and mean opposite things to the person reading the readout: one is
   * a signature block captured on purpose, the other is a rectangle that did
   * not do what the toggle above it claims.
   */
  forced?: boolean;
};

type Zoom = "page" | "column" | "double";

/**
 * How the page image is sized inside the frame, per zoom step.
 *
 * Two words at most: these are settings, not sentences. None of them may
 * borrow "muat" or "satu halaman": "Muat" is the name of the ingest phase and
 * "tangkapan satu halaman" is the whole-page CAPTURE, so either word here
 * would read as an action on the document instead of on the view.
 */
const ZOOM_LABEL: Record<Zoom, string> = {
  page: "Pas layar",
  column: "Lebar kolom",
  double: "2x",
};

function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function seedFrom(zone: Zone): Draft {
  return { box: zone.box, lineRange: zone.lineRange, mode: "existing" };
}

/**
 * The whole-page draft the lanjutan loop opens with, or null when this target
 * asks for none.
 *
 * `snap: false` and `forced: true`, for the reason `takeWholePage` gives at
 * length: snapping would union the LINE boxes, which stops at the text and
 * drops the margins, so a draft offered as "the whole page" would quietly be
 * the text block. `forced` says the free pixels were asked for rather than
 * being a fall-through, which is what keeps the readout from claiming snapping
 * failed here.
 */
function armedDraft(
  pages: readonly StoredPage[],
  target: EditorTarget,
): Draft | null {
  if (!target.armWholePage || !target.startPageId) return null;
  const page = pages.find((p) => p.id === target.startPageId);
  if (!page) return null;
  return { ...drawZone(pageBounds(page), page, false), forced: true };
}

/** The lines a range cites, in reading order. */
function linesInRange(page: StoredPage, from: number, to: number): Line[] {
  if (from < 0 || to < from) return [];
  return page.lines
    .filter((l) => l.i >= from && l.i <= to)
    .sort((a, b) => a.i - b.i);
}

/**
 * A block of content: an edge, a body, and a kop that names it.
 *
 * THE KOP IS THE BLOCK'S STATUS CHANNEL, which is why `owes` lives here rather
 * than as a mark somewhere inside the body: a block waiting on the operator is
 * legible from across the room instead of being a small glyph they have to
 * hunt for. It is a tint of the block's own ground with a 4px rule down its
 * leading edge, never a bar of saturated hue under light text.
 *
 * `plate` PICKS THE MATERIAL, and the name survives from a system where a block
 * cast a hard offset shadow. Nothing casts one now: the flag chooses between a
 * full block (`.lt-slab`, lit along its top edge and floored along its bottom)
 * and furniture (`.lt-slab-flat`, the same work surface with the lighting taken
 * off and the control radius). Only the page gets the full block, so everything
 * else stays quieter than the one object that matters.
 *
 * Local to this file on purpose: it is this screen's layout, not a shared
 * primitive, and chrome.tsx is owned elsewhere.
 */
function Slab({
  name,
  owes,
  aside,
  plate = false,
  children,
}: {
  name: ReactNode;
  owes?: "decision" | "fault" | "done";
  /** The count or state this block owes, at the right of the kop. */
  aside?: ReactNode;
  plate?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`${plate ? "lt-slab" : "lt-slab-flat"} flex min-w-0 flex-col`}>
      <div className="lt-kop" data-owes={owes}>
        <h3 className="min-w-0">{name}</h3>
        {/* `lt-kop-right` rather than a hand-rolled `grow` on the title: the
            stylesheet declares the kop's right-hand slot, so every kop in the
            product puts its count or state in the same place. */}
        {aside ? (
          <span className="lt-kop-right flex shrink-0 items-center gap-2">
            {aside}
          </span>
        ) : null}
      </div>
      <div className="lt-slab-body flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * A figure quoted out of a document, in a ruled box.
 *
 * Never loose in a sentence: a file name and a page number are values the
 * operator MATCHES against something else (a folder on their own machine, the
 * page they are looking at), and this system sets those in a ruled box the way
 * a form prints a field. `title` carries the untruncated name, because
 * `shortenFileName` cuts the middle out of exactly the strings these scans
 * differ by.
 */
function Kotak({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="lt-kotak" title={title}>
      {children}
    </span>
  );
}

type PageGroup = {
  sourceId: string;
  name: string;
  pages: { page: StoredPage; ordinal: number }[];
};

/**
 * The run's pages, grouped by the document each came from.
 *
 * Built once per `run.pages` rather than per page: the old strip recomputed
 * every page's ordinal with a filter-and-indexOf inside its map, an O(n
 * squared) scan re-run on every pointermove-driven re-render of the editor.
 * This is the one place in this app where the frame budget matters, because
 * the operator is dragging a rectangle while it re-renders.
 */
function groupPages(run: BrowserRun): PageGroup[] {
  const groups: PageGroup[] = [];
  const byId = new Map<string, PageGroup>();
  for (const page of run.pages) {
    let group = byId.get(page.sourceId);
    if (!group) {
      group = {
        sourceId: page.sourceId,
        // A source whose name never arrived falls back to its id rather than
        // to an empty label: an unreadable identity is still an identity.
        name:
          run.sources.find((s) => s.id === page.sourceId)?.name ?? page.sourceId,
        pages: [],
      };
      byId.set(page.sourceId, group);
      groups.push(group);
    }
    group.pages.push({ page, ordinal: group.pages.length });
  }
  return groups;
}

/**
 * One page in the strip.
 *
 * MEMOISED, and that is not a micro-optimisation. The strip holds one plan per
 * page of the bundle (29 for the sample) and each plan is an SVG with one rect
 * per OCR line, so re-rendering all of them on every `pointermove` of a drag
 * is thousands of nodes per frame on the one screen where the frame budget is
 * the operator's aim. Only the open page's plan carries the live rectangle, so
 * only that one has a prop that changes mid-drag; the rest compare equal and
 * are skipped. `onPick` must therefore stay referentially stable, which is why
 * it is a `useCallback` in the editor.
 */
const PageGlyph = memo(function PageGlyph({
  page,
  ordinal,
  identity,
  current,
  cut,
  onPick,
}: {
  page: StoredPage;
  ordinal: number;
  identity: string;
  current: boolean;
  /** The current draft's box, and only ever on the page it was drawn on. */
  cut: Box | null;
  onPick: (id: string) => void;
}) {
  const unreadable = page.lines.length === 0;
  return (
    /* A CONTROL, SO IT IS THE SYSTEM'S CONTROL. This was a bare `<button>`
       carrying a hand-rolled 2px bottom border, which is two problems at once:
       twenty-nine of the busiest controls on this screen had NO resting
       boundary at all (WCAG 1.4.11 asks 3:1 of one), and the mark for "you are
       here" was a rule invented in this file. The flat key is the set's row
       control: `--line-control` is set at the 3:1 floor, hover raises it, and
       the press answers the finger.

       THE OPEN PAGE WEARS `data-on`, WHICH IS PETROL AND NOT AMBER. Amber means
       a decision is owed on a piece of evidence; where the operator happens to
       be standing is not that. Petrol is this system's "you are here" -- the
       phase step you are on, the run that is open -- and it carries dark ink
       like every saturated fill here. The number under the plan still goes to
       700, so selection is weight and face together rather than a hue alone,
       and `aria-current` carries it for anyone who sees neither. */
    <Btn
      data-flat="true"
      on={current}
      data-current={current ? "true" : undefined}
      aria-current={current ? "page" : undefined}
      aria-label={unreadable ? `${identity}, teks tidak terbaca` : identity}
      onClick={() => onPick(page.id)}
      className="h-auto shrink-0 flex-col px-2 py-2"
    >
      {/* A page whose OCR found nothing draws as a struck sheet rather than as
          a blank one, so the operator can see BEFORE drawing that snapping
          will have nothing to hold on to here.

          DECORATIVE, because the button around it already carries the file,
          the page and, on an unreadable page, the words "teks tidak terbaca".
          Announcing the plan as well reads the same page twice to anyone
          listening to the strip. */}
      <Denah
        page={page}
        cut={cut}
        size="sm"
        label={`denah halaman ${ordinal + 1}`}
        decorative
      />
      {/* `--ink` and `--ink-3` READ THROUGH THE KEY'S OWN LADDER, which is why
          this needs no special case for the selected face: `.lt-btn[data-on]`
          rebinds the ink tokens to the petrol face's dark ink, so the same two
          declarations land on the table's ink at rest and on the key's ink when
          it is on. */}
      <span
        className="lt-figure text-[0.8125rem] leading-none"
        style={{
          color: current ? "var(--ink)" : "var(--ink-3)",
          fontWeight: current ? 700 : 400,
        }}
      >
        {ordinal + 1}
      </span>
    </Btn>
  );
});

/**
 * The page picker, mounted on a mat because every plan on it is a picture of a
 * page. It gets no stage of its own: these glyphs are controls that happen to
 * be drawn from evidence, not evidence on display, and a second sunk frame
 * around a row of already bordered sheets is an edge carrying nothing.
 */
function PageStrip({
  groups,
  pageId,
  cut,
  onPick,
}: {
  groups: PageGroup[];
  pageId: string;
  /** The current draft's box, drawn on the plan of the page it belongs to. */
  cut: Box | null;
  onPick: (id: string) => void;
}) {
  const strip = useRef<HTMLDivElement | null>(null);

  // The editor can open on page 20 of 29. Bring the open page into view rather
  // than leaving the operator to hunt for the one already selected.
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>('[data-current="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pageId]);

  return (
    <div className="lt-mat">
      <div ref={strip} className="flex gap-6 overflow-x-auto">
        {groups.map((group) => (
          <section key={group.sourceId} className="flex shrink-0 flex-col gap-2">
            {/* The document, once, as a group heading. The old strip repeated a
                file name truncated at 18 characters on every button, which is
                exactly where these scan names stop differing. */}
            <h4 className="flex items-baseline gap-2">
              <span className="lt-figure text-[0.8125rem]" title={group.name}>
                {shortenFileName(group.name, 30)}
              </span>
              {/* "halaman" in full, not "hal". The glossary abbreviates it
                  only INSIDE a citation, and this is a count of the pages a
                  document holds, not a reference to one of them. */}
              <span className="lt-label">{group.pages.length} halaman</span>
            </h4>

            <div className="flex gap-2">
              {group.pages.map(({ page, ordinal }) => (
                <PageGlyph
                  key={page.id}
                  page={page}
                  ordinal={ordinal}
                  identity={`${group.name}, halaman ${ordinal + 1} dari ${group.pages.length}`}
                  current={page.id === pageId}
                  cut={page.id === pageId ? cut : null}
                  onPick={onPick}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * The picture that will be cut, without encoding one.
 *
 * The editor never showed the crop, which is odd on the screen where the crop
 * is authored: a swallowed footer line and a stamp cut in half stay invisible
 * until the docx is opened. This is the SAME image the canvas shows, scaled
 * and offset by percentages, so the region on screen is the region in the
 * rectangle by construction: no second canvas, no PNG encode, no second blob
 * to revoke.
 */
function CropPreview({
  url,
  page,
  box,
}: {
  url: string;
  page: StoredPage;
  box: Box;
}) {
  if (box.w <= 0 || box.h <= 0) return null;

  const wide = box.w >= box.h;
  const frame: CSSProperties = wide
    ? { width: "100%", aspectRatio: `${box.w} / ${box.h}` }
    : { height: "15rem", width: `${(15 * box.w) / box.h}rem` };

  return (
    <div className="lt-paper overflow-hidden" style={frame}>
      <div className="relative h-full w-full overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL
            rendered in this tab from a document that never leaves it. */}
        <img
          src={url}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute max-w-none"
          style={{
            width: pct(page.widthPx, box.w),
            height: pct(page.heightPx, box.h),
            left: `-${(box.x / box.w) * 100}%`,
            top: `-${(box.y / box.h) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}

/**
 * THE LANJUTAN QUESTION, asked once, right after a save.
 *
 * ## Why it is inline, solid and in flow
 *
 * The material rule in this product is that glass STAYS STILL while work
 * scrolls under it, and everything that moves with the work is solid and matte.
 * This strip is a piece of the work: it belongs to the potongan that was just
 * saved, it scrolls with it, and it goes away when it is answered. A
 * backdrop-filter here would also re-sample the backdrop every frame over the
 * page image beside it, which is the one surface on this screen where the frame
 * budget is the operator's aim.
 *
 * ## TWO KEYS, AND THE MISSING THIRD ONE IS A DECISION
 *
 * There is no "Nanti saja". Three reasons, and the last is the one that would
 * actually do damage:
 *
 *  - CLOSING THE EDITOR ALREADY IS "later". It is one key away, it is already
 *    on the screen, and it stamps nothing.
 *  - A THREE-KEY PANEL AFTER EVERY SAVE TRAINS DISMISSAL. This appears on every
 *    commit of every capture; the moment one of its keys means "make this go
 *    away", that key is the one that gets pressed, and the question stops being
 *    asked in any meaningful sense.
 *  - IT WOULD HAVE TO WRITE SOMETHING FALSE. The only records available are
 *    "diperiksa, tidak ada lanjutan" and nothing at all. `docs/ui-bahasa.md`
 *    reserves the first for a search that ACTUALLY looked past a potongan's
 *    page bottom, and a middle key would spend it on somebody deferring.
 *
 * ## The hint is free, and it is silent where it would be a tautology
 *
 * `continuationHint` is pure geometry over OCR the device already holds: no
 * model call, no network. It returns null for a whole-page capture, because a
 * capture that IS the page ends at that page's last content line BY
 * CONSTRUCTION -- see the reason written out in `src/lib/ui/continuation.ts`.
 * NOTHING is rendered for null: an absence of information dressed as a
 * recommendation is the wrong-and-quiet failure, built by the feature meant to
 * close one.
 */
function LanjutanStrip({
  next,
  hint,
  onTake,
  onNone,
}: {
  /** The page a lanjutan would sit on, or null on the last page of a berkas. */
  next: NextPage | null;
  hint: ContinuationHint | null;
  onTake: () => void;
  onNone: () => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);

  // The commit key is at the foot of a screen whose page block is 62vh tall, so
  // a strip appended below it can land under the fold on the very press that
  // produces it. This is not a scroll the operator asked for: it is the answer
  // to the key they just pressed, moved to where they are looking.
  useEffect(() => {
    box.current?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <div ref={box}>
      <Slab name="Lanjutan" owes="decision">
        {/* THAT THE SAVE LANDED IS SAID FIRST. The commit key is now down and
            the page can no longer be drawn on, and neither of those reads as
            "it is stored" on its own. */}
        <Lede>
          {next
            ? "Area tadi sudah disimpan. Apakah bagian ini bersambung ke halaman berikutnya?"
            : "Area tadi sudah disimpan. Halaman terakhir di berkas ini."}
        </Lede>

        {/* WHAT A LANJUTAN IS, AND WHAT IT IS NOT, in the same two-part shape
            the bagian's own catatan uses. Naming the look-alike is the half
            that catches the wrong answer: a bagian that merely CARRIES ON the
            subject is a new bagian, and capturing it here would file a second
            clause under this one's label. */}
        {next ? (
          <p className="lt-lede" style={{ color: "var(--ink)" }}>
            Lanjutan adalah sisa bagian yang sama, terpotong oleh pergantian
            halaman. Bukan bagian baru.
          </p>
        ) : null}

        {next ? (
          <div className="lt-mat flex flex-wrap items-start gap-4">
            {/* The plan of the page being offered, so the operator recognises
                it by SHAPE before reading a number: a signature block, a Pasal
                table and a letterhead look nothing like each other. */}
            <Denah
              page={next.page}
              size="md"
              label={`denah halaman ${next.pageInDoc + 1}`}
              decorative
            />
            <div className="flex min-w-0 flex-col gap-2">
              <Kotak title={next.sourceName}>
                {shortenFileName(next.sourceName, 24)} hal {next.pageInDoc + 1} /{" "}
                {next.pagesInDoc}
              </Kotak>

              {/* Quiet on purpose. The filter behind it fires on 7 of 12 human
                  crops and only 1 of those 7 actually continues, so it is a
                  cheap prompt to look, never a verdict; a `Note` is the
                  register this product keeps for exactly that. Nothing at all
                  is printed when it has nothing to say. */}
              {hint === "runs-on" ? (
                <Note>
                  Potongan tadi berhenti di dasar halaman, jadi bloknya mungkin
                  bersambung.
                </Note>
              ) : hint === "stops-short" ? (
                <Note>
                  Potongan tadi berhenti sebelum dasar halaman, jadi biasanya
                  tidak ada lanjutan.
                </Note>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {next ? (
            /* THE COMMON CASE IS ONE KEYPRESS: it opens the next page with the
               whole page already drawn, because a lanjutan starts at the top of
               its page and usually carries the letterhead above it. The
               operator can still redraw it before committing. */
            <Btn tone="primary" onClick={onTake}>
              <HalamanUtuh />
              Ambil halaman berikutnya
            </Btn>
          ) : null}
          <Btn onClick={onNone}>Tidak ada lanjutan</Btn>
        </div>
      </Slab>
    </div>
  );
}

export function ZoneEditor({
  run,
  target,
  onSave,
  onContinue,
  onNoContinuation,
  onCancel,
}: {
  run: BrowserRun;
  target: EditorTarget;
  /**
   * Stores the potongan and hands back THE KEY IT WAS STORED UNDER, or null
   * when nothing was stored.
   *
   * The key is what the two lanjutan answers are about, and for a link it is
   * MINTED BY THE WRITE: `withDiscoveredCaptures` allocates the next `#n`
   * ordinal, so this screen cannot know it in advance and must not guess. A
   * null says the write was refused and the shell has already said so; the
   * editor then has nothing to ask about.
   */
  onSave: (target: EditorTarget, zone: Zone, text: string) => string | null;
  /** Reopen on `pageId`, drawing the lanjutan of the capture keyed `after`. */
  onContinue: (after: string, pageId: string) => void;
  /**
   * A person looked past this capture and there is nothing there: stamp it and
   * close. Never called by closing the editor, which stamps nothing.
   */
  onNoContinuation: (key: string) => void;
  onCancel: () => void;
}) {
  const runtime = useRuntime();

  /**
   * The page the existing zone actually points at, or null when the run can no
   * longer resolve it.
   *
   * THE NULL CASE USED TO BE SILENT, AND IT WAS THE WORST DEFECT ON THIS
   * SCREEN. The page fell back to `run.pages[0]` while the draft was still
   * seeded from the unresolvable zone's box, so a rectangle from a missing
   * page was drawn over a different page, looked entirely normal, and saving
   * re-attributed that evidence to the first page of the run as `confirmed` /
   * `human`. That is precisely the crop-of-the-wrong-page a validator signs.
   * The fallback page now carries NO rectangle, and the loss is stated.
   */
  const origin = useMemo(
    // Memoised because `resolvePage` builds a fresh object on every call and
    // `seedFor` / `pickPage` below take it as a dependency: an identity that
    // changed every render would rebuild the page strip's callback, and with
    // it every page plan in the strip, on every pointermove of a drag.
    () => (target.zone ? resolvePage(run, target.zone.pageIndex) : null),
    [run, target.zone],
  );
  const originLost = Boolean(target.zone) && origin === null;
  /**
   * The armed whole-page draft, when the lanjutan loop opened this editor.
   *
   * Memoised on `run.pages` rather than on `run`, because every commit builds
   * `{ ...run, slots }` and keeps the SAME pages array: without that, saving a
   * capture would rebuild `seedFor`, and with it `pickPage`, and with that
   * every one of the 29 page plans in the strip.
   */
  const armed = useMemo(() => armedDraft(run.pages, target), [run.pages, target]);
  // `target.startPageId` outranks the zone's own page: the lanjutan loop hands
  // the operator the NEXT page, and a link target carries no zone to resolve.
  const startPageId =
    target.startPageId ?? origin?.page.id ?? run.pages[0]?.id ?? "";

  const [pageId, setPageId] = useState(startPageId);
  const [display, setDisplay] = useState<{ url: string; page: string } | null>(
    null,
  );
  /**
   * A render failure is stamped WITH THE PAGE IT BELONGS TO, and read back
   * against the open page.
   *
   * The old state was a bare string that nothing ever cleared, so one bad page
   * left a red notice sitting over every subsequent page for the rest of the
   * session, which teaches an operator to ignore it. Deriving it per page also
   * keeps the effect below free of a synchronous reset.
   */
  const [failed, setFailed] = useState<{ page: string; message: string } | null>(
    null,
  );
  const [snapMode, setSnapMode] = useState(true);
  const [zoom, setZoom] = useState<Zoom>("column");
  const [tooSmall, setTooSmall] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /**
   * The held modifier is Option on a Mac, and this project has to run on a
   * teammate's Mac. Read through `useSyncExternalStore` rather than in an
   * effect: nothing ever changes it, the server has no `navigator`, and this
   * gets the right word into the FIRST client render instead of correcting it
   * one paint later.
   */
  const altName = useSyncExternalStore(
    () => () => {},
    () => (/Mac|iPhone|iPad/i.test(navigator.userAgent) ? "Option" : "Alt"),
    () => "Alt",
  );
  /**
   * A ref, not state. Pointer events can arrive faster than React commits, and
   * a `pointermove` (or a quick `pointerup`) that read a stale `null` origin
   * from the previous render would silently drop the drag: the operator draws
   * a rectangle and nothing happens. A ref updates in the same tick the
   * pointer went down.
   */
  const dragOrigin = useRef<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(
    target.zone && !originLost ? seedFrom(target.zone) : armed,
  );
  /**
   * THE POTONGAN THIS EDITOR HAS ALREADY STORED, and everything the lanjutan
   * question is asked about.
   *
   * Set by the commit, and it is what turns this screen from "draw an area"
   * into "is there a lanjutan": the strip is rendered, the page can no longer
   * be drawn on, and the commit key goes down carrying its reason.
   *
   * `next` and `hint` ARE COMPUTED ONCE, HERE, rather than derived on each
   * render, and that is not premature: `continuationHint` runs the running
   * furniture detector over every page of the berkas, which is 151 of them on
   * the second client bundle. Both are pure functions of `run.pages` and
   * `run.sources`, and neither changes while this strip is open -- a commit
   * writes `{ ...run, slots }` and keeps both arrays -- so recomputing them
   * when the operator merely presses a zoom step buys nothing.
   */
  const [saved, setSaved] = useState<{
    key: string;
    zone: Zone;
    next: NextPage | null;
    hint: ContinuationHint | null;
  } | null>(null);

  const groups = useMemo(() => groupPages(run), [run]);
  const page: StoredPage | undefined = useMemo(
    () => run.pages.find((p) => p.id === pageId),
    [run.pages, pageId],
  );

  useEffect(() => {
    let alive = true;
    let made: string | null = null;

    void (async () => {
      try {
        const bitmap = await runtime.pageBitmap(run.id, pageId);
        try {
          const { url } = await pageToDisplayUrl(bitmap);
          if (!alive) {
            URL.revokeObjectURL(url);
            return;
          }
          made = url;
          setDisplay({ url, page: pageId });
        } finally {
          bitmap.close();
        }
      } catch (error) {
        if (alive) {
          setFailed({
            page: pageId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [runtime, run.id, pageId]);

  /**
   * The zone this editor opened on, when the page on screen is the page it
   * belongs to. `null` on any other page, and on a zone whose page the run can
   * no longer resolve.
   */
  const seedFor = useCallback(
    (id: string): Draft | null => {
      if (target.zone && !originLost && origin?.page.id === id) {
        return seedFrom(target.zone);
      }
      // Going to look at another page and coming BACK to the armed one restores
      // the whole-page draft, for the same reason returning to the original
      // zone's page restores that: leaving to check something must not cost the
      // rectangle you had.
      if (target.startPageId === id) return armed;
      return null;
    },
    [target.zone, target.startPageId, origin, originLost, armed],
  );

  /**
   * A RECTANGLE BELONGS TO THE PAGE IT WAS DRAWN ON.
   *
   * Carrying a draft across a page change would put a box measured on one
   * sheet over another, and on a landscape or otherwise differently shaped
   * page it can land outside that page's bounds entirely. Coming BACK to the
   * page the original zone sits on restores that zone, so going to look at
   * another document costs nothing.
   *
   * Done in the handler rather than in an effect on `pageId`: an effect runs
   * after the render that changed the page, so the old rectangle would be
   * painted over the new page for one frame.
   */
  const pickPage = useCallback(
    (id: string) => {
      if (id === pageId) return;
      setPageId(id);
      setTooSmall(false);
      setDraft(seedFor(id));
    },
    [pageId, seedFor],
  );

  // NOT DIRTY ONCE IT IS STORED. The rectangle on screen after a commit is the
  // one that went to disk, so warning that closing would throw it away would be
  // a false statement made by the screen that had just saved it.
  const dirty = draft !== null && draft.mode !== "existing" && saved === null;

  const requestCancel = useCallback(() => {
    // A carefully aimed rectangle over a 29 page bundle is not thrown away by
    // a stray Escape. Nothing drawn, nothing to ask.
    if (dirty) setConfirmDiscard(true);
    else onCancel();
  }, [dirty, onCancel]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestCancel]);

  /**
   * THIS ORDER'S FORM. The bagian being drawn may exist only here: a judul the
   * operator added lives in `run.overlay`, so looking the key up in the module
   * constant finds nothing and the editor loses the name, the catatan and the
   * section title for exactly the captures that are ALWAYS taken by hand.
   */
  const template = useRunTemplate(run);
  const slotDef = useMemo(() => {
    const key = slotKeyOf(target.slotKey);
    return templateSlots(template).find((entry) => entry.slot.key === key);
  }, [target.slotKey, template]);

  // WHICH capture of its bagian is being drawn, read through the shared rule
  // rather than by splitting the key here. The key itself never reaches the
  // screen: it is system vocabulary an operator has no use for.
  //
  // Both numbers come from the RUN, never from the template. Nothing declares
  // how many pictures a bagian holds (a lanjutan is discovered), so
  // `captureCount` is the highest ordinal this run actually carries, and an
  // ordinary single-capture bagian prints nothing at all.
  const captureOrdinal = captureOrdinalOf(target.slotKey);
  const captureCount = run.slots.reduce(
    (high, slot) =>
      slotKeyOf(slot.key) === slotKeyOf(target.slotKey)
        ? Math.max(high, captureOrdinalOf(slot.key))
        : high,
    1,
  );

  if (!page) {
    return (
      <Slab name="Tandai area bukti" owes="fault">
        <Notice tone="stop">
          Belum ada halaman di order ini. Muat berkas PDF dulu.
        </Notice>
        <div>
          <Btn onClick={onCancel}>Batal</Btn>
        </div>
      </Slab>
    );
  }

  const shown = display && display.page === pageId ? display.url : null;
  // Both derived against the OPEN page, so neither a stale raster nor a stale
  // failure can be shown over a page it does not belong to.
  const failure = failed && failed.page === pageId ? failed.message : null;
  const pageGroup = groups.find((g) => g.sourceId === page.sourceId);
  const pageOrdinal =
    pageGroup?.pages.find((p) => p.page.id === page.id)?.ordinal ?? 0;
  const pagesInDoc = pageGroup?.pages.length ?? 1;
  const sourceName = pageGroup?.name ?? page.sourceId;
  const pageIdentity = `${sourceName}, halaman ${pageOrdinal + 1} dari ${pagesInDoc}`;
  const emptyPage = page.lines.length === 0;

  /**
   * Page pixels from a pointer position, measured against BOTH dimensions of
   * the container.
   *
   * The old version derived one scale from width alone and applied it to y,
   * while the image was `object-contain` inside an aspect-ratio box whose
   * ratio could differ from the blob's by the independent rounding in
   * `pageToDisplayUrl`. The image now FILLS the container (no `object-contain`,
   * so no letterbox), and this maps container fractions to page fractions,
   * which makes pointer, overlay and cut rectangle identical by construction
   * rather than to within a rounding error.
   */
  const toPage = (event: React.PointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * page.widthPx;
    const y = ((event.clientY - rect.top) / rect.height) * page.heightPx;
    return {
      x: Math.max(0, Math.min(x, page.widthPx)),
      y: Math.max(0, Math.min(y, page.heightPx)),
    };
  };

  const shouldSnap = (event: { altKey: boolean }) => snapMode && !event.altKey;

  // Nothing is drawn over a page nobody has seen. A rectangle committed over a
  // page that never rendered is evidence the operator did not look at.
  //
  // AND NOTHING IS DRAWN AFTER THE COMMIT. The potongan is stored and the
  // screen is now asking about its lanjutan; letting a drag replace the
  // rectangle here would leave the page showing an area that is not the one on
  // disk, with no second commit available to reconcile them.
  const canDraw = shown !== null && saved === null;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canDraw) return;
    try {
      // Capture keeps a drag that leaves the page image alive. It throws if
      // the pointer is already gone, and losing capture is not a reason to
      // refuse the drag.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* drag without capture */
    }
    dragOrigin.current = toPage(event);
    setDragging(true);
    setTooSmall(false);
    setDraft(null);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = dragOrigin.current;
    if (!from) return;
    const raw = normalizeBox(from, toPage(event));
    const snap = shouldSnap(event);
    setDraft({ ...drawZone(raw, page, snap), forced: !snap });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = dragOrigin.current;
    if (!from) return;
    const raw = normalizeBox(from, toPage(event));
    dragOrigin.current = null;
    setDragging(false);
    // A mis-click must not replace a good proposal with a few pixels of paper.
    // It used to restore the previous zone in silence, so the rectangle
    // changed back and nothing said why.
    if (!isMeaningfulDrag(raw)) {
      setTooSmall(true);
      setDraft(seedFor(pageId));
      return;
    }
    const snap = shouldSnap(event);
    setDraft({ ...drawZone(raw, page, snap), forced: !snap });
  };

  const takeWholePage = () => {
    // The whole page as one capture, which is what four of the twelve slots
    // are by design. It is also the one selection a scrolling frame cannot be
    // dragged: that drag would have to run past the edge of the frame, and it
    // is the whole keyboard path to a zone, since the per-line buttons in the
    // Sumber block can shrink this down to any contiguous range with no
    // pointer at all.
    //
    // `snap: false` ON PURPOSE. Snapping would union the LINE boxes, which
    // stops at the text and drops the margins, so a button labelled "one whole
    // page" would quietly hand back the text block instead. Free pixels over
    // the page bounds is the page, and every line falls inside it, so the
    // capture still carries a citation covering all of them.
    setTooSmall(false);
    setDraft({ ...drawZone(pageBounds(page), page, false), forced: true });
  };

  const box: Box | null = draft?.box ?? null;
  const cited = draft
    ? hasLineCitation({
        pageIndex: 0,
        box: draft.box,
        lineRange: draft.lineRange,
      })
    : false;
  const citedLines =
    draft && cited
      ? linesInRange(page, draft.lineRange[0], draft.lineRange[1])
      : [];
  /**
   * Read off the PAGE, never off `SlotState.text`. The stored text describes
   * whatever rectangle was there before this drag, and a transcript that
   * quietly disagrees with the picture beside it is worse than none.
   */
  const preview =
    draft && cited
      ? textForLineRange(page, draft.lineRange[0], draft.lineRange[1])
      : "";

  /**
   * Lines the rectangle covers but the citation does NOT carry.
   *
   * Measured with the snapper's own `TOUCH_RATIO`, so the picture and the
   * citation are judged by one rule. That matters: the old canvas drew its
   * guides at 1% overlap against the PADDED box while the snapper cites at
   * 40% against the raw drag, so the page claimed lines the citation did not
   * carry.
   *
   * A snapped box almost never produces one, because `CROP_PADDING_PX` (12px)
   * is under 40% of a line's height on a 300 DPI scan. It is mostly the free
   * mode tell: the crop shows text a reviewer following the citation will not
   * find.
   */
  const strayLines = draft
    ? linesTouchedBy(page.lines, draft.box, TOUCH_RATIO).filter(
        (l) => !cited || l.i < draft.lineRange[0] || l.i > draft.lineRange[1],
      )
    : [];

  /**
   * Guides mark the EDGES of the cited lines, and they stay after pointer-up.
   * The old canvas drew them only while dragging, so the state the operator
   * actually committed was the one with no line information on the page at
   * all. Past a dozen lines only the two boundary edges are drawn: interior
   * edges cannot be clipped (the box is the union of exactly those lines), and
   * ninety hairlines is noise the drag has to re-render.
   */
  const guideLines =
    citedLines.length > 12
      ? [citedLines[0], citedLines[citedLines.length - 1]]
      : citedLines;

  const cite = draft
    ? citeZone(run, {
        pageIndex: zonePageRef(run, page),
        box: draft.box,
        lineRange: draft.lineRange,
      })
    : null;

  /** The page the original zone sits on, when it is not the one on screen. */
  const movedFrom = origin && origin.page.id !== pageId ? origin : null;

  const firstLine = page.lines[0]?.i ?? 0;
  const lastLine = page.lines[page.lines.length - 1]?.i ?? 0;

  /**
   * Extend or shrink the citation by one line, from either edge.
   *
   * The common correction is one line too few or one line too many, and the
   * old editor made that a full redraw: `onPointerDown` cleared the draft, so
   * re-aiming also threw away the machine's proposal. It is also the keyboard
   * path to a rectangle, since none of this needs a pointer.
   */
  const nudge = (edge: "top" | "bottom", by: 1 | -1) => {
    // Same rule as the drag: once the potongan is stored, the rectangle on
    // screen has to keep being the rectangle on disk.
    if (!draft || !cited || saved) return;
    let [from, to] = draft.lineRange;
    // Bounded by the page's own first and last line index rather than by
    // `lines.length`, which assumes a dense 0-based numbering the type does
    // not promise.
    if (edge === "top") from = Math.min(Math.max(firstLine, from - by), to);
    else to = Math.max(Math.min(lastLine, to + by), from);
    const picked = linesInRange(page, from, to);
    if (picked.length === 0) return;
    // Re-snapped through `drawZone` rather than rebuilt here, so a nudged
    // rectangle is the same kind of object as a dragged one: the union of
    // those lines, padded by CROP_PADDING_PX, clamped to the page. The union
    // of lines `from..to` touches no other line, so the snapper returns the
    // range it was given.
    setDraft(drawZone(unionBoxes(picked.map((l) => l.box)), page, true));
  };

  const save = () => {
    if (!draft || !canDraw) return;
    const zone: Zone = {
      // Stored as the RUN-GLOBAL position, which is what `Zone.pageIndex`
      // means, while the strip above shows the page's number inside its own
      // file. Never write one where the other is read.
      pageIndex: zonePageRef(run, page),
      box: draft.box,
      lineRange: draft.lineRange,
    };
    const key = onSave(target, zone, cited ? preview : "");
    // A null key is a write the shell refused, and it has already put the
    // refusal on screen. Staying in the drawing state is the honest thing to
    // do: there is no stored potongan to ask a lanjutan question about.
    if (key === null) return;
    setSaved({
      key,
      zone,
      // Read off the zone that was just stored, never off the draft: the
      // question is about the rectangle that went to disk. `nextPageInBerkas`
      // is what fences the chain to one document -- page 27 of a merged
      // contract scan is not continued by page 0 of a separate SPLITBA scan,
      // however adjacent their run-global numbers are.
      next: nextPageInBerkas(run, zone.pageIndex),
      hint: continuationHint(run, zone),
    });
  };

  /**
   * WHY THE COMMIT IS REFUSED, CARRIED BY THE CONTROL ITSELF.
   *
   * It used to be a line of prose in the bar under the key, plus an
   * affirmative "Siap disimpan." when nothing was wrong. An operator's verdict
   * on that was that the sentence is redundant with the key being down, and
   * for these three it is: a page still opening, a page that will not open,
   * and no rectangle drawn yet are all routine and all visible elsewhere on
   * the screen. So it rides on `Btn`'s `reason`, which reaches a pointer, a
   * keyboard and a screen reader.
   *
   * THE FAULT DID NOT GO WITH IT. A page that will not open is still a stop
   * notice in prose on the page block above, with its technical detail, and
   * that is the copy an operator has to act on; this string is only the
   * refusal, said where the refusal is.
   */
  const blocked = saved
    ? // FIRST, because after a commit `canDraw` is false and the reason under
      // it ("wait for the page to appear") would be a plain lie: the page is
      // there, the area is stored, and what is owed is the answer below.
      "Area ini sudah disimpan. Jawab dulu pertanyaan lanjutan di bawah."
    : failure
      ? "Halaman ini tidak tampil. Pilih halaman lain."
      : !canDraw
        ? "Tunggu halamannya tampil dulu."
        : !draft
        ? // The same words as the button that does it ("Satu halaman"), not a
          // third spelling of the whole-page capture: an action keeps one
          // wording through the flow, or the reason and the remedy read as two
          // different things.
          "Tandai areanya dulu, atau ambil satu halaman."
        : null;

  /**
   * The page block's own state, carried by the full width of its kop rather
   * than by a mark the operator has to find. Amber here is this product's one
   * meaning of amber: this block is waiting on you. It is the only colour on a
   * healthy version of this screen, and it goes out the moment a rectangle
   * exists.
   */
  const pageOwes: "decision" | "fault" | undefined = failure
    ? "fault"
    : draft
      ? undefined
      : "decision";


  const frameInner: CSSProperties =
    zoom === "page"
      ? { height: "100%", width: "auto" }
      : { width: zoom === "double" ? "200%" : "100%", height: "auto" };

  const pencil = "color-mix(in oklch, var(--paper-ink), transparent 45%)";

  return (
    <div className="flex flex-col gap-4">
      {/* The screen's heading area, on the table rather than in a block: the
          question being asked, and the one sentence about what answering it
          replaces. The title IS the label, so nothing floats above it. */}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          {slotDef ? (
            <span className="lt-figure lt-label">{slotDef.section.title}</span>
          ) : null}
          {/* A LINK HAS NO ORDINAL YET, and inventing one would be wrong twice
              over: `withDiscoveredCaptures` mints it at the write, and
              `target.slotKey` on a link target is the BASE key, which would
              print "potongan 1". The word is what the operator needs here
              anyway -- this drawing is the rest of the bagian above it. */}
          {target.after ? (
            <span className="lt-label">lanjutan</span>
          ) : captureCount > 1 ? (
            <span className="lt-label">
              potongan {captureOrdinal} dari {captureCount}
            </span>
          ) : null}
        </div>

        {/* The field being filled, in the packet's own voice and at the size of
            the question being asked. The screen's own name used to be the most
            distinctive string here, above a 16px field label.

            THE HOW-TO IS NOT HERE AT ALL, in either form. "Tarik di halaman
            untuk menandai areanya" is the same sentence on every order and on
            every slot, and an operator who has drawn twelve rectangles today
            reads it as furniture; it stood above the page, then behind this
            mark, and is now only where it is useful, which is ON the page, in
            place, for exactly as long as there is no rectangle on it. */}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="lt-field-name lt-figure">{target.label}</h2>
          {/* WHAT IS LEFT IN HERE IS A CONSEQUENCE, NOT AN INSTRUCTION. The
              how-to ("tarik di halaman untuk menandai areanya") is drawn on
              the page itself, in place, for exactly as long as there is no
              rectangle on it, so saying it here as well was the same sentence
              twice with one of them hidden. What cannot be read off the screen
              is that this screen has no second review step: the area saved
              here IS the accepted evidence, and an operator who expects to
              approve it again afterwards would draw more carelessly. */}
          <Hint label="Penjelasan area yang disimpan">
            Area yang Anda simpan langsung menjadi bukti yang diterima untuk
            bagian ini, atas keputusan Anda.
          </Hint>
        </div>

        {/* WHAT THE FIELD IS SUPPOSED TO BE, which lived in `SlotDef` and had
            never been on screen. The operator is about to author the evidence
            for it by hand, so this is the specification they are drawing
            against, and it is the one paragraph here that a different bagian
            would print differently. `bukan` carries the full ink of the two:
            naming the look-alike is the half that catches a plausible wrong
            crop, and a plausible wrong crop is the failure this product is
            organised against. `hint` is deliberately NOT shown: it is an
            English prompt written to steer the model. */}
        {slotDef?.slot.catatan ? (
          <div className="flex flex-col gap-2">
            <Lede>{slotDef.slot.catatan.adalah}</Lede>
            {slotDef.slot.catatan.bukan ? (
              <p className="lt-lede" style={{ color: "var(--ink)" }}>
                {slotDef.slot.catatan.bukan}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* One sentence about what this commit does to what is already there,
            and only one. The empty case now says nothing at all: the page kop
            is already amber and the Potongan block already reads "belum ada
            area", so a third statement of the same fact is exactly the
            reassurance the density pass exists to cut. */}
        {originLost ? (
          <Notice tone="stop">
            Halaman area lama sudah tidak ada di order ini. Pilih halamannya
            lalu tandai ulang.
          </Notice>
        ) : movedFrom ? (
          /* Moving evidence from one document to another is the highest
             consequence edit available on this screen, and it used to happen
             with no more ceremony than nudging an edge. Both pages are named. */
          <Notice tone="warn">
            Bukti berpindah halaman, dari{" "}
            <Kotak title={movedFrom.sourceName}>
              {shortenFileName(movedFrom.sourceName, 24)} hal{" "}
              {movedFrom.pageInDoc + 1}
            </Kotak>{" "}
            ke{" "}
            <Kotak title={sourceName}>
              {shortenFileName(sourceName, 24)} hal {pageOrdinal + 1}
            </Kotak>
            .
          </Notice>
        ) : origin ? (
          <Notice>
            Menggantikan area di{" "}
            <Kotak title={origin.sourceName}>
              {shortenFileName(origin.sourceName, 24)} hal{" "}
              {origin.pageInDoc + 1}
            </Kotak>
            .
          </Notice>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* THE ONE MEMORABLE OBJECT ON THIS SCREEN, and the only FULL block on
            it: `plate` picks `.lt-slab` here and `.lt-slab-flat` for the two
            readout blocks beside it. Nothing casts a hard offset shadow any
            more, so the difference is lit-block against furniture; see the
            note on `Slab` above. Everything else is furniture around it. */}
        <Slab
          plate
          name="Halaman"
          owes={pageOwes}
          aside={
            <>
              <Kotak title={sourceName}>
                {shortenFileName(sourceName, 22)}
              </Kotak>
              <Kotak>
                hal {pageOrdinal + 1} / {pagesInDoc}
              </Kotak>
            </>
          }
        >
          {/* A persistent live region, so the page's state is announced when
              it changes rather than only when a message happens to mount. */}
          <p className="sr-only" aria-live="polite">
            {failure
              ? "Halaman ini tidak tampil."
              : shown
                ? `${pageIdentity}. Siap ditandai.`
                : `Membuka ${pageIdentity}.`}
          </p>

          {failure ? (
            <div className="flex flex-col gap-2">
              <Notice tone="stop" role="alert">
                Halaman ini tidak bisa dibuka. Pilih halaman lain, atau muat
                ulang aplikasi.
              </Notice>
              <TechnicalDetail>{failure}</TechnicalDetail>
            </div>
          ) : null}

          {emptyPage ? (
            <Notice tone="warn">
              Tidak ada baris teks terbaca di halaman ini. Tarikan memakai
              piksel apa adanya, tanpa kutipan baris.
            </Notice>
          ) : null}

          {tooSmall ? (
            <Notice tone="warn" role="status">
              Tarikan di bawah {MIN_DRAG_PX} piksel, jadi tidak dipakai. Tarik
              lebih lebar.
            </Notice>
          ) : null}

          <PageStrip
            groups={groups}
            pageId={pageId}
            cut={box}
            onPick={pickPage}
          />

          {/* EVIDENCE IS MOUNTED, NEVER PLACED: a sunk stage, a near-black mat,
              then the sheet. The FRAME scrolls rather than the document, so the
              readout beside it and the bar below it never leave the screen at
              1366x768. */}
          <div className="lt-stage">
            <div className="lt-mat">
              <div
                className={`lt-paper flex h-[min(62vh,44rem)] min-h-[18rem] items-start overflow-auto ${
                  // Centred only when the page fits: `justify-center` on an
                  // overflowing flex row clips the leading edge instead of
                  // letting it scroll, and the leading edge of a scan is a
                  // margin the operator may need to draw into.
                  zoom === "page" ? "justify-center" : "justify-start"
                }`}
              >
                <div
                  role="group"
                  aria-label={`Halaman untuk digambar. ${pageIdentity}.`}
                  className="relative shrink-0 touch-none select-none"
                  style={{
                    ...frameInner,
                    aspectRatio: `${page.widthPx} / ${page.heightPx}`,
                    cursor: canDraw ? "crosshair" : "default",
                  }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => {
                    dragOrigin.current = null;
                    setDragging(false);
                  }}
                >
                  {shown ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- a
                       blob URL rendered in this tab from a document that never
                       leaves it. No `object-contain`: the image FILLS the
                       container, so container fractions and page fractions are
                       one number and the overlay cannot be letterboxed away
                       from the pixels it claims to mark. */
                    <img
                      src={shown}
                      alt={pageIdentity}
                      className="absolute inset-0 h-full w-full"
                      draggable={false}
                    />
                  ) : (
                    <p
                      className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm"
                      style={{ color: "var(--paper-ink-2)" }}
                    >
                      {failure
                        ? "Halaman ini tidak tampil."
                        : `Membuka ${pageIdentity}...`}
                    </p>
                  )}

                  {/* The instruction, in place, for exactly as long as there is
                      no rectangle to look at.

                      PAINTED IN `--paper`, NOT IN `--ink`. `.lt-paper` rebinds
                      the ink tokens to the sheet's own dark values, so this
                      chip was dark text on a near-black ground: an instruction
                      that was, measurably, not there.

                      `rounded-sm` IS THE FIGURE STEP, 8px, and it is the whole
                      of what this chip needed from the restyle: a square corner
                      is the one gesture the client named, and the radius scale
                      has four values so that a small object standing on the
                      evidence takes the smallest. */}
                  {!draft && canDraw ? (
                    <p
                      className="pointer-events-none absolute inset-x-0 top-6 mx-auto w-fit rounded-sm px-4 py-2 text-sm"
                      style={{
                        background: "var(--mat)",
                        color: "var(--paper)",
                      }}
                    >
                      Tarik untuk menandai area.
                    </p>
                  ) : null}

                  {box ? (
                    <>
                      {/* Everything outside the zone dims, so the crop is the
                          only lit thing on the page: the same trick a light
                          table plays. */}
                      <div
                        className="lt-scrim"
                        style={{
                          left: 0,
                          top: 0,
                          right: 0,
                          height: pct(box.y, page.heightPx),
                        }}
                      />
                      <div
                        className="lt-scrim"
                        style={{
                          left: 0,
                          top: pct(box.y + box.h, page.heightPx),
                          right: 0,
                          bottom: 0,
                        }}
                      />
                      <div
                        className="lt-scrim"
                        style={{
                          left: 0,
                          top: pct(box.y, page.heightPx),
                          width: pct(box.x, page.widthPx),
                          height: pct(box.h, page.heightPx),
                        }}
                      />
                      <div
                        className="lt-scrim"
                        style={{
                          left: pct(box.x + box.w, page.widthPx),
                          top: pct(box.y, page.heightPx),
                          right: 0,
                          height: pct(box.h, page.heightPx),
                        }}
                      />
                      {/* ONLY GEOMETRY IS INLINE HERE, AND THE ONE
                          DECLARATION THAT LEFT IS WORTH RECORDING. `.lt-zone`
                          marks the edge with an outline, and CSS outlines
                          paint OUTSIDE the element box, so the rectangle on
                          screen would be two pixels larger on every side than
                          the one that gets cut. `outline-offset: -2px` pulls
                          it back inside, and `globals.css` now carries that on
                          the class itself; this file was setting it a second
                          time. A marker drawn a few pixels off the cut is the
                          picture of a lie this module exists to avoid, so if
                          the class ever loses the offset it has to come back
                          here. */}
                      <div
                        className="lt-zone"
                        style={{
                          left: pct(box.x, page.widthPx),
                          top: pct(box.y, page.heightPx),
                          width: pct(box.w, page.widthPx),
                          height: pct(box.h, page.heightPx),
                        }}
                      />
                    </>
                  ) : null}

                  {guideLines.map((line) => (
                    <div key={`cited-${line.i}`}>
                      <div
                        className="lt-guide"
                        style={{ top: pct(line.box.y, page.heightPx) }}
                      />
                      <div
                        className="lt-guide"
                        style={{
                          top: pct(line.box.y + line.box.h, page.heightPx),
                        }}
                      />
                    </div>
                  ))}

                  {/* Lines inside the picture that the citation leaves out.
                      Drawn in pencil on the paper rather than in a product hue:
                      the advisory beside the register says what it means, and
                      neither of this product's two hues means "look here as
                      well". 2px because that is the weight of every other mark
                      on this overlay -- `.lt-zone`'s outline and `.lt-guide`'s
                      rule are both 2px -- and a mark ON the evidence is not one
                      of the interface's hairlines. */}
                  {strayLines.map((line) => (
                    <div
                      key={`stray-${line.i}`}
                      className="pointer-events-none absolute inset-x-0"
                      style={{
                        top: pct(line.box.y, page.heightPx),
                        height: pct(line.box.h, page.heightPx),
                        borderTop: `2px dashed ${pencil}`,
                        borderBottom: `2px dashed ${pencil}`,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Slab>

        <aside className="flex min-w-0 flex-col gap-4">
          {/* THE PICTURE, and every advisory that is a statement about the
              picture. The note about resolution stood under every preview and
              said the same thing under all of them; it moved onto this block's
              mark, and then off the screen altogether. It described how the
              preview is produced (enlarged from the page raster, cut for real
              from the full-resolution page) and there is nothing an operator
              does differently for knowing it: the judgement here is whether
              the rectangle holds the right thing, which is read off its edges
              and not off its sharpness. What did NOT move is anything measured
              off this rectangle. */}
          <Slab name="Potongan" aside={draft ? null : "belum ada area"}>
            {draft && shown ? (
              <div className="lt-mat">
                <CropPreview url={shown} page={page} box={draft.box} />
              </div>
            ) : (
              /* A DELIBERATE ABSENCE, DRAWN. The kop already says "belum ada
                 area" in words, so a sentence here would be the same fact
                 twice in one block. `.lt-hatch` is the material this system
                 keeps for exactly this: nothing has been put here yet, and it
                 must not look like an empty crop. Marked decorative, because
                 the state it depicts is read out by the kop beside it. */
              <div className="lt-hatch aspect-[3/2] w-full" aria-hidden="true" />
            )}

            {draft ? (
              <>
                <CiteAdvisories cite={cite} />

                {!cited ? (
                  <Advisory>
                    Tanpa kutipan baris. Wajar untuk tanda tangan atau stempel.
                    Pemeriksa tidak bisa menelusuri barisnya.
                  </Advisory>
                ) : null}

                {strayLines.length > 0 ? (
                  <Advisory>
                    {strayLines.length} baris terlihat di potongan tetapi tidak
                    masuk kutipan. Tambahkan lewat Atas +1 atau Bawah +1.
                  </Advisory>
                ) : null}
              </>
            ) : null}
          </Slab>

          {/* WHERE IT CAME FROM: the same register the review plate shows, so a
              zone drawn by hand is read in the same vocabulary, and held to the
              same visible standard, as one the model proposed. */}
          <Slab name="Sumber" aside={draft ? null : "belum ada area"}>
            {draft ? (
              <>
                <Cite cite={cite} />

                {/* A whole-page capture says nothing about snapping worth
                    saying: `CiteAdvisories` already names it as one, and the
                    page has no edge to have followed a line at. */}
                {cite?.wholePage ? null : draft.mode === "snapped" ? (
                  <Note>Terkunci ke baris, margin {CROP_PADDING_PX} piksel.</Note>
                ) : draft.mode === "existing" ? (
                  /* A `Zone` carries no record of how it was drawn, so this
                     says "not recorded" instead of claiming it was snapped,
                     which is what the old readout did to every reopened
                     free-pixel capture. */
                  <Advisory>
                    Cara area ini dibuat tidak tercatat. Gambar ulang bila Anda
                    ingin memastikannya mengikuti baris.
                  </Advisory>
                ) : draft.forced ? (
                  <Note>Piksel apa adanya, atas permintaan Anda.</Note>
                ) : (
                  /* Snapping was on and quietly fell through for want of a
                     line to snap to. That is correct behaviour and it must be
                     said here, because the toggle in the bar still reads
                     "aktif" and two statements on one screen may not disagree
                     about what just happened. */
                  <Advisory>
                    Kunci ke baris menyala, tetapi tidak ada baris yang bisa
                    dikunci di sini. Periksa apakah areanya memang tidak perlu
                    mengikuti baris.
                  </Advisory>
                )}

                {cited && !saved ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="lt-label">Per baris</span>
                    <Btn
                      onClick={() => nudge("top", 1)}
                      aria-label="Tambah satu baris di atas"
                    >
                      Atas +1
                    </Btn>
                    <Btn
                      onClick={() => nudge("top", -1)}
                      aria-label="Kurangi satu baris di atas"
                    >
                      Atas −1
                    </Btn>
                    <Btn
                      onClick={() => nudge("bottom", 1)}
                      aria-label="Tambah satu baris di bawah"
                    >
                      Bawah +1
                    </Btn>
                    <Btn
                      onClick={() => nudge("bottom", -1)}
                      aria-label="Kurangi satu baris di bawah"
                    >
                      Bawah −1
                    </Btn>
                  </div>
                ) : null}

                {/* THE TRANSCRIPT IS A CLOSED DISCLOSURE. OCR text can be right
                    while the rectangle is wrong, so judging by the text is
                    exactly the shortcut that lets a wrong page through, and it
                    had four times the crop's area on this screen. Line numbers
                    are mono because they are read against the citation's own
                    range down a column; the document's prose is not, and
                    monospace prose at 13px reads as debug output. */}
                {citedLines.length > 0 ? (
                  <details className="lt-disclose">
                    <summary>
                      Teks di dalamnya ({citedLines.length} baris)
                    </summary>
                    <ol className="lt-well mt-2 max-h-72 overflow-auto p-2 text-[0.8125rem]">
                      {citedLines.map((line) => (
                        <li
                          key={line.i}
                          className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2"
                        >
                          <span
                            className="lt-figure text-right"
                            style={{ color: "var(--ink-3)" }}
                          >
                            {line.i}
                          </span>
                          <span
                            className="whitespace-pre-wrap"
                            style={{ color: "var(--ink-2)" }}
                          >
                            {line.text}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null /* SAID ALREADY, TWICE, AT FULL INK: the register
                    above prints "baris: digambar sendiri" and the Potongan
                    block carries "Tanpa kutipan baris" as an advisory. A third
                    sentence here is the repeated reassurance this pass exists
                    to cut, not a tell being hidden: nothing measured off this
                    rectangle moved off the sheet. */}
              </>
            ) : null}
          </Slab>
        </aside>
      </div>

      {/* THE LANJUTAN QUESTION, in flow, under the work it is about and above
          the rail that is glass. It exists only after a commit, and answering
          it either reopens this editor on the next page or closes it. */}
      {saved ? (
        <LanjutanStrip
          next={saved.next}
          hint={saved.hint}
          onTake={() =>
            saved.next && onContinue(saved.key, saved.next.page.id)
          }
          onNone={() => onNoContinuation(saved.key)}
        />
      ) : null}

      {/* ONE BAR, AND EVERY CONTROL IS IN IT. The bar stays with the operator:
          drawing happens at the bottom of a page and committing used to happen
          at the top of the document, so every correction ended in a scroll away
          from the evidence. The view steps and the whole-page capture used to
          sit under the picture, which put the hand in three places.

          GLASS, BECAUSE IT STAYS STILL while the page scrolls under it, which
          is the one question that decides the material here. It draws no border
          of its own: `.lt-rail::before` lays a bright hairline along the top
          edge, which is the edge a bottom-pinned rail catches the light on, and
          the 3px `--edge` rule this carried was a second and dimmer line under
          it -- a stamped-plate weight on the one screen that has to look like a
          work surface. */}
      <div className="lt-rail sticky bottom-0 z-10 flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="lt-label">Tampilan</span>
            {(Object.keys(ZOOM_LABEL) as Zoom[]).map((step) => (
              <Btn
                key={step}
                on={zoom === step}
                aria-pressed={zoom === step}
                onClick={() => setZoom(step)}
              >
                {ZOOM_LABEL[step]}
              </Btn>
            ))}
          </div>

          {/* The mode's NAME does not change with its state; the state is said
              in words beside it, drawn as a glyph, and carried by the pressed
              styling. A label that is its own state is ambiguous about whether
              it describes what is happening or what clicking will do, and the
              operator had to test it mid-task to find out.

              The glyph is the house one and it takes `locked`, so the two
              states differ by SHAPE (a bar held between two rules, or a dashed
              free run) and not by the pressed background alone.

              THE FREE-PIXEL MODIFIER IS ON THIS MARK, and it did not disappear.
              It used to stand as a sentence under this bar, where it read the
              same on every order and on every page; it is an explanation of
              this toggle, so it sits on this toggle's mark, which opens on
              hover, on focus and on tap. An affordance nobody can see is not an
              affordance, and this one being invisible was a real defect once
              already. */}
          <div className="flex items-center gap-2">
            <Btn
              on={snapMode}
              aria-pressed={snapMode}
              onClick={() => setSnapMode((on) => !on)}
            >
              <KunciKeBaris locked={snapMode} />
              Kunci ke baris {snapMode ? "aktif" : "mati"}
            </Btn>
            <Hint label="Penjelasan kunci ke baris">
              Saat aktif, tarikan mengikuti baris teks yang utuh. Tahan{" "}
              {altName} sambil menarik untuk memakai piksel apa adanya, misalnya
              di tanda tangan atau stempel.
            </Hint>
          </div>

          {/* The one control here that is not a view setting, so it is the one
              that carries a glyph: the filled sheet is the shape of what the
              click LEAVES, a whole page taken as one capture, and it is the
              mark the glossary's "tangkapan satu halaman" is drawn from. The
              view steps beside it get none: an identical glyph on every member
              of a homogeneous group discriminates nothing. The glossary's full
              term stays in the accessible name, because the glossary fixes it
              and the button only has room for half of it. */}
          <Btn
            onClick={takeWholePage}
            disabled={!canDraw}
            reason={
              saved
                ? "Area ini sudah disimpan. Jawab dulu pertanyaan lanjutan di bawah."
                : "Tunggu halamannya tampil dulu."
            }
            aria-label="Ambil tangkapan satu halaman"
          >
            <HalamanUtuh />
            Satu halaman
          </Btn>

          {/* Not a live region: the rectangle growing under the pointer is the
              feedback, and announcing "menggambar" on every drag would talk
              over the operator doing the drag. */}
          {dragging ? <span className="lt-label">menggambar</span> : null}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* "Batal" IS THE WRONG WORD ONCE SOMETHING IS STORED, and this is
                the "later" the strip deliberately has no key for: closing
                stamps nothing, so the sheet keeps saying the lanjutan has not
                been checked, which is true. Offering to cancel a save that has
                already happened would be a promise this screen cannot keep. */}
            <Btn onClick={requestCancel}>{saved ? "Tutup" : "Batal"}</Btn>
            {/* The save carries the potongan: what the click leaves behind is a
                region cut out of a page, which is the one thing this screen
                exists to author. */}
            <Btn
              tone="primary"
              onClick={save}
              disabled={Boolean(blocked)}
              reason={blocked ?? undefined}
            >
              <Potongan />
              Pakai area ini
            </Btn>
          </div>
        </div>

        {confirmDiscard ? (
          <div className="flex flex-wrap items-center gap-4">
            <Notice tone="warn">
              Area belum disimpan. Menutup sekarang membuangnya.
            </Notice>
            <Btn tone="reject" onClick={onCancel}>
              Buang dan tutup
            </Btn>
            <Btn onClick={() => setConfirmDiscard(false)}>Lanjut menggambar</Btn>
          </div>
        ) : null}
      </div>
    </div>
  );
}
