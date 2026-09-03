"use client";

/**
 * THE REVIEW PLATE: one field of the packet, presented for a decision.
 *
 * This is the screen the product is. Twelve to twenty-four times per order,
 * every working day, an operator looks at a cropped picture of a scanned
 * Indonesian contract page and decides whether it really is the evidence for
 * the field named beside it. Everything that makes that judgement faster earns
 * its space here; everything else is furniture.
 *
 * WHAT THIS REPLACES, AND WHY. The old plate laid out
 * `grid-cols-[minmax(0,17rem)_minmax(0,1fr)]`: the crop was capped at 272px
 * while a black OCR transcript took the remaining ~1100px. A 16 x 6 cm crop of
 * a 300 DPI scan rendered at roughly 14% of true size, which is below the size
 * at which a rubber stamp's text, a paraf initial or Indonesian contract small
 * print can be read at all. The operator could not perform the judgement the
 * screen was asking for, so the honest options were to guess or to judge by the
 * transcript -- and judging by the transcript is exactly the shortcut that lets
 * a crop of the WRONG PAGE through, because OCR text can be right while the
 * rectangle is wrong. The transcript is a closed disclosure now, and the
 * picture is the hero.
 *
 * THE ORDER OF THE PLATE IS THE DESIGN, and it is not free to rearrange:
 *   1. the crop, big enough to read small print;
 *   2. the denah, so page identity is answered by a SHAPE and not by comparing
 *      digits (`denah.tsx` carries that argument in full);
 *   3. the field name, in the packet's own mono voice, large, because nobody
 *      should re-read to know which field they are ruling on;
 *   4. what the field is supposed to be, above all its "bukan ..." half;
 *   5. the decision controls, attached to the picture, below it, left-aligned
 *      to it, never in a deck aimed at something off screen;
 *   6. the citation register, then the transcript on demand.
 *
 * THAT ORDER IS NOW THE SCREEN'S, NOT ONLY THE ARGUMENT'S. The header used to
 * carry the mark, the field name, the WHOLE of `catatan` (`adalah` plus
 * `bukan`, three or four lines of prose) and the state word above the picture:
 * roughly 136px of reading before the first crop, on every plate, on a sheet
 * that holds twenty-four of them. It is one line now, about 34px, and it holds
 * only what a different order would print differently: the mark, the field
 * name, the state word, and the completeness figure.
 *
 * `SlotDef.catatan` had never been on screen in any version of this app. The
 * specification the operator is asked to apply lived in the repository and not
 * in front of the person applying it, which is the cheapest defect in the whole
 * slice. It is optional in the type and it is read defensively here: a slot
 * without one renders nothing, and no empty question mark, rather than falling
 * back to `SlotDef.hint`, which is English written for the model.
 *
 * ITS TWO HALVES MOVED IN DIFFERENT DIRECTIONS, ON PURPOSE. `adalah` restates
 * what the field name has already said, reads word for word the same on every
 * order, and nothing on the screen stops working while it is unread, so it
 * hides behind the hint on the field name. `bukan` names the plausible
 * look-alike, which is the disambiguation the operator actually applies and the
 * reason this product exists; it arrived on screen with this redesign, and
 * hiding it the day it arrived would be the wrong-and-quiet failure delivered
 * by the very control meant to tidy up. It moves into the right-hand column
 * instead, under the denah and above the register, where a landscape crop
 * leaves the column empty anyway. It is drawn once per plate, on the first
 * capture, because it describes the bagian rather than any one rectangle.
 *
 * `entry.def.key` is NEVER rendered. `kbLanjutan.ttdPejabat` is system
 * vocabulary competing for the exact space the definition should occupy.
 *
 * A SLOT CAN HOLD MORE THAN ONE CAPTURE (the sample's `KB (lanjutan)` ToP row
 * stacks two pictures cut from two different pages), and every one of them gets
 * its own row INCLUDING THE ONES THAT ARE STILL MISSING. A half-filled slot
 * drawn as a single tidy row is this project's failure class in its purest
 * form: a sheet that looks complete over a deliverable that is short a piece of
 * evidence.
 *
 * SIZE IS AN ARGUMENT. A capture that owes a decision is a full plate; a
 * settled one collapses to a proof at the same aspect, with its denah, its
 * register and its advisories all still on screen. Nothing is hidden by
 * collapsing, only made smaller, so the length of the sheet reports how much
 * work is left.
 *
 * THE SAME SPLIT RUNS THROUGH THE SENTENCE UNDER THE BUTTONS. Three of the four
 * things it used to say are the reason a control on this screen is refusing to
 * work right now (the crop has not been cut yet, its page is no longer in the
 * pekerjaan, its page will not open however long you wait), so all three stay
 * as prose. The fourth, that "Bukan ini" throws the usulan away and sends the
 * bagian to the outstanding list, is identical under every proposal on every
 * order and describes no fault at all, so it sits behind a hint on the button
 * it is about.
 */

import { useId, useRef, useState } from "react";

import type { SlotDef } from "@/lib/forms/template";
import type { Box } from "@/lib/pipeline/render";
import { citeZone, resolvePage } from "@/lib/ui/evidence";
import type { BrowserRun, SlotState } from "@/lib/ui/runtime";
import type { SlotAggregate } from "@/lib/ui/slots";
import { captureLabel } from "@/lib/ui/slots";

import {
  Advisory,
  Btn,
  Cite,
  CiteAdvisories,
  Hint,
  Mark,
  STATUS_MEANING,
  StateWord,
} from "./chrome";
import { Denah, Missing } from "./denah";
/**
 * One icon per control, and each one is the shape of what its verb LEAVES
 * BEHIND rather than a picture of the verb: Terima leaves a paraf, Bukan ini
 * leaves a coretan, Kosongkan leaves a double-ruled empty cell, and the three
 * controls that end in a rectangle carry the rectangle. `Paraf` here is the
 * standalone icon; `Mark` above draws the same path inside its ruled box, from
 * the same constant, so the button and the state it produces cannot drift.
 */
import { Coretan, Kosongkan, Paraf, Potongan } from "./icons";
import type { CropThumbs } from "./use-crop-thumbs";

export type PlateActions = {
  onAccept: (slotIndex: number) => void;
  onReject: (slotIndex: number) => void;
  onRedraw: (slotIndex: number) => void;
  onUnfill: (slotIndex: number) => void;
  onReopen: (slotIndex: number) => void;
  /** Draw a capture this slot does not have a state for yet. */
  onDrawNew: (slotKey: string, label: string) => void;
};

/** Shared, so a plate with no in-flight write allocates nothing. */
const NO_INDEXES: ReadonlySet<number> = new Set<number>();

/**
 * The label as an operator should read it.
 *
 * `konfigurasi.quote` is labelled `{{quote}}` in the template: the sample puts
 * the quote number itself in that row and the EXPORTER substitutes it. The UI
 * has no substitution step, so the raw token used to reach the screen. A
 * template token in front of a Telkom validator is the same category of mistake
 * as showing them a camelCase slot key.
 */
const TOKEN_LABELS: Record<string, string> = { quote: "Quote" };

export function displayLabel(label: string): string {
  const token = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(label.trim());
  if (!token) return label;
  return TOKEN_LABELS[token[1]] ?? "(belum diisi)";
}

/**
 * What the field is NOT, in the column beside the picture.
 *
 * This is the half of `catatan` the operator actually applies. The failure this
 * product is organised against is a crop of a plausible LOOK-ALIKE, and the
 * look-alike is exactly what this line names, so it is read while the picture
 * is being looked at rather than a paragraph the eye skipped on the way down.
 * The leading word is supplied here unless the template already wrote it, so
 * both spellings of the copy read the same.
 */
function Bukan({ text }: { text: string }) {
  const alreadyLed = /^bukan\b/i.test(text);
  return (
    <p className="text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
      {alreadyLed ? null : (
        <span style={{ color: "var(--ink)", fontWeight: 600 }}>Bukan </span>
      )}
      {text}
    </p>
  );
}

/** `catatan`, split the way the density rule splits it. */
function readCatatan(catatan: SlotDef["catatan"]): {
  adalah?: string;
  bukan?: string;
} {
  const adalah = catatan?.adalah?.trim();
  const bukan = catatan?.bukan?.trim();
  return { adalah: adalah || undefined, bukan: bukan || undefined };
}

/**
 * How large a crop is allowed to get.
 *
 * `full` caps at 70vh because four of the twelve captures in the sample are
 * whole-page captures by design, and an uncapped A4 at this column width is a
 * screen and a half each: the sheet becomes enormous and the decision controls
 * fall off the bottom of the picture they belong to. The plate scrolls; the
 * picture must not push the verdict out of the viewport.
 *
 * `proof` is a settled capture: still a real picture of the real crop, small
 * enough that the remaining work is what makes the sheet long.
 */
type CropCap = "full" | "proof";

const CROP_CAP: Record<CropCap, { height: string; width: string }> = {
  full: { height: "70vh", width: "100%" },
  proof: { height: "9rem", width: "24rem" },
};

type CropCondition = "ready" | "waiting" | "broken" | "unrenderable";

/**
 * THE CROP'S BOX IS RESERVED FROM THE ZONE, BEFORE THE PICTURE EXISTS.
 *
 * `Zone.box` is in the run already, so the exact shape of every crop on the
 * sheet is known before a single bitmap has been decoded. Without a reserved
 * box the sheet reflowed once per crop as `useCropThumbs` streamed them in page
 * group by page group, not top to bottom, so the operator's click target moved
 * under the cursor while they were reaching for Terima.
 *
 * The cap is applied as a MAX-WIDTH derived from the aspect, never as a
 * max-height, so the frame keeps the crop's own proportions. A frame that
 * clamped its height would letterbox the picture inside a lit paper rectangle,
 * and white margins around a scan read as part of the scan.
 */
function CropFrame({
  box,
  url,
  alt,
  condition,
  cap,
}: {
  box: Box;
  url?: string;
  alt: string;
  condition: CropCondition;
  cap: CropCap;
}) {
  const w = Math.max(box.w, 1);
  const h = Math.max(box.h, 1);
  const limit = CROP_CAP[cap];
  const style = {
    width: "100%",
    aspectRatio: `${w} / ${h}`,
    maxWidth: `min(${limit.width}, calc(${limit.height} * ${w / h}))`,
  };

  return (
    // The swap from reserved box to picture happens without any navigation, so
    // it is announced. `aria-busy` says which of the two is on screen.
    <div aria-live="polite" aria-busy={condition === "waiting"}>
      {condition === "ready" && url ? (
        <div className="lt-paper overflow-hidden" style={style}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL
              cut in this tab from a document that must never leave it;
              next/image would want a loader and a remote pattern. */}
          <img src={url} alt={alt} className="block h-full w-full" />
        </div>
      ) : condition === "unrenderable" ? (
        /* Same family as `broken`: the picture is not coming. Different
           sentence, because the cause is different and the operator can act on
           knowing which. Hatched rather than lit, for the reason below. */
        <div
          className="lt-hatch grid place-items-center px-3 text-center text-[0.8125rem]"
          style={{ ...style, color: "var(--gap)" }}
        >
          Halaman ini gagal dibuka, jadi potongannya tidak bisa diambil
        </div>
      ) : condition === "broken" ? (
        /* NOT paper, and not the waiting trough either. A crop whose page the
           run no longer holds will never arrive, and drawing it as a blank lit
           sheet would invent exactly the picture this product exists to
           prevent: a plausible empty page. */
        <div
          className="lt-hatch grid place-items-center px-3 text-center text-[0.8125rem]"
          style={{ ...style, color: "var(--gap)" }}
        >
          Halaman potongan ini sudah tidak ada
        </div>
      ) : (
        /* Recessed, not paper: a crop that has not been cut yet is not a
           document lying on the table, and a white rectangle here would read as
           a blank scan. Same box either way, so nothing moves when it lands. */
        <div
          className="lt-well grid place-items-center px-3 text-center text-[0.8125rem]"
          style={{ ...style, color: "var(--ink-2)" }}
        >
          Menyiapkan potongan
        </div>
      )}
    </div>
  );
}

/**
 * The OCR text under the rectangle, CLOSED.
 *
 * It had four times the crop's area and it is the one thing on this plate that
 * can be right while the answer is wrong: the model reads text, and text from
 * the wrong page reads perfectly. Open it to corroborate a picture you have
 * already looked at, never to replace looking.
 */
function Transcript({ text }: { text?: string }) {
  const empty = !text || text.trim() === "";
  return (
    <details className="lt-well max-w-[80ch] px-3 py-2 text-[0.8125rem]">
      <summary
        className="cursor-pointer select-none"
        style={{ color: "var(--ink-2)" }}
      >
        Teks di dalam area ini
      </summary>
      <p className="mt-2" style={{ color: "var(--ink-2)" }}>
        Teks hasil pembacaan bisa benar walaupun kotaknya salah halaman, jadi
        putuskan dari gambarnya dan pakai teks ini hanya untuk memastikan.
      </p>
      {empty ? (
        <p className="mt-2" style={{ color: "var(--ink)" }}>
          Tidak ada teks yang terbaca di area ini.
        </p>
      ) : (
        <pre
          className="lt-figure mt-2 max-h-56 overflow-auto whitespace-pre-wrap"
          style={{ color: "var(--ink)" }}
        >
          {text}
        </pre>
      )}
    </details>
  );
}

/**
 * A capture with no picture: nobody looked, or somebody looked and found
 * nothing, or the operator decided it ships blank.
 *
 * Those three are the whole point of the dokumen tambahan loop and they used to
 * be told apart by 12px text below the contrast floor inside a box smaller than
 * a button. Here the shape is `Missing` (a hatched sheet, the same silhouette
 * the denah draws for a page nobody has searched), the state is the `Mark`
 * beside it, and the sentence is `STATUS_MEANING`, defined once in `chrome.tsx`
 * so no screen invents its own wording for a state.
 */
function Absence({ status }: { status: SlotState["status"] }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Missing height={104} label="Belum ada gambar untuk bagian ini" />
      <p className="max-w-[52ch]" style={{ color: "var(--ink)" }}>
        {STATUS_MEANING[status]}
      </p>
    </div>
  );
}

function CaptureRow({
  run,
  state,
  slotIndex,
  fieldLabel,
  thumbUrl,
  thumbFailure,
  actions,
  showState,
  ordinal,
  required,
  saving,
  justDecided,
  forceExpanded,
  bukan,
}: {
  run: BrowserRun;
  state: SlotState;
  slotIndex: number;
  fieldLabel: string;
  thumbUrl?: string;
  /** Set when this capture's PAGE would not render, so no crop is coming. */
  thumbFailure?: string;
  actions: PlateActions;
  /**
   * The look-alike this bagian is not, passed to the FIRST capture only: it
   * describes the bagian rather than any one rectangle, and an identical
   * paragraph beside every picture in a stacked slot discriminates nothing.
   */
  bukan?: string;
  /** Only when the slot holds several captures; otherwise the header says it. */
  showState: boolean;
  /** 1-based position of this capture within its slot, when there are several. */
  ordinal: number | null;
  required: number;
  saving: boolean;
  justDecided: boolean;
  forceExpanded: boolean;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  /**
   * null means "whatever this capture's state says"; a boolean is the operator
   * having asked for this one capture specifically. Kept as an override rather
   * than as a plain `opened` flag because the default itself changes underneath
   * it: accepting a proposal turns a full plate into a settled one, and an
   * `opened` flag would then have the toggle showing "Perkecil" while pressing
   * it kept the plate open.
   */
  const [override, setOverride] = useState<boolean | null>(null);

  const cite = state.zone ? citeZone(run, state.zone) : null;
  const resolved = state.zone ? resolvePage(run, state.zone.pageIndex) : null;

  // A zone the run cannot resolve to a page will NEVER produce a crop, and the
  // old plate showed it as "cutting the crop..." forever: a broken capture
  // presenting as a slow app, so the operator waits instead of acting.
  const broken = Boolean(state.zone) && cite === null;
  // A page that would not render is the SECOND way a crop never arrives, and
  // it used to be invisible: `useCropThumbs` caught the failure so one bad page
  // could not stop the sheet, and said nothing, so this capture sat on
  // "Menyiapkan potongan" for the session with Terima inert behind it. Both
  // failures now land in the same family, because what the operator needs is
  // identical either way: stop waiting, and redraw.
  const unrenderable = Boolean(state.zone) && !broken && Boolean(thumbFailure);
  const waiting =
    Boolean(state.zone) && !broken && !unrenderable && !thumbUrl;
  const condition: CropCondition = broken
    ? "broken"
    : unrenderable
      ? "unrenderable"
      : waiting
        ? "waiting"
        : "ready";

  // A settled capture collapses; one just decided in this session does not,
  // because pulling the picture away under the hand that accepted it is the one
  // moment the operator is most likely to want a second look.
  const settled = state.status === "confirmed" || state.status === "unfilled";
  const expanded = forceExpanded || (override ?? (justDecided || !settled));
  const cap: CropCap = expanded ? "full" : "proof";

  /**
   * A DECISION MUST NOT COST THE OPERATOR THEIR PLACE.
   *
   * Accepting swaps the proposed branch (Terima / Gambar ulang / Bukan ini) for
   * the confirmed one, which unmounts the very button that was clicked; focus
   * then falls to <body> and the next Tab restarts at the top of the document.
   * Twelve captures per order, every day, makes that the difference between a
   * keyboard loop and a mouse-only one. Focus moves to the row first, while the
   * button is still mounted, so the keyboard stays where the work is.
   */
  const decide = (act: () => void) => {
    rowRef.current?.focus({ preventScroll: true });
    act();
  };

  const alt = cite
    ? `Potongan untuk ${fieldLabel}, halaman ${cite.page} dari ${cite.pagesInDoc}`
    : `Potongan untuk ${fieldLabel}`;
  const denahLabel = cite
    ? `Denah halaman ${cite.page} dari ${cite.pagesInDoc}, dengan area potongan ditandai`
    : "Denah halaman, tidak tersedia";

  // A DISABLED CONTROL NEVER APPEARS WITHOUT ITS REASON BESIDE IT, and all
  // three of these are exactly that: a measurement of what went wrong with THIS
  // capture, and the reason Terima is inert under the operator's hand. None of
  // them may go behind a hover. The fourth sentence that used to live here,
  // about what "Bukan ini" costs, is not a fault and does not vary, so it moved
  // onto the button as a hint.
  const fault = waiting
    ? "Potongannya belum tampil. Tunggu gambarnya muncul sebelum Anda memutuskan."
    : broken
      ? "Halaman potongan ini sudah tidak ada di pekerjaan ini, jadi tidak ada yang bisa Anda nilai. Gambar ulang areanya, atau tandai bukan ini."
      : unrenderable
        ? // It says WAITING WILL NOT HELP, which is the whole point of telling
          // the operator apart from the loading state they used to be left in.
          "Halaman ini gagal dibuka, jadi potongannya tidak akan muncul betapa pun lamanya Anda menunggu. Gambar ulang areanya dari halaman lain, atau tandai bukan ini."
        : null;

  const expandToggle =
    settled && state.zone && !forceExpanded ? (
      <Btn onClick={() => setOverride(!expanded)}>
        <Potongan />
        {expanded ? "Perkecil potongan" : "Perbesar potongan"}
      </Btn>
    ) : null;

  return (
    <div
      ref={rowRef}
      tabIndex={-1}
      aria-label={
        ordinal ? captureLabel(fieldLabel, ordinal, required) : fieldLabel
      }
      className="flex flex-col gap-3"
    >
      {showState ? (
        <div className="flex flex-wrap items-center gap-3">
          <Mark status={state.status} drawing={justDecided} saved={!saving} />
          <StateWord status={state.status} />
          {ordinal ? (
            <span
              className="lt-figure text-[0.8125rem]"
              style={{ color: "var(--ink-2)" }}
            >
              potongan {ordinal} dari {required}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {state.zone ? (
            <CropFrame
              box={state.zone.box}
              url={thumbUrl}
              alt={alt}
              condition={condition}
              cap={cap}
            />
          ) : (
            <Absence status={state.status} />
          )}

          {/* A picture on screen under a slot that ships blank is this
              product's failure class inverted: it looks accepted and the
              deliverable carries an empty cell. `onUnfill` patches the status
              and leaves the zone, and `planExport` only places `confirmed`
              captures, so the contradiction is real and has to be said. */}
          {state.status === "unfilled" && state.zone ? (
            <Advisory>
              Potongan ini tidak akan dimasukkan ke berkas hasil, karena bagian
              ini sengaja dikosongkan. Buka lagi bagian ini kalau Anda ingin
              memakainya.
            </Advisory>
          ) : null}

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {state.status === "proposed" ? (
                <>
                  <Btn
                    tone="primary"
                    disabled={waiting || broken || unrenderable}
                    onClick={() => decide(() => actions.onAccept(slotIndex))}
                  >
                    <Paraf />
                    Terima
                  </Btn>
                  <Btn onClick={() => decide(() => actions.onRedraw(slotIndex))}>
                    <Potongan />
                    Gambar ulang
                  </Btn>
                  {/* The button and its hint travel together, so a wrapping
                      row cannot leave the question mark stranded beside a
                      different control. */}
                  <span className="flex items-center gap-1">
                    <Btn
                      tone="reject"
                      disabled={waiting}
                      onClick={() => decide(() => actions.onReject(slotIndex))}
                    >
                      <Coretan />
                      Bukan ini
                    </Btn>
                    <Hint label="Penjelasan Bukan ini">
                      Bukan ini membuang usulan ini, dan bagian ini masuk ke
                      daftar yang belum ditemukan.
                    </Hint>
                  </span>
                </>
              ) : null}

              {state.status === "confirmed" ? (
                <>
                  <Btn onClick={() => decide(() => actions.onRedraw(slotIndex))}>
                    <Potongan />
                    Gambar ulang
                  </Btn>
                  <Btn onClick={() => decide(() => actions.onReopen(slotIndex))}>
                    Batalkan, periksa lagi
                  </Btn>
                </>
              ) : null}

              {state.status === "outstanding" || state.status === "pending" ? (
                <>
                  <Btn onClick={() => decide(() => actions.onRedraw(slotIndex))}>
                    <Potongan />
                    Gambar sendiri
                  </Btn>
                  <Btn onClick={() => decide(() => actions.onUnfill(slotIndex))}>
                    <Kosongkan />
                    Kosongkan
                  </Btn>
                </>
              ) : null}

              {state.status === "unfilled" ? (
                <Btn onClick={() => decide(() => actions.onReopen(slotIndex))}>
                  Buka lagi
                </Btn>
              ) : null}

              {expandToggle}
            </div>

            {fault ? (
              <p
                className="max-w-[72ch] text-[0.8125rem]"
                style={{ color: "var(--ink-2)" }}
              >
                {fault}
              </p>
            ) : null}
          </div>

          {state.zone && expanded ? <Transcript text={state.text} /> : null}
        </div>

        {state.zone || bukan ? (
          <aside className="flex min-w-0 flex-col gap-4">
            {/* Kept at both sizes. A wrong page is recognised from the SHAPE
                of the plan before anything is read, and that is as true of a
                capture somebody already accepted as of one waiting on them. */}
            {state.zone ? (
              <Denah
                page={resolved?.page ?? null}
                cut={state.zone.box}
                size={expanded ? "md" : "sm"}
                label={denahLabel}
              />
            ) : null}

            {/* Between the plan and the register: the last thing read before
                the citation, and the one that decides what the picture is
                being compared against. */}
            {bukan ? <Bukan text={bukan} /> : null}

            {state.zone ? (
              <>
                <Cite cite={cite} />
                <CiteAdvisories cite={cite} />
                {state.origin ? (
                  <p
                    className="text-[0.8125rem]"
                    style={{ color: "var(--ink-2)" }}
                  >
                    {state.origin === "human"
                      ? "Area ini Anda gambar sendiri."
                      : "Area ini usulan model, jadi masih perlu Anda periksa."}
                  </p>
                ) : null}
              </>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A capture the slot needs and the run has no state for at all.
 *
 * The runtime seeds one state per capture, so in a normal run this renders
 * nothing. It is not dead code: a run stored before a template changed its
 * `crops` count, and a slot the run has never seen at all, both land here, and
 * the alternative is a fillable plate with no content and no action.
 */
function MissingCapture({
  ordinal,
  required,
  onDraw,
  bukan,
}: {
  ordinal: number;
  required: number;
  onDraw: () => void;
  /** Only when this plate has no capture row to carry it. See `CaptureRow`. */
  bukan?: string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Missing height={104} label="Potongan ini belum ada" />
      <div className="flex max-w-[52ch] flex-col items-start gap-2">
        <span
          className="lt-figure text-[0.8125rem]"
          style={{ color: "var(--ink-2)" }}
        >
          potongan {ordinal} dari {required}
        </span>
        <p style={{ color: "var(--ink)" }}>
          Bagian ini butuh {required} potongan dan yang ini belum ada. Selama
          masih kurang, berkas hasil akan tampak lengkap padahal kehilangan satu
          gambar.
        </p>
        {bukan ? <Bukan text={bukan} /> : null}
        <Btn onClick={onDraw}>
          <Potongan />
          Gambar sendiri
        </Btn>
      </div>
    </div>
  );
}

export function ProposalPlate({
  run,
  entry,
  thumbs,
  actions,
  pending = NO_INDEXES,
  fresh = NO_INDEXES,
  expanded = false,
}: {
  run: BrowserRun;
  entry: SlotAggregate;
  thumbs: CropThumbs;
  actions: PlateActions;
  /** Slot indexes whose save is still in flight. */
  pending?: ReadonlySet<number>;
  /** Slot indexes confirmed by a click in this session, for the paraf draw. */
  fresh?: ReadonlySet<number>;
  /**
   * Force every capture to full size. The last pass before a validator signs is
   * exactly when every crop must be visible, so the export screen and the
   * sheet's expand-all set this; nothing else should.
   */
  expanded?: boolean;
}) {
  const headingId = useId();
  const label = displayLabel(entry.def.label);

  /**
   * A cell nobody will ever rule on is ONE RULED LINE.
   *
   * Thirteen of the template's twenty-four slots are `fillable: false`: they
   * are filled in by hand after export, so they carry no decision and no
   * evidence. They used to be full-size cards identical to a live proposal,
   * which put more than half the primary screen's scroll length between the
   * operator and the work. The hatch is kept, small, because a deliberately
   * blank cell is still a cell that is blank ON THE RECORD.
   */
  if (!entry.def.fillable) {
    return (
      <div
        className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t py-2.5"
        style={{ borderColor: "var(--line)" }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="lt-hatch h-3.5 w-8 shrink-0" aria-hidden="true" />
          <h3
            className="lt-figure text-[0.9375rem] font-bold"
            style={{ color: "var(--ink-2)" }}
          >
            {label}
          </h3>
        </div>
        <p className="text-[0.8125rem]" style={{ color: "var(--ink-2)" }}>
          Diisi manual setelah ekspor, tidak diambil dari dokumen PDF.
        </p>
      </div>
    );
  }

  const waitingSave = entry.states.some((placed) => pending.has(placed.index));
  const justDecided = entry.states.some((placed) => fresh.has(placed.index));
  const { adalah, bukan } = readCatatan(entry.def.catatan);

  // Captures the slot needs that have no state at all. See `MissingCapture`.
  const missing = Math.max(0, entry.required - entry.states.length);
  const rows = entry.states.length + missing;
  const multi = entry.required > 1 || rows > 1;

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-4 border-t py-6"
      style={{ borderColor: "var(--line)" }}
    >
      {/* ONE LINE, and everything on it varies from order to order: which
          state this bagian is in, and whether it is short a picture. The
          definition that used to sit here is a hover away on the field name
          and a column away beside the crop. */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <Mark
            status={entry.status}
            drawing={justDecided}
            saved={!waitingSave}
          />
          {/* The question being asked, in the packet's own mono voice and at
              the size of a question. It was 14px, level with the slot key
              printed beside it. */}
          <h3 id={headingId} className="lt-figure lt-field-name">
            {label}
          </h3>
          {/* The hint sits at the end of the name whose meaning it holds, not
              inside a sentence, and it holds only `adalah`: a slot the
              template gave no catatan renders no question mark at all rather
              than an empty one. */}
          {adalah ? (
            <Hint label={`Penjelasan ${label}`}>{adalah}</Hint>
          ) : null}
        </div>

        <div className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1">
          <StateWord status={entry.status} />
          {/* THE COMPLETENESS CLAIM, and the most consequential figure on the
              sheet: it is the difference between a packet that is finished and
              one that is silently short a picture. It is the only figure in
              this header, so it survives a fast scroll. */}
          {multi ? (
            <span
              className="lt-figure text-[0.8125rem]"
              style={{ color: "var(--ink-2)" }}
            >
              {entry.found <= entry.required
                ? `${entry.found} dari ${entry.required} potongan`
                : `${entry.found} potongan untuk bagian yang butuh ${entry.required}`}
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-8">
        {entry.states.map((placed, i) => (
          <CaptureRow
            key={`${entry.def.key}-${placed.index}`}
            run={run}
            state={placed.state}
            slotIndex={placed.index}
            fieldLabel={label}
            thumbUrl={thumbs.urls[String(placed.index)]}
            thumbFailure={thumbs.failed[String(placed.index)]}
            actions={actions}
            showState={multi}
            ordinal={multi ? i + 1 : null}
            required={entry.required}
            saving={pending.has(placed.index)}
            justDecided={fresh.has(placed.index)}
            forceExpanded={expanded}
            bukan={i === 0 ? bukan : undefined}
          />
        ))}

        {Array.from({ length: missing }, (_, i) => (
          <MissingCapture
            key={`${entry.def.key}-missing-${i}`}
            ordinal={entry.states.length + i + 1}
            required={entry.required}
            onDraw={() => actions.onDrawNew(entry.def.key, entry.def.label)}
            // Only when there is no capture row above to have carried it.
            bukan={entry.states.length === 0 && i === 0 ? bukan : undefined}
          />
        ))}
      </div>
    </article>
  );
}
