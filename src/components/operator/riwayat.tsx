"use client";

/**
 * RIWAYAT: the orders already saved on this device, ON A PAGE OF THEIR OWN.
 *
 * IT USED TO BE THE BOTTOM OF MUAT, AND THAT PLACE WAS READ AS A STEP. The
 * whole operator screen is a linear top-to-bottom sequence -- drop the files,
 * see what came in, press `Baca dengan AI` -- so a block sitting under the
 * last of those reads as what comes after it. It is not a step in the order
 * being worked on; it is the way back to a DIFFERENT one, which is the exact
 * opposite of forward. Off the flow, reachable by name from the account menu.
 *
 * IT IS THE SESSION MANAGER, and calling it that out loud was most of the
 * earlier fix. It was headed "Order tersimpan" in a 19rem rail beside the drop
 * target, and an operator asked whether it was meant to be the session
 * history, which is the question you ask about something that has not said
 * what it is. So it says: one word, one icon, its own kop.
 *
 * A ROW IS A LINK, NOT A BUTTON, and that is what the move costs and buys. On
 * Muat this list sat inside the shell that owns the run, so a row could call
 * `openRun(id)` and the screen changed under it. From here there is no shell
 * to call: a row carries the operator to `/#run/<id>`, which is the address
 * the workspace already writes for itself (`rememberRun`) and already reads on
 * boot, including the case where the order has since been deleted -- that
 * arrives as the workspace's own sentence about a dead address rather than as
 * a silent empty screen.
 *
 * A PLAIN ANCHOR RATHER THAN `next/link`, for the reason `src/app/page.tsx`
 * records at its refusal key: the destination has to be a real document load.
 * The workspace reads `window.location.hash` in a mount effect, and a full
 * load is the arrangement that cannot get the two out of order.
 *
 * WHAT THE MOVE DROPS, DELIBERATELY: the "sedang dibuka" marker on the open
 * order's row. Which run is open lives in the URL fragment of `/`, and a
 * fragment does not survive a navigation here -- it is not in `document.
 * referrer` either. Mirroring it into storage would be a second answer to a
 * question the address already answers, which is the failure this project is
 * organised against, and the marker is worth less here anyway: on Muat this
 * list sat under the open order, and on its own page it is a way IN. The
 * screens that DO know say so -- `DocumentsBar` on every phase, and the h1
 * beside the timeline.
 *
 * SEARCHABLE AT EVERY ROW COUNT, INCLUDING NONE. The field used to appear only
 * at seven rows, and the argument for that threshold was a real one: a filter
 * over four items is furniture. The operator asked for the field directly, and
 * they are the one who opens this list every day against a device that
 * accumulates orders for as long as nobody clears it.
 *
 * THE ARGUMENT AGAINST ANY THRESHOLD, INCLUDING A THRESHOLD OF ONE, is that
 * the control MOVES. A field that is absent through the first week of use and
 * appears one day is a worse thing to hand somebody than a field they do not
 * need yet, and the count it is gated on is not stable even within one visit:
 * the list is empty while storage is still being read, so a gate on "is there
 * a list at all" made the field pop in a beat after the screen drew, taking
 * the rows down with it.
 *
 * THE PLACEHOLDER NAMES WHAT IT ACTUALLY MATCHES, which is the document names
 * and the date AS PRINTED, the only two things a row shows. A field that
 * silently fails on anything else is this project's own failure class in a
 * text input.
 */

import { useEffect, useId, useState } from "react";

import { liveRuntime } from "@/lib/ui/live-runtime";
import { runHref } from "@/lib/ui/run-address";
import type { RunSummary } from "@/lib/ui/runtime";

import { Interruption, shortenFileName } from "./chrome";
import { Arsip, Cari } from "./icons";

const WAKTU = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * A run's label, shortened from the MIDDLE of the file name only.
 *
 * `listRuns` builds the label in `src/lib/browser/runtime.ts` (`labelFor`):
 * "(belum ada dokumen)" for a run with nothing in it, and "<name> +2 berkas
 * lagi" for a bundle. Only the name is squeezed -- the count is the half that
 * says this order holds more than one document, and losing it turns a bundle
 * into what looks like a single file.
 *
 * A TRANSLATION SHIM CAME WITH THIS COMPONENT AND IS GONE. It mapped "(no
 * documents yet)" and "+N more" into Bahasa, over a `labelFor` that had
 * ALREADY stopped emitting them, so neither branch could fire; its own
 * docblock said to delete it on exactly that condition. Worse, this function
 * was matching the suffix the dead shim WROTE ("berkas lain") rather than the
 * one `labelFor` emits ("berkas lagi"), so every bundle fell through to the
 * plain path and was cut across the count: "LOP999001_merged.pdf +2 berkas
 * lagi" printed as "LOP999001_merg…2 berkas lagi". Matching the real suffix is
 * what fixes it, and there is now one spelling of it rather than two.
 */
function shortenRunLabel(label: string): string {
  const parts = /^(.*?)( \+\d+ berkas lagi)$/.exec(label);
  if (!parts) return shortenFileName(label, 30);
  return `${shortenFileName(parts[1], 24)}${parts[2]}`;
}

/**
 * The whole screen: read the device, then draw what is on it.
 *
 * THE RUNTIME IS REACHED DIRECTLY rather than through `RuntimeProvider`. This
 * route has one component and no shell to hand a runtime down from, and
 * `liveRuntime` is the one binding a shipped build is allowed to use -- the
 * same value `operator-app.tsx` takes, from the same module, so there is no
 * second answer to "where do the saved orders live". The provider exists so a
 * SCREEN can be driven by a fake; this file is the composition root for its
 * own route, which is exactly where the live binding belongs.
 */
export function RiwayatScreen() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  // Distinct from `runs.length === 0`. A returning operator was told "belum ada
  // order", briefly but every single time, while the list was still being
  // read, which on a slow device is the first thing they get to read.
  const [loaded, setLoaded] = useState(false);
  const [fault, setFault] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const fieldId = useId();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await liveRuntime.listRuns();
        if (!alive) return;
        setRuns(list);
      } catch (problem) {
        if (!alive) return;
        setFault(problem instanceof Error ? problem.message : String(problem));
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Newest first: these are day-to-day work items, and recency is how people
  // actually find them.
  const ordered = [...runs].sort((a, b) => b.createdAt - a.createdAt);
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? ordered.filter((summary) =>
        `${summary.label} ${WAKTU.format(summary.createdAt)}`
          .toLowerCase()
          .includes(needle),
      )
    : ordered;

  return (
    <div className="flex flex-col gap-6">
      {/* A FAULT IS PROSE, NOT A TOAST AND NOT AN EMPTY LIST. Storage that
          cannot be read looks exactly like a device with no saved work, and
          telling a returning operator their orders are gone when they are not
          is this project's failure class pointed at the one screen whose whole
          job is finding them. */}
      {fault ? (
        <Interruption detail={fault}>
          Daftar order di perangkat ini tidak bisa dibaca, jadi riwayat di bawah
          kosong. Ini bukan berarti order Anda hilang. Muat ulang halaman ini,
          atau kembali ke aplikasi untuk memuat dokumen baru.
        </Interruption>
      ) : null}

      <section className="lt-slab" aria-labelledby="riwayat-runs">
        <div className="lt-kop">
          <Arsip size={16} />
          <h1 id="riwayat-runs">Riwayat order</h1>
          {/* THE COUNT FOLLOWS THE FILTER. A kop reading 14 over two visible
              rows is a small wrong-and-quiet of its own: it reads as a list
              that failed to draw the other twelve rather than as a filter
              doing its job. */}
          <span className="lt-kop-right lt-figure">
            {!loaded
              ? ""
              : needle
                ? `${shown.length} dari ${ordered.length}`
                : `${ordered.length}`}
          </span>
        </div>

        <div className="lt-slab-body flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor={fieldId} className="sr-only">
              Cari order menurut nama berkas atau tanggal
            </label>
            <Cari size={16} />
            <input
              id={fieldId}
              type="search"
              className="lt-input w-full max-w-[28rem]"
              placeholder="Cari nama berkas atau tanggal"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div aria-live="polite">
            {!loaded ? (
              /* Not "belum ada order" while the list is still being read. A
                 returning operator used to be told, briefly but every single
                 time, that they had no saved work. */
              <p className="lt-note">Memuat riwayat.</p>
            ) : ordered.length === 0 ? (
              <p className="lt-note">
                Belum ada order tersimpan. Menaruh berkas PDF di langkah Muat
                akan memulai satu.
              </p>
            ) : shown.length === 0 ? (
              <p className="lt-note">Tidak ada yang cocok dengan {query}.</p>
            ) : (
              /* A GRID RATHER THAN A COLUMN. Three across on a wide screen is
                 one screenful of history instead of a scroll box holding four
                 rows at a time. */
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((summary) => (
                  <li key={summary.id}>
                    <a
                      href={runHref(summary.id)}
                      className="lt-btn w-full flex-col items-start gap-1 px-4 py-2 text-left"
                    >
                      {/* THE FULL LABEL IN `title`, the squeezed one on
                          screen. Two orders of one customer's paperwork can
                          differ only in the middle of the file name, which is
                          exactly the part the squeeze removes. */}
                      <span
                        className="lt-figure w-full truncate text-[0.875rem]"
                        title={summary.label}
                      >
                        {shortenRunLabel(summary.label)}
                      </span>
                      {/* 13px, not 12: nothing in this product is set smaller,
                          because the date is how one order of a customer's
                          paperwork is told from another. */}
                      <span className="text-ink-2 text-[0.8125rem] font-normal">
                        {WAKTU.format(summary.createdAt)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
