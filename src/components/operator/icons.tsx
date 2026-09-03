/**
 * The icon set, hand-drawn for this product.
 *
 * THE RULE THAT MAKES THESE THIS PRODUCT'S RATHER THAN ANY PRODUCT'S:
 * A VERB ICON IS NEVER A PICTURE OF THE VERB. IT IS THE SHAPE OF WHAT THE VERB
 * LEAVES BEHIND.
 *
 * `Terima` leaves a paraf in the mark box, so the Terima button carries the
 * paraf, drawn from the same path constant the mark uses. `Bukan ini` leaves a
 * coretan, so it carries the coretan. `Kosongkan` leaves a double-ruled empty
 * cell, so it carries that. The button previews its own outcome, which is a
 * real information gain rather than decoration, and it is why this set contains
 * no pencil, no trash can, no tick in a circle and no chevron. Those are
 * pictures of verbs, which is exactly what makes a set look bought.
 *
 * THE SECOND RULE IS THE CORNER. A FOLDED corner means "a file the operator
 * supplied". A SQUARE corner means "a page inside the run". The fold is never
 * spent on decoration, so it stays worth reading.
 *
 * THE THIRD is that the page family is the denah halaman at icon scale. One
 * silhouette, `PAGE_D`, is reused by six marks and drawn at A4's ratio, the
 * same ratio `Missing` in denah.tsx already uses. Somebody who has read the
 * index rail for an hour knows how to read these before they meet one.
 *
 * COLOUR ARRIVES FROM THE CONTAINER. Every path is `currentColor` and no icon
 * may name `--mark` or `--gap` itself, so "one hue, one meaning" stays a
 * property of the system instead of a convention fourteen files must remember.
 * It also means an icon costs nothing when the design's promise comes true and
 * a finished packet is a screen with no saturated colour left on it: the marks
 * go quiet along with everything else.
 *
 * GRID AND WEIGHT, tight enough that a later addition does not look foreign:
 *
 *   - viewBox 0 0 20 20. Twenty, not twenty-four, because `Mark` in chrome.tsx
 *     is already drawn on a 20 grid and an icon beside a state mark has to be
 *     the same hand at the same scale.
 *   - Live area inset 1.5 on every side. Nothing outside 1.5 to 18.5.
 *   - stroke-width 1.5 with `vector-effect: non-scaling-stroke`, which pins the
 *     stroke at 1.5 DEVICE pixels at every size, so one path set serves 16px
 *     and 40px with no ladder of widths to keep in sync. This is the house
 *     idiom already: denah.tsx uses it for the unreadable-page rule.
 *   - Round joins always. Caps say what KIND of stroke it is: ROUND for a
 *     stroke a hand made (a paraf, a coretan, a magnifier handle), BUTT for a
 *     printed or ruled edge (a page edge, a table rule, a fold). Inherited, not
 *     invented: `Mark` already draws the paraf round and the double rule butt.
 *   - Two fills exist and there is no third: the knock-out tint at 0.14, which
 *     quotes `.lt-denah-cut`, and the solid flagged corner, which quotes
 *     `Mark`'s proposed triangle.
 *   - No two parallel strokes closer than 3.2 units, and no closed shape under
 *     3.2 on its short side. At the smallest size that is 2.6 device px of
 *     clear separation, which is what survives a 1366x768 panel at four in the
 *     afternoon. If a drawing will not fit above the floor, the drawing is
 *     wrong, not the floor.
 *
 * THREE SIZES AND ONLY THREE: 16 inside a control or beside a 13px label, 20 in
 * a ruled box so an icon and a state mark line up in one column, 40 for an
 * empty state or a drop target. A fourth size means a layout is wrong.
 *
 * WHAT MUST NOT GET AN ICON, because a set with no boundary becomes clip art:
 * the six slot states (Mark already gives them six shapes; a parallel icon
 * would be a second vocabulary for the same six facts), a page as such (the
 * denah IS the page), the phase nav (a numeral, a word, a fill, a weight and a
 * tab rule are already five channels for three items), a padlock on a locked
 * phase (the rule is that a disabled control shows its reason as prose), notice
 * tones (the left rule already carries them), every row of a homogeneous list
 * (an identical glyph on every row discriminates nothing), a glyph per slot or
 * per section (those names are the document's own voice quoted verbatim, and an
 * icon in front of a quotation is an annotation on somebody else's words), and
 * the crop advisories (an advisory earns attention by being the only
 * full-strength small text near the picture).
 */

import type { SVGProps } from "react";

/** A4 at icon scale, 0.71, the ratio `Missing` in denah.tsx draws from. */
const PAGE_D = "M4.5 2.2h11v15.5h-11z";

/**
 * The paraf, shared with `Mark` so the accept button and the confirmed mark
 * cannot drift apart. Imported by chrome.tsx rather than copied.
 */
export const PARAF_D =
  "M2.5 13.5c2.6 3.2 4.4 2.6 5.8-1.4C9.4 8.6 10 5.5 8.9 4.2 7.9 3 6.6 4.6 7.6 8.2c1 3.5 3.3 6 9.9 5";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: 16 | 20 | 40;
  /**
   * Set when the icon sits on top of a word that has already been read out,
   * which is almost every position here. Mirrors `Denah`'s prop name.
   */
  decorative?: boolean;
  label?: string;
};

function Icon({
  size = 16,
  decorative = true,
  label,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label })}
      {...rest}
    >
      {children}
    </svg>
  );
}

/**
 * The only icon whose job is to DELETE text from the screen rather than add
 * ink to it. Everything the density pass moved off the screen is reachable
 * through one of these.
 */
export function Tanya(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7.4" />
      <path d="M7.9 7.9c0-1.2 1-2.1 2.2-2.1 1.2 0 2.1.8 2.1 2 0 1.6-2.1 1.7-2.1 3.3" />
      <path d="M10.1 14.2v.01" strokeWidth={2} />
    </Icon>
  );
}

/** Terima, and Terima semua. Nothing else, ever: it promises what the click leaves. */
export function Paraf(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={PARAF_D} />
    </Icon>
  );
}

/** Bukan ini, and the struck row in the allowlist's sixty-second window. */
export function Coretan(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.4 16.6 16.6 3.4" />
    </Icon>
  );
}

/** Kosongkan. The double rule a clerk leaves in a cell that stays blank. */
export function Kosongkan(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={PAGE_D} strokeLinecap="butt" />
      <path d="M7 8.4h6M7 11.6h6" strokeLinecap="butt" />
    </Icon>
  );
}

/** The product's central object: a region cut out of a page. */
export function Potongan(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={PAGE_D} strokeLinecap="butt" />
      <rect
        x="6.8"
        y="7"
        width="6.9"
        height="4.6"
        rx="0.4"
        fill="currentColor"
        fillOpacity={0.14}
      />
    </Icon>
  );
}

/**
 * A whole-page capture, which the glossary calls tangkapan satu halaman and
 * which must never be confused with area di dalam halaman.
 */
export function HalamanUtuh(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={PAGE_D} strokeLinecap="butt" fill="currentColor" fillOpacity={0.14} />
    </Icon>
  );
}

/** A source PDF the operator supplied. The FOLD is what says "you gave me this". */
export function Berkas(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 2.2h6.6l4.4 4.4v11.1h-11z" strokeLinecap="butt" />
      <path d="M11.1 2.2v4.4h4.4" strokeLinecap="butt" />
    </Icon>
  );
}

/** The drop target, at 40. Replaces the foreign-grid glyph ingest-panel had. */
export function Muat(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 3v8.6" />
      <path d="M6.6 8.6 10 12l3.4-3.4" />
      <path d="M4 13.4v2.6a1.4 1.4 0 0 0 1.4 1.4h9.2a1.4 1.4 0 0 0 1.4-1.4v-2.6" strokeLinecap="butt" />
    </Icon>
  );
}

/**
 * Ya, ada berkas lain. The one moment in the flow where the operator decides
 * whether the job is finished, on a button that is otherwise a plain phrase
 * among plain phrases. Three legs at 4.4 apart, which is the density floor.
 */
export function Klip(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.4 9.1 8.6 14.9a3.1 3.1 0 0 1-4.4-4.4l6.6-6.6a2.1 2.1 0 0 1 2.9 2.9l-6.5 6.6a1 1 0 0 1-1.5-1.5l5.8-5.8" />
    </Icon>
  );
}

/** The DOKUMEN VALIDASI docx: a page with a second sheet behind it. */
export function Paket(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.9 4.6h8.6v13.1H6.9z" strokeLinecap="butt" />
      <path d="M4.5 15.4V2.3h8.2" strokeLinecap="butt" />
    </Icon>
  );
}

/** The EPIC order sheet: a page ruled into cells. 2x3, per the density floor. */
export function BukuKerja(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={PAGE_D} strokeLinecap="butt" />
      <path d="M4.5 7.4h11M4.5 12.5h11M10 7.4v10.3" strokeLinecap="butt" />
    </Icon>
  );
}

/** The Kunci ke baris toggle. Two states, one per value of snapMode. */
export function KunciKeBaris({ locked = true, ...props }: IconProps & { locked?: boolean }) {
  return (
    <Icon {...props}>
      <path d="M3.4 6.6h13.2M3.4 13.4h13.2" strokeLinecap="butt" />
      {locked ? (
        <path d="M6.6 9.2h6.8v1.6H6.6z" fill="currentColor" fillOpacity={0.14} />
      ) : (
        <path d="M7.4 10h5.2" strokeDasharray="1.6 2" />
      )}
    </Icon>
  );
}

/** Proses, and Proses lagi. It must appear on both or on neither. */
export function Cari(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8.8" cy="8.8" r="5.3" />
      <path d="M12.7 12.7 16.8 16.8" />
      <path d="M6.8 7.6h4M6.8 10h2.6" strokeWidth={1} strokeLinecap="butt" />
    </Icon>
  );
}

/**
 * Riwayat: the pekerjaan already saved on this device.
 *
 * NOT A CLOCK, and not an arrow curling backwards. Both are pictures of TIME,
 * and time is not what an operator is looking for here: they are looking for a
 * job they worked on, in a drawer of jobs. So it is the drawer. Three page
 * edges seen from the side, the front one whole, which is what a stack of
 * finished dockets looks like from where you stand when you go to find one.
 *
 * The corners are square, which under this file's second rule means "a page
 * inside the run" rather than a file somebody supplied. That is right: a
 * pekerjaan is not one of the operator's files, it is the work built out of
 * them.
 */
export function Arsip(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.4 8.6h13.2v8.4H3.4z" strokeLinecap="butt" />
      <path d="M4.9 6.1h10.2M6.4 3.6h7.2" strokeLinecap="butt" />
      <path d="M8.4 11.6h3.2" strokeLinecap="butt" />
    </Icon>
  );
}

/**
 * Dismiss a dialog.
 *
 * The set's rule is that a verb icon is the shape of what the verb leaves
 * behind, and closing leaves nothing, so this is the one member that is simply
 * chrome. It is here anyway rather than borrowed from a library, because the
 * alternative was one import of lucide-react for one glyph, which is a
 * dependency, a second drawing hand and a second grid for a mark that is four
 * line segments. Round caps: a stroke a hand made.
 */
export function Tutup(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.6 5.6 14.4 14.4M14.4 5.6 5.6 14.4" />
    </Icon>
  );
}
