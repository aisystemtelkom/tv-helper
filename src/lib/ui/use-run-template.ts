"use client";

/**
 * THIS ORDER'S FORM, resolved once per render pass, for every screen that
 * draws it.
 *
 * WHY A HOOK AND NOT NINE CALLS TO `resolveTemplate`. Before this existed,
 * nine call sites across five screens read the module constant `AO_TEMPLATE`
 * directly. That was correct for exactly as long as a run's form could not
 * differ from the compile-time one, and `BrowserRun.overlay` ended that: a
 * judul the operator renamed, deleted, reordered or added lives in the overlay
 * and NOWHERE ELSE. A screen still reading the constant renders the packet
 * under names the operator replaced, lists a bagian they deleted as work still
 * owed, and -- worst of the three -- plans an export that does not match the
 * sheet they just signed off. All three open fine and look complete, which is
 * the failure class this project is organised against.
 *
 * IT COSTS NOTHING UNTIL AN ORDER IS ACTUALLY EDITED. `resolveTemplate(base,
 * undefined)` and `resolveTemplate(base, emptyOverlay(base))` return `base` BY
 * IDENTITY (see the resolver's own comment), so for every unedited run this
 * memo hands back the same object every time and any downstream `useMemo`
 * keyed on it never re-runs. The memo is here for the edited case, where the
 * resolver builds a new section list and a fresh one per render would defeat
 * every reference comparison below it.
 *
 * KEYED ON THE OVERLAY, NOT ON THE RUN. A run's identity changes on every
 * page appended, every zone confirmed and every save that advances `rev`, and
 * none of those can change the form. Keying on `run.overlay` means an ingest
 * that adds 151 pages re-resolves nothing.
 *
 * IT MAY THROW, and that is deliberate. `resolveTemplate` refuses an overlay
 * whose `base` is not this template's id, because the quiet alternative
 * resolves every patch against a form that declares none of its ids and shows
 * the operator a packet with their edits silently missing.
 */

import { useMemo } from "react";

import { resolveTemplate } from "../forms/overlay.ts";
import { AO_TEMPLATE, type Template } from "../forms/template.ts";
import type { BrowserRun } from "./runtime.ts";

export function useRunTemplate(run: BrowserRun | null): Template {
  const overlay = run?.overlay;
  return useMemo(() => resolveTemplate(AO_TEMPLATE, overlay), [overlay]);
}
