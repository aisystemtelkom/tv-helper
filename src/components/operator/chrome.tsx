"use client";

/**
 * The shared pieces every operator screen is built from.
 *
 * Three of these carry the design's argument and are worth reading before
 * changing anything.
 *
 * `Mark` is the status system. Six states, SIX SHAPES, in one ruled box at one
 * size in one fixed position, so that printing the screen in greyscale or
 * handing it to a colourblind operator loses nothing: dashed and empty, a
 * flagged corner, a paraf, a split box, a struck diagonal, a double rule.
 * Colour is a second, redundant channel. `partial` is the state that ships a
 * packet which looks complete and is short a picture, so it can never borrow
 * `proposed`'s treatment: it is a visibly split box, which is a difference of
 * shape rather than of hue.
 *
 * `Paraf` is the mark a person makes, and IT DOES NOT FINISH UNTIL THE WRITE
 * DOES. The stroke draws on the click and sits at partial opacity until
 * IndexedDB has taken the decision; only then does it go solid. This codebase
 * already refuses stale writes and page-losing writes (`StaleRunWriteError`,
 * `PageLossError`) and until now the operator had no signal at all that a
 * decision reached disk, so "my mark is there" and "it is saved" were two
 * separate observations. They are one gesture now.
 *
 * `Cite` is the tell. It used to be a sentence: `SPLITBA.pdf · p 1/2 · L 0-7 ·
 * 8 lines · 6.3 x 2.5 in`, which buried the page number, the value this
 * product's failure class is named after, third in an undifferentiated grey
 * run. The page is now pulled out and set large, the rest is an aligned
 * register of tabular figures, and file names truncate IN THE MIDDLE because
 * real scan names in this domain differ at the tail.
 */

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

import type { Citation } from "@/lib/ui/evidence";
import type { SlotAggregateStatus } from "@/lib/ui/slots";

/**
 * The six states, in Bahasa Indonesia, defined once.
 *
 * The word and the verb that produced it must match: the button says
 * "Terima", so the state it produces says "Diterima".
 */
export const STATUS_WORDS: Record<SlotAggregateStatus, string> = {
  pending: "belum dicari",
  proposed: "perlu diputuskan",
  confirmed: "diterima",
  partial: "sebagian",
  outstanding: "tidak ditemukan",
  unfilled: "sengaja dikosongkan",
};

/** What each state means, for the places a screen has room to say it. */
export const STATUS_MEANING: Record<SlotAggregateStatus, string> = {
  pending: "Belum ada yang mencarikan bukti untuk bagian ini.",
  proposed: "Ada usulan yang menunggu keputusan Anda.",
  confirmed: "Anda sudah melihat buktinya dan menerimanya.",
  partial: "Sebagian potongan sudah terisi, sebagian belum.",
  outstanding: "Sudah dicari di seluruh dokumen, buktinya tidak ada.",
  unfilled: "Dikosongkan atas keputusan Anda, bukan karena terlewat.",
};

/**
 * The paraf: one pen stroke, the mark a person makes on a document.
 *
 * `drawing` plays it once, in answer to the operator's own click, and only
 * then. `saved` is what says the decision is on disk. A plate that merely
 * renders in a confirmed state gets neither, or a reload would replay a dozen
 * decisions nobody just made.
 */
export function Paraf({
  drawing = false,
  saved = true,
}: {
  drawing?: boolean;
  saved?: boolean;
}) {
  return (
    <path
      className="lt-paraf"
      data-fresh={drawing || undefined}
      d="M2.5 13.5c2.6 3.2 4.4 2.6 5.8-1.4C9.4 8.6 10 5.5 8.9 4.2 7.9 3 6.6 4.6 7.6 8.2c1 3.5 3.3 6 9.9 5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      opacity={saved ? 1 : 0.4}
      // `pathLength` normalises the path to 34 user units, so the dash array
      // and the offset in `globals.css` cover exactly one stroke whatever the
      // real geometry is. The cast is because `CSSProperties` has no index
      // signature for custom properties.
      style={{ "--paraf-length": 34 } as CSSProperties}
      pathLength={34}
    />
  );
}

/**
 * One state, as a shape in a ruled box.
 *
 * `drawing` and `saved` are only meaningful for `confirmed`; every other state
 * ignores them.
 */
export function Mark({
  status,
  drawing,
  saved = true,
  title,
}: {
  status: SlotAggregateStatus;
  drawing?: boolean;
  saved?: boolean;
  title?: string;
}) {
  return (
    <span
      className="lt-mark-box"
      data-status={status}
      role="img"
      aria-label={title ?? STATUS_WORDS[status]}
    >
      <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true">
        {status === "proposed" ? (
          /* A flagged corner. Colour alone (an amber outline against a grey
             one) is the distinction a tired operator misses on a 1366 panel at
             four in the afternoon, so the flag gives it a silhouette. */
          <path d="M20 0v7L13 0z" fill="currentColor" />
        ) : null}

        {status === "confirmed" ? (
          <Paraf drawing={drawing} saved={saved} />
        ) : null}

        {status === "partial" ? (
          <>
            <path d="M20 0v7L13 0z" fill="currentColor" />
            <line
              x1={10}
              y1={1}
              x2={10}
              y2={19}
              stroke="currentColor"
              strokeWidth={1}
            />
            <path
              d="M1.5 13c1.6 2 2.8 1.6 3.6-.9"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
            />
          </>
        ) : null}

        {status === "outstanding" ? (
          /* The coretan: a clerk voids a cell by striking it. */
          <line
            x1={2}
            y1={18}
            x2={18}
            y2={2}
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        ) : null}

        {status === "unfilled" ? (
          <>
            <line x1={3} y1={8.5} x2={17} y2={8.5} stroke="currentColor" strokeWidth={1.4} />
            <line x1={3} y1={11.5} x2={17} y2={11.5} stroke="currentColor" strokeWidth={1.4} />
          </>
        ) : null}
      </svg>
    </span>
  );
}

/** The state, said in words. Only two of the six are allowed a colour. */
export function StateWord({
  status,
  children,
}: {
  status: SlotAggregateStatus;
  children?: ReactNode;
}) {
  return (
    <span className="lt-state" data-status={status}>
      {children ?? STATUS_WORDS[status]}
    </span>
  );
}

/**
 * A clerk's stamp. The one place the interface generates uppercase, and it is
 * quoting a rubber stamp rather than labelling a block.
 */
export function Stamp({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className="lt-stamp" style={{ color: tone ?? "var(--ink-3)" }}>
      {children}
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "default" | "primary" | "reject";
  on?: boolean;
};

export function Btn({ tone = "default", on, className, ...props }: BtnProps) {
  return (
    <button
      type="button"
      data-tone={tone}
      data-on={on ? "true" : undefined}
      className={`lt-btn ${className ?? ""}`}
      {...props}
    />
  );
}

export function Title({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 className="lt-title" id={id}>
      {children}
    </h2>
  );
}

export function Lede({ children }: { children: ReactNode }) {
  return <p className="lt-lede">{children}</p>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="lt-note">{children}</p>;
}

/**
 * An advisory about the crop's own geometry.
 *
 * It wears no colour. Amber already means "a decision is owed here", and one
 * hue asked to mean act-on-this and be-suspicious-of-this at once teaches an
 * operator to read neither. This earns attention by being the only
 * full-strength small text near the picture, and it always ends in something
 * to do.
 */
export function Advisory({ children }: { children: ReactNode }) {
  return <p className="lt-advisory">{children}</p>;
}

/**
 * Shortens a file name FROM THE MIDDLE, never from the end.
 *
 * The scans in this domain discriminate at the tail:
 * `PKS_BANK_CONTOH_NUSANTARA_2026 (2).pdf` against `(3).pdf`. End-truncation
 * deletes exactly the characters that tell one from the other and leaves an
 * ellipsis where the answer was.
 */
export function shortenFileName(name: string, max = 34): string {
  if (name.length <= max) return name;
  const keepEnd = Math.max(10, Math.floor(max / 2));
  const keepStart = max - keepEnd - 1;
  return `${name.slice(0, keepStart)}…${name.slice(-keepEnd)}`;
}

/**
 * Where this crop came from.
 *
 * `page` is the page's number INSIDE ITS OWN SOURCE FILE, never the run-global
 * index a zone is stored by. Those two numbering systems have already shipped a
 * wrong page reference once, in the xlsx exporter, and this is the only one of
 * them that helps a reviewer open the right document.
 */
export function Cite({ cite }: { cite: Citation | null }) {
  if (!cite) {
    return (
      <p className="text-[0.8125rem]" style={{ color: "var(--gap)" }}>
        Area ini menunjuk ke halaman yang sudah tidak ada di pekerjaan ini.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="lt-label">halaman</span>
        <span className="lt-page-figure">{cite.page}</span>
        <span className="lt-label">dari {cite.pagesInDoc}</span>
      </div>

      <dl className="lt-register">
        <dt>berkas</dt>
        <dd title={cite.source}>{shortenFileName(cite.source)}</dd>

        <dt>baris</dt>
        <dd>
          {cite.lines ? (
            <>
              {cite.lines[0]}
              {"-"}
              {cite.lines[1]}{" "}
              <span style={{ color: "var(--ink-3)" }}>({cite.lineCount})</span>
            </>
          ) : (
            <span style={{ color: "var(--ink-3)" }}>digambar sendiri</span>
          )}
        </dd>

        <dt>ukuran</dt>
        <dd>{cite.size}</dd>
      </dl>
    </div>
  );
}

/** The advisories a citation carries, kept apart from the register itself. */
export function CiteAdvisories({ cite }: { cite: Citation | null }) {
  if (!cite) return null;
  return (
    <>
      {cite.wholePage ? (
        <Advisory>
          Satu halaman penuh, memang begitu bentuk bagian ini. Periksa apakah
          halamannya sudah benar.
        </Advisory>
      ) : cite.spansPage ? (
        <Advisory>
          Menutupi {Math.round(cite.heightShare * 100)}% halaman. Periksa apakah
          potongannya terbawa sampai ke catatan kaki.
        </Advisory>
      ) : null}

      {/* A sliced rectangle, said out loud. Gemini returns paragraph blocks
          rather than printed lines, so a multi-line block's lines get equal
          vertical bands: the text is measured, the top and bottom edges are
          arithmetic. The operator is the only one who can look at the crop and
          see whether the cut landed where the page actually breaks, so the
          count is shown rather than acted on. Nothing renders at zero, and a
          run ingested before the migration records no origin at all, so it
          counts none and shows none. */}
      {cite.interpolatedLines > 0 ? (
        <Advisory>
          {cite.interpolatedLines} dari {cite.lineCount} baris dipotong secara
          hitungan, bukan diukur. Periksa apakah tepi atas dan bawah memotong
          huruf.
        </Advisory>
      ) : null}
    </>
  );
}

/**
 * The one display figure in the product: how many decisions the operator still
 * owes. If a second number ever wants this size, one of the two is not an
 * instruction.
 */
export function OwedCount({ value }: { value: number }) {
  return (
    <span
      className="lt-count"
      style={{ color: value > 0 ? "var(--mark)" : "var(--ink-3)" }}
    >
      {value}
    </span>
  );
}

/**
 * A block that pushes the page down rather than overlaying it, so it cannot be
 * scrolled past.
 *
 * A refused save is not a tinted paragraph at the top of a scrolling column.
 * The operator has just made a decision that did not reach disk, and the only
 * honest presentation is one they have to walk past.
 */
export function Interruption({
  children,
  detail,
}: {
  children: ReactNode;
  /** Deployer-facing text: variable names, paths, a raw exception. */
  detail?: string;
}) {
  return (
    <div className="lt-band" role="alert">
      <div className="flex flex-col gap-2">
        <p className="max-w-[74ch] text-sm" style={{ color: "var(--ink)" }}>
          {children}
        </p>
        {detail ? <TechnicalDetail>{detail}</TechnicalDetail> : null}
      </div>
    </div>
  );
}

/**
 * The one pattern for text written for a DEPLOYER and shown to an OPERATOR.
 *
 * Environment variable names, file paths and raw exception strings never share
 * a paragraph with the sentence an operator is meant to act on. Both audiences
 * are real; they are not the same person.
 */
export function TechnicalDetail({ children }: { children: ReactNode }) {
  return (
    <details className="text-[0.8125rem]">
      <summary
        className="cursor-pointer select-none"
        style={{ color: "var(--ink-3)" }}
      >
        Detail teknis
      </summary>
      <pre className="lt-well lt-figure mt-2 max-h-40 overflow-auto p-2 text-[0.75rem] whitespace-pre-wrap">
        {children}
      </pre>
    </details>
  );
}

export function Notice({
  tone = "info",
  children,
  ...rest
}: {
  tone?: "info" | "warn" | "stop";
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
  return (
    <div className="lt-notice" data-tone={tone} {...rest}>
      {children}
    </div>
  );
}
