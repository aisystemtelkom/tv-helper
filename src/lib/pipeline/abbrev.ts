/**
 * Reading the abbreviations these documents actually use.
 *
 * An Indonesian telecom order bundle abbreviates constantly and
 * inconsistently. One organisation appears as `PT Bank Contoh Nusantara Tbk`
 * in an agreement's party block, as `Bank Contoh Nusantara` on an order
 * request, and as initials in a covering email -- inside one bundle. A
 * document type is headed `PERJANJIAN KERJA SAMA` on its own first page and
 * called `PKS` everywhere that refers to it.
 *
 * A tool that compares those as plain strings fails in three ways that all
 * look like something else:
 *
 *   - it reports a field missing that it did in fact find, because the
 *     spelling it found is not the spelling it expected;
 *   - it reports two documents in conflict when they agree;
 *   - in the dokumen tambahan loop it fails to recognise that a newly
 *     uploaded document concerns the same order.
 *
 * WHAT THIS MODULE WILL NOT DO. It will not fuse two entities that are
 * merely similar. Every rule below is deliberately conservative, and each
 * one carries the case it refuses. An over-eager matcher that quietly welds
 * two customers into one is worse than no matcher at all: the deliverable
 * still opens, still looks complete, and now carries a name that belongs to
 * somebody else. Where a rule had to choose, it chose to return false.
 *
 * NOTHING CUSTOMER-SPECIFIC IS HARDCODED HERE. `DOMAIN_ABBREVIATIONS` holds
 * generic industry and paperwork vocabulary only. A customer's own initials
 * are derived at runtime by `acronymOf` from whatever the document prints,
 * never written into this file: this repository is public.
 */

/**
 * Corporate designators that appear inconsistently and carry no identity.
 *
 * These are what the scans actually print. The bundle this was checked
 * against writes both `PT <NAME> TBK` and the longer state-enterprise
 * wrapper `PERUSAHAAN PERSEROAN (PERSERO) PT <NAME> TBK` for the same kind
 * of party, and the human-authored validation form writes the bare name with
 * no wrapper at all. All three have to compare equal.
 */
const CORPORATE_WORDS = new Set(["pt", "tbk", "persero", "cv", "ud"]);

/**
 * Multi-word designators, stripped only as a complete run.
 *
 * `perusahaan` and `perseroan` are NOT in `CORPORATE_WORDS` on purpose. On
 * their own they are ordinary words that begin real names ("Perusahaan
 * Listrik Negara"), and dropping a leading `Perusahaan` would both mangle
 * such a name and make `acronymOf` return the wrong initials for it. Only
 * the fixed pair is a designator.
 */
const CORPORATE_PHRASES = [["perusahaan", "perseroan"]];

/**
 * Words that carry no identity and so contribute no initial.
 *
 * Indonesian function words plus the three English ones that turn up in
 * product and clause names on these forms.
 */
const STOPWORDS = new Set(["dan", "di", "ke", "dari", "yang", "of", "the", "and"]);

/**
 * Domain vocabulary whose expansion cannot be derived from the letters.
 *
 * The table exists because `acronymOf` gets several of these wrong by
 * construction: `Pasang Baru` gives PB, not PSB; `Tanda Tangan` gives TT,
 * not TTD; `Term of Payment` gives TP, not ToP, because `of` is a stopword.
 * Entries that ARE derivable are listed anyway, so a lookup is exact rather
 * than reconstructed.
 *
 * PROVENANCE. Every entry marked (bundle) was read back out of the OCR of
 * the real scans before it was written here, most of them from a page that
 * prints the short form and its expansion together -- `Surat Penunjukan
 * (SP)`, `PKS/Perjanjian Kerjasama`, `Berita Acara Serah Terima`. Entries
 * marked (form) come from the human-authored validation form and its
 * companion workbook, which label the same row `ToP` in one file and `Term
 * Of Payment` in the other. Entries marked (spec) come from the 2026-08-31
 * corrections note, which enumerates the order verbs. Entries marked
 * (industry) are standard vocabulary that this bundle uses but never spells
 * out; they are the only ones not evidenced by a document, and they are the
 * first place to look if a match ever surprises someone.
 *
 * NOTHING IDENTIFYING GOES IN THIS TABLE. Generic vocabulary only: no
 * customer names, no account or order numbers, no project names. The tests
 * enforce the shape of that rule so a future entry cannot smuggle one in.
 */
export const DOMAIN_ABBREVIATIONS: Record<string, string> = {
  // Paperwork (bundle)
  PKS: "Perjanjian Kerja Sama",
  BA: "Berita Acara",
  BAP: "Berita Acara Permintaan",
  BAST: "Berita Acara Serah Terima",
  SP: "Surat Penunjukan",
  SPH: "Surat Penawaran Harga",
  // Form vocabulary (form)
  TTD: "Tanda Tangan",
  TOP: "Term of Payment",
  SID: "Service ID",
  // Charges: MRC and OTC are printed on the request as `Harga MRC` and
  // `Harga OTC` (bundle). NRC is the standard counterpart of MRC and does
  // not appear in this bundle (industry).
  MRC: "Monthly Recurring Charge",
  NRC: "Non Recurring Charge",
  OTC: "One Time Charge",
  // Service and site vocabulary. PSB is printed in full as `Pasang Baru`
  // throughout the request; KCP labels the `Nama Cabang` line (bundle).
  PSB: "Pasang Baru",
  KCP: "Kantor Cabang Pembantu",
  // The EPIC order id's prefix. The bundle carries the id itself but never
  // spells the prefix out, so this expansion is the one entry here that
  // rests on nothing printed (industry) -- treat it as the weakest row.
  LOP: "Layanan Order Pelanggan",
  // Network vocabulary. Both appear constantly (`MPLS VPN IP`) and neither
  // is ever expanded in the bundle (industry).
  VPN: "Virtual Private Network",
  MPLS: "Multiprotocol Label Switching",
  // Order verbs, from the corrections note's own table (spec). They are
  // workflow verbs, not billing periods -- the error that note corrects.
  AO: "Activation Order",
  MO: "Modify Order",
  DO: "Delete Order",
};

/** Lowercase, punctuation to spaces, runs of space collapsed. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(value: string): string[] {
  const n = normalize(value);
  return n === "" ? [] : n.split(" ");
}

/**
 * Drops leading and trailing Indonesian corporate designators, keeping the
 * name itself. Case-insensitive, and repeated until neither end moves, so
 * the stacked `PERUSAHAAN PERSEROAN (PERSERO) PT` prefix comes off whole.
 *
 * Returns the normalised name (lowercased, punctuation folded to single
 * spaces): callers compare it, they do not print it. `canonicalEntity` is
 * what decides which ORIGINAL spelling ships.
 */
export function stripCorporateForms(value: string): string {
  let tokens = words(value);

  let changed = true;
  while (changed && tokens.length > 0) {
    changed = false;

    for (const phrase of CORPORATE_PHRASES) {
      if (startsWithRun(tokens, phrase)) {
        tokens = tokens.slice(phrase.length);
        changed = true;
      }
      if (endsWithRun(tokens, phrase)) {
        tokens = tokens.slice(0, tokens.length - phrase.length);
        changed = true;
      }
    }

    if (tokens.length > 0 && CORPORATE_WORDS.has(tokens[0])) {
      tokens = tokens.slice(1);
      changed = true;
    }
    if (tokens.length > 0 && CORPORATE_WORDS.has(tokens[tokens.length - 1])) {
      tokens = tokens.slice(0, -1);
      changed = true;
    }
  }

  // A value that is NOTHING BUT designators keeps its original normalised
  // form rather than becoming "". Returning "" would make every such value
  // compare equal to every other, which is the fusing failure this module
  // exists to avoid.
  return tokens.length > 0 ? tokens.join(" ") : normalize(value);
}

function startsWithRun(tokens: string[], run: string[]): boolean {
  return run.every((word, i) => tokens[i] === word);
}

function endsWithRun(tokens: string[], run: string[]): boolean {
  const offset = tokens.length - run.length;
  return offset >= 0 && run.every((word, i) => tokens[offset + i] === word);
}

/** The words that carry identity: no corporate designators, no stopwords. */
function significantWords(value: string): string[] {
  return stripCorporateForms(value)
    .split(" ")
    .filter((word) => word !== "" && !STOPWORDS.has(word));
}

/**
 * The initials of a phrase's significant words, uppercase.
 *
 * "Bank Contoh Nusantara" and "PT Bank Contoh Nusantara Tbk" both give
 * "BCN": the corporate wrapper contributes no letter, which is the point --
 * the same organisation must yield the same initials however the page that
 * names it chose to dress it up.
 */
export function acronymOf(phrase: string): string {
  return significantWords(phrase)
    .map((word) => word[0].toUpperCase())
    .join("");
}

/** The letters and digits of a value, uppercase, with everything else gone. */
function letters(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "").toUpperCase();
}

/** A known domain expansion for a value, if the whole value is one. */
function domainExpansion(value: string): string | undefined {
  return DOMAIN_ABBREVIATIONS[letters(value)];
}

/**
 * True when one side is a domain abbreviation of the other.
 *
 * Compared with the spaces removed, because the documents themselves cannot
 * agree on them: the same agreement is headed `PERJANJIAN KERJASAMA` on its
 * own cover page and cited as `Perjanjian Kerja Sama` elsewhere. That
 * looseness is safe only because it applies solely when one side resolved
 * through the table above -- it is not a general string rule.
 *
 * WHAT IT DELIBERATELY WILL NOT DO is match an abbreviation against a LONGER
 * title that merely begins with its expansion: `BAP` does not match `Berita
 * Acara Permintaan Order`, and `SP` does not match `Surat Penunjukan Nomor
 * 03`. Letting the expansion fall through to the containment rule below
 * would pick those up -- and would also make `BA` match `Berita Acara
 * Permintaan`, which is a different document. A near-miss here costs a
 * conflict the operator is shown and can settle; a wrong match costs a
 * deliverable nobody is told about.
 */
function domainEquivalent(a: string, b: string): boolean {
  const expandedA = domainExpansion(a);
  const expandedB = domainExpansion(b);
  if (expandedA === undefined && expandedB === undefined) return false;

  const left = normalize(expandedA ?? a).replace(/ /g, "");
  const right = normalize(expandedB ?? b).replace(/ /g, "");
  return left !== "" && left === right;
}

/**
 * True when `short` is written as initials and those initials are the
 * acronym of `long`.
 *
 * Three guards, each closing a way this could fuse two different entities:
 *
 *  1. `short` must be a single token written WITHOUT lowercase letters, so
 *     it is something the page presented as an abbreviation rather than a
 *     word that happens to be short.
 *  2. `short` must not itself be one of `long`'s own words. Without this,
 *     "BANK" would match "Bank Anak Negeri Kita", whose initials are also
 *     BANK -- a coincidence, not an abbreviation.
 *  3. Both sides need at least two letters of substance, so a single
 *     initial cannot stand for a whole name.
 *
 * Note what this rule deliberately cannot see: two DIFFERENT names that
 * share initials, where the bundle prints only the initials. Nothing in the
 * text distinguishes those, so no rule here could; that stays a genuine
 * ambiguity for the operator.
 */
function acronymMatches(short: string, long: string): boolean {
  const compact = letters(short);
  if (compact.length < 2 || compact.length > 8) return false;
  if (words(short).length !== 1) return false;
  if (/[a-z]/.test(short.replace(/[^a-zA-Z]+/g, ""))) return false;

  const longWords = significantWords(long);
  if (longWords.length < 2) return false;
  if (longWords.includes(compact.toLowerCase())) return false;

  return compact === acronymOf(long);
}

/**
 * True when `needle`'s words appear as a contiguous run inside `haystack`'s.
 *
 * Contiguous and word-aligned, not a substring test: "Bank Nusantara" must
 * not match "Bank Contoh Nusantara", and "Contoh" must not match
 * "Contohan". The needle also needs at least two significant words, which
 * is what stops the shared generic head of a name -- "Bank", "Kantor",
 * "PT" -- standing in for the whole of it.
 */
function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length < 2 || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((word, i) => haystack[start + i] === word)) return true;
  }
  return false;
}

/**
 * Whether two spellings denote the same thing.
 *
 * Four routes, in increasing order of how much they assume:
 *
 *   1. the normalised forms are equal (case, spacing and punctuation folded);
 *   2. one is a known domain abbreviation of the other (`PKS` / `Perjanjian
 *      Kerja Sama`);
 *   3. one is written as the other's initials (`BCN` / `Bank Contoh
 *      Nusantara`);
 *   4. one contains the other, once corporate designators are stripped.
 *
 * A blank never matches anything, including another blank: "we found
 * nothing twice" is not agreement, and treating it as agreement would let a
 * pair of empty answers settle a field as though it had been confirmed.
 */
export function sameEntity(a: string, b: string): boolean {
  const normalA = normalize(a);
  const normalB = normalize(b);
  if (normalA === "" || normalB === "") return false;
  if (normalA === normalB) return true;

  if (domainEquivalent(a, b)) return true;
  if (acronymMatches(a, b) || acronymMatches(b, a)) return true;

  const strippedA = stripCorporateForms(a).split(" ");
  const strippedB = stripCorporateForms(b).split(" ");
  if (strippedA.join(" ") === strippedB.join(" ")) return true;

  return containsRun(strippedA, strippedB) || containsRun(strippedB, strippedA);
}

/**
 * Which of several agreeing spellings ships.
 *
 * THE FULLEST ONE WINS, measured first by how many identity-bearing words it
 * carries and then by its raw length. The asymmetry is the whole argument:
 * an operator reading the finished validation document can always shorten a
 * complete name to the form their reader expects, but they cannot restore
 * words the tool dropped without going back to the source scan -- and the
 * document exists to be checked against those scans. Initials are the worst
 * possible thing to ship for the same reason: `BCN` is only checkable by
 * somebody who already knows the answer.
 *
 * This does mean the tool prefers `PT Bank Contoh Nusantara Tbk` where the
 * human-authored sample writes the customer without its corporate wrapper.
 * That is a deliberate difference and the cheap direction to be wrong in:
 * deleting `PT ... Tbk` is one edit, and no information is lost by offering
 * it.
 *
 * Ties keep the first value given, so the caller's own ordering (round 1
 * before round 2, and within a round the order the model returned) decides.
 */
export function canonicalEntity(values: string[]): string {
  const candidates = values
    .map((value) => value.trim())
    .filter((value) => value !== "");
  if (candidates.length === 0) return "";

  let best = candidates[0];
  let bestScore = significantWords(best).length;
  for (const candidate of candidates.slice(1)) {
    const score = significantWords(candidate).length;
    if (
      score > bestScore ||
      (score === bestScore && candidate.length > best.length)
    ) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
