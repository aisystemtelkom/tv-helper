/**
 * The end-to-end generator: scanned PDFs in, a DOKUMEN VALIDASI docx and an
 * EPIC order-config xlsx out. This is the whole pipeline in one command --
 * render, OCR, classify, locate, crop, extract, export -- with no UI and no
 * browser involved.
 *
 *   pnpm generate documents/<bundle>.pdf documents/<splitba>.pdf [--out dir]
 *
 * Everything it knows about the target document comes from
 * `src/lib/forms/template.ts`. This file is wiring, not policy.
 *
 * Two things here are load-bearing and easy to "simplify" back into bugs:
 *
 * 1. IT ROUTES ON `section.layout`. A `layout: "images"` section is a
 *    WHOLE-PAGE capture -- a human filling the sample screenshots the entire
 *    page -- so the page is taken directly and NO model call is made. Asking
 *    the model to find a whole page inside that page is a category error, and
 *    it is exactly how those slots failed the Task 7 measurement gate: it
 *    returned a plausible-looking fragment every time. Routing them around
 *    the model took the gate from 6/12 to 9/12. Only `layout: "table"` slots
 *    go through `locateSlot`.
 *
 * 2. IT REACHES THE MODEL ONLY THROUGH `src/lib/model.ts`. `ask` below is an
 *    adapter over `chatModel()` and the vendor-neutral `ai` package, sending
 *    the same `providerOptions` and output cap `/api/chat` sends, and logging
 *    the same `in= out= (thoughts=) total=` line so cost shows up in this log
 *    rather than on an invoice a month later. No provider SDK is imported
 *    here, and none should be.
 *
 * OCR results are cached in the system temp directory, keyed by the source
 * file's content hash plus page and DPI, because OCR-ing 29 300-DPI scans
 * takes minutes and is a pure function of the pixels. Model replies are
 * deliberately NOT cached: unlike OCR they are not a pure function of their
 * input, and a stale verdict served silently is worse than paying again.
 * Set GENERATE_FORCE=1 to bypass the OCR cache.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";

// First, and deliberately: importing this loads .env.local into process.env,
// and src/lib/model.ts reads MODEL_ID and the cost settings at import time.
// ESM evaluates static imports in declaration order, so this one must stay
// above the model import for `pnpm generate` to see the same settings the app
// sees. A plain node script gets none of Next's env loading for free.
import { repoRoot } from "./env.mjs";

import { generateText } from "ai";

import { AO_TEMPLATE } from "../src/lib/forms/template.ts";
import {
  MAX_OUTPUT_TOKENS,
  MODEL_ID,
  MODEL_TARGET,
  chatModel,
  providerOptions,
} from "../src/lib/model.ts";
import { classifyPages } from "../src/lib/pipeline/classify.ts";
import {
  deriveIdsFromFilenames,
  extractFields,
} from "../src/lib/pipeline/fields.ts";
import { locateSlot } from "../src/lib/pipeline/locate.ts";
import { ocrToLines } from "../src/lib/pipeline/ocr.ts";
import { DEFAULT_DPI, renderPageUpright } from "../src/lib/pipeline/render.ts";
import { cropToPng } from "../src/lib/export/crop.ts";
import { buildDocx } from "../src/lib/export/docx.ts";
import { buildXlsx } from "../src/lib/export/xlsx.ts";

// pdf.js ships an ESM legacy build for Node; the same entry point every other
// script and test in this repo uses.
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

const TESSERACT_ASSETS = join(repoRoot, "public", "tesseract");
const OCR_CACHE_PATH = join(tmpdir(), "tv-helper-generate-ocr-cache.json");
const FORCE_FRESH = process.env.GENERATE_FORCE === "1";

/** @napi-rs/canvas is the Node side of render.ts's injected CanvasFactory. */
const nodeContext = (w, h) => createCanvas(w, h).getContext("2d");

// ---------------------------------------------------------------------------
// The model, reached only through src/lib/model.ts.
// ---------------------------------------------------------------------------

const cost = { calls: 0, in: 0, out: 0, thoughts: 0, total: 0 };

/**
 * A ceiling on one call, not a budget. A locate prompt carries every page of
 * one document type as OCR text -- 17k input tokens for this bundle's KB --
 * and legitimately takes tens of seconds, but `generateText` has no timeout of
 * its own, so without this a stalled connection hangs the run silently. `ask`
 * counts an abort as transient, so a stall costs a retry rather than the run.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.GENERATE_TIMEOUT_MS ?? 180_000);

async function askOnce(prompt) {
  const { text, usage, finishReason } = await generateText({
    model: chatModel(),
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    providerOptions,
    abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    // Retries are handled by the loop below instead, so a 503 storm is one
    // visible backoff sequence in this log rather than two nested ones.
    maxRetries: 0,
  });

  const thoughts = usage.outputTokenDetails?.reasoningTokens ?? 0;
  cost.calls += 1;
  cost.in += usage.inputTokens ?? 0;
  cost.out += usage.outputTokens ?? 0;
  cost.thoughts += thoughts;
  cost.total += usage.totalTokens ?? 0;

  // Same line /api/chat logs, for the same reason: every request costs money
  // and thought tokens bill at the output rate.
  console.log(
    `    [generate] ${MODEL_ID} in=${usage.inputTokens ?? "?"} ` +
      `out=${usage.outputTokens ?? "?"} (thoughts=${thoughts}) ` +
      `total=${usage.totalTokens ?? "?"} finish=${finishReason}`,
  );

  if (finishReason === "length") {
    console.warn(
      `    [generate] hit the ${MAX_OUTPUT_TOKENS}-token output cap; the reply is ` +
        "truncated. Raise GEMINI_MAX_OUTPUT_TOKENS if this is legitimate.",
    );
  }
  if (!text.trim()) {
    throw new Error(
      `${MODEL_TARGET} returned no text (finishReason=${finishReason}). An empty ` +
        "reply with an uncapped thinking budget usually means thinking spent the " +
        "whole output allowance; GEMINI_THINKING_LEVEL is the knob.",
    );
  }
  return text;
}

/**
 * Reads the SDK's own structured verdict instead of matching the message text.
 *
 * This is not a style preference. The first version of this function tested
 * `String(error)` for `503|429|unavailable|...`, and a real Gemini 503 got
 * past it and killed a run that had already spent 100k tokens: the message is
 * "This model is currently experiencing high demand. Spikes in demand are
 * usually temporary." -- no status code and no "unavailable" anywhere in
 * `String(error)`, because the code and the status live on the error object
 * (`statusCode: 503`, `isRetryable: true`) and in `responseBody`, neither of
 * which `toString()` includes. Measured on the real bundle, not imagined.
 *
 * `AbortSignal.timeout` rejects with a DOMException carrying no status at all,
 * so that case is matched by name.
 */
function isTransient(error) {
  for (const err of [error, error?.cause]) {
    if (!err) continue;
    if (err.isRetryable === true) return true;
    const status = err.statusCode;
    if (typeof status === "number") {
      if (status === 408 || status === 409 || status === 429 || status >= 500) {
        return true;
      }
    }
    if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  }
  return false;
}

/**
 * Six attempts with a long backoff, not the SDK's default two. AGENTS.md
 * records intermittent 503s from Gemini, and Task 7's measurement run lost
 * three slots outright to them -- scoring an availability blip as a pipeline
 * failure is the one wrong answer this script must not give. The backoff is
 * longer than a chat request would justify because a full run is minutes of
 * OCR and six figures of tokens: waiting a minute beats redoing all of it.
 */
async function ask(prompt) {
  const attempts = 6;
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await askOnce(prompt);
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || i === attempts - 1) throw err;
      const backoffMs = Math.min(5000 * 2 ** i, 60_000);
      console.log(
        `    [generate] transient error (${err.statusCode ?? err.name}), ` +
          `retrying in ${backoffMs}ms: ${err.message}`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Arguments.
// ---------------------------------------------------------------------------

const USAGE = `Usage: pnpm generate <bundle.pdf> [more.pdf ...] [--out <dir>]

Writes <ID EPIC>_DOKUMEN_VALIDASI.docx and <ID EPIC>_ORDER_Config.xlsx into
<dir> (default: out/, which is gitignored).`;

function parseArgs(argv) {
  const pdfs = [];
  let outDir = join(repoRoot, "out");

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") {
      const value = argv[++i];
      if (!value) throw new Error("--out needs a directory");
      outDir = resolve(value);
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      pdfs.push(resolve(arg));
    }
  }

  if (pdfs.length === 0) throw new Error("no PDF given");
  for (const p of pdfs) {
    if (!existsSync(p)) throw new Error(`no such file: ${p}`);
  }
  return { pdfs, outDir };
}

// ---------------------------------------------------------------------------
// OCR cache. Keyed by the file's own content hash, not its path or mtime, so
// the same bundle under a different name reuses the same work and an edited
// file never serves a stale page.
// ---------------------------------------------------------------------------

async function loadCache() {
  if (!existsSync(OCR_CACHE_PATH)) return {};
  try {
    return JSON.parse(await readFile(OCR_CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function saveCache(cache) {
  await writeFile(OCR_CACHE_PATH, JSON.stringify(cache), "utf8");
}

// ---------------------------------------------------------------------------
// Pass 1: render every page and OCR it, keeping only the text geometry.
//
// The pixels are dropped on purpose. A 300 DPI A4 scan is ~35MB of RGBA, so
// holding 29 of them would cost a gigabyte to serve the dozen crops that
// actually get cut. Pass 2 re-renders only the pages a slot landed on.
// ---------------------------------------------------------------------------

async function ocrEveryPage(sources, cache) {
  /** @type {{ source: number, pageInDoc: number, index: number, width: number, height: number, lines: unknown[] }[]} */
  const pages = [];

  for (const [sourceIndex, source] of sources.entries()) {
    for (let pageInDoc = 0; pageInDoc < source.doc.numPages; pageInDoc++) {
      const key = `${source.hash}:${DEFAULT_DPI}:${pageInDoc}`;
      let entry = FORCE_FRESH ? undefined : cache[key];

      if (entry) {
        console.log(
          `  ${source.name} page ${pageInDoc}: cached OCR, ${entry.lines.length} lines`,
        );
      } else {
        const started = Date.now();
        const page = await source.doc.getPage(pageInDoc + 1); // pdf.js is 1-based
        const rendered = await renderPageUpright(page, DEFAULT_DPI, nodeContext);
        const lines = await ocrToLines(rendered, "ind", {
          langPath: TESSERACT_ASSETS,
          gzip: true,
          // Without this tesseract.js decompresses the vendored .traineddata.gz
          // into process.cwd() and leaves it there.
          cacheMethod: "none",
        });
        entry = { width: rendered.width, height: rendered.height, lines };
        cache[key] = entry;
        await saveCache(cache);
        console.log(
          `  ${source.name} page ${pageInDoc}: ${rendered.width}x${rendered.height}, ` +
            `${lines.length} lines, ${((Date.now() - started) / 1000).toFixed(1)}s`,
        );
      }

      pages.push({
        source: sourceIndex,
        pageInDoc,
        index: pages.length, // the global page number every zone refers to
        width: entry.width,
        height: entry.height,
        lines: entry.lines,
      });
    }
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Classification, one call per source document.
//
// Per document rather than one call over the concatenation, because a span is
// a run of pages within ONE file: a span crossing a file boundary is never a
// legitimate answer, and classifyPages' own "every page covered exactly once"
// check is more useful when it is scoped to a document a person can open.
// ---------------------------------------------------------------------------

/** How much of a page classify sees. Headings live at the top; it slices to 400. */
const HEAD_LINES = 12;

async function classifyEverything(sources, pages) {
  /** @type {Map<string, number[]>} docType -> global page indexes, in order */
  const byType = new Map();

  for (const [sourceIndex, source] of sources.entries()) {
    const own = pages.filter((p) => p.source === sourceIndex);
    const heads = own.map((p, position) => ({
      index: position,
      head: p.lines
        .slice(0, HEAD_LINES)
        .map((l) => l.text)
        .join(" "),
    }));

    console.log(`  classifying ${source.name} (${own.length} pages)...`);
    const spans = await classifyPages(heads, ask);

    for (const span of spans) {
      const list = byType.get(span.docType) ?? [];
      for (let p = span.fromPage; p <= span.toPage; p++) {
        list.push(own[p].index);
      }
      byType.set(span.docType, list);
      console.log(
        `    ${source.name} pages ${span.fromPage}-${span.toPage} -> ${span.docType}`,
      );
    }
  }

  for (const list of byType.values()) list.sort((a, b) => a - b);
  return byType;
}

// ---------------------------------------------------------------------------
// Planning: one zone per crop the docx needs.
// ---------------------------------------------------------------------------

function poolFor(byType, pages, docType) {
  return (byType.get(docType) ?? []).map((index) => pages[index]);
}

async function planZones(template, byType, pages) {
  /** @type {{ key: string, pageIndex: number, box: object, lineRange: number[] }[]} */
  const zones = [];
  const unfilled = [];

  for (const section of template.sections) {
    const fillable = section.slots.filter((s) => s.fillable && s.docType);

    if (section.layout === "images") {
      // Whole-page captures. No model call is made here at all -- see this
      // file's header comment for why that is the design and not a shortcut.
      // Consecutive slots in one section take consecutive pages of that
      // document, which is what "SP" and "SP (lanjutan)" mean.
      const taken = new Map();
      for (const slot of fillable) {
        const pool = poolFor(byType, pages, slot.docType);
        const position = taken.get(slot.docType) ?? 0;
        taken.set(slot.docType, position + 1);
        const page = pool[position];

        if (!page) {
          unfilled.push(
            `${slot.key}: no ${slot.docType} page ${position} was classified`,
          );
          continue;
        }
        console.log(
          `  ${slot.key}: whole page ${page.index} ` +
            `(${sourceLabel(page)}), no model call`,
        );
        zones.push({
          key: slot.key,
          pageIndex: page.index,
          box: { x: 0, y: 0, w: page.width, h: page.height },
          lineRange: [0, Math.max(0, page.lines.length - 1)],
        });
      }
      continue;
    }

    for (const slot of fillable) {
      const pool = poolFor(byType, pages, slot.docType);
      if (pool.length === 0) {
        unfilled.push(`${slot.key}: no ${slot.docType} page was classified`);
        continue;
      }

      console.log(`  ${slot.key}: locating in ${pool.length} ${slot.docType} pages...`);

      // One slot's failure costs that slot, not the run. By this point the
      // pass has spent minutes of OCR and tens of thousands of tokens on the
      // slots that already succeeded, and the deliverable is a document the
      // operator finishes by hand anyway -- throwing away nine good crops
      // because the tenth call exhausted its retries is the wrong trade. The
      // slot is named in the summary instead.
      let found;
      try {
        found = await locateSlot(slot.label, slot.hint, pool, ask);
      } catch (error) {
        console.warn(`  ${slot.key}: FAILED -- ${error.message}`);
        unfilled.push(`${slot.key}: ${error.message}`);
        continue;
      }

      if (!found) {
        unfilled.push(`${slot.key}: the model found no match`);
        continue;
      }

      const [from, to] = found.zone.lineRange;
      console.log(
        `  ${slot.key}: page ${found.zone.pageIndex} lines ${from}-${to} ` +
          `(${found.confidence} confidence)`,
      );
      zones.push({
        key: slot.key,
        pageIndex: found.zone.pageIndex,
        box: found.zone.box,
        lineRange: found.zone.lineRange,
      });

      // A slot may declare more crops than one located zone can supply -- the
      // sample's ToP row stacks two pictures cut from two different pages, and
      // this headless pass has one hint and makes one call per slot. Say so
      // rather than shipping a document that silently looks complete.
      if ((slot.crops ?? 1) > 1) {
        unfilled.push(
          `${slot.key}: the template declares ${slot.crops} crops and this pass ` +
            "produced 1; the operator adds the rest",
        );
      }
    }
  }

  return { zones, unfilled };
}

// ---------------------------------------------------------------------------
// Pass 2: cut the crops. One page is rendered at a time and dropped before the
// next, so peak memory is a single page rather than all of them.
// ---------------------------------------------------------------------------

async function cutCrops(zones, pages, sources) {
  // Written back by position, not pushed, so the result keeps template order.
  // That order is the stacking order for a slot that holds more than one crop.
  const filled = new Array(zones.length);

  const byPage = new Map();
  zones.forEach((zone, position) => {
    const list = byPage.get(zone.pageIndex) ?? [];
    list.push({ zone, position });
    byPage.set(zone.pageIndex, list);
  });

  for (const pageIndex of [...byPage.keys()].sort((a, b) => a - b)) {
    const meta = pages[pageIndex];
    const page = await sources[meta.source].doc.getPage(meta.pageInDoc + 1);
    const rendered = await renderPageUpright(page, DEFAULT_DPI, nodeContext);

    for (const { zone, position } of byPage.get(pageIndex)) {
      const widthPx = Math.round(zone.box.w);
      const heightPx = Math.round(zone.box.h);
      const png = await cropToPng(rendered, zone.box);
      filled[position] = { key: zone.key, png, widthPx, heightPx };
      console.log(
        `  ${zone.key}: page ${pageIndex}, ${widthPx}x${heightPx}px, ` +
          `${(png.length / 1024).toFixed(0)}KB`,
      );
    }
  }

  return filled;
}

// ---------------------------------------------------------------------------
// Text extraction for the xlsx and the docx header.
//
// The pages offered are the ones the `layout: "images"` sections capture --
// the order paperwork (BA Permintaan, SP, the email thread). The KB contract
// is deliberately excluded: it is a legal document whose addresses and party
// names are the bank's head office, not this order's service site, and
// offering it makes a confident wrong `alamat` more likely, not less.
//
// The pages are renumbered 0..n-1 before being handed over and mapped back
// afterwards. locate.ts documents the measured reason (a non-zero first page
// label gets treated as a 1-based ordinal); extractFields numbers its listing
// by each page's own `index`, so feeding it global indexes like 23 and 27
// walks straight into that. Positions in, true indexes out.
// ---------------------------------------------------------------------------

async function extractTextFields(template, byType, pages) {
  const keys = [
    ...new Set(
      template.xlsxRows.map((row) => row.fieldKey).filter((key) => key),
    ),
  ];

  const wanted = new Set();
  for (const section of template.sections) {
    if (section.layout !== "images") continue;
    for (const slot of section.slots) {
      if (!slot.fillable || !slot.docType) continue;
      for (const index of byType.get(slot.docType) ?? []) wanted.add(index);
    }
  }

  const pool = [...wanted].sort((a, b) => a - b).map((i) => pages[i]);
  if (pool.length === 0) {
    console.log("  no order-paperwork pages were classified; skipping extraction");
    return [];
  }

  console.log(
    `  extracting ${keys.length} fields from pages ` +
      `${pool.map((p) => p.index).join(", ")}...`,
  );

  const renumbered = pool.map((page, position) => ({ ...page, index: position }));
  const values = await extractFields(keys, renumbered, ask);

  return values.map((value) =>
    value.source
      ? {
          ...value,
          source: {
            ...value.source,
            pageIndex: pool[value.source.pageIndex]?.index ?? value.source.pageIndex,
          },
        }
      : value,
  );
}

// ---------------------------------------------------------------------------

function sourceLabel(page) {
  return `${page.sourceName} p${page.pageInDoc}`;
}

async function main() {
  const { pdfs, outDir } = parseArgs(process.argv.slice(2));

  console.log(`Model:  ${MODEL_TARGET}`);
  console.log(`OCR cache: ${OCR_CACHE_PATH}${FORCE_FRESH ? " (bypassed)" : ""}`);
  console.log();

  const sources = [];
  for (const path of pdfs) {
    const bytes = new Uint8Array(await readFile(path));
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    // pdf.js takes ownership of the buffer it is given, so hash first.
    const doc = await getDocument({ data: bytes }).promise;
    sources.push({ path, name: basename(path), hash, doc });
    console.log(`${basename(path)}: ${doc.numPages} pages`);
  }
  console.log();

  console.log("OCR (cached pages are skipped)...");
  const cache = await loadCache();
  const pages = await ocrEveryPage(sources, cache);
  for (const page of pages) page.sourceName = sources[page.source].name;
  console.log(`OCR complete: ${pages.length} pages.\n`);

  console.log("Classifying...");
  const byType = await classifyEverything(sources, pages);
  console.log();

  console.log("Planning zones...");
  const { zones, unfilled } = await planZones(AO_TEMPLATE, byType, pages);
  console.log();

  console.log("Cutting crops...");
  const filled = await cutCrops(zones, pages, sources);
  console.log();

  console.log("Extracting text fields...");
  // Same trade as a failed slot, one step later: the crops are already cut and
  // both files are written below, so a failure here costs the xlsx's values and
  // the docx's header text, not the run. It is said plainly in the summary.
  let values = [];
  try {
    values = await extractTextFields(AO_TEMPLATE, byType, pages);
  } catch (error) {
    console.warn(`  extraction FAILED -- ${error.message}`);
    unfilled.push(`every xlsx value and header field: ${error.message}`);
  }
  for (const value of values) {
    const cite = value.source
      ? ` [page ${value.source.pageIndex}, lines ${value.source.lineRange.join("-")}]`
      : " [no citation]";
    console.log(`  ${value.fieldKey} = ${JSON.stringify(value.value)}${cite}`);
  }
  console.log();

  const { idEpic, quote } = deriveIdsFromFilenames(sources.map((s) => s.name));
  const byKey = new Map(values.map((v) => [v.fieldKey, v.value]));
  const header = {
    idEpic,
    namaProyek: byKey.get("namaProyek") ?? "",
    quote,
    cc: byKey.get("cc") ?? "",
    // Blank in the sample by design, and the operator picks the template, so
    // the template's own id is the honest answer for JENIS ORDER.
    order: "",
    jenisOrder: AO_TEMPLATE.id,
  };

  await mkdir(outDir, { recursive: true });
  const stem = idEpic || basename(pdfs[0]).replace(/\.pdf$/i, "");
  const docxPath = join(outDir, `${stem}_DOKUMEN_VALIDASI.docx`);
  const xlsxPath = join(outDir, `${stem}_ORDER_Config.xlsx`);

  await writeFile(docxPath, await buildDocx(AO_TEMPLATE, header, filled));
  await writeFile(xlsxPath, await buildXlsx(AO_TEMPLATE, values));

  console.log("=".repeat(72));
  console.log(`docx: ${docxPath}`);
  console.log(`xlsx: ${xlsxPath}`);
  console.log();
  console.log("Page numbers cited above and in the xlsx comments are this run's");
  console.log("global page numbers:");
  for (const [sourceIndex, source] of sources.entries()) {
    const own = pages.filter((p) => p.source === sourceIndex);
    console.log(
      `  ${own[0].index}-${own[own.length - 1].index}: ${source.name} pages ` +
        `0-${own.length - 1}`,
    );
  }
  console.log();
  console.log(`crops: ${filled.length} cut, ${values.length} text fields extracted`);
  if (unfilled.length > 0) {
    console.log(`left for the operator (${unfilled.length}):`);
    for (const note of unfilled) console.log(`  - ${note}`);
  }
  console.log(
    `cost: ${cost.calls} model calls, in=${cost.in} out=${cost.out} ` +
      `thoughts=${cost.thoughts} total=${cost.total}`,
  );
}

/** An argument mistake deserves the usage text, not a stack trace. */
const USAGE_ERRORS = /^(no PDF given|unknown option |--out needs|no such file: )/;

main().catch((error) => {
  if (USAGE_ERRORS.test(error.message)) {
    console.error(`\n${error.message}\n\n${USAGE}`);
  } else {
    console.error(`\n${MODEL_TARGET} pipeline failed:`);
    console.error(error);
  }
  process.exitCode = 1;
});
