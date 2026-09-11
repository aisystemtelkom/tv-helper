/**
 * WHAT DIFFERS BETWEEN TWO SPELLINGS OF ONE ISIAN, and what does not.
 *
 * The failure this file protects is the one an operator reported: a hundred
 * characters of address with one missing space in the middle of it, drawn
 * beside a hundred characters of address, and a key saying `Terima` under
 * both. The operator cannot see the difference, so they cannot rule on it.
 *
 * Half these tests assert `"nilai"`, and those are the ones that matter.
 * `"nilai"` is this module saying "I cannot tell you these are the same
 * thing", and every narrower kind is a claim that two spellings are one
 * value. `sameEntity` in `src/lib/pipeline/abbrev.ts` carries this project's
 * scar for getting that claim wrong -- it declared `Rp 5.000.000` and
 * `Rp 5.000.000.000` to be one price -- so the negatives below are the fence
 * and not the leftovers.
 *
 * Pure: no IndexedDB, no model, no network, no React.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { describeDifference } from "./difference.ts";

/** The run of `text` a span marks, so a test reads as what the screen shows. */
function marked(text: string, span: { from: number; to: number }): string {
  return text.slice(span.from, span.to);
}

// ---------------------------------------------------------------------------
// The kinds, one test each
// ---------------------------------------------------------------------------

test("a missing space is spasi, whatever else is in the string", () => {
  const konfigurasi =
    "Jalan Kemanggisan Utama Raya No.49A RT/RW: 08/08, " +
    "Kel.Kemanggisan Kec.Palmerah. Kota Jakarta Barat";
  const dokumen =
    "Jalan Kemanggisan Utama Raya No.49A RT/RW: 08/08, " +
    "Kel.Kemanggisan Kec. Palmerah. Kota Jakarta Barat";

  assert.equal(describeDifference(konfigurasi, dokumen).kind, "spasi");
});

test("the spans mark the inserted space and nothing else", () => {
  const konfigurasi = "Kec.Palmerah. Kota Jakarta Barat";
  const dokumen = "Kec. Palmerah. Kota Jakarta Barat";
  const diff = describeDifference(konfigurasi, dokumen);

  // An EMPTY span on the konfigurasi side is the whole content of the finding:
  // nothing of it is wrong, something was inserted at this point.
  assert.equal(marked(konfigurasi, diff.a), "");
  assert.equal(marked(dokumen, diff.b), " ");
});

test("a difference of case alone is huruf", () => {
  const diff = describeDifference(
    "Bank Contoh Nusantara",
    "BANK CONTOH NUSANTARA",
  );
  assert.equal(diff.kind, "huruf");
});

test("a difference of punctuation alone is tanda-baca", () => {
  const diff = describeDifference("Budi Contoh", "Budi Contoh.");
  assert.equal(diff.kind, "tanda-baca");
});

test("a decimal comma against a decimal point is angka", () => {
  const diff = describeDifference("99.5%", "99,50%");
  assert.equal(diff.kind, "angka");
});

test("a trailing decimal zero on its own is angka", () => {
  assert.equal(describeDifference("99", "99.00").kind, "angka");
});

test("two different values are nilai", () => {
  const diff = describeDifference("Monthly Postpaid", "Berlangganan");
  assert.equal(diff.kind, "nilai");
});

test("an empty konfigurasi cell is nilai, never a formatting difference", () => {
  // `belum diisi` on screen. There is nothing to compare a format against.
  const diff = describeDifference("", "BANK CONTOH NUSANTARA");
  assert.equal(diff.kind, "nilai");
  assert.equal(marked("BANK CONTOH NUSANTARA", diff.b), "BANK CONTOH NUSANTARA");
});

// ---------------------------------------------------------------------------
// The fence. THESE ARE THE TESTS THAT MATTER.
// ---------------------------------------------------------------------------

test("a three-digit group is ambiguous, so 1.000 against 1,000 is nilai", () => {
  // One and one thousand, or one thousand and one. These documents mix both
  // conventions, and a module that guesses here fuses two different numbers.
  assert.equal(describeDifference("1.000", "1,000").kind, "nilai");
});

test("a thousand times the money is nilai", () => {
  // `sameEntity`'s recorded failure, in the units it actually cost.
  assert.equal(
    describeDifference("Rp 5.000.000", "Rp 5.000.000.000").kind,
    "nilai",
  );
});

test("99.500 against 99,500 is nilai, because the group is three digits", () => {
  assert.equal(describeDifference("99.500", "99,500").kind, "nilai");
});

test("a number with a different unit is nilai", () => {
  // The digits agree and the values do not. Only a suffix separates them, so
  // this is the shape a careless numeric rule reports as a format difference.
  assert.equal(describeDifference("10 Mbps", "10 Gbps").kind, "nilai");
});

test("a quote number that gained a suffix is nilai", () => {
  // AGENTS.md records this pair as one `sameEntity` wrongly merged.
  assert.equal(
    describeDifference("1-70000000001", "1-70000000001-2").kind,
    "nilai",
  );
});

test("two different quantities that both read as decimals are nilai", () => {
  assert.equal(describeDifference("99,5%", "99,9%").kind, "nilai");
});

// ---------------------------------------------------------------------------
// The spans, on their own
// ---------------------------------------------------------------------------

test("the spans trim the common prefix and the common suffix", () => {
  const diff = describeDifference("99.5%", "99,50%");
  assert.equal(marked("99.5%", diff.a), ".5");
  assert.equal(marked("99,50%", diff.b), ",50");
});

test("two values with nothing in common are marked whole", () => {
  const diff = describeDifference("Monthly Postpaid", "Berlangganan");
  assert.equal(marked("Monthly Postpaid", diff.a), "Monthly Postpaid");
  assert.equal(marked("Berlangganan", diff.b), "Berlangganan");
});

test("a repeated character does not let the suffix eat the prefix", () => {
  // The prefix and the suffix both want the same characters here, and a span
  // whose `to` ran behind its `from` would slice backwards and mark the wrong
  // text on screen.
  const diff = describeDifference("aa", "aaa");
  assert.ok(diff.a.to >= diff.a.from, "a span runs forwards");
  assert.ok(diff.b.to >= diff.b.from, "b span runs forwards");
  assert.equal(marked("aa", diff.a), "");
  assert.equal(marked("aaa", diff.b), "a");
});

test("identical values report no marked run at all", () => {
  // Unreachable from the panel, which only asks about a `beda`, but a module
  // that invented a difference here would be inventing one anywhere.
  const diff = describeDifference("Budi Contoh", "Budi Contoh");
  assert.equal(marked("Budi Contoh", diff.a), "");
  assert.equal(marked("Budi Contoh", diff.b), "");
});
