"use client";

/**
 * Screen 1: take the PDFs and watch them being read.
 *
 * Reading a bundle of around thirty scanned pages takes minutes, so this
 * screen shows COUNTABLE progress: one tick per page, filled as that page is
 * committed. A spinner for minutes is indistinguishable from a hang, and a
 * smooth bar is a claim the app cannot actually make -- it only ever learns
 * about whole pages.
 *
 * The ticks lag the work on purpose. Four pages are read at once, but
 * `ingestPdf` releases them strictly in page order, because the order pages
 * arrive in is the order they are stored in and a zone's page number is a
 * position in that list. So the count is what is SAFELY STORED, not what has
 * finished -- which is the number an operator who closes the tab needs.
 */

import { useRef, useState } from "react";

import type { BrowserRun } from "@/lib/ui/runtime";

import { Btn, Eyebrow, Notice } from "./chrome";

export type IngestProgress = { name: string; done: number; total: number };

export function DocumentDrop({
  label,
  hint,
  disabled,
  onFiles,
}: {
  label: string;
  hint: string;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) =>
      f.name.toLowerCase().endsWith(".pdf"),
    );
    if (files.length > 0) onFiles(files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
      className="lt-card flex flex-col items-start gap-3 p-5"
      style={over ? { borderColor: "var(--lt-mark)" } : undefined}
    >
      <div>
        <Eyebrow>{label}</Eyebrow>
        <p className="pt-1 text-sm" style={{ color: "var(--lt-dim)" }}>
          {hint}
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
      <Btn
        tone="primary"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        Choose PDFs
      </Btn>
      <p className="text-xs" style={{ color: "var(--lt-faint)" }}>
        Or drop them here. Documents are read in this browser and never
        uploaded.
      </p>
    </div>
  );
}

function FilmStrip({ done, total }: { done: number; total: number }) {
  // Before the first page finishes the runtime has not said how many there
  // are. An empty rail is honest about that; a full-width bar at 0% would be
  // a claim about a total nobody knows yet.
  if (total <= 0) return <div className="lt-sunken h-3 w-full" />;

  return (
    <div
      className="lt-sunken flex h-3 w-full overflow-hidden p-0"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label="Pages read"
    >
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className="lt-tick"
          data-done={i < done}
          style={{ width: `${100 / total}%` }}
        />
      ))}
    </div>
  );
}

export function IngestPanel({
  run,
  progress,
  busy,
  error,
  onFiles,
}: {
  run: BrowserRun | null;
  progress: IngestProgress | null;
  busy: boolean;
  error: string | null;
  onFiles: (files: File[]) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <DocumentDrop
        label="Step 1 - the order bundle"
        hint="Every PDF that came with this order. They are rendered upright at 300 DPI and read page by page."
        disabled={busy}
        onFiles={onFiles}
      />

      {error ? <Notice tone="stop">{error}</Notice> : null}

      {progress ? (
        <div className="lt-card flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Eyebrow>Reading {progress.name}</Eyebrow>
            <p className="lt-mono text-sm">
              page {progress.done} of {progress.total}
            </p>
          </div>
          <FilmStrip done={progress.done} total={progress.total} />
          <p className="text-xs" style={{ color: "var(--lt-faint)" }}>
            Four pages are read at a time, and each one is saved as it lands.
            Leave this tab open: the PDF itself stays on this device, and the
            rendered pages are read by this app&apos;s own server.
          </p>
        </div>
      ) : null}

      {run && run.sources.length > 0 ? (
        <div className="lt-card flex flex-col gap-3 p-5">
          <Eyebrow>In this run</Eyebrow>
          <ul className="flex flex-col gap-1">
            {run.sources.map((source) => (
              <li
                key={source.id}
                className="lt-mono flex items-baseline justify-between gap-4 text-xs"
                style={{ color: "var(--lt-dim)" }}
              >
                <span style={{ color: "var(--lt-ink)" }}>{source.name}</span>
                <span>{source.pageCount} pages</span>
              </li>
            ))}
          </ul>
          <p className="lt-mono text-xs" style={{ color: "var(--lt-faint)" }}>
            {run.pages.length} pages read · {run.slots.length} slot captures
            tracked
          </p>
        </div>
      ) : null}
    </div>
  );
}
