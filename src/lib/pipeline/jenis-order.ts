/**
 * JENIS ORDER: reading the order's workflow verb off the paperwork.
 *
 * LIFTED OUT OF `scripts/generate.mjs` SO THE BROWSER CAN USE IT. Everything
 * here is pure -- it takes OCR pages, an already-parsed order request and two
 * strings, and returns a value with its provenance. No filesystem, no model
 * call, no `process`, so the operator UI can fill its JENIS ORDER field
 * honestly instead of defaulting it, and `pnpm test` keeps its no-network
 * guarantee.
 *
 * The CLI still owns reading `--jenis-order` and `JENIS_ORDER`; it passes them
 * in as `flag` and `env`. That split is the point: WHERE a value came from is
 * an environment question, and WHETHER it can be trusted is this module's.
 *
 * ## Read this before rendering an inferred answer
 *
 * The inference was reproduced over 22 real spellings during review and was
 * WRONG ON NINE of them. The rules below are the rewrite; the failures are
 * recorded because they are what the shape has to keep refusing:
 *
 *   "JENIS ORDER DAN LAYANAN"     -> answered "DAN"
 *   "JENIS ORDER YANG DIMINTA"    -> answered "YANG"
 *   "Jenis Order Baru"            -> answered "BARU"
 *   "JENIS ORDER  AO  MO  DO"     -> answered "AO"
 *
 * That last one is the dangerous one and it is worth a sentence of its own. It
 * is a PRINTED OPTION MENU with nothing ticked -- a blank field on a blank
 * form -- read as a confident answer of AO. An autofilled value on a question
 * the operator has not answered yet is worse than an empty one, because an
 * empty field asks to be filled and a filled field does not.
 *
 * So a caller rendering `origin: "inferred"` should say so in weaker words
 * than it uses for `flag` or `request`, and a caller rendering `refused` should
 * NOT reuse its not-found wording: refused means the form has a jenis order
 * printed on it that we would not trust, and sending the operator away from the
 * one page carrying the answer is the opposite of helpful.
 */

// operator picks the template so the template's own id is the honest answer.
// It is not. JENIS ORDER values are WORKFLOW VERBS -- AO = Activation Order,
// MO = Modify Order, DO = Delete Order, and more exist -- not template
// variants, so which section list a run renders says nothing about which verb
// the order is. The second client bundle (2026-09-03 findings, section 1) is
// an MO, and the hard-coded line would have put "AO" in a header cell a
// validator signs: plausible, unflagged, and wrong, which is the exact failure
// class this project is organised against.
//
// So the value comes from a real source, in this preference order:
//
//   1. AN EXPLICIT OPERATOR OVERRIDE (`--jenis-order`, or `JENIS_ORDER` in the
//      environment). First because the operator is the only party who can be
//      *told* the answer out of band -- the client says "this one is an MO" in
//      a WhatsApp message that is not in the bundle -- and because every step
//      below is an inference that must be overridable when it is wrong.
//   2. THE ORDER REQUEST, when one was supplied. Second because it is the
//      document that *states* the requested order type as a field rather than
//      mentioning it in prose: bundle two ships it as an xlsx with a
//      "Jenis order (yang diminta)" column. It ranks below the operator only
//      because a request can be superseded and the operator knows that.
//      Reading it is item 3 of the plan and belongs to the next agent in this
//      chain; `resolveJenisOrder` takes it as an already-parsed object so that
//      landing the reader is a one-line change at the call site.
//   3. INFERENCE FROM THE DOCUMENTS, narrowly. Third because it reads a label
//      somebody printed rather than a field somebody filled, so it can pick up
//      a mention of a DIFFERENT order (a renewal's base agreement naming the
//      original activation) or an unticked list of options. The guards below
//      exist for exactly those two cases and it stays last of the three that
//      can produce a value.
//   4. BLANK, reported outstanding by name. There is deliberately NO default.
//      Same argument as `NEVER_EXTRACTED`'s `namaProyek`: a blank invites the
//      operator to fill it in, a plausible wrong value gets signed.
// ---------------------------------------------------------------------------

export type JenisOrderPage = {
  sourceName: string;
  pageInDoc: number;
  lines?: { i: number; text?: string }[];
};

/** One labelled JENIS ORDER the bundle prints. `value` is "" when refused. */
export type JenisOrderCandidate = {
  /** The order code, upper-cased. Empty when the line was refused. */
  value: string;
  /** What actually stood beside the label, so a refusal can be explained. */
  raw: string;
  /** Human-readable location: file, page and line. */
  where: string;
};

/**
 * Where the answer came from. A caller MUST render these differently:
 * `inferred` read a label somebody printed rather than a field somebody
 * filled, and a refusal means the form carries a jenis order we would not
 * trust -- the opposite of "not found", and it must not borrow its words.
 */
export type JenisOrderOrigin =
  /** `--jenis-order`. Taken verbatim; the operator is accountable for it. */
  | "flag"
  /** The `JENIS_ORDER` environment variable. Same trust as the flag. */
  | "env"
  /** A field somebody FILLED on the order request. The best inferred source. */
  | "order-request"
  /** A label somebody PRINTED, read off the scans. Weakest of the answers. */
  | "documents"
  /** Read something that looked like an answer and would not trust it. */
  | "inferred"
  /** Two documents answered differently. Ships BLANK with both named. */
  | "conflict"
  /** Nothing answered at all. */
  | "none";

export type JenisOrder = {
  /** "" when nothing answered. There is deliberately no default. */
  value: string;
  origin: JenisOrderOrigin;
  /** A sentence written to be read by an operator in the outstanding report. */
  detail: string;
};

/**
 * `file pN` for a page, where N IS A PAGE NUMBER AND NOT AN INDEX.
 *
 * `pageInDoc` is 0-based, because it is a position that indexes arrays. The
 * label adds one, because it is read by a person holding the paper, and that
 * person counts from one. Keeping the field an index and the label a page
 * number is the whole distinction: flipping the FIELD would break every caller
 * that uses it to look something up, and printing the INDEX sends an operator
 * to the page before the one carrying the answer.
 *
 * This string is operator-facing in two places already -- the outstanding
 * report, via `outstandingHeaderFields`, and the operator UI's Jenis Order
 * field -- so the CLI and the browser must render it identically or the same
 * document produces two different locations depending on which path found it.
 *
 * Kept local rather than imported so this module has no dependency at all: it
 * is four tokens, and sharing it would couple a browser import to a CLI helper.
 */
function sourceLabel(page: JenisOrderPage): string {
  return `${page.sourceName} p${page.pageInDoc + 1}`;
}

/**
 * The printed label, with whatever follows it on the same OCR line.
 *
 * Anchored on the LABEL and not on a list of known codes, because the code set
 * is open ("and more exist") and a closed list would silently drop a real
 * order type instead of reporting it -- the wrong-and-quiet direction. The
 * optional parenthetical is not decoration: bundle two's order request spells
 * the label "Jenis order (yang diminta)", and a line carrying that spelling
 * with the value after it would otherwise fail the code shape below and be
 * thrown away as unreadable.
 */
const JENIS_ORDER_LINE = /jenis\s*order\s*(?:\([^)]*\))?(.*)$/i;

/** The separators a form prints between the label and its value, stripped in
 * code rather than inside `JENIS_ORDER_LINE`: as a greedy class in the regex
 * it backtracks, so a bare `JENIS ORDER :` matched with ":" AS ITS VALUE and
 * reported a label whose value could not be read instead of no label at all. */
const JENIS_ORDER_SEPARATORS = /^[\s:.\-]+/;

/** A code as it is printed: a short run of letters, `AO`, `MO`, `DO`. */
const JENIS_ORDER_CODE = /^([A-Za-z]{2,4})\b(.*)$/;

/**
 * What may follow the code and still leave the line an ANSWER.
 *
 * Nothing, punctuation, or ONE parenthetical that runs to the end -- which is
 * how a form prints a code beside its own expansion, `MO (Modify Order)`.
 * Anything else means the words after the code are part of the text rather
 * than trailing decoration, and the code was never an answer at all.
 *
 * THIS REPLACED A SEPARATOR-MATCHING GUARD, and the replacement is the whole
 * defensibility of this step. The old one refused `AO / MO / DO` by looking
 * for `/`, `|` or `,` immediately after the first code, so it recognised a
 * blank form's menu under exactly one punctuation class out of several. Run
 * against the exported function, all five of these resolved to a confident
 * `{ value: "AO", origin: "documents" }` with a page-and-line citation that
 * made it read as verified:
 *
 *     "JENIS ORDER    AO    MO    DO"        <- an unticked tick-box row, the
 *     "JENIS ORDER : AO   MO   DO"              case the guard's own docstring
 *     "Jenis Order : AO ( ) MO ( ) DO ( )"      says it exists for
 *     "JENIS ORDER : AO - MO - DO"
 *     "JENIS ORDER : AO atau MO"
 *
 * Asking instead what may FOLLOW an answer covers every separator there is,
 * including whitespace and the ones nobody has thought of, and it fails in
 * the safe direction: an unfamiliar shape is recorded raw for the operator
 * rather than read as the first code printed.
 */
const JENIS_ORDER_TRAILER = /^[\s:.,;-]*(?:\([^)]*\))?[\s.,;]*$/;

/**
 * The order codes AGENTS.md names: Activation, Modify, Delete.
 *
 * NOT the whole answer -- the set is open ("and more exist") -- but the half
 * of it that can be accepted whatever case OCR returns them in.
 */
const JENIS_ORDER_KNOWN_CODES = new Set(["AO", "MO", "DO"]);

/**
 * Does this token read as an order code rather than as a word?
 *
 * `JENIS_ORDER_CODE` on its own accepts ANY two-to-four letter word, so a
 * label followed by prose put a conjunction in the header cell and marked it
 * resolved. Measured against the exported function before this guard existed:
 * "JENIS ORDER DAN LAYANAN" -> "DAN", "JENIS ORDER YANG DIMINTA" -> "YANG",
 * "Jenis order yang diminta" -> "YANG", "Jenis Order Baru" -> "BARU". The
 * trailer rule above kills the first three (each has trailing words); "Baru"
 * is the whole of its line and needs this.
 *
 * The rule is the SHAPE OF AN ABBREVIATION, not a closed list, so an
 * unfamiliar order type is still read rather than dropped: two or three
 * letters, written upper-case, which is how a form prints a code and is not
 * how it prints "Baru", "yang" or "Lama". A known code is taken in any case
 * because `JENISORDER: mo` is a real OCR reading of one.
 *
 * A token this refuses is not lost -- it is recorded with `value: ""` and its
 * raw text, so the outstanding report names it and the operator answers with
 * one flag. Blank-and-asked beats plausible-and-signed.
 */
function readsAsOrderCode(printed: string): boolean {
  const code = printed.toUpperCase();
  if (JENIS_ORDER_KNOWN_CODES.has(code)) return true;
  return printed.length <= 3 && printed === code;
}

/**
 * Every labelled JENIS ORDER value the bundle prints, with where it was read.
 *
 * Exported for the tests: the guards above are the whole reason this step is
 * defensible at all, so they are pinned by name rather than exercised only
 * through a full run.
 */
export function jenisOrderCandidates(
  pages: JenisOrderPage[],
): JenisOrderCandidate[] {
  const found: JenisOrderCandidate[] = [];
  for (const page of pages) {
    for (const line of page.lines ?? []) {
      const labelled = JENIS_ORDER_LINE.exec(line.text ?? "");
      if (!labelled) continue;
      const raw = labelled[1].replace(JENIS_ORDER_SEPARATORS, "").trim();
      // A label with nothing beside it -- the value is in the next table cell,
      // which OCR may have grouped onto another line. Nothing to report and
      // nothing to guess.
      if (raw === "") continue;
      const where = `${sourceLabel(page)} line ${line.i}`;
      const code = JENIS_ORDER_CODE.exec(raw);
      if (
        !code ||
        !JENIS_ORDER_TRAILER.test(code[2]) ||
        !readsAsOrderCode(code[1])
      ) {
        // Recorded WITHOUT a value on purpose. The operator gets told the
        // label was there and what stood next to it, which is what turns a
        // blank cell into a question they can answer in one look.
        found.push({ value: "", raw, where });
        continue;
      }
      found.push({ value: code[1].toUpperCase(), raw, where });
    }
  }
  return found;
}

/**
 * The JENIS ORDER a run ships, and the sentence explaining where it came from.
 *
 * Returns `{ value, origin, detail }`. `value` is `""` when no source answered
 * -- never a default -- and `detail` is written to be read by an operator in
 * the outstanding report, so it says what was looked at as well as what was
 * found. Every input is injected, so the whole preference order is testable
 * without a PDF, a credential or an environment variable.
 */
export function resolveJenisOrder({
  flag,
  env,
  orderRequest,
  pages = [],
}: {
  flag?: unknown;
  env?: unknown;
  orderRequest?: { jenisOrder?: unknown } | null;
  pages?: JenisOrderPage[];
} = {}): JenisOrder {
  // Explicit values are taken VERBATIM apart from whitespace. The operator may
  // legitimately want a spelling this file has never heard of, and quietly
  // uppercasing or abbreviating it would put words in their mouth in a cell
  // they are accountable for.
  const explicit = (value: unknown) =>
    String(value ?? "").trim().replace(/\s+/g, " ");

  const fromFlag = explicit(flag);
  if (fromFlag) {
    return { value: fromFlag, origin: "flag", detail: "given as --jenis-order" };
  }

  const fromEnv = explicit(env);
  if (fromEnv) {
    return { value: fromEnv, origin: "env", detail: "given as JENIS_ORDER" };
  }

  const fromRequest = explicit(orderRequest?.jenisOrder);
  if (fromRequest) {
    return {
      value: fromRequest,
      origin: "order-request",
      detail: "read from the order request",
    };
  }

  const candidates = jenisOrderCandidates(pages);
  const answered = candidates.filter((candidate) => candidate.value !== "");
  const distinct = [...new Set(answered.map((candidate) => candidate.value))];

  if (distinct.length === 1) {
    return {
      value: distinct[0],
      origin: "documents",
      // The citation is the point. An inferred header cell that cannot be
      // checked is worth less than a blank one, so the run log and the report
      // both name the page and line it was read off.
      detail: `read off ${answered.map((candidate) => candidate.where).join(", ")}`,
    };
  }

  if (distinct.length > 1) {
    // Two documents printing two different order types is exactly the case
    // where picking one is worst: a renewal's base agreement naming the
    // original activation reads just as much like an answer as the renewal
    // does. Same resolution as a field conflict -- blank, with both readings
    // named for the operator to settle.
    return {
      value: "",
      origin: "conflict",
      detail:
        `the documents disagree (${answered
          .map((candidate) => `${candidate.value} on ${candidate.where}`)
          .join(" vs ")}); ships blank until the operator picks one`,
    };
  }

  if (candidates.length > 0) {
    return {
      value: "",
      origin: "none",
      detail:
        `the label was found but nothing beside it reads as an order type ` +
        `(${candidates
          .map((candidate) => `${JSON.stringify(candidate.raw)} on ${candidate.where}`)
          .join("; ")}); pass --jenis-order to set it`,
    };
  }

  return {
    value: "",
    origin: "none",
    detail:
      "no order request supplied and no document prints a JENIS ORDER label; " +
      "pass --jenis-order to set it",
  };
}

/**
 * The header cells a run could not source, in the shape the outstanding report
 * uses for slots and fields.
 *
 * A separate `kind` because a header cell is neither: it is not backed by a
 * crop, so no dokumen tambahan round will fill it, and it has no `fieldKey`,
 * so `outstandingFields` cannot see it. Without this the JENIS ORDER cell
 * would ship blank and SILENTLY, which trades one wrong-and-quiet failure for
 * another.
 */
export function outstandingHeaderFields(jenisOrder: JenisOrder) {
  if (jenisOrder.value !== "") return [];
  return [
    {
      kind: "header",
      key: "jenisOrder",
      label: "JENIS ORDER",
      reason: jenisOrder.detail,
    },
  ];
}
