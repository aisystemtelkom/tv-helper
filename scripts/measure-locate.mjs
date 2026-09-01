/**
 * Scores the locate step (Task 6, src/lib/pipeline/locate.ts) against the
 * human-authored crops in the sample DOKUMEN VALIDASI docx. Run by hand: it
 * reads gitignored client documents in documents/ and calls the real model.
 * See .superpowers/sdd/2026-08-30-pipeline-headless/task-7-brief.md.
 *
 * A slot passes when it lands on an expected page and its chosen line range
 * CONTAINS every OCR line whose text appears in the ground-truth crop, with
 * overshoot capped proportionally: a range more than twice the required line
 * count is rejected, and so is one that runs the whole page when the crop
 * does not.
 *
 * That rule replaces "at most two extra lines", which the 2026-08-30 design
 * stated as though it were a requirement and which the 2026-08-31 corrections
 * note (section 3) records as invented, with no data behind it. Cross-checked
 * against the sample, the twelve human-authored crops run from 2 lines to 43:
 *
 *   image6  2   image4  9   image11  9   image10 15   image7 18   image3 21
 *   image9  27  image5 28   image2  34   image8  34   image1 35   image17 43
 *
 * A fixed +2 is therefore a 100% overshoot budget on the smallest crop and 5%
 * on the largest -- it measures nothing consistent, and it failed
 * `KB / Para Pihak` (+4) and `KB / TTD Pejabat` (+7) even though both
 * proposals contained every required line. A proportional cap catches a
 * genuine runaway (half the page returned for a two-line field) while
 * matching how a person actually crops.
 *
 * "The ground-truth crop's own OCR text" is not a hand-picked
 * phrase -- it is produced by OCR-ing each of the twelve crop PNGs
 * (word/media/imageN.png inside the sample docx) with the same `ocrToLines`
 * pipeline used on the full pages, so the comparison is real text against
 * real text, from the same OCR engine, not a human's guess at a
 * "representative" substring. See the normalisation/matching comment above
 * `lineAppearsInCrop` below for exactly how OCR variance between the two
 * renderings (crop screenshot vs. full-page scan) is tolerated. This is a
 * *stricter* rule than an earlier version of this script that matched a
 * single hand-picked phrase per slot -- it requires covering the whole crop,
 * not hitting one substring -- see task-7-report.md for why that phrase
 * proxy was replaced and what changed as a result.
 *
 * WHAT THIS GATE NOW MEASURES, and why it changed with the pipeline. Each
 * slot used to be offered only the pages of its own document type -- the KB
 * slots saw the 23 contract pages and nothing else. The 2026-08-31
 * corrections note (section 2) retires that narrowing: the tool is
 * document-agnostic, so every slot is searched across every page of every
 * supplied document. This harness follows, and offers all 29 pages of the
 * bundle to every field slot. A gate that kept the old narrow pools would
 * have gone on passing while the shipping pipeline searched something else
 * entirely.
 *
 * It also asks with the PRODUCTION label and hint. Where a ground-truth row
 * names a slot in `src/lib/forms/template.ts`, its `label` and `hint` are
 * read from there rather than restated here, so strengthening a hint to keep
 * it winning on a whole-bundle pool is a change this gate scores. Only
 * `KB / ToP (2)` keeps a hint of its own: the template holds ToP as one
 * `crops: 2` slot with one hint, and the sample's second capture is a
 * different region on a different page.
 *
 * THIS SCRIPT DOES NOT GO THROUGH src/lib/model.ts, and that is a known gap
 * rather than a design choice. It was written on a branch that predated the
 * Gemini migration, when model.ts still exported a local-Ollama chatModel and
 * there was no Ollama server to reach; it therefore calls the Gemini REST
 * surface directly with plain fetch. (An earlier version of this comment
 * still described that pre-migration model.ts as the current state. It has
 * not been true since the Gemini migration merged: model.ts exports a
 * Gemini-backed `chatModel()` now, and scripts/generate.mjs uses it.)
 *
 * No provider SDK is imported here, so the boundary rule is not broken, and
 * scripts/smoke.mjs takes the same posture deliberately -- a broken model.ts
 * must not invalidate the check. The consequence to know is the other
 * direction: THIS GATE CAN PASS WHILE src/lib/model.ts IS BROKEN, and this
 * script's own env defaults can drift from the app's. Check both before
 * reading a gate result as a statement about the app.
 *
 * Three on-disk caches make iteration cheap, and they are NOT symmetric.
 * Read this before trusting a score:
 *  - Model-reply cache (tmpdir): keyed by slot name plus a sha256 of the
 *    exact prompt sent, so it only ever serves a reply to the identical
 *    question. Re-running to tweak scoring math re-spends nothing.
 *    MEASURE_LOCATE_FORCE=1 bypasses THIS ONE, and only this one.
 *  - OCR cache (tmpdir): rendering+OCR-ing 29 full 300 DPI pages is slow
 *    (many minutes). Keyed by the document's ROLE plus 0-based page index --
 *    "merged:0", "splitba:1" -- not by filename and not by content. It
 *    returns a hit unconditionally; FORCE_FRESH is not consulted.
 *  - Crop OCR cache (tmpdir): the same, keyed by the image name inside the
 *    sample docx.
 *
 * So RE-EXPORTING A DOCUMENT SILENTLY SCORES ITS NEW PAGES AGAINST THE OLD
 * OCR, under any filename, and the run looks entirely normal. There is no
 * bypass for that: delete the temp cache file by hand. All three paths are
 * printed when the run starts.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { default: JSZip } = await import("jszip");
import { renderPageUpright } from "../src/lib/pipeline/render.ts";
import { ocrToLines } from "../src/lib/pipeline/ocr.ts";
import {
  locateSlot,
  CROP_PADDING_PX,
  FOOTER_GAP_MULTIPLE,
  MAX_FOOTER_LINES,
} from "../src/lib/pipeline/locate.ts";
import { boxForLineRange } from "../src/lib/pipeline/geometry.ts";
import { AO_TEMPLATE } from "../src/lib/forms/template.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = join(REPO_ROOT, "documents");
const TESSERACT_ASSETS = join(REPO_ROOT, "public", "tesseract");

/**
 * `documents/` is gitignored real client material (task-11 finding 5), so
 * its exact filenames -- revision suffix, work-order number and all -- must
 * not be hardcoded into a committed file. Globbing the directory instead
 * also means this script keeps working if the bundle is re-exported under a
 * slightly different name, which the previous exact-match hardcoding did
 * not survive.
 *
 * The bundle holds exactly two PDFs: the short SPLITBA scan (its own name
 * always contains "splitba", case-insensitively) and the long merged scan
 * (everything else). Throws with the directory listing on any other shape
 * rather than guessing which PDF is which.
 */
function findBundlePdfs(dir) {
  const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  const splitba = pdfs.find((f) => /splitba/i.test(f));
  const merged = pdfs.find((f) => f !== splitba);
  if (pdfs.length !== 2 || !splitba || !merged) {
    throw new Error(
      `expected exactly two PDFs under ${dir} -- one matching /splitba/i, ` +
        `one other -- found: ${pdfs.join(", ") || "(none)"}`,
    );
  }
  return { merged: join(dir, merged), splitba: join(dir, splitba) };
}

/** The one sample DOKUMEN VALIDASI docx the bundle's ground truth is scored
 * against. See findBundlePdfs above for why this globs rather than names it. */
function findSampleDocx(dir) {
  const docxs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".docx"));
  if (docxs.length !== 1) {
    throw new Error(
      `expected exactly one .docx under ${dir}, found ${docxs.length}: ` +
        `${docxs.join(", ") || "(none)"}`,
    );
  }
  return join(dir, docxs[0]);
}

const PDFS = findBundlePdfs(DOCS_DIR);
const DOCX_PATH = findSampleDocx(DOCS_DIR);

const nodeContext = (w, h) => createCanvas(w, h).getContext("2d");

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
  // Six attempts with a longer backoff, not three. Gemini returned repeated
  // HTTP 503 "high demand" during the first scored run and killed three slots
  // outright, which scores an availability blip as a localization failure --
  // exactly the false signal this gate must not produce. AGENTS.md already
  // records 503s on gemini-3.7-flash; 3.5-flash shows them under load too.
  const attempts = 6;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await geminiAskOnce(prompt);
    } catch (err) {
      lastError = err;
      const transient = /HTTP 503|HTTP 429|AbortError|abort/i.test(String(err));
      if (!transient || i === attempts - 1) throw err;
      const backoffMs = Math.min(2000 * 2 ** i, 30_000);
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

/**
 * MEASURE_LOCATE_REPEAT asks the SAME prompt again under a separate cache
 * key, so the same question can be sampled more than once without either
 * answer overwriting the other.
 *
 * This exists because a prompt A/B on this gate is otherwise uninterpretable.
 * Changing one sentence changes the prompt for all eight field slots, so all
 * eight are re-asked, and the model is not deterministic: some of the movement
 * between an "old prompt" run and a "new prompt" run is the prompt and some is
 * just resampling. `locate.ts`'s own header records an earlier footer-rule A/B
 * that "moved answers on nine of the twelve scored slots" and was reverted on
 * that basis -- with no measurement of how many slots move when NOTHING is
 * changed. Run `MEASURE_LOCATE_REPEAT=1` and `=2` against the unchanged prompt
 * first and that noise floor becomes a number instead of an assumption.
 *
 * The salt is mixed into the CACHE KEY ONLY, never into the prompt: repeat 3
 * asks a byte-identical question to repeat 0. Repeat 0 is the default and its
 * key is the bare `slot:hash` the cache already holds, so existing entries
 * keep hitting and a default run re-spends nothing.
 */
const REPEAT = Number(process.env.MEASURE_LOCATE_REPEAT ?? 0);
if (!Number.isInteger(REPEAT) || REPEAT < 0) {
  console.error(`MEASURE_LOCATE_REPEAT must be a non-negative integer, got "${process.env.MEASURE_LOCATE_REPEAT}"`);
  process.exit(1);
}

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
    // Repeat 0 keeps the historical bare key so the existing cache still hits.
    const key = REPEAT === 0 ? `${slotName}:${hash}` : `${slotName}:${hash}:r${REPEAT}`;
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
// OCR cache: keyed by the document's ROLE ("merged"/"splitba") + 0-based page
// index. Rendering and OCR-ing a 3507x2480 scan is slow -- this is a real
// necessity, not a nicety: the merged contract scan is 27 pages and the
// SPLITBA scan is 2, so 29 pages must be OCR'd once for the whole run.
//
// The key depends on neither the filename nor the bytes, and the lookup below
// ignores FORCE_FRESH, so a re-exported document scores its new pages against
// this cache's old text with nothing in the log to say so. Deleting
// OCR_CACHE_PATH by hand is the only way out. See the file header.
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

/**
 * Every page of the whole bundle, in one list, numbered the way
 * `scripts/generate.mjs` numbers them: the merged scan first, then the
 * SPLITBA, with `index` continuing across the file boundary.
 *
 * One list rather than one per document, because the pool a slot is offered
 * is now the whole bundle -- see the file header. `doc` and `pageInDoc` are
 * kept alongside so a failure can still be reported as "merged page 19",
 * which is what a person opens.
 */
function allBundlePages(ocrCache, docPageCounts) {
  const pages = [];
  for (const docKey of DOC_ORDER) {
    for (let pageInDoc = 0; pageInDoc < docPageCounts[docKey]; pageInDoc++) {
      const entry = ocrCache[`${docKey}:${pageInDoc}`];
      if (!entry) throw new Error(`page ${docKey}:${pageInDoc} was never OCR'd`);
      pages.push({
        index: pages.length,
        doc: docKey,
        pageInDoc,
        width: entry.width,
        height: entry.height,
        lines: entry.lines,
      });
    }
  }
  return pages;
}

/** The bundle-global index of a (document, page-in-document) pair. */
function globalIndexOf(pages, docKey, pageInDoc) {
  const page = pages.find((p) => p.doc === docKey && p.pageInDoc === pageInDoc);
  if (!page) throw new Error(`no page ${docKey}:${pageInDoc} in the bundle`);
  return page.index;
}

// ---------------------------------------------------------------------------
// Ground-truth crop OCR.
//
// The spec's rule is scored against each crop's OWN OCR text, not a
// hand-picked phrase -- see the file header comment. The twelve crop PNGs
// live at word/media/imageN.png inside the sample docx; each is small
// (a cropped screenshot, not a full page), so OCR-ing all twelve is quick
// relative to the 29 full pages above. Cached separately by image filename
// so re-running this script never re-OCRs them either.
//
// CROP_OCR_UPSCALE exists because these crops are NOT rendered at the 300
// DPI the rest of this pipeline assumes. Measured directly: image1.png (the
// "BA Permintaan" crop, a full printed page of body text) is 472x752 pixels
// -- for that much text, on the order of 70-100 DPI, well below what
// tesseract needs for small print. OCR-ing it as-is produced pure noise
// ("ea Beam Kata Panjar serdanTAan Onoea..." -- not merely a few wrong
// characters, but no resemblance to the real Indonesian text at all).
// Upscaling the bitmap by 3x before OCR (bringing it near the 300 DPI the
// full pages already render at) turned that same image into clean,
// correctly-read text. Cross-checked at 2x (one crop's genuine text still
// missed tolerance) and 4x (no further improvement over 3x on any of the
// twelve crops) before picking 3x -- this was decided by inspecting OCR
// text quality against the crops' own known content, before any live model
// reply was scored against it, and was not revised afterward. See
// task-7-report.md.
// ---------------------------------------------------------------------------

const CROP_OCR_CACHE_PATH = join(tmpdir(), "tv-helper-measure-locate-crop-ocr-cache.json");
const CROP_OCR_UPSCALE = 3;

let docxZipPromise;
function loadDocxZip() {
  docxZipPromise ??= readFile(DOCX_PATH).then((bytes) => JSZip.loadAsync(bytes));
  return docxZipPromise;
}

async function ocrCropCached(imageName, cropCache) {
  if (cropCache[imageName]) return cropCache[imageName];

  const zip = await loadDocxZip();
  const file = zip.file(`word/media/${imageName}`);
  if (!file) throw new Error(`docx is missing word/media/${imageName}`);
  const pngBytes = await file.async("nodebuffer");

  const started = Date.now();
  const image = await loadImage(pngBytes);
  const width = Math.round(image.width * CROP_OCR_UPSCALE);
  const height = Math.round(image.height * CROP_OCR_UPSCALE);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);

  const lines = await ocrToLines(
    { data, width, height },
    "ind",
    { langPath: TESSERACT_ASSETS, gzip: true, cacheMethod: "none" },
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `  OCR crop ${imageName}: ${image.width}x${image.height} upscaled ${CROP_OCR_UPSCALE}x to ` +
      `${width}x${height}, ${lines.length} lines, ${seconds}s`,
  );

  const entry = { width, height, lines };
  cropCache[imageName] = entry;
  await saveJsonCache(CROP_OCR_CACHE_PATH, cropCache);
  return entry;
}

// ---------------------------------------------------------------------------
// Text normalisation and matching, used to find which of a page's OCR lines
// correspond to a ground-truth crop's own OCR text.
//
// The same printed content is rasterised twice at different resolutions --
// once inside the 300 DPI full-page scan, once as a Word-embedded screenshot
// crop -- and tesseract does not always read the two identically. Per the
// task brief, the matcher tolerates: case (lowercased first), whitespace
// (collapsed to single spaces between normalised tokens), and two classes of
// characters tesseract commonly confuses at small sizes -- {l, i, 1} and
// {o, 0} -- each folded to one representative before comparison.
//
// A first version of this matcher (see git history) tokenised both sides and
// asked, per page line independently, "are most of this line's words
// present somewhere, in any order, in the crop's pooled vocabulary". That
// failed outright on this document, for a reason that is NOT ocr noise: a
// legal contract genuinely repeats the same text verbatim at multiple
// points -- e.g. "PERUSAHAAN PERSEROAN (PERSERO) PT TELEKOMUNIKASI
// INDONESIA TBK" appears in the title block, again introducing party II,
// and again in a notary reference paragraph 25+ lines later. The
// nine-line "KB / Nomor" crop (just the title block and two contract
// numbers) registered page-0 lines past index 30 as "required" this way,
// because those later, unrelated lines are ALSO built largely from that
// same recurring company name -- an accurate finding about the text, but
// the wrong question to have asked. Per-line matching cannot tell "the
// crop's own occurrence of this text" from "any occurrence of this text
// anywhere on the page". That is a defect in the matcher, not a signal
// about the model, so it was fixed here before any slot was scored against
// a live model reply -- see task-7-report.md.
//
// The fix: stop matching line-by-line and match the crop as a WHOLE. Each
// side is reduced to one normalised-token string in reading order (a page's
// full text, and a crop's full text); the crop's entire string is searched
// for as one approximate, ORDER-preserving, CONTIGUOUS run within the
// page's string (a free-start/free-end fuzzy substring search, i.e. where
// in the page does the crop's whole sequence of words best line up). A
// short recurring phrase elsewhere on the page cannot substitute for the
// crop's full sequence of words in that single-window search the way it
// could satisfy an independent per-line, any-order check -- reproducing
// dozens of characters of a specific sequence by coincidence is a
// fundamentally different (and vastly less likely) event than one company
// name recurring. The winning window's character span is then mapped back
// to whichever original OCR lines it overlaps, which becomes the required
// line range directly (no more independent per-line filtering).
//
// This algorithm and its tolerance were fixed before any live model reply
// was scored against them and were not revised afterward -- see
// task-7-report.md.
// ---------------------------------------------------------------------------

function foldConfusables(s) {
  return s.replace(/[li1]/g, "1").replace(/[o0]/g, "0");
}

function normalizeToken(raw) {
  return foldConfusables(raw.toLowerCase()).replace(/[^a-z0-9]/g, "");
}

function tokenize(text) {
  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length >= 2);
}

/** A line reduced to its normalised tokens, space-joined in reading order. */
function lineSignature(text) {
  return tokenize(text).join(" ");
}

/** A whole crop's OCR lines reduced to one signature, in top-to-bottom order. */
function cropSignature(cropLines) {
  return cropLines.map((l) => lineSignature(l.text)).filter(Boolean).join(" ");
}

/**
 * A page's OCR lines reduced to one signature string, in top-to-bottom
 * order, alongside each contributing line's [start, end) character span
 * within that string -- so a character range later found inside `text` can
 * be mapped straight back to which original line indexes produced it. A
 * line with no normalisable text (pure noise/symbols) contributes nothing
 * and can never itself be "required".
 */
function buildPageSignature(pageLines) {
  let text = "";
  const spans = [];
  for (const line of [...pageLines].sort((a, b) => a.i - b.i)) {
    const sig = lineSignature(line.text);
    if (!sig) continue;
    if (text.length > 0) text += " ";
    const start = text.length;
    text += sig;
    spans.push({ i: line.i, start, end: text.length });
  }
  return { text, spans };
}

/**
 * Best (lowest-cost) alignment of `needle` against a contiguous run
 * somewhere in `haystack` -- a free-start/free-end fuzzy substring search.
 * Standard Levenshtein DP, except: the first row is held at 0 (a match can
 * start at any haystack position for free) and, alongside the usual cost,
 * each cell also carries the haystack start position the best path to it
 * began from, propagated from whichever of the three predecessors was
 * chosen. Reading off the minimum of the final row then gives both the
 * lowest cost and the [start, end) haystack span that produced it.
 * O(len(needle) * len(haystack)); comfortably fast at the sizes here
 * (needles and haystacks both well under 3000 characters).
 */
function bestSubstringMatch(needle, haystack) {
  const n = needle.length;
  const m = haystack.length;
  if (n === 0) return { distance: 0, start: 0, end: 0 };
  if (m === 0) return { distance: n, start: 0, end: 0 };

  let prevCost = new Array(m + 1).fill(0);
  let prevStart = new Array(m + 1);
  for (let j = 0; j <= m; j++) prevStart[j] = j;
  let currCost = new Array(m + 1);
  let currStart = new Array(m + 1);

  for (let i = 1; i <= n; i++) {
    currCost[0] = i;
    currStart[0] = prevStart[0];
    for (let j = 1; j <= m; j++) {
      const subCost = prevCost[j - 1] + (needle[i - 1] === haystack[j - 1] ? 0 : 1);
      const delCost = prevCost[j] + 1; // needle char consumed, haystack char not
      const insCost = currCost[j - 1] + 1; // haystack char consumed, needle char not

      let best = subCost;
      let start = prevStart[j - 1];
      if (delCost < best) {
        best = delCost;
        start = prevStart[j];
      }
      if (insCost < best) {
        best = insCost;
        start = currStart[j - 1];
      }
      currCost[j] = best;
      currStart[j] = start;
    }
    [prevCost, currCost] = [currCost, prevCost];
    [prevStart, currStart] = [currStart, prevStart];
  }

  let bestJ = 0;
  for (let j = 1; j <= m; j++) if (prevCost[j] < prevCost[bestJ]) bestJ = j;
  return { distance: prevCost[bestJ], start: prevStart[bestJ], end: bestJ };
}

/**
 * The [minLine, maxLine] run of a page's OCR lines that best reproduces a
 * ground-truth crop's own OCR text, or null if no window on this page comes
 * within tolerance (roughly 25% of the crop signature's own length, floor
 * 4 characters -- generous against per-character OCR noise across an
 * entire crop, but far tighter than any single recurring phrase could
 * satisfy on its own).
 */
function findRequiredLineRange(pageLines, cropSig) {
  if (!cropSig) return null;
  const { text: pageSig, spans } = buildPageSignature(pageLines);
  if (spans.length === 0) return null;

  const { distance, start, end } = bestSubstringMatch(cropSig, pageSig);
  const tolerance = Math.max(4, Math.round(cropSig.length * 0.25));
  if (distance > tolerance) return null;

  const covered = spans.filter((s) => s.start < end && s.end > start).map((s) => s.i);
  if (covered.length === 0) return null;

  return { minLine: Math.min(...covered), maxLine: Math.max(...covered), distance, tolerance };
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

/**
 * Document order in the bundle-global page numbering. `scripts/generate.mjs`
 * numbers pages in the order the PDFs are passed on the command line; this
 * fixes an order so the two agree and a `pageIndex` means the same thing in
 * both. The merged scan first, then the SPLITBA.
 */
const DOC_ORDER = ["merged", "splitba"];

/**
 * Production label and hint, read from the template rather than restated
 * here, so a hint strengthened to survive a whole-bundle pool is scored by
 * this gate instead of drifting away from it silently.
 */
const TEMPLATE_SLOTS = new Map(
  AO_TEMPLATE.sections.flatMap((section) =>
    section.slots.map((slot) => [slot.key, { section, slot }]),
  ),
);

function askedAs(entry) {
  if (!entry.slotKey) return { label: entry.slot, hint: entry.hint };
  const found = TEMPLATE_SLOTS.get(entry.slotKey);
  if (!found) {
    throw new Error(
      `ground truth names slot "${entry.slotKey}", which AO_TEMPLATE no longer has`,
    );
  }
  // The same composition `generate.mjs`'s `slotSearchLabel` makes -- section
  // title without its `(lanjutan)` layout suffix, then the row label -- so
  // this gate asks the question production asks rather than a tidier one.
  return {
    label: `${found.section.title.replace(/\s*\(lanjutan\)\s*$/i, "")} / ${found.slot.label}`,
    hint: found.slot.hint,
  };
}

/**
 * `poolPages` is gone from these rows on purpose. Every field slot is now
 * offered the whole bundle -- see the file header -- so a per-row pool would
 * only be a way to quietly re-narrow the search this gate exists to measure.
 *
 * `page` stays a page number WITHIN `doc`, because that is what a person
 * opens; `globalIndexOf` converts it to the bundle-global index the model's
 * answer is expressed in.
 */
const GROUND_TRUTH = [
  {
    slot: "BA Permintaan",
    wholeDocument: true,
    doc: "splitba",
    page: 0,
    hint: "the request memo (Berita Acara Permintaan) that authorized this order",
    image: "image1.png",
  },
  {
    slot: "Email",
    wholeDocument: true,
    doc: "splitba",
    page: 1,
    hint: "the printed email thread confirming the order request",
    image: "image17.png",
  },
  {
    slot: "SP / Isi Surat",
    wholeDocument: true,
    doc: "merged",
    page: 23,
    altPages: [25], // identical duplicate copy of the same letter, see report
    hint: "the appointment letter (Surat Penunjukan) naming the parties and its reference number",
    image: "image2.png",
  },
  {
    slot: "SP / TTD",
    wholeDocument: true,
    doc: "merged",
    page: 24,
    altPages: [26], // identical duplicate copy of the same signature page
    hint: "the signature block accepting the appointment letter",
    image: "image3.png",
  },
  {
    slot: "KB / Nomor",
    slotKey: "kb.nomor",
    doc: "merged",
    page: 0,
    image: "image4.png",
  },
  {
    slot: "KB / Para Pihak",
    slotKey: "kb.paraPihak",
    doc: "merged",
    page: 0,
    image: "image5.png",
  },
  {
    slot: "KB / Tanggal",
    slotKey: "kb.tanggal",
    doc: "merged",
    page: 0,
    image: "image6.png",
  },
  {
    slot: "KB / Jangka Waktu",
    slotKey: "kb.jangkaWaktu",
    doc: "merged",
    page: 17,
    image: "image7.png",
  },
  {
    slot: "KB / Detail",
    slotKey: "kbLanjutan.detail",
    doc: "merged",
    page: 18,
    image: "image8.png",
  },
  {
    slot: "KB / ToP (1)",
    slotKey: "kbLanjutan.top",
    doc: "merged",
    page: 19,
    image: "image9.png",
  },
  {
    // No slotKey: the template holds ToP as ONE `crops: 2` slot with one
    // hint, and the sample's second capture is a different region on a
    // different page. Asking the template's ToP hint twice would score the
    // same question twice and call the second answer a different slot.
    //
    // ## Why this row fails, and why it is not a locate defect to go fix
    //
    // Diagnosed from the OCR of merged page 20 rather than from the score.
    // The model answers lines 6-15, stably: 6-15 on two of three identical
    // samples and 6-16 on the third. The human's crop is lines 1-15. So the
    // two agree on where the block ENDS (line 15, the last line of the
    // remittance-account block) and disagree only on where it STARTS. An
    // earlier reading of this miss as "starts too late AND stops too early"
    // is wrong on the second half; `containsAll` fails on `from` alone.
    //
    // What is actually on that page: line 1 is the letterhead, lines 2-5 are
    // clause 4 (where to send invoices), lines 6-10 are clause 5 (when payment
    // is made, ending "ditujukan :"), lines 11-15 are the account block
    // itself. Asked for "the bank account number the payment is transferred
    // to", the model returned the account block plus the clause that
    // introduces it. That is a tighter and better-targeted piece of evidence
    // than the human's, which additionally carries the page letterhead and an
    // unrelated clause about invoice delivery.
    //
    // There is no document-agnostic rule that recovers the human's start.
    // "Include the page letterhead for provenance" was the obvious candidate
    // and the sample itself refutes it: of the crops whose block does not
    // begin at the top of the page, ONLY this one includes the letterhead.
    // `KB / Nomor` starts at line 2 of page 0, below a two-line letterhead;
    // `KB / TTD Pejabat` starts at line 7 of page 22, below a one-line
    // letterhead. A rule that reproduced this crop would inflate those two and
    // contradict the human on 7 of 8 field slots.
    //
    // That used to be the argument. It is now a measurement, run offline
    // against the required ranges this gate already prints, giving the
    // hypothesis its BEST case: every field slot keeps the end it answers
    // today and starts at line 0 instead.
    //
    //   KB / Nomor          PASS -> PASS
    //   KB / Para Pihak     PASS -> PASS
    //   KB / Tanggal        PASS -> FAIL  13 lines for a 2-line crop
    //   KB / Jangka Waktu   PASS -> FAIL  43 lines for an 18-line crop
    //   KB / Detail         PASS -> FAIL  runs the whole page (0-28)
    //   KB / ToP (1)        PASS -> FAIL  runs the whole page (0-37)
    //   KB / ToP (2)        FAIL -> PASS
    //   KB / TTD Pejabat    PASS -> PASS
    //
    // Fixes one, breaks four: 11/12 -> 8/12, and that is the ceiling for the
    // idea, not a sample of it. No model call was spent finding this out.
    //
    // Worth knowing before trying to close the gap semantically instead:
    // rewriting the hint cannot pass this row either. The required range
    // starts at line 1, which IS the letterhead (line 0 of this page is a
    // stray mark). Clause 4 and clause 5 are both payment terms, so the best
    // defensible semantic answer for "Terms of Payment" here is lines 2-15 --
    // and 2 > 1, so `containsAll` still fails. The only answers that pass this
    // row start on the letterhead.
    //
    // Worth knowing before treating this row as a product defect: PRODUCTION
    // NEVER ASKS THIS QUESTION. `kbLanjutan.top` is one slot with one hint and
    // `crops: 2`, so `generate.mjs` makes a single locate call per round (the
    // one scored as `KB / ToP (1)`, which passes) and the second capture stays
    // outstanding for the dokumen tambahan round and manual selection -- see
    // the `crops: 2` comment in template.ts. The hint on this row is therefore
    // this harness's own invention, not a production string, which is also why
    // rewriting it until the row passes would measure nothing: it would be
    // tuning a question no shipping code asks.
    slot: "KB / ToP (2)",
    doc: "merged",
    page: 20,
    hint: "the bank account number the payment is transferred to",
    image: "image10.png",
  },
  {
    slot: "KB / TTD Pejabat",
    slotKey: "kbLanjutan.ttdPejabat",
    doc: "merged",
    page: 22,
    image: "image11.png",
  },
];

// ---------------------------------------------------------------------------
// Scoring: right page, chosen range CONTAINS every full-page OCR line whose
// text appears in the ground-truth crop's own OCR text, and overshoot capped
// proportionally rather than at a flat +2. See the file header for why the
// flat allowance was wrong, and findRequiredLineRange above for how the
// required range is derived.
// ---------------------------------------------------------------------------

/**
 * How much wider than the crop a proposal may be. Two: a range of at most
 * twice the required line count.
 *
 * Proportional because the sample's own crops span 2 to 43 lines, so any
 * fixed number is a wildly different standard at the two ends. Two rather
 * than some other multiple because doubling is already generous for the
 * behaviour the cap exists to catch -- a localizer that returns half a page
 * while claiming to have found a field -- and the failure the cap is NOT
 * meant to catch is a person's ordinary habit of taking the surrounding
 * block. The `runs the full page` clause below is what actually stops a
 * runaway on a short field, where 2x of a two-line crop is still only four
 * lines.
 */
const OVERSHOOT_MULTIPLE = 2;

function evaluate(entry, result, pages, cropOcrCache) {
  if (!result) {
    return { pass: false, detail: "model returned no match (null pageIndex)" };
  }

  const acceptedPages = entry.acceptedPages;
  const chosenPage = result.zone.pageIndex;
  const pageOk = acceptedPages.includes(chosenPage);
  const [from, to] = result.zone.lineRange;

  if (!pageOk) {
    return {
      pass: false,
      pageOk,
      chosenPage,
      lineRange: [from, to],
      detail: `wrong page: chose ${chosenPage}, expected ${acceptedPages.join(" or ")}`,
    };
  }

  const pageEntry = pages[chosenPage];
  if (!pageEntry) throw new Error(`page ${chosenPage} is not in the bundle`);

  const cropEntry = cropOcrCache[entry.image];
  if (!cropEntry) throw new Error(`crop ${entry.image} was never OCR'd`);
  const cropSig = cropSignature(cropEntry.lines);

  const required = findRequiredLineRange(pageEntry.lines, cropSig);

  if (!required) {
    return {
      pass: false,
      pageOk,
      chosenPage,
      lineRange: [from, to],
      detail:
        `no window of chosen page ${chosenPage} matched crop ${entry.image}'s own OCR text ` +
        `within tolerance (OCR-quality issue, not necessarily a locate failure)`,
    };
  }

  const { minLine, maxLine } = required;
  const containsAll = from <= minLine && to >= maxLine;
  const chosenLineCount = to - from + 1;
  const requiredLineCount = maxLine - minLine + 1;
  const extra = chosenLineCount - requiredLineCount;

  // "Runs the full page when the crop does not" is measured against the
  // page's own line numbering rather than assuming it starts at 0, because
  // `boxForLineRange` and the OCR line ids are the same numbers the model
  // was shown.
  const lineIds = pageEntry.lines.map((l) => l.i);
  const firstLine = lineIds.length > 0 ? Math.min(...lineIds) : 0;
  const lastLine = lineIds.length > 0 ? Math.max(...lineIds) : 0;
  const chosenIsWholePage = from <= firstLine && to >= lastLine;
  const requiredIsWholePage = minLine <= firstLine && maxLine >= lastLine;

  const withinMultiple = chosenLineCount <= OVERSHOOT_MULTIPLE * requiredLineCount;
  const notAWholePageGrab = !(chosenIsWholePage && !requiredIsWholePage);

  // A whole-document slot is not localizing anything -- it deliberately takes
  // the entire page -- so neither cap measures anything there, and both would
  // fail every such slot merely because the page carries a header or footer
  // the human's crop trimmed. Containment is the whole test for these.
  //
  // This is a per-slot-TYPE rule, not a per-slot exemption: no individual
  // slot is excused, and the two types are reported separately below so the
  // model-dependent number stays visible on its own.
  const overshootOk = entry.wholeDocument || (withinMultiple && notAWholePageGrab);
  const pass = pageOk && containsAll && overshootOk;

  let detail = "ok";
  if (!containsAll) {
    detail =
      `chosen lines [${from},${to}] do not cover the crop's required lines ` +
      `[${minLine},${maxLine}]`;
  } else if (!withinMultiple) {
    detail =
      `chosen range is ${chosenLineCount} lines for a ${requiredLineCount}-line crop ` +
      `[${minLine},${maxLine}] -- more than ${OVERSHOOT_MULTIPLE}x`;
  } else if (!notAWholePageGrab) {
    detail =
      `chosen range [${from},${to}] runs the whole page (${firstLine}-${lastLine}) ` +
      `while the crop [${minLine},${maxLine}] does not`;
  }

  // ---------------------------------------------------------------------
  // How TALL the proposal is, against how tall the human's own crop is.
  //
  // Reported, deliberately NOT scored. The line-count caps above cannot see
  // this: `KB / TTD Pejabat` answers a 14-line range for a 9-line crop and
  // passes both of them comfortably, while the picture that actually lands
  // in the deliverable is ~9 inches of mostly blank paper, because the last
  // line it takes is the running page footer two thirds of a page below the
  // signature block. A line is a line whether it sits 40 pixels below the
  // previous one or 1700, so a line-count rule is structurally blind to the
  // defect and no amount of tuning it will help.
  //
  // Both boxes come from `boxForLineRange` with the production padding, on
  // the same page geometry, so this is the real crop against the real crop
  // rather than a proxy: `requiredHeightPx` is what the human's own chosen
  // lines occupy on the 300 DPI page, not the docx thumbnail's pixel height
  // (which is a Word-embedded screenshot at an unknown, much lower DPI and
  // says nothing about the source page).
  //
  // It is left unscored on purpose. Making it a pass condition would be a
  // second gate fitted to twelve samples, and would fail slots for a
  // whitespace habit rather than for citing the wrong evidence. It is here
  // so the inflation is a printed number that a change can be measured
  // against, instead of the "roughly 1.3in became 8in" estimate that this
  // defect has been carried as until now.
  // ---------------------------------------------------------------------
  const bounds = { x: 0, y: 0, w: pageEntry.width, h: pageEntry.height };
  const chosenHeightPx = result.zone.box.h;
  const requiredHeightPx = boxForLineRange(
    pageEntry.lines,
    minLine,
    maxLine,
    CROP_PADDING_PX,
    bounds,
  ).h;

  return {
    pass,
    pageOk,
    containsAll,
    extra,
    chosenPage,
    lineRange: [from, to],
    requiredLineRange: [minLine, maxLine],
    chosenHeightPx,
    requiredHeightPx,
    humanGapRatio: maxGapRatio(pageEntry.lines, minLine, maxLine),
    detail,
  };
}

/** Page pixels to inches. Every page in this pipeline is rendered at 300 DPI
 * (`renderPageUpright(page, 300, ...)` above), so this is exact, not nominal. */
const RENDER_DPI = 300;
const inches = (px) => px / RENDER_DPI;

/**
 * The largest vertical gap inside a line range, in units of that range's own
 * median line pitch -- the exact quantity `trimRunningFooter` thresholds on.
 *
 * Reported for the HUMAN's line range on every slot, because that is the
 * number that justifies (or refutes) `FOOTER_GAP_MULTIPLE`. Every gap inside a
 * human-authored crop is a gap the trim must NEVER cut: it is legitimate
 * content spacing, by definition, since a person included both sides of it in
 * one piece of evidence. So the highest value this column ever reaches across
 * the twelve crops is a hard lower bound on any safe constant, measured rather
 * than guessed -- and the distance between that bound and the ratio at a real
 * footer is the whole safety margin. Printing both is what stops the constant
 * from being folklore.
 *
 * Returns null when the range is too short for a median pitch to mean
 * anything, which is the same condition under which the trim declines to fire.
 */
function maxGapRatio(pageLines, from, to) {
  const picked = pageLines
    .filter((l) => l.i >= from && l.i <= to)
    .sort((a, b) => a.i - b.i);
  if (picked.length < 4) return null;

  const pitches = [];
  for (let k = 1; k < picked.length; k++) {
    pitches.push(picked[k].box.y - picked[k - 1].box.y);
  }
  const typical = median(pitches);
  if (typical <= 0) return null;

  return Math.max(...pitches) / typical;
}

/**
 * The same median `trimRunningFooter` takes, so the numbers this script prints
 * about that rule are the rule's own arithmetic and not a lookalike.
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How many trailing lines `trimRunningFooter` would delete from a page if it
 * were handed that whole page as its block: the size of the page's running
 * footer, measured rather than assumed.
 *
 * This is the quantity `MAX_FOOTER_LINES` is drawn from, so printing it keeps
 * that constant's margin checked the same way `humanGapRatio` keeps
 * `FOOTER_GAP_MULTIPLE`'s. The two constants answer different questions and
 * both can be wrong on their own: the gap multiple decides WHETHER a gap looks
 * like the one above a footer, and the line cap decides whether what sits
 * below it is small enough to BE one. A bundle whose footers OCR into more
 * lines than the cap allows would stop being trimmed at all -- crops inflate,
 * nothing throws -- and this line is where that shows up.
 *
 * Deliberately measured with the whole page as the block rather than with the
 * model's chosen range: the footer's own size is a property of the page, and
 * measuring it against ranges the model happened to choose this run would make
 * the constant's justification move every time an answer moved.
 *
 * Returns 0 for a page with no oversized gap at all, which is most of them.
 */
function footerTailLines(pageLines) {
  const sorted = [...pageLines].sort((a, b) => a.i - b.i);
  if (sorted.length < 4) return 0;

  const pitches = [];
  for (let k = 1; k < sorted.length; k++) {
    pitches.push(sorted[k].box.y - sorted[k - 1].box.y);
  }
  const typical = median(pitches);
  if (typical <= 0) return 0;

  let cutAfter = -1;
  for (let k = 0; k < pitches.length; k++) {
    if (pitches[k] >= FOOTER_GAP_MULTIPLE * typical) cutAfter = k;
  }
  if (cutAfter < 0) return 0;

  return sorted.length - (cutAfter + 1);
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Model: ${MODEL_ID}  thinkingLevel=${THINKING_LEVEL}  maxOutputTokens=${MAX_OUTPUT_TOKENS}`);
  console.log(`OCR cache: ${OCR_CACHE_PATH}`);
  console.log(`Crop OCR cache: ${CROP_OCR_CACHE_PATH}`);
  console.log(`Model-reply cache: ${MODEL_CACHE_PATH}${FORCE_FRESH ? " (forcing fresh calls)" : ""}`);
  console.log();

  const ocrCache = await loadJsonCache(OCR_CACHE_PATH);
  const cropOcrCache = await loadJsonCache(CROP_OCR_CACHE_PATH);
  const modelCache = await loadJsonCache(MODEL_CACHE_PATH);

  // MEASURE_LOCATE_ONLY lets a single slot be re-run in isolation (by a
  // case-insensitive substring of its name) while iterating on this script.
  // Unset (the default, and what `pnpm measure:locate` runs) scores all 12.
  const only = process.env.MEASURE_LOCATE_ONLY?.toLowerCase();
  const slotsToRun = only
    ? GROUND_TRUTH.filter((g) => g.slot.toLowerCase().includes(only))
    : GROUND_TRUTH;

  const docs = {};
  const docPageCounts = {};
  for (const [key, path] of Object.entries(PDFS)) {
    const bytes = new Uint8Array(await readFile(path));
    docs[key] = await getDocument({ data: bytes }).promise;
    docPageCounts[key] = docs[key].numPages;
    console.log(`${key}: ${docs[key].numPages} pages (${path})`);
  }
  console.log();

  // EVERY page of EVERY document, always -- not just the ones some slot's
  // pool used to name. The pool is the whole bundle now (see the file
  // header), so "which pages does this slot need" is no longer a question
  // this harness is allowed to answer in advance. Even under
  // MEASURE_LOCATE_ONLY: one slot still sees the whole bundle.
  console.log("Running OCR (cached pages are skipped)...");
  for (const docKey of DOC_ORDER) {
    for (let pageInDoc = 0; pageInDoc < docPageCounts[docKey]; pageInDoc++) {
      await ocrPageCached(docs[docKey], docKey, pageInDoc, ocrCache);
    }
  }
  console.log("OCR complete.\n");

  const pages = allBundlePages(ocrCache, docPageCounts);
  console.log(
    `Bundle: ${pages.length} pages, numbered 0-${pages.length - 1} across ` +
      `${DOC_ORDER.join(" then ")}.\n`,
  );

  // The ground truth names pages within a document, because that is what a
  // person opens; the model answers in bundle-global indexes. Resolve one to
  // the other once, here, rather than in three places below.
  for (const entry of GROUND_TRUTH) {
    entry.acceptedPages = [entry.page, ...(entry.altPages ?? [])].map((p) =>
      globalIndexOf(pages, entry.doc, p),
    );
  }

  // OCR every ground-truth crop image any slot-to-run needs, once, up front.
  // This is what the score is measured against -- see the file header and
  // the "Ground-truth crop OCR" section above.
  console.log("Running OCR on ground-truth crop images (cached crops are skipped)...");
  for (const entry of slotsToRun) {
    await ocrCropCached(entry.image, cropOcrCache);
  }
  console.log("Crop OCR complete.\n");

  const results = [];
  for (const entry of slotsToRun) {
    const { label, hint } = askedAs(entry);
    console.log(`Locating "${entry.slot}" (asked as "${label}")...`);
    const cachedAsk = makeCachedAsk(entry.slot, modelCache);

    let result = null;
    let error = null;

    if (entry.wholeDocument) {
      // These four slots are whole-PAGE captures, not localization targets.
      // The sample docx crops for BA Permintaan, Email and both SP pages each
      // cover essentially their entire source page, because a human filling
      // this form screenshots the page -- they do not hunt for a region within
      // it. Asking the model to "find the whole page inside this page" is a
      // category error, and it is precisely how these four failed: it returned
      // a sensible-looking fragment every time.
      //
      // The template config already encodes this distinction, as
      // `layout: "images"` sections versus `layout: "table"` sections, so the
      // product can route on it without new metadata.
      //
      // No model call is made here at all: the proposal is the whole page.
      const pageEntry = pages[entry.acceptedPages[0]];
      const lastLine = pageEntry.lines.length - 1;
      console.log("    [whole-document] captured the full page, no model call");
      result = {
        zone: {
          pageIndex: pageEntry.index,
          box: { x: 0, y: 0, w: pageEntry.width, h: pageEntry.height },
          lineRange: [0, lastLine],
        },
        text: pageEntry.lines.map((l) => l.text).join("\n"),
        confidence: "high",
      };
    } else {
      try {
        result = await locateSlot(label, hint, pages, cachedAsk);
      } catch (err) {
        error = err;
      }
    }

    const verdict = error
      ? { pass: false, detail: `locateSlot threw: ${error.message}` }
      : evaluate(entry, result, pages, cropOcrCache);

    results.push({ entry, result, verdict });

    const want = entry.acceptedPages.join(" or ");
    const rangeStr = result ? `page ${result.zone.pageIndex}, lines [${result.zone.lineRange.join(",")}]` : "no proposal";
    console.log(`  -> ${verdict.pass ? "PASS" : "FAIL"}  ${rangeStr}  (expected page ${want})`);
    if (result) {
      const chosen = pages[result.zone.pageIndex];
      if (chosen) console.log(`     that is ${chosen.doc} page ${chosen.pageInDoc}`);
    }
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
    const want = entry.acceptedPages.join("/");
    const pageStr = result ? `${result.zone.pageIndex} (want ${want})` : `- (want ${want})`;
    const lineStr = result ? result.zone.lineRange.join(",") : "-";
    console.log(
      `${entry.slot.padEnd(20)} ${(verdict.pass ? "PASS" : "FAIL").padEnd(6)} ${pageStr.padEnd(16)} ${lineStr.padEnd(12)} ${verdict.pass ? "" : verdict.detail}`,
    );
  }
  console.log("-".repeat(78));
  console.log(`TOTAL: ${passCount} / ${results.length} passed`);
  console.log();

  // Report the model-dependent number on its own. Four slots are deterministic
  // whole-page captures that make no model call, so folding them into one
  // headline figure would flatter the localization design by counting work the
  // model never did. The field-slot line is the one that actually tests the
  // "OCR anchors + line addressing" bet.
  const field = results.filter((r) => !r.entry.wholeDocument);
  const whole = results.filter((r) => r.entry.wholeDocument);
  const fieldPass = field.filter((r) => r.verdict.pass).length;
  const wholePass = whole.filter((r) => r.verdict.pass).length;
  console.log(
    `  field slots (model-located):    ${fieldPass} / ${field.length}` +
      "   <- this is the number that tests the design",
  );
  console.log(
    `  whole-document slots (no model): ${wholePass} / ${whole.length}` +
      "   <- deterministic full-page capture",
  );
  console.log();

  const pageOkCount = results.filter((r) => r.verdict.pageOk).length;
  console.log(
    `Page selection alone: ${pageOkCount} / ${results.length} landed on the expected page.`,
  );
  console.log();

  // Crop extent, reported and not scored -- see the note in `evaluate`. The
  // required range is printed for PASSING slots too, which the summary above
  // never showed: without it there is no way to see how much slack a passing
  // slot has, so a prompt change that quietly walks a slot to the edge of
  // containment looks identical to one that leaves it comfortable.
  console.log("Crop extent (reported, not scored -- see evaluate()):");
  console.log(
    `${"Slot".padEnd(20)} ${"Chosen".padEnd(10)} ${"Human".padEnd(10)} ` +
      `${"Height".padEnd(9)} ${"Human".padEnd(9)} ${"Inflation".padEnd(14)} HumanGap`,
  );
  let worstHumanGap = 0;
  for (const { entry, verdict } of results) {
    if (verdict.requiredHeightPx === undefined) {
      console.log(`${entry.slot.padEnd(20)} (no extent: ${verdict.detail})`);
      continue;
    }
    const ratio = verdict.chosenHeightPx / verdict.requiredHeightPx;
    const gap = verdict.humanGapRatio;
    if (gap !== null && gap > worstHumanGap) worstHumanGap = gap;
    console.log(
      `${entry.slot.padEnd(20)} ` +
        `${verdict.lineRange.join(",").padEnd(10)} ` +
        `${verdict.requiredLineRange.join(",").padEnd(10)} ` +
        `${(inches(verdict.chosenHeightPx).toFixed(2) + "in").padEnd(9)} ` +
        `${(inches(verdict.requiredHeightPx).toFixed(2) + "in").padEnd(9)} ` +
        `${(ratio.toFixed(2) + "x" + (ratio >= 2 ? "  <- inflated" : "")).padEnd(14)} ` +
        `${gap === null ? "-" : gap.toFixed(1) + "x"}`,
    );
  }
  console.log();
  // The safety margin behind FOOTER_GAP_MULTIPLE, printed rather than
  // asserted. HumanGap is the largest gap inside a human-authored crop, in
  // units of that crop's own line pitch -- content spacing the trim must never
  // cut. The constant has to sit above every value in that column; how far
  // above is the margin, and if a future bundle pushes this number up to the
  // constant, the trim is no longer safe and this line is where that shows up.
  console.log(
    `Largest gap inside any human crop: ${worstHumanGap.toFixed(1)}x its own line pitch. ` +
      `FOOTER_GAP_MULTIPLE is ${FOOTER_GAP_MULTIPLE}x.`,
  );
  console.log(
    worstHumanGap >= FOOTER_GAP_MULTIPLE
      ? "  WARNING: a human crop contains a gap at or above the trim threshold -- " +
          "trimRunningFooter can now cut real evidence."
      : `  Margin: the trim fires no earlier than ${(FOOTER_GAP_MULTIPLE / (worstHumanGap || 1)).toFixed(1)}x ` +
          "beyond the widest legitimate in-crop gap measured.",
  );
  console.log();

  // The other half of the trim's safety, and a different question from the one
  // above: not "does it fire too early" but "how much does it delete when it
  // does". See MAX_FOOTER_LINES in locate.ts. Every page of the bundle is
  // measured, not just the ones a slot landed on, because a footer's size is a
  // property of the page rather than of this run's answers.
  let worstTail = 0;
  const tails = [];
  for (const p of pages) {
    const tail = footerTailLines(p.lines);
    if (tail === 0) continue;
    tails.push(`${p.doc} p${p.pageInDoc}: ${tail}`);
    if (tail > worstTail) worstTail = tail;
  }
  console.log(
    `Running footers, measured page by page: ${tails.length} of ${pages.length} pages have a ` +
      `gap at or above ${FOOTER_GAP_MULTIPLE}x, with ${worstTail} line(s) below it at the widest ` +
      `(${tails.join(", ") || "none"}). MAX_FOOTER_LINES is ${MAX_FOOTER_LINES}.`,
  );
  console.log(
    worstTail > MAX_FOOTER_LINES
      ? "  WARNING: a real footer here is longer than the trim is allowed to delete -- " +
          "trimRunningFooter now declines on that page and its crops run to the page bottom."
      : `  Margin: the cap allows ${MAX_FOOTER_LINES - worstTail} line(s) more than the longest ` +
          "footer this bundle demonstrates.",
  );
  console.log();
  if (!only) {
    console.log(
      "Note: this scores 12 individually-locatable crops, not the 11 the brief and\n" +
        "the design doc name -- see the file header comment and the task-7 report for\n" +
        "why (SP and ToP each contribute two crops on two different pages).",
    );
  }

  // 11, not 9. Nine was the number the flat "+2 extra lines" rule produced;
  // under containment with a proportional cap, on the whole-bundle pool and
  // with production labels and hints, this bundle measures 11/12, and the one
  // miss (`KB / ToP (2)`, the remittance-account block, whose human crop
  // starts at the page letterhead) is a known, recorded miss rather than
  // headroom. Leaving the bar at 9 would let two slots regress silently.
  const PASS_THRESHOLD = 11;
  process.exitCode = only || passCount >= PASS_THRESHOLD ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
