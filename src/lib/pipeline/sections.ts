/**
 * JUDUL DISCOVERY: which headings does ONE scanned document contain?
 *
 * The operator's own request, recorded 2026-09-08: *"Kalo di-scan AI, AI bisa
 * bikinin section-nya sendiri, tapi user harusnya juga bisa rename setiap
 * slot."* So the model PROPOSES a judul list per berkas and a person rules on
 * every one of them. Nothing this module returns reaches a deliverable: the
 * route files each answer as a `ProposedSection`, and `resolveTemplate` in
 * `../forms/overlay.ts` does not read `overlay.proposed` at all. There is no
 * code path from a sentence produced here to the docx exporter that does not
 * pass through a human act.
 *
 * ## Modelled on `./classify.ts`, deliberately and to the letter
 *
 * An injected `Ask = (prompt: string) => Promise<string>`, a zod `Reply`,
 * `extractJson` from `./json.ts`, validation AFTER the parse, and NO IMAGE
 * PARAMETER anywhere. That last one is the load-bearing absence: AGENTS.md's
 * claim that "classify, locate and extract are provably text-only" is checked
 * by reading the signatures in `src/lib/pipeline/`, and this stage extends the
 * claim unchanged rather than putting a hole in it.
 *
 * ## ONE DOCUMENT AT A TIME, RENUMBERED LOCALLY FROM 0
 *
 * The prompt numbers pages BY POSITION in the listing and the reply is mapped
 * back to `pages[i].index` here. That is not style. A pool starting at page 23
 * made the model answer 22 -- its chosen lines matched the intended page
 * exactly, just under the wrong label, consistent with treating a non-zero
 * first label as a 1-based ordinal to convert -- and it stayed hidden for weeks
 * because every other pool started at 0, where "convert to 0-based" and "echo
 * the label back" produce the same answer. `buildLocatePrompt` and
 * `extractFields` both renumber for the same reason.
 *
 * ## THERE IS NO `layout` FIELD AND THE MODEL IS NEVER OFFERED "table"
 *
 * A judul that reaches a run through this stage is captured WHOLE PAGE BY
 * HAND: `AddedSection` carries no layout, so `resolveAdded` gives every bagian
 * under it `layout: "images"`. A `layout: "table"` bagian is the only kind that
 * costs a locate call, and the only kind that can come back as a plausible
 * fragment of the right page -- which needs a `hint` written to beat a
 * look-alike anywhere in the bundle, and a gate run proving it does. Neither
 * exists for a heading a model read off a scan five seconds ago.
 *
 * ## GAPS ARE LEGAL HERE, AND THAT IS THE OPPOSITE OF `classifyPages`
 *
 * `classifyPages` refuses any reply that does not cover every page exactly
 * once, and its stated reason is that NOTHING DOWNSTREAM CONFIRMS ITS SPANS:
 * it runs headless, its answer picks the pool a locate call searches, and a
 * gap or an overlap there is a classification bug that has to fail loudly
 * because no one will ever look at it.
 *
 * Here the operator confirms every single span before it can exist, so a reply
 * that names three judul across three of twenty-seven pages is a NORMAL reply
 * and not a short one. Most pages of a merged contract scan are continuation
 * pages under a heading that was printed once; a stage that demanded total
 * coverage would have to invent an "Unknown" judul per orphan page and put it
 * in front of a person as a decision owed. So a page belonging to no proposal
 * is simply left out, and the panel says how many were left out rather than
 * pretending each one is a finding.
 *
 * OVERLAPS ARE STILL REFUSED, and for the reason `classifyPages` refuses them:
 * a page that is evidence under two headings is a duplicate crop, which is the
 * exporter hazard `groupByKey` exists for. Both members of an overlapping pair
 * go to `unusable`; see `refuseOverlaps`.
 */

import { z } from "zod";

import { HEAD_CHARS, type Ask } from "./classify.ts";
import { extractJson } from "./json.ts";

/**
 * One line of one page, as this stage needs it.
 *
 * A structural minimum rather than `Line`, so a `Line[]` off a `WirePage`
 * satisfies it as-is while nothing here can reach for a box. This stage never
 * produces a rectangle: it answers with a line range, and the geometry is the
 * caller's business.
 */
export type DiscoveryLine = { i: number; text: string };

export type DiscoveryPage = {
  /**
   * THE PAGE'S TRUE INDEX in whatever list the caller numbers by -- for
   * `/api/propose` that is the run-global position in `BrowserRun.pages`,
   * which is what a `Zone.pageIndex` and a `ProposedSection.fromPages` entry
   * mean. It is NEVER shown to the model; see the header.
   */
  index: number;
  lines: readonly DiscoveryLine[];
};

/** One judul the model named and this module was able to check. */
export type DiscoveredSection = {
  /** The document's own heading, transcribed. Checked against its own lines. */
  title: string;
  /** The pages it spans, in order, by the caller's TRUE index. */
  pages: number[];
  /** Where the heading was read, so a person can go and look at it. */
  cite: { pageIndex: number; lineRange: [number, number] };
};

/** One the model named and this module refused, with why. */
export type UnusableSection = { title: string; reason: string };

export type SectionDiscovery = {
  sections: DiscoveredSection[];
  unusable: UnusableSection[];
  /**
   * ONE SENTENCE, ALWAYS, INCLUDING WHEN THE LIST IS EMPTY.
   *
   * English and deployer-facing, like every other string in
   * `src/lib/pipeline/`. It exists because "no judul" has several completely
   * different causes -- the berkas has no headings, the model named none, the
   * model named four and every one of them was a fabrication -- and a caller
   * holding an empty array cannot tell them apart. There is deliberately no
   * fallback judul: inventing "one judul named after the berkas" is
   * fabrication with better manners, and the operator already has "Tambah
   * judul" for the case where they know what the heading should say.
   */
  note: string;
};

/** How many judul one reply may name. A scan of a bundle, not a book. */
const MAX_SECTIONS = 20;

/** Long enough for a real heading, short enough that a paragraph is refused. */
const MAX_TITLE = 80;

/**
 * How many lines a heading may be transcribed from.
 *
 * THE SUBSTRING RULE IS ONLY AS STRONG AS THIS CAP. "The title appears in the
 * cited lines" is a real check over two lines and a trivially satisfied one
 * over fifty: a wide enough citation contains every word on the page, so an
 * invented heading assembled out of scattered words would pass. A printed
 * heading wraps once or twice; four is generous and still leaves the check
 * meaning what it says.
 */
const MAX_TITLE_LINES = 4;

const Reply = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1).max(MAX_TITLE),
        fromPage: z.number().int().min(0),
        toPage: z.number().int().min(0),
        titleLines: z.tuple([
          z.number().int().min(0),
          z.number().int().min(0),
        ]),
      }),
    )
    .max(MAX_SECTIONS),
});

/**
 * The opening lines of one page, whole lines only.
 *
 * `HEAD_CHARS` is `classifyPages`' own budget, imported rather than restated
 * (see its comment). The budget is spent in WHOLE LINES because the reply
 * cites line NUMBERS: a line cut off half way through would be quoted to the
 * model as a fragment and then checked against its full text here, so the same
 * heading would pass or fail depending on where the 400th character landed.
 */
function headLines(page: DiscoveryPage): DiscoveryLine[] {
  const out: DiscoveryLine[] = [];
  let chars = 0;
  for (const line of page.lines) {
    if (chars >= HEAD_CHARS) break;
    out.push(line);
    chars += line.text.length + 1;
  }
  return out;
}

/**
 * THE QUESTION LEADS AND THE LISTING FOLLOWS.
 *
 * The ordering the prefix-cache work concluded on: a question after a 20k-token
 * listing is a question the model reads last, and reordering `locate` so the
 * listing led turned `KB / Nomor` from an intermittent failure into a certain
 * one in every arrangement tried. See "## The prefix-cache experiment" in
 * `./locate.ts`'s header before moving these two blocks.
 */
export function buildSectionsPrompt(pages: readonly DiscoveryPage[]): string {
  const listing = pages
    .map((page, position) => {
      const head = headLines(page);
      if (head.length === 0) {
        // SAID OUT LOUD rather than emitted as a bare "page 7" with nothing
        // under it. A page the recogniser found no text on is a fact about the
        // document (a drawing, a stamped signature sheet), and a silent gap in
        // the listing reads as a page that was withheld.
        return `page ${position}: (no text was recognised on this page)`;
      }
      return [
        `page ${position}:`,
        ...head.map((line) => `  ${line.i}: ${line.text}`),
      ].join("\n");
    })
    .join("\n");

  return [
    "These are the opening lines of each page of one scanned document, in",
    "order. A validation packet reproduces this document as sections, each",
    "section being a run of consecutive pages a human would screenshot",
    "together under one heading. List those sections. The title must be the",
    "document's own heading, transcribed, not a description you write. Pages",
    "belonging to no such section: leave them out. Reply with JSON only.",
    "",
    "Pages are numbered by their position in the listing below, starting at 0.",
    "`fromPage` and `toPage` are inclusive. `titleLines` is the range of lines",
    "ON `fromPage`, inclusive, that the title was transcribed from, using the",
    "line numbers printed in the listing; the title must appear in those lines",
    "word for word. Sections must not overlap.",
    "",
    '{"sections":[{"title":"BERITA ACARA PERMINTAAN ORDER","fromPage":0,' +
      '"toPage":2,"titleLines":[0,1]}]}',
    "",
    listing,
  ].join("\n");
}

/**
 * Case-folded and whitespace-collapsed, and nothing else.
 *
 * Not punctuation-stripped and not accent-folded. The rule this feeds is the
 * one thing standing between a model and a FABRICATED SECTION TITLE in a
 * document a validator signs, and every tolerance added to it is a class of
 * invention it stops catching. Case and whitespace are packaging -- a heading
 * wrapped across two lines arrives with a newline in the middle of it and is
 * the same heading -- which is exactly the line `extractJson` draws for the
 * same reason: recover from packaging, never from content.
 */
function fold(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * One entry, checked against the pages it claims. `null` means it survives.
 *
 * CHECKED, NEVER TRUSTED, and each rule below is here because the reply that
 * breaks it produces a specific wrong-and-quiet outcome rather than a crash.
 */
function refuse(
  entry: z.infer<typeof Reply>["sections"][number],
  pages: readonly DiscoveryPage[],
): string | null {
  const last = pages.length - 1;

  if (entry.fromPage > entry.toPage) {
    return `span reversed: page ${entry.fromPage} to page ${entry.toPage}`;
  }
  if (entry.toPage > last) {
    return (
      `names page ${entry.toPage}, and this berkas has ` +
      `${pages.length} page(s) (0-${last})`
    );
  }

  /*
   * A SPAN CARRYING A PAGE WITH NO OCR LINES IS DROPPED -- ANY PAGE OF IT, NOT
   * JUST THE FIRST, and the difference is a usulan that can never be accepted.
   *
   * `acceptProposal` builds a whole-page zone for EVERY page of the span and
   * writes `lineRange` FROM THE ARRAY LENGTH, so a lineless page has no honest
   * range at all and `wholePageZone` refuses it -- one page into an accept that
   * has already begun. Checking only `pages[entry.fromPage]` therefore let a
   * span with a blank page in the MIDDLE through: it reached the panel looking
   * like every other usulan, threw on Terima, and left the operator with
   * "Bukan ini" as the only working answer to a heading that really is printed
   * on the page. Refusing the whole span here means they never see the row
   * instead of meeting an error on the button that accepts it.
   *
   * AFTER the bounds check above, deliberately: every index walked below is
   * known to be in range by then, and reading `pages[9]` of a three-page
   * berkas would throw a `TypeError` out of a function whose whole job is to
   * refuse informatively -- taking the good usulan beside it down as well.
   */
  for (let at = entry.fromPage; at <= entry.toPage; at += 1) {
    if (pages[at].lines.length > 0) continue;
    return at === entry.fromPage
      ? `page ${at} has no recognised lines, so there is no heading on it to ` +
          "have transcribed and no honest line range to cite"
      : `page ${at} of this span (pages ${entry.fromPage}-${entry.toPage}) has ` +
          "no recognised lines, so a whole-page potongan of it would cite " +
          "line 0 of a page with no line 0";
  }

  const first = pages[entry.fromPage];

  const [from, to] = entry.titleLines;
  if (from > to) {
    return `titleLines reversed: line ${from} to line ${to}`;
  }
  if (to - from + 1 > MAX_TITLE_LINES) {
    return (
      `titleLines covers ${to - from + 1} lines, over the ${MAX_TITLE_LINES} a ` +
      "heading may be transcribed from; a wide citation makes the " +
      "title-is-in-those-lines check meaningless"
    );
  }

  // BY LINE NUMBER, never by array position. `assertLinesWellFormed` makes
  // `lines[k].i === k` true for every page that reaches a route, so the two
  // agree there -- but this module takes any caller's pages, and reading a
  // range positionally on a page numbered some other way cites text that is
  // not the text the rectangle covers.
  const byNumber = new Map(first.lines.map((line) => [line.i, line]));
  const cited: DiscoveryLine[] = [];
  for (let i = from; i <= to; i += 1) {
    const line = byNumber.get(i);
    if (!line) {
      return `titleLines names line ${i}, which page ${entry.fromPage} does not have`;
    }
    cited.push(line);
  }

  // THE TITLE MUST BE IN THE LINES IT CITES. An invented heading is a
  // fabricated section title in a document a validator signs, and there is
  // nothing downstream that could catch one: the operator reads the usulan,
  // sees a plausible name, and accepts it. It is also what keeps the design
  // system's own rule true through this stage -- a judul is set in the mono
  // DOCUMENT voice because it is a QUOTATION, so a heading that is not
  // literally in the document would be the app speaking in the document's
  // voice.
  const haystack = fold(cited.map((line) => line.text).join(" "));
  if (!haystack.includes(fold(entry.title))) {
    return (
      `the title is not in lines ${from}-${to} of page ${entry.fromPage}, ` +
      "so it was described rather than transcribed"
    );
  }

  return null;
}

/**
 * Any two spans sharing a page take each other down.
 *
 * BOTH, NOT THE LATER ONE. Keeping the first and dropping the second would be
 * a guess about which heading the shared page belongs under, made by argument
 * order, in the one place this stage has no information: the model has
 * mis-segmented and neither of its two answers is evidence about the other.
 * The operator loses two usulan and can add either heading by hand; the
 * alternative is one silently preferred usulan whose span may be the wrong one.
 */
function refuseOverlaps(
  kept: { entry: z.infer<typeof Reply>["sections"][number] }[],
): Map<number, string> {
  const refused = new Map<number, string>();
  for (let a = 0; a < kept.length; a += 1) {
    for (let b = a + 1; b < kept.length; b += 1) {
      const one = kept[a].entry;
      const two = kept[b].entry;
      if (one.fromPage > two.toPage || two.fromPage > one.toPage) continue;
      const overlap =
        `pages ${Math.max(one.fromPage, two.fromPage)}-` +
        `${Math.min(one.toPage, two.toPage)}`;
      refused.set(
        a,
        `${overlap} are also claimed by "${two.title}"; a page under two ` +
          "headings is one picture filed twice",
      );
      refused.set(
        b,
        `${overlap} are also claimed by "${one.title}"; a page under two ` +
          "headings is one picture filed twice",
      );
    }
  }
  return refused;
}

/**
 * What judul does this ONE document contain, as usulan for a person to rule on.
 *
 * THROWS only when the reply is not a reply: no JSON in it, or a shape the
 * schema cannot read. That is `extractJson`'s own line and the same one
 * `classifyPages` draws -- an ambiguous reply fails loudly at the boundary
 * rather than reaching a schema that will do its best with it. A reply that
 * parses and says something untrue does NOT throw: each entry is checked and a
 * failing one lands in `unusable` with its reason, because one fabricated
 * heading is no reason to throw away three real ones.
 */
export async function discoverSections(
  pages: readonly DiscoveryPage[],
  ask: Ask,
): Promise<SectionDiscovery> {
  // NO MODEL CALL FOR NOTHING. A berkas whose pages are all fenced off, or a
  // caller with an empty list, buys a sentence rather than a prompt.
  if (pages.length === 0) {
    return {
      sections: [],
      unusable: [],
      note: "no pages were offered for judul discovery, so nothing was asked",
    };
  }

  const parsed = Reply.parse(
    extractJson(await ask(buildSectionsPrompt(pages))),
  );

  const unusable: UnusableSection[] = [];
  const kept: { entry: z.infer<typeof Reply>["sections"][number] }[] = [];

  for (const entry of parsed.sections) {
    const reason = refuse(entry, pages);
    if (reason === null) kept.push({ entry });
    else unusable.push({ title: entry.title, reason });
  }

  // AFTER the per-entry checks, so an entry that was going to be refused
  // anyway does not take a good one down with it.
  const overlaps = refuseOverlaps(kept);

  const sections: DiscoveredSection[] = [];
  kept.forEach(({ entry }, at) => {
    const overlap = overlaps.get(at);
    if (overlap !== undefined) {
      unusable.push({ title: entry.title, reason: overlap });
      return;
    }
    const [from, to] = entry.titleLines;
    sections.push({
      title: entry.title,
      // MAPPED BACK TO THE CALLER'S TRUE INDEXES, here and nowhere else. The
      // model answered in positions; every number that leaves this function is
      // a `DiscoveryPage.index`.
      pages: pages
        .slice(entry.fromPage, entry.toPage + 1)
        .map((page) => page.index),
      cite: { pageIndex: pages[entry.fromPage].index, lineRange: [from, to] },
    });
  });

  return { sections, unusable, note: noteFor(pages.length, sections, unusable) };
}

/** The sentence, in the four cases a caller cannot tell apart from the array. */
function noteFor(
  pageCount: number,
  sections: DiscoveredSection[],
  unusable: UnusableSection[],
): string {
  if (sections.length === 0 && unusable.length === 0) {
    return `the model found no heading in these ${pageCount} page(s)`;
  }
  if (sections.length === 0) {
    return (
      `the model named ${unusable.length} judul and none of them could be ` +
      `checked against the pages they cite: ${unusable
        .map((one) => `"${one.title}" (${one.reason})`)
        .join("; ")}`
    );
  }
  if (unusable.length === 0) {
    return `${sections.length} judul proposed across ${pageCount} page(s)`;
  }
  return (
    `${sections.length} judul proposed across ${pageCount} page(s); ` +
    `${unusable.length} refused`
  );
}
