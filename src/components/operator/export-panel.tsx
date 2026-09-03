"use client";

/**
 * Screen 3 of three (Muat, Periksa, Berkas): write the two deliverables.
 *
 * THE MANIFEST IS AN INVENTORY, NOT AN EXCEPTION REPORT. This screen used to
 * summarise the entire visual content of the packet as one integer ("12
 * confirmed crops") and then list only the exceptions. A count cannot be
 * checked against anything, and an exception list cannot be read side by side
 * with the document a validator is about to sign. So every fillable slot is
 * listed, in template order, every time, including the ones that are fine, and
 * every confirmed capture CARRIES ITS PICTURE at a size where a wrong page is
 * recognisable. This is the last pass before a signature; it is exactly the
 * wrong place to be the one screen with no evidence on it.
 *
 * EVERY NUMBER SAYS WHETHER IT COUNTS SLOTS OR CAPTURES. `bagian` and
 * `potongan` are different units and the sample's ToP row holds two potongan
 * in one bagian. Folding them into one figure is how a half-filled slot has
 * already shipped wrong twice.
 *
 * THE BLOCK IS ATTACHED TO THE CONTROL IT DISABLES. The verdict, the blocking
 * items by their operator-facing label, the remedy, the two file names and the
 * build button live together in one sticky bar, because at 1366x768 the old
 * layout put the reason at the top of a page taller than the viewport and the
 * disabled button at the bottom of it. A disabled control whose explanation is
 * off screen reads as a broken app.
 *
 * THAT BAR IS AN OVERLAY, SO IT PAYS FOR ITS OWN SPACE. `position: sticky`
 * keeps the bar in the flow and pulls it up to the viewport's bottom edge for
 * as long as its own place in the flow is below that edge, so it covers the
 * bottom of everything above it until the scroll reaches the very end. The
 * slack that released it was 56px of a metre-long page, which is less than one
 * wheel notch, so the section sitting directly above it was underneath it in
 * practice. The flow now reserves the bar's MEASURED height above it
 * (`useBarHeight`), so the last row of the manifest can always be scrolled
 * clear.
 *
 * WHAT IS FILLED IN AUTOMATICALLY IS EXACTLY WHAT THE APP CAN READ, WHICH IS
 * THE SOURCE FILE NAMES. `deriveIdsFromFilenames` gets ID EPIC and Quote out
 * of them, and each one says so beside the field and names the file it came
 * from, because a value the operator is meant to CHECK must not look like a
 * value somebody typed. Nothing else is guessed, and the three empty fields
 * each say why in one line rather than looking unfinished. There is no values
 * path in this browser to guess with: `/api/propose` answers with zones, a
 * page and a line range, never with text, and a `BrowserRun` carries pages and
 * zones only. Two of the three are recorded failures on top of that:
 * `namaProyek` answered with the master contract's scope title, with a
 * citation that PASSED validation, and `cc` matched a printed email's own
 * "Cc:" header and put a wrong customer name into both deliverables.
 *
 * ONE INVARIANT WORTH KEEPING: a picture on this screen means a picture in the
 * docx. A capture that holds a zone the export will not print (an `unfilled`
 * capture that kept its rectangle) is drawn as a deliberate absence and says
 * so, never as a picture.
 *
 * WHAT WENT BEHIND A QUESTION MARK, AND THE LINE THAT DECIDED IT. A clause
 * that would read word for word the same on every order, and that is not the
 * reason a control on screen is refusing to work, is an explanation rather
 * than a fact about this run, so it belongs in a `Hint`. That took the screen
 * lede's rationale clause, the manifest's preamble, the header table's
 * fifty-six word lede, the workbook's row count and the workbook notice's
 * argument for the empty column.
 *
 * IT DID NOT TAKE THE BLOCK, and that is the half worth defending. The
 * paragraph explaining why nothing is built before every area is checked never
 * changes either, and it stays on screen because it is exactly why the build
 * button will not fire: a disabled control whose reason is behind a hover is
 * the same defect as one whose reason is off screen. "Siap diekspor" stays for
 * the same reason in the other direction, because an absent warning is not a
 * confirmation. Nor did it take one word of the six header fields' provenance,
 * which names the file a value was read out of and is what stops a guess
 * looking like a typed value, nor any per-crop advisory, each of which is a
 * measurement of one rectangle on one page, nor the manifest's three lines of
 * counts, nor the download-may-not-have-arrived remedy, which is an
 * interruption wearing a calm voice.
 *
 * THE TWO ON-DEVICE LINES MOVED, AND THEY ARE NOT A CONSENT STATEMENT. A
 * sentence said at the moment data leaves the device stays on screen however
 * invariant it is; this one is its opposite, a promise that nothing leaves,
 * made by a button that uploads nothing. The consent the operator does owe is
 * made on Muat, where the page images actually go out. Every line inside the
 * sticky bar is subtracted from the manifest's viewport twice, once as the bar
 * and once as the space `useBarHeight` reserves for it, so two lines there
 * cost four.
 */

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import type { HeaderFields } from "@/lib/export/docx";
import { AO_TEMPLATE } from "@/lib/forms/template";
import { deriveIdsFromFilenames } from "@/lib/pipeline/fields";
import {
  resolveJenisOrder,
  type JenisOrder,
  type JenisOrderOrigin,
  type JenisOrderPage,
} from "@/lib/pipeline/jenis-order";
import { cropToDisplayUrl, downloadBytes, revokeUrls } from "@/lib/ui/crops";
import { citeZone, resolvePage } from "@/lib/ui/evidence";
import type {
  CaptureStanding,
  PlannedCapture,
  PlannedCrop,
  PlannedSlot,
} from "@/lib/ui/export";
import {
  blockingItems,
  deliverableNames,
  displayLabel,
  namesAreFallback,
  planExport,
} from "@/lib/ui/export";
import type { BrowserRun } from "@/lib/ui/runtime";
import { useRuntime } from "@/lib/ui/runtime-context";
import type { SlotAggregateStatus } from "@/lib/ui/slots";
import { captureLabel } from "@/lib/ui/slots";

import {
  Btn,
  Cite,
  CiteAdvisories,
  Hint,
  Interruption,
  Mark,
  Notice,
  STATUS_WORDS,
  StateWord,
  TechnicalDetail,
  Title,
  shortenFileName,
} from "./chrome";
import { Denah } from "./denah";
import { BukuKerja, Paket } from "./icons";

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * The true size, including zero.
 *
 * This floored at 1 KB while the copy beside it claimed that sizes were shown
 * "so an empty file is visible before it is filed": the one safeguard the
 * sentence promised was the one the rounding removed. A comma decimal, because
 * the audience is Indonesian.
 */
function fileSize(bytes: Uint8Array): string {
  const n = bytes.byteLength;
  const decimal = (value: number) => value.toFixed(1).replace(".", ",");
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${decimal(n / 1024)} KB`;
  return `${decimal(n / (1024 * 1024))} MB`;
}

/**
 * The shape each standing wears.
 *
 * `lost` borrows the struck diagonal because it IS a fault, and `--gap` is the
 * only honest colour for evidence that will not reach the file. It never
 * borrows the word: a capture whose page has gone was not "tidak ditemukan",
 * it was found and accepted and then lost, and those two want different
 * remedies.
 */
const STANDING_MARK: Record<CaptureStanding, SlotAggregateStatus> = {
  ships: "confirmed",
  proposed: "proposed",
  pending: "pending",
  outstanding: "outstanding",
  unfilled: "unfilled",
  lost: "outstanding",
};

const STANDING_WORD: Record<CaptureStanding, string> = {
  ships: STATUS_WORDS.confirmed,
  proposed: STATUS_WORDS.proposed,
  pending: STATUS_WORDS.pending,
  outstanding: STATUS_WORDS.outstanding,
  unfilled: STATUS_WORDS.unfilled,
  lost: "halaman sudah tidak ada",
};

/** What happens to this capture when the files are written, in one sentence. */
function standingSentence(capture: PlannedCapture): string {
  switch (capture.standing) {
    case "ships":
      return "Potongan ini dicetak di dokumen validasi.";
    case "proposed":
      return "Usulan ini masih menunggu keputusan Anda, jadi belum bisa dicetak.";
    case "pending":
      return "Belum ada yang mencarikan bukti untuk potongan ini.";
    case "outstanding":
      return "Sudah dicari di seluruh dokumen, buktinya tidak ada. Sel ini terbit kosong.";
    case "unfilled":
      return "Dikosongkan atas keputusan Anda, bukan karena terlewat.";
    case "lost":
      return capture.lostPageIndex === null
        ? "Bagian ini tercatat Anda terima, tetapi tidak menyimpan area, jadi tidak ada yang bisa dicetak."
        : "Bukti yang Anda terima menunjuk halaman yang sudah tidak ada di pekerjaan ini, jadi tidak bisa dicetak.";
  }
}

/* ------------------------------------------------------------- the pictures */

/**
 * A fault found while cutting a thumbnail, which is also a fault the build
 * will hit.
 *
 * `size` is the `expect` mismatch: the zone was measured against a page of one
 * size and the page re-renders at another, so `cropToPng` refuses it. That was
 * a build-time throw with a clean-looking manifest in front of it; catching it
 * here turns it into something the operator reads before pressing anything.
 */
type Thumb = { url?: string; fault?: "size" | "page" };

const NO_THUMBS: Record<string, Thumb> = {};

/**
 * One picture per shipping capture, cut one page bitmap at a time.
 *
 * Grouped by page and released before the next one, because a 300 DPI A4 page
 * is about 35MB as RGBA and this screen shows a dozen crops taken from a
 * handful of pages. Holding a bitmap per crop is how a 29-page bundle turns
 * into a tab that runs out of memory.
 *
 * Deliberately NOT `useCropThumbs`: that hook cuts every zone the run holds,
 * keyed by its position in `run.slots`, which is what the review sheet needs.
 * This screen must cut exactly the set that will be printed, in the order the
 * docx stacks it, so that a picture here means a picture there.
 */
function useExportThumbs(
  runId: string,
  crops: PlannedCrop[],
): Record<string, Thumb> {
  const runtime = useRuntime();
  const key = useMemo(
    () =>
      JSON.stringify(
        crops.map((crop) => ({
          id: String(crop.stateIndex),
          pageId: crop.pageId,
          box: crop.box,
          expect: crop.expect,
        })),
      ),
    [crops],
  );
  const [state, setState] = useState<{
    key: string;
    thumbs: Record<string, Thumb>;
  }>({ key: "", thumbs: NO_THUMBS });

  useEffect(() => {
    // The work list is read back out of `key` rather than closed over, so a
    // re-render that changes no zone (typing in the header table, for one)
    // does not decode a 35MB page again.
    const specs = JSON.parse(key) as {
      id: string;
      pageId: string;
      box: PlannedCrop["box"];
      expect: PlannedCrop["expect"];
    }[];

    let alive = true;
    const made: string[] = [];

    const put = (id: string, thumb: Thumb) => {
      if (!alive) return;
      setState((prev) => ({
        key,
        thumbs: {
          ...(prev.key === key ? prev.thumbs : NO_THUMBS),
          [id]: thumb,
        },
      }));
    };

    const byPage = new Map<string, typeof specs>();
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
          // One page that will not render must not stop the rest of the
          // manifest, and it is reported rather than left as a gap: the build
          // will fail on the same page.
          for (const spec of group) put(spec.id, { fault: "page" });
          continue;
        }
        try {
          for (const spec of group) {
            if (
              bitmap.width !== spec.expect.width ||
              bitmap.height !== spec.expect.height
            ) {
              put(spec.id, { fault: "size" });
              continue;
            }
            const url = await cropToDisplayUrl(bitmap, spec.box);
            if (!alive) {
              URL.revokeObjectURL(url);
              return;
            }
            made.push(url);
            put(spec.id, { url });
          }
        } finally {
          bitmap.close();
        }
      }
    })();

    return () => {
      alive = false;
      // Object URLs are held by the document until they are revoked, so a
      // screen that re-cut a few times would leak a crop-sized blob each time.
      revokeUrls(made);
    };
  }, [runtime, runId, key]);

  return state.key === key ? state.thumbs : NO_THUMBS;
}

/**
 * How much room the sticky action bar takes out of the bottom of the viewport.
 *
 * MEASURED, never assumed, for the same reason the contact sheet measures the
 * application strip: this bar is a different height in every state it has. It
 * is shortest when the export is ready, taller when it is blocked (a verdict,
 * up to four counted reasons, the blocking items by name and the remedy), and
 * taller again once the two files are built and each has its own Simpan row.
 * A constant here would be right in one of those states and wrong in the rest,
 * and wrong means a row of the manifest is under the bar again.
 */
function useBarHeight(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // The observer is the only thing that writes the height, including the
    // first time: `ResizeObserver` delivers a measurement as soon as it starts
    // observing, so the effect body itself never sets state.
    const observer = new ResizeObserver(() =>
      setHeight(Math.round(node.getBoundingClientRect().height)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, height];
}

/* -------------------------------------------------------------- the header */

/**
 * ID EPIC and Quote as the source file NAMES spell them, and the name each one
 * was read out of.
 *
 * `deriveIdsFromFilenames` answers over the whole bundle at once, so on its own
 * it cannot say which file supplied a value. Neither of its two patterns can
 * span a space, so asking it one file name at a time yields the same two values
 * plus the name that carried them. The alternative is a second copy of those
 * regexes here, and two copies of a pattern are two patterns.
 */
type DerivedIds = {
  idEpic: string;
  idEpicFrom: string;
  quote: string;
  quoteFrom: string;
};

function deriveWithSources(names: string[]): DerivedIds {
  const all = deriveIdsFromFilenames(names);
  const from = (pick: (one: string) => string, value: string) =>
    value ? (names.find((name) => pick(name) === value) ?? "") : "";
  return {
    idEpic: all.idEpic,
    idEpicFrom: from(
      (name) => deriveIdsFromFilenames([name]).idEpic,
      all.idEpic,
    ),
    quote: all.quote,
    quoteFrom: from((name) => deriveIdsFromFilenames([name]).quote, all.quote),
  };
}

/**
 * One header field, and WHERE ITS VALUE CAME FROM, said beside it.
 *
 * A value read out of a file name is a guess: it is right exactly when the
 * person who named the scan typed the right identifier, and nothing on this
 * screen can check that. A value the operator typed is a decision. Drawn the
 * same way, the guess borrows the decision's authority, and the cell it lands
 * in is on the cover page of a document a validator signs. So the guess wears
 * `--mark` (a decision is owed here: look at it) and names its file, and the
 * moment the operator changes it the marker stops claiming a source it no
 * longer has.
 *
 * The derived value is never thrown away. Clearing the field offers it back
 * with one press, because "I deleted the wrong one" must not mean retyping a
 * quote number off a scan.
 *
 * An empty field says `(belum diisi)`, never a lone dash: a blank that says
 * nothing and a blank that means something look identical otherwise.
 */
/**
 * How each origin is worded beside the field.
 *
 * `resolveJenisOrder` is PURE and reads the OCR pages the run already holds:
 * no request, no model call, nothing to spend, which is why this is filled in
 * automatically where `namaProyek` and `cc` are not. The other half of that
 * argument is that a wrong order code is VISIBLE: the codes are short, few and
 * printed on the form, so an operator catches a wrong one in a way they cannot
 * catch a wrong project name.
 *
 * THE RESOLVER'S OWN `detail` IS NOT SHOWN AS PROSE. It is written for a
 * developer reading a CLI log, in English, and it ends in advice an operator
 * cannot act on ("pass --jenis-order to set it"). It still carries the file,
 * page and line, which is the useful half, so it goes behind `Detail teknis`
 * like every other deployer-facing string in this app. The sentence beside the
 * field is ours and is in Bahasa Indonesia.
 *
 * The four non-answering origins all ship "" and say why. None of them may
 * borrow the wording of another: `conflict` means two documents disagree and
 * the operator decides, `inferred` means the form HAS an answer printed that
 * we would not trust and they should go and read it, and `none` means nothing
 * was printed at all. Telling an operator "tidak ditemukan" when the answer is
 * on the page would send them away from the one place that has it.
 */
const JENIS_SENTENCE: Record<JenisOrderOrigin, string> = {
  flag: "Ditentukan saat aplikasi dijalankan, bukan dibaca dari dokumen.",
  env: "Ditentukan saat aplikasi dijalankan, bukan dibaca dari dokumen.",
  "order-request":
    "Diambil dari isian Jenis Order pada permintaan order, jadi ini yang paling bisa dipegang.",
  documents:
    "Terbaca dari label Jenis Order yang tercetak di dokumen. Periksa sebelum kedua berkas dibuat.",
  inferred:
    "Ada label Jenis Order di dokumen, tapi isinya tidak bisa dipastikan. Buka halamannya, baca sendiri, lalu isi di sini.",
  conflict:
    "Dokumen menyebut jenis order yang berbeda-beda, jadi kolom ini dibiarkan kosong. Anda yang menentukan mana yang benar.",
  none: "Tidak ada dokumen yang mencantumkan Jenis Order. Isi sendiri.",
};

const JENIS_MARKER: Record<JenisOrderOrigin, string> = {
  flag: "ditentukan saat dijalankan",
  env: "ditentukan saat dijalankan",
  "order-request": "diisi di permintaan order",
  documents: "terbaca dari dokumen",
  inferred: "tidak bisa dipastikan",
  conflict: "dokumen tidak sepakat",
  none: "tidak tertulis",
};

/**
 * The sentence beside Jenis Order, and the resolver's own words behind a
 * disclosure.
 *
 * Two audiences, never one paragraph. `JENIS_SENTENCE` is what the operator
 * acts on; `jenis.detail` names the file, page and line and is in English with
 * CLI advice on the end, so it sits under `Detail teknis` exactly like a raw
 * exception does everywhere else in this app.
 */
function JenisNote({
  jenis,
  explainCodes = false,
}: {
  jenis: JenisOrder;
  explainCodes?: boolean;
}) {
  return (
    <>
      {JENIS_SENTENCE[jenis.origin]}
      {explainCodes
        ? " AO mengaktifkan layanan, MO mengubah, DO menghapus, dan jenis lain juga ada."
        : null}
      <TechnicalDetail>{jenis.detail}</TechnicalDetail>
    </>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  derived = "",
  derivedFrom = "",
  derivedMarker = "dibaca dari nama berkas",
  originMarker,
  derivedNote,
  derivedLabel = "Nama berkas",
  fallback = "",
  note,
  list,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** What the source file names yielded for this field, "" when nothing. */
  derived?: string;
  /** The file name that yielded it. */
  derivedFrom?: string;
  /**
   * The three wordings that used to be hardcoded to "the source file names".
   * A second source of derived values arrived (the jenis order read off the
   * documents themselves), and the difference between "your file name said
   * this" and "a page said this" is exactly what the operator needs to weigh,
   * so it cannot be one sentence serving both.
   */
  derivedMarker?: string;
  /**
   * What to call the value's provenance while the operator has not touched it,
   * INCLUDING when that value is empty. The computed marker below cannot do
   * this: it collapses every empty field to "(belum diisi)", which is right
   * for a field nobody tried to fill and wrong for one where something looked
   * and reported back. "dokumen tidak sepakat" and "(belum diisi)" are both
   * empty and mean entirely different things.
   */
  originMarker?: string;
  derivedNote?: ReactNode;
  derivedLabel?: string;
  /** The app's own starting value, for the one field that has one. */
  fallback?: string;
  /** Why this field is not filled in automatically, in one line. */
  note?: ReactNode;
  list?: string;
}) {
  const empty = value.trim() === "";
  const fromFile = derived !== "" && value === derived;
  const changed = derived !== "" && value !== derived;

  const marker = originMarker && value === derived
    ? originMarker
    : fromFile
    ? derivedMarker
    : changed
      ? "diubah sendiri"
      : empty
        ? "(belum diisi)"
        : fallback !== "" && value === fallback
          ? "bawaan aplikasi"
          : "diisi sendiri";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-2">
        {/* The six names are the document's own field names, so they are set
            in the mono face. They are not shouted in caps to give them rank:
            uppercase here would be the interface labelling, not the paper
            speaking. */}
        <label className="lt-label lt-figure" htmlFor={id}>
          {label}
        </label>
        <span
          className="lt-label"
          style={fromFile ? { color: "var(--mark)" } : undefined}
        >
          {marker}
        </span>
      </div>
      <input
        id={id}
        className="lt-input"
        list={list}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />

      {/* Provenance, then the way back to it, then the reason there is none.
          Only one of the three ever applies. These lines are set in `--ink-2`
          rather than `.lt-note`'s `--ink-3`: each one is the sentence that
          keeps an operator from trusting a guess or from reading a deliberate
          blank as a broken feature, which is safety copy. */}
      {fromFile ? (
        // A div, not a p: these slots take arbitrary nodes now, and a caller
        // that puts a `Detail teknis` disclosure in one would otherwise nest a
        // <details> inside a <p>, which is invalid and throws a hydration
        // error rather than merely looking wrong.
        <div className="text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
          {derivedNote ?? (derivedFrom ? (
            <>
              Terbaca di nama berkas{" "}
              <span className="lt-figure" title={derivedFrom}>
                {shortenFileName(derivedFrom, 30)}
              </span>
              . Periksa sebelum kedua berkas dibuat.
            </>
          ) : (
            <>Terbaca di nama berkas sumber. Periksa sebelum kedua berkas dibuat.</>
          ))}
        </div>
      ) : changed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
            {derivedLabel} memberi <span className="lt-figure">{derived}</span>.
          </p>
          <Btn onClick={() => onChange(derived)}>Pakai lagi {derived}</Btn>
        </div>
      ) : note ? (
        <div className="text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
          {note}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ the manifest */

function CapturePlate({
  run,
  slot,
  capture,
  thumb,
}: {
  run: BrowserRun;
  slot: PlannedSlot;
  capture: PlannedCapture;
  thumb: Thumb | undefined;
}) {
  const zone = capture.crop ? capture.crop.state.zone : undefined;
  const resolved = zone ? resolvePage(run, zone.pageIndex) : null;
  const cite = zone ? citeZone(run, zone) : null;
  const ships = capture.standing === "ships";

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="flex min-w-0 flex-col gap-2">
        {ships && thumb?.url ? (
          <figure className="lt-paper max-w-[42rem] p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL
                cut in this tab from a document that must never leave it;
                next/image would want a loader and a remote pattern. */}
            <img
              className="block h-auto w-full"
              src={thumb.url}
              alt={`Potongan untuk ${captureLabel(
                slot.label,
                capture.ordinal,
                slot.required,
              )}${cite ? `, halaman ${cite.page} dari ${cite.pagesInDoc}` : ""}`}
            />
          </figure>
        ) : ships && thumb?.fault ? (
          <div className="lt-well max-w-[42rem] p-4">
            <p className="text-[0.8125rem]" style={{ color: "var(--gap)" }}>
              {thumb.fault === "size"
                ? "Ukuran halaman ini tidak lagi sama dengan ukuran waktu areanya dibuat, jadi potongannya tidak bisa diambil."
                : "Halaman ini tidak bisa dirender lagi di peramban ini, jadi potongannya tidak bisa diambil."}
            </p>
          </div>
        ) : ships ? (
          <div
            className="lt-well max-w-[42rem] w-full"
            style={{
              aspectRatio: `${Math.max(1, Math.round(capture.crop?.box.w ?? 1))} / ${Math.max(
                1,
                Math.round(capture.crop?.box.h ?? 1),
              )}`,
            }}
            aria-busy="true"
          >
            <p className="lt-note p-3">Menyiapkan gambar potongan.</p>
          </div>
        ) : (
          <div className="lt-hatch flex max-w-[42rem] flex-col gap-1 p-4">
            <p className="text-[0.875rem]" style={{ color: "var(--ink)" }}>
              Tidak ada gambar untuk potongan ini.
            </p>
            {/* Safety copy, so it is never set in `--ink-3`: this is the
                sentence that says what the deliverable will be missing. */}
            <p className="text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
              {standingSentence(capture)}
            </p>
            {capture.strandedZone ? (
              <p className="text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
                Area yang tersimpan di sini tetap ada di pekerjaan, tetapi tidak
                ikut dicetak.
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {slot.required > 1 ? (
          <p className="lt-label">
            potongan{" "}
            <span className="lt-figure" style={{ color: "var(--ink)" }}>
              {capture.ordinal} dari {slot.required}
            </span>
          </p>
        ) : null}

        {zone && resolved ? (
          <Denah
            page={resolved.page}
            cut={zone.box}
            size="md"
            label={`Denah halaman ${resolved.pageInDoc + 1} dengan area potongan ${slot.label}`}
          />
        ) : null}

        {ships ? (
          <>
            <Cite cite={cite} />
            <CiteAdvisories cite={cite} />
          </>
        ) : (
          <StateWord status={STANDING_MARK[capture.standing]}>
            {STANDING_WORD[capture.standing]}
          </StateWord>
        )}
      </div>
    </div>
  );
}

function SlotBlock({
  run,
  slot,
  quote,
  thumbs,
}: {
  run: BrowserRun;
  slot: PlannedSlot;
  quote: string;
  thumbs: Record<string, Thumb>;
}) {
  // The slot's own reading, from its captures. `partial` can never borrow
  // `proposed`'s treatment: a slot shipping one of two pictures looks complete
  // in the deliverable, which is the failure this whole screen is against.
  const status: SlotAggregateStatus =
    slot.ships >= slot.required
      ? "confirmed"
      : slot.ships > 0
        ? "partial"
        : STANDING_MARK[slot.captures[0]?.standing ?? "pending"];

  const label = displayLabel(slot.label, quote || "(belum diisi)");

  return (
    <div
      className="flex flex-col gap-4 border-t py-5"
      style={{ borderColor: "var(--line)" }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Mark status={status} title={`${label}: ${STATUS_WORDS[status]}`} />
        <span className="lt-figure text-[1.0625rem] font-bold">{label}</span>
        <StateWord status={status} />
        {slot.required > 1 ? (
          <span className="lt-figure ml-auto text-[0.8125rem]">
            {slot.ships} dari {slot.required} potongan
          </span>
        ) : null}
      </div>

      {slot.captures.length === 0 ? (
        <div className="lt-hatch flex flex-col gap-1 p-4">
          <p className="text-[0.875rem]" style={{ color: "var(--ink)" }}>
            Tidak ada gambar untuk bagian ini.
          </p>
          <p className="text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
            Pekerjaan ini belum pernah mencatat apa pun untuk bagian tersebut.
          </p>
        </div>
      ) : (
        slot.captures.map((capture) => (
          <CapturePlate
            key={`${slot.key}#${capture.ordinal}`}
            run={run}
            slot={slot}
            capture={capture}
            thumb={thumbs[String(capture.stateIndex)]}
          />
        ))
      )}
    </div>
  );
}

/* --------------------------------------------------------------- the screen */

export function ExportPanel({
  run,
  onGoToSheet,
}: {
  run: BrowserRun;
  onGoToSheet: () => void;
}) {
  const runtime = useRuntime();
  const derived = useMemo(
    () => deriveWithSources(run.sources.map((s) => s.name)),
    [run.sources],
  );

  // Seeded once, on mount, which is enough because this screen is mounted only
  // while the Berkas phase is open and unmounted when the operator leaves it.
  // A dokumen tambahan is taken on Periksa, so its file name is already in
  // `run.sources` before this component exists.
  /*
   * JENIS ORDER, READ OFF THE PAGES THIS RUN ALREADY HOLDS.
   *
   * `resolveJenisOrder` is pure: no filesystem, no model call, no request, so
   * this costs nothing at render time and needs no button to spend. `flag` and
   * `env` stay undefined because a browser has neither, and `orderRequest`
   * will stay undefined until the ingest path accepts one, so in practice this
   * answers `documents`, `inferred`, `conflict` or `none`.
   *
   * `pageInDoc` is `StoredPage.index`, the page's 0-based number WITHIN ITS
   * OWN SOURCE, which is what the resolver's own callers pass. It renders as
   * `p1` for the first page because the label adds one; the field stays an
   * index because every caller uses it to look something up.
   */
  const jenisPages = useMemo<JenisOrderPage[]>(() => {
    const nameOf = new Map(run.sources.map((s) => [s.id, s.name]));
    return run.pages.map((page) => ({
      sourceName: nameOf.get(page.sourceId) ?? "",
      pageInDoc: page.index,
      lines: page.lines,
    }));
  }, [run.pages, run.sources]);

  const jenis = useMemo(
    () => resolveJenisOrder({ pages: jenisPages }),
    [jenisPages],
  );

  const [header, setHeader] = useState<HeaderFields>({
    idEpic: derived.idEpic,
    quote: derived.quote,
    namaProyek: "",
    cc: "",
    order: "",
    /*
     * NO DEFAULT. This used to seed `AO_TEMPLATE.id`, so every run arrived
     * with a confident "AO" in a cell that goes into a document a validator
     * signs, whether or not any document said so. That is the same shape as
     * the printed option menu with nothing ticked being read as a filled AO,
     * except done to ourselves: a filled field does not ask to be filled, so
     * an operator working a Modify Order had to notice a value that already
     * looked answered. `resolveJenisOrder` says outright that it has no
     * default, and neither does this.
     */
    jenisOrder: jenis.value,
  });
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "working"; done: number; total: number }
    | {
        kind: "built";
        docx: Uint8Array;
        xlsx: Uint8Array;
        /**
         * What was built, and under which names.
         *
         * Both are captured AT BUILD TIME. `deliverableNames` recomputes on
         * every render while the bytes do not, so editing ID EPIC after a
         * successful build used to hand over a file named for the new ID EPIC
         * whose header table still carried the old one. That is the
         * wrong-and-quiet failure on the cover page of the document a
         * validator signs.
         */
        names: { docx: string; xlsx: string };
        stamp: string;
      }
    | { kind: "failed"; message: string }
  >({ kind: "idle" });
  const [handedOver, setHandedOver] = useState<{
    docx: boolean;
    xlsx: boolean;
  }>({ docx: false, xlsx: false });

  const [barRef, barHeight] = useBarHeight();
  const plan = useMemo(() => planExport(run, AO_TEMPLATE), [run]);
  const thumbs = useExportThumbs(run.id, plan.crops);
  const names = deliverableNames(header, run.id);
  const { tally } = plan;

  /**
   * What the built bytes were built from.
   *
   * The header fields and the exact set of rectangles that will be cut. Any
   * difference means the files on this screen no longer describe what the
   * screen says, so they are withheld rather than handed over.
   */
  const stamp = useMemo(
    () =>
      JSON.stringify({
        header,
        crops: plan.crops.map((crop) => ({
          key: crop.key,
          ordinal: crop.ordinal,
          pageId: crop.pageId,
          box: crop.box,
        })),
      }),
    [header, plan],
  );
  const stale = state.kind === "built" && state.stamp !== stamp;

  const faults = plan.crops.filter(
    (crop) => thumbs[String(crop.stateIndex)]?.fault,
  );
  const blocking = blockingItems(plan);
  const byKind = {
    proposed: blocking.filter((item) => item.kind === "proposed"),
    pending: blocking.filter((item) => item.kind === "pending"),
    lost: blocking.filter((item) => item.kind === "lost"),
  };
  const blocked = blocking.length > 0 || faults.length > 0;

  const set = (patch: Partial<HeaderFields>) =>
    setHeader((prev) => ({ ...prev, ...patch }));

  const write = async () => {
    setState({ kind: "working", done: 0, total: plan.crops.length });
    setHandedOver({ docx: false, xlsx: false });
    try {
      const { buildDeliverables } = await import("@/lib/ui/export");
      const files = await buildDeliverables(run, AO_TEMPLATE, header, plan, {
        pageBitmap: runtime.pageBitmap,
        onProgress: (done, total) => setState({ kind: "working", done, total }),
      });
      // Built, not downloaded. Two files handed over back to back is two
      // programmatic downloads in a row, which a browser blocks after the
      // first with a permission prompt -- and when that prompt is dismissed
      // the second file simply never arrives. An operator would leave with the
      // document and no workbook and no reason to suspect it. One button per
      // file, each its own click.
      setState({
        kind: "built",
        docx: files.docx,
        xlsx: files.xlsx,
        names: deliverableNames(header, run.id),
        stamp,
      });
    } catch (error) {
      setState({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Named the way the packet names them, never by key: `kbLanjutan.top` is
  // system vocabulary and an operator cannot map it back to a row.
  const itemName = (item: (typeof blocking)[number]) =>
    `${item.sectionTitle} / ${captureLabel(item.label, item.ordinal, item.required)}`;

  const blockedNames = [
    ...blocking.map(itemName),
    // `required` is not carried on a fault, and an ordinal above one is only
    // ever a continuation, so 2 stands in for "at least two" here.
    ...faults.map((crop) =>
      captureLabel(crop.label, crop.ordinal, Math.max(2, crop.ordinal)),
    ),
  ];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* The packet is what this screen builds, so the screen wears its
              mark. One icon for the screen, none on the rows below it. */}
          <Paket size={20} className="shrink-0" />
          <Title>Buat berkas hasil</Title>
          <Hint label="Kenapa isinya diperlihatkan dulu">
            Kedua berkas akan terbuka dengan rapi entah buktinya benar atau
            salah, jadi isinya diperlihatkan di sini sebelum ditulis.
          </Hint>
        </div>
        <p className="lt-lede">
          Dua berkas: dokumen validasi dan buku kerja EPIC. Halaman ini
          memperlihatkan isi keduanya sebelum ditulis.
        </p>
      </header>

      {plan.orphans.length > 0 ? (
        <Notice tone="stop">
          <p>
            Pekerjaan ini menyimpan{" "}
            <span className="lt-figure">{plan.orphans.length}</span> potongan
            yang tidak punya tempat di dokumen ini, jadi tidak akan ikut
            dicetak:
          </p>
          <p className="lt-figure pt-1 text-[0.8125rem]">
            {plan.orphans.map((orphan) => orphan.label).join(", ")}
          </p>
          <p className="pt-1 text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
            Bagian tersebut sudah tidak ada di daftar bagian dokumen validasi.
            Tidak ada yang bisa Anda lakukan di halaman ini, jadi catat saja
            sebelum berkasnya dipakai.
          </p>
        </Notice>
      ) : null}

      {/* ---------------------------------------------------- the manifest */}
      <section
        aria-labelledby="isi-berkas"
        className="flex max-w-[72rem] flex-col gap-5"
      >
        <div className="flex flex-col gap-3">
          {/* The preamble describes the manifest's SHAPE, which is the same on
              every order. The counts under it describe THIS order, so they
              stay: three lines of figures, no line of prose. */}
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="lt-title" id="isi-berkas">
              Yang akan masuk ke kedua berkas ini
            </h3>
            <Hint label="Isi daftar ini">
              Seluruh bagian dokumen validasi, berurutan seperti di dokumennya,
              termasuk yang sudah beres. Setiap potongan yang akan dicetak
              ditampilkan gambarnya di sini.
            </Hint>
          </div>

          {/* Slots and captures are counted in separate sentences, never
              folded into one figure. "12 potongan" over a bagian that needs
              two and ships one is exactly how the half-filled slot hides. */}
          <div className="flex flex-col gap-1 text-[0.9375rem]">
            <p>
              Dari <span className="lt-figure">{tally.fillableSlots}</span>{" "}
              bagian yang bisa didukung dokumen:{" "}
              <span className="lt-figure">{tally.slotsComplete}</span> lengkap,{" "}
              <span className="lt-figure">{tally.slotsPartial}</span> sebagian,{" "}
              <span className="lt-figure">{tally.slotsBlank}</span> kosong.
            </p>
            <p>
              <span className="lt-figure">{tally.capturesShipping}</span> dari{" "}
              <span className="lt-figure">{tally.capturesRequired}</span>{" "}
              potongan akan dicetak di dokumen validasi.
            </p>
            {tally.capturesExtra > 0 ? (
              <p>
                <span className="lt-figure">{tally.capturesExtra}</span>{" "}
                potongan lagi berada di bagian yang biasanya Anda isi sendiri
                dari EPIC, dan ikut dicetak.
              </p>
            ) : null}
          </div>
        </div>

        {plan.sections.map((section) => {
          // A non-fillable slot that somehow holds a confirmed capture DOES
          // reach the docx, so it gets the full block: every picture in the
          // deliverable is a picture on this screen. Everything else in that
          // group is a cell the operator pastes into, and one ruled line each
          // is the whole of what there is to say about it.
          const shown = section.slots.filter(
            (slot) => slot.fillable || slot.ships > 0,
          );
          const manual = section.slots.filter(
            (slot) => !slot.fillable && slot.ships === 0,
          );
          return (
            <div key={section.title} className="flex flex-col gap-1">
              <h4
                className="lt-figure border-b pb-1 text-[0.9375rem] font-bold"
                style={{ borderColor: "var(--line-strong)" }}
              >
                {section.title}
              </h4>

              {section.slots.length === 0 ? (
                <p
                  className="py-2 text-[0.8125rem]"
                  style={{ color: "var(--ink-2)" }}
                >
                  Bagian ini terbit dengan judulnya saja. Anda isi sendiri
                  setelah ekspor.
                </p>
              ) : null}

              {shown.map((slot) => (
                <SlotBlock
                  key={slot.key}
                  run={run}
                  slot={slot}
                  quote={header.quote}
                  thumbs={thumbs}
                />
              ))}

              {manual.length > 0 ? (
                <ul className="flex flex-col">
                  {manual.map((slot) => (
                    <li
                      key={slot.key}
                      className="flex flex-wrap items-baseline justify-between gap-3 border-t py-1.5"
                      style={{ borderColor: "var(--line)" }}
                    >
                      <span className="lt-figure text-[0.8125rem]">
                        {displayLabel(slot.label, header.quote || "(belum diisi)")}
                      </span>
                      <span className="lt-label">
                        Anda isi sendiri setelah ekspor
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </section>

      {/* ---------------------------------------------------- the workbook */}
      <section
        aria-labelledby="buku-kerja"
        className="flex max-w-[72rem] flex-col gap-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="lt-title" id="buku-kerja">
            Buku kerja EPIC
          </h3>
          {/* The row count is a constant of the template rather than a fact
              about this order, and the ready-to-export verdict in the action
              bar prints it again where it decides something. */}
          <Hint label="Isi buku kerja">
            Isinya sama pada setiap pekerjaan:{" "}
            <span className="lt-figure">{AO_TEMPLATE.xlsxRows.length}</span>{" "}
            baris, dan kolom E dikosongkan supaya Anda isi di EPIC.
          </Hint>
        </div>
        {/* The first sentence is what the operator opens the file and finds,
            so it stays on screen. The argument for why an empty cell is the
            honest output reads the same on every order. */}
        <Notice tone="warn">
          <div className="flex flex-wrap items-center gap-2">
            <span>Kolom E terbit kosong di seluruh baris.</span>
            <Hint label="Kenapa kolom E kosong">
              Pekerjaan di peramban ini menyimpan halaman dan area, bukan nilai
              teks, jadi tidak ada nilai yang bisa diisikan di sini. Sel kosong
              adalah keluaran yang jujur; nilai tebakan adalah kegagalan yang
              dicegah alat ini.
            </Hint>
          </div>
        </Notice>
      </section>

      {/* ------------------------------------------------- the header table */}
      <section
        aria-labelledby="tabel-kepala"
        className="flex max-w-[72rem] flex-col gap-4"
      >
        {/* Fifty-six words that never change, over six fields that each say
            their own provenance one line under themselves. Those per-field
            lines name the FILE a value was read out of, so they vary by run,
            and not one of them moved. */}
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="lt-title" id="tabel-kepala">
            Tabel kepala dokumen
          </h3>
          <Hint label="Isi tabel kepala">
            Enam isian di kepala dokumen validasi. Dua di antaranya, ID EPIC dan
            Quote, dibaca dari nama berkas sumber bila namanya memuatnya, dan
            keduanya tebakan yang perlu Anda periksa. Empat sisanya Anda isi
            sendiri: pekerjaan di peramban ini menyimpan halaman dan area, bukan
            nilai teks, jadi tidak ada satu pun nilai yang bisa diambil dari isi
            dokumen.
          </Hint>
        </div>

        <div className="lt-panel grid gap-4 p-5 sm:grid-cols-2">
          <Field
            id="header-id-epic"
            label="ID EPIC"
            value={header.idEpic}
            onChange={(value) => set({ idEpic: value })}
            derived={derived.idEpic}
            derivedFrom={derived.idEpicFrom}
            note={
              derived.idEpic
                ? undefined
                : "Nama berkas sumber tidak memuat nomor LOP, jadi isian ini Anda ketik sendiri."
            }
          />
          <Field
            id="header-nama-proyek"
            label="Nama Proyek"
            value={header.namaProyek}
            onChange={(value) => set({ namaProyek: value })}
            note="Tidak pernah diisi otomatis: pembacaan otomatis berulang kali menjawab dengan judul perjanjian induk, bukan nama proyek order ini, dan jawaban itu lolos pemeriksaan sumber."
          />
          <Field
            id="header-quote"
            label="Quote"
            value={header.quote}
            onChange={(value) => set({ quote: value })}
            derived={derived.quote}
            derivedFrom={derived.quoteFrom}
            note={
              derived.quote
                ? undefined
                : "Nama berkas sumber tidak memuat nomor quote, jadi isian ini Anda ketik sendiri."
            }
          />
          <Field
            id="header-cc"
            label="CC"
            value={header.cc}
            onChange={(value) => set({ cc: value })}
            note="Nama pelanggan pada order ini, Anda ketik sendiri: pembacaan otomatis pernah mengambilnya dari baris Cc: sebuah email, dan nama yang salah itu ikut tercetak di kedua berkas."
          />
          <Field
            id="header-order"
            label="Order"
            value={header.order}
            onChange={(value) => set({ order: value })}
            note="Anda ketik sendiri bila ada. Boleh dibiarkan kosong."
          />
          <Field
            id="header-jenis-order"
            label="Jenis Order"
            value={header.jenisOrder}
            onChange={(value) => set({ jenisOrder: value })}
            derived={jenis.value}
            originMarker={JENIS_MARKER[jenis.origin]}
            derivedMarker={JENIS_MARKER[jenis.origin]}
            derivedLabel="Dokumen"
            derivedNote={<JenisNote jenis={jenis} />}
            list="jenis-order"
            /* Reached when the resolver answered "". Which of the three
               silences it is decides where the operator goes next: `conflict`
               sends them to two pages to choose between, `inferred` to one
               page to read, and `none` nowhere, because nothing is printed. */
            note={<JenisNote jenis={jenis} explainCodes />}
          />
          {/* A datalist, not a select: AO, MO and DO are the ones met so far
              and more exist, so a closed list would lock the operator out of a
              real jenis order.

              IT MUST STAY ONE once `resolveJenisOrder` starts filling this in.
              That inference is anchored on the printed LABEL rather than on a
              list of known codes, precisely so it can answer with an order type
              nobody here has seen; validating its answer against a set would
              silently drop the real ones, which is the wrong-and-quiet
              direction. Suggest, never constrain. */}
          <datalist id="jenis-order">
            <option value="AO" />
            <option value="MO" />
            <option value="DO" />
          </datalist>
        </div>

        {namesAreFallback(header) ? (
          <Notice tone="warn">
            ID EPIC dan Quote masih kosong, jadi nama kedua berkas memakai nomor
            pekerjaan ini. Isi ID EPIC supaya berkasnya bisa Anda arsipkan.
          </Notice>
        ) : null}
      </section>

      {/* THE SPACE THE ACTION BAR OCCUPIES, RESERVED IN THE FLOW.
          The bar below is `position: sticky`, which keeps it in the flow and
          pulls it up to the viewport's bottom edge for as long as its own
          place is below that edge. While it is pulled up it is an OPAQUE
          overlay across the bottom of the page, and the bar releases only in
          the last 56px of the scroll: `main`'s 24px of bottom padding plus the
          32px gap above the bar, and nothing else. Measured in a browser at
          1366x768 with a 260px bar, that left the last section of this screen
          clear of it over 88px of an 1144px scroll and underneath it
          everywhere else, which one wheel notch skips straight past.
          Reserving the bar's own measured height here gives the manifest
          somewhere to be scrolled clear to. It is a sibling and not padding on
          a wrapper around the bar, because a wrapper would become the bar's
          containing block and a sticky box cannot leave that: the bar would
          stop sticking altogether. */}
      <div aria-hidden="true" style={{ height: barHeight }} />

      {/* ------------------------------------------------ the action bar
          Sticky at the bottom, so the verdict, the blocking items, the two
          file names and the build button are in one viewport at 1366x768. The
          reason a control is disabled is never off screen from the control. */}
      <div
        ref={barRef}
        className="lt-rail sticky bottom-0 z-10 -mx-5 flex flex-col gap-3 border-t px-5 py-3"
        style={{ borderColor: "var(--line-strong)" }}
      >
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {blocked ? (
            <>
              <p className="text-[0.9375rem] font-semibold">
                Belum bisa diekspor.
              </p>
              <ul className="flex flex-col gap-1">
                {byKind.proposed.length > 0 ? (
                  <li className="text-[0.875rem]">
                    <span className="lt-figure">{byKind.proposed.length}</span>{" "}
                    usulan masih menunggu keputusan Anda.
                  </li>
                ) : null}
                {byKind.pending.length > 0 ? (
                  <li className="text-[0.875rem]">
                    <span className="lt-figure">{byKind.pending.length}</span>{" "}
                    potongan belum dicari, jadi belum ada yang Anda putuskan.
                  </li>
                ) : null}
                {byKind.lost.length > 0 ? (
                  <li className="text-[0.875rem]" style={{ color: "var(--gap)" }}>
                    <span className="lt-figure">{byKind.lost.length}</span>{" "}
                    potongan yang sudah Anda terima menunjuk halaman yang tidak
                    ada lagi.
                  </li>
                ) : null}
                {faults.length > 0 ? (
                  <li className="text-[0.875rem]" style={{ color: "var(--gap)" }}>
                    <span className="lt-figure">{faults.length}</span> potongan
                    tidak bisa diambil dari halamannya.
                  </li>
                ) : null}
              </ul>
              {blockedNames.length > 0 ? (
                <p className="lt-figure max-w-[74ch] text-[0.8125rem]">
                  {blockedNames.slice(0, 6).join(", ")}
                  {blockedNames.length > 6
                    ? `, dan ${blockedNames.length - 6} lagi di daftar di atas`
                    : ""}
                </p>
              ) : null}
              {byKind.proposed.length > 0 ? (
                <p
                  className="max-w-[74ch] text-[0.8125rem]"
                  style={{ color: "var(--ink-2)" }}
                >
                  Tidak ada berkas yang dibuat sebelum setiap area diperiksa,
                  karena potongan yang belum diperiksa di dalam dokumen yang
                  ditandatangani adalah persis kegagalan yang dicegah langkah
                  ini.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-[0.9375rem] font-semibold">Siap diekspor.</p>
              <p className="text-[0.875rem]">
                <span className="lt-figure">{tally.slotsComplete}</span> dari{" "}
                <span className="lt-figure">{tally.fillableSlots}</span> bagian
                membawa bukti, dan{" "}
                <span className="lt-figure">{tally.capturesShipping}</span>{" "}
                potongan akan dicetak di dokumen validasi.
                {tally.slotsBlank > 0 ? (
                  <>
                    {" "}
                    <span className="lt-figure">{tally.slotsBlank}</span> bagian
                    terbit kosong atas keputusan Anda.
                  </>
                ) : null}{" "}
                Buku kerja terbit dengan{" "}
                <span className="lt-figure">{AO_TEMPLATE.xlsxRows.length}</span>{" "}
                baris dan kolom E kosong.
              </p>
            </>
          )}
        </div>

        {blocked ? (
          <div>
            <Btn onClick={onGoToSheet}>Kembali ke lembar periksa</Btn>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--line)" }}>
          {state.kind === "built" ? (
            <ul className="flex flex-col gap-2">
              <SaveRow
                icon={<Paket className="shrink-0" />}
                name={state.names.docx}
                size={fileSize(state.docx)}
                disabled={stale}
                done={handedOver.docx}
                onSave={() => {
                  downloadBytes(state.names.docx, state.docx, DOCX_TYPE);
                  setHandedOver((prev) => ({ ...prev, docx: true }));
                }}
              />
              <SaveRow
                icon={<BukuKerja className="shrink-0" />}
                name={state.names.xlsx}
                size={fileSize(state.xlsx)}
                disabled={stale}
                done={handedOver.xlsx}
                onSave={() => {
                  downloadBytes(state.names.xlsx, state.xlsx, XLSX_TYPE);
                  setHandedOver((prev) => ({ ...prev, xlsx: true }));
                }}
              />
            </ul>
          ) : (
            /* Two rows, two DIFFERENT marks. The packet and the workbook are
               not one homogeneous list, and which of the two a name belongs to
               is read faster from the shape than from an extension at the end
               of a break-all string. */
            <ul className="flex flex-col gap-0.5">
              <li className="flex items-center gap-2">
                <Paket className="shrink-0" />
                <span className="lt-figure text-[0.8125rem] break-all">
                  {names.docx}
                </span>
              </li>
              <li className="flex items-center gap-2">
                <BukuKerja className="shrink-0" />
                <span className="lt-figure text-[0.8125rem] break-all">
                  {names.xlsx}
                </span>
              </li>
            </ul>
          )}

          {/* The failure belongs HERE, beside the button that caused it. At
              the top of a page this tall it would be off screen at the moment
              it appears, which is the same defect as a block whose reason the
              operator has to scroll to find. */}
          {state.kind === "failed" ? (
            <Interruption detail={state.message}>
              Kedua berkas gagal dibuat, jadi tidak ada berkas yang ditulis.
              Perbaiki penyebabnya lalu buat lagi.
            </Interruption>
          ) : null}

          {stale ? (
            <Notice tone="warn">
              Isi halaman ini berubah setelah kedua berkas dibuat, jadi berkas
              yang tersimpan tidak lagi sama dengan yang tertulis di sini. Buat
              ulang sebelum menyimpannya.
            </Notice>
          ) : null}

          {handedOver.docx || handedOver.xlsx ? (
            <p className="text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
              Berkas yang sudah Anda tekan diserahkan ke peramban ini. Jika
              tidak muncul di folder unduhan, izinkan unduhan lalu tekan lagi.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Btn
              tone="primary"
              disabled={blocked || state.kind === "working"}
              onClick={() => void write()}
            >
              {state.kind === "built" ? "Buat ulang" : "Buat kedua berkas"}
            </Btn>

            {/* NOT a consent statement, which is why it may hide. A sentence
                said at the moment data leaves the device stays on screen
                however invariant it is; this is the opposite, a promise that
                nothing leaves, made by a button that uploads nothing. The
                consent that is owed is made on Muat, where the page images
                actually go out. Two lines inside a bar that reserves its own
                measured height cost the manifest four. */}
            <Hint label="Ke mana kedua berkas ditulis">
              Kedua berkas ditulis di peramban ini. Tidak ada berkas PDF yang
              diunggah untuk membuatnya.
            </Hint>

            {state.kind === "working" ? (
              <div className="flex items-center gap-3">
                {/* Countable, never a percentage: this step only ever learns
                    about whole crops. It also lives OUTSIDE the button, so the
                    primary control does not change width while it cannot be
                    pressed. */}
                {state.total > 0 ? (
                  <>
                    <div className="lt-well flex h-2 w-40 overflow-hidden">
                      {Array.from({ length: state.total }, (_, i) => (
                        <span
                          key={i}
                          className="lt-tick"
                          data-done={i < state.done ? "true" : undefined}
                          style={{ width: `${100 / state.total}%` }}
                        />
                      ))}
                    </div>
                    <span className="text-[0.8125rem]">
                      Memotong{" "}
                      <span className="lt-figure">
                        {state.done} dari {state.total}
                      </span>{" "}
                      potongan.
                    </span>
                  </>
                ) : (
                  <span className="text-[0.8125rem]">
                    Menulis kedua berkas tanpa potongan.
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One file, on its own row.
 *
 * A row per file, stacked, so a narrow laptop never separates a Simpan button
 * from the name of the file it saves. `downloadBytes` cannot report failure,
 * so the row records what is actually true: the file was handed to the
 * browser. An operator who saw nothing arrive gets told what to do about it.
 */
function SaveRow({
  icon,
  name,
  size,
  disabled,
  done,
  onSave,
}: {
  /**
   * The packet's mark or the workbook's, never the same one twice. It labels
   * the ROW, which is the file; the button beside it keeps its plain word.
   */
  icon: ReactNode;
  name: string;
  size: string;
  disabled: boolean;
  done: boolean;
  onSave: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {icon}
        <span className="lt-figure min-w-0 text-[0.8125rem] break-all">
          {name}
        </span>
      </span>
      <span className="lt-figure text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
        {size}
      </span>
      {done ? <span className="lt-label">sudah diserahkan</span> : null}
      <Btn onClick={onSave} disabled={disabled} title={`Simpan ${name}`}>
        Simpan {shortenFileName(name, 26)}
      </Btn>
    </li>
  );
}
