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
 * THE PLATE IS A SLAB, AND ITS KOP IS THE STATUS CHANNEL. A lifted block, and
 * a header bar across the top carrying the bagian's name on the left and its
 * state on the right. The bar takes a 4px amber rule down its leading edge and
 * a 12% tint of its own ground when this bagian owes a decision, red when
 * something under it failed, so a plate's state is legible from across the room
 * instead of being a small mark to hunt for. It is a TINT AND A RULE, never a
 * saturated bar under light text: that gesture is the one the client named.
 *
 * A CONFIRMED PLATE GETS NO COLOUR AT ALL, which is why `data-owes="done"` is
 * not used here: it paints the bar petrol, and this product's oldest rule is
 * that a finished packet is a screen with no colour left on it. Twenty petrol
 * bars would be the loudest thing on a finished sheet.
 *
 * A COLOURED KOP IS A DIFFERENT GROUND, so it rebinds the ink tokens for its
 * children exactly as `.lt-paper` does for a sheet, AND THE STYLESHEET OWNS
 * THAT REBIND NOW. Without it, `StateWord` on a marked bar is `--mark` on
 * `--mark` and `Hint`'s question mark is `--ink-3` on the same tint: two
 * components that read perfectly on the raised plane and go quiet on the one
 * bar the design asks the operator to read first.
 *
 * This file used to declare that rebind itself, as `ON_COLOURED_KOP`, and the
 * hazard it recorded is still live and still worth knowing: the rebind goes on
 * the bar's CHILDREN and never on the bar. A custom property applies to the
 * element that declares it as well as to its descendants, and the bar's own
 * fill is written in terms of `--mark` and `--gap`, so declaring it one level
 * up resolves that fill through the rebind and the bar comes out unpainted --
 * the status channel silently deleting itself on exactly the plates that owe a
 * decision, invisible in review because every plate that owes nothing still
 * renders perfectly. `.lt-kop[data-owes] > *` in `globals.css` now does it for
 * every kop in the product, on the children, so no component can forget and
 * none can put it in the wrong place.
 *
 * THE ORDER OF THE PLATE IS THE DESIGN, and it is not free to rearrange:
 *   1. the crop, big enough to read small print, and MOUNTED rather than
 *      placed: a sunk stage, a near-black mat, then the sheet's own edge. Three
 *      drawn cues for the one boundary the operator is paid to judge, so the
 *      crop's edge stops depending on a luminance accident;
 *   2. the denah, so page identity is answered by a SHAPE and not by comparing
 *      digits (`denah.tsx` carries that argument in full);
 *   3. the bagian's name, in the packet's own mono voice, in the kop, because
 *      nobody should re-read to know which field they are ruling on;
 *   4. what the field is supposed to be, and above all what it is NOT, one
 *      question mark away at the end of that name;
 *   5. the decision controls, attached to the picture, below it, left-aligned
 *      to it, never in a deck aimed at something off screen;
 *   6. the citation, then the transcript on demand.
 *
 * THE HEADER IS ONE BAR NOW, NOT A PARAGRAPH. It used to carry the mark, the
 * field name, the WHOLE of `catatan` (`adalah` plus `bukan`, three or four
 * lines of prose) and the state word above the picture: roughly 136px of
 * reading before the first crop, on every plate, on a sheet that holds
 * twenty-four of them. What is left in the bar is only what a different order
 * would print differently: the name, the state, and the completeness figure.
 *
 * `SlotDef.catatan` had never been on screen in any version of this app. The
 * specification the operator is asked to apply lived in the repository and not
 * in front of the person applying it, which is the cheapest defect in the whole
 * slice. It is optional in the type and it is read defensively here: a slot
 * without one renders nothing, and no empty question mark, rather than falling
 * back to `SlotDef.hint`, which is English written for the model.
 *
 * BOTH ITS HALVES SIT IN ONE HINT, AT THE END OF THE NAME THEY DEFINE.
 * `adalah` restates what the field name has already said; `bukan` names the
 * plausible look-alike, which is the disambiguation the operator actually
 * applies and the reason this product exists. Neither one varies: both read
 * word for word the same on every order, which is exactly the test `chrome.tsx`
 * sets for what may hide behind a question mark. `bukan` was drawn in the
 * right-hand column for one pass, and an operator's verdict on that pass was
 * that the screen shows too much at once, so a paragraph of specification
 * beside every picture is the first thing that has to go. It is one keystroke
 * or one tap away, on the name it describes, rather than deleted.
 *
 * WHAT MAY NEVER FOLLOW IT BEHIND A DISCLOSURE: the reason a control is
 * refusing to work, a fault, and the citation. Each of those is a measurement
 * of THIS rectangle and would read differently on a different run.
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
 * citation and its advisories all still on screen. Nothing is hidden by
 * collapsing, only made smaller, so the length of the sheet reports how much
 * work is left.
 *
 * THE MARK STANDS WITH THE VERBS. Terima leaves a paraf, so the paraf is drawn
 * in its ruled box in the same row as the button that produces it, and it stays
 * at 40% opacity until `saveRun` resolves: the decision and the proof that it
 * reached disk are one gesture in one place. It cannot live in the kop beside
 * the state word, because `.lt-mark-box` paints itself in its own status hue,
 * which on a coloured bar is the bar's own hue.
 *
 * THE CITATION IS COMPRESSED, NOT HIDDEN. It was four labelled rows of a
 * register under every picture; it is the page figure plus three ruled kotak
 * now, which is the same data in a quarter of the height. It may not go behind
 * a disclosure: it is a measurement of THIS rectangle, and so are the
 * advisories under it.
 *
 * THE SAME SPLIT RUNS THROUGH THE SENTENCE UNDER THE BUTTONS. Three of the four
 * things it used to say are the reason a control on this screen is refusing to
 * work right now (the crop has not been cut yet, its page is no longer in the
 * pekerjaan, its page will not open however long you wait), so all three stay
 * on screen. The fourth, that "Bukan ini" throws the usulan away and sends the
 * bagian to the outstanding list, is identical under every proposal on every
 * order and describes no fault at all, so it sits behind a hint on the button
 * it is about.
 */

import { useId, useRef, useState } from "react";

import type { SlotDef } from "@/lib/forms/template";
import type { Box } from "@/lib/pipeline/render";
import type { Citation } from "@/lib/ui/evidence";
import { citeZone, resolvePage } from "@/lib/ui/evidence";
import type { BrowserRun, SlotState } from "@/lib/ui/runtime";
import type { SlotAggregate, SlotAggregateStatus } from "@/lib/ui/slots";
import { captureLabel, ordinalOf } from "@/lib/ui/slots";

import {
  Advisory,
  Btn,
  CiteAdvisories,
  Hint,
  Mark,
  STATUS_MEANING,
  StateWord,
  shortenFileName,
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

/** What the kop reports about the block under it. */
type Owes = "decision" | "fault" | undefined;

function owedBy(status: SlotAggregateStatus, faulted: boolean): Owes {
  if (faulted || status === "outstanding") return "fault";
  if (status === "proposed" || status === "partial") return "decision";
  return undefined;
}

/**
 * What the field is NOT, inside the hint on the field's own name.
 *
 * This is the half of `catatan` the operator actually applies: the failure this
 * product is organised against is a crop of a plausible LOOK-ALIKE, and the
 * look-alike is exactly what this line names. The leading word is supplied here
 * unless the template already wrote it, so both spellings of the copy read the
 * same.
 *
 * It carries no colour of its own. `.lt-hint-panel` already sets the panel's
 * body to `--ink-2` and its `strong` to full ink at 600, so the emphasis is the
 * panel's, not this component's.
 */
function Bukan({ text }: { text: string }) {
  const alreadyLed = /^bukan\b/i.test(text);
  return (
    <p>
      {alreadyLed ? null : <strong>Bukan </strong>}
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

/**
 * The mount's own inset, both sides: 12px of mat, 12px of stage padding and the
 * stage's 1px edge, so 25 a side and 50 across. The cap is a limit on the
 * PICTURE, so the frame has to ask for that much more than the picture may be,
 * or a 70vh cap quietly becomes 70vh minus the mount.
 *
 * IT WAS 54, WHICH IS THE SAME ARITHMETIC OVER A 3px STAGE EDGE. The stage
 * wears a 1px hairline now -- a solid block is separated by its fill and only
 * needs its edge described -- and this number did not follow it, so every crop
 * on the sheet was mounted 4px wider than its own cap allowed. Small, and the
 * kind of small that is invisible until somebody re-derives the wrong figure
 * from it. If `.lt-stage`'s border or either padding moves, this moves with it.
 */
const MOUNT_INSET_PX = 50;

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
 *
 * THE MOUNT IS IDENTICAL IN ALL FOUR CONDITIONS. A crop that has not been cut
 * yet, and one that never will be, sit on the same stage at the same size, so
 * nothing on the plate moves when the picture lands.
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
  const mount = {
    width: "100%",
    maxWidth: `min(calc(${limit.width} + ${MOUNT_INSET_PX}px), calc(${limit.height} * ${w / h} + ${MOUNT_INSET_PX}px))`,
  };
  const picture = { width: "100%", aspectRatio: `${w} / ${h}` };

  return (
    // The swap from reserved box to picture happens without any navigation, so
    // it is announced. `aria-busy` says which of the two is on screen.
    <div aria-live="polite" aria-busy={condition === "waiting"}>
      <div className="lt-stage" style={mount}>
        <div className="lt-mat">
          {condition === "ready" && url ? (
            /* NOTHING ROUNDS THE EVIDENCE. `overflow-hidden` clips the picture
               to this box's corner, and `.lt-mat .lt-paper` in `globals.css` is
               what makes that corner `--sheet-corner` (2px) rather than the
               block radius a full sheet takes: a crop is a photograph of a
               document, its own edge is the boundary the operator is paid to
               judge, and 20px rounds about 1250 square pixels off each corner
               of a 300 DPI crop. Checked here rather than assumed, because the
               rule is a DESCENDANT selector and it is this element it has to
               reach. */
            <div className="lt-paper overflow-hidden" style={picture}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a blob
                  URL cut in this tab from a document that must never leave it;
                  next/image would want a loader and a remote pattern. */}
              <img src={url} alt={alt} className="block h-full w-full" />
            </div>
          ) : condition === "unrenderable" ? (
            /* Same family as `broken`: the picture is not coming. Different
               sentence, because the cause is different and the operator can act
               on knowing which. Hatched rather than lit, for the reason
               below.

               THE CORNER IS THE SHEET'S, and the three stand-ins take it by
               hand because their own classes are shaped for elsewhere: a hatch
               carrying words is a block and rounds to 20px, a well is a control
               and rounds to 14px, and either one inside an 8px mat runs the
               nest backwards -- the innermost box rounder than the mount
               holding it. The claim above this component is that the mount is
               IDENTICAL in all four conditions, and a corner that changes when
               the picture lands is that claim being not quite true. */
            <div
              className="lt-hatch text-gap grid place-items-center rounded-[var(--sheet-corner)] p-4 text-center text-[0.8125rem]"
              style={picture}
            >
              Halaman gagal dibuka
            </div>
          ) : condition === "broken" ? (
            /* NOT paper, and not the waiting trough either. A crop whose page
               the run no longer holds will never arrive, and drawing it as a
               blank lit sheet would invent exactly the picture this product
               exists to prevent: a plausible empty page. */
            <div
              className="lt-hatch text-gap grid place-items-center rounded-[var(--sheet-corner)] p-4 text-center text-[0.8125rem]"
              style={picture}
            >
              Halamannya sudah tidak ada
            </div>
          ) : (
            /* Recessed, not paper: a crop that has not been cut yet is not a
               document lying on the table, and a white rectangle here would
               read as a blank scan. */
            <div
              className="lt-well text-ink-2 grid place-items-center rounded-[var(--sheet-corner)] p-4 text-center text-[0.8125rem]"
              style={picture}
            >
              Menyiapkan potongan
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * WHERE THIS CROP CAME FROM, compressed into ruled boxes.
 *
 * It was four labelled rows of a register, which is a paragraph of reference
 * material under a picture the operator is meant to be looking at. Every value
 * here is a figure quoted out of a document, so every one of them sits in a
 * kotak isian in the document's own mono voice, and the whole block is two
 * wrapped lines.
 *
 * THE PAGE STAYS LARGE and alone above the boxes. It is the value this
 * product's failure class is named after, and twelve plates down the sheet put
 * twelve of them in one column, so a crop taken from the wrong page is a digit
 * that does not belong in a column of digits.
 *
 * `page` is the page's number INSIDE ITS OWN SOURCE FILE, never the run-global
 * index a zone is stored by. Those two numbering systems have already shipped a
 * wrong page reference once, in the xlsx exporter, and this is the only one of
 * them that helps a reviewer open the right document.
 *
 * "ukuran di halaman" KEEPS ITS WHOLE LABEL even though it is the longest one
 * here. It measures the region ON THE SCAN, not the picture as the exporter
 * places it: the docx fits images to the usable column, so the two agree only
 * while nothing is being scaled, and a number that silently stops describing
 * the deliverable is the failure class this product is organised against.
 */
function Sumber({
  cite,
  origin,
}: {
  cite: Citation | null;
  origin?: SlotState["origin"];
}) {
  // A zone whose page the run cannot resolve has no citation to print, and it
  // does not get a third sentence here saying so: the picture is already a
  // hatched "Halamannya sudah tidak ada" and the advisory beside the buttons
  // already carries the same fault WITH its remedy, at full strength, where the
  // control it disables is. Saying it a third time in a quieter voice is the
  // repetition the operator asked us to cut, not a second safety net.
  if (!cite) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="lt-label">halaman</span>
        <span className="lt-page-figure">{cite.page}</span>
        <span className="lt-label">dari {cite.pagesInDoc}</span>
      </div>

      {/* EACH LABEL TRAVELS WITH ITS OWN BOX. The row wraps at a 20rem aside,
          and a bare sequence of labels and boxes wraps between them, which
          leaves "ukuran di halaman" at the end of one line and its figure at
          the start of the next. A label separated from the value it names is
          worse than either alone. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2">
          <span className="lt-label">berkas</span>
          <span className="lt-kotak" title={cite.source}>
            {shortenFileName(cite.source, 24)}
          </span>
        </span>

        <span className="flex items-center gap-2">
          <span className="lt-label">baris</span>
          <span className="lt-kotak">
            {cite.lines ? (
              <>
                {cite.lines[0]}
                {"-"}
                {cite.lines[1]} ({cite.lineCount})
              </>
            ) : (
              "digambar sendiri"
            )}
          </span>
        </span>

        <span className="flex items-center gap-2">
          <span className="lt-label">ukuran di halaman</span>
          <span className="lt-kotak">{cite.size}</span>
        </span>

        {/* Provenance was a sentence under the register: "Area ini usulan
            model, jadi masih perlu Anda periksa." Its second half is what the
            state word in the kop already says, and its first half is one fact
            about where the rectangle came from, which is a value in a box.
            It is dropped when the baris box has already said it: a zone drawn
            over free pixels carries no line range, so "digambar sendiri" is
            printed there, and the same two words twice in one row of boxes
            reads as a bug rather than as two facts. */}
        {origin && (cite.lines || origin === "llm") ? (
          <span className="flex items-center gap-2">
            <span className="lt-label">asal</span>
            <span className="lt-kotak">
              {origin === "human" ? "digambar sendiri" : "usulan model"}
            </span>
          </span>
        ) : null}
      </div>
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
 *
 * `lt-disclose` is what draws the chevron. A bare `summary` renders the
 * browser's own triangle, which is the most reliable sign on the web that
 * nobody styled the page.
 */
function Transcript({ text }: { text?: string }) {
  const empty = !text || text.trim() === "";
  return (
    <details className="lt-disclose lt-well max-w-[80ch] px-4 py-2 text-[0.8125rem]">
      <summary>Teks di area ini</summary>
      <p className="text-ink-2 mt-2">
        Teks bisa benar walaupun kotaknya salah halaman. Putuskan dari
        gambarnya.
      </p>
      {empty ? (
        <p className="mt-2">Tidak ada teks yang terbaca.</p>
      ) : (
        <pre className="lt-figure mt-2 max-h-48 overflow-auto whitespace-pre-wrap">
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
 * the denah draws for a page nobody has searched), the state is the `Mark` in
 * the decision strip below, and the sentence is `STATUS_MEANING`, defined once
 * in `chrome.tsx` so no screen invents its own wording for a state. It stands
 * on the stage a crop would stand on, because an empty mount is the honest
 * picture of a bagian with no evidence.
 */
function Absence({ status }: { status: SlotState["status"] }) {
  return (
    <div className="lt-stage flex flex-wrap items-center gap-4">
      <Missing height={104} label="Belum ada gambar untuk bagian ini" />
      <p className="max-w-[46ch]">{STATUS_MEANING[status]}</p>
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
  maxOrdinal,
  saving,
  justDecided,
  forceExpanded,
}: {
  run: BrowserRun;
  state: SlotState;
  slotIndex: number;
  fieldLabel: string;
  thumbUrl?: string;
  /** Set when this capture's PAGE would not render, so no crop is coming. */
  thumbFailure?: string;
  actions: PlateActions;
  /** Only when the slot holds several captures; otherwise the kop says it. */
  showState: boolean;
  /** This capture's own number within its slot, when there are several. */
  ordinal: number | null;
  /** The slot's highest capture ordinal, for `captureLabel`'s `total`. */
  maxOrdinal: number;
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
  // them may go behind a hover. The unrenderable one has to say that the
  // picture is NOT COMING, which is the whole point of telling the operator
  // apart from the loading state they used to be left in. The fourth sentence
  // that used to live here, about what "Bukan ini" costs, is not a fault and
  // does not vary, so it moved onto the button as a hint.
  const fault = waiting
    ? "Tunggu potongannya tampil sebelum memutuskan."
    : broken
      ? "Halamannya sudah tidak ada di pekerjaan ini. Gambar ulang, atau Bukan ini."
      : unrenderable
        ? "Halaman gagal dibuka, jadi potongannya tidak akan muncul. Gambar ulang dari halaman lain, atau Bukan ini."
        : null;

  const expandToggle =
    settled && state.zone && !forceExpanded ? (
      <Btn onClick={() => setOverride(!expanded)}>
        <Potongan />
        {expanded ? "Perkecil" : "Perbesar"}
      </Btn>
    ) : null;

  return (
    <div
      ref={rowRef}
      tabIndex={-1}
      aria-label={ordinal ? captureLabel(fieldLabel, ordinal) : fieldLabel}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
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

          {/* THE DECISION STRIP, attached to the picture and left-aligned to
              it. The mark leads it because the mark is what these verbs leave
              behind: Terima draws the paraf into that box, and the stroke stays
              at 40% opacity until the write resolves. */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Mark
                  status={state.status}
                  drawing={justDecided}
                  saved={!saving}
                />
                {showState ? (
                  <>
                    <StateWord status={state.status} />
                    {/* WHICH OF THE SLOT'S CAPTURES THIS IS, as a label and a
                        ruled box rather than as one run of mono. It is a figure
                        a reader compares -- 1 of 2 against 2 of 2, down a
                        stacked pair -- which is the kotak isian's whole job,
                        and it is the same label-then-box pair `Sumber` prints
                        three of a few centimetres to the right. One family, one
                        roundness, one weight. */}
                    {ordinal ? (
                      <span className="flex items-center gap-2">
                        <span className="lt-label">potongan</span>
                        <span className="lt-kotak">
                          {ordinal}/{maxOrdinal}
                        </span>
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {state.status === "proposed" ? (
                  <>
                    <Btn
                      tone="primary"
                      className="px-6"
                      disabled={waiting || broken || unrenderable}
                      onClick={() => decide(() => actions.onAccept(slotIndex))}
                    >
                      <Paraf />
                      Terima
                    </Btn>
                    <Btn
                      onClick={() => decide(() => actions.onRedraw(slotIndex))}
                    >
                      <Potongan />
                      Gambar ulang
                    </Btn>
                    {/* The button and its hint travel together, so a wrapping
                        row cannot leave the question mark stranded beside a
                        different control. */}
                    <span className="flex items-center gap-2">
                      <Btn
                        tone="reject"
                        disabled={waiting}
                        onClick={() =>
                          decide(() => actions.onReject(slotIndex))
                        }
                      >
                        <Coretan />
                        Bukan ini
                      </Btn>
                      <Hint label="Penjelasan Bukan ini">
                        Usulan ini dibuang, dan bagian ini masuk ke daftar yang
                        belum ditemukan.
                      </Hint>
                    </span>
                  </>
                ) : null}

                {state.status === "confirmed" ? (
                  <>
                    <Btn
                      onClick={() => decide(() => actions.onRedraw(slotIndex))}
                    >
                      <Potongan />
                      Gambar ulang
                    </Btn>
                    <Btn
                      onClick={() => decide(() => actions.onReopen(slotIndex))}
                    >
                      Batalkan, periksa lagi
                    </Btn>
                  </>
                ) : null}

                {state.status === "outstanding" ||
                state.status === "pending" ? (
                  <>
                    <Btn
                      onClick={() => decide(() => actions.onRedraw(slotIndex))}
                    >
                      <Potongan />
                      Gambar sendiri
                    </Btn>
                    <Btn
                      onClick={() => decide(() => actions.onUnfill(slotIndex))}
                    >
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
            </div>

            {fault ? <Advisory>{fault}</Advisory> : null}

            {/* A picture on screen under a slot that ships blank is this
                product's failure class inverted: it looks accepted and the
                deliverable carries an empty cell. `onUnfill` patches the status
                and leaves the zone, and `planExport` only places `confirmed`
                captures, so the contradiction is real and has to be said. */}
            {state.status === "unfilled" && state.zone ? (
              <Advisory>
                Potongan ini tidak masuk ke berkas hasil. Buka lagi kalau Anda
                ingin memakainya.
              </Advisory>
            ) : null}
          </div>

          {state.zone && expanded ? <Transcript text={state.text} /> : null}
        </div>

        {state.zone ? (
          <aside className="flex min-w-0 flex-col gap-4">
            {/* Kept at both sizes, and mounted like the crop it belongs to. A
                wrong page is recognised from the SHAPE of the plan before
                anything is read, and that is as true of a capture somebody
                already accepted as of one waiting on them. */}
            <div className="lt-mat w-fit">
              <Denah
                page={resolved?.page ?? null}
                cut={state.zone.box}
                size={expanded ? "md" : "sm"}
                label={denahLabel}
              />
            </div>

            <Sumber cite={cite} origin={state.origin} />
            <CiteAdvisories cite={cite} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A fillable bagian the run holds NO state for at all.
 *
 * WHAT USED TO LAND HERE AND NO LONGER CAN. This rendered once per capture
 * `SlotDef.crops` declared and the run had not filled -- which, on the ToP
 * row, meant a permanent "Bagian ini butuh 2 potongan dan yang ini belum ada"
 * over a contract holding one ToP. That is the operator report this feature
 * comes from, and the declaration behind it is gone: a lanjutan is discovered,
 * so there is no such thing as a capture that is owed before anything has
 * looked.
 *
 * The case that remains is real and different: a stored run that outlived the
 * slot list which made it, so the template declares a bagian this run has
 * never seen. It has no position in `run.slots` to act on, so the only honest
 * offer is to draw it.
 */
function MissingCapture({ onDraw }: { onDraw: () => void }) {
  return (
    <div className="lt-stage flex flex-wrap items-center gap-4">
      <Missing height={104} label="Potongan ini belum ada" />
      <div className="flex max-w-[46ch] flex-col items-start gap-2">
        <p>
          Belum pernah dicari di pekerjaan ini. Jalankan Proses lagi, atau
          gambar sendiri areanya.
        </p>
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
   * operator and the work. They are not slabs either, and for the same reason:
   * a slab is a block that owes an answer. The hatch is kept, small, because a
   * deliberately blank cell is still a cell that is blank ON THE RECORD.
   */
  if (!entry.def.fillable) {
    return (
      /* A hairline, not a 2px rule: `--line` separates content and a heavy
         border used as decoration is the stamped edge the material rejects. */
      <div className="border-line flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="lt-hatch h-4 w-8 shrink-0" aria-hidden="true" />
          <h3 className="lt-figure text-ink-2 text-[0.875rem] font-bold">
            {label}
          </h3>
        </div>
        <p className="lt-note">Diisi manual setelah ekspor</p>
      </div>
    );
  }

  const { adalah, bukan } = readCatatan(entry.def.catatan);

  // A bagian the run holds nothing for at all. See `MissingCapture`: this is
  // now only a stored run that outlived its template, never a capture the form
  // declared and nobody searched for.
  const missing = entry.states.length === 0;
  const multi = entry.states.length > 1;

  /**
   * A capture whose page the run cannot resolve, or whose page will not render,
   * is a FAULT IN THIS BLOCK, and the kop is where a block reports one. It is
   * worked out here as well as inside the row because the bar has to be red
   * before the operator has scrolled far enough to read the sentence that
   * explains it.
   */
  const faulted = entry.states.some((placed) => {
    const zone = placed.state.zone;
    if (!zone) return false;
    return (
      citeZone(run, zone) === null ||
      Boolean(thumbs.failed[String(placed.index)])
    );
  });
  const owes = owedBy(entry.status, faulted);

  return (
    <article aria-labelledby={headingId} className="lt-slab">
      {/* ONE HEADER BAR, and everything on it varies from order to order: which
          bagian this is, which state it is in, and whether it is short a
          picture. The definition that used to sit under it is one question mark
          away, at the end of the name it defines. */}
      <div className="lt-kop" data-owes={owes}>
        {/* The question being asked, in the packet's own mono voice, with the
            hint at the END OF THAT NAME rather than at the far end of the bar.
            The two travel in one group for a reason: with the heading alone set
            to grow, the question mark was pushed across the kop and came to
            rest beside the state word, where it reads as an explanation of the
            state rather than of the field. */}
        <div className="flex min-w-0 items-center gap-2">
          <h3 id={headingId} className="lt-figure min-w-0">
            {label}
          </h3>

          {/* THE WHOLE DEFINITION, one tap away. A slot the template gave no
              catatan renders no question mark at all rather than an empty
              one. */}
          {adalah || bukan ? (
            <Hint label={`Penjelasan ${label}`}>
              <div className="flex flex-col gap-2">
                {adalah ? <p>{adalah}</p> : null}
                {bukan ? <Bukan text={bukan} /> : null}
              </div>
            </Hint>
          ) : null}
        </div>

        {/* THE COMPLETENESS CLAIM, and the most consequential figure on the
            sheet: it is the difference between a packet that is finished and
            one that is silently short a picture. It is the only figure in this
            bar, so it survives a fast scroll. `lt-kop-right` is what puts it
            and the state word where every other kop in the product puts them.
            Both this group and the name group opposite are DIRECT children of
            the bar, which is what `.lt-kop[data-owes] > *` selects: a wrapper
            slipped between them and the kop would take the rebind with it and
            leave these two on the table's ink. */}
        <span className="lt-kop-right flex items-center gap-2">
          {multi ? (
            <span className="lt-figure">
              {entry.found} dari {entry.states.length} potongan
            </span>
          ) : null}
          <StateWord status={entry.status} />
        </span>
      </div>

      <div className="lt-slab-body flex flex-col gap-6">
        {entry.states.map((placed, i) => (
          <div
            key={`${entry.def.key}-${placed.index}`}
            /* The rule between two captures of one slot: a hairline, which is
               all `--line` is for. It divides two pictures of the same bagian,
               so it must not read as heavily as the kop that opens the block. */
            className={i > 0 ? "border-line border-t pt-6" : undefined}
          >
            <CaptureRow
              run={run}
              state={placed.state}
              slotIndex={placed.index}
              fieldLabel={label}
              thumbUrl={thumbs.urls[String(placed.index)]}
              thumbFailure={thumbs.failed[String(placed.index)]}
              actions={actions}
              showState={multi}
              ordinal={multi ? ordinalOf(placed) : null}
              maxOrdinal={entry.maxOrdinal}
              saving={pending.has(placed.index)}
              justDecided={fresh.has(placed.index)}
              forceExpanded={expanded}
            />
          </div>
        ))}

        {missing ? (
          <MissingCapture
            onDraw={() => actions.onDrawNew(entry.def.key, entry.def.label)}
          />
        ) : null}

        {/* THE HONEST HALF OF DROPPING THE DECLARED COUNT. Nothing asserts a
            lanjutan exists any more, so the risk moved from "asserts one that
            may not exist" to "may miss one that does". This is what closes it:
            a bagian nothing has looked past reads differently from one that has
            been checked and found to end where it ends. Its explanation moved
            out of a `title` attribute, which no touchscreen and no keyboard can
            reach, into a hint that all three can. */}
        {entry.unchecked > 0 ? (
          <p className="lt-note flex items-center gap-2">
            belum diperiksa lanjutannya
            <Hint label="Arti belum diperiksa lanjutannya">
              Proses belum memeriksa apakah blok ini bersambung ke halaman
              berikutnya.
            </Hint>
          </p>
        ) : entry.found > 0 ? (
          <p className="lt-note">diperiksa, tidak ada lanjutan</p>
        ) : null}
      </div>
    </article>
  );
}
