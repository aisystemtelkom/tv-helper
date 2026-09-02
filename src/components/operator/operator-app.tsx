"use client";

/**
 * The operator workspace: one client shell holding the run, and three screens
 * over it.
 *
 * Deliberately ONE route. Every screen reads the same `BrowserRun`, which
 * lives in IndexedDB in the browser and cannot be read by a server component,
 * so splitting the screens across routes would buy deep links and pay for them
 * with three more places to re-load the run and three more auth surfaces. The
 * run id goes in the URL fragment instead, which survives a reload -- and a
 * reload during a three-minute OCR pass is not hypothetical.
 *
 * THERE USED TO BE A FOURTH SCREEN, `Tambahan`, AND IT WAS A DEAD END. It
 * asked "is there another document for the bagian that are still empty?", which
 * is a question the operator can only answer while looking at the sheet those
 * bagian belong to. As a phase of its own it was reached after the review, so
 * the answer arrived too late to change the review, and an operator who never
 * clicked it never saw what was missing at all. The panel is unchanged and
 * still owned here; it is now handed to the contact sheet through `head` and
 * rendered at the TOP of the lembar periksa, where the question is asked before
 * the work rather than after it. Nothing that was only reachable from that
 * phase became unreachable: the drop target, the round history, "gambar
 * sendiri", "kosongkan", and the re-search all came with it.
 *
 * Every mutation goes through `commit`, which sets state and persists in the
 * same breath. A confirmed zone that lives only in React state is a decision
 * the operator believes they made and the deliverable will not carry.
 *
 * THE SHELL IS ALSO WHERE PERSISTENCE BECOMES VISIBLE. `pending` holds the
 * slot indexes whose save is still in flight and `fresh` holds the ones this
 * session's own clicks confirmed; both go to the contact sheet, where a paraf
 * draws on the click and only goes solid when the write lands. Until this
 * existed the product's central promise, that a decision survives a reload,
 * had no signal at all: its only evidence was the absence of an error
 * paragraph somewhere else on the page.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { getSession, signOut } from "next-auth/react";

import { AO_TEMPLATE } from "@/lib/forms/template";
import { liveRuntime } from "@/lib/ui/live-runtime";
import { applyProposals, requestProposals, wantedKeys } from "@/lib/ui/propose";
import type { BrowserRun, RunSummary, SlotState } from "@/lib/ui/runtime";
import { RuntimeProvider, useRuntime } from "@/lib/ui/runtime-context";
import { outstandingIndexes, progressOf } from "@/lib/ui/slots";

import { Btn, Interruption, Notice, OwedCount, shortenFileName } from "./chrome";
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

/**
 * The three phases, in the operator's own language.
 *
 * The ids stay English because they are code. `Tambahan` used to be a fourth
 * one; see the note at the top of this file for why the dokumen tambahan
 * question moved to the top of Periksa instead of standing on its own.
 */
const PHASES = [
  { id: "ingest", label: "Muat" },
  { id: "sheet", label: "Periksa" },
  { id: "export", label: "Berkas" },
] as const;

type Phase = (typeof PHASES)[number]["id"];

/** The signed-in operator, as the strip needs to render them. */
export type Account = {
  email: string;
  name?: string | null;
  /**
   * Undefined means "nobody told us". The allowlist link is shown then,
   * because /admin renders its own refusal as a sentence and an undiscoverable
   * allowlist is the worse failure of the two; an explicit `false` hides it.
   */
  isAdmin?: boolean;
};

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

/**
 * What is open, NAMED AS A WHOLE BUNDLE.
 *
 * Never `sources[0].name`. The dokumen tambahan loop guarantees multi-document
 * runs, and an operator who has just added a document has no other way to see
 * that it joined this run rather than starting a second one.
 *
 * When fewer pages are held than the documents declare, that difference IS the
 * headline. `RunSource.pageCount` is the document's own length even when an
 * ingest died halfway, so "27 dari 29 halaman terbaca" is the truth about a
 * run that would otherwise look complete and be short two pages of evidence.
 */
function bundleLine(run: BrowserRun): string {
  const documents = run.sources.length;
  const read = run.pages.length;
  const expected = run.sources.reduce((total, s) => total + s.pageCount, 0);

  if (documents === 0) return "Pekerjaan baru, belum ada dokumen";
  const docs = `${documents} dokumen`;
  if (expected > read) return `${docs}, ${read} dari ${expected} halaman terbaca`;
  return `${docs}, ${read} halaman`;
}

/** Every source in the run, middle-truncated, in the order they were added. */
function sourceNames(run: BrowserRun): string {
  if (run.sources.length === 0) return "Belum ada berkas PDF di pekerjaan ini.";
  return run.sources
    .map((source) => shortenFileName(source.name, 28))
    .join(", ");
}

/**
 * HAS THE SEARCH RUN OVER THIS PEKERJAAN?
 *
 * This is the gate on Periksa and on Berkas, and it is DERIVED FROM THE RUN
 * rather than kept in a boolean, because a boolean is lost on reload and would
 * re-lock a run that was searched an hour ago.
 *
 * The obvious candidate is `wantedKeys(run).length === 0`, and it is the wrong
 * one. That expression means "nothing left to search", and `wantedKeys`
 * deliberately includes `outstanding` slots, because re-searching them IS the
 * dokumen tambahan loop. So a completed pass that left four bagian tidak
 * ditemukan reads as zero-searched under it, and the operator would be locked
 * out of the one screen where those four are settled. The gate is on the
 * search having RUN, not on it having found everything.
 *
 * What is true instead: every slot a run is seeded with is `pending` with no
 * zone (`seedSlots` in `src/lib/browser/runtime.ts`), and `/api/propose`
 * answers every wanted key with either a proposal or an outstanding entry. So
 * one slot that is no longer waiting is proof a pass completed. Nothing else
 * in the app can move a slot off `pending`: every manual decision lives behind
 * this gate.
 */
/** Where a run being opened belongs: mid-flow if it can be, Muat otherwise. */
function landingPhase(run: BrowserRun): Phase {
  return run.pages.length > 0 && hasBeenSearched(run) ? "sheet" : "ingest";
}

function hasBeenSearched(run: BrowserRun): boolean {
  // A run holding no slots at all cannot be searched and cannot be reviewed;
  // locking the rest of the app behind a pass that can never happen would
  // strand it. Records written before runs carried slots are the only way to
  // get one.
  if (run.slots.length === 0) return true;
  return run.slots.some((slot) => slot.status !== "pending" || !!slot.zone);
}

/**
 * A locally rendered avatar, and it must stay locally rendered.
 *
 * The Google session carries an `image` URL on `lh3.googleusercontent.com`.
 * Wiring it would put a third-party host into this page's request path and
 * break the standing proof that `performance.getEntriesByType("resource")`
 * shows no host but this one, in exchange for a decorative circle.
 */
function initialsOf(name: string | null | undefined, email: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1 && words[0].length >= 2) {
    return words[0].slice(0, 2).toUpperCase();
  }
  const local = email.split("@")[0] ?? "";
  return (local.slice(0, 2) || "??").toUpperCase();
}

/**
 * WHAT THE OPERATOR IS TOLD AND WHAT THE DEPLOYER IS TOLD, KEPT APART.
 *
 * `sentence` is written for a Telkom operator and names the consequence before
 * the mechanism. `detail` carries ids, variable names and raw exception text,
 * which `Interruption` files behind a disclosure. They are not the same
 * audience and they never share a paragraph.
 */
type FaultOrigin = "boot" | "load" | "save" | "search" | "ingest" | "session";

type Fault = {
  origin: FaultOrigin;
  sentence: string;
  detail?: string;
  /** A save that did not land is not dismissible; reloading is the way out. */
  remedy?: "reload";
};

function messageOf(problem: unknown): string {
  if (problem instanceof Error) return `${problem.name}: ${problem.message}`;
  return String(problem);
}

/**
 * The refusals this storage layer makes ON PURPOSE, each given the sentence an
 * operator can act on.
 *
 * Read off `error.name`, not off `String(error)` and not with `instanceof`.
 * The name is a string literal assigned in the constructor, so bundling cannot
 * rename it, and matching on it keeps this shell working against a runtime
 * that is not the browser one: a test fake raises the same named error without
 * dragging IndexedDB into the process.
 */
function saveFault(problem: unknown): Fault {
  const name = problem instanceof Error ? problem.name : "";

  const because =
    name === "StaleRunWriteError"
      ? "pekerjaan ini sudah berubah di tempat lain, biasanya karena ada tab lain yang terbuka atau pemuatan dokumen yang masih berjalan. Muat ulang halaman ini, lalu ulangi keputusan terakhir Anda."
      : name === "PageLossError"
        ? "penyimpanan menolak tulisan yang tidak membawa seluruh halaman pekerjaan ini. Muat ulang halaman ini supaya pekerjaan terbaca utuh lagi."
        : name === "QuotaExceededError"
          ? "penyimpanan peramban ini penuh. Kosongkan pekerjaan lama, lalu ulangi keputusan terakhir Anda."
          : "penyimpanan di perangkat ini menolak tulisan terakhir. Muat ulang halaman ini, lalu ulangi keputusan terakhir Anda.";

  return {
    origin: "save",
    sentence: `Pekerjaan gagal disimpan, jadi keputusan terakhir Anda hanya ada di tab ini: ${because}`,
    detail: messageOf(problem),
    remedy: "reload",
  };
}

/**
 * @param notice A standing interruption from the page that mounted this app,
 * currently only the bootstrap `AUTH_DISABLED` band. It is rendered INSIDE the
 * sticky header, under the application strip, so that it still cannot be
 * dismissed or scrolled past while the product's own identity remains the
 * first thing on the page. It used to be rendered by `src/app/page.tsx` above
 * the whole app, which pushed the wordmark, the open run and the phase nav
 * down on every screen and made a deployment warning the product's masthead.
 */
export function OperatorApp({
  account,
  notice,
}: { account?: Account | null; notice?: ReactNode } = {}) {
  return (
    <RuntimeProvider runtime={runtime}>
      <Workspace account={account ?? null} notice={notice ?? null} />
    </RuntimeProvider>
  );
}

function Workspace({
  account,
  notice,
}: {
  account: Account | null;
  notice: ReactNode;
}) {
  const runtime = useRuntime();

  const [runs, setRuns] = useState<RunSummary[]>([]);
  // Distinct from `runs.length === 0`. A returning operator was told "belum ada
  // pekerjaan", briefly but every single time, while the list was still being
  // read, which on a slow device is the first thing they get to read.
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [run, setRun] = useState<BrowserRun | null>(null);
  const [phase, setPhase] = useState<Phase>("ingest");
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [rounds, setRounds] = useState<RoundLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchStartedAt, setSearchStartedAt] = useState<number | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [fault, setFault] = useState<Fault | null>(null);
  const [editing, setEditing] = useState<EditorTarget | null>(null);

  /**
   * THE PERSISTENCE PAIR.
   *
   * `pending` is "a save for this slot is in flight", so its mark stays at
   * partial opacity until IndexedDB has taken the decision. `fresh` is "this
   * session's own click put it there", which is what allows the paraf to be
   * DRAWN rather than merely rendered: a reload must not replay a dozen
   * decisions nobody just made.
   */
  const [pending, setPending] = useState<ReadonlySet<number>>(() => new Set());
  const [fresh, setFresh] = useState<ReadonlySet<number>>(() => new Set());
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await runtime.listRuns();
        if (!alive) return;
        setRuns(list);
        setRunsLoaded(true);

        const wanted = window.location.hash.replace(/^#run\//, "");
        if (!wanted) return;
        const loaded = await runtime.loadRun(wanted);
        if (!alive) return;
        if (!loaded) {
          // This used to be ignored in silence, with the dead id left in the
          // URL. The operator followed their own bookmark and was shown an
          // empty shell, which reads as the app having forgotten their work.
          rememberRun(null);
          setFault({
            origin: "load",
            sentence:
              "Pekerjaan yang ditunjuk alamat halaman ini sudah tidak ada di penyimpanan peramban ini. Alamatnya sudah dibersihkan, jadi Anda bisa membuka pekerjaan lain atau memuat dokumen baru.",
            detail: `run id: ${wanted}`,
          });
          return;
        }
        setRun(loaded);
        // Pages alone are no longer enough to land on the sheet: a run that
        // was read and never processed has nothing there to review, and the
        // nav would refuse the phase it had just been dropped into.
        setPhase(landingPhase(loaded));
      } catch (problem) {
        if (!alive) return;
        setRunsLoaded(true);
        setFault({
          origin: "boot",
          sentence:
            "Daftar pekerjaan di perangkat ini tidak bisa dibaca, jadi pekerjaan lama tidak muncul di bawah. Memuat dokumen baru tetap bisa dilakukan.",
          detail: messageOf(problem),
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [runtime]);

  /**
   * Persists, and KEEPS WHAT THE STORE RETURNS.
   *
   * `saveRun` advances the run's `rev`, and saving from a run whose `rev` is
   * behind is refused, so dropping the result would make the SECOND
   * confirmation of every session fail. The refusal itself is deliberate: a
   * save replaces a run wholesale, so a stale write would silently delete
   * every page an in-flight ingest had added.
   *
   * `touched` names the slots this commit decided, which is what drives the
   * pending/fresh pair. A commit with no touched slots (the search folding its
   * answer in) changes the run without any mark being owed to anybody.
   */
  const commit = useCallback(
    (next: BrowserRun, touched: number[] = []) => {
      const previous = run;
      setRun(next);
      setSearchNote(null);

      if (touched.length > 0) {
        setPending((current) => {
          const updated = new Set(current);
          for (const index of touched) updated.add(index);
          return updated;
        });
        setFresh((current) => {
          const updated = new Set(current);
          for (const index of touched) {
            // Only a confirmation draws a paraf. Reopening a slot has to take
            // the mark back off, or a later confirmation of the same slot
            // would render as already-drawn and the stroke would never answer
            // the click that produced it.
            if (next.slots[index]?.status === "confirmed") updated.add(index);
            else updated.delete(index);
          }
          return updated;
        });
      }

      const settle = () =>
        setPending((current) => {
          if (touched.length === 0) return current;
          const updated = new Set(current);
          for (const index of touched) updated.delete(index);
          return updated;
        });

      void runtime
        .saveRun(next)
        .then((stored) => {
          setRun(stored);
          setSavedAt(Date.now());
          settle();
        })
        .catch((problem: unknown) => {
          // The optimistic change is TAKEN BACK, not left on screen. An
          // operator still looking at their own decision after the write was
          // refused has no reason to stop, and every decision after this one
          // is being thrown away too.
          settle();
          setFresh((current) => {
            const updated = new Set(current);
            for (const index of touched) updated.delete(index);
            return updated;
          });
          if (previous) setRun(previous);
          setFault(saveFault(problem));
        });
    },
    [run, runtime],
  );

  const patchSlot = useCallback(
    (index: number, patch: Partial<SlotState>) => {
      if (!run) return;
      commit(
        {
          ...run,
          slots: run.slots.map((slot, i) =>
            i === index ? { ...slot, ...patch } : slot,
          ),
        },
        [index],
      );
    },
    [commit, run],
  );

  const openRun = async (id: string) => {
    setFault(null);
    setSearchNote(null);
    const loaded = await runtime.loadRun(id);
    if (!loaded) {
      setFault({
        origin: "load",
        sentence:
          "Pekerjaan itu sudah tidak ada di penyimpanan peramban ini, mungkin dihapus dari tab lain. Daftar di bawah akan benar lagi setelah halaman ini dimuat ulang.",
        detail: `run id: ${id}`,
      });
      return;
    }
    setRun(loaded);
    setRounds([]);
    setPending(new Set());
    setFresh(new Set());
    rememberRun(id);
    setPhase(landingPhase(loaded));
  };

  /**
   * Closes the open run without touching storage.
   *
   * Everything the operator's decisions live in is already on disk, so this
   * only drops what is local to this tab: the run in state, the round log, and
   * the two persistence sets, which are indexes INTO THIS RUN's slot list and
   * would point at the wrong captures if they survived into the next one.
   */
  const closeRun = () => {
    setRun(null);
    setRounds([]);
    setPending(new Set());
    setFresh(new Set());
    setSearchNote(null);
    rememberRun(null);
  };

  const ingest = async (files: File[]) => {
    setBusy(true);
    setFault(null);
    setSearchNote(null);
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
      /*
       * AND IT STAYS ON MUAT. Reading the pages used to land the operator on
       * the review sheet, which was empty, because nothing had searched yet
       * and the only control that could was a band further down that screen.
       * Muat is now two moves, and this is the end of the first one: the
       * second, `Proses`, is on this screen, below the film strip that just
       * finished. Jumping away from it would hide the one thing left to do.
       */
    } catch (problem) {
      setFault({
        origin: "ingest",
        sentence:
          "Pembacaan dokumen berhenti sebelum selesai. Halaman yang sudah terbaca tetap tersimpan, jadi Anda bisa mengulang dengan berkas yang sama tanpa kehilangan pekerjaan.",
        detail: messageOf(problem),
      });
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
   * THE SEARCH, which the operator now starts from Muat as `Proses`. The only
   * thing that moves a slot to "proposed", and the only thing that opens the
   * gate on Periksa.
   *
   * The run is RE-READ from storage first, and the answer is applied to that
   * fresh copy rather than to the `run` in React state. A full pass is minutes
   * of model calls, and an ingest or another tab may have written pages in the
   * meantime; applying to a stale object would save a run without them. That
   * guarantee is unchanged by the move, and it matters more now, not less: the
   * button is on the same screen as the drop target.
   *
   * It does NOT advance the phase. A pass that has finished is not a decision
   * to leave this screen, and the operator may well want to add a document and
   * run another round before reviewing anything.
   */
  const search = async () => {
    if (!run) return;
    setSearching(true);
    setSearchStartedAt(Date.now());
    setSearchNote(null);
    setFault(null);
    try {
      const response = await requestProposals(run);
      const found = response.proposals.length;
      const missed = response.outstanding.length;
      const stored = (await runtime.loadRun(run.id)) ?? run;
      commit(applyProposals(stored, response));
      // A multi-minute pass has to end in a sentence, and that sentence starts
      // with the name of the button that started it. It used to say "Pencarian
      // selesai", which left the operator to work out that the thing they
      // clicked and the thing that finished were one event.
      setSearchNote(
        found === 0
          ? `Proses selesai. Tidak ada bagian yang bisa ditemukan di ${run.pages.length} halaman yang ada. Buka lembar periksa untuk memutuskan tiap bagian, atau tambahkan dokumen lain lalu proses lagi.`
          : missed === 0
            ? `Proses selesai. ${found} usulan menunggu keputusan Anda di lembar periksa.`
            : `Proses selesai. ${found} usulan menunggu keputusan Anda, ${missed} bagian tidak ditemukan. Keduanya diurus di lembar periksa.`,
      );
    } catch (problem) {
      setFault({
        origin: "search",
        sentence:
          "Proses gagal, dan tidak ada yang berubah di pekerjaan ini. Halaman yang sudah terbaca dan keputusan yang sudah Anda simpan tetap utuh, jadi Anda bisa menekan Proses lagi.",
        detail: messageOf(problem),
      });
    } finally {
      setSearching(false);
      setSearchStartedAt(null);
    }
  };

  const actions: PlateActions = {
    onAccept: (index) => patchSlot(index, { status: "confirmed" }),
    // "Bukan ini" means the search answered wrongly, which is the same
    // standing as never having found it: the slot drops into the tambahan
    // loop, where it becomes a decision rather than a silent blank.
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
    // A capture the run does not hold yet lands at the end of the list, so its
    // index is the old length. Naming it here is what lets a hand-drawn zone
    // show its paraf finishing when the write does, exactly as an accepted
    // proposal does.
    const index = target.slotIndex ?? run.slots.length;
    commit(
      {
        ...run,
        slots:
          target.slotIndex === null
            ? [...run.slots, patched]
            : run.slots.map((slot, i) =>
                i === target.slotIndex ? { ...slot, ...patched } : slot,
              ),
      },
      [index],
    );
    setEditing(null);
  };

  const outstanding = useMemo(
    () => (run ? outstandingIndexes(run, runtime.outstandingSlots(run)) : []),
    [run, runtime],
  );

  const counts = run ? progressOf(run, AO_TEMPLATE) : null;

  // Bagian the model has not been asked about yet, or was asked and missed:
  // exactly what the next `Proses` would look for. Nothing else in the app
  // produces a usulan, so this is the figure the Muat screen quotes before the
  // operator commits to minutes of model calls.
  const wanted = run ? wantedKeys(run).length : 0;

  // Whether a pass has already run over this pekerjaan. Derived from the run,
  // never from a boolean this component keeps, so a reload does not re-lock a
  // run that was searched yesterday. See `hasBeenSearched`.
  const searched = !!run && run.pages.length > 0 && hasBeenSearched(run);

  /**
   * WHY A PHASE IS LOCKED, in one sentence, always beside the locked control.
   *
   * The zone editor holds a rectangle the operator is part-way through
   * drawing. A phase click used to call `setEditing(null)`, which threw that
   * rectangle away without a word: a silent no-op, which is the interaction
   * layer's version of the failure this whole product is organised against.
   * Locking the nav and saying so leaves only the editor's own "Pakai area
   * ini" and "Batal", both of which are decisions somebody made on purpose.
   *
   * The third reason is the search gate, and it is the same gate the Muat
   * screen puts on its own "Buka lembar periksa" button. Two ways to reach one
   * screen must not disagree about whether it is ready, and a nav that opened
   * an empty sheet would teach the operator that the button beside it was
   * being difficult for no reason.
   *
   * ONLY THE FIRST PASS LOCKS. A later round, started from the top of the
   * sheet after a dokumen tambahan, leaves `searched` true and the nav open on
   * purpose: `applyProposals` re-checks each slot's current status and the run
   * is re-read from storage before the answer lands, so reviewing while a
   * round runs is supported rather than merely tolerated.
   */
  const lockReason = editing
    ? "Selesaikan atau batalkan penggambaran area dulu, supaya gambar Anda tidak hilang."
    : !run
      ? "Muat dokumen order dulu. Dua langkah berikutnya terbuka setelah ada pekerjaan yang dibuka."
      : !searched
        ? searching
          ? "Proses sedang berjalan. Lembar periksa dan berkas hasil terbuka begitu prosesnya selesai."
          : "Klik Proses di langkah Muat dulu. Lembar periksa baru berisi usulan setelah prosesnya selesai, dan berkas hasil dibuat dari keputusan Anda di sana."
        : null;

  const isLocked = (id: Phase) =>
    editing ? true : lockReason !== null && id !== "ingest";

  // An ingest failure belongs beside the drop zone that caused it. The shell
  // only takes it over when the screen holding that drop zone is not on
  // screen, so one failure is never stated in two places at once. There are
  // two such drop zones now: this screen's, and the one the outstanding panel
  // opens at the top of the lembar periksa.
  const ingestPanelVisible =
    !editing && (phase === "ingest" || (phase === "sheet" && !!run));
  const ingestError =
    fault?.origin === "ingest" && ingestPanelVisible ? fault.sentence : null;
  const showInterruption = fault !== null && !ingestError;

  /**
   * The dokumen tambahan question, BUILT HERE AND RENDERED THERE.
   *
   * The shell keeps owning what this panel is wired to (the outstanding
   * indexes, the round log, the ingest in flight, every decision callback),
   * because all of that is run state and belongs where the run lives. The
   * contact sheet owns where it sits and how it reads at the top of the sheet,
   * which is a question about that screen's layout. Handing over a built
   * element rather than a pile of props is what keeps those two answers apart.
   */
  const outstandingHead =
    run && phase === "sheet" ? (
      <OutstandingPanel
        run={run}
        outstandingKeys={outstanding}
        rounds={rounds}
        progress={progress}
        busy={busy}
        error={ingestError}
        onFiles={(files) => void ingest(files)}
        onDraw={(index) => actions.onRedraw(index)}
        onUnfill={(index) => patchSlot(index, { status: "unfilled" })}
        onReopen={(index) => actions.onReopen(index)}
        onSearch={() => void search()}
        searching={searching}
        onUnfillAll={(indexes) =>
          commit(
            {
              ...run,
              slots: run.slots.map((slot, i) =>
                indexes.includes(i) ? { ...slot, status: "unfilled" } : slot,
              ),
            },
            indexes,
          )
        }
      />
    ) : null;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 flex flex-col">
        <Strip
          run={run}
          account={account}
          busy={busy}
          progress={progress}
          searching={searching}
          saving={pending.size > 0}
          savedAt={savedAt}
          onFault={setFault}
        />

        {/* BELOW THE STRIP, not above the whole application. A standing
            deployment warning still cannot be dismissed or scrolled past, but
            it is no longer the first thing on the page: the operator's own
            product identifies itself first, and the warning reads as a
            condition this app is running under rather than as its masthead.
            It is above the phase nav because it is a statement about the whole
            session, not about the screen under it. */}
        {notice ? (
          // `lt-rail` for the ground only, and no border of its own: the band
          // inside already rules itself top and bottom, and a second rule
          // under this one would draw two lines a hair apart. The ground is
          // not optional, because this sits in a sticky header over a
          // scrolling sheet and the band's own tint is 94% transparent.
          <div className="lt-rail">
            <div className="mx-auto w-full max-w-[92rem] px-5">{notice}</div>
          </div>
        ) : null}

        <PhaseNav
          phase={phase}
          counts={counts}
          pages={run?.pages.length ?? 0}
          lockReason={lockReason}
          isLocked={isLocked}
          onGo={(next) => {
            setSearchNote(null);
            setPhase(next);
          }}
        />

        {/* INSIDE the sticky header on purpose. An interruption that scrolls
            away with the page can be missed entirely by an operator half way
            down a metre-long contact sheet, and a refused save means every
            decision after it is being thrown away. It sits BELOW the nav, so
            raising it never moves the three phase buttons. */}
        {showInterruption && fault ? (
          <div className="border-b" style={{ borderColor: "var(--line)" }}>
            <div className="mx-auto w-full max-w-[92rem] px-5">
              <Interruption detail={fault.detail}>
                {fault.sentence}{" "}
                {fault.remedy === "reload" ? (
                  <Btn
                    className="ml-1 align-baseline"
                    onClick={() => window.location.reload()}
                  >
                    Muat ulang halaman ini
                  </Btn>
                ) : (
                  <Btn
                    className="ml-1 align-baseline"
                    onClick={() => setFault(null)}
                  >
                    Tutup pesan ini
                  </Btn>
                )}
              </Interruption>
            </div>
          </div>
        ) : null}
      </header>

      <main className="mx-auto flex w-full max-w-[92rem] flex-col gap-6 px-5 py-6">
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
          /* The resume list is the ingest screen's own, not the shell's. It
             belongs beside the drop zone, where "start a new one" and "pick up
             the one from this morning" are the same decision; the shell only
             supplies what it alone knows, which is what has been read from
             storage and how to close the open run. */
          <IngestPanel
            run={run}
            progress={progress}
            busy={busy}
            error={ingestError}
            onFiles={(files) => void ingest(files)}
            runs={runs}
            runsLoading={!runsLoaded}
            onOpenRun={(id) => void openRun(id)}
            onStartNewRun={closeRun}
            onContinue={() => setPhase("sheet")}
            onProcess={() => void search()}
            searching={searching}
            searchStartedAt={searchStartedAt}
            searchNote={searchNote}
            wanted={wanted}
            searched={searched}
          />
        ) : !run ? (
          <div className="flex flex-col items-start gap-3">
            <Notice>
              Belum ada pekerjaan yang dibuka, jadi tidak ada yang bisa
              diperiksa di sini.
            </Notice>
            <Btn tone="primary" onClick={() => setPhase("ingest")}>
              Muat dokumen order
            </Btn>
          </div>
        ) : phase === "sheet" ? (
          <ContactSheet
            run={run}
            actions={actions}
            pending={pending}
            fresh={fresh}
            /* What is missing, and the question about a dokumen tambahan, at
               the TOP of the sheet rather than on a phase of their own. */
            head={outstandingHead}
            onAcceptSection={(indexes) =>
              commit(
                {
                  ...run,
                  slots: run.slots.map((slot, i) =>
                    indexes.includes(i)
                      ? { ...slot, status: "confirmed" }
                      : slot,
                  ),
                },
                indexes,
              )
            }
          />
        ) : (
          <ExportPanel run={run} onGoToSheet={() => setPhase("sheet")} />
        )}
      </main>
    </div>
  );
}

/**
 * THE APPLICATION STRIP. One rail, ONE CONSTANT HEIGHT in every state.
 *
 * It used to grow by five tally blocks the moment a run opened, which at 1366
 * pushed the phase nav onto a second row: sticky chrome that changes height
 * makes the four buttons an operator hits all day a moving target. The height
 * is fixed here, and the live line is a fixed slot that is simply empty when
 * nothing is happening rather than a block that appears.
 *
 * It also carries the three destinations NOTHING IN THE PRODUCT LINKED TO. An
 * admin typed /admin from memory, the consent given at sign-in pointed at a
 * privacy policy that could not be opened from the app, and a twelve-hour
 * session on a shared office machine had no way out of it.
 */
function Strip({
  run,
  account,
  busy,
  progress,
  searching,
  saving,
  savedAt,
  onFault,
}: {
  run: BrowserRun | null;
  account: Account | null;
  busy: boolean;
  progress: IngestProgress | null;
  searching: boolean;
  saving: boolean;
  savedAt: number | null;
  onFault: (fault: Fault) => void;
}) {
  // Kept short on purpose: this slot has a FIXED WIDTH as well as a fixed
  // height, so filling it moves nothing else in the strip. The file being read
  // is named on the ingest screen and in the identity line below; what this
  // line owes an operator on another phase is only that something is moving.
  const signal = busy
    ? progress && progress.total > 0
      ? `Membaca halaman ${progress.done} dari ${progress.total}`
      : "Menyiapkan berkas"
    : searching
      ? "Sedang memproses halaman"
      : saving
        ? "Menyimpan keputusan Anda"
        : savedAt !== null
          ? "Tersimpan di perangkat ini"
          : "";

  return (
    <div className="lt-rail border-b">
      <div className="mx-auto flex h-14 w-full max-w-[92rem] items-center gap-5 px-5">
        <span className="lt-wordmark shrink-0">tv-validator</span>

        <div
          className="h-7 w-px shrink-0"
          style={{ background: "var(--line)" }}
          aria-hidden="true"
        />

        {/* THE ONE h1 ON THE PAGE. The subject of this work surface is the
            order being worked on, and until now the operator app had no
            heading at all: the run name was a 14px span, outranked by the five
            counters beside it. */}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <h1 className="lt-title truncate">
            {run ? bundleLine(run) : "Belum ada pekerjaan yang dibuka"}
          </h1>
          <p
            className="truncate text-[0.8125rem]"
            style={{ color: "var(--ink-2)" }}
            title={run ? run.sources.map((s) => s.name).join(", ") : undefined}
          >
            {run ? (
              <span className="lt-figure">{sourceNames(run)}</span>
            ) : (
              "Muat berkas PDF order untuk memulai."
            )}
          </p>
        </div>

        {/* The persistence signal, and the only place ingest progress can be
            seen from another phase. A fixed slot: empty rather than absent, so
            nothing moves when it fills. */}
        <p
          aria-live="polite"
          title={signal || undefined}
          className="ml-auto hidden w-[15rem] shrink-0 truncate text-right text-[0.8125rem] lg:block"
          style={{ color: "var(--ink-2)" }}
        >
          {signal}
        </p>

        <AccountControls account={account} onFault={onFault} />
      </div>
    </div>
  );
}

/**
 * Who is signed in, and the way out.
 *
 * The account is read from this app's own session endpoint rather than
 * threaded from the server, so that the strip works with the app as it is
 * wired today. Passing it in from `src/app/page.tsx`, which already holds an
 * authorized user, is strictly better: it saves a round trip and it is the
 * only way this strip can know whether to offer the allowlist at all.
 */
function AccountControls({
  account,
  onFault,
}: {
  account: Account | null;
  onFault: (fault: Fault) => void;
}) {
  const [fetched, setFetched] = useState<Account | null>(null);
  const [leaving, setLeaving] = useState(false);

  // Derived, not copied into state. A prop mirrored into state has to be kept
  // in sync by an effect, and an effect that sets state synchronously is a
  // cascading render the React compiler rules refuse.
  const session = account ?? fetched;

  useEffect(() => {
    if (account) return;
    let alive = true;
    void getSession()
      .then((found) => {
        if (!alive || !found?.user?.email) return;
        setFetched({ email: found.user.email, name: found.user.name });
      })
      .catch(() => {
        /* The strip shows no account. Failing to name the operator is not
           worth interrupting their work over, and the guard, not this label,
           is what decides whether they may be here. */
      });
    return () => {
      alive = false;
    };
  }, [account]);

  const email = session?.email ?? "";

  return (
    <div className="flex shrink-0 items-center gap-4">
      {email ? (
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="lt-figure grid size-7 shrink-0 place-items-center rounded-[2px] border text-[0.8125rem]"
            style={{ borderColor: "var(--line)", color: "var(--ink-2)" }}
          >
            {initialsOf(session?.name, email)}
          </span>
          <span
            className="lt-figure hidden max-w-[13rem] truncate text-[0.8125rem] xl:block"
            style={{ color: "var(--ink-2)" }}
            title={email}
          >
            {email}
          </span>
        </div>
      ) : null}

      <nav
        aria-label="Tautan aplikasi"
        className="flex items-center gap-3 text-[0.8125rem] font-semibold"
      >
        {session?.isAdmin === false ? null : (
          <Link
            href="/admin"
            className="underline underline-offset-4"
            style={{ color: "var(--ink-2)" }}
          >
            Daftar izin akses
          </Link>
        )}
        <Link
          href="/privacy"
          className="underline underline-offset-4"
          style={{ color: "var(--ink-2)" }}
        >
          Kebijakan privasi
        </Link>
        {email ? (
          <Btn
            disabled={leaving}
            onClick={() => {
              setLeaving(true);
              // Auth.js's own client helper: it reads the CSRF token from this
              // app and posts to this app, so no external host enters the
              // request path. `redirectTo` is set rather than defaulted,
              // because the default is the current URL and that still carries
              // a run fragment the signed-out browser cannot open.
              void signOut({ redirectTo: "/signin" }).catch(
                (problem: unknown) => {
                  setLeaving(false);
                  onFault({
                    origin: "session",
                    sentence:
                      "Keluar dari akun gagal, jadi sesi Anda masih terbuka di peramban ini. Coba lagi, atau tutup seluruh jendela peramban kalau ini komputer bersama.",
                    detail: messageOf(problem),
                  });
                },
              );
            }}
          >
            {leaving ? "Keluar..." : "Keluar"}
          </Btn>
        ) : null}
      </nav>
    </div>
  );
}

/**
 * THE PHASE NAV, and the one figure in the shell that is an INSTRUCTION.
 *
 * The current phase is marked by fill, by weight and by a tab rule that breaks
 * the rail's own bottom edge, NOT by a hue. Amber means "a decision is owed on
 * this evidence" and nothing else, and the old nav spent it on the active
 * button, on "this run is open" and on "you are dragging a file over this
 * card", all at once.
 *
 * The counts beside it replace five identical monospace tallies. Only the owed
 * count is an instruction, so only it is set at display size; everything else
 * is a fact and reads one tier down. When nothing is owed the block says so
 * affirmatively, because an absent warning is not a confirmation.
 */
function PhaseNav({
  phase,
  counts,
  pages,
  lockReason,
  isLocked,
  onGo,
}: {
  phase: Phase;
  counts: ReturnType<typeof progressOf> | null;
  pages: number;
  lockReason: string | null;
  isLocked: (id: Phase) => boolean;
  onGo: (phase: Phase) => void;
}) {
  const lockId = "lt-phase-lock";

  return (
    <div className="lt-rail border-b">
      <nav
        aria-label="Tahapan pekerjaan"
        className="mx-auto flex h-14 w-full max-w-[92rem] items-center gap-5 px-5"
      >
        <ul className="flex h-full items-stretch gap-1">
          {PHASES.map((step, i) => {
            const current = phase === step.id;
            const locked = isLocked(step.id);
            // NO BADGES. The tambahan step used to carry the outstanding
            // count; that step is gone, and the owed count already sits at
            // display size a few centimetres to the right, so anything here
            // would be the same figure twice at two sizes.

            return (
              <li key={step.id} className="relative flex items-center">
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  aria-disabled={locked || undefined}
                  aria-describedby={locked ? lockId : undefined}
                  data-on={current ? "true" : undefined}
                  onClick={locked ? undefined : () => onGo(step.id)}
                  className="lt-btn relative"
                  style={
                    locked
                      ? {
                          color: "var(--ink-3)",
                          borderStyle: "dashed",
                          cursor: "not-allowed",
                        }
                      : undefined
                  }
                >
                  <span className="lt-figure" style={{ color: "var(--ink-3)" }}>
                    {i + 1}
                  </span>
                  <span>{step.label}</span>
                </button>
                {current ? (
                  // The tab rule: a shape, not a hue. It sits ON the rail's own
                  // bottom edge and covers it, so the current phase reads as
                  // physically attached to the screen underneath it. Amber is
                  // not available for this: it means a decision is owed on a
                  // piece of evidence, and a nav position is not that.
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-1 -bottom-px h-[2px]"
                    style={{ background: "var(--ink)" }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>

        {lockReason ? (
          // A disabled control never appears without its reason beside it, in
          // the same viewport at 1366. Three greyed words at 45% opacity were
          // the old nav's answer, at a contrast that also put them under AA.
          <p
            id={lockId}
            className="max-w-[38rem] text-[0.8125rem]"
            style={{ color: "var(--ink-2)" }}
          >
            {lockReason}
          </p>
        ) : counts ? (
          <CountBlock counts={counts} pages={pages} />
        ) : null}
      </nav>
    </div>
  );
}

function CountBlock({
  counts,
  pages,
}: {
  counts: ReturnType<typeof progressOf>;
  pages: number;
}) {
  const owed = counts.proposed;
  const settled = `${counts.decided} dari ${counts.fillable} bagian sudah selesai`;

  const headline =
    pages === 0
      ? "belum ada halaman yang terbaca"
      : owed > 0
        ? "usulan menunggu keputusan Anda"
        : "tidak ada usulan yang menunggu";

  const under =
    pages === 0
      ? "Muat berkas PDF order dulu."
      : owed === 0 && counts.decided === counts.fillable
        ? // Clears AFFIRMATIVELY. The absence of a warning is not a statement
          // that the packet is safe to build, and the operator needs one.
          "Siap diekspor."
        : counts.partial > 0
          ? // `partial` used to be folded into "not found" here, so a slot
            // holding one of its two required captures was invisible in the
            // shell: a packet that looks complete and is short a picture.
            `${settled}, ${counts.partial} baru sebagian`
          : settled;

  return (
    <div className="ml-auto flex items-center gap-3" aria-live="polite">
      <OwedCount value={owed} />
      <div className="flex flex-col">
        <span
          className="text-[0.8125rem] font-semibold"
          style={{ color: "var(--ink)" }}
        >
          {headline}
        </span>
        <span
          className="text-[0.8125rem] whitespace-nowrap"
          style={{ color: "var(--ink-2)" }}
        >
          {under}
        </span>
      </div>
    </div>
  );
}
