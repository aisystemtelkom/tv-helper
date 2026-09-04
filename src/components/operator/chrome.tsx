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

import { Popover } from "@base-ui/react/popover";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

import { PARAF_D, Tanya } from "./icons";

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
      d={PARAF_D}
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
  /**
   * WHY THIS CONTROL WILL NOT ANSWER, shown on hover and on focus instead of
   * printed beside it.
   *
   * The rule has not changed: a disabled control never appears without its
   * reason available. What changed is where. The reason used to be a sentence
   * in the layout next to the key, and an operator's objection was that those
   * sentences "are redundant too. The user know they can't proceed since the
   * button is already disabled". They are right about the ordinary case: the
   * key is down, that reads as unavailable, and a paragraph restating it is
   * furniture on every screen forever.
   *
   * So the reason moves onto the control, where it costs nothing until it is
   * wanted. It reaches a pointer, a keyboard (the wrapper is focusable, which
   * a disabled button is not) and a screen reader (`aria-describedby`), so no
   * modality loses it.
   *
   * ONLY USE THIS FOR A REASON THAT IS ROUTINE. A refusal, a fault, or
   * anything the operator must act on still belongs on the page in prose:
   * `Interruption` exists for those and does not go away until it is dealt
   * with. The test is the same one `toast.tsx` states: may the operator miss
   * this entirely and be no worse off.
   */
  reason?: string;
};

export function Btn({ tone = "default", on, className, reason, ...props }: BtnProps) {
  const key = (
    <button
      type="button"
      data-tone={tone}
      data-on={on ? "true" : undefined}
      className={`lt-btn ${className ?? ""}`}
      {...props}
    />
  );

  // The wrapper exists only while the reason is live. A disabled element
  // receives no pointer events in any browser, so the hover has to belong to
  // something around it; wrapping unconditionally would put a focusable span
  // in the tab order beside every enabled control in the product.
  const disabled = props.disabled === true || props["aria-disabled"] === "true";
  if (!reason || !disabled) return key;
  return <Sebab reason={reason}>{key}</Sebab>;
}

/**
 * A hover-and-focus explanation attached to something that cannot be clicked.
 *
 * Separate from `Hint` because `Hint` IS the trigger (a question mark the
 * operator goes to) and this one WRAPS a trigger that is already on screen and
 * already says something by being down.
 */
function Sebab({ reason, children }: { reason: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const grace = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const clear = useCallback(() => {
    if (grace.current !== null) {
      clearTimeout(grace.current);
      grace.current = null;
    }
  }, []);
  const leave = useCallback(() => {
    clear();
    grace.current = setTimeout(() => setOpen(false), 160);
  }, [clear]);
  const enter = useCallback(() => {
    clear();
    setOpen(true);
  }, [clear]);
  useEffect(() => clear, [clear]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        /* NOT A NATIVE BUTTON, AND IT CANNOT BE ONE. Base UI assumes a trigger
           is a `<button>` and warns when it is not, which is the right default
           and the wrong one here: this trigger WRAPS a disabled button, and a
           button inside a button is invalid HTML that browsers recover from
           unpredictably. Saying so explicitly is what turns a warning into a
           decision. */
        nativeButton={false}
        render={
          <span
            // Focusable, because the thing it wraps is not: a disabled button
            // is skipped by the tab order and receives no pointer events, so
            // without this the reason would be mouse-only. That is the single
            // failure this whole arrangement exists to avoid.
            tabIndex={0}
            aria-describedby={open ? id : undefined}
            className="inline-flex"
            onMouseEnter={enter}
            onMouseLeave={leave}
            onFocus={enter}
            onBlur={leave}
          />
        }
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        {/* `.lt-float` ON THE POSITIONER. It is the element Base UI gives a
            `transform`, which makes it a stacking context, so it is the only
            z-index the sticky header is ever compared against. See the note on
            `--z-float` in globals.css. */}
        <Popover.Positioner
          className="lt-float"
          side="top"
          align="center"
          sideOffset={8}
        >
          <Popover.Popup className="lt-hint-panel" id={id}>
            {reason}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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
        Area ini menunjuk ke halaman yang sudah tidak ada di order ini.
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

        {/* "di halaman", not bare "ukuran". This is the size of the REGION
            ON THE SCAN, which is what helps an operator judge whether the
            rectangle is a field or a whole block. It is deliberately not a
            claim about how large the picture lands in the docx: the exporter
            fits images to the usable column, so the two coincide today and
            will not once that placement changes. A number on this screen that
            silently stops describing the deliverable is the failure class this
            product is organised against, and the cheap defence is a label that
            says which of the two it is. */}
        <dt>ukuran di halaman</dt>
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
 *
 * IT IS `.lt-disclose`, NOT A HAND-STYLED `<details>`. A bare `<summary>`
 * renders the browser's own triangle, which is the most reliable sign on the
 * web that nobody styled a page, and this one shipped on the failure screens,
 * the sign-in refusals and the admin register, where the first thing an
 * operator meets is a page saying something went wrong. The class draws the
 * set's own chevron and owns the cursor, the size and the ink, so this
 * disclosure and the two on the review screens are one object rather than
 * three near-misses. It also lifts the summary out of `--ink-3`, which is the
 * floor ink for quiet TEXT and was never the right value for a control the
 * operator is meant to find and press.
 */
export function TechnicalDetail({ children }: { children: ReactNode }) {
  return (
    <details className="lt-disclose">
      <summary>Detail teknis</summary>
      <pre className="lt-well lt-figure mt-2 max-h-40 overflow-auto p-2 text-[0.8125rem] whitespace-pre-wrap">
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

/**
 * A question mark that answers a question, and the rule for what may go in one.
 *
 * THE RULE, AND IT IS LOAD-BEARING: a hint holds an EXPLANATION THAT NEVER
 * CHANGES. It never holds an observation about the crop in front of you.
 *
 * "Setiap potongan di sini adalah satu halaman penuh" reads identically on
 * every run and an operator has read it four hundred times, so it belongs
 * behind a mark they can point at when they want it. "Menutupi 87% halaman,
 * periksa apakah terbawa ke catatan kaki" is about THIS picture and is the
 * whole reason the screen exists, so hiding it behind a hover would be the
 * wrong-and-quiet failure delivered by the very control meant to tidy up. If
 * you are ever unsure which kind a sentence is, ask whether it would still be
 * true on a different run; if it would, it can hide.
 *
 * IT IS NOT HOVER-ONLY, and that is not politeness. A hover-only control does
 * not exist on a touchscreen and cannot be reached from a keyboard, so it opens
 * on hover, on focus and on tap: a real button with real state, not a `title`
 * attribute. Escape and an outside click close it, and it never steals focus
 * when it opens on hover, so an operator moving the pointer across the screen
 * does not lose their place.
 */
export function Hint({
  label = "Penjelasan",
  children,
}: {
  /** What the mark is called to a screen reader, when the default is not apt. */
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const grace = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (grace.current !== null) {
      clearTimeout(grace.current);
      grace.current = null;
    }
  }, []);

  // A short grace period on leaving, so the pointer can travel from the mark
  // to the panel without the panel disappearing under it.
  const leave = useCallback(() => {
    clear();
    grace.current = setTimeout(() => setOpen(false), 160);
  }, [clear]);

  const enter = useCallback(() => {
    clear();
    setOpen(true);
  }, [clear]);

  useEffect(() => clear, [clear]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <button
            type="button"
            className="lt-hint"
            aria-label={label}
            onMouseEnter={enter}
            onMouseLeave={leave}
            onFocus={enter}
            onBlur={leave}
          />
        }
      >
        <Tanya />
      </Popover.Trigger>
      <Popover.Portal>
        {/* `.lt-float` ON THE POSITIONER; see the twin above and `--z-float`.
            A Hint in a kop near the top of the page opens UPWARDS into the
            sticky header, which is the case that made this visible. */}
        <Popover.Positioner
          className="lt-float"
          side="top"
          align="start"
          sideOffset={8}
        >
          <Popover.Popup
            className="lt-hint-panel"
            onMouseEnter={enter}
            onMouseLeave={leave}
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
