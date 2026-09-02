/**
 * Offline tests for the crop-level second pass. No API calls, no credential,
 * no PDF: `verifyCitedValues` takes its renderer and its `AskImage` injected,
 * so the whole wiring -- which values get checked, which get skipped, what a
 * disagreement does to the list -- is drivable with fakes.
 *
 * Every string here is invented. The fictional set this repo uses is
 * LOP999001, 1-70000000001, BANK CONTOH NUSANTARA, PSB VPN IP KCP Contoh, and
 * nothing may be lifted out of `documents/`: this is a public repo.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { Line } from "./geometry.ts";
import type { FieldValue } from "./fields.ts";
import type { RenderedPage } from "./render.ts";
import {
  agreesWith,
  normalizeReading,
  reOcrCrop,
  verifyCitedValues,
  type VerifyPage,
} from "./verify.ts";

// ---------------------------------------------------------------------------
// Fixtures. A page big enough that CROP_PADDING_PX (12) never pushes a box off
// it, with lines wide apart so `boxForLineRange` unions something real.
// ---------------------------------------------------------------------------

function line(i: number, text: string, y: number): Line {
  const box = { x: 100, y, w: 900, h: 40 };
  return { i, text, box, words: [{ text, box }], origin: "measured" };
}

const PAGE: VerifyPage = {
  width: 2480,
  height: 3507,
  lines: [
    line(0, "Nama Pelanggan : BANK CONTOH NUSANTARA", 200),
    line(1, "Nomor Quote : 1-70000000001", 300),
    line(2, "Nama Proyek : PSB VPN IP KCP Contoh", 400),
  ],
};

/** A page of solid white pixels. `cropToPng` only copies rows out of this; no
 *  test here cares what the picture looks like, only that one was cut. */
function renderedPage(): RenderedPage {
  return {
    data: new Uint8ClampedArray(PAGE.width * PAGE.height * 4).fill(255),
    width: PAGE.width,
    height: PAGE.height,
  };
}

function cited(fieldKey: string, value: string, from: number, to = from): FieldValue {
  return {
    fieldKey,
    value,
    source: { pageIndex: 0, lineRange: [from, to], sourceName: "bundle.pdf", pageInDoc: 0 },
  };
}

/** An `AskImage` that answers with whatever the crop is supposed to read as,
 *  and records how many pictures it was handed. */
function fakeAsk(readings: string[]) {
  const calls: { promptBytes: number }[] = [];
  let next = 0;
  const ask = async (_prompt: string, image: { bytes: Uint8Array }) => {
    calls.push({ promptBytes: image.bytes.length });
    const reading = readings[Math.min(next, readings.length - 1)];
    next += 1;
    return JSON.stringify({ text: reading });
  };
  return { ask, calls };
}

const deps = (readings: string[]) => {
  const { ask, calls } = fakeAsk(readings);
  return {
    calls,
    deps: { renderPage: async () => renderedPage(), ask },
  };
};

// ---------------------------------------------------------------------------
// normalizeReading / agreesWith
// ---------------------------------------------------------------------------

test("normalizeReading folds case, punctuation, whitespace and confusables", () => {
  assert.equal(
    normalizeReading("PT. BANK CONTOH NUSANTARA,  Tbk"),
    normalizeReading("pt bank contoh nusantara tbk"),
  );
  // l/i/1 and o/0 all collapse, so a glyph confusion is not a disagreement.
  assert.equal(normalizeReading("KCP Contoh 10"), normalizeReading("KCP C0nt0h l0"));
});

test("normalizeReading keeps single-character tokens", () => {
  // The gate harness drops tokens shorter than two characters as page noise.
  // Here the needle is often a reference number, and a lone dropped character
  // is exactly the one a confabulation got wrong.
  assert.equal(normalizeReading("Rp 5.000.000"), "rp 5000000");
  assert.equal(normalizeReading("A 1"), "a 1");
});

test("agreesWith finds the value inside the crop's wider reading", () => {
  const { agree, distance } = agreesWith(
    "BANK CONTOH NUSANTARA",
    "Nama Pelanggan : BANK CONTOH NUSANTARA\nAlamat : Jl. Contoh No. 1",
  );
  assert.equal(agree, true);
  assert.equal(distance, 0);
});

test("agreesWith rejects the measured confabulation shape at the default tolerance", () => {
  // The probe's stamp serial came back with 3 of 17 characters wrong,
  // identically on every call. That is 18%, and the gate's 25%-of-length
  // tolerance would have called it agreement -- which is why this pass does
  // not borrow that number.
  const { agree, distance } = agreesWith("1-70000000001", "Nomor Quote : 1-70000000801");
  assert.equal(agree, false);
  assert.ok(distance > 0, "a wrong digit must register as distance");
  assert.ok(
    distance <= Math.round("1-70000000001".length * 0.25),
    "and it must be small enough that a 25% tolerance would have missed it",
  );
});

test("agreesWith accepts an explicitly widened tolerance and reports the distance anyway", () => {
  const strict = agreesWith("PSB VPN IP KCP Contoh", "PSB VPN IP KCP Contph");
  assert.equal(strict.agree, false);
  const loose = agreesWith("PSB VPN IP KCP Contoh", "PSB VPN IP KCP Contph", 1);
  assert.equal(loose.agree, true);
  assert.equal(loose.distance, strict.distance);
});

test("agreesWith is asymmetric: the value is the needle, the reading the haystack", () => {
  const right = agreesWith("BANK CONTOH NUSANTARA", "Pelanggan : BANK CONTOH NUSANTARA");
  const swapped = agreesWith("Pelanggan : BANK CONTOH NUSANTARA", "BANK CONTOH NUSANTARA");
  assert.equal(right.agree, true);
  assert.equal(swapped.agree, false);
});

// ---------------------------------------------------------------------------
// reOcrCrop
// ---------------------------------------------------------------------------

test("reOcrCrop parses a fenced JSON reply", async () => {
  const text = await reOcrCrop(
    { bytes: new Uint8Array([1]), mediaType: "image/png" },
    async () => '```json\n{"text":"Nomor Quote : 1-70000000001"}\n```',
  );
  assert.equal(text, "Nomor Quote : 1-70000000001");
});

test("reOcrCrop throws on an unusable reply rather than returning a blank", async () => {
  // A blank reading would disagree with every value and blank every cell in
  // the workbook. That deserves an exception, not a quietly emptied deliverable.
  await assert.rejects(
    reOcrCrop({ bytes: new Uint8Array([1]), mediaType: "image/png" }, async () => "sorry, no"),
  );
});

// ---------------------------------------------------------------------------
// verifyCitedValues
// ---------------------------------------------------------------------------

test("an agreeing value survives untouched", async () => {
  const values = [cited("cc", "BANK CONTOH NUSANTARA", 0)];
  const { deps: d, calls } = deps(["Nama Pelanggan : BANK CONTOH NUSANTARA"]);
  const { values: out, report } = await verifyCitedValues(values, [PAGE], d);

  assert.equal(calls.length, 1);
  assert.ok(calls[0].promptBytes > 0, "a real PNG must have been cut and sent");
  assert.deepEqual(out, values);
  assert.equal(report.checked, 1);
  assert.equal(report.agreed, 1);
  assert.equal(report.disagreed, 0);
  assert.deepEqual(report.unverified, []);
});

test("a corrupted value blanks its cell and records BOTH readings, with no winner", async () => {
  const values = [cited("quote", "1-70000000001", 1)];
  const { deps: d } = deps(["Nomor Quote : 1-70000000801"]);
  const { values: out, report } = await verifyCitedValues(values, [PAGE], d);

  assert.equal(out.length, 1);
  assert.equal(out[0].fieldKey, "quote");
  assert.equal(out[0].value, "", "a disagreement ships blank, never a coin toss");
  assert.deepEqual(out[0].conflict, ["1-70000000001", "Nomor Quote : 1-70000000801"]);
  assert.match(out[0].conflictReason ?? "", /re-read of the cited crop disagree/);
  // The citation goes with the value it no longer supports: a note pointing at
  // lines that print something else is a false citation, which this project
  // holds to be worse than none.
  assert.equal(out[0].source, undefined);
  assert.equal(report.disagreed, 1);
  assert.equal(report.agreed, 0);
});

test("an uncited value is reported unverifiable and is not blanked", async () => {
  const values: FieldValue[] = [{ fieldKey: "cc", value: "BANK CONTOH NUSANTARA" }];
  const { deps: d, calls } = deps(["never asked"]);
  const { values: out, report } = await verifyCitedValues(values, [PAGE], d);

  assert.equal(calls.length, 0, "nothing to crop means nothing to spend");
  assert.deepEqual(out, values);
  assert.equal(report.checked, 0);
  assert.deepEqual(report.unverified, [{ fieldKey: "cc", reason: "no citation to crop" }]);
});

test("a value already blanked by a reconcile conflict is left alone", async () => {
  const values: FieldValue[] = [
    { fieldKey: "cc", value: "", conflict: ["BANK CONTOH NUSANTARA", "BANK LAIN"] },
  ];
  const { deps: d, calls } = deps(["never asked"]);
  const { values: out, report } = await verifyCitedValues(values, [PAGE], d);

  assert.equal(calls.length, 0);
  assert.deepEqual(out, values);
  assert.equal(report.checked, 0);
  assert.deepEqual(report.unverified, []);
});

test("a failed verification call ships the value and names it, rather than blanking it", async () => {
  // An unreachable model is not evidence that a value is wrong. Blanking on it
  // would empty a workbook over a network blip -- the wrong-and-quiet shape
  // pointed the other way.
  const values = [cited("cc", "BANK CONTOH NUSANTARA", 0)];
  const { values: out, report } = await verifyCitedValues(values, [PAGE], {
    renderPage: async () => renderedPage(),
    ask: async () => {
      throw new Error("model unreachable");
    },
  });

  assert.deepEqual(out, values);
  assert.equal(report.checked, 0);
  assert.equal(report.disagreed, 0);
  assert.deepEqual(report.unverified, [
    { fieldKey: "cc", reason: "model unreachable" },
  ]);
});

test("each cited page is rendered once, however many values cite it", async () => {
  // A 300 DPI A4 page is ~33MB of RGBA. Rendering per value rather than per
  // page is how a dozen citations turn into half a gigabyte.
  const values = [
    cited("cc", "BANK CONTOH NUSANTARA", 0),
    cited("quote", "1-70000000001", 1),
    cited("namaProyek", "PSB VPN IP KCP Contoh", 2),
  ];
  let renders = 0;
  const { values: out, report } = await verifyCitedValues(values, [PAGE], {
    renderPage: async () => {
      renders += 1;
      return renderedPage();
    },
    ask: async () => JSON.stringify({ text: PAGE.lines.map((l) => l.text).join("\n") }),
  });

  assert.equal(renders, 1);
  assert.equal(report.checked, 3);
  assert.equal(report.agreed, 3);
  assert.deepEqual(out, values);
});

test("input order is preserved across a mix of checked, blanked and skipped values", async () => {
  const values: FieldValue[] = [
    { fieldKey: "first", value: "BANK CONTOH NUSANTARA" }, // uncited, skipped
    cited("second", "1-70000000001", 1), // disagrees
    cited("third", "PSB VPN IP KCP Contoh", 2), // agrees
  ];
  const { deps: d } = deps([
    "Nomor Quote : 1-70000000801",
    "Nama Proyek : PSB VPN IP KCP Contoh",
  ]);
  const { values: out } = await verifyCitedValues(values, [PAGE], d);

  assert.deepEqual(
    out.map((v) => v.fieldKey),
    ["first", "second", "third"],
  );
  assert.equal(out[0].value, "BANK CONTOH NUSANTARA");
  assert.equal(out[1].value, "");
  assert.equal(out[2].value, "PSB VPN IP KCP Contoh");
});

test("a citation naming a page this run does not hold is reported, not thrown", async () => {
  const values = [cited("cc", "BANK CONTOH NUSANTARA", 0)];
  values[0].source!.pageIndex = 7;
  const { deps: d, calls } = deps(["never asked"]);
  const { values: out, report } = await verifyCitedValues(values, [PAGE], d);

  assert.equal(calls.length, 0);
  assert.deepEqual(out, values);
  assert.equal(report.unverified.length, 1);
  assert.match(report.unverified[0].reason, /not in this run's page list/);
});
