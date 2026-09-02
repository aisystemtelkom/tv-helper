"use client";

/**
 * One slot on the contact sheet.
 *
 * The plate shows the three things the design says make a proposal judgeable
 * without navigating away, side by side: the crop, the page and line range it
 * came from, and the text those lines contain. Nothing here summarises or
 * scores the proposal on the operator's behalf -- the point is that a person
 * looks at the evidence.
 *
 * A slot that holds more than one capture (the sample's `KB (lanjutan)` ToP
 * row stacks two pictures in one cell) shows one row per capture, INCLUDING
 * the ones still missing. A half-filled slot rendered as a single tidy row is
 * the wrong-and-quiet failure: the sheet looks complete and the deliverable is
 * short one piece of evidence.
 */

import type { Citation } from "@/lib/ui/evidence";
import { citeZone, hasLineCitation } from "@/lib/ui/evidence";
import type { BrowserRun, SlotState } from "@/lib/ui/runtime";
import type { SlotAggregate } from "@/lib/ui/slots";

import { Btn, Chip, Cite } from "./chrome";

export type PlateActions = {
  onAccept: (slotIndex: number) => void;
  onReject: (slotIndex: number) => void;
  onRedraw: (slotIndex: number) => void;
  onUnfill: (slotIndex: number) => void;
  onReopen: (slotIndex: number) => void;
  /** Draw a capture this slot does not have a state for yet. */
  onDrawNew: (slotKey: string, label: string) => void;
};

function Transcript({ text }: { text?: string }) {
  if (!text || text.trim() === "") {
    return (
      <p className="lt-mono text-xs" style={{ color: "var(--lt-faint)" }}>
        no OCR text recorded for this zone
      </p>
    );
  }
  return (
    <pre
      className="lt-sunken lt-mono max-h-36 overflow-auto p-2 text-xs whitespace-pre-wrap"
      style={{ color: "var(--lt-dim)" }}
    >
      {text}
    </pre>
  );
}

function CaptureRow({
  run,
  state,
  slotIndex,
  thumbUrl,
  showChip,
  actions,
}: {
  run: BrowserRun;
  state: SlotState;
  slotIndex: number;
  thumbUrl?: string;
  /** Only when a slot holds several captures; otherwise the header says it. */
  showChip: boolean;
  actions: PlateActions;
}) {
  const cite: Citation | null = state.zone ? citeZone(run, state.zone) : null;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        {state.zone ? (
          thumbUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- a blob URL
               cut in this tab from a document that must never leave it;
               next/image would want a loader and a remote pattern. */
            <img
              src={thumbUrl}
              alt={`Crop proposed for ${state.label}`}
              className="lt-paper w-full object-contain"
            />
          ) : (
            <div
              className="lt-sunken flex h-28 items-center justify-center text-xs"
              style={{ color: "var(--lt-faint)" }}
            >
              cutting the crop...
            </div>
          )
        ) : (
          <div
            className="lt-hatch flex h-28 items-center justify-center px-3 text-center text-xs"
            style={{ color: "var(--lt-void)" }}
          >
            {state.status === "unfilled"
              ? "ships empty, on the record"
              : state.status === "outstanding"
                ? "searched, not found"
                : "not searched yet"}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {showChip ? <Chip status={state.status} /> : null}
          {state.origin ? (
            <span className="lt-mono text-xs" style={{ color: "var(--lt-faint)" }}>
              {state.origin === "human" ? "drawn by hand" : "proposed by model"}
            </span>
          ) : null}
          {state.zone && !hasLineCitation(state.zone) ? (
            <span className="lt-mono text-xs" style={{ color: "var(--lt-void)" }}>
              free pixels
            </span>
          ) : null}
          {/* A sliced rectangle, said out loud. Gemini returns paragraph
              blocks rather than printed lines, so a multi-line block's lines
              get equal vertical bands: the text is measured, the top and
              bottom edges are arithmetic. The operator is the only one who
              can look at the crop and see whether the cut landed where the
              page actually breaks, so the count is shown rather than acted
              on. Nothing is rendered at zero -- and a run ingested before the
              migration records no origin at all, so it counts none and shows
              none. */}
          {cite && cite.interpolatedLines > 0 ? (
            <span className="lt-mono text-xs" style={{ color: "var(--lt-mark)" }}>
              {cite.interpolatedLines} of {cite.lineCount} lines sliced, not
              measured
            </span>
          ) : null}
        </div>

        {state.zone ? <Cite cite={cite} /> : null}
        {state.zone ? <Transcript text={state.text} /> : null}

        <div className="flex flex-wrap gap-2 pt-1">
          {state.status === "proposed" ? (
            <>
              <Btn tone="accept" onClick={() => actions.onAccept(slotIndex)}>
                Accept
              </Btn>
              <Btn onClick={() => actions.onRedraw(slotIndex)}>Redraw</Btn>
              <Btn tone="reject" onClick={() => actions.onReject(slotIndex)}>
                Not this
              </Btn>
            </>
          ) : null}

          {state.status === "confirmed" ? (
            <>
              <Btn onClick={() => actions.onRedraw(slotIndex)}>Redraw</Btn>
              <Btn onClick={() => actions.onReopen(slotIndex)}>
                Undo, review again
              </Btn>
            </>
          ) : null}

          {state.status === "outstanding" || state.status === "pending" ? (
            <>
              <Btn onClick={() => actions.onRedraw(slotIndex)}>
                Draw it by hand
              </Btn>
              <Btn onClick={() => actions.onUnfill(slotIndex)}>
                Ship this one empty
              </Btn>
            </>
          ) : null}

          {state.status === "unfilled" ? (
            <Btn onClick={() => actions.onReopen(slotIndex)}>
              Reopen this slot
            </Btn>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ProposalPlate({
  run,
  entry,
  thumbs,
  actions,
}: {
  run: BrowserRun;
  entry: SlotAggregate;
  thumbs: Record<string, string>;
  actions: PlateActions;
}) {
  const missing = Math.max(0, entry.required - entry.states.length);

  return (
    <article className="lt-card flex flex-col gap-3 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-semibold">{entry.def.label}</h3>
          <span className="lt-mono text-xs" style={{ color: "var(--lt-faint)" }}>
            {entry.def.key}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {entry.required > 1 ? (
            <span
              className="lt-mono text-xs"
              style={{
                color:
                  entry.found >= entry.required
                    ? "var(--lt-dim)"
                    : "var(--lt-mark)",
              }}
            >
              {entry.found} of {entry.required} captures
            </span>
          ) : null}
          <Chip status={entry.status} />
        </div>
      </header>

      {!entry.def.fillable ? (
        <div className="lt-hatch px-3 py-4 text-xs" style={{ color: "var(--lt-void)" }}>
          Deliberately empty. This cell comes from EPIC or the config
          spreadsheet, so the document ships it blank, sized and labelled, for
          the operator to paste into.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {entry.states.map(({ state, index }) => (
            <CaptureRow
              key={`${entry.def.key}-${index}`}
              run={run}
              state={state}
              slotIndex={index}
              thumbUrl={thumbs[String(index)]}
              showChip={entry.required > 1 || entry.states.length > 1}
              actions={actions}
            />
          ))}

          {Array.from({ length: missing }, (_, i) => (
            <div
              key={`${entry.def.key}-missing-${i}`}
              className="flex flex-wrap items-center gap-3"
            >
              <div
                className="lt-hatch px-3 py-2 text-xs"
                style={{ color: "var(--lt-void)" }}
              >
                capture {entry.states.length + i + 1} of {entry.required}: nothing
                has looked for this yet
              </div>
              <Btn
                onClick={() => actions.onDrawNew(entry.def.key, entry.def.label)}
              >
                Draw it by hand
              </Btn>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
