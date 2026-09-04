/**
 * The cost ledger's tests.
 *
 * What they protect is a REPORT, which makes the failure mode here the
 * project's usual one wearing a new hat: a cost table that prints a confident,
 * well-aligned, wrong number is worse than no cost table, because the whole
 * point of it is that somebody acts on the top row. The assertions below are
 * therefore weighted towards the cases where a wrong answer would look right:
 * an unpriced model, a total that quietly omits a stage, and thought tokens
 * counted twice.
 *
 * No network, no credential, no provider SDK. It is arithmetic.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  BATCH_PRICE_FACTOR,
  PRICES,
  STAGES,
  addToTally,
  emptyLedger,
  emptyTally,
  formatLedger,
  record,
  usdForLedger,
  usdForTally,
} from "./cost.ts";
import { DEFAULT_OCR_MODEL_ID, MODEL_ID, OCR_MODEL_ID } from "./model.ts";

test("the two prices this project acts on are the measured ones", () => {
  // A regression pin, not a tautology. These two figures are the entire basis
  // of the decision to move OCR off the pinned model, they were cross-checked
  // against two independent sources, and a silent edit to either would change
  // a recommendation this repo's documentation now states as fact.
  assert.deepEqual(PRICES["gemini-3.5-flash"], { input: 1.5, output: 9.0 });
  assert.deepEqual(PRICES["gemini-3.5-flash-lite"], { input: 0.3, output: 2.5 });

  // The claim that motivated the whole change: on output tokens, which is
  // where this pipeline's spending is, the pinned tier is 3.6x its own
  // generation's Lite.
  const flash = PRICES["gemini-3.5-flash"];
  const lite = PRICES["gemini-3.5-flash-lite"];
  assert.equal(flash.output / lite.output, 3.6);
  assert.equal(flash.input / lite.input, 5);
});

test("an unknown model does not price as free", () => {
  // THE LOAD-BEARING ASSERTION. Pointing MODEL_ID at something new is exactly
  // when somebody is asking what a run costs, and a zero would answer
  // "nothing" in precisely that moment.
  const tally = { calls: 3, input: 100_000, output: 10_000, thoughts: 0, cachedInput: 0, pages: 0, pageCostUsd: 0 };
  assert.equal(usdForTally("gemini-99-imaginary", tally), null);
  assert.equal(usdForTally(undefined, tally), null);
});

test("a stage that made no call prices as zero rather than unknown", () => {
  // The other half of the rule above: an absent stage is genuinely free, and
  // reporting it as unpriced would raise a false alarm on every run that
  // happens not to use continuation or verify.
  assert.equal(usdForTally(undefined, emptyTally()), 0);
});

test("prices are per million tokens", () => {
  const tally = { calls: 1, input: 1_000_000, output: 1_000_000, thoughts: 0, cachedInput: 0, pages: 0, pageCostUsd: 0 };
  const cost = usdForTally("gemini-3.5-flash", tally);
  assert.equal(cost, 1.5 + 9.0);
});

test("the batch factor halves the bill and only the batch flag turns it on", () => {
  const tally = { calls: 1, input: 1_000_000, output: 0, thoughts: 0, cachedInput: 0, pages: 0, pageCostUsd: 0 };
  assert.equal(usdForTally("gemini-3.5-flash", tally, false), 1.5);
  assert.equal(usdForTally("gemini-3.5-flash", tally, true), 1.5 * BATCH_PRICE_FACTOR);
  assert.equal(BATCH_PRICE_FACTOR, 0.5);
});

test("thought tokens are a subset of output and are not billed twice", () => {
  // `thoughts` is carried so a report can say how much of the output was
  // thinking. If it were ever added to `output` in the arithmetic, every
  // figure this module prints would be overstated by the thinking budget --
  // and the number would still look plausible, which is why this is a test
  // rather than a comment.
  const withThoughts = { calls: 1, input: 0, output: 10_000, thoughts: 9_000, cachedInput: 0, pages: 0, pageCostUsd: 0 };
  const withoutThoughts = { calls: 1, input: 0, output: 10_000, thoughts: 0, cachedInput: 0, pages: 0, pageCostUsd: 0 };
  assert.equal(
    usdForTally("gemini-3.5-flash", withThoughts),
    usdForTally("gemini-3.5-flash", withoutThoughts),
  );
});

test("a ledger can price two stages on two different models", () => {
  // The split that is the largest single saving available to this pipeline:
  // OCR is output-heavy and belongs on the cheap tier, the semantic stages are
  // input-heavy and want the stronger reasoner. A ledger that assumed one
  // model per run could not report the result, so this is the shape that
  // matters most.
  const ledger = emptyLedger();
  record(ledger, "ocr", "gemini-3.5-flash-lite", { input: 0, output: 1_000_000 });
  record(ledger, "locate", "gemini-3.8-flash", { input: 1_000_000, output: 0 });

  const { usd, complete } = usdForLedger(ledger);
  assert.equal(complete, true);
  assert.equal(usd, 2.5 + 0.75);
});

test("a total that omits an unpriced stage says so", () => {
  // An understated bill presented as a complete one is the exact shape this
  // project is organised against, so `complete` is returned rather than folded
  // into the number, and the formatter must print the caveat.
  const ledger = emptyLedger();
  record(ledger, "ocr", "gemini-3.5-flash-lite", { input: 0, output: 1_000_000 });
  record(ledger, "locate", "gemini-99-imaginary", { input: 1_000_000, output: 0 });

  const { usd, complete } = usdForLedger(ledger);
  assert.equal(complete, false);
  assert.equal(usd, 2.5, "the priced stage still totals");

  const report = formatLedger(ledger);
  assert.match(report, /INCOMPLETE/);
  assert.match(report, /gemini-99-imaginary/);
  assert.match(report, /unpriced/);
});

test("the report sorts by spend, so the top row is the thing to change", () => {
  const ledger = emptyLedger();
  // Deliberately recorded in pipeline order, with the expensive stage last.
  record(ledger, "classify", "gemini-3.5-flash", { input: 1_000, output: 100 });
  record(ledger, "locate", "gemini-3.5-flash", { input: 350_000, output: 1_000 });

  const report = formatLedger(ledger);
  const body = report.slice(report.indexOf("stage"));
  assert.ok(
    body.indexOf("locate") < body.indexOf("classify"),
    "the dominant stage must be printed first, not in pipeline order",
  );
});

test("a stage with no calls is left out of the report entirely", () => {
  const ledger = emptyLedger();
  record(ledger, "ocr", "gemini-3.5-flash-lite", { input: 100, output: 100 });
  const report = formatLedger(ledger);
  assert.match(report, /ocr/);
  // A row of zeroes invites the reader to check whether the stage is broken.
  assert.doesNotMatch(report, /continuation/);
  assert.doesNotMatch(report, /verify/);
});

test("every figure carries the date of the table that produced it", () => {
  const ledger = emptyLedger();
  record(ledger, "ocr", "gemini-3.5-flash-lite", { input: 100, output: 100 });
  assert.match(formatLedger(ledger), /prices as of \d{4}-\d{2}-\d{2}/);
});

test("a batch report says it is a batch report", () => {
  // Otherwise a headless run's cost is silently half an operator run's for the
  // same work, and the difference reads as a saving that the live path also
  // got. It did not.
  const ledger = emptyLedger(true);
  record(ledger, "locate", "gemini-3.8-flash", { input: 1_000_000, output: 0 });
  assert.match(formatLedger(ledger), /BATCH rate/);
});

test("an empty ledger reports nothing rather than a table of zeroes", () => {
  assert.equal(formatLedger(emptyLedger()), "cost: no model calls");
});

test("addToTally counts a call even when the provider reported no usage", () => {
  // A provider that answers without usage numbers still cost a call, and a
  // call count that silently disagrees with the log's line count is how a
  // missing usage field turns into an invisible stage.
  const tally = emptyTally();
  addToTally(tally, {});
  assert.deepEqual(tally, { calls: 1, input: 0, output: 0, thoughts: 0, cachedInput: 0, pages: 0, pageCostUsd: 0 });
});

test("every stage in STAGES has a tally in a fresh ledger", () => {
  // `record` indexes `ledger.stages[stage]` directly, so a stage added to the
  // union without a row in `emptyLedger` would throw on first use at whatever
  // point in a long run first reached it.
  const ledger = emptyLedger();
  for (const stage of STAGES) {
    assert.deepEqual(
      ledger.stages[stage],
      { calls: 0, input: 0, output: 0, thoughts: 0, cachedInput: 0, pages: 0, pageCostUsd: 0 },
      `${stage} has no row in a fresh ledger`,
    );
  }
});

test("a cached input token is discounted, not added", () => {
  // `cachedInput` is a SUBSET of `input`. Adding the two would bill the cached
  // portion twice; ignoring it would report no saving from the one change whose
  // entire purpose is to earn it. Half of a million input tokens cached at 10%
  // of the rate should bill 0.5M full plus 0.5M at a tenth.
  const tally = {
    calls: 2,
    input: 1_000_000,
    output: 0,
    thoughts: 0,
    cachedInput: 500_000,
    pages: 0,
    pageCostUsd: 0,
  };
  const expected = ((500_000 + 500_000 * 0.1) * 1.5) / 1_000_000;
  assert.equal(usdForTally("gemini-3.5-flash", tally), expected);
});

test("a cacheRead larger than the input total cannot produce a negative bill", () => {
  // The provider reports the two counts independently. A ledger that trusted
  // them to be consistent could print a NEGATIVE cost, which is the quietest
  // possible way for a cost report to look like a success.
  const tally = {
    calls: 1,
    input: 1_000,
    output: 0,
    thoughts: 0,
    cachedInput: 999_999,
    pages: 0,
    pageCostUsd: 0,
  };
  const cost = usdForTally("gemini-3.5-flash", tally);
  assert.ok(cost !== null && cost > 0, `expected a positive cost, got ${cost}`);
});

test("the report says so when a multi-call run cached nothing", () => {
  // The signal that decides whether a prompt reorder actually worked. A silent
  // absence and a silent success read identically, so zero must be loud.
  const ledger = emptyLedger();
  record(ledger, "locate", "gemini-3.5-flash", { input: 23_000, output: 50 });
  record(ledger, "locate", "gemini-3.5-flash", { input: 23_000, output: 50 });
  assert.match(formatLedger(ledger), /NOTHING cached across 2 calls/);
});

test("the report quantifies a prefix cache that did fire", () => {
  const ledger = emptyLedger();
  record(ledger, "locate", "gemini-3.5-flash", { input: 23_000, output: 50 });
  record(ledger, "locate", "gemini-3.5-flash", {
    input: 23_000,
    output: 50,
    cachedInput: 22_000,
  });
  const report = formatLedger(ledger);
  assert.match(report, /provider prefix cache: 22\.0k of 46\.0k input tokens \(48%\)/);
});

test("both shipped model defaults are in the price table", () => {
  // A default pointed at a model this table has never heard of makes every
  // cost report say "unpriced" for that stage and quietly drop it from the
  // total. The two defaults are the two most likely things to move, so they
  // are the two worth pinning.
  for (const id of [MODEL_ID, OCR_MODEL_ID]) {
    assert.ok(
      PRICES[id],
      `${id} is a shipped default with no entry in PRICES; add it or the cost report understates every run`,
    );
  }
});

test("OCR and reasoning are independently chosen, not one model id", () => {
  // Measured 2026-09-03, three gate samples per arm: gemini-3.8-flash scores
  // equal-or-better than gemini-3.5-flash as the OCR binding (11/10/11 vs
  // 11/9/11) at half the price, and WORSE as the reasoning binding (10/10/10,
  // failing KB / Tanggal every sample). Same model, opposite verdict.
  //
  // This is a regression pin on that finding, not a style rule. Collapsing the
  // two back into one id is the change that would silently undo half a day of
  // measurement, and it is exactly the kind of tidy-looking simplification
  // somebody reaches for.
  assert.notEqual(
    OCR_MODEL_ID,
    MODEL_ID,
    "the OCR and reasoning bindings default to the same model; the gate says they should not",
  );
  assert.equal(OCR_MODEL_ID, DEFAULT_OCR_MODEL_ID);
});
