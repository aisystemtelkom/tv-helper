"use client";

/**
 * THE DOCUMENT MANAGER: which berkas this order is built from.
 *
 * WHY IT IS IN THE CHROME AND NOT ON THE MUAT SCREEN. An operator asked for it
 * after reporting that uploading several documents "just creates one order
 * per document". It does not, and never did: the ingest loop threads one run
 * id through the whole file list and a test pins it. But the product gave them
 * no way to see that, because the only screen that ever mentioned their
 * documents was the one they had already left. A tool whose central object is
 * a bundle of documents must say what is in the bundle, on every screen, at
 * all times. That the complaint was factually wrong is the strongest evidence
 * for building this: they read the interface correctly and it was not telling
 * them anything.
 *
 * IT IS A SEPARATE THING FROM THE RIWAYAT, which is the other half of the same
 * request. This bar is THIS order's documents and it follows the operator
 * through every phase. `Riwayat` is the orders saved on this device; it is a
 * page of its own at `/riwayat`, reached by name from the account menu and
 * appearing on no phase at all, so looking for an old job cannot compete for
 * attention with the job in hand. It used to sit at the bottom of Muat, where
 * a screen that reads top to bottom made it look like the step after `Baca
 * dengan AI`.
 *
 * CLOSED IS THE RESTING STATE. Open, it is a list of file names, and a list of
 * file names is exactly the kind of thing the density pass was told to get off
 * the screen. Closed it is one line: how many documents, how many pages. That
 * line is the answer to the question that was actually being asked.
 */

import { useState } from "react";

import { Btn, Hint, shortenFileName } from "./chrome";
import { Berkas, Coretan, Klip } from "./icons";
import type { BrowserRun } from "@/lib/ui/runtime";

/**
 * What removing one document costs, in the two numbers an operator can act on.
 *
 * Passed in rather than computed here so this component stays free of the
 * runtime: the shell already holds `sourceRemovalCost`, and a screen that
 * imports the storage layer cannot be rendered in a test that has no
 * IndexedDB.
 */
export type RemovalCost = { pages: number; captures: number; confirmed: number };

/**
 * WHETHER THE AI MAY PROPOSE ANYTHING OUT OF ONE BERKAS.
 *
 * ## Two keys, not a checkbox
 *
 * A checkbox needs a label, and every label this choice could carry is a
 * negative: "jangan cari di berkas ini" is a box the operator un-ticks to get
 * the ordinary behaviour, which is a double negative standing on the default
 * path. Two keys say the two states in their own words, and the one that is
 * true is simply the one that is down.
 *
 * ## The selected key is PETROL, never amber
 *
 * `Btn`'s `on` sets `data-on`, which the stylesheet paints petrol: identity and
 * selection. Amber means A DECISION IS OWED, and a berkas nobody has decided
 * anything about owes nothing -- it is read by the AI, which is the default and
 * the overwhelmingly common answer. Amber here would put the product's loudest
 * signal on every row of every order for ever, which is how an operator learns
 * to stop reading it.
 *
 * ## The sentence under "Tanpa AI" is what they can still DO
 *
 * It is not an account of where anything runs. The berkas IS still read: every
 * page is rendered and OCR'd either way, so its denah draws, its halaman are
 * counted with the rest, and an area drawn on it still snaps to real baris and
 * still cites them. What stops is the model proposing. Saying only "AI tidak
 * mencari di sini" would leave an operator believing they had just made the
 * document unusable, so the clause they can act on comes first.
 *
 * SHARED WITH `ingest-panel.tsx` RATHER THAN WRITTEN TWICE. The choice has to
 * be reachable in every phase, which is what this bar is for, and also on the
 * Muat screen beside the berkas as it lands. Two copies of a control are two
 * copies of a promise, and the sentence under it is the promise.
 */
export function DocumentAi({
  name,
  ai,
  busy,
  onChange,
}: {
  /** The berkas this choice belongs to, for the group's accessible name. */
  name: string;
  ai: boolean;
  /** An ingest or a search is running. The choice is held, with its reason. */
  busy: boolean;
  onChange: (ai: boolean) => void;
}) {
  /*
   * HELD WHILE ANYTHING IS RUNNING, AND THE SEARCH IS THE REASON.
   *
   * The write itself would be safe mid-ingest -- `setDocumentAi` re-reads
   * inside the run lock, so a press during a long read is queued rather than
   * refused. A running SEARCH is the case that is not safe: the request has
   * already left with the old fence in it, so a berkas fenced off while it is
   * in flight would still have its usulan land, and the screen would show
   * evidence from the one document the operator had just closed. Loudly
   * unavailable for a minute beats that.
   *
   * A HELD KEY STILL SAYS WHY. `Btn` carries the reason to a pointer, a
   * keyboard and a screen reader only while the control is actually disabled,
   * so this costs nothing on the ordinary path.
   *
   * WHAT IS LOST WHILE IT IS HELD is the petrol on the selected key:
   * `.lt-btn:disabled` is declared after `.lt-btn[data-on="true"]` at equal
   * specificity, so a disabled toggle reads as neither. That is the same
   * behaviour the phase timeline has, and it is survivable HERE only because
   * the state that matters says itself in prose: a fenced berkas carries
   * `TanpaAiNote` underneath it, disabled or not, and the other state is the
   * default and owes nothing.
   */
  const held = busy ? "Tunggu sampai dokumen selesai dimuat atau dibaca." : undefined;

  return (
    <div
      role="group"
      aria-label={`Pemakaian AI untuk ${name}`}
      className="flex items-center gap-2"
    >
      <Btn
        on={ai}
        aria-pressed={ai}
        disabled={busy}
        reason={held}
        onClick={() => onChange(true)}
      >
        Dibaca AI
      </Btn>
      <Btn
        on={!ai}
        aria-pressed={!ai}
        disabled={busy}
        reason={held}
        onClick={() => onChange(false)}
      >
        Tanpa AI
      </Btn>
    </div>
  );
}

/** The one sentence that rides under a berkas the operator has fenced off. */
export function TanpaAiNote() {
  return (
    <p className="lt-note">
      Halaman berkas ini tetap terbaca dan bisa Anda potong sendiri, tapi AI
      tidak mencari apa pun di dalamnya.
    </p>
  );
}

export function DocumentsBar({
  run,
  busy,
  costOf,
  onAdd,
  onRemove,
  onSetAi,
}: {
  run: BrowserRun;
  /** An ingest or a search is running, so the bundle must not change under it. */
  busy: boolean;
  costOf: (sourceId: string) => RemovalCost;
  onAdd: () => void;
  onRemove: (sourceId: string) => void;
  /**
   * MAY THE AI PROPOSE OUT OF THIS BERKAS. Omitted, the rows carry no such
   * control -- which is the state of a shell that has not wired it yet, not a
   * berkas that cannot be fenced off.
   *
   * OPTIONAL ONLY BECAUSE THE SHELL IS ANOTHER TRACK'S FILE. It is meant to be
   * passed, and a build where it is not is a build where the choice exists on
   * the wire and nowhere on the screen.
   */
  onSetAi?: (sourceId: string, ai: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const documents = run.sources.length;
  const pages = run.pages.length;
  // The partial form while an ingest is still loading pages. It used to live
  // in the strip's h1 and came down here with the rest of the composition:
  // "5 dari 29 halaman" is a fact about the bundle, which is this bar's
  // subject, and the difference between the two figures is the whole point.
  // `RunSource.pageCount` is the document's own length even when a load died
  // half way, so a run that would otherwise look complete says it is short.
  const expected = run.sources.reduce(
    (total, source) => total + source.pageCount,
    0,
  );
  const pageLine =
    expected > pages ? `${pages} dari ${expected} halaman` : `${pages} halaman`;

  return (
    <div className="lt-rail border-b">
      <div className="mx-auto w-full max-w-[92rem] px-5">
        <div className="flex min-h-11 flex-wrap items-center gap-4 py-2">
          <button
            type="button"
            className="lt-disclose-btn flex items-center gap-2"
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
              setConfirming(null);
            }}
          >
            <Berkas size={16} />
            <span className="text-[0.875rem] font-semibold">
              {documents} dokumen
            </span>
            <span className="lt-figure text-[0.8125rem]">{pageLine}</span>
            <span className="lt-chevron" data-open={open} aria-hidden="true" />
          </button>

          {/* THE MAIN ACTION OF THIS BAR, SO IT IS THE PRIMARY KEY. An
              operator reported it as looking disabled while it was live: a
              default key beside a disclosure that is itself quiet reads as
              furniture, and the one thing this bar exists to let them do is
              add the dokumen tambahan the review sheet asked for. `Hapus`
              inside the open list stays a default key, because destroying
              evidence is not what this bar is for. */}
          <div className="ml-auto flex items-center gap-2">
            <Btn
              tone="primary"
              disabled={busy}
              /* `busy` here is the shell's ingest OR its AI read, so the
                 reason names BOTH moves rather than reaching for one word
                 that covers them. It said "proses yang sedang berjalan", and
                 "proses" is the word the operator retired for meaning
                 anything at all. */
              reason="Tunggu sampai dokumen selesai dimuat atau dibaca."
              onClick={onAdd}
            >
              <Klip size={16} />
              Tambah dokumen
            </Btn>
          </div>
        </div>

        {open ? (
          <ul className="flex flex-col gap-2 pb-4">
            {run.sources.map((source) => {
              const held = run.pages.filter(
                (page) => page.sourceId === source.id,
              ).length;
              const asking = confirming === source.id;
              const cost = asking ? costOf(source.id) : null;

              return (
                <li key={source.id} className="lt-row">
                  <div className="flex flex-wrap items-center gap-4">
                    <span
                      className="lt-figure min-w-0 flex-1 truncate text-[0.875rem]"
                      title={source.name}
                    >
                      {shortenFileName(source.name, 44)}
                    </span>
                    <span className="lt-figure text-[0.8125rem]">
                      {held} hal
                    </span>
                    {/* BEFORE `Hapus`, because it is the reversible one. The
                        two keys sit next to a key that destroys evidence, and
                        the order they read in is the order of consequence. */}
                    {onSetAi ? (
                      <DocumentAi
                        name={source.name}
                        ai={source.ai !== false}
                        busy={busy}
                        onChange={(next) => onSetAi(source.id, next)}
                      />
                    ) : null}
                    <Btn
                      disabled={busy || documents === 1}
                      /* ONLY THE BUSY HALF, because the other half is already
                         said in prose directly under this row and a reason
                         printed twice is a reason nobody reads. `busy` had
                         nothing at all: the key went down mid-ingest with its
                         explanation nowhere on the screen, which is the one
                         thing a disabled control may never do. */
                      reason={
                        busy
                          ? "Tunggu sampai dokumen selesai dimuat atau dibaca."
                          : undefined
                      }
                      onClick={() => setConfirming(asking ? null : source.id)}
                    >
                      <Coretan size={16} />
                      Hapus
                    </Btn>
                  </div>

                  {/* THE ONLY DOCUMENT CANNOT BE REMOVED, and the reason is
                      said rather than left to be guessed at. Removing it would
                      leave an order with no pages, which is not a state
                      worth building screens for: "Mulai order lain" on
                      Berkas Order is that, and it also frees the disk. */}
                  {documents === 1 && !busy ? (
                    <p className="lt-note">
                      Dokumen terakhir tidak bisa dihapus. Pakai{" "}
                      <b>Mulai order lain</b> di langkah Berkas Order.
                    </p>
                  ) : null}

                  {/* ONLY UNDER A FENCED BERKAS. The default state is the
                      overwhelmingly common one and explaining it on every row
                      of every order is the furniture this screen's density
                      pass exists to keep off. */}
                  {source.ai === false ? <TanpaAiNote /> : null}

                  {asking && cost ? (
                    /* PRICED, NOT MERELY CONFIRMED. "Anda yakin?" tells an
                       operator nothing they did not know when they clicked.
                       What they cannot see is how much accepted work sits
                       inside this document, and that is the number that
                       decides the answer. */
                    <div className="flex flex-col gap-2">
                      <p className="text-[0.875rem]">
                        Hapus {shortenFileName(source.name, 34)}?{" "}
                        {cost.confirmed > 0 ? (
                          <b>
                            {cost.confirmed} potongan yang sudah Anda terima
                            ikut terhapus.
                          </b>
                        ) : cost.captures > 0 ? (
                          <>
                            {cost.captures} usulan yang belum diputuskan ikut
                            terhapus.
                          </>
                        ) : (
                          <>Belum ada bukti yang diambil dari dokumen ini.</>
                        )}{" "}
                        <Hint label="Apa yang terjadi pada bukti dari dokumen lain">
                          Bukti dari dokumen lain tetap utuh. Nomor halamannya
                          ikut bergeser, dan setiap area yang sudah Anda terima
                          tetap menunjuk halaman yang sama.
                        </Hint>
                      </p>
                      <div className="flex items-center gap-2">
                        <Btn
                          tone="reject"
                          onClick={() => {
                            setConfirming(null);
                            onRemove(source.id);
                          }}
                        >
                          Hapus dokumen
                        </Btn>
                        <Btn onClick={() => setConfirming(null)}>Batal</Btn>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
