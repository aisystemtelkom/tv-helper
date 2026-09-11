"use client";

/**
 * THE JUDUL CONTROLS, on the lembar periksa and nowhere else.
 *
 * A judul is one heading of the DOKUMEN VALIDASI together with the bagian
 * under it. "This judul is not part of this order" is a judgement that forms
 * while an operator is looking at the sheet and reading what sits under each
 * heading, so the controls are ON THE SHEET. A manage-sections screen of its
 * own would ask for the same judgement twice: once there, in the abstract, and
 * again here when they see what it did.
 *
 * ## The cluster is ALWAYS PRESENT
 *
 * Never hover-only, never revealed by a menu. Four keys is not much furniture
 * next to a control an operator cannot reach from a keyboard at all, and the
 * whole set has to be reachable by Tab because a hover has no keyboard path
 * and no touch path either.
 *
 * ## Drag AND buttons, and the buttons are why the drag is allowed
 *
 * THIS HEADER USED TO READ "Buttons, not drag", and the file stopped agreeing
 * with it: `SusunanJudul` below ships the drag the operator asked for by name.
 * The old argument was not wrong and is not discarded -- dragging a heading is
 * unavailable to a keyboard, to a screen reader, and to anyone whose hand is
 * unsteady on a laptop trackpad at four in the afternoon -- so every one of
 * those paths is kept open THROUGH the gesture rather than around it. The
 * handle is a real `<button>`, ArrowUp and ArrowDown move a judul one place
 * from the keyboard, focus travels with the row it moved, and every move is
 * announced in a live region.
 *
 * AND `JudulBar`'S NAIKKAN AND TURUNKAN STAY, with the packet position printed
 * beside them. The drag is an ADDITION and never the only way through; taking
 * the two keys out because a drag now exists would be the refusal the old
 * paragraph named, one step later.
 *
 * ## The mono voice survives a rename
 *
 * `AGENTS.md` records that judul titles and bagian labels are set in the mono
 * DOCUMENT voice because they are transcriptions, "which is why nothing offers
 * to rename them today". The rule is kept and so is its meaning: a renamed
 * judul is still a quotation, of a different order's paperwork. So the title
 * stays mono before and after, THE INPUT THE OPERATOR TYPES INTO IS MONO
 * (`.lt-input` is set in `--font-figure` for exactly this), and the app's own
 * chrome around it -- keys, field labels, helper sentences, the confirmation
 * -- stays sans. And the app never invents a name: rename is seeded with what
 * is there, and Tambah judul starts empty behind a placeholder.
 *
 * ## Destructive acts ask in proportion
 *
 * A confirmation for a reversible act teaches the operator to click through
 * the ones that matter, so hiding a base judul that carries no evidence is one
 * step and a toast. Everything that cannot be undone -- potongan the operator
 * accepted, a name they typed -- gets the dialog, and the destructive key
 * itself carries the number so the count cannot be missed by somebody reading
 * only the buttons.
 */

import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NodeId } from "@/lib/forms/overlay";
import {
  removalNeedsDialog,
  removeSectionEdit,
  type HeadingCost,
  type HiddenSection,
  type Provenance,
} from "@/lib/ui/headings";
import type { SectionEdit } from "@/lib/ui/runtime";

import { Btn, shortenFileName } from "./chrome";

/** What every control here does with an edit: hand it over and wait for disk. */
export type SectionEditor = (edit: SectionEdit) => Promise<void>;

/* ------------------------------------------------------------------ *
 * The inline field.
 * ------------------------------------------------------------------ */

/**
 * A NAME, TYPED IN FLOW. Not a dialog.
 *
 * A dialog for a rename covers the thing being renamed, which is the one piece
 * of information the operator needs while typing: what the heading currently
 * says, and what sits under it. The field opens where the name is, pushes the
 * rest of the sheet down while it is open, and closes when the write lands.
 *
 * THE TYPED VALUE SITS AT 40% UNTIL THE SAVE RESOLVES, which is `Paraf`'s own
 * `drawing`/`saved` convention (`chrome.tsx`) applied to text instead of to a
 * pen stroke. This codebase refuses stale, page-losing and capture-losing
 * writes; a rename that reached the screen and not the disk would otherwise
 * look exactly like one that landed.
 *
 * A FAILED SAVE KEEPS THE FIELD OPEN, with the operator's words still in it.
 * The fault itself is an `Interruption` in the sticky header, which does not
 * leave until it is dealt with; closing the field as well would throw away
 * what they typed while telling them something went wrong.
 */
function NameField({
  label,
  helper,
  placeholder,
  initial,
  submitLabel = "Simpan",
  onSubmit,
  onCancel,
}: {
  /** "Judul" or "Nama bagian": the app naming its own field, so sans. */
  label: string;
  helper: string;
  placeholder?: string;
  /** Seeded with what is there. Empty only where there is nothing to seed. */
  initial: string;
  submitLabel?: string;
  onSubmit: (value: string) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const blank = value.trim().length === 0;

  const submit = () => {
    if (blank || saving) return;
    setSaving(true);
    void onSubmit(value)
      // Nothing on success: the caller closes this field by unmounting it, and
      // clearing `saving` on an unmounted component is a warning for no gain.
      .catch(() => setSaving(false));
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="lt-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        // Mono, from `.lt-input` itself: the operator is writing in the
        // document's voice, and what they type is printed as a heading.
        className="lt-input max-w-[42rem]"
        value={value}
        placeholder={placeholder}
        disabled={saving}
        style={{ opacity: saving ? 0.4 : 1 }}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Escape leaves without saving. It is the same promise "Batal"
          // makes, available to the hand that is already on the keyboard.
          if (event.key === "Escape" && !saving) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <p className="max-w-[74ch] text-[0.8125rem] text-ink-2">{helper}</p>
      <div className="flex flex-wrap gap-2">
        <Btn
          type="submit"
          tone="primary"
          disabled={blank || saving}
          reason={
            blank
              ? "Judul tanpa kata tercetak sebagai ruang kosong di DOKUMEN VALIDASI."
              : "Nama ini sedang disimpan."
          }
        >
          {submitLabel}
        </Btn>
        <Btn disabled={saving} reason="Tunggu sampai nama ini tersimpan." onClick={onCancel}>
          Batal
        </Btn>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Provenance.
 * ------------------------------------------------------------------ */

/**
 * ONE LINE, AND ONLY UNDER A JUDUL THAT IS NOT THE FORM'S OWN.
 *
 * A judul the form declares and nobody renamed says nothing: a line under
 * every heading announcing that it came with the product is furniture on every
 * order forever. The three cases that do print are each a fact the operator
 * cannot recover from anywhere else on the screen -- who wrote this heading,
 * or what it used to be called.
 */
function ProvenanceLine({ provenance }: { provenance: Provenance }) {
  if (provenance.kind === "declared") return null;

  return (
    <p className="text-[0.8125rem] text-ink-2">
      {provenance.kind === "human" ? (
        "Judul ini Anda buat sendiri."
      ) : provenance.kind === "llm" ? (
        provenance.sourceName ? (
          `Judul ini usulan AI dari ${shortenFileName(provenance.sourceName, 34)}.`
        ) : (
          "Judul ini usulan AI."
        )
      ) : (
        <>
          {"asalnya: "}
          {/* The form's own transcription, quoted, so it stays in the
              document's voice exactly as the heading above it does. */}
          <span className="lt-figure">{provenance.wasCalled}</span>
        </>
      )}
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Removing a judul.
 * ------------------------------------------------------------------ */

/**
 * The dialog, for the two removals that cannot be taken back.
 *
 * IT NAMES THE NUMBER ON THE DESTRUCTIVE KEY ITSELF. "Hapus judul" beside a
 * paragraph mentioning four potongan is a button an operator can press having
 * read only buttons; "Hapus judul dan 4 potongannya" cannot be.
 */
function HapusJudulDialog({
  open,
  onOpen,
  title,
  cost,
  onConfirm,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  title: string;
  cost: HeadingCost;
  onConfirm: () => void;
}) {
  const { captures, confirmed } = cost;

  /*
   * THREE SENTENCES FOR THREE LOSSES, and the middle one is the case the brief
   * did not name. A judul can hold potongan that carry evidence and that
   * NOBODY HAS ACCEPTED YET: usulan waiting on a decision. Removing those is
   * not free -- the evidence goes and the search has to be paid for again --
   * so it is not the toast path, and telling the operator they are losing
   * potongan "yang sudah Anda terima" when they accepted none would be a
   * number they can see is wrong, which costs the warning its authority.
   */
  const body =
    captures === 0
      ? cost.origin === "human"
        ? "Nama yang Anda ketik tidak bisa dikembalikan."
        : "Judul ini tidak bisa dikembalikan."
      : confirmed === captures
        ? `Judul ini memuat ${captures} potongan yang sudah Anda terima. Menghapus judul ini membuang potongan itu dari berkas hasil, dan itu tidak bisa dibatalkan.`
        : confirmed === 0
          ? `Judul ini memuat ${captures} potongan yang belum Anda putuskan. Menghapus judul ini membuang potongan itu dari berkas hasil, dan itu tidak bisa dibatalkan.`
          : `Judul ini memuat ${captures} potongan, ${confirmed} di antaranya sudah Anda terima. Menghapus judul ini membuang potongan itu dari berkas hasil, dan itu tidak bisa dibatalkan.`;

  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogContent closeLabel="Batal">
        <DialogHeader>
          <DialogTitle>
            {"Hapus judul "}
            {/* The heading is quoted, so it is set in the document's voice
                inside a sentence written in the app's. */}
            <span className="lt-figure">{title}</span>
            {"?"}
          </DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Btn onClick={() => onOpen(false)}>Batal</Btn>
          <Btn tone="reject" onClick={onConfirm}>
            {captures === 0
              ? "Hapus judul"
              : `Hapus judul dan ${captures} potongannya`}
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * The cluster.
 * ------------------------------------------------------------------ */

export type JudulSubject = { id: NodeId; title: string };

/**
 * The four keys, the packet position, and the provenance line.
 *
 * THE POSITION IS PRINTED BECAUSE THE SHEET IS NOT IN PACKET ORDER. The lembar
 * periksa puts the judul that ask for work above the ones that ship blank, so
 * "Naikkan" routinely swaps a judul past a neighbour in the other group and
 * nothing on screen moves. The figure is what changes then, and it is the
 * thing being edited: a judul's place in the DOKUMEN VALIDASI. See
 * `packetPosition` in `src/lib/ui/headings.ts`.
 */
export function JudulBar({
  section,
  position,
  total,
  provenance,
  cost,
  divided = true,
  onEdit,
  onHidden,
}: {
  section: JudulSubject;
  /** 1-based place in the packet. */
  position: number;
  total: number;
  provenance: Provenance;
  cost: HeadingCost;
  /**
   * Whether the bar rules itself off from what follows. True at the head of a
   * slab, where the bagian are underneath it; false on a row that already
   * carries its own rule, because two hairlines a few pixels apart read as a
   * mistake rather than as a boundary.
   */
  divided?: boolean;
  onEdit: SectionEditor;
  /** Called after a recoverable hide lands, so the sheet can offer the undo. */
  onHidden: (section: JudulSubject) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [asking, setAsking] = useState(false);

  /*
   * THE NUMBER THE OPERATOR AGREED TO TRAVELS WITH THE REMOVAL.
   *
   * `cost` is arithmetic over the run THIS TAB IS HOLDING; the write lands on
   * whatever is STORED, which a background ingest advances once per page for
   * minutes at a time. A judul that held nothing when these keys were drawn can
   * hold a confirmed potongan by the time this fires, and the branch below
   * would then skip the dialog entirely and delete the evidence without ever
   * asking. `removeSectionEdit` sends `cost.captures` as the ceiling so the
   * engine can refuse the difference; see its own comment for why every
   * storage guard is satisfied by that write and none of them can catch it.
   *
   * ZERO IS SENT, not omitted. "No dialog was shown" is the agreement that
   * matters most here: they agreed to lose nothing.
   */
  const remove = () => {
    void onEdit(removeSectionEdit(section.id, cost))
      .then(() => {
        setAsking(false);
        // Only a hide that took nothing with it is offered back, because
        // "Kembalikan" restores the heading and never the potongan. Saying so
        // here would be a promise the foot of the sheet cannot keep.
        if (!removalNeedsDialog(cost)) onHidden(section);
      })
      // The fault is an Interruption in the sticky header. Leaving the dialog
      // open over it would hide the only sentence explaining the refusal. That
      // includes the refusal this edit's own ceiling produces: the sentence
      // says the order changed underneath and asks them to look again, and it
      // has to be readable without a dialog over it.
      .catch(() => setAsking(false));
  };

  const rule = divided ? "border-b border-line" : "";

  if (renaming) {
    return (
      <div className={`${rule} pb-4`}>
        <NameField
          label="Judul"
          helper="Teks ini yang tercetak sebagai judul di DOKUMEN VALIDASI."
          initial={section.title}
          onSubmit={(title) =>
            onEdit({ tag: "rename-section", id: section.id, title }).then(() =>
              setRenaming(false),
            )
          }
          onCancel={() => setRenaming(false)}
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${rule} pb-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="lt-kotak">
          judul ke-{position} dari {total}
        </span>
        <Btn data-flat="true" onClick={() => setRenaming(true)}>
          Ganti nama
        </Btn>
        <Btn
          data-flat="true"
          disabled={position <= 1}
          reason="Judul ini sudah paling atas di DOKUMEN VALIDASI."
          onClick={() => void onEdit({ tag: "move-section", id: section.id, by: -1 })}
        >
          Naikkan
        </Btn>
        <Btn
          data-flat="true"
          disabled={position >= total}
          reason="Judul ini sudah paling bawah di DOKUMEN VALIDASI."
          onClick={() => void onEdit({ tag: "move-section", id: section.id, by: 1 })}
        >
          Turunkan
        </Btn>
        {/* NOT `tone="reject"`. Red means a fault or a refusal and is absent
            from a healthy screen; a delete key on every judul would put it on
            all of them, permanently. The dialog's own primary key is the red
            one, which is where the act actually happens. */}
        <Btn
          data-flat="true"
          onClick={() => {
            if (removalNeedsDialog(cost)) {
              setAsking(true);
              return;
            }
            remove();
          }}
        >
          Hapus judul
        </Btn>
      </div>

      <ProvenanceLine provenance={provenance} />

      <HapusJudulDialog
        open={asking}
        onOpen={setAsking}
        title={section.title}
        cost={cost}
        onConfirm={remove}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A bagian's own row label.
 * ------------------------------------------------------------------ */

/**
 * "Ganti nama" for one bagian, beside the bagian rather than under it.
 *
 * IT COSTS NO VERTICAL SPACE, and that is why it is placed rather than
 * stacked. Eleven fillable bagian on the sample's form times a 44px line each
 * is half a screen of chrome on the primary surface, on a sheet whose whole
 * argument is that the evidence gets the space. Beside the row it fits inside
 * the height the row already has.
 *
 * The field, when it opens, takes the full width UNDER the bagian: a name is
 * typed while looking at the potongan it belongs to, so the potongan may not
 * be pushed off screen or squeezed into a column beside a text field.
 */
export function BagianName({
  slotKey,
  label,
  onEdit,
  children,
}: {
  /** `SlotDef.key`, which is what `rename-slot` addresses. */
  slotKey: string;
  label: string;
  onEdit: SectionEditor;
  /** The bagian itself: its plate, or its collapsed rows. */
  children: ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        {renaming ? null : (
          <Btn
            data-flat="true"
            className="shrink-0"
            aria-label={`Ganti nama bagian ${label}`}
            onClick={() => setRenaming(true)}
          >
            Ganti nama
          </Btn>
        )}
      </div>

      {renaming ? (
        <NameField
          label="Nama bagian"
          helper="Teks ini yang tercetak sebagai nama bagian di DOKUMEN VALIDASI."
          initial={label}
          onSubmit={(next) =>
            onEdit({ tag: "rename-slot", id: slotKey, label: next }).then(() =>
              setRenaming(false),
            )
          }
          onCancel={() => setRenaming(false)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The foot of the sheet.
 * ------------------------------------------------------------------ */

/**
 * A judul this order has that the form does not.
 *
 * THE PLACEHOLDER IS AN INSTRUCTION, NOT AN EXAMPLE. "Salin judul dari
 * halaman" says where the words come from: the document in front of the
 * operator. The app inventing a name here is the one thing it must not do,
 * because a heading it made up is a heading nobody transcribed.
 *
 * The note under it is the fact that decides whether this control is any use:
 * an added judul is always whole-page captures taken by hand. It cannot be
 * searched, and `AddedSection` carries no `layout` field precisely so that
 * nothing can make it searchable without a hint and a gate run behind it.
 */
export function TambahJudul({ onEdit }: { onEdit: SectionEditor }) {
  const [adding, setAdding] = useState(false);

  if (!adding) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Btn tone="primary" onClick={() => setAdding(true)}>
          Tambah judul
        </Btn>
        <p className="text-[0.8125rem] text-ink-2">
          Judul yang Anda tambahkan diisi dengan tangkapan satu halaman.
        </p>
      </div>
    );
  }

  return (
    <NameField
      label="Judul"
      helper="Judul yang Anda tambahkan diisi dengan tangkapan satu halaman."
      placeholder="Salin judul dari halaman"
      initial=""
      submitLabel="Simpan"
      onSubmit={(title) =>
        onEdit({ tag: "add-section", title }).then(() => setAdding(false))
      }
      onCancel={() => setAdding(false)}
    />
  );
}

/* ------------------------------------------------------------------ *
 * The packet's running order.
 * ------------------------------------------------------------------ */

/** One live reorder gesture. Never a stored thing: it dies on pointerup. */
type Drag = {
  pointerId: number;
  /** Where the row started, as an index into `rows`. */
  from: number;
  /** Where it would land if the gesture ended now. */
  to: number;
  /** How far the row is painted from its resting place, in pixels. */
  dy: number;
  /** Where inside the row the operator took hold of it. */
  grab: number;
  startY: number;
};

/** The handle belonging to one judul, looked up inside the list itself. */
function handleFor(list: HTMLOListElement | null, id: NodeId) {
  return (
    list?.querySelector<HTMLButtonElement>(
      `[data-judul-handle="${CSS.escape(id)}"]`,
    ) ?? null
  );
}

/**
 * SUSUNAN JUDUL: what is in this order's DOKUMEN VALIDASI, and in what order.
 *
 * The operator asked for it in one sentence: *"after upload, show a list of the
 * juduls of the order, with dragable to reorder and an TAMBAH button, that's
 * where the user add new juduls for the dokumen tambahan."* So it sits at the
 * top of the lembar periksa, directly under the upload section, and it is the
 * first thing they read once the berkas have been handed over.
 *
 * ## IT ADDS A VIEW, IT REPLACES NOTHING
 *
 * Every judul below still carries its own `JudulBar` -- Ganti nama, Naikkan,
 * Turunkan, Hapus judul -- and this list carries none of those. It answers the
 * one question the sheet below it cannot: the sheet is ordered by WHAT OWES
 * WORK, so the judul asking for a decision float above the ones that ship
 * blank and the packet's own running order is invisible there. `JudulBar`
 * prints its position as a figure for exactly that reason. This is the same
 * fact as a picture -- the order, drawn in order -- and the figure on each
 * handle is the same number `JudulBar` prints.
 *
 * A usulan is deliberately absent. An AI-proposed judul stays a separate accept
 * queue in the outstanding panel and joins this list only once a person has
 * stood behind it, so there is no Terima and no Tolak here. Arranging a packet
 * around a heading nobody has ruled on would be arranging it around a heading
 * that may not exist.
 *
 * ## THE DRAG IS HAND-ROLLED, ON POINTER EVENTS
 *
 * No dependency, and the shape is `zone-editor.tsx`'s: `setPointerCapture` on
 * pointerdown so a drag that leaves the handle stays alive, the live gesture in
 * a REF rather than in state because pointer events arrive faster than React
 * commits, and a `try`/`catch` around the capture because losing it is not a
 * reason to refuse the gesture.
 *
 * IT IS NOT MOUSE-ONLY, and that is a requirement rather than a courtesy. The
 * handle is a real `<button>`; ArrowUp and ArrowDown move the row one place
 * from the keyboard, focus travels with the row it moved, and every move is
 * announced in a polite live region. `JudulBar`'s Naikkan and Turunkan keys are
 * still there as well, so the gesture the operator asked for is an ADDITION and
 * never the only way through.
 *
 * ## WHAT THE DRAG DRAWS, AND WHAT IT REFUSES TO DRAW
 *
 * Two hues exist in this product and neither is available here. `--mark` means
 * a decision is owed, and a row under the operator's own finger owes nothing;
 * `--gap` is a fault. So the feedback is ELEVATION AND POSITION: the row
 * lightens to `--surface-lift`, takes the top-edge highlight that says "raised"
 * everywhere else in this system, takes `--line-strong` (the boundary of
 * something ACTIVE), and follows the pointer. No drop shadow, because `--lift`
 * belongs to paper alone and this row is not paper.
 *
 * THE OTHER ROWS DO NOT MOVE. A 2px ink rule is drawn where the row will land
 * instead. Displacing the neighbours is the commoner idiom and it needs every
 * row's height to be known and equal; these rows carry a title over a catatan
 * and are not. An insertion rule is exact at any height, it is one element, and
 * it cannot drift from the landing index it is drawn from, because both are
 * computed from the same number.
 *
 * ## THE WRITE HAPPENS ONCE, AT THE END
 *
 * `onReorder` takes the COMPLETE new order and is called on pointerup, never on
 * pointermove: a reorder is a stored edit against a run whose revision an
 * ingest advances once per page, and one per frame would be a queue of refused
 * writes. A drag that ends where it started calls nothing at all.
 */
export function SusunanJudul({
  rows,
  onReorder,
  onEdit,
}: {
  /** The judul this order actually prints, IN PACKET ORDER. */
  rows: readonly { id: NodeId; title: string; note: string }[];
  /**
   * Handed the complete new order of these same ids, and RETURNS THE WRITE.
   * The list speaks a move aloud only once this resolves, and takes no other
   * gesture while it is pending; see `submit`.
   */
  onReorder: (ids: NodeId[]) => Promise<void>;
  onEdit: SectionEditor;
}) {
  const list = useRef<HTMLOListElement | null>(null);
  /**
   * The live gesture, in a ref and mirrored into state.
   *
   * The ref is the truth: a `pointermove` reading a stale `null` from the
   * previous render would drop the drag in silence, which is `zone-editor.tsx`'s
   * recorded lesson. The state exists only so the rows repaint.
   */
  const gesture = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The judul whose handle should hold focus once the moved list comes back. */
  const refocus = useRef<NodeId | null>(null);
  const [said, setSaid] = useState({ seq: 0, text: "" });

  const say = (text: string) => setSaid((prev) => ({ seq: prev.seq + 1, text }));

  // React moves the DOM node when the order changes, and a moved node does not
  // reliably keep focus. Without this the SECOND arrow press goes nowhere,
  // because the handle the operator was standing on is no longer focused.
  useEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    handleFor(list.current, id)?.focus();
  }, [rows]);

  const rowEl = (id: NodeId) =>
    list.current?.querySelector<HTMLLIElement>(
      `[data-judul-row="${CSS.escape(id)}"]`,
    ) ?? null;

  /** The ids as they would stand with `from` moved to `to`. */
  const reordered = (from: number, to: number): NodeId[] => {
    const ids = rows.map((row) => row.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    return ids;
  };

  // The app's own voice, quoting the heading it moved. "judul ke-N dari M" is
  // `JudulBar`'s wording, because it is the same figure.
  const sentence = (from: number, to: number) =>
    `${rows[from].title} dipindahkan ke judul ke-${to + 1} dari ${rows.length}.`;

  /**
   * A reorder in flight.
   *
   * THE LIST IS NOT OPTIMISTIC, so while a write is travelling the rows on
   * screen are the arrangement BEFORE it. A second gesture computed off them
   * submits an arrangement that has already been superseded. Two presses in
   * one direction were harmless (the second arrives as the order already
   * stored and returns by identity), but ArrowDown then ArrowUp inside one
   * round trip left the judul a place away from where it started, with the
   * screen saying it had gone and come back. So one gesture at a time: the
   * next waits for this one to land.
   */
  const writing = useRef(false);

  /**
   * Hand the new arrangement over, and SPEAK ONLY ONCE IT HAS LANDED.
   *
   * This used to announce first and write second, so a refused reorder was
   * read out as done: a false sentence about the packet, delivered to exactly
   * the operator who cannot see the order stay put. The sentence is composed
   * BEFORE the write because `rows` is already the new arrangement by the time
   * it resolves.
   *
   * A refusal says nothing here. `editSections` has already put the reason in
   * the sticky header as an `Interruption`, and the rejection is swallowed so
   * it does not surface a second time as an unhandled one.
   */
  const submit = (from: number, to: number) => {
    const text = sentence(from, to);
    refocus.current = rows[from].id;
    writing.current = true;
    onReorder(reordered(from, to))
      .then(() => say(text))
      .catch(() => {
        // Nothing moved, so there is nothing to put focus back on.
        refocus.current = null;
      })
      .finally(() => {
        writing.current = false;
      });
  };

  const move = (from: number, by: -1 | 1) => {
    if (writing.current) return;
    const to = from + by;
    if (to < 0 || to >= rows.length) return;
    submit(from, to);
  };

  /**
   * Where the dragged row would land, counted against the neighbours' OWN
   * positions.
   *
   * Nothing but the dragged row is translated, so every other row's live
   * rectangle is still its resting one, and the new index is simply how many of
   * them sit above the dragged row's centre. Measured live rather than cached
   * at pointerdown, so a list that scrolls or reflows mid-gesture cannot skew
   * it.
   */
  const landingIndex = (from: number, centre: number): number => {
    let index = 0;
    rows.forEach((row, i) => {
      if (i === from) return;
      const el = rowEl(row.id);
      if (!el) return;
      const box = el.getBoundingClientRect();
      if (box.top + box.height / 2 < centre) index += 1;
    });
    return index;
  };

  const onHandleDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    from: number,
  ) => {
    // A secondary button is a context menu, not a drag.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Nor while the last arrangement is still being written: see `writing`.
    if (writing.current) return;
    const row = event.currentTarget.closest("li");
    if (!row) return;
    try {
      // Keeps the drag alive once the pointer leaves the handle, which it does
      // immediately. It throws if the pointer is already gone, and that is not
      // a reason to refuse the gesture.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* drag without capture */
    }
    const box = row.getBoundingClientRect();
    const next: Drag = {
      pointerId: event.pointerId,
      from,
      to: from,
      dy: 0,
      // Where inside the row they took hold of it, so the row does not jump to
      // centre itself under the pointer on the first move.
      grab: box.top + box.height / 2 - event.clientY,
      startY: event.clientY,
    };
    gesture.current = next;
    setDrag(next);
  };

  const onHandleMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const live = gesture.current;
    if (!live || event.pointerId !== live.pointerId) return;
    const moving = rows[live.from];
    const frame = list.current;
    const row = moving ? rowEl(moving.id) : null;
    if (!row || !frame) return;

    // The row's RESTING top, recovered from the rectangle it is painted at: a
    // transform moves the painted box and not the layout one, so this stays
    // right however far the gesture has already travelled.
    const box = row.getBoundingClientRect();
    const resting = box.top - live.dy;
    const bounds = frame.getBoundingClientRect();
    const dy = Math.max(
      bounds.top - resting,
      Math.min(
        event.clientY - live.startY,
        bounds.bottom - resting - box.height,
      ),
    );

    const next: Drag = {
      ...live,
      dy,
      to: landingIndex(live.from, event.clientY + live.grab),
    };
    gesture.current = next;
    setDrag(next);
  };

  const endDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    commit: boolean,
  ) => {
    const live = gesture.current;
    if (!live || event.pointerId !== live.pointerId) return;
    gesture.current = null;
    setDrag(null);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    // A gesture that ended where it started is not an edit. Writing one would
    // spend a run revision, and a toast, on nothing having happened.
    if (!commit || live.to === live.from) return;
    submit(live.from, live.to);
  };

  const single = rows.length < 2;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* Sentence case. Uppercase in this product quotes a document, and this
            heading is the app naming its own list. */}
        <h3 className="text-[0.875rem] font-bold text-ink">Susunan judul</h3>
        <span className="lt-kotak">{rows.length} judul</span>
      </div>

      <p className="max-w-[74ch] text-[0.8125rem] text-ink-2">
        {rows.length === 0
          ? "Belum ada judul di order ini. Tambahkan judul yang ada di dokumen Anda."
          : single
            ? "Urutan ini yang dipakai saat DOKUMEN VALIDASI dibuat."
            : /* THE NUMBER IS THE HANDLE, so the sentence names the number
                 rather than a grip glyph the operator has to recognise first.
                 `icons.tsx` rules out an identical glyph on every row of a
                 homogeneous list anyway, and the figure discriminates where a
                 grip would not: it is this judul's place in the packet. */
              "Urutan ini yang dipakai saat DOKUMEN VALIDASI dibuat. Geser nomor di sebelah kiri untuk memindahkan judul, atau tekan panah atas dan panah bawah."}
      </p>

      {rows.length > 0 ? (
        <ol
          ref={list}
          className="flex flex-col gap-2"
          // A drag that selects the headings it passes over leaves the sheet
          // striped on pointerup. Only while a gesture is live: text on a
          // resting list is worth being able to copy.
          // Both spellings. Safari still honours only the prefixed one, and
          // this has to behave on a teammate's Mac.
          style={
            drag ? { userSelect: "none", WebkitUserSelect: "none" } : undefined
          }
        >
          {rows.map((row, i) => {
            const lifted = drag?.from === i;
            // WHERE THE RULE GOES, counted among the rows that are NOT moving.
            // The dragged row still occupies its own slot, so its index cannot
            // be used to place a marker for itself, and every row below it
            // stands one place earlier in that reduced list.
            const settled = drag && i > drag.from ? i - 1 : i;
            const ruleAbove = drag !== null && !lifted && drag.to === settled;
            // LANDING LAST HAS NO ROW TO SIT ABOVE, so it is drawn under the
            // last row that is NOT moving -- which is the second to last one
            // when it is the last row itself being dragged. Reading it off
            // `rows.length - 1` unconditionally drew nothing at all in that
            // case, and the one gesture with no feedback would be the one that
            // ends where it started.
            const lastSettled =
              drag !== null && drag.from === rows.length - 1
                ? rows.length - 2
                : rows.length - 1;
            const ruleBelow =
              drag !== null &&
              !lifted &&
              i === lastSettled &&
              drag.to === rows.length - 1;

            return (
              <li
                key={row.id}
                data-judul-row={row.id}
                className="lt-row relative"
                style={
                  lifted && drag
                    ? {
                        // ELEVATION IN THIS SYSTEM'S OWN VOCABULARY: a lighter
                        // fill, the top-edge highlight that says a solid block
                        // is raised, and the boundary of something active. No
                        // drop shadow, because `--lift` belongs to paper alone,
                        // and no hue, because a row under the operator's finger
                        // owes no decision.
                        zIndex: 2,
                        transform: `translateY(${drag.dy}px)`,
                        background: "var(--surface-lift)",
                        borderColor: "var(--line-strong)",
                        boxShadow: "inset 0 1px 0 0 rgb(255 255 255 / 10%)",
                      }
                    : undefined
                }
              >
                {ruleAbove || ruleBelow ? (
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      // Inset to the row's own side padding, so the rule reads
                      // as belonging to the list rather than to the bench.
                      left: "0.85rem",
                      right: "0.85rem",
                      top: ruleAbove ? "-5px" : undefined,
                      bottom: ruleAbove ? undefined : "-5px",
                      height: "2px",
                      borderRadius: "2px",
                      // Ink, never amber: this marks a position, and a position
                      // is not a decision owed.
                      background: "var(--ink)",
                    }}
                  />
                ) : null}

                <div className="flex items-center gap-3">
                  <Btn
                    data-flat="true"
                    data-judul-handle={row.id}
                    className="h-11 w-11 shrink-0 px-0"
                    disabled={single}
                    reason="Hanya ada satu judul di order ini, jadi tidak ada yang bisa diurutkan."
                    // The whole phrase, because the figure on its own says
                    // nothing about what taking hold of it does, and the arrow
                    // keys are invisible to anybody who cannot see the cursor
                    // change.
                    aria-label={`Pindahkan judul ${row.title}, judul ke-${i + 1} dari ${rows.length}. Tekan panah atas atau panah bawah untuk memindahkan.`}
                    style={{
                      // Without this a touch drag scrolls the page instead of
                      // moving the row.
                      touchAction: "none",
                      cursor: single ? undefined : lifted ? "grabbing" : "grab",
                    }}
                    onPointerDown={(event) => onHandleDown(event, i)}
                    onPointerMove={onHandleMove}
                    onPointerUp={(event) => endDrag(event, true)}
                    onPointerCancel={(event) => endDrag(event, false)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                        return;
                      }
                      // The page scrolls on an arrow key otherwise, which moves
                      // the list out from under the row being moved.
                      event.preventDefault();
                      move(i, event.key === "ArrowUp" ? -1 : 1);
                    }}
                  >
                    <span className="lt-figure">{i + 1}</span>
                  </Btn>

                  <div className="flex min-w-0 flex-1 flex-col">
                    {/* The document's voice: a judul title is a transcription
                        of the operator's paperwork, and it stays mono through a
                        rename, because a renamed judul quotes a different
                        order's paperwork. */}
                    <span
                      className="lt-figure truncate text-[0.875rem] font-semibold text-ink"
                      title={row.title}
                    >
                      {row.title}
                    </span>
                    {row.note ? (
                      <span
                        className="truncate text-[0.8125rem] text-ink-2"
                        title={row.note}
                      >
                        {row.note}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {/* MOVED HERE FROM THE FOOT SLAB, at the operator's request: this list is
          where judul get added. The control itself is unchanged, and its old
          call site goes rather than being duplicated. */}
      <TambahJudul onEdit={onEdit} />

      {/* Keyboard and pointer feedback only. The list itself is visible, and a
          live region repeating it would read the packet twice. */}
      <div className="sr-only" role="status" aria-live="polite">
        <p key={said.seq}>{said.text}</p>
      </div>
    </section>
  );
}

/**
 * The judul this order is not printing, and the one key that brings one back.
 *
 * IT PROMISES THE NAME AND NOTHING ELSE. Removing a judul takes the potongan
 * under it, and restoring re-seeds those bagian as belum dicari; a row that
 * read "Kembalikan" with no qualification would be read as an undo of the
 * whole act. The sentence above the list is what stops that, and it is prose
 * on the page rather than a hint behind a mark, because an operator who misses
 * it presses a key expecting their evidence back.
 */
export function JudulDisembunyikan({
  rows,
  onEdit,
}: {
  rows: readonly HiddenSection[];
  onEdit: SectionEditor;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[0.875rem] font-bold text-ink">
        Judul yang disembunyikan ({rows.length})
      </h3>
      <p className="max-w-[74ch] text-[0.8125rem] text-ink-2">
        Judul ini tidak dicetak di DOKUMEN VALIDASI order ini. Kembalikan hanya
        mengembalikan judulnya; potongan yang ikut terbuang tidak kembali.
      </p>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line py-2 last:border-b-0"
          >
            <span className="lt-figure min-w-0 truncate text-[0.875rem] text-ink-2">
              {row.title}
            </span>
            <Btn
              data-flat="true"
              className="shrink-0"
              aria-label={`Kembalikan judul ${row.title}`}
              onClick={() => void onEdit({ tag: "restore-section", id: row.id })}
            >
              Kembalikan
            </Btn>
          </li>
        ))}
      </ul>
    </div>
  );
}
