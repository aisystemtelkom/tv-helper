"use client";

/**
 * Screen 3 of three (Muat, Periksa, Berkas): write the two deliverables.
 *
 * THE TWO FILES ARE THE OBJECT ON THIS SCREEN. Everything here exists to
 * produce one docx and one xlsx, so they are drawn as two slabs carrying their
 * own mark, their own name in a ruled box and their own Simpan control, and
 * every other block on the screen is quieter than they are. The screen used to
 * distribute emphasis evenly over a manifest, a workbook section, a header
 * table and an action bar, which is what makes a screen read as a form rather
 * than as a thing that makes something.
 *
 * THE MANIFEST IS AN INVENTORY, NOT AN EXCEPTION REPORT. This screen used to
 * summarise the entire visual content of the packet as one integer ("12
 * confirmed crops") and then list only the exceptions. A count cannot be
 * checked against anything, and an exception list cannot be read side by side
 * with the document a validator is about to sign. So every fillable slot is
 * still listed, in template order, every time, including the ones that are
 * fine, and every confirmed capture still CARRIES ITS PICTURE at a size where
 * a wrong page is recognisable.
 *
 * WHAT CHANGED IS THAT THE INVENTORY IS CLOSED AT REST, and the reasoning is
 * worth writing down because the two rules pull against each other. A
 * pre-flight summary of what will ship is reference material: the operator
 * ruled on every one of these crops on the review sheet, and re-reading a metre
 * of them is not what makes the packet right. What is NOT reference material is
 * a fault, so a thumbnail that could not be cut, or a capture whose page has
 * gone, OPENS the list and is named in the action bar as well. A collapsed
 * block still reports its state, because its kop is the status channel: the
 * whole bar takes the correction pen's tint and a 4px rule down its leading
 * edge, which reads at a glance down a column of blocks without ever becoming
 * a bar of saturated red under light text.
 *
 * EVERY NUMBER SAYS WHETHER IT COUNTS SLOTS OR CAPTURES. `bagian` and
 * `potongan` are different units and the sample's ToP row holds two potongan
 * in one bagian. Folding them into one figure is how a half-filled slot has
 * already shipped wrong twice. Each figure is also printed in exactly one
 * place: the docx slab counts potongan, the inventory's kop counts bagian, and
 * the action bar's verdict counts bagian carrying evidence.
 *
 * THE BLOCK IS ATTACHED TO THE CONTROL IT DISABLES. The verdict, the blocking
 * items by their operator-facing label, the remedy and the build button live
 * together in one sticky bar, because at 1366x768 the old layout put the reason
 * at the top of a page taller than the viewport and the disabled button at the
 * bottom of it. A disabled control whose explanation is off screen reads as a
 * broken app. The two file slabs sit DIRECTLY above that bar, so the build
 * button and the two Simpan buttons it enables are in one viewport too.
 *
 * THAT BAR IS AN OVERLAY, SO IT PAYS FOR ITS OWN SPACE. `position: sticky`
 * keeps the bar in the flow and pulls it up to the viewport's bottom edge for
 * as long as its own place in the flow is below that edge, so it covers the
 * bottom of everything above it until the scroll reaches the very end. The
 * slack that released it was the page's own bottom padding plus the gap above
 * the bar, which is less than one wheel notch, so the section sitting directly
 * above it was underneath it in practice. The flow now reserves the bar's
 * MEASURED height above it (`useBarHeight`), so the last row of the page can
 * always be scrolled clear.
 *
 * WHAT IS FILLED IN AUTOMATICALLY IS EXACTLY WHAT THE APP CAN READ, WHICH IS
 * THE SOURCE FILE NAMES. `deriveIdsFromFilenames` gets ID EPIC and Quote out
 * of them, and each one says so beside the field and names the file it came
 * from, because a value the operator is meant to CHECK must not look like a
 * value somebody typed. Nothing else is guessed, and the fields nobody fills
 * in automatically say why. There is no values path in this browser to guess
 * with: `/api/propose` answers with zones, a page and a line range, never with
 * text, and a `BrowserRun` carries pages and zones only. Two of them are
 * recorded failures on top of that: `namaProyek` answered with the master
 * contract's scope title, with a citation that PASSED validation, and `cc`
 * matched a printed email's own "Cc:" header and put a wrong customer name
 * into both deliverables.
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
 * lede, the manifest's preamble, the header table's fifty-six word lede, the
 * three fields' recorded-failure paragraphs, the workbook's row count and the
 * workbook's argument for the empty column.
 *
 * IT DID NOT TAKE THE BLOCK, and that is the half worth defending. The
 * paragraph explaining why nothing is built before every area is checked never
 * changes either, and it stays on screen because it is exactly why the build
 * button will not fire: a disabled control whose reason is behind a hover is
 * the same defect as one whose reason is off screen. "Siap diekspor" stays for
 * the same reason in the other direction, because an absent warning is not a
 * confirmation. Nor did it take one word of the header fields' provenance,
 * which names the file a value was read out of and is what stops a guess
 * looking like a typed value, nor any per-crop advisory, each of which is a
 * measurement of one rectangle on one page, nor the download-may-not-have-
 * arrived remedy, which is an interruption wearing a calm voice.
 *
 * THE ON-DEVICE LINE STAYS ON SCREEN, AND THE ARGUMENT THAT HID IT WAS WRONG.
 * That argument ran: a sentence said at the moment data leaves the device has
 * to stay visible, and this one is its opposite, a promise that nothing
 * leaves, so it may go behind a question mark. The two sentences really are
 * different, and the conclusion still does not follow. A privacy statement is
 * exempt from the disclosure rule in BOTH directions, because an operator
 * cannot tell a promise nobody made from one they did not hover over, and an
 * unread promise is worth nothing. What the cost of a line here (every line in
 * the sticky bar is subtracted from the page's viewport twice, once as the bar
 * and once as the space `useBarHeight` reserves for it) buys is a SHORTER
 * sentence, which is what it now is: one line, beside the button it belongs
 * to.
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
  PlannedSection,
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
import { captureLabel, progressOf } from "@/lib/ui/slots";

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

/* ------------------------------------------------------------- the slab */

/** What a kop is allowed to report. Three values, and the absence of one. */
type Owes = "decision" | "fault" | "done";

/**
 * The one container on this screen: a solid block opened by a kop.
 *
 * THE KOP IS THE BLOCK'S STATUS CHANNEL, which is what lets a block be closed
 * at rest without hiding its state. `owes` is carried by the whole bar rather
 * than by a small mark somewhere inside it, so a block that owes something is
 * legible from across the room and a collapsed one is no quieter about a fault
 * than an open one.
 *
 * WHAT THE BAR IS MADE OF IS THE STYLESHEET'S BUSINESS AND IT CHANGED: it used
 * to be a full-width fill of solid hue, and it is now a 12% tint of the block's
 * own ground with a 4px rule down its leading edge. The rule is the loudest of
 * the channels and the one that reads down a column of stacked blocks, which is
 * what this screen is. Nothing here had to change for that, which is the point
 * of the status living on `data-owes` rather than in a colour chosen here.
 */
function Slab({
  id,
  name,
  aside,
  owes,
  flat = false,
  children,
}: {
  id?: string;
  name: ReactNode;
  /** The count or state this block owes, at the kop's right edge. */
  aside?: ReactNode;
  owes?: Owes;
  /**
   * A slab nested inside another slab is furniture rather than content, so it
   * takes `.lt-slab-flat` and is SET IN: darker than the block holding it,
   * with the shallow inner shadow that says so. The old wording here, "casts
   * no plate", named a hard offset shadow that this system does not have
   * anywhere; the distinction it was drawing is real and is now lifted
   * against set-in rather than shadow against no shadow.
   */
  flat?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={flat ? "lt-slab-flat" : "lt-slab"} aria-labelledby={id}>
      <h3 className="lt-kop" id={id} data-owes={owes}>
        <span className="min-w-0">{name}</span>
        {/* `.lt-kop-right` rather than a hand-rolled `ml-auto`: one class puts
            the count in the same place in every kop in the product. */}
        {aside ? <span className="lt-kop-right shrink-0">{aside}</span> : null}
      </h3>
      <div className="lt-slab-body">{children}</div>
    </section>
  );
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
      return "Dicetak di dokumen validasi.";
    case "proposed":
      return "Menunggu keputusan Anda, jadi belum dicetak.";
    case "pending":
      return "Belum ada yang mencari bukti untuk potongan ini.";
    case "outstanding":
      return "Sudah dicari, buktinya tidak ada. Sel ini terbit kosong.";
    case "unfilled":
      // One of the sentences docs/ui-bahasa.md fixes word for word.
      return "Dikosongkan atas keputusan Anda, bukan karena terlewat.";
    case "lost":
      return capture.lostPageIndex === null
        ? "Anda terima, tetapi tidak ada area yang tersimpan, jadi tidak ada yang bisa dicetak."
        : "Bukti yang Anda terima menunjuk halaman yang sudah tidak ada di pekerjaan ini.";
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
 * is shortest when the export is ready and taller when it is blocked (a
 * verdict, up to four counted reasons, the blocking items by name and the
 * remedy). A constant here would be right in one of those states and wrong in
 * the rest, and wrong means the bottom of the page is under the bar again.
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

/* ---------------------------------------------------------- the two files */

/**
 * One deliverable, as a plate with its own mark, its own name and its own
 * Simpan control.
 *
 * A slab per file, never one list of two rows: the packet and the workbook are
 * not a homogeneous list, and which of the two a name belongs to is read from
 * the mark rather than from an extension at the end of a break-all string.
 * `downloadBytes` cannot report failure, so `done` records what is actually
 * true, that the file was handed to the browser.
 *
 * THE REASON THE BUTTON IS DISABLED IS ON SCREEN, never in a tooltip: `reason`
 * is rendered under the control it refers to, in full, at every width.
 */
function FileSlab({
  id,
  kind,
  icon,
  name,
  size,
  disabled,
  done,
  reason,
  onSave,
  children,
}: {
  id: string;
  /** What this file is, as the kop says it. */
  kind: string;
  /**
   * The packet's mark or the workbook's, never the same one twice. It labels
   * the FILE; the button beside it keeps its plain word.
   */
  icon: ReactNode;
  name: string;
  /** Set once the bytes exist. */
  size: string | null;
  disabled: boolean;
  done: boolean;
  /** Why Simpan will not fire, when it will not. */
  reason: string | null;
  onSave: () => void;
  children?: ReactNode;
}) {
  const state = done
    ? "sudah diserahkan"
    : size
      ? "siap disimpan"
      : "belum dibuat";

  return (
    /* NO `owes`, AND THAT IS THE POINT. `data-owes="done"` tints the kop
       petrol, and the design's promise is that a finished packet is a screen
       with the colour gone out of it: two petrol bars sitting side by side at
       the foot of the last screen would be the loudest thing on it. A built
       file is also not "done": it is ready to be saved, which the state word
       at the kop's right says in words. */
    <Slab id={id} name={kind} aside={state}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <span className="shrink-0 text-ink-2">{icon}</span>
          <span className="lt-kotak min-w-0 grow whitespace-normal">
            <span className="break-all">{name}</span>
          </span>
        </div>

        {children}

        <div className="flex flex-wrap items-center gap-4">
          {/* One word on screen, the whole name to a screen reader. The file
              name is in the ruled box directly above, so printing it on the
              button too says it twice; a reader tabbing between two buttons
              both called "Simpan" would have nothing to tell them apart, so
              the full label survives in `aria-label`. */}
          <Btn
            onClick={onSave}
            disabled={disabled}
            aria-label={`Simpan ${name}`}
            title={`Simpan ${name}`}
          >
            Simpan
          </Btn>
          {size ? <span className="lt-kotak">{size}</span> : null}
        </div>

        {reason ? (
          <p className="text-[0.8125rem] text-ink-2">{reason}</p>
        ) : null}
      </div>
    </Slab>
  );
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
  flag: "Ditentukan saat aplikasi dijalankan, bukan dari dokumen.",
  env: "Ditentukan saat aplikasi dijalankan, bukan dari dokumen.",
  "order-request": "Diambil dari isian Jenis Order di permintaan order.",
  documents: "Terbaca dari label Jenis Order di dokumen. Periksa dulu.",
  inferred:
    "Ada label Jenis Order, isinya tidak bisa dipastikan. Buka halamannya, baca sendiri, lalu isi di sini.",
  conflict:
    "Dokumen menyebut jenis order yang berbeda-beda. Anda yang menentukan.",
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
 * exception does everywhere else in this app. The codes themselves read the
 * same on every order, so they hide behind a mark.
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
      {explainCodes ? (
        <>
          {" "}
          <Hint label="Arti kode jenis order">
            AO mengaktifkan layanan, MO mengubah, DO menghapus, dan jenis lain
            juga ada.
          </Hint>
        </>
      ) : null}
      <TechnicalDetail>{jenis.detail}</TechnicalDetail>
    </>
  );
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
 *
 * `hint` is where a field's standing explanation goes. Two of these fields are
 * blank because an automatic reading of them shipped a wrong value into a
 * signed document, which is worth a paragraph, and that paragraph reads word
 * for word the same on every order.
 */
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
  hint,
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
  /** Why this field is not filled in automatically, when that varies by run. */
  note?: ReactNode;
  /** The standing explanation, which reads the same on every order. */
  hint?: ReactNode;
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
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* The six names are the document's own field names, so they are set
            in the mono face. They are not shouted in caps to give them rank:
            uppercase here would be the interface labelling, not the paper
            speaking. */}
        <label className="lt-label lt-figure" htmlFor={id}>
          {label}
        </label>
        {/* Amber, and only for a value the app guessed: a decision is owed
            on it. `text-mark` sits in the utilities layer, so it wins over
            `.lt-label`'s own colour without either one being restated. */}
        <span className={fromFile ? "lt-label text-mark" : "lt-label"}>
          {marker}
        </span>
        {hint ? <Hint label={`Tentang ${label}`}>{hint}</Hint> : null}
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
        <div className="text-[0.8125rem] text-ink-2">
          {derivedNote ?? (derivedFrom ? (
            <>
              Terbaca di{" "}
              <span className="lt-figure" title={derivedFrom}>
                {shortenFileName(derivedFrom, 30)}
              </span>
              . Periksa dulu.
            </>
          ) : (
            <>Terbaca di nama berkas sumber. Periksa dulu.</>
          ))}
        </div>
      ) : changed ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[0.8125rem] text-ink-2">
            {derivedLabel} memberi <span className="lt-figure">{derived}</span>.
          </p>
          <Btn onClick={() => onChange(derived)}>Pakai lagi</Btn>
        </div>
      ) : note ? (
        <div className="text-[0.8125rem] text-ink-2">
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
          /* EVIDENCE IS MOUNTED, NEVER PLACED: a sunk stage, a near-black mat
             and the sheet's own edge, three drawn cues for the one boundary
             the operator is paid to judge. A scan's own white ground against a
             single luminance step is exactly the cue that fails on a dark
             scan.

             THE EDGE IS `.lt-paper`'S, NOT A HAND-ROLLED RULE. This drew a 2px
             `--keyline` border on the image itself, which is the third hard
             rule inside a mat that already draws its own bone ring: the two
             competed for the boundary that matters, and a 2px border is the
             stamped-plate gesture the client rejected. The sheet class carries
             it now, at the weight and the corner the system sets for a mounted
             crop -- `--sheet-corner`, near-square on purpose, because 20px of
             rounding would cut about 1250 square pixels off each corner of the
             evidence. Same recipe as the review plate, one class instead of
             two declarations. */
          <figure className="lt-stage max-w-[42rem]">
            <div className="lt-mat">
              <div className="lt-paper overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element -- a blob
                    URL cut in this tab from a document that must never leave
                    it; next/image would want a loader and a remote pattern. */}
                <img
                  className="block h-auto w-full"
                  src={thumb.url}
                  alt={`Potongan untuk ${captureLabel(
                    slot.label,
                    capture.ordinal,
                  )}${cite ? `, halaman ${cite.page} dari ${cite.pagesInDoc}` : ""}`}
                />
              </div>
            </div>
          </figure>
        ) : ships && thumb?.fault ? (
          <div className="lt-well max-w-[42rem] p-4">
            <p className="text-[0.8125rem] text-gap">
              {thumb.fault === "size"
                ? "Ukuran halaman berubah sejak areanya dibuat, jadi potongan ini tidak bisa diambil."
                : "Halaman ini tidak bisa dirender lagi, jadi potongan ini tidak bisa diambil."}
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
            <p className="lt-note p-4">Menyiapkan potongan.</p>
          </div>
        ) : (
          <div className="lt-hatch flex max-w-[42rem] flex-col gap-2 p-4">
            <p className="text-sm text-ink">
              Tidak ada gambar untuk potongan ini.
            </p>
            {/* Safety copy, so it is never set in `--ink-3`: this is the
                sentence that says what the deliverable will be missing. */}
            <p className="text-[0.8125rem] text-ink-2">
              {standingSentence(capture)}
            </p>
            {capture.strandedZone ? (
              <p className="text-[0.8125rem] text-ink-2">
                Areanya tetap tersimpan di pekerjaan, tetapi tidak ikut dicetak.
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {/* Numbered only when this bagian actually holds more than one
            picture. Nothing declares a capture count any more, so there is no
            such thing as "1 dari 2" over a lanjutan nobody has found: the
            figure counts what the run HAS. */}
        {slot.maxOrdinal > 1 ? (
          <p className="flex items-center gap-2">
            <span className="lt-label">potongan</span>
            <span className="lt-kotak">
              {capture.ordinal} / {slot.maxOrdinal}
            </span>
          </p>
        ) : null}

        {/* MOUNTED, not placed, exactly like the crop beside it. The denah is
            a picture of a page and paints its own paper, so on the slab's own
            ground its edge would be a luminance step and nothing else. */}
        {zone && resolved ? (
          <div className="lt-mat w-fit">
            <Denah
              page={resolved.page}
              cut={zone.box}
              size="md"
              label={`Denah halaman ${resolved.pageInDoc + 1} dengan area potongan ${slot.label}`}
            />
          </div>
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
  //
  // "Complete" is every capture the run HOLDS shipping, not every capture a
  // template declared: the count is discovered now, so a bagian with one crop
  // and no lanjutan found is complete as far as anything knows. How much of
  // that "as far as anything knows" was ever tested is the separate figure
  // this screen prints from `Progress.uncheckedForContinuation`.
  const status: SlotAggregateStatus =
    slot.ships > 0 && slot.ships === slot.captures.length
      ? "confirmed"
      : slot.ships > 0
        ? "partial"
        : STANDING_MARK[slot.captures[0]?.standing ?? "pending"];

  const label = displayLabel(slot.label, quote || "(belum diisi)");

  return (
    /* A HAIRLINE, NOT A 2px RULE. `--line` is separation between content and
       nothing else, and the system draws that at one pixel; two was the
       stamped-plate weight, and a dozen of them down the inventory read as a
       stack of parts rather than as one list. */
    <div className="flex flex-col gap-4 border-t border-line py-4">
      <div className="flex flex-wrap items-center gap-4">
        <Mark status={status} title={`${label}: ${STATUS_WORDS[status]}`} />
        {/* THE RANK IS WEIGHT, NOT AN OFF-RAMP SIZE. This carried `text-base`,
            16px, which is not a step this system has: the sans runs 13, 14, 15
            and then jumps to a title at 21. A bagian's name is the body size at
            700 against the 400 around it, which is the same move `.lt-btn` and
            `.lt-kop` make and one every sibling screen already makes at 13 and
            14px. */}
        <span className="lt-figure font-bold">{label}</span>
        <StateWord status={status} />
        {slot.captures.length > 1 ? (
          <span className="lt-kotak ml-auto">
            {slot.ships} / {slot.captures.length} potongan
          </span>
        ) : null}
      </div>

      {slot.captures.length === 0 ? (
        <div className="lt-hatch flex flex-col gap-2 p-4">
          <p className="text-sm text-ink">
            Tidak ada gambar untuk bagian ini.
          </p>
          <p className="text-[0.8125rem] text-ink-2">
            Belum pernah ada yang tercatat di sini.
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

/**
 * One section of the packet, as a flat slab inside the inventory.
 *
 * The section titles are the document's own words (`KB (lanjutan)`, `BA
 * Permintaan`), quoted rather than translated, so they carry the kop and
 * nothing annotates them with an icon.
 */
function SectionBlock({
  run,
  section,
  quote,
  thumbs,
}: {
  run: BrowserRun;
  section: PlannedSection;
  quote: string;
  thumbs: Record<string, Thumb>;
}) {
  // A non-fillable slot that somehow holds a confirmed capture DOES reach the
  // docx, so it gets the full block: every picture in the deliverable is a
  // picture on this screen. Everything else in that group is a cell the
  // operator pastes into, and one ruled line each is the whole of what there
  // is to say about it.
  const shown = section.slots.filter((slot) => slot.fillable || slot.ships > 0);
  const manual = section.slots.filter(
    (slot) => !slot.fillable && slot.ships === 0,
  );
  const held = shown.reduce((n, slot) => n + slot.captures.length, 0);
  const ships = shown.reduce((n, slot) => n + slot.ships, 0);

  return (
    <Slab
      flat
      name={section.title}
      aside={
        section.slots.length === 0
          ? "judul saja"
          : held > 0
            ? `${ships} / ${held} potongan`
            : "diisi sendiri"
      }
    >
      <div className="flex flex-col">
        {section.slots.length === 0 ? (
          <p className="text-[0.8125rem] text-ink-2">
            Terbit dengan judulnya saja. Anda isi sendiri.
          </p>
        ) : null}

        {shown.map((slot) => (
          <SlotBlock
            key={slot.key}
            run={run}
            slot={slot}
            quote={quote}
            thumbs={thumbs}
          />
        ))}

        {manual.length > 0 ? (
          <ul className="flex flex-col">
            {manual.map((slot) => (
              <li
                key={slot.key}
                className="flex flex-wrap items-baseline justify-between gap-4 border-t border-line py-2"
              >
                <span className="lt-figure text-[0.8125rem]">
                  {displayLabel(slot.label, quote || "(belum diisi)")}
                </span>
                <span className="lt-label">Anda isi sendiri</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Slab>
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
  /**
   * How much of "lengkap" was ever tested.
   *
   * THE HONEST HALF OF DROPPING THE DECLARED CAPTURE COUNT. The old form
   * asserted a second potongan existed and reported "1 dari 2" for ever; a
   * discovered one can do the opposite and silently MISS a lanjutan that is
   * really there, and this screen is the last place anybody looks before a
   * validator signs. So a bagian nobody has looked PAST is counted here and
   * said out loud. It does not block -- see `hasUnreviewedProposals` -- because
   * the crops in the packet are ones this operator personally accepted, and a
   * block that fires every time somebody drew an area by hand teaches people
   * that the block means nothing.
   */
  const progress = useMemo(() => progressOf(run, AO_TEMPLATE), [run]);
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
  // Narrowed once, so the two file slabs can be rendered outside the branch
  // that proves the bytes exist.
  const built = state.kind === "built" ? state : null;
  const stale = built !== null && built.stamp !== stamp;

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

  /*
   * THE INVENTORY IS CLOSED AT REST AND A FAULT OPENS IT.
   *
   * Collapsing the pre-flight list is the density win the client asked for,
   * and it is only defensible while nothing that went wrong can be inside it
   * unseen. A crop that could not be cut, or a capture whose page has gone, is
   * named in the action bar, puts the correction pen on this block's kop, AND
   * opens the list.
   *
   * DERIVED, NOT SYNCHRONISED. `openedByHand` is null until the operator
   * touches the disclosure, so the fault decides while nobody has an opinion
   * and the operator decides afterwards. An effect that pushed `open` to true
   * would fight the operator's own click, and a control that reopens itself
   * under the hand is a broken control, not a safety feature: the fault is
   * still stated in full in the action bar either way.
   */
  const faulted = faults.length > 0 || byKind.lost.length > 0;
  const [openedByHand, setOpenedByHand] = useState<boolean | null>(null);
  const detailsOpen = openedByHand ?? faulted;

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
    `${item.sectionTitle} / ${captureLabel(item.label, item.ordinal)}`;

  const blockedNames = [
    ...blocking.map(itemName),
    ...faults.map((crop) => captureLabel(crop.label, crop.ordinal)),
  ];

  // Why Simpan will not fire, said under the button rather than in a tooltip.
  const saveReason = stale
    ? "Isinya berubah. Buat ulang dulu."
    : built
      ? null
      : "Belum dibuat.";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-2">
        <Title>Buat berkas hasil</Title>
        <Hint label="Kenapa isinya diperlihatkan dulu">
          Kedua berkas akan terbuka dengan rapi entah buktinya benar atau salah,
          jadi isinya diperlihatkan di sini sebelum ditulis.
        </Hint>
      </header>

      {plan.orphans.length > 0 ? (
        <Slab name="Potongan tanpa tempat" owes="fault">
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              <span className="lt-figure">{plan.orphans.length}</span> potongan
              tidak punya tempat di dokumen ini dan tidak ikut dicetak.
            </p>
            <p className="lt-figure text-[0.8125rem]">
              {plan.orphans.map((orphan) => orphan.label).join(", ")}
            </p>
            <p className="text-[0.8125rem] text-ink-2">
              Bagiannya sudah tidak ada di dokumen validasi. Catat saja sebelum
              berkasnya dipakai.
            </p>
          </div>
        </Slab>
      ) : null}

      {/* ------------------------------------------------- the header table */}
      <Slab
        id="tabel-kepala"
        name="Tabel kepala dokumen"
        aside={namesAreFallback(header) ? "ID EPIC kosong" : undefined}
        owes={namesAreFallback(header) ? "decision" : undefined}
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
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
                  : "Nama berkas tidak memuat nomor LOP. Ketik sendiri."
              }
            />
            <Field
              id="header-nama-proyek"
              label="Nama Proyek"
              value={header.namaProyek}
              onChange={(value) => set({ namaProyek: value })}
              hint="Tidak pernah diisi otomatis. Pembacaan otomatis berulang kali menjawab dengan judul perjanjian induk, bukan nama proyek order ini, dan jawaban itu lolos pemeriksaan sumber."
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
                  : "Nama berkas tidak memuat nomor quote. Ketik sendiri."
              }
            />
            <Field
              id="header-cc"
              label="CC"
              value={header.cc}
              onChange={(value) => set({ cc: value })}
              hint="Nama pelanggan pada order ini. Pembacaan otomatis pernah mengambilnya dari baris Cc: sebuah email, dan nama yang salah itu ikut tercetak di kedua berkas."
            />
            <Field
              id="header-order"
              label="Order"
              value={header.order}
              onChange={(value) => set({ order: value })}
              note="Boleh kosong."
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
                 silences it is decides where the operator goes next:
                 `conflict` sends them to two pages to choose between,
                 `inferred` to one page to read, and `none` nowhere, because
                 nothing is printed. */
              note={<JenisNote jenis={jenis} explainCodes />}
            />
            {/* A datalist, not a select: AO, MO and DO are the ones met so far
                and more exist, so a closed list would lock the operator out of
                a real jenis order.

                IT MUST STAY ONE once `resolveJenisOrder` starts filling this
                in. That inference is anchored on the printed LABEL rather than
                on a list of known codes, precisely so it can answer with an
                order type nobody here has seen; validating its answer against a
                set would silently drop the real ones, which is the
                wrong-and-quiet direction. Suggest, never constrain. */}
            <datalist id="jenis-order">
              <option value="AO" />
              <option value="MO" />
              <option value="DO" />
            </datalist>
          </div>

          {namesAreFallback(header) ? (
            <Notice tone="warn">
              ID EPIC dan Quote kosong, jadi nama berkas memakai nomor pekerjaan
              ini. Isi ID EPIC agar berkasnya bisa diarsipkan.
            </Notice>
          ) : null}
        </div>
      </Slab>

      {/* ---------------------------------------------------- the inventory */}
      <Slab
        id="isi-berkas"
        name="Isi kedua berkas"
        aside={`${tally.slotsComplete} / ${tally.fillableSlots} bagian`}
        owes={faulted ? "fault" : undefined}
      >
        <div className="flex flex-col gap-4">
          {progress.uncheckedForContinuation > 0 ? (
            <Notice>
              <span className="inline-flex flex-wrap items-center gap-2">
                <span>
                  <span className="lt-figure">
                    {progress.uncheckedForContinuation}
                  </span>{" "}
                  bagian belum diperiksa lanjutannya.
                </span>
                <Hint label="Arti belum diperiksa lanjutannya">
                  Potongannya sudah Anda terima, tapi belum ada yang menengok
                  apakah bloknya bersambung ke halaman berikutnya. Jalankan
                  Proses sekali lagi. Bagian yang diambil satu halaman penuh
                  tidak bisa diperiksa begitu, jadi bukalah halaman berikutnya
                  sendiri.
                </Hint>
              </span>
            </Notice>
          ) : null}

          {/* Reference material, so it is closed at rest. What is not
              reference material, a fault, opens it: see `faulted` above. */}
          <details
            className="lt-disclose"
            open={detailsOpen}
            onToggle={(event) => setOpenedByHand(event.currentTarget.open)}
          >
            <summary>Rincian setiap bagian</summary>

            <div className="flex flex-col gap-6 pt-4">
              {/* Slots and captures are counted in separate sentences, never
                  folded into one figure. "12 potongan" over a bagian that
                  needs two and ships one is exactly how the half-filled slot
                  hides. */}
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  <span className="lt-figure">{tally.fillableSlots}</span>{" "}
                  bagian bisa didukung dokumen:{" "}
                  <span className="lt-figure">{tally.slotsComplete}</span>{" "}
                  lengkap, <span className="lt-figure">{tally.slotsPartial}</span>{" "}
                  sebagian, <span className="lt-figure">{tally.slotsBlank}</span>{" "}
                  kosong.
                </p>
                {tally.capturesExtra > 0 ? (
                  <p>
                    <span className="lt-figure">{tally.capturesExtra}</span>{" "}
                    potongan lagi ada di bagian yang Anda isi sendiri, dan ikut
                    dicetak.
                  </p>
                ) : null}
              </div>

              {plan.sections.map((section) => (
                <SectionBlock
                  key={section.title}
                  run={run}
                  section={section}
                  quote={header.quote}
                  thumbs={thumbs}
                />
              ))}
            </div>
          </details>
        </div>
      </Slab>

      {/* ------------------------------------------------------ the two files
          The object this screen is for. They sit directly above the action bar
          so the build button and the two Simpan buttons it enables are in one
          viewport at 1366x768. */}
      <section aria-labelledby="berkas-hasil" className="flex flex-col gap-4">
        <h3 className="sr-only" id="berkas-hasil">
          Berkas hasil
        </h3>

        <div className="grid gap-4 lg:grid-cols-2">
          <FileSlab
            id="berkas-docx"
            kind="Dokumen validasi"
            icon={<Paket size={40} />}
            name={built ? built.names.docx : names.docx}
            size={built ? fileSize(built.docx) : null}
            disabled={!built || stale}
            done={handedOver.docx}
            reason={saveReason}
            onSave={() => {
              if (!built) return;
              downloadBytes(built.names.docx, built.docx, DOCX_TYPE);
              setHandedOver((prev) => ({ ...prev, docx: true }));
            }}
          >
            <p className="text-[0.8125rem] text-ink-2">
              Berisi{" "}
              <span className="lt-figure">{tally.capturesShipping}</span>{" "}
              potongan bukti.
            </p>
          </FileSlab>

          <FileSlab
            id="berkas-xlsx"
            kind="Buku kerja EPIC"
            icon={<BukuKerja size={40} />}
            name={built ? built.names.xlsx : names.xlsx}
            size={built ? fileSize(built.xlsx) : null}
            disabled={!built || stale}
            done={handedOver.xlsx}
            reason={saveReason}
            onSave={() => {
              if (!built) return;
              downloadBytes(built.names.xlsx, built.xlsx, XLSX_TYPE);
              setHandedOver((prev) => ({ ...prev, xlsx: true }));
            }}
          >
            {/* What the operator opens the file and finds. The argument for why
                an empty cell is the honest output reads the same on every
                order, so it hides. */}
            <p className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
              <span className="text-ink-2">
                Kolom E kosong di seluruh baris.
              </span>
              <Hint label="Kenapa kolom E kosong">
                Isinya sama pada setiap pekerjaan:{" "}
                <span className="lt-figure">
                  {AO_TEMPLATE.xlsxRows.length}
                </span>{" "}
                baris. Pekerjaan di peramban ini menyimpan halaman dan area,
                bukan nilai teks, jadi tidak ada nilai yang bisa diisikan. Sel
                kosong adalah keluaran yang jujur; nilai tebakan adalah
                kegagalan yang dicegah alat ini.
              </Hint>
            </p>
          </FileSlab>
        </div>

        {/* The one remedy for a download nobody can confirm arrived. It is an
            interruption wearing a calm voice, so it stays on screen, and it is
            said once for both files rather than once per slab. */}
        {handedOver.docx || handedOver.xlsx ? (
          <p className="text-[0.8125rem] text-ink-2">
            Berkas sudah diserahkan ke peramban ini. Jika tidak muncul di folder
            unduhan, izinkan unduhan lalu tekan Simpan lagi.
          </p>
        ) : null}
      </section>

      {/* THE SPACE THE ACTION BAR OCCUPIES, RESERVED IN THE FLOW.
          The bar below is `position: sticky`, which keeps it in the flow and
          pulls it up to the viewport's bottom edge for as long as its own
          place is below that edge. While it is pulled up it is an OPAQUE
          overlay across the bottom of the page, and it releases only in the
          last few dozen pixels of the scroll: the page's own bottom padding
          plus the gap above the bar, and nothing else. Measured in a browser at
          1366x768 with a 260px bar, that left the last section of this screen
          clear of it over 88px of an 1144px scroll and underneath it
          everywhere else, which one wheel notch skips straight past.
          Reserving the bar's own measured height here gives the page somewhere
          to be scrolled clear to. It is a sibling and not padding on a wrapper
          around the bar, because a wrapper would become the bar's containing
          block and a sticky box cannot leave that: the bar would stop sticking
          altogether. */}
      <div aria-hidden="true" style={{ height: barHeight }} />

      {/* ------------------------------------------------ the action bar
          Sticky at the bottom, so the verdict, the blocking items and the
          build button are in one viewport at 1366x768. The reason a control is
          disabled is never off screen from the control.

          GLASS, AND IT IS ON THE RIGHT SIDE OF THE SEAM: it stays still while
          the inventory scrolls under it, which is the one question that decides
          the material. The evidence in that inventory is white A4 at 300 DPI,
          which is exactly the case `--glass-rail` is nearly opaque for.

          IT DRAWS NO BORDER OF ITS OWN. `.lt-rail::before` already lays the
          bright hairline along the top edge -- the edge a bottom-pinned rail
          catches the light on -- so the 2px `--edge` rule this carried was a
          second, dimmer line under the first, and 2px is the stamped-plate
          weight the client rejected.

          The negative margin is not a spacing choice: it is the shell's own
          gutter, cancelled so the rail reaches both edges of the page. */}
      <div
        ref={barRef}
        className="lt-rail sticky bottom-0 z-10 -mx-5 flex flex-col gap-4 px-6 py-4"
      >
        <div role="status" aria-live="polite" className="flex flex-col gap-2">
          {blocked ? (
            <>
              {/* The verdict, at body size and 700: see the note on the
                  inventory's bagian names. 16px is not a rung of this ramp. */}
              <p className="font-bold">Belum bisa diekspor.</p>
              <ul className="flex flex-col gap-2">
                {byKind.proposed.length > 0 ? (
                  <li className="text-sm">
                    <span className="lt-figure">{byKind.proposed.length}</span>{" "}
                    usulan masih menunggu keputusan Anda.
                  </li>
                ) : null}
                {byKind.pending.length > 0 ? (
                  <li className="text-sm">
                    <span className="lt-figure">{byKind.pending.length}</span>{" "}
                    potongan belum dicari.
                  </li>
                ) : null}
                {byKind.lost.length > 0 ? (
                  <li className="text-sm text-gap">
                    <span className="lt-figure">{byKind.lost.length}</span>{" "}
                    potongan menunjuk halaman yang sudah tidak ada.
                  </li>
                ) : null}
                {faults.length > 0 ? (
                  <li className="text-sm text-gap">
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
              {/* THE SENTENCE THIS PRODUCT EXISTS FOR. It never changes and it
                  never hides: it is the reason the button beside it will not
                  fire, and a disabled control whose reason is behind a hover is
                  the same defect as one whose reason is off screen. Its wording
                  is fixed in docs/ui-bahasa.md. */}
              {byKind.proposed.length > 0 ? (
                <p
                  className="max-w-[74ch] text-[0.8125rem] text-ink-2"
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
              <p className="font-bold">Siap diekspor.</p>
              <p className="text-sm">
                <span className="lt-figure">{tally.slotsComplete}</span> dari{" "}
                <span className="lt-figure">{tally.fillableSlots}</span> bagian
                membawa bukti
                {tally.slotsBlank > 0 ? (
                  <>
                    , <span className="lt-figure">{tally.slotsBlank}</span>{" "}
                    terbit kosong atas keputusan Anda
                  </>
                ) : null}
                .
              </p>
            </>
          )}
        </div>

        {/* The failure belongs HERE, beside the button that caused it. At the
            top of a page this tall it would be off screen at the moment it
            appears, which is the same defect as a block whose reason the
            operator has to scroll to find. */}
        {state.kind === "failed" ? (
          <Interruption detail={state.message}>
            Kedua berkas gagal dibuat, jadi tidak ada yang ditulis. Perbaiki
            penyebabnya lalu buat lagi.
          </Interruption>
        ) : null}

        {stale ? (
          <Notice tone="warn">
            Isi halaman ini berubah setelah kedua berkas dibuat. Buat ulang
            sebelum menyimpannya.
          </Notice>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <Btn
            tone="primary"
            disabled={blocked || state.kind === "working"}
            onClick={() => void write()}
          >
            {built ? "Buat ulang" : "Buat kedua berkas"}
          </Btn>

          {blocked ? <Btn onClick={onGoToSheet}>Kembali ke lembar periksa</Btn> : null}

          {/* A PRIVACY STATEMENT NEVER HIDES, whichever direction it points.
              A previous pass put this behind a question mark, reasoning that a
              sentence said as data leaves the device must stay on screen while
              this one is its opposite, a promise that nothing leaves. The two
              are indeed different sentences, and it still does not hide: an
              operator cannot tell a promise nobody made from one they did not
              hover over, and that is the whole value of making it. What the
              cost argument buys (every line in this bar is subtracted from the
              page twice, once as the bar and once as the height
              `useBarHeight` reserves for it) is a SHORTER line, not a hidden
              one. Its first four words are the wording docs/ui-bahasa.md
              fixes. */}
          <p className="max-w-[74ch] text-[0.8125rem] text-ink-2">
            Berkas PDF tidak diunggah. Kedua berkas dibuat di peramban ini.
          </p>

          {state.kind === "working" ? (
            <div className="flex items-center gap-4">
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
                    </span>
                    .
                  </span>
                </>
              ) : (
                <span className="text-[0.8125rem]">Menulis tanpa potongan.</span>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
