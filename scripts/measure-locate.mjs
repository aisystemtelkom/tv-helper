/**
 * Scores the locate step (Task 6, src/lib/pipeline/locate.ts) against the
 * human-authored crops in the sample DOKUMEN VALIDASI docx. Run by hand: it
 * reads gitignored client documents in documents/ and calls the real model.
 * See .superpowers/sdd/2026-08-30-pipeline-headless/task-7-brief.md.
 *
 * A slot passes when the model lands on the right page, the lines it chose
 * contain the phrase that proves the ground-truth crop, and it adds no more
 * than two lines beyond the line(s) that phrase lives on. That tolerates the
 * difference between a computed union and a human's drag while still failing
 * a crop that misses the line or swallows half a page.
 *
 * Deviation from the brief worth recording up front: this worktree's
 * src/lib/model.ts still exports the pre-migration local-Ollama chatModel
 * (openai-compatible pointed at http://127.0.0.1:11435/v1), not a
 * Gemini-backed `ask`. The brief assumed the Gemini migration described in
 * AGENTS.md/.env.local had already landed here; it has not (this branch
 * forked before that work). No local Ollama server or model is available in
 * this environment either (no ./models directory). Rather than block the
 * gate on that gap, this script talks to the Gemini REST API directly with
 * plain fetch -- no provider SDK import, matching the spirit of the
 * instruction to avoid pulling in an SDK here, and the same posture
 * scripts/smoke.mjs takes on the sibling branch (it also talks to Gemini
 * directly, independent of src/lib/model.ts, specifically so a broken
 * model.ts doesn't invalidate the check). This is flagged again in the
 * task-7 report.
 *
 * Two on-disk caches make iteration cheap:
 *  - OCR cache (tmpdir): rendering+OCR-ing 29 full 300 DPI pages is slow
 *    (many minutes). Keyed by pdf+page, reused across runs.
 *  - Model-reply cache (tmpdir): each slot's prompt is a deterministic
 *    function of (slot, hint, OCR'd pages), so it's hashed and the reply
 *    cached. Re-running this script to tweak scoring math does not re-spend
 *    real API calls. Set MEASURE_LOCATE_FORCE=1 to bypass and re-ask.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
import { renderPageUpright } from "../src/lib/pipeline/render.ts";
import { ocrToLines } from "../src/lib/pipeline/ocr.ts";
import { locateSlot } from "../src/lib/pipeline/locate.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = join(REPO_ROOT, "documents");
const TESSERACT_ASSETS = join(REPO_ROOT, "public", "tesseract");

const PDFS = {
  merged: join(DOCS_DIR, "LOP285120_EXISTING_20240126_PKS_BSI_II_merged.pdf"),
  splitba: join(DOCS_DIR, "LOP285120_SPLITBA_BAP_C_Tel_17582_PSB_KCP_Slipi_REV3.pdf"),
};

const nodeContext = (w, h) => createCanvas(w, h).getContext("2d");

function range(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

// ---------------------------------------------------------------------------
// .env.local loader. Not scripts/env.mjs -- that file (in this worktree)
// configures the local Ollama server and knows nothing about Gemini. This is
// the same handful of lines scripts/smoke.mjs would need for the same reason.
// ---------------------------------------------------------------------------

function loadDotEnvLocal() {
  const path = join(REPO_ROOT, ".env.local");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
loadDotEnvLocal();

// ---------------------------------------------------------------------------
// Gemini `ask`: (prompt: string) => Promise<string>, matching the `Ask` type
// classify.ts/locate.ts already define. Text only -- no images are sent for
// any of the 12 slots this harness scores, consistent with the design's
// "Locate sends text alone for the text-anchored slots" and with the fact
// that Task 6's locate.ts has no image-fallback parameter at all yet.
// ---------------------------------------------------------------------------

const GEMINI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const MODEL_ID = process.env.MODEL_ID ?? "gemini-3.5-flash";
const THINKING_LEVEL = (process.env.GEMINI_THINKING_LEVEL ?? "low").toUpperCase();
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 2048);

if (!GEMINI_API_KEY) {
  console.error(
    "GOOGLE_GENERATIVE_AI_API_KEY is not set (checked process.env and .env.local). " +
      "This harness calls the real Gemini API and cannot proceed without it.",
  );
  process.exit(1);
}

async function geminiAskOnce(prompt, timeoutMs = 120_000) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent` +
    `?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: THINKING_LEVEL },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 500)}`);
    }
    const json = await res.json();
    const usage = json.usageMetadata ?? {};
    console.log(
      `    [gemini] in=${usage.promptTokenCount ?? "?"} out=${usage.candidatesTokenCount ?? "?"} ` +
        `thoughts=${usage.thoughtsTokenCount ?? 0} total=${usage.totalTokenCount ?? "?"}`,
    );
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? "").join("");
    if (!text.trim()) {
      throw new Error(`Gemini returned no text. finishReason=${json.candidates?.[0]?.finishReason}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function geminiAsk(prompt) {
  const attempts = 3;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await geminiAskOnce(prompt);
    } catch (err) {
      lastError = err;
      const transient = /HTTP 503|HTTP 429|AbortError|abort/i.test(String(err));
      if (!transient || i === attempts - 1) throw err;
      const backoffMs = 2000 * (i + 1);
      console.log(`    [gemini] transient error, retrying in ${backoffMs}ms: ${err.message}`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Model-reply cache: keyed by slot name + sha256 of the exact prompt sent, so
// it only ever serves a reply for the exact question that produced it.
// ---------------------------------------------------------------------------

const MODEL_CACHE_PATH = join(tmpdir(), "tv-helper-measure-locate-model-cache.json");
const FORCE_FRESH = process.env.MEASURE_LOCATE_FORCE === "1";

async function loadJsonCache(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

async function saveJsonCache(path, cache) {
  await writeFile(path, JSON.stringify(cache), "utf8");
}

function makeCachedAsk(slotName, modelCache) {
  return async function cachedAsk(prompt) {
    const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 16);
    const key = `${slotName}:${hash}`;
    if (!FORCE_FRESH && modelCache[key]) {
      console.log(`    [cache] reusing cached model reply for "${slotName}"`);
      return modelCache[key];
    }
    const reply = await geminiAsk(prompt);
    modelCache[key] = reply;
    await saveJsonCache(MODEL_CACHE_PATH, modelCache);
    return reply;
  };
}

// ---------------------------------------------------------------------------
// OCR cache: keyed by pdf name + 0-based page index. Rendering and OCR-ing a
// 3507x2480 scan is slow -- this is a real necessity, not a nicety, per the
// task brief: 27 + 2 = 29 pages must be OCR'd once for the whole run.
// ---------------------------------------------------------------------------

const OCR_CACHE_PATH = join(tmpdir(), "tv-helper-measure-locate-ocr-cache.json");

async function ocrPageCached(pdfDoc, pdfKey, pageIndex, ocrCache) {
  const key = `${pdfKey}:${pageIndex}`;
  if (ocrCache[key]) return ocrCache[key];

  const started = Date.now();
  const page = await pdfDoc.getPage(pageIndex + 1); // pdf.js pages are 1-based
  const rendered = await renderPageUpright(page, 300, nodeContext);
  const lines = await ocrToLines(rendered, "ind", {
    langPath: TESSERACT_ASSETS,
    gzip: true,
    // See scripts/test-pipeline.mjs's own note on this: without it, tesseract.js
    // decompresses the vendored .traineddata.gz once and caches the result in
    // process.cwd(), which would otherwise leave a stray file behind here.
    cacheMethod: "none",
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `  OCR ${pdfKey} page ${pageIndex}: ${rendered.width}x${rendered.height}, ` +
      `${lines.length} lines, ${seconds}s`,
  );

  const entry = { width: rendered.width, height: rendered.height, lines };
  ocrCache[key] = entry;
  await saveJsonCache(OCR_CACHE_PATH, ocrCache);
  return entry;
}

function toOcrPages(ocrCache, pdfKey, pageIndexes) {
  return pageIndexes.map((index) => {
    const entry = ocrCache[`${pdfKey}:${index}`];
    if (!entry) throw new Error(`page ${pdfKey}:${index} was never OCR'd`);
    return { index, width: entry.width, height: entry.height, lines: entry.lines };
  });
}

// ---------------------------------------------------------------------------
// Ground truth.
//
// A note on the count: the task brief and the design doc both say "eleven"
// crops. Direct inspection of the docx (unzip word/media/*.png) and its own
// provenance table put PDF-sourced images at twelve: image1 (BA), image17
// (Email), image2+image3 (SP, two DIFFERENT pages -- 23 and 24, confirmed by
// rendering and reading both), image4/5/6/7/8/9/10/11 (KB's seven checklist
// rows, where "ToP" alone uses two images on two DIFFERENT pages -- 19 and
// 20, also confirmed by rendering). 1 + 1 + 2 + 6 + 2 = 12. Because the two
// SP images and the two ToP images each require an independent locateSlot
// call (they live on different pages), there is no way to fold either pair
// back into a single scored row without silently dropping a real crop. This
// harness therefore scores 12 rows and says so plainly in the summary, rather
// than forcing a count that does not match what is actually in the sample.
// See the task-7 report for the full trace.
// ---------------------------------------------------------------------------

const KB_POOL = range(0, 22); // Bagian I + Bagian II of the Perjanjian Kerjasama
const SP_POOL = range(23, 26); // the Surat Penunjukan span
const SPLITBA_POOL = [0, 1];

const GROUND_TRUTH = [
  {
    slot: "BA Permintaan",
    doc: "splitba",
    page: 0,
    poolPages: SPLITBA_POOL,
    hint: "the request memo (Berita Acara Permintaan) that authorized this order",
    expect: "BERITA ACARA PERMINTAAN ORDER",
  },
  {
    slot: "Email",
    doc: "splitba",
    page: 1,
    poolPages: SPLITBA_POOL,
    hint: "the printed email thread confirming the order request",
    expect: "ayufitriyani732@gmail.com",
  },
  {
    slot: "SP / Isi Surat",
    doc: "merged",
    page: 23,
    altPages: [25], // identical duplicate copy of the same letter, see report
    poolPages: SP_POOL,
    hint: "the appointment letter (Surat Penunjukan) naming the parties and its reference number",
    expect: "03/1802-3/PFA",
  },
  {
    slot: "SP / TTD",
    doc: "merged",
    page: 24,
    altPages: [26], // identical duplicate copy of the same signature page
    poolPages: SP_POOL,
    hint: "the signature block accepting the appointment letter",
    expect: "PROCUREMENT & FIXED ASSET GROUP",
  },
  {
    slot: "KB / Nomor",
    doc: "merged",
    page: 0,
    poolPages: KB_POOL,
    hint: "the contract number of the Perjanjian Kerjasama",
    expect: "04/0044-PKS",
  },
  {
    slot: "KB / Para Pihak",
    doc: "merged",
    page: 0,
    poolPages: KB_POOL,
    hint: "the two parties entering the agreement",
    expect: "BANK SYARIAH INDONESIA",
  },
  {
    slot: "KB / Tanggal",
    doc: "merged",
    page: 0,
    poolPages: KB_POOL,
    hint: "the date the agreement was signed",
    expect: "Pada hari ini",
  },
  {
    slot: "KB / Jangka Waktu",
    doc: "merged",
    page: 17,
    poolPages: KB_POOL,
    hint: "the duration or term of the agreement (Jangka Waktu Perjanjian)",
    expect: "JANGKA WAKTU PERJANJIAN",
  },
  {
    slot: "KB / Detail",
    doc: "merged",
    page: 18,
    poolPages: KB_POOL,
    hint: "the scope of work and pricing table (Ruang Lingkup dan Harga Pekerjaan)",
    expect: "RUANG LINGKUP DAN HARGA PEKERJAAN",
  },
  {
    slot: "KB / ToP (1)",
    doc: "merged",
    page: 19,
    poolPages: KB_POOL,
    hint: "the terms of payment for the work (Pembayaran Pekerjaan)",
    expect: "PEMBAYARAN PEKERJAAN",
  },
  {
    slot: "KB / ToP (2)",
    doc: "merged",
    page: 20,
    poolPages: KB_POOL,
    hint: "the bank account number the payment is transferred to",
    expect: "4545454788",
  },
  {
    slot: "KB / TTD Pejabat",
    doc: "merged",
    page: 22,
    poolPages: KB_POOL,
    hint: "the signature block of the officials signing the agreement",
    expect: "Dedy Mardhianto",
  },
];

// ---------------------------------------------------------------------------
// Scoring.
// ---------------------------------------------------------------------------

function findExpectLines(ocrCache, doc, pageIndex, expect) {
  const entry = ocrCache[`${doc}:${pageIndex}`];
  if (!entry) return [];
  const needle = expect.toLowerCase();
  return entry.lines.filter((l) => l.text.toLowerCase().includes(needle)).map((l) => l.i);
}

function evaluate(entry, result, ocrCache) {
  if (!result) {
    return { pass: false, detail: "model returned no match (null pageIndex)" };
  }

  const acceptedPages = [entry.page, ...(entry.altPages ?? [])];
  const chosenPage = result.zone.pageIndex;
  const pageOk = acceptedPages.includes(chosenPage);

  const matchingLineIndexes = findExpectLines(ocrCache, entry.doc, chosenPage, entry.expect);
  const [from, to] = result.zone.lineRange;

  if (matchingLineIndexes.length === 0) {
    return {
      pass: false,
      pageOk,
      chosenPage,
      lineRange: [from, to],
      detail: `expected phrase "${entry.expect}" was not found by OCR on chosen page ${chosenPage} ` +
        `(OCR-quality issue, not necessarily a locate failure)`,
    };
  }

  const minLine = Math.min(...matchingLineIndexes);
  const maxLine = Math.max(...matchingLineIndexes);
  const containsPhrase = from <= minLine && to >= maxLine;
  const chosenLineCount = to - from + 1;
  const requiredLineCount = maxLine - minLine + 1;
  const extra = chosenLineCount - requiredLineCount;
  const extraOk = containsPhrase && extra <= 2;

  const pass = pageOk && containsPhrase && extraOk;

  return {
    pass,
    pageOk,
    containsPhrase,
    extra,
    chosenPage,
    lineRange: [from, to],
    requiredLineRange: [minLine, maxLine],
    detail: pass
      ? "ok"
      : !pageOk
        ? `wrong page: chose ${chosenPage}, expected ${acceptedPages.join(" or ")}`
        : !containsPhrase
          ? `chosen lines [${from},${to}] do not cover the phrase's line(s) [${minLine},${maxLine}]`
          : `chosen range is ${extra} lines wider than the phrase's line(s) (max 2 allowed)`,
  };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Model: ${MODEL_ID}  thinkingLevel=${THINKING_LEVEL}  maxOutputTokens=${MAX_OUTPUT_TOKENS}`);
  console.log(`OCR cache: ${OCR_CACHE_PATH}`);
  console.log(`Model-reply cache: ${MODEL_CACHE_PATH}${FORCE_FRESH ? " (forcing fresh calls)" : ""}`);
  console.log();

  const ocrCache = await loadJsonCache(OCR_CACHE_PATH);
  const modelCache = await loadJsonCache(MODEL_CACHE_PATH);

  // MEASURE_LOCATE_ONLY lets a single slot be re-run in isolation (by a
  // case-insensitive substring of its name) while iterating on this script.
  // Unset (the default, and what `pnpm measure:locate` runs) scores all 12.
  const only = process.env.MEASURE_LOCATE_ONLY?.toLowerCase();
  const slotsToRun = only
    ? GROUND_TRUTH.filter((g) => g.slot.toLowerCase().includes(only))
    : GROUND_TRUTH;

  const docs = {};
  for (const [key, path] of Object.entries(PDFS)) {
    const bytes = new Uint8Array(await readFile(path));
    docs[key] = await getDocument({ data: bytes }).promise;
    console.log(`${key}: ${docs[key].numPages} pages (${path})`);
  }
  console.log();

  // OCR every page any slot-to-run might need, once, up front.
  const neededPages = { merged: new Set(), splitba: new Set() };
  for (const g of slotsToRun) for (const p of g.poolPages) neededPages[g.doc].add(p);

  console.log("Running OCR (cached pages are skipped)...");
  for (const [docKey, pageSet] of Object.entries(neededPages)) {
    for (const pageIndex of [...pageSet].sort((a, b) => a - b)) {
      await ocrPageCached(docs[docKey], docKey, pageIndex, ocrCache);
    }
  }
  console.log("OCR complete.\n");

  const results = [];
  for (const entry of slotsToRun) {
    console.log(`Locating "${entry.slot}"...`);
    const pages = toOcrPages(ocrCache, entry.doc, entry.poolPages);
    const cachedAsk = makeCachedAsk(entry.slot, modelCache);

    let result = null;
    let error = null;
    try {
      result = await locateSlot(entry.slot, entry.hint, pages, cachedAsk);
    } catch (err) {
      error = err;
    }

    const verdict = error
      ? { pass: false, detail: `locateSlot threw: ${error.message}` }
      : evaluate(entry, result, ocrCache);

    results.push({ entry, result, verdict });

    const rangeStr = result ? `page ${result.zone.pageIndex}, lines [${result.zone.lineRange.join(",")}]` : "no proposal";
    console.log(`  -> ${verdict.pass ? "PASS" : "FAIL"}  ${rangeStr}  (expected page ${entry.page})`);
    if (!verdict.pass) console.log(`     ${verdict.detail}`);
    console.log();
  }

  console.log("=".repeat(78));
  console.log("SUMMARY");
  console.log("=".repeat(78));
  console.log(
    `${"Slot".padEnd(20)} ${"Verdict".padEnd(6)} ${"Page".padEnd(16)} ${"Lines".padEnd(12)} Detail`,
  );
  let passCount = 0;
  for (const { entry, result, verdict } of results) {
    if (verdict.pass) passCount++;
    const pageStr = result ? `${result.zone.pageIndex} (want ${entry.page})` : `- (want ${entry.page})`;
    const lineStr = result ? result.zone.lineRange.join(",") : "-";
    console.log(
      `${entry.slot.padEnd(20)} ${(verdict.pass ? "PASS" : "FAIL").padEnd(6)} ${pageStr.padEnd(16)} ${lineStr.padEnd(12)} ${verdict.pass ? "" : verdict.detail}`,
    );
  }
  console.log("-".repeat(78));
  console.log(`TOTAL: ${passCount} / ${results.length} passed`);
  console.log();
  if (!only) {
    console.log(
      "Note: this scores 12 individually-locatable crops, not the 11 the brief and\n" +
        "the design doc name -- see the file header comment and the task-7 report for\n" +
        "why (SP and ToP each contribute two crops on two different pages).",
    );
  }

  process.exitCode = only || passCount >= 9 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
