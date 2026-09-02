"use client";

/**
 * DENAH HALAMAN: a plan of the page, with the crop knocked out of it.
 *
 * This is the one device in the redesign that answers the product's named
 * question, "is this the right page?", with A PICTURE instead of with a
 * better-typeset number.
 *
 * Every other improvement available here (a bigger page figure, tabular
 * columns, a register block instead of a dot-joined string) still asks the
 * operator to already know what page 8 of 27 should look like, and then to
 * compare digits. That is a read, not a glance, and the failure class is
 * precisely a plausible number that reads fine.
 *
 * A signature block, a Pasal table, a printed email and a covering letter have
 * completely different line patterns. Drawing every OCR line as a bar at its
 * true position on a page-shaped silhouette means the operator recognises the
 * wrong page from the SHAPE before reading anything, and a crop that ran on
 * into a running footer is a rectangle visibly touching the bottom of the
 * sheet. Stacked in a column, twelve of these turn a SYSTEMATIC failure (every
 * crop landing at the top of its page, or three captures citing one page) into
 * a pattern that cannot be missed, which is what the contact sheet has always
 * claimed to be for and has never delivered.
 *
 * IT IS FREE. `StoredPage` already carries `widthPx`, `heightPx` and
 * `lines[].box` in IndexedDB, so this is one inline SVG: no bitmap, no blob
 * URL, no canvas, no network, no model call.
 *
 * THE ONE WAY THIS DEVICE COULD LIE, and the reason `unreadable` exists: a
 * page whose OCR returned nothing has no bars, and a plan with no bars looks
 * exactly like a plan of a blank page. That would be a brand new
 * wrong-and-quiet surface built by the very thing meant to close one, so a
 * page with no lines is drawn as an OUTLINE with a struck rule and, where
 * there is room, the words. It never renders as an empty sheet.
 */

import type { Box } from "@/lib/pipeline/render";
import type { StoredPage } from "@/lib/ui/runtime";

type Size = "sm" | "md" | "lg";

const HEIGHT: Record<Size, number> = { sm: 34, md: 104, lg: 148 };

/**
 * A page is ~2480x3508 at 300 DPI and a line is ~40px tall, which is 1.1% of
 * the height: at a 34px rail glyph that is a third of a pixel and disappears.
 * Bars are floored so the pattern survives the smallest size, which is the
 * size the pattern matters most at.
 */
const MIN_BAR_SHARE = 0.007;

export function Denah({
  page,
  cut,
  size = "md",
  label,
  decorative = false,
}: {
  page: StoredPage | null | undefined;
  /** The zone's box in page pixels, drawn knocked out over the plan. */
  cut?: Box | null;
  size?: Size;
  /** Announced to assistive technology, which cannot read a silhouette. */
  label: string;
  /**
   * Set when the plan sits INSIDE a control that already names the thing, such
   * as a rail row whose button is labelled with the field and its page. The
   * glyph is then decoration on top of a label that has already been read out,
   * and announcing it again just makes the row twice as long to listen to.
   */
  decorative?: boolean;
}) {
  const height = HEIGHT[size];

  // No page at all: the zone points somewhere the run no longer holds. Say so
  // as a shape rather than rendering a plausible empty sheet.
  if (!page || page.widthPx <= 0 || page.heightPx <= 0) {
    return <Missing height={height} label={label} decorative={decorative} />;
  }

  const width = Math.round((page.widthPx / page.heightPx) * height);
  const minBar = page.heightPx * MIN_BAR_SHARE;
  const unreadable = page.lines.length === 0;

  return (
    <div className="relative shrink-0" style={{ width, height }}>
      <svg
        className="lt-denah"
        width={width}
        height={height}
        viewBox={`0 0 ${page.widthPx} ${page.heightPx}`}
        preserveAspectRatio="none"
        {...(decorative
          ? { "aria-hidden": true }
          : { role: "img", "aria-label": label })}
      >
        {page.lines.map((line) => (
          <rect
            key={line.i}
            className="lt-denah-line"
            x={line.box.x}
            y={line.box.y}
            width={Math.max(line.box.w, 1)}
            height={Math.max(line.box.h, minBar)}
          />
        ))}

        {unreadable ? (
          <line
            x1={0}
            y1={0}
            x2={page.widthPx}
            y2={page.heightPx}
            stroke="var(--gap)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}

        {cut ? (
          <rect
            className="lt-denah-cut"
            x={cut.x}
            y={cut.y}
            width={Math.max(cut.w, 1)}
            height={Math.max(cut.h, minBar)}
          />
        ) : null}
      </svg>

      {unreadable && size !== "sm" ? (
        <span
          className="absolute inset-x-0 bottom-1 text-center text-[0.625rem] leading-tight"
          style={{ color: "var(--gap)" }}
        >
          teks tidak
          <br />
          terbaca
        </span>
      ) : null}
    </div>
  );
}

/**
 * Drawn for a page the run no longer holds, and for the rail's `belum dicari`
 * state.
 *
 * It has to be a DIFFERENT SILHOUETTE from a page that was read and found
 * nothing, because on a fresh run every capture is in that state and a column
 * of identical empty rectangles is the first thing a new operator ever sees.
 * An outline with no bars means nobody has looked yet; an outline with a
 * struck rule means somebody looked and the page would not read.
 */
export function Missing({
  height = 104,
  label,
  decorative = false,
}: {
  height?: number;
  label: string;
  decorative?: boolean;
}) {
  // A4 in portrait, which is what every document in this domain is.
  const width = Math.round(height * (210 / 297));
  return (
    <div
      className="lt-hatch shrink-0"
      style={{ width, height }}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label })}
    />
  );
}
