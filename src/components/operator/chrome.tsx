"use client";

/**
 * The small shared pieces of the operator screens.
 *
 * `Cite` is the one worth reading twice. The design calls the citation the
 * tell: a proposal citing the wrong page, or a range far longer than the
 * field warrants, has to read as wrong at a glance. So it is set as a fixed
 * stamp, always in the same order, always monospaced and tabular, so a wrong
 * page number breaks the column's rhythm rather than hiding in prose. The
 * counts are shown as counts, not adjectives, and the two things the operator
 * cannot be expected to compute -- whether the crop swallows the page, and
 * whether the page identity is even certain -- are called out in words.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { Citation } from "@/lib/ui/evidence";
import type { SlotAggregateStatus } from "@/lib/ui/slots";

export const STATUS_WORDS: Record<SlotAggregateStatus, string> = {
  pending: "not searched",
  proposed: "needs a decision",
  confirmed: "confirmed",
  partial: "part found",
  outstanding: "not found",
  unfilled: "ships empty",
};

export function Chip({
  status,
  children,
}: {
  status: SlotAggregateStatus;
  children?: ReactNode;
}) {
  return (
    <span className="lt-chip" data-status={status}>
      {children ?? STATUS_WORDS[status]}
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "default" | "primary" | "accept" | "reject";
};

export function Btn({ tone = "default", className, ...props }: BtnProps) {
  return (
    <button
      type="button"
      data-tone={tone}
      className={`lt-btn ${className ?? ""}`}
      {...props}
    />
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="lt-eyebrow">{children}</p>;
}

export function Cite({ cite }: { cite: Citation | null }) {
  if (!cite) {
    return (
      <p className="lt-mono text-xs" style={{ color: "var(--lt-gap)" }}>
        this zone points at a page the run no longer holds
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="lt-mono text-xs" style={{ color: "var(--lt-dim)" }}>
        <span style={{ color: "var(--lt-ink)" }}>{cite.source}</span>
        {"  ·  "}
        {cite.page}
        {"  ·  "}
        {cite.lines}
        {cite.lineCount > 0 ? `  ·  ${cite.lineCount} lines` : ""}
        {"  ·  "}
        {cite.size}
      </p>
      {cite.wholePage ? (
        <p className="lt-mono text-xs" style={{ color: "var(--lt-faint)" }}>
          the whole page, as this section is meant to capture it - check it is
          the right page
        </p>
      ) : cite.spansPage ? (
        <p className="lt-mono text-xs" style={{ color: "var(--lt-mark)" }}>
          covers {Math.round(cite.heightShare * 100)}% of the page - check it
          has not run on into a footer
        </p>
      ) : null}
    </div>
  );
}

/** Counts, not a percentage: the operator is accountable for each slot. */
export function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="flex flex-col">
      <span
        className="lt-mono text-lg leading-none"
        style={{ color: tone ?? "var(--lt-ink)" }}
      >
        {value}
      </span>
      <span className="lt-eyebrow mt-1">{label}</span>
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "stop";
  children: ReactNode;
}) {
  const color =
    tone === "stop"
      ? "var(--lt-gap)"
      : tone === "warn"
        ? "var(--lt-mark)"
        : "var(--lt-dim)";
  return (
    <p
      className="rounded-md px-3 py-2 text-sm"
      style={{
        color,
        border: `1px solid color-mix(in oklch, ${color}, transparent 60%)`,
        background: `color-mix(in oklch, ${color}, transparent 92%)`,
      }}
    >
      {children}
    </p>
  );
}
