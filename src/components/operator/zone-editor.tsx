"use client";

/**
 * Correcting a zone by dragging on the page.
 *
 * Two things here are requirements rather than polish:
 *
 *  - IT SNAPS TO OCR LINE BOUNDARIES. A crop that slices a line of text in
 *    half is never what anyone wants. Holding Alt gives free pixels, which is
 *    what a signature or stamp block needs, because it has no lines to snap to.
 *  - THE OPERATOR CAN PICK ANY LOADED PAGE. Manual selection is the designed
 *    terminal state for a slot no document could fill, so the editor has to be
 *    reachable with no starting zone and let the operator go and find the
 *    region themselves.
 *
 * Overlay geometry is expressed in PERCENTAGES of the page, never in scaled
 * pixels. The page image is fluid, so a pixel-based overlay would need a
 * resize listener and would drift from the crop by however much that listener
 * lagged -- and a rectangle drawn a few pixels off the one that gets cut is
 * a picture of a lie.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { Box } from "@/lib/pipeline/render";
import { pageToDisplayUrl } from "@/lib/ui/crops";
import {
  hasLineCitation,
  resolvePage,
  sizeInInches,
  textForLineRange,
  zonePageRef,
} from "@/lib/ui/evidence";
import type { BrowserRun, StoredPage, Zone } from "@/lib/ui/runtime";
import { useRuntime } from "@/lib/ui/runtime-context";
import {
  drawZone,
  isMeaningfulDrag,
  linesTouchedBy,
  normalizeBox,
  type DrawnZone,
  type Point,
} from "@/lib/ui/snap";

import { Btn, Eyebrow, Notice } from "./chrome";

export type EditorTarget = {
  /** Position in `run.slots`, or null for a capture the run does not hold yet. */
  slotIndex: number | null;
  slotKey: string;
  label: string;
  zone?: Zone;
};

function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function PageChoice({
  run,
  pageId,
  onPick,
}: {
  run: BrowserRun;
  pageId: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {run.pages.map((page) => {
        const source = run.sources.find((s) => s.id === page.sourceId);
        const own = run.pages
          .filter((p) => p.sourceId === page.sourceId)
          .indexOf(page);
        return (
          <button
            key={page.id}
            type="button"
            onClick={() => onPick(page.id)}
            className="lt-btn lt-mono shrink-0 text-xs"
            style={
              page.id === pageId
                ? {
                    borderColor: "var(--lt-mark)",
                    color: "var(--lt-mark)",
                  }
                : undefined
            }
            title={source?.name ?? page.sourceId}
          >
            {(source?.name ?? page.sourceId).slice(0, 18)} p{own + 1}
          </button>
        );
      })}
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

  const startPageId =
    (target.zone ? resolvePage(run, target.zone.pageIndex)?.page.id : null) ??
    run.pages[0]?.id ??
    "";

  const [pageId, setPageId] = useState(startPageId);
  const [display, setDisplay] = useState<{ url: string; page: string } | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  const [snapMode, setSnapMode] = useState(true);
  /**
   * A ref, not state. Pointer events can arrive faster than React commits, and
   * a `pointermove` (or a quick `pointerup`) that read a stale `null` origin
   * from the previous render would silently drop the drag -- the operator
   * draws a rectangle and nothing happens. A ref updates in the same tick the
   * pointer went down.
   */
  const dragOrigin = useRef<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const [draft, setDraft] = useState<DrawnZone | null>(
    target.zone
      ? { box: target.zone.box, lineRange: target.zone.lineRange, mode: "snapped" }
      : null,
  );

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
          setFailed(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [runtime, run.id, pageId]);

  if (!page) {
    return (
      <div className="lt-card p-6">
        <Notice tone="stop">
          This run holds no pages to draw on. Ingest a document first.
        </Notice>
        <div className="pt-3">
          <Btn onClick={onCancel}>Close</Btn>
        </div>
      </div>
    );
  }

  const toPage = (event: React.PointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = rect.width / page.widthPx;
    return {
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    };
  };

  const shouldSnap = (event: { altKey: boolean }) => snapMode && !event.altKey;

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
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
    setDraft(null);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = dragOrigin.current;
    if (!from) return;
    const raw = normalizeBox(from, toPage(event));
    setDraft(drawZone(raw, page, shouldSnap(event)));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = dragOrigin.current;
    if (!from) return;
    const raw = normalizeBox(from, toPage(event));
    dragOrigin.current = null;
    setDragging(false);
    // A mis-click must not replace a good proposal with a few pixels of paper.
    if (!isMeaningfulDrag(raw)) {
      setDraft(
        target.zone
          ? {
              box: target.zone.box,
              lineRange: target.zone.lineRange,
              mode: "snapped",
            }
          : null,
      );
      return;
    }
    setDraft(drawZone(raw, page, shouldSnap(event)));
  };

  const guides = draft
    ? linesTouchedBy(page.lines, draft.box, 0.01)
    : [];

  const box: Box | null = draft?.box ?? null;
  const cited = draft ? hasLineCitation({
    pageIndex: 0,
    box: draft.box,
    lineRange: draft.lineRange,
  }) : false;
  const preview = draft && cited
    ? textForLineRange(page, draft.lineRange[0], draft.lineRange[1])
    : "";

  const save = () => {
    if (!draft) return;
    onSave(
      target,
      {
        pageIndex: zonePageRef(run, page),
        box: draft.box,
        lineRange: draft.lineRange,
      },
      cited ? preview : "",
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Eyebrow>Zone editor</Eyebrow>
          <h2 className="text-base font-semibold">{target.label}</h2>
          <p className="lt-mono text-xs" style={{ color: "var(--lt-faint)" }}>
            {target.slotKey}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn
            onClick={() => setSnapMode((on) => !on)}
            aria-pressed={snapMode}
            style={snapMode ? { borderColor: "var(--lt-mark)" } : undefined}
          >
            {snapMode ? "Snapping to lines" : "Free pixels"}
          </Btn>
          <Btn onClick={onCancel}>Cancel</Btn>
          <Btn tone="primary" onClick={save} disabled={!draft}>
            Use this zone
          </Btn>
        </div>
      </header>

      <PageChoice run={run} pageId={pageId} onPick={setPageId} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="lt-sunken overflow-hidden p-2">
          {failed ? (
            <Notice tone="stop">This page would not render: {failed}</Notice>
          ) : null}
          <div
            className="relative w-full touch-none select-none"
            style={{ aspectRatio: `${page.widthPx} / ${page.heightPx}` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              dragOrigin.current = null;
              setDragging(false);
            }}
          >
            {display && display.page === pageId ? (
              /* eslint-disable-next-line @next/next/no-img-element -- a blob
                 URL rendered in this tab from a document that never leaves it. */
              <img
                src={display.url}
                alt={`Page ${page.index}`}
                className="absolute inset-0 h-full w-full bg-white object-contain"
                draggable={false}
              />
            ) : (
              <div
                className="absolute inset-0 flex items-center justify-center text-xs"
                style={{ color: "var(--lt-faint)" }}
              >
                rendering the page...
              </div>
            )}

            {box ? (
              <>
                {/* Everything outside the zone dims, so the crop is the only
                    lit thing on the page -- the same trick a light table plays. */}
                <div
                  className="lt-scrim"
                  style={{ left: 0, top: 0, right: 0, height: pct(box.y, page.heightPx) }}
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
                  }}
                />
              </>
            ) : null}

            {dragging
              ? guides.map((line) => (
                  <div
                    key={line.i}
                    className="lt-guide"
                    style={{ top: pct(line.box.y, page.heightPx) }}
                  />
                ))
              : null}
          </div>
        </div>

        <aside className="flex flex-col gap-3">
          <div className="lt-card flex flex-col gap-2 p-3">
            <Eyebrow>What will be cut</Eyebrow>
            {draft ? (
              <>
                <p className="lt-mono text-xs" style={{ color: "var(--lt-dim)" }}>
                  {Math.round(draft.box.w)} x {Math.round(draft.box.h)} px
                  {"  ·  "}
                  {sizeInInches(draft.box)}
                </p>
                <p
                  className="lt-mono text-xs"
                  style={{
                    color: cited ? "var(--lt-ok)" : "var(--lt-void)",
                  }}
                >
                  {cited
                    ? `cites L ${draft.lineRange[0]}-${draft.lineRange[1]} (${
                        draft.lineRange[1] - draft.lineRange[0] + 1
                      } lines)`
                    : "no line citation: free pixels over blank paper"}
                </p>
                <p className="lt-mono text-xs" style={{ color: "var(--lt-faint)" }}>
                  {draft.mode === "snapped"
                    ? "snapped to whole lines"
                    : "exact pixels, nothing snapped"}
                </p>
              </>
            ) : (
              <p className="text-xs" style={{ color: "var(--lt-faint)" }}>
                Drag on the page to draw the region. Hold Alt while dragging for
                free pixels.
              </p>
            )}
          </div>

          <div className="lt-card flex min-h-0 flex-col gap-2 p-3">
            <Eyebrow>Text inside it</Eyebrow>
            {preview ? (
              <pre
                className="lt-sunken lt-mono max-h-64 overflow-auto p-2 text-xs whitespace-pre-wrap"
                style={{ color: "var(--lt-dim)" }}
              >
                {preview}
              </pre>
            ) : (
              <p className="text-xs" style={{ color: "var(--lt-faint)" }}>
                No OCR lines fall inside this rectangle. That is expected on a
                signature or stamp block, and it means the crop ships without a
                line citation.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
