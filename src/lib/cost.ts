/**
 * What a run actually cost, in money, broken down by the stage that spent it.
 *
 * ## Why this exists
 *
 * `pnpm generate` already printed a `cost:` line with total calls and tokens.
 * Tokens are not a decision. The bill that prompted this module was read off
 * the Gemini console a month after the spending, at which point the only
 * available question was "why is this number big" and the only available
 * answer was arithmetic on AGENTS.md's remembered per-image figure -- which
 * was wrong about which stage dominated, by an order of magnitude and in the
 * wrong direction.
 *
 * THE COST TABLE IN AGENTS.md NAMED `GEMINI_MEDIA_RESOLUTION` AS THE DOMINANT
 * LEVER. It is about 4% of a run. The dominant levers were the model tier (the
 * pinned model was the most expensive Flash tier on the price list) and
 * `locate` re-uploading one 17.5k-token page listing once per slot. Neither was
 * visible in a total, and both are obvious the moment the total is split by
 * stage and multiplied by a price. So this module is the instrument that was
 * missing, and its output belongs in the run log where the next person reads it
 * rather than on an invoice six weeks later.
 *
 * ## The shape of the hazard this module itself introduces
 *
 * A hardcoded price table goes stale silently, which is this project's own
 * named failure class pointed at itself: a run would keep printing a
 * confident, precisely formatted, wrong number. Three things are done about
 * that, and none of them is a comment asking the reader to be careful:
 *
 *  - `PRICES_AS_OF` is printed alongside every figure, so a number always
 *    carries the date of the table that produced it.
 *  - AN UNKNOWN MODEL ID DOES NOT PRICE AS ZERO. `usdForTally` returns `null`
 *    and the formatter prints the token counts with the price withheld and the
 *    model named. A model this table has never heard of is exactly the case a
 *    silent zero would hide, because the reason to change `MODEL_ID` is to
 *    change what a run costs.
 *  - Prices are per MILLION tokens and stored as decimal dollars, the units
 *    the vendor's own page uses, so a transcription can be checked against it
 *    by eye without unit conversion.
 *
 * Nothing here calls the network or reads a credential. It is arithmetic over
 * counts the callers already hold, which is why it lives in `src/lib` and is
 * imported by both the route handlers and the scripts.
 */

/** USD per million tokens, the units the vendor's pricing page prints. */
export type Price = {
  input: number;
  output: number;
};

/**
 * When the numbers below were read off the vendor's pricing page, and the two
 * sources they were cross-checked against.
 *
 * PRINTED WITH EVERY FIGURE THIS MODULE PRODUCES. A cost report whose table is
 * older than the reader's memory of a price change is worse than no report,
 * and the only defence that survives a year is making the staleness visible at
 * the point of use rather than in this comment.
 */
export const PRICES_AS_OF = "2026-09-03";

/**
 * Standard (interactive) prices, USD per million tokens.
 *
 * ## The measurement that made this table worth having
 *
 * The pinned model was `gemini-3.5-flash`, chosen in August on a LATENCY
 * probe: `gemini-3.7-flash` took 99-190s on a trivial vision call and blew
 * `/api/chat`'s 120s `maxDuration`, and 3.5 answered the same probe in about
 * 2s. That was a sound reason to reject 3.7 and never a statement about cost.
 * The table below is why it mattered: on output tokens, which is where this
 * pipeline's spending actually is, 3.5 Flash is the most expensive Flash tier
 * on the price list, and 3.6x the Flash-Lite of the same generation.
 *
 * Cross-checked, because a single fetch of a pricing page is one transcription
 * error away from a wrong recommendation. `gemini-3.5-flash` at 1.50/9.00 and
 * `gemini-3.5-flash-lite` at 0.30/2.50 are the two figures this project acts
 * on, and two independent sources agreed on both exactly. The 3.6/3.7/3.8
 * Flash row is the vendor's own promotional rate through 2026-12-31 and is
 * internally cross-checked by its published batch price being exactly half of
 * it; a third-party summary listed the post-promotion 1.50/7.50 instead, which
 * is the number to expect from 2027-01-01. Prefer re-reading the vendor page
 * to trusting either.
 */
export const PRICES: Record<string, Price> = {
  // The tier this project was pinned to. Kept in the table precisely so a
  // report can show what leaving it saved.
  "gemini-3.5-flash": { input: 1.5, output: 9.0 },

  // Same generation, and the target for the OCR stage: OCR is the one call
  // whose legitimate reply is long, so it is priced almost entirely on output,
  // where this is 2.50 against 9.00.
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },

  // Promotional rate through 2026-12-31; 1.50/7.50 after. The conservative
  // swap for the semantic stages, which are input-heavy and want the stronger
  // reasoner.
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },

  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
};

/**
 * What the Batch API charges as a fraction of the interactive price.
 *
 * Uniform across every model the vendor documents it for, which is why this is
 * a single factor rather than a second column: a per-model batch price would
 * be two numbers to keep in step for no gain, and the published batch figures
 * are exactly half of the interactive ones.
 *
 * NOT APPLICABLE TO THE OPERATOR PATH, and the reason is a product constraint
 * rather than a technical one. Batch trades a 24-hour turnaround for the
 * discount. An operator pressing Proses and receiving their packet tomorrow is
 * a different product, so this factor may only ever be applied to a headless
 * run with nobody waiting on it.
 */
export const BATCH_PRICE_FACTOR = 0.5;

/**
 * What a cached input token costs, as a fraction of an uncached one.
 *
 * The vendor documents "approximately 90%" off for a cache read, both implicit
 * and explicit, so this is 0.1. It is deliberately a round number rather than
 * a per-model table: the discount is quoted approximately, it is applied to
 * whatever the provider decides to cache rather than to what a caller asked
 * for, and pretending to four significant figures about it would dress a
 * rounding in precision.
 *
 * STORAGE COST IS NOT MODELLED, and that is only safe for IMPLICIT caching,
 * which is what this pipeline uses. Explicit caching also bills per hour for
 * the cache's lifetime, and a ledger that ignored that would understate a
 * design built on it. If anything here ever creates an explicit cache, this
 * comment stops being true and the storage term has to be added.
 */
export const CACHED_INPUT_FACTOR = 0.1;

/**
 * What a Cloud Vision OCR stage is called in the ledger's model column.
 *
 * Not a model id, and deliberately not shaped like one: it is a recogniser
 * with no version this pipeline chooses, and an entry in `PRICES` would imply
 * a per-token rate it does not have.
 */
export const VISION_LEDGER_MODEL = "cloud-vision";

/**
 * Tokens spent, by the stage that spent them.
 *
 * `thoughts` is a SUBSET of `output`, not an addition to it: the provider
 * reports reasoning tokens inside the output count and bills them at the
 * output rate. Adding it again would overstate every figure, and it is carried
 * separately only so a report can say how much of the output was thinking --
 * which is the number that justifies `GEMINI_THINKING_LEVEL`.
 */
export type StageTally = {
  calls: number;
  input: number;
  output: number;
  thoughts: number;
  /**
   * Input tokens the provider served from its own prefix cache, billed at a
   * fraction of the input rate.
   *
   * A SUBSET OF `input`, like `thoughts` is of `output`: the provider counts
   * cached tokens inside the input total and then discounts them, so the
   * arithmetic below subtracts rather than adds.
   *
   * This field is the only honest way to tell whether ordering a prompt to
   * share a long prefix actually bought anything. Implicit caching is
   * automatic, undocumented in its exact thresholds, and invisible in a total
   * -- so a change made to enable it can look successful while the provider
   * silently cached nothing. `cacheReadTokens` says which happened.
   */
  cachedInput: number;
  /**
   * Pages billed at a flat per-page rate, by an engine that does not charge by
   * token at all.
   *
   * Cloud Vision bills $1.50 per 1,000 pages. Folding that into the token
   * columns would be a lie whichever way it was folded, and leaving it out
   * would understate a run while the table still looked complete -- the exact
   * failure this module exists to prevent. A stage may carry pages, tokens, or
   * both, and `formatLedger` prints whichever it has.
   */
  pages: number;
  /** What those pages cost in USD, priced by the caller that knows the rate. */
  pageCostUsd: number;
};

export function emptyTally(): StageTally {
  return {
    calls: 0,
    input: 0,
    output: 0,
    thoughts: 0,
    cachedInput: 0,
    pages: 0,
    pageCostUsd: 0,
  };
}

export function addToTally(
  tally: StageTally,
  call: {
    input?: number;
    output?: number;
    thoughts?: number;
    cachedInput?: number;
    pages?: number;
    pageCostUsd?: number;
  },
): void {
  tally.calls += 1;
  tally.input += call.input ?? 0;
  tally.output += call.output ?? 0;
  tally.thoughts += call.thoughts ?? 0;
  tally.cachedInput += call.cachedInput ?? 0;
  tally.pages += call.pages ?? 0;
  tally.pageCostUsd += call.pageCostUsd ?? 0;
}

/**
 * The stages a run spends on, in the order a run performs them.
 *
 * A closed union rather than free-form strings, so that a new call site has to
 * declare which stage it belongs to and cannot land in an "other" bucket that
 * nobody reads. The whole value of this module is the split; a stage label
 * typo that silently creates a fourteenth row would destroy it.
 */
export type Stage = "ocr" | "classify" | "locate" | "extract" | "verify" | "continuation";

export const STAGES: readonly Stage[] = [
  "ocr",
  "classify",
  "locate",
  "extract",
  "verify",
  "continuation",
];

/** Every stage's tally, plus which model each stage was served by. */
export type CostLedger = {
  stages: Record<Stage, StageTally>;
  /**
   * Stage -> model id. A `Record` rather than one run-wide model id because
   * splitting OCR onto a cheaper tier than the semantic stages is the single
   * largest saving available to this pipeline, and a ledger that assumed one
   * model per run could not price the result.
   */
  models: Partial<Record<Stage, string>>;
  /** True only for a headless run submitted through the Batch API. */
  batch: boolean;
};

export function emptyLedger(batch = false): CostLedger {
  return {
    stages: {
      ocr: emptyTally(),
      classify: emptyTally(),
      locate: emptyTally(),
      extract: emptyTally(),
      verify: emptyTally(),
      continuation: emptyTally(),
    },
    models: {},
    batch,
  };
}

/**
 * Record a flat per-page charge, for an engine billed by the page.
 *
 * `usdPerPage` is passed in rather than looked up here, because the provider
 * boundary that knows the rate is the honest place to keep it -- the same
 * reason `PRICES` sits beside the model ids rather than in the callers.
 */
export function recordPages(
  ledger: CostLedger,
  stage: Stage,
  modelId: string,
  pages: number,
  usdPerPage: number,
): void {
  addToTally(ledger.stages[stage], { pages, pageCostUsd: pages * usdPerPage });
  ledger.models[stage] = modelId;
}

export function record(
  ledger: CostLedger,
  stage: Stage,
  modelId: string,
  call: {
    input?: number;
    output?: number;
    thoughts?: number;
    cachedInput?: number;
    pages?: number;
    pageCostUsd?: number;
  },
): void {
  addToTally(ledger.stages[stage], call);
  ledger.models[stage] = modelId;
}

/**
 * What one stage cost, or `null` when this table cannot say.
 *
 * `null` RATHER THAN 0 FOR AN UNKNOWN MODEL, which is the whole reason this
 * returns a nullable. A zero would read as "this stage was free" in exactly
 * the situation where somebody has just pointed `MODEL_ID` at something new to
 * find out what it costs.
 */
export function usdForTally(
  modelId: string | undefined,
  tally: StageTally,
  batch = false,
): number | null {
  if (!modelId) return tally.calls === 0 ? 0 : null;

  // A PAGE-PRICED STAGE IS PRICED, and must not fall through to the unknown-
  // model path below. Cloud Vision has no entry in PRICES because it has no
  // per-token rate to put there; its cost arrives already in dollars from the
  // one place that knows the rate. Returning null here would print the
  // cheapest stage in the run as "unpriced" and silently drop it from the
  // total, which is this module's own named failure aimed at itself.
  if (tally.pages > 0 && tally.input === 0 && tally.output === 0) {
    return tally.pageCostUsd * (batch ? BATCH_PRICE_FACTOR : 1);
  }

  const price = PRICES[modelId];
  if (!price) return null;

  const factor = batch ? BATCH_PRICE_FACTOR : 1;

  // `cachedInput` is a SUBSET of `input`, so the full input is billed at the
  // normal rate and the cached part gets its discount refunded, rather than
  // the two being added. Clamped because the provider's two numbers arrive
  // independently: a `cacheReadTokens` larger than `inputTokens` would
  // otherwise produce a negative bill, which would be a very quiet way for a
  // report to look cheap.
  const cached = Math.min(tally.cachedInput, tally.input);
  const billableInput = tally.input - cached * (1 - CACHED_INPUT_FACTOR);

  return (
    ((billableInput * price.input) / 1_000_000 +
      (tally.output * price.output) / 1_000_000) *
    factor
  );
}

/**
 * The run's total, and whether any stage's price was unknown.
 *
 * The flag is returned rather than folded into the number because a total that
 * silently omits an unpriced stage is a understated bill presented as a
 * complete one. Callers print the caveat; they do not get to lose it.
 */
export function usdForLedger(ledger: CostLedger): {
  usd: number;
  complete: boolean;
} {
  let usd = 0;
  let complete = true;
  for (const stage of STAGES) {
    const tally = ledger.stages[stage];
    if (tally.calls === 0) continue;
    const cost = usdForTally(ledger.models[stage], tally, ledger.batch);
    if (cost === null) {
      complete = false;
      continue;
    }
    usd += cost;
  }
  return { usd, complete };
}

/** `1234567` -> `"1.23M"`, `12345` -> `"12.3k"`. Log lines, not spreadsheets. */
function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function usd(n: number): string {
  // Four decimal places because a per-stage figure here is routinely under a
  // cent, and rounding a stage to $0.00 in a report whose entire purpose is
  // attribution defeats the report.
  return `$${n.toFixed(4)}`;
}

/**
 * The run's cost, as a table, for the run log.
 *
 * Sorted by SPEND rather than by pipeline order, because the question a reader
 * brings to this table is "what should I change" and the answer is the top
 * row. Stages that made no call are omitted entirely: a row of zeroes invites
 * the reader to check whether the stage is broken.
 *
 * `idrPerUsd` is optional and prints a second column when supplied. The bill
 * that prompted this module was denominated in rupiah while every price on the
 * vendor's page is in dollars, and doing that conversion in one's head is how
 * a factor of ten gets lost.
 */
export function formatLedger(
  ledger: CostLedger,
  options: { idrPerUsd?: number } = {},
): string {
  const rows: {
    stage: Stage;
    tally: StageTally;
    model: string;
    cost: number | null;
  }[] = [];

  for (const stage of STAGES) {
    const tally = ledger.stages[stage];
    if (tally.calls === 0) continue;
    rows.push({
      stage,
      tally,
      model: ledger.models[stage] ?? "(unrecorded)",
      cost: usdForTally(ledger.models[stage], tally, ledger.batch),
    });
  }

  if (rows.length === 0) return "cost: no model calls";

  rows.sort((a, b) => (b.cost ?? Infinity) - (a.cost ?? Infinity));

  const { usd: total, complete } = usdForLedger(ledger);
  const lines: string[] = [];

  lines.push(
    `cost (prices as of ${PRICES_AS_OF}${ledger.batch ? ", BATCH rate" : ""}):`,
  );

  const pad = (s: string, n: number) => s.padEnd(n);
  const padStart = (s: string, n: number) => s.padStart(n);

  lines.push(
    "  " +
      pad("stage", 13) +
      padStart("calls", 6) +
      padStart("in", 9) +
      padStart("out", 9) +
      padStart("cost", 11) +
      padStart("share", 7) +
      "  model",
  );

  for (const row of rows) {
    const share =
      row.cost !== null && total > 0
        ? `${((row.cost / total) * 100).toFixed(0)}%`
        : "?";
    lines.push(
      "  " +
        pad(row.stage, 13) +
        padStart(String(row.tally.calls), 6) +
        // A PAGE-PRICED STAGE PRINTS ITS PAGES, not two zeroes. Cloud Vision
        // spends no tokens at all, and a row of "0  0" beside a real dollar
        // figure reads as a bug in the ledger rather than as a different unit.
        padStart(
          row.tally.pages > 0 && row.tally.input === 0
            ? `${row.tally.pages}pg`
            : compactTokens(row.tally.input),
          9,
        ) +
        padStart(
          row.tally.pages > 0 && row.tally.output === 0
            ? "-"
            : compactTokens(row.tally.output),
          9,
        ) +
        padStart(row.cost === null ? "unpriced" : usd(row.cost), 11) +
        padStart(share, 7) +
        `  ${row.model}`,
    );
  }

  const totalTally = rows.reduce(
    (acc, row) => ({
      calls: acc.calls + row.tally.calls,
      input: acc.input + row.tally.input,
      output: acc.output + row.tally.output,
      thoughts: acc.thoughts + row.tally.thoughts,
      cachedInput: acc.cachedInput + row.tally.cachedInput,
      pages: acc.pages + row.tally.pages,
      pageCostUsd: acc.pageCostUsd + row.tally.pageCostUsd,
    }),
    emptyTally(),
  );

  lines.push(
    "  " +
      pad("TOTAL", 13) +
      padStart(String(totalTally.calls), 6) +
      padStart(compactTokens(totalTally.input), 9) +
      padStart(compactTokens(totalTally.output), 9) +
      padStart(usd(total), 11) +
      padStart(complete ? "" : "part", 7),
  );

  if (options.idrPerUsd) {
    lines.push(
      `  approx IDR ${Math.round(total * options.idrPerUsd).toLocaleString("en-US")} ` +
        `at ${options.idrPerUsd.toLocaleString("en-US")}/USD`,
    );
  }

  if (totalTally.thoughts > 0) {
    lines.push(
      `  of which ${compactTokens(totalTally.thoughts)} thought tokens, billed at the ` +
        "output rate (GEMINI_THINKING_LEVEL)",
    );
  }

  // PRINTED EVEN WHEN IT IS ZERO, whenever more than one call was made, and
  // that is the whole point of the line. Prefix caching is enabled by ordering
  // a prompt so its long invariant part comes first, and nothing in a reply
  // says whether the provider took the hint. A silent absence and a silent
  // success read identically, so a run that shares a prefix and caches
  // NOTHING has to be able to say so out loud.
  if (totalTally.calls > 1) {
    const share =
      totalTally.input > 0
        ? ((totalTally.cachedInput / totalTally.input) * 100).toFixed(0)
        : "0";
    lines.push(
      totalTally.cachedInput > 0
        ? `  provider prefix cache: ${compactTokens(totalTally.cachedInput)} of ` +
          `${compactTokens(totalTally.input)} input tokens (${share}%) served cached ` +
          `at ${Math.round(CACHED_INPUT_FACTOR * 100)}% of the input rate`
        : `  provider prefix cache: NOTHING cached across ${totalTally.calls} calls. ` +
          "If a prompt was ordered to share a long prefix, it did not take.",
    );
  }

  if (!complete) {
    const unpriced = rows.filter((r) => r.cost === null).map((r) => r.model);
    lines.push(
      `  INCOMPLETE: no price on file for ${[...new Set(unpriced)].join(", ")}. ` +
        "The total above omits those stages -- add them to PRICES in src/lib/cost.ts.",
    );
  }

  return lines.join("\n");
}
