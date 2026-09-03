"use client";

/**
 * TANDAI AREA BUKTI: correcting a capture by dragging on the page.
 *
 * The design calls manual selection the TERMINAL STATE of the whole flow, not
 * a fallback, so this screen is built like a work surface rather than like a
 * dialog: the page is the hero, it lies on the table as `.lt-paper`, and the
 * controls sit in a bar that cannot scroll away from a 1400px tall scan.
 *
 * Three things here are requirements rather than polish:
 *
 *  - IT SNAPS TO OCR LINE BOUNDARIES. A crop that slices a line of text in
 *    half is never what anyone wants. Holding the modifier key gives free
 *    pixels, which is what a signature or stamp block needs, because it has no
 *    lines to snap to. The modifier is NAMED ON SCREEN, and named per platform
 *    (Alt on Windows, Option on a Mac, which this project has to run on): an
 *    affordance nobody can see is not an affordance.
 *  - THE OPERATOR CAN PICK ANY LOADED PAGE. Manual selection is the designed
 *    terminal state for a slot no document could fill, so the editor has to be
 *    reachable with no starting zone and let the operator go and find the
 *    region themselves.
 *  - OVERLAY GEOMETRY IS EXPRESSED IN PERCENTAGES OF THE PAGE, never in scaled
 *    pixels. The page image is fluid, so a pixel-based overlay would need a
 *    resize listener and would drift from the crop by however much that
 *    listener lagged, and a rectangle drawn a few pixels off the one that gets
 *    cut is a picture of a lie. Percentages also make the zoom control below
 *    free: at any container width the same fractions land on the same page
 *    pixels.
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
 *    reference once, in the xlsx exporter.
 *  - The readout is now the same citation register the review plate shows
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
} from "react";

import { AO_TEMPLATE } from "@/lib/forms/template";
import { unionBoxes } from "@/lib/pipeline/geometry";
import type { Line } from "@/lib/pipeline/geometry";
import { CROP_PADDING_PX } from "@/lib/pipeline/locate";
import type { Box } from "@/lib/pipeline/render";
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
  Lede,
  Note,
  Notice,
  TechnicalDetail,
  Title,
  shortenFileName,
} from "./chrome";
import { Denah } from "./denah";

export type EditorTarget = {
  /** Position in `run.slots`, or null for a capture the run does not hold yet. */
  slotIndex: number | null;
  slotKey: string;
  label: string;
  zone?: Zone;
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
 * Named "Pas ke layar" rather than anything with "muat" or "satu halaman" in
 * it: "Muat" is the name of the ingest phase and "tangkapan satu halaman" is
 * the whole-page CAPTURE. A zoom step must not borrow either word, or the
 * control reads as an action on the document instead of on the view.
 */
const ZOOM_LABEL: Record<Zoom, string> = {
  page: "Pas ke layar",
  column: "Selebar kolom",
  double: "2x",
};

function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function seedFrom(zone: Zone): Draft {
  return { box: zone.box, lineRange: zone.lineRange, mode: "existing" };
}

/** The lines a range cites, in reading order. */
function linesInRange(page: StoredPage, from: number, to: number): Line[] {
  if (from < 0 || to < from) return [];
  return page.lines
    .filter((l) => l.i >= from && l.i <= to)
    .sort((a, b) => a.i - b.i);
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
    <button
      type="button"
      data-current={current ? "true" : undefined}
      aria-current={current ? "page" : undefined}
      aria-label={unreadable ? `${identity}, teks tidak terbaca` : identity}
      onClick={() => onPick(page.id)}
      className="flex shrink-0 flex-col items-center gap-1 pb-1"
      style={{
        // The open page is marked by a RULE and by the weight of its number,
        // never by a hue alone. Amber means a decision is owed on a piece of
        // evidence; where the operator happens to be standing is not that.
        borderBottom: current ? "2px solid var(--ink)" : "2px solid transparent",
      }}
    >
      {/* A page whose OCR found nothing draws as a struck sheet rather than as
          a blank one, so the operator can see BEFORE drawing that snapping
          will have nothing to hold on to here. */}
      <Denah
        page={page}
        cut={cut}
        size="sm"
        label={`denah halaman ${ordinal + 1}`}
      />
      <span
        className="lt-figure text-[0.75rem] leading-none"
        style={{
          color: current ? "var(--ink)" : "var(--ink-3)",
          fontWeight: current ? 700 : 400,
        }}
      >
        {ordinal + 1}
      </span>
    </button>
  );
});

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
    <div ref={strip} className="flex gap-6 overflow-x-auto pb-2">
      {groups.map((group) => (
        <section key={group.sourceId} className="flex shrink-0 flex-col gap-1.5">
          {/* The document, once, as a group heading. The old strip repeated a
              file name truncated at 18 characters on every button, which is
              exactly where these scan names stop differing. */}
          <h3 className="flex items-baseline gap-2">
            <span className="lt-figure text-[0.8125rem]" title={group.name}>
              {shortenFileName(group.name, 30)}
            </span>
            <span className="lt-label">{group.pages.length} halaman</span>
          </h3>

          <div className="flex gap-1.5">
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

export function ZoneEditor({
  run,
  target,
  onSave,
  onCancel,
}: {
  run: BrowserRun;
  target: EditorTarget;
  onSave: (target: EditorTarget, zone: Zone, text: string) => void;
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
  const startPageId = origin?.page.id ?? run.pages[0]?.id ?? "";

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
    target.zone && !originLost ? seedFrom(target.zone) : null,
  );

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
    (id: string): Draft | null =>
      target.zone && !originLost && origin?.page.id === id
        ? seedFrom(target.zone)
        : null,
    [target.zone, origin, originLost],
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

  const dirty = draft !== null && draft.mode !== "existing";

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

  const slotDef = useMemo(() => {
    const key = slotKeyOf(target.slotKey);
    return templateSlots(AO_TEMPLATE).find((entry) => entry.slot.key === key);
  }, [target.slotKey]);

  // WHICH capture of its bagian is being drawn, read through the shared rule
  // rather than by splitting the key here. The key itself never reaches the
  // screen: it is system vocabulary an operator has no use for.
  //
  // Both numbers come from the RUN, never from the template. Nothing declares
  // how many pictures a bagian holds -- a lanjutan is discovered -- so
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
      <div className="lt-panel flex flex-col gap-4 p-6">
        <Title>Tandai area bukti</Title>
        <Notice tone="stop">
          Belum ada halaman di pekerjaan ini, jadi tidak ada yang bisa ditandai.
          Tambahkan berkas PDF dulu di langkah Muat.
        </Notice>
        <div>
          <Btn onClick={onCancel}>Batal</Btn>
        </div>
      </div>
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
  const canDraw = shown !== null;

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
    // is the whole keyboard path to a zone, since the per-line buttons below
    // can shrink this down to any contiguous range without a pointer.
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
    if (!draft || !cited) return;
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
    onSave(
      target,
      {
        // Stored as the RUN-GLOBAL position, which is what `Zone.pageIndex`
        // means, while the strip above shows the page's number inside its own
        // file. Never write one where the other is read.
        pageIndex: zonePageRef(run, page),
        box: draft.box,
        lineRange: draft.lineRange,
      },
      cited ? preview : "",
    );
  };

  /**
   * Why the commit is refused, said beside the control it disables. A disabled
   * primary action with no reason reads as a broken screen.
   */
  const blocked = failure
    ? "Halaman ini tidak tampil, jadi tidak ada yang bisa Anda periksa. Pilih halaman lain."
    : !canDraw
      ? "Tunggu halamannya tampil dulu, supaya Anda bisa memeriksa apa yang dipotong."
      : !draft
        ? "Tandai areanya dulu di halaman, atau ambil tangkapan satu halaman."
        : null;

  const frameInner: CSSProperties =
    zoom === "page"
      ? { height: "100%", width: "auto" }
      : { width: zoom === "double" ? "200%" : "100%", height: "auto" };

  const pencil = "color-mix(in oklch, var(--paper-ink), transparent 45%)";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {slotDef ? (
            <span className="lt-figure lt-label">{slotDef.section.title}</span>
          ) : null}
          {captureCount > 1 ? (
            <span className="lt-label">
              potongan ke-{captureOrdinal} dari {captureCount}
            </span>
          ) : null}
        </div>
        {/* The field being filled, in the packet's own voice and at the size of
            the question being asked. The screen's own name used to be the most
            distinctive string here, above a 16px field label. */}
        <h2 className="lt-field-name lt-figure">{target.label}</h2>

        {/* WHAT THE FIELD IS SUPPOSED TO BE, which lived in `SlotDef` and had
            never been on screen. The operator is about to author the evidence
            for it by hand, so this is the specification they are drawing
            against. `bukan` carries the full ink of the two: naming the
            look-alike is the half that catches a plausible wrong crop, and a
            plausible wrong crop is the failure this product is organised
            against. `hint` is deliberately NOT shown: it is an English prompt
            written to steer the model. */}
        {slotDef?.slot.catatan ? (
          <div className="flex flex-col gap-1">
            <Lede>{slotDef.slot.catatan.adalah}</Lede>
            {slotDef.slot.catatan.bukan ? (
              <p className="lt-lede" style={{ color: "var(--ink)" }}>
                {slotDef.slot.catatan.bukan}
              </p>
            ) : null}
          </div>
        ) : null}

        <Lede>
          Tarik di halaman untuk menandai areanya. Area yang Anda simpan
          langsung menjadi bukti yang diterima untuk bagian ini, atas keputusan
          Anda.
        </Lede>

        {/* One sentence about what this commit does to what is already
            there, and only one: where the evidence stands now, or where it is
            about to move from, or that there is none yet. */}
        {originLost ? (
          <Notice tone="stop">
            Area yang tersimpan menunjuk ke halaman yang sudah tidak ada di
            pekerjaan ini, jadi areanya tidak bisa ditampilkan kembali. Pilih
            halamannya lalu tandai ulang.
          </Notice>
        ) : movedFrom ? (
          /* Moving evidence from one document to another is the highest
             consequence edit available on this screen, and it used to happen
             with no more ceremony than nudging an edge. Both pages are named. */
          <Notice tone="warn">
            Area asal ada di{" "}
            <span className="lt-figure">
              {shortenFileName(movedFrom.sourceName, 30)}
            </span>{" "}
            halaman <span className="lt-figure">{movedFrom.pageInDoc + 1}</span>.
            Anda sedang menandai{" "}
            <span className="lt-figure">{shortenFileName(sourceName, 30)}</span>{" "}
            halaman <span className="lt-figure">{pageOrdinal + 1}</span>, jadi
            buktinya berpindah halaman.
          </Notice>
        ) : origin ? (
          <Notice>
            Ini menggantikan area yang sekarang, di{" "}
            <span className="lt-figure">
              {shortenFileName(origin.sourceName, 30)}
            </span>{" "}
            halaman{" "}
            <span className="lt-figure">
              {origin.pageInDoc + 1} dari {origin.pagesInDoc}
            </span>
            .
          </Notice>
        ) : (
          <Notice>Bagian ini belum punya area bukti.</Notice>
        )}
      </header>

      <PageStrip groups={groups} pageId={pageId} cut={box} onPick={pickPage} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-3">
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
                Halaman ini tidak bisa dibuka di peramban ini. Pilih halaman
                lain di atas, atau muat ulang aplikasi lalu coba lagi. Selama
                halamannya tidak tampil, area di halaman ini tidak bisa
                ditandai.
              </Notice>
              <TechnicalDetail>{failure}</TechnicalDetail>
            </div>
          ) : null}

          {emptyPage ? (
            <Notice tone="warn">
              Halaman ini tidak punya baris teks yang terbaca, jadi tidak ada
              yang bisa dikunci. Setiap tarikan di sini memakai piksel apa
              adanya, dan potongannya tersimpan tanpa kutipan baris.
            </Notice>
          ) : null}

          {tooSmall ? (
            <Notice tone="warn" role="status">
              Tarikan Anda lebih kecil dari {MIN_DRAG_PX} piksel halaman, jadi
              tidak dijadikan area. Tarik lebih lebar, atau perbesar tampilan
              halaman dulu.
            </Notice>
          ) : null}

          {/* The page lies on the table: the one lit material in the product,
              so the crop's edge stays visible against a white scan. The FRAME
              scrolls rather than the document, so the readout beside it and
              the bar below it never leave the screen at 1366x768. */}
          <div
            className={`lt-paper flex h-[min(66vh,46rem)] min-h-[20rem] items-start overflow-auto ${
              // Centred only when the page fits: `justify-center` on an
              // overflowing flex row clips the leading edge instead of letting
              // it scroll, and the leading edge of a scan is a margin the
              // operator may need to draw into.
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
                /* eslint-disable-next-line @next/next/no-img-element -- a blob
                   URL rendered in this tab from a document that never leaves
                   it. No `object-contain`: the image FILLS the container, so
                   container fractions and page fractions are one number and
                   the overlay cannot be letterboxed away from the pixels it
                   claims to mark. */
                <img
                  src={shown}
                  alt={pageIdentity}
                  className="absolute inset-0 h-full w-full"
                  draggable={false}
                />
              ) : (
                <p
                  className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm"
                  style={{ color: "var(--paper-ink-2)" }}
                >
                  {failure
                    ? "Halaman ini tidak tampil."
                    : `Membuka ${pageIdentity}...`}
                </p>
              )}

              {!draft && canDraw ? (
                <p
                  className="pointer-events-none absolute inset-x-0 top-6 mx-auto w-fit rounded-sm px-3 py-1.5 text-sm"
                  style={{
                    background:
                      "color-mix(in oklch, var(--surface-sunk), transparent 12%)",
                    color: "var(--ink)",
                  }}
                >
                  Tarik di halaman ini untuk menandai area bukti.
                </p>
              ) : null}

              {box ? (
                <>
                  {/* Everything outside the zone dims, so the crop is the only
                      lit thing on the page: the same trick a light table
                      plays. */}
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
                  <div
                    className="lt-zone"
                    style={{
                      left: pct(box.x, page.widthPx),
                      top: pct(box.y, page.heightPx),
                      width: pct(box.w, page.widthPx),
                      height: pct(box.h, page.heightPx),
                      // `.lt-zone` marks the edge with an outline, and CSS
                      // outlines paint OUTSIDE the element box: without this
                      // the rectangle on screen is two pixels larger on every
                      // side than the one that gets cut. A marker drawn a few
                      // pixels off the cut is the picture of a lie this module
                      // exists to avoid.
                      outlineOffset: "-2px",
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
                    style={{ top: pct(line.box.y + line.box.h, page.heightPx) }}
                  />
                </div>
              ))}

              {/* Lines inside the picture that the citation leaves out. Drawn
                  in pencil on the paper rather than in a product hue: the
                  advisory beside the register says what it means, and neither
                  of this product's two hues means "look here as well". */}
              {strayLines.map((line) => (
                <div
                  key={`stray-${line.i}`}
                  className="pointer-events-none absolute inset-x-0"
                  style={{
                    top: pct(line.box.y, page.heightPx),
                    height: pct(line.box.h, page.heightPx),
                    borderTop: `1px dashed ${pencil}`,
                    borderBottom: `1px dashed ${pencil}`,
                  }}
                />
              ))}
            </div>
          </div>

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
            <Btn onClick={takeWholePage} disabled={!canDraw}>
              Ambil tangkapan satu halaman
            </Btn>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <section className="flex flex-col gap-3">
            <h3 className="lt-title text-base">Yang akan dipotong</h3>

            {draft && shown ? (
              <>
                <CropPreview url={shown} page={page} box={draft.box} />
                <Note>
                  Pratinjau ini diperbesar dari gambar halaman di layar.
                  Potongan yang masuk ke berkas hasil dipotong dari halaman
                  resolusi penuh.
                </Note>
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--ink-2)" }}>
                Belum ada area. Tarik di halaman, lalu potongannya muncul di
                sini sebelum Anda menyimpannya.
              </p>
            )}

            {/* The same register the review plate shows, so a zone drawn by
                hand is read in the same vocabulary, and held to the same
                visible standard, as one the model proposed. */}
            {draft ? (
              <>
                <Cite cite={cite} />
                <CiteAdvisories cite={cite} />

                {/* A whole-page capture says nothing about snapping worth
                    saying: `CiteAdvisories` above already names it as one, and
                    the page has no edge to have followed a line at. */}
                {cite?.wholePage ? null : draft.mode === "snapped" ? (
                  <Note>
                    Terkunci ke baris penuh, ditambah margin {CROP_PADDING_PX}{" "}
                    piksel di setiap sisi.
                  </Note>
                ) : draft.mode === "existing" ? (
                  /* A `Zone` carries no record of how it was drawn, so this
                     says "not recorded" instead of claiming it was snapped,
                     which is what the old readout did to every reopened
                     free-pixel capture. */
                  <Advisory>
                    Cara area ini dibuat tidak tercatat, jadi belum bisa
                    dipastikan apakah dulu dikunci ke baris. Gambar ulang bila
                    Anda ingin memastikannya mengikuti baris.
                  </Advisory>
                ) : draft.forced ? (
                  <Note>Piksel apa adanya, atas permintaan Anda.</Note>
                ) : (
                  /* Snapping was on and quietly fell through for want of a
                     line to snap to. That is correct behaviour and it must be
                     said here, because the toggle below still reads "aktif"
                     and two statements on one screen may not disagree about
                     what just happened. */
                  <Advisory>
                    Kunci ke baris menyala, tetapi tidak ada baris yang bisa
                    dikunci di area ini, jadi tarikan Anda dipakai apa adanya.
                    Periksa apakah areanya memang tidak perlu mengikuti baris.
                  </Advisory>
                )}

                {!cited ? (
                  <Advisory>
                    Tanpa kutipan baris. Wajar untuk tanda tangan, stempel atau
                    materai. Potongannya tetap tersimpan sebagai gambar, tetapi
                    tidak ada baris yang bisa ditelusuri kembali oleh pemeriksa.
                  </Advisory>
                ) : null}

                {strayLines.length > 0 ? (
                  <Advisory>
                    {strayLines.length} baris ikut terlihat di potongan tetapi
                    tidak masuk kutipan. Periksa apakah baris itu memang tidak
                    diperlukan, atau tambahkan lewat tombol Atas +1 dan Bawah
                    +1 di bawah ini.
                  </Advisory>
                ) : null}

                {cited ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="lt-label">Sesuaikan per baris</span>
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
              </>
            ) : null}
          </section>

          <section className="flex min-h-0 flex-col gap-2">
            <h3 className="lt-title text-base">Teks di dalamnya</h3>
            {citedLines.length > 0 ? (
              /* The transcript is a CLOSED cross-check, never the thing being
                 judged: OCR text can be right while the rectangle is wrong.
                 Line numbers are mono because they are read against the
                 citation's own range down a column; the document's prose is
                 not, and monospace prose at 13px reads as debug output. */
              <ol className="lt-well max-h-72 overflow-auto p-2 text-[0.8125rem]">
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
            ) : (
              <p className="text-sm" style={{ color: "var(--ink-2)" }}>
                {!draft
                  ? "Belum ada area, jadi belum ada teks yang dikutip."
                  : emptyPage
                    ? "Halaman ini tidak punya baris teks terbaca, jadi tidak ada teks yang bisa dikutip."
                    : "Tidak ada baris utuh di dalam area ini, jadi potongannya tersimpan tanpa kutipan baris."}
              </p>
            )}
          </section>
        </aside>
      </div>

      {/* The bar stays with the operator. Drawing happens at the bottom of a
          page and committing used to happen at the top of the document, so
          every correction ended in a scroll away from the evidence. */}
      <div className="lt-rail sticky bottom-0 z-10 flex flex-col gap-2 border-t px-1 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="mr-auto flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="lt-figure text-[0.8125rem]" title={sourceName}>
              {shortenFileName(sourceName, 26)}
            </span>
            <span className="lt-label">halaman</span>
            <span className="lt-figure text-[0.8125rem]">
              {pageOrdinal + 1} dari {pagesInDoc}
            </span>
            {dragging ? <span className="lt-label">sedang menggambar</span> : null}
          </p>

          {/* The mode's NAME does not change with its state; the state is said
              in words beside it, drawn as a glyph, and carried by the pressed
              styling. A label that is its own state is ambiguous about whether
              it describes what is happening or what clicking will do, and the
              operator had to test it mid-task to find out. */}
          <Btn
            on={snapMode}
            aria-pressed={snapMode}
            onClick={() => setSnapMode((on) => !on)}
          >
            <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
              {snapMode ? (
                <>
                  <line
                    x1={1}
                    y1={4}
                    x2={15}
                    y2={4}
                    stroke="currentColor"
                    strokeWidth={1.5}
                  />
                  <line
                    x1={1}
                    y1={12}
                    x2={15}
                    y2={12}
                    stroke="currentColor"
                    strokeWidth={1.5}
                  />
                  <rect
                    x={2}
                    y={4}
                    width={12}
                    height={8}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  />
                </>
              ) : (
                <rect
                  x={2}
                  y={3}
                  width={12}
                  height={10}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeDasharray="2 2"
                />
              )}
            </svg>
            Kunci ke baris: {snapMode ? "aktif" : "mati"}
          </Btn>

          <Btn onClick={requestCancel}>Batal</Btn>
          <Btn tone="primary" onClick={save} disabled={Boolean(blocked)}>
            Pakai area ini
          </Btn>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {/* A disabled primary action never appears without its reason beside
              it, in the same viewport. And it clears AFFIRMATIVELY: an absent
              warning is not a confirmation, so the ready state is a state
              rather than the absence of one. Full-strength ink in both cases:
              quietness here is bought with size and position, never with
              contrast. */}
          <span className="text-[0.8125rem]" style={{ color: "var(--ink)" }}>
            {blocked ?? "Siap disimpan sebagai bukti bagian ini."}
          </span>
          <span
            className="max-w-[68ch] text-[0.8125rem]"
            style={{ color: "var(--ink-2)" }}
          >
            {snapMode
              ? `Tahan ${altName} sambil menarik untuk sekali ini memakai piksel apa adanya, misalnya di tanda tangan atau stempel.`
              : "Setiap tarikan memakai piksel apa adanya. Nyalakan kunci ke baris untuk mengikuti baris teks."}
          </span>
        </div>

        {confirmDiscard ? (
          <div className="flex flex-wrap items-center gap-3">
            <Notice tone="warn">
              Area yang Anda gambar belum disimpan. Menutup sekarang
              membuangnya.
            </Notice>
            <Btn tone="reject" onClick={onCancel}>
              Buang area ini dan tutup
            </Btn>
            <Btn onClick={() => setConfirmDiscard(false)}>Lanjut menggambar</Btn>
          </div>
        ) : null}
      </div>
    </div>
  );
}
