"use client";

/**
 * Screen 3: the dokumen tambahan loop.
 *
 * The requirement (2026-08-31 corrections, section 4) is not "show what is
 * missing". It is to turn "not found" from a silent gap into a decision the
 * operator makes on the record, because a validation document with an
 * unexplained empty cell is indistinguishable from one where the evidence
 * genuinely does not exist.
 *
 * So this screen asks a question and will not answer it for anybody:
 *
 *   1. it names every slot that came back without evidence;
 *   2. it asks whether another document exists;
 *   3. yes -> take the upload, and only the outstanding slots are searched;
 *   4. repeat, keeping every zone earlier rounds already found;
 *   5. no -> each remaining slot gets an explicit terminal choice, either
 *      DRAW IT BY HAND from a document already loaded, or ship empty.
 *
 * Manual selection is the designed terminal state, not a fallback, which is
 * why it sits beside "ship empty" as an equal choice rather than behind it.
 */

import { useState } from "react";

import { AO_TEMPLATE } from "@/lib/forms/template";
import type { BrowserRun } from "@/lib/ui/runtime";
import { describeOutstanding, progressOf } from "@/lib/ui/slots";

import { Btn, Chip, Eyebrow, Notice } from "./chrome";
import { DocumentDrop, type IngestProgress } from "./ingest-panel";

export type RoundLog = {
  round: number;
  document: string;
  pagesAdded: number;
  outstandingAfter: number;
};

export function OutstandingPanel({
  run,
  outstandingKeys,
  rounds,
  progress,
  busy,
  error,
  onFiles,
  onDraw,
  onUnfill,
  onUnfillAll,
}: {
  run: BrowserRun;
  /** Positions in `run.slots` the runtime reports as outstanding. */
  outstandingKeys: number[];
  rounds: RoundLog[];
  progress: IngestProgress | null;
  busy: boolean;
  error: string | null;
  onFiles: (files: File[]) => void;
  onDraw: (slotIndex: number) => void;
  onUnfill: (slotIndex: number) => void;
  onUnfillAll: (slotIndexes: number[]) => void;
}) {
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);

  const entries = describeOutstanding(
    outstandingKeys.map((i) => run.slots[i]).filter(Boolean),
    AO_TEMPLATE,
  );
  const counts = progressOf(run, AO_TEMPLATE);

  if (outstandingKeys.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Notice>
          Nothing is outstanding. Every slot a document can back has either been
          filled or been settled by hand.
        </Notice>
        {counts.pending > 0 ? (
          <Notice tone="warn">
            {counts.pending} slot{counts.pending === 1 ? " has" : "s have"} not
            been searched at all. Ingest ran but nothing proposed a zone for
            them, so they are not yet a decision anyone has made.
          </Notice>
        ) : null}
        <RoundHistory rounds={rounds} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="lt-card flex flex-col gap-3 p-5">
        <Eyebrow>Searched, not found</Eyebrow>
        <p className="text-sm" style={{ color: "var(--lt-dim)" }}>
          {outstandingKeys.length} slot
          {outstandingKeys.length === 1 ? "" : "s"} came back without evidence.
          None of them will ship as a silent blank: each one below ends in a
          decision you make here.
        </p>
        <ul className="flex flex-col divide-y" style={{ borderColor: "var(--lt-edge)" }}>
          {entries.map((entry, i) => {
            const slotIndex = outstandingKeys[i];
            return (
              <li
                key={`${entry.state.key}-${slotIndex}`}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm">{entry.label}</span>
                  <span
                    className="lt-mono text-xs"
                    style={{ color: "var(--lt-faint)" }}
                  >
                    {entry.sectionTitle} · {entry.state.key}
                    {entry.def && (entry.def.crops ?? 1) > 1
                      ? ` · this slot holds ${entry.def.crops} captures`
                      : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Chip status="outstanding" />
                  <Btn onClick={() => onDraw(slotIndex)}>Draw it by hand</Btn>
                  <Btn onClick={() => onUnfill(slotIndex)}>Ship empty</Btn>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="lt-card flex flex-col gap-3 p-5">
        <Eyebrow>Is there a dokumen tambahan?</Eyebrow>
        <p className="text-sm" style={{ color: "var(--lt-dim)" }}>
          Another document may hold what these slots need. If one exists, add it
          and only the slots above are searched again - everything already
          confirmed is kept.
        </p>
        <div className="flex flex-wrap gap-2">
          <Btn
            tone={answer === "yes" ? "primary" : "default"}
            onClick={() => setAnswer("yes")}
          >
            Yes, I have another document
          </Btn>
          <Btn
            tone={answer === "no" ? "primary" : "default"}
            onClick={() => setAnswer("no")}
          >
            No, that is everything
          </Btn>
        </div>

        {answer === "yes" ? (
          <div className="flex flex-col gap-3 pt-2">
            <DocumentDrop
              label={`Dokumen tambahan · round ${rounds.length + 2}`}
              hint="Searched for the outstanding slots only, which is also what keeps the cost of a fourth document proportional to what it can still answer."
              disabled={busy}
              onFiles={onFiles}
            />
            {progress ? (
              <p className="lt-mono text-xs" style={{ color: "var(--lt-dim)" }}>
                reading {progress.name}: page {progress.done} of {progress.total}
              </p>
            ) : null}
            {error ? <Notice tone="stop">{error}</Notice> : null}
          </div>
        ) : null}

        {answer === "no" ? (
          <div className="flex flex-col gap-3 pt-2">
            <Notice tone="warn">
              Then each slot above needs a decision. Draw the region by hand from
              a document already loaded, or ship it empty - which is recorded as
              a decision, not as a gap.
            </Notice>
            <div>
              <Btn tone="reject" onClick={() => onUnfillAll(outstandingKeys)}>
                Ship all {outstandingKeys.length} empty
              </Btn>
            </div>
          </div>
        ) : null}
      </section>

      <RoundHistory rounds={rounds} />
    </div>
  );
}

function RoundHistory({ rounds }: { rounds: RoundLog[] }) {
  if (rounds.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <Eyebrow>Rounds so far</Eyebrow>
      <ul className="flex flex-col gap-1">
        {rounds.map((round) => (
          <li
            key={round.round}
            className="lt-mono text-xs"
            style={{ color: "var(--lt-dim)" }}
          >
            round {round.round} · {round.document} · +{round.pagesAdded} pages ·{" "}
            {round.outstandingAfter} outstanding after
          </li>
        ))}
      </ul>
    </section>
  );
}
