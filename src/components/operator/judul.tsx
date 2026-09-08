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
 * ## Buttons, not drag
 *
 * Reordering by dragging a heading is the obvious gesture and it is
 * unavailable to a keyboard, to a screen reader, and to anyone whose hand is
 * unsteady on a laptop trackpad at four in the afternoon. Two keys and a
 * printed position do the same work and can be pressed by anything.
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

import { useId, useState } from "react";
import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NodeId } from "@/lib/forms/overlay";
import type {
  HeadingCost,
  HiddenSection,
  Provenance,
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

  const remove = () => {
    void onEdit({ tag: "remove-section", id: section.id })
      .then(() => {
        setAsking(false);
        // Only a hide that took nothing with it is offered back, because
        // "Kembalikan" restores the heading and never the potongan. Saying so
        // here would be a promise the foot of the sheet cannot keep.
        if (cost.captures === 0 && !cost.added) onHidden(section);
      })
      // The fault is an Interruption in the sticky header. Leaving the dialog
      // open over it would hide the only sentence explaining the refusal.
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
            if (cost.captures > 0 || cost.added) {
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
