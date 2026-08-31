"use client";

/**
 * Cutting every proposed crop for the contact sheet.
 *
 * Grouped by page and cut one page at a time, because a 300 DPI A4 page is
 * about 35MB as RGBA and the sheet shows a dozen crops taken from a handful
 * of pages. Holding a bitmap per crop is how a 29-page bundle turns into a
 * tab that runs out of memory.
 */

import { useEffect, useMemo, useState } from "react";

import type { Box } from "@/lib/pipeline/render";
import { cropToDisplayUrl, revokeUrls } from "@/lib/ui/crops";
import { resolvePage } from "@/lib/ui/evidence";
import type { BrowserRun } from "@/lib/ui/runtime";
import { useRuntime } from "@/lib/ui/runtime-context";

export type CropSpec = { id: string; pageId: string; box: Box };

/** One spec per slot state holding a zone, keyed by its position in the run. */
export function cropSpecs(run: BrowserRun): CropSpec[] {
  return run.slots.flatMap((slot, index) => {
    if (!slot.zone) return [];
    const resolved = resolvePage(run, slot.zone.pageIndex);
    if (!resolved) return [];
    return [{ id: String(index), pageId: resolved.page.id, box: slot.zone.box }];
  });
}

const NONE: Record<string, string> = {};

export function useCropThumbs(run: BrowserRun): Record<string, string> {
  const runtime = useRuntime();
  const runId = run.id;
  const key = useMemo(() => JSON.stringify(cropSpecs(run)), [run]);
  const [state, setState] = useState<{
    key: string;
    urls: Record<string, string>;
  }>({ key: "", urls: NONE });

  useEffect(() => {
    // The effect reads its work list back out of `key` rather than closing
    // over `run`. Accepting a proposal produces a new run object but changes
    // no zone, and re-cutting every thumbnail on each click would decode a
    // 35MB page per click.
    const specs = JSON.parse(key) as CropSpec[];
    let alive = true;
    const made: string[] = [];

    const byPage = new Map<string, CropSpec[]>();
    for (const spec of specs) {
      const group = byPage.get(spec.pageId);
      if (group) group.push(spec);
      else byPage.set(spec.pageId, [spec]);
    }

    void (async () => {
      for (const [pageId, group] of byPage) {
        if (!alive) return;
        let bitmap: ImageBitmap;
        try {
          bitmap = await runtime.pageBitmap(runId, pageId);
        } catch {
          // A page that will not render is reported by the plate itself as a
          // missing crop; one bad page must not stop the rest of the sheet.
          continue;
        }
        try {
          for (const spec of group) {
            const url = await cropToDisplayUrl(bitmap, spec.box);
            if (!alive) {
              URL.revokeObjectURL(url);
              return;
            }
            made.push(url);
            setState((prev) => ({
              key,
              urls: { ...(prev.key === key ? prev.urls : NONE), [spec.id]: url },
            }));
          }
        } finally {
          bitmap.close();
        }
      }
    })();

    return () => {
      alive = false;
      revokeUrls(made);
    };
  }, [runtime, runId, key]);

  return state.key === key ? state.urls : NONE;
}
