"use client";

/**
 * Screen 4: write the two deliverables.
 *
 * The screen's real job is to state what is about to be in them. Both files
 * open fine whether or not the evidence in them is right, and a validator may
 * sign the docx, so the last thing before the download is a manifest: how many
 * crops, which slots ship empty and under what standing, and which parts of
 * the workbook nothing filled in.
 *
 * Export is BLOCKED while any proposal is still unreviewed. That is the
 * design's rule -- the app never emits an unreviewed zone -- and it is enforced
 * here rather than left to the operator's discipline.
 */

import { useMemo, useState } from "react";

import type { HeaderFields } from "@/lib/export/docx";
import { AO_TEMPLATE } from "@/lib/forms/template";
import { deriveIdsFromFilenames } from "@/lib/pipeline/fields";
import { downloadBytes } from "@/lib/ui/crops";
import { deliverableNames, planExport } from "@/lib/ui/export";
import type { BrowserRun } from "@/lib/ui/runtime";
import { useRuntime } from "@/lib/ui/runtime-context";
import { progressOf } from "@/lib/ui/slots";

import { Btn, Chip, Eyebrow, Notice } from "./chrome";
import { STATUS_WORDS } from "./chrome";

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const sizeKb = (bytes: Uint8Array) =>
  `${Math.max(1, Math.round(bytes.byteLength / 1024))} KB`;

function Field({
  label,
  value,
  onChange,
  note,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  note?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="lt-eyebrow">{label}</span>
      <input
        className="lt-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {note ? (
        <span className="text-xs" style={{ color: "var(--lt-faint)" }}>
          {note}
        </span>
      ) : null}
    </label>
  );
}

export function ExportPanel({
  run,
  onGoToSheet,
}: {
  run: BrowserRun;
  onGoToSheet: () => void;
}) {
  const runtime = useRuntime();
  const derived = useMemo(
    () => deriveIdsFromFilenames(run.sources.map((s) => s.name)),
    [run.sources],
  );

  const [header, setHeader] = useState<HeaderFields>({
    idEpic: derived.idEpic,
    quote: derived.quote,
    namaProyek: "",
    cc: "",
    order: "",
    jenisOrder: AO_TEMPLATE.id,
  });
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "working"; done: number; total: number }
    | { kind: "built"; docx: Uint8Array; xlsx: Uint8Array }
    | { kind: "failed"; message: string }
  >({ kind: "idle" });

  const plan = useMemo(() => planExport(run, AO_TEMPLATE), [run]);
  const counts = progressOf(run, AO_TEMPLATE);
  const blocked = counts.proposed > 0;
  const names = deliverableNames(header, run.id);

  const set = (patch: Partial<HeaderFields>) =>
    setHeader((prev) => ({ ...prev, ...patch }));

  const write = async () => {
    setState({ kind: "working", done: 0, total: plan.crops.length });
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
      setState({ kind: "built", docx: files.docx, xlsx: files.xlsx });
    } catch (error) {
      setState({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {blocked ? (
        <Notice tone="stop">
          {counts.proposed} proposal{counts.proposed === 1 ? "" : "s"} still
          waiting on you. Nothing is exported until every zone has been looked
          at, because an unreviewed crop in a signed document is exactly what
          this step exists to prevent.{" "}
          <button
            type="button"
            className="underline"
            onClick={onGoToSheet}
            style={{ color: "inherit" }}
          >
            Back to the contact sheet
          </button>
        </Notice>
      ) : null}

      <section className="lt-card flex flex-col gap-4 p-5">
        <div>
          <Eyebrow>The header table</Eyebrow>
          <p className="pt-1 text-sm" style={{ color: "var(--lt-dim)" }}>
            Six text fields at the top of the document. ID EPIC and QUOTE are
            guesses read out of the file names, so check them rather than
            trusting them.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="ID EPIC"
            value={header.idEpic}
            onChange={(v) => set({ idEpic: v })}
            note="From the source file names."
          />
          <Field
            label="Nama Proyek"
            value={header.namaProyek}
            onChange={(v) => set({ namaProyek: v })}
            note="Left blank on purpose: extraction reliably answered with the framework contract's title instead of this order's."
          />
          <Field
            label="Quote"
            value={header.quote}
            onChange={(v) => set({ quote: v })}
            note="From the source file names."
          />
          <Field
            label="CC (customer)"
            value={header.cc}
            onChange={(v) => set({ cc: v })}
          />
          <Field
            label="Order"
            value={header.order}
            onChange={(v) => set({ order: v })}
            note="Blank in the sample."
          />
          <Field
            label="Jenis Order"
            value={header.jenisOrder}
            onChange={(v) => set({ jenisOrder: v })}
            note="AO is an Activation Order; MO modifies, DO deletes."
          />
        </div>
      </section>

      <section className="lt-card flex flex-col gap-3 p-5">
        <Eyebrow>What these files will contain</Eyebrow>
        <p className="lt-mono text-sm">
          {plan.crops.length} confirmed crop
          {plan.crops.length === 1 ? "" : "s"} · {plan.empty.length} slot
          {plan.empty.length === 1 ? "" : "s"} shipping empty
        </p>

        {plan.unresolved.length > 0 ? (
          <Notice tone="stop">
            {plan.unresolved.length} confirmed zone
            {plan.unresolved.length === 1 ? "" : "s"} point at a page this run
            no longer holds and will be dropped:{" "}
            {plan.unresolved.map((u) => u.key).join(", ")}
          </Notice>
        ) : null}

        {plan.empty.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {plan.empty.map((slot) => (
              <li
                key={slot.key}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <Chip status={slot.status}>{STATUS_WORDS[slot.status]}</Chip>
                <span style={{ color: "var(--lt-dim)" }}>{slot.label}</span>
                <span className="lt-mono" style={{ color: "var(--lt-faint)" }}>
                  {slot.key}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <Notice tone="warn">
          Column E of the workbook ships blank. The values that fill it are
          extracted text with a validated citation, and a browser run carries
          pages and zones only - it holds no extracted values. A blank cell is
          the honest output; a guessed one is the failure this project is
          organised against.
        </Notice>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Btn
            tone="primary"
            disabled={blocked || state.kind === "working"}
            onClick={() => void write()}
          >
            {state.kind === "working"
              ? `Cutting crop ${state.done} of ${state.total}...`
              : state.kind === "built"
                ? "Build them again"
                : "Build the two files"}
          </Btn>
          {state.kind === "built" ? (
            <>
              <Btn
                onClick={() =>
                  downloadBytes(names.docx, state.docx, DOCX_TYPE)
                }
              >
                Save {names.docx} ({sizeKb(state.docx)})
              </Btn>
              <Btn
                onClick={() =>
                  downloadBytes(names.xlsx, state.xlsx, XLSX_TYPE)
                }
              >
                Save {names.xlsx} ({sizeKb(state.xlsx)})
              </Btn>
            </>
          ) : null}
        </div>
        {state.kind === "built" ? (
          <p className="text-xs" style={{ color: "var(--lt-faint)" }}>
            Sizes are shown so an empty file is visible before it is filed. Both
            were written here in the browser; nothing was uploaded to build them.
          </p>
        ) : null}
        {state.kind === "failed" ? (
          <Notice tone="stop">Export failed: {state.message}</Notice>
        ) : null}
      </section>
    </div>
  );
}
