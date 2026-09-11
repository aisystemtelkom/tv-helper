/**
 * WHAT DIFFERS BETWEEN TWO SPELLINGS OF ONE ISIAN.
 *
 * Konfig Excel draws the konfigurasi's value and the document's value one above
 * the other and asks the operator to rule on the pair. That works while the two
 * differ visibly. It stops working at the length real addresses run to: an
 * operator met a hundred characters of `Jalan Kemanggisan ...` against a
 * hundred characters of `Jalan Kemanggisan ...` whose only difference was a
 * space after `Kec.`, with `Terima` and `Tolak` under both and no way to tell
 * which key was right.
 *
 * So this module answers two questions about a pair of strings, and both
 * answers are arithmetic: WHERE they diverge, and WHAT KIND of divergence it
 * is. No model, no network, no React. It is called only on an entry the
 * comparison already judged `beda`, and it cannot change that verdict.
 *
 * ## IT EXPLAINS, IT NEVER SUPPRESSES
 *
 * This is the decision the feature turns on, and reversing it would be a
 * one-line change with a silent cost. A `beda` whose kind is `spasi` is still
 * `beda`, still amber, still owed a decision. Demoting it to `cocok` would be
 * this module deciding on the operator's behalf that a difference did not
 * matter -- and the tool cannot know that, because the cell is going back into
 * EPIC, where a format the scan used may be the wrong one to carry. What the
 * operator gains is the ability to SEE the difference in one glance, which is
 * what they were missing. `src/lib/pipeline/config-compare.ts`'s `sameText` is
 * still the only thing that may collapse a pair, and it still collapses on
 * whitespace runs alone.
 *
 * ## `"nilai"` IS THE ANSWER THIS MODULE PREFERS
 *
 * Every kind narrower than `nilai` is a CLAIM that two spellings are one
 * value, and this repo has a scar from exactly that claim being made too
 * eagerly. `sameEntity` in `src/lib/pipeline/abbrev.ts` ran a containment rule
 * over every field and declared `1-70000000001` and `1-70000000001-2` to be one
 * quote, and `Rp 5.000.000` and `Rp 5.000.000.000` to be one price -- and
 * because that function decides settled-versus-conflict, the losing number was
 * recorded nowhere. So `nilai` is the default and every narrower kind has to
 * earn itself; when a rule cannot tell, it says `nilai` rather than guessing.
 *
 * The `angka` rule carries that fence explicitly. `99,50%` and `99.5%` are one
 * number written two ways and a person can see that at a glance. `1.000` and
 * `1,000` are NOT: these documents mix both conventions, so that pair is one
 * against one thousand or one thousand against one, and no amount of looking at
 * the two strings settles it. A three-digit group after the separator is
 * therefore refused, which is the single rule that keeps the money case out.
 */

/**
 * HOW TWO SPELLINGS DIFFER, narrowest first.
 *
 * Bahasa tokens, exactly as `ConfigVerdict` and `ConfigDecision` in `./types.ts`
 * are, and for the same reason: the operator-facing sentence is composed in
 * `src/components/operator/config-panel.tsx` beside every other word that
 * screen says, and a token that had to be translated through an English
 * intermediate would be a table that can silently disagree with itself.
 *
 * The ladder is CUMULATIVE and the first rung that matches wins, so a pair
 * differing in both case and punctuation reports `tanda-baca`: each kind means
 * "these differ in this way, or in a milder one", never "in this way only".
 */
export type DifferenceKind =
  /** Identical once whitespace is removed. A missing or an extra space. */
  | "spasi"
  /** Identical once case is folded. */
  | "huruf"
  /** Identical once the punctuation a transcription wears is dropped. */
  | "tanda-baca"
  /** One number, two notations. Fenced hard: see the module header. */
  | "angka"
  /** Two different values, or two this module cannot prove are one. */
  | "nilai";

/** A half-open run of characters, `[from, to)`. `from === to` marks a point. */
export type Span = { from: number; to: number };

export type Difference = {
  kind: DifferenceKind;
  /** The run of the konfigurasi's value that differs. */
  a: Span;
  /** The run of the document's value that differs. */
  b: Span;
};

/**
 * The punctuation `tanda-baca` may drop, AS AN EXPLICIT SET.
 *
 * A Unicode property escape would have been shorter and wrong: `\p{P}` holds
 * `%`, which is the difference between 99 and 99 percent, and `\p{S}` holds
 * every currency sign. Those carry value, so a pair separated by one of them is
 * not a pair separated by punctuation. What is here is what a transcription
 * wears: sentence punctuation, the brackets and quotes OCR adds and drops, and
 * the dashes a number is written with or without.
 *
 * `labelKey` in `./types.ts` draws a near-identical line for a near-identical
 * reason; it is not shared because that one is anchored to the ENDS of a form
 * label and this one applies throughout a value.
 */
const DROPPABLE = new Set([
  ".",
  ",",
  ":",
  ";",
  "!",
  "?",
  "'",
  '"',
  "‘",
  "’",
  "“",
  "”",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "-",
  "–",
  "—",
  "_",
  "/",
  "\\",
]);

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

/**
 * Punctuation dropped, EXCEPT a `.` or a `,` standing between two digits.
 *
 * That exception is load-bearing rather than tidy. Without it `1.000` and
 * `1,000` both reduce to `1000` and this module reports that they differ only
 * in punctuation -- which is the ambiguity the `angka` rule exists to refuse,
 * arriving through the rung above it instead. A separator inside a number is
 * part of the number and is left for `sameNumber` to rule on.
 */
function withoutPunctuation(text: string): string {
  let out = "";
  for (let at = 0; at < text.length; at += 1) {
    const ch = text[at]!;
    if (!DROPPABLE.has(ch)) {
      out += ch;
      continue;
    }
    if (
      (ch === "." || ch === ",") &&
      isDigit(text[at - 1]) &&
      isDigit(text[at + 1])
    ) {
      out += ch;
    }
  }
  return out;
}

function withoutSpace(text: string): string {
  return text.replace(/\s+/gu, "");
}

/** Whitespace collapsed and case folded, for comparing a unit or a prefix. */
function foldKey(text: string): string {
  return text.replace(/\s+/gu, " ").trim().toLowerCase();
}

/**
 * One value split into what comes before the digits, the digits, and what comes
 * after. `null` when there are no digits at all.
 */
function numberParts(
  text: string,
): { head: string; core: string; tail: string } | null {
  const trimmed = text.trim();
  const first = trimmed.search(/\d/u);
  if (first < 0) return null;
  let last = first;
  for (let at = trimmed.length - 1; at >= first; at -= 1) {
    if (isDigit(trimmed[at])) {
      last = at;
      break;
    }
  }
  return {
    head: trimmed.slice(0, first),
    core: trimmed.slice(first, last + 1),
    tail: trimmed.slice(last + 1),
  };
}

/**
 * The number a core spells, or `null` for one this module refuses to read.
 *
 * Refused: anything carrying more than one separator (`5.000.000` is a
 * thousands grouping and reading it as a decimal would turn five million into
 * five), and anything whose group after the separator is EXACTLY THREE DIGITS,
 * which is the shape a thousands separator and a three-decimal number share.
 * The second is the whole fence, and it is why `1.000` against `1,000` comes
 * back `nilai`.
 */
function coreValue(core: string): number | null {
  const parsed = /^(\d+)(?:([.,])(\d+))?$/u.exec(core);
  if (!parsed) return null;
  const group = parsed[3];
  if (group === undefined) return Number(parsed[1]);
  if (group.length === 3) return null;
  return Number(`${parsed[1]}.${group}`);
}

/**
 * Do these two spell one number?
 *
 * THE NON-NUMERIC HALVES MUST MATCH, which is what keeps `10 Mbps` and
 * `10 Gbps` apart: the digits agree there and the values do not, and a rule
 * that read only the digits would call that a formatting difference.
 */
function sameNumber(a: string, b: string): boolean {
  const left = numberParts(a);
  const right = numberParts(b);
  if (!left || !right) return false;
  if (foldKey(left.head) !== foldKey(right.head)) return false;
  if (foldKey(left.tail) !== foldKey(right.tail)) return false;
  const leftValue = coreValue(left.core);
  const rightValue = coreValue(right.core);
  if (leftValue === null || rightValue === null) return false;
  return leftValue === rightValue;
}

function kindOf(a: string, b: string): DifferenceKind {
  if (withoutSpace(a) === withoutSpace(b)) return "spasi";
  if (withoutSpace(a).toLowerCase() === withoutSpace(b).toLowerCase()) {
    return "huruf";
  }
  const strippedA = withoutSpace(withoutPunctuation(a)).toLowerCase();
  const strippedB = withoutSpace(withoutPunctuation(b)).toLowerCase();
  if (strippedA === strippedB) return "tanda-baca";
  if (sameNumber(a, b)) return "angka";
  return "nilai";
}

/**
 * The two runs that differ: common prefix and common suffix trimmed away.
 *
 * THE SUFFIX IS NOT ALLOWED TO REACH BACK PAST THE PREFIX, which is the one
 * thing that can go wrong here. `aa` against `aaa` shares `aa` at the front and
 * `aa` at the back out of two characters, so a suffix scan run independently
 * produces a span whose `to` is behind its `from` -- and `slice` on that
 * returns the empty string on one side and, at other lengths, the wrong text on
 * the other. The scan is bounded by what the prefix has already claimed.
 */
function spansOf(a: string, b: string): { a: Span; b: Span } {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    a: { from: prefix, to: a.length - suffix },
    b: { from: prefix, to: b.length - suffix },
  };
}

/**
 * How the konfigurasi's value and the document's value differ.
 *
 * `a` is the konfigurasi, `b` is the document, and the order matters only to
 * the spans: each names a run of its own string. An EMPTY span is a real
 * answer and the most useful one this function gives -- it says nothing on that
 * side is wrong and something was inserted at that point, which is exactly the
 * missing-space case that prompted the module.
 */
export function describeDifference(a: string, b: string): Difference {
  const spans = spansOf(a, b);
  return { kind: kindOf(a, b), a: spans.a, b: spans.b };
}
