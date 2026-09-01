"use client";

/**
 * Screen 2, and the primary one: every proposed crop on a single page.
 *
 * The whole argument for a contact sheet is that a SYSTEMATIC failure -- every
 * crop off by a page, every range running into the footer -- is obvious at a
 * glance here, where it would take eleven screens of drilling to notice one
 * slot at a time. So the sheet stays one scrolling column in template order,
 * with the section index above it, and it never hides a slot behind a filter
 * by default.
 *
 * Bulk accept is offered per section rather than for the whole sheet. Accepting
 * thirteen crops with one click is the single easiest way for an unreviewed
 * zone to reach a document somebody signs, and a section is small enough that
 * the operator has actually looked at all of it.
 */

import { useMemo } from "react";

import { AO_TEMPLATE } from "@/lib/forms/template";
import type { BrowserRun } from "@/lib/ui/runtime";
import {
  proposedIndexesIn,
  sheetSections,
  unmatchedStates,
} from "@/lib/ui/slots";

import { Btn, Chip, Eyebrow, Notice } from "./chrome";
import { ProposalPlate, type PlateActions } from "./proposal-plate";
import { useCropThumbs } from "./use-crop-thumbs";

function anchorFor(title: string): string {
  return `sec-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export function ContactSheet({
  run,
  actions,
  onAcceptSection,
}: {
  run: BrowserRun;
  actions: PlateActions;
  onAcceptSection: (slotIndexes: number[]) => void;
}) {
  const thumbs = useCropThumbs(run);
  const sections = useMemo(() => sheetSections(run, AO_TEMPLATE), [run]);
  const orphans = useMemo(() => unmatchedStates(run, AO_TEMPLATE), [run]);


  return (
    <div className="flex flex-col gap-6">
      <nav className="lt-card flex flex-wrap gap-1 p-2">
        {sections.map((section) => {
          const waiting = section.entries.filter(
            (e) => e.status === "proposed",
          ).length;
          return (
            <a
              key={section.title}
              href={`#${anchorFor(section.title)}`}
              className="lt-btn lt-mono text-xs"
              style={
                waiting > 0 ? { borderColor: "var(--lt-mark)" } : undefined
              }
            >
              {section.title}
              {waiting > 0 ? (
                <span style={{ color: "var(--lt-mark)" }}> {waiting}</span>
              ) : null}
            </a>
          );
        })}
      </nav>

      {sections.map((section) => {
        const waiting = proposedIndexesIn(section);
        return (
          <section
            key={section.title}
            id={anchorFor(section.title)}
            className="flex scroll-mt-24 flex-col gap-3"
          >
            <header
              className="flex flex-wrap items-baseline justify-between gap-3 border-b pb-2"
              style={{ borderColor: "var(--lt-edge)" }}
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-sm font-semibold tracking-wide">
                  {section.title}
                </h2>
                <span
                  className="lt-mono text-xs"
                  style={{ color: "var(--lt-faint)" }}
                >
                  {section.layout === "images"
                    ? "whole-page captures"
                    : "regions within a page"}
                  {" · "}
                  {section.entries.length} slots
                </span>
              </div>
              {waiting.length > 0 ? (
                <Btn tone="accept" onClick={() => onAcceptSection(waiting)}>
                  Accept all {waiting.length} in {section.title}
                </Btn>
              ) : null}
            </header>

            {section.entries.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--lt-faint)" }}>
                This section ships empty in the sample and ships empty here.
                Its heading is kept so the operator can fill it by hand.
              </p>
            ) : (
              section.entries.map((entry) => (
                <ProposalPlate
                  key={entry.def.key}
                  run={run}
                  entry={entry}
                  thumbs={thumbs}
                  actions={actions}
                />
              ))
            )}
          </section>
        );
      })}

      {orphans.length > 0 ? (
        <section className="flex flex-col gap-2">
          <Eyebrow>Not in this template</Eyebrow>
          <Notice tone="warn">
            This run holds {orphans.length} capture
            {orphans.length === 1 ? "" : "s"} under a slot key the template no
            longer declares. They are listed so nothing confirmed disappears
            quietly; the exporter will not place them.
          </Notice>
          <ul className="flex flex-col gap-1">
            {orphans.map((state, i) => (
              <li
                key={`${state.key}-${i}`}
                className="lt-mono flex items-center gap-3 text-xs"
              >
                <Chip status={state.status} />
                <span>{state.key}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
