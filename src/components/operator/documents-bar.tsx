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
 * through every phase. `Riwayat` is the order saved on this device, it
 * lives at the bottom of Muat, and it appears nowhere else, so looking for an
 * old job cannot compete for attention with the job in hand.
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

export function DocumentsBar({
  run,
  busy,
  costOf,
  onAdd,
  onRemove,
}: {
  run: BrowserRun;
  /** An ingest or a search is running, so the bundle must not change under it. */
  busy: boolean;
  costOf: (sourceId: string) => RemovalCost;
  onAdd: () => void;
  onRemove: (sourceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const documents = run.sources.length;
  const pages = run.pages.length;
  // The partial form while an ingest is still reading. It used to live in the
  // strip's h1 and came down here with the rest of the composition: "5 dari 29
  // halaman terbaca" is a fact about the bundle, which is this bar's subject.
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

          <div className="ml-auto flex items-center gap-2">
            <Btn disabled={busy} onClick={onAdd}>
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
                    <Btn
                      disabled={busy || documents === 1}
                      onClick={() => setConfirming(asking ? null : source.id)}
                    >
                      <Coretan size={16} />
                      Hapus
                    </Btn>
                  </div>

                  {/* THE ONLY DOCUMENT CANNOT BE REMOVED, and the reason is
                      said rather than left to be guessed at. Removing it would
                      leave a order with no pages, which is not a state
                      worth building screens for: "Mulai order lain" on
                      Muat is that, and it also frees the disk. */}
                  {documents === 1 && !busy ? (
                    <p className="lt-note">
                      Dokumen terakhir tidak bisa dihapus. Pakai{" "}
                      <b>Mulai order lain</b> di langkah Muat.
                    </p>
                  ) : null}

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
