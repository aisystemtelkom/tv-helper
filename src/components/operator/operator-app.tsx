"use client";

/**
 * The operator workspace: one client shell holding the run, and four screens
 * over it.
 *
 * Deliberately ONE route. Every screen reads the same `BrowserRun`, which
 * lives in IndexedDB in the browser and cannot be read by a server component,
 * so splitting the screens across routes would buy deep links and pay for them
 * with four more places to re-load the run and four more auth surfaces. The
 * run id goes in the URL fragment instead, which survives a reload -- and a
 * reload during a three-minute OCR pass is not hypothetical.
 *
 * Every mutation goes through `commit`, which sets state and persists in the
 * same breath. A confirmed zone that lives only in React state is a decision
 * the operator believes they made and the deliverable will not carry.
 */

import { useEffect, useMemo, useState } from "react";

import { AO_TEMPLATE } from "@/lib/forms/template";
import { liveRuntime } from "@/lib/ui/live-runtime";
import { applyProposals, requestProposals, wantedKeys } from "@/lib/ui/propose";
import type { BrowserRun, RunSummary, SlotState } from "@/lib/ui/runtime";
import { RuntimeProvider, useRuntime } from "@/lib/ui/runtime-context";
import { outstandingIndexes, progressOf } from "@/lib/ui/slots";

import { Btn, Eyebrow, Notice, Tally } from "./chrome";
import { ContactSheet } from "./contact-sheet";
import { ExportPanel } from "./export-panel";
import { IngestPanel, type IngestProgress } from "./ingest-panel";
import { OutstandingPanel, type RoundLog } from "./outstanding-panel";
import { ZoneEditor, type EditorTarget } from "./zone-editor";
import type { PlateActions } from "./proposal-plate";

/**
 * THE REAL RUNTIME: IndexedDB on this device, rendering and OCR in a Web
 * Worker. `liveRuntime` is the whole binding, and `src/lib/ui/wiring.test.mts`
 * asserts that this module uses it -- the app shipped on `createStubRuntime()`
 * for an entire track precisely because nothing failed when it did.
 *
 * The stub is still worth having for local work on the screens (see
 * `src/lib/ui/stub-runtime.ts`), but it now refuses to construct in a
 * production build, so it cannot quietly take over again.
 */
const runtime = liveRuntime;

const PHASES = [
  { id: "ingest", label: "Ingest" },
  { id: "sheet", label: "Review" },
  { id: "outstanding", label: "Outstanding" },
  { id: "export", label: "Export" },
] as const;

type Phase = (typeof PHASES)[number]["id"];

/**
 * The open run's id, kept in the URL fragment so a reload comes back to it.
 *
 * `replaceState` rather than assigning `location.hash`: opening a run is not a
 * navigation the back button should have to walk through, and assigning to a
 * property of `window` is a mutation of module-external state that the React
 * compiler rules (rightly) refuse.
 */
function rememberRun(id: string | null): void {
  const url = new URL(window.location.href);
  url.hash = id ? `run/${id}` : "";
  window.history.replaceState(null, "", url);
}

export function OperatorApp() {
  return (
    <RuntimeProvider runtime={runtime}>
      <Workspace />
    </RuntimeProvider>
  );
}

function Workspace() {
  const runtime = useRuntime();

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<BrowserRun | null>(null);
  const [phase, setPhase] = useState<Phase>("ingest");
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [rounds, setRounds] = useState<RoundLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditorTarget | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await runtime.listRuns();
        if (!alive) return;
        setRuns(list);

        const wanted = window.location.hash.replace(/^#run\//, "");
        if (!wanted) return;
        const loaded = await runtime.loadRun(wanted);
        if (!alive || !loaded) return;
        setRun(loaded);
        setPhase(loaded.pages.length > 0 ? "sheet" : "ingest");
      } catch (problem) {
        if (alive) setError(String(problem));
      }
    })();
    return () => {
      alive = false;
    };
  }, [runtime]);

  const commit = (next: BrowserRun) => {
    setRun(next);
    void runtime
      .saveRun(next)
      // Keep what the store returns, not what we sent. `saveRun` advances the
      // run's `rev`, and saving from a run whose `rev` is behind is refused --
      // so dropping the result would make the SECOND confirmation of every
      // session fail. The refusal itself is deliberate: a save replaces a run
      // wholesale, so a stale write would silently delete every page an
      // in-flight ingest had added.
      .then(setRun)
      .catch((problem: unknown) => {
      // Saying so is the point: an operator who is told the save failed can
      // stop, where one who is not will keep confirming zones into a run that
      // will not survive the reload.
      setError(
        `The run could not be saved, so your last decision is only in this tab: ${String(problem)}`,
      );
    });
  };

  const patchSlot = (index: number, patch: Partial<SlotState>) => {
    if (!run) return;
    commit({
      ...run,
      slots: run.slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)),
    });
  };

  const openRun = async (id: string) => {
    setError(null);
    const loaded = await runtime.loadRun(id);
    if (!loaded) {
      setError(`Run ${id} is no longer in this browser's storage.`);
      return;
    }
    setRun(loaded);
    setRounds([]);
    rememberRun(id);
    setPhase(loaded.pages.length > 0 ? "sheet" : "ingest");
  };

  const ingest = async (files: File[]) => {
    setBusy(true);
    setError(null);
    try {
      /*
       * THE RUNTIME MINTS THE RUN, not this component.
       *
       * This used to build a `BrowserRun` here with `slots: []` and `saveRun`
       * it before ingesting. Against the real runtime that is silently fatal:
       * `ingestDocument` keeps the slots of a run that already exists, so the
       * empty list persisted, every page rendered and OCR'd correctly, and the
       * contact sheet came back with nothing to review. Passing an id the
       * runtime has never seen lets it seed every fillable slot -- one state
       * per capture, ordinals and all -- which is knowledge that belongs to
       * the template and the runtime, not to a screen.
       */
      let runId = run?.id ?? crypto.randomUUID();
      let current: BrowserRun | null = run;

      for (const file of files) {
        const before = current?.pages.length ?? 0;
        setProgress({ name: file.name, done: 0, total: 0 });
        const updated = await runtime.ingestDocument(
          runId,
          file,
          (done, total) => setProgress({ name: file.name, done, total }),
        );
        current = updated;
        runId = updated.id;
        setRounds((prev) => [
          ...prev,
          {
            round: prev.length + 1,
            document: file.name,
            pagesAdded: updated.pages.length - before,
            outstandingAfter: runtime.outstandingSlots(updated).length,
          },
        ]);
      }

      if (current) {
        setRun(current);
        rememberRun(current.id);
      }
      setPhase("sheet");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setBusy(false);
      setProgress(null);
      // Refreshed even when the ingest FAILED. Each page is persisted as it
      // finishes, so a bundle that died on page 20 of 29 still left a run
      // holding nineteen pages of OCR -- minutes of work the operator has
      // already paid for. Listing it only on success made that run invisible
      // until a reload, which reads as "nothing was saved".
      try {
        setRuns(await runtime.listRuns());
      } catch {
        /* the list is a convenience; never mask the ingest's own error */
      }
    }
  };

  /**
   * THE SEARCH. The only thing that moves a slot to "proposed".
   *
   * The run is RE-READ from storage first, and the answer is applied to that
   * fresh copy rather than to the `run` in React state. A full pass is minutes
   * of model calls, and an ingest or another tab may have written pages in the
   * meantime; applying to a stale object would save a run without them.
   */
  const search = async () => {
    if (!run) return;
    setSearching(true);
    setError(null);
    try {
      const response = await requestProposals(run);
      const fresh = (await runtime.loadRun(run.id)) ?? run;
      commit(applyProposals(fresh, response));
      setPhase("sheet");
    } catch (problem) {
      setError(
        problem instanceof Error
          ? `The search failed, and nothing in the run was changed: ${problem.message}`
          : String(problem),
      );
    } finally {
      setSearching(false);
    }
  };

  const actions: PlateActions = {
    onAccept: (index) => patchSlot(index, { status: "confirmed" }),
    // "Not this" means the search answered wrongly, which is the same standing
    // as never having found it: the slot drops into the tambahan loop, where
    // it becomes a decision rather than a silent blank.
    onReject: (index) =>
      patchSlot(index, {
        status: "outstanding",
        zone: undefined,
        text: undefined,
      }),
    onRedraw: (index) => {
      const slot = run?.slots[index];
      if (!slot) return;
      setEditing({
        slotIndex: index,
        slotKey: slot.key,
        label: slot.label,
        zone: slot.zone,
      });
    },
    onUnfill: (index) => patchSlot(index, { status: "unfilled" }),
    onReopen: (index) =>
      patchSlot(index, {
        status: run?.slots[index]?.zone ? "proposed" : "outstanding",
      }),
    onDrawNew: (slotKey, label) =>
      setEditing({ slotIndex: null, slotKey, label }),
  };

  const saveZone: React.ComponentProps<typeof ZoneEditor>["onSave"] = (
    target,
    zone,
    text,
  ) => {
    if (!run) return;
    const patched: SlotState = {
      key: target.slotKey,
      label: target.label,
      status: "confirmed",
      origin: "human",
      zone,
      text,
    };
    commit({
      ...run,
      slots:
        target.slotIndex === null
          ? [...run.slots, patched]
          : run.slots.map((slot, i) =>
              i === target.slotIndex ? { ...slot, ...patched } : slot,
            ),
    });
    setEditing(null);
  };

  const outstanding = useMemo(
    () => (run ? outstandingIndexes(run, runtime.outstandingSlots(run)) : []),
    [run, runtime],
  );

  const counts = run ? progressOf(run, AO_TEMPLATE) : null;

  // Slots the model has not been asked about yet, or was asked and missed.
  // Nothing else in the app produces a proposal, so when this is non-zero and
  // the operator has not run the search, the sheet is empty for a reason the
  // screen has to state rather than leave them to infer.
  const unsearched = run ? wantedKeys(run).length : 0;

  return (
    <div className="lt lt-shell flex flex-col">
      <header className="lt-rail sticky top-0 z-20 border-b">
        <div className="mx-auto flex w-full max-w-[92rem] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
          <div className="mr-auto flex flex-col">
            <span className="lt-eyebrow">DOKUMEN VALIDASI</span>
            <span className="text-sm font-semibold">
              {run
                ? (run.sources[0]?.name ?? "Untitled run")
                : "No run open"}
            </span>
          </div>

          {counts ? (
            <div className="flex items-center gap-5">
              <Tally
                label="confirmed"
                value={counts.confirmed}
                tone="var(--lt-ok)"
              />
              <Tally
                label="to decide"
                value={counts.proposed}
                tone="var(--lt-mark)"
              />
              <Tally
                label="not found"
                value={counts.outstanding + counts.partial}
                tone="var(--lt-gap)"
              />
              <Tally
                label="ship empty"
                value={counts.unfilled}
                tone="var(--lt-void)"
              />
              <Tally
                label={`settled of ${counts.fillable}`}
                value={counts.decided}
              />
            </div>
          ) : null}

          <nav className="flex items-center gap-1">
            {PHASES.map((step, i) => (
              <button
                key={step.id}
                type="button"
                disabled={!run && step.id !== "ingest"}
                onClick={() => {
                  setEditing(null);
                  setPhase(step.id);
                }}
                className="lt-btn lt-mono text-xs"
                style={
                  phase === step.id
                    ? { borderColor: "var(--lt-mark)", color: "var(--lt-mark)" }
                    : undefined
                }
              >
                <span style={{ opacity: 0.6 }}>{i + 1}</span> {step.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[92rem] flex-col gap-5 px-5 py-6">
        {error ? <Notice tone="stop">{error}</Notice> : null}

        {run && run.pages.length > 0 && unsearched > 0 && !editing ? (
          <div className="lt-card flex flex-wrap items-center gap-4 p-4">
            <div className="mr-auto flex flex-col gap-1">
              <Eyebrow>Search the bundle</Eyebrow>
              <p className="text-xs" style={{ color: "var(--lt-faint)" }}>
                {searching
                  ? `Searching ${run.pages.length} pages for ${unsearched} slots. This is one model call per slot and takes a few minutes; the page can stay open.`
                  : `${unsearched} slots have no proposal yet. The search reads the OCR text of ${run.pages.length} pages on the server and proposes a region for each.`}
              </p>
            </div>
            <Btn onClick={() => void search()} disabled={searching}>
              {searching ? "Searching..." : "Search for these slots"}
            </Btn>
          </div>
        ) : null}

        {editing && run ? (
          /* Keyed by target, so opening the editor on a different capture
             remounts it. Without the key React would keep the mounted
             instance, and its page choice and draft rectangle -- initialised
             from the old target -- would be saved onto the new slot. */
          <ZoneEditor
            key={`${editing.slotKey}#${editing.slotIndex ?? "new"}`}
            run={run}
            target={editing}
            onSave={saveZone}
            onCancel={() => setEditing(null)}
          />
        ) : phase === "ingest" ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <IngestPanel
              run={run}
              progress={progress}
              busy={busy}
              error={null}
              onFiles={(files) => void ingest(files)}
            />
            <aside className="lt-card flex flex-col gap-3 p-5">
              <Eyebrow>Runs in this browser</Eyebrow>
              {runs.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--lt-faint)" }}>
                  Nothing yet. Adding a PDF starts a run.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {runs.map((summary) => (
                    <li key={summary.id}>
                      <button
                        type="button"
                        className="lt-btn lt-mono w-full justify-start text-xs"
                        onClick={() => void openRun(summary.id)}
                        style={
                          run?.id === summary.id
                            ? { borderColor: "var(--lt-mark)" }
                            : undefined
                        }
                      >
                        {summary.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {run ? (
                <Btn
                  onClick={() => {
                    setRun(null);
                    setRounds([]);
                    rememberRun(null);
                  }}
                >
                  Start a different run
                </Btn>
              ) : null}
            </aside>
          </div>
        ) : !run ? (
          <Notice>Open or start a run first.</Notice>
        ) : phase === "sheet" ? (
          <ContactSheet
            run={run}
            actions={actions}
            onAcceptSection={(indexes) =>
              commit({
                ...run,
                slots: run.slots.map((slot, i) =>
                  indexes.includes(i) ? { ...slot, status: "confirmed" } : slot,
                ),
              })
            }
          />
        ) : phase === "outstanding" ? (
          <OutstandingPanel
            run={run}
            outstandingKeys={outstanding}
            rounds={rounds}
            progress={progress}
            busy={busy}
            error={null}
            onFiles={(files) => void ingest(files)}
            onDraw={(index) => actions.onRedraw(index)}
            onUnfill={(index) => patchSlot(index, { status: "unfilled" })}
            onUnfillAll={(indexes) =>
              commit({
                ...run,
                slots: run.slots.map((slot, i) =>
                  indexes.includes(i) ? { ...slot, status: "unfilled" } : slot,
                ),
              })
            }
          />
        ) : (
          <ExportPanel run={run} onGoToSheet={() => setPhase("sheet")} />
        )}
      </main>
    </div>
  );
}
