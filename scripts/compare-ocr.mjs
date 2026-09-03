/**
 * Diff the per-page OCR tables out of two `pnpm measure:locate` transcripts.
 *
 * ## Why this exists rather than reading the two tables side by side
 *
 * Choosing the model that reads the scans is the largest cost decision in this
 * pipeline and the one with the least tolerance for being wrong: OCR is
 * upstream of every crop a human validator signs. The obvious way to judge a
 * candidate is the gate's headline score, and THE HEADLINE SCORE CANNOT DO IT.
 * Measured on this bundle, three runs of an identical prompt scored 11/12,
 * 9/12 and 11/12, with two slots flipping on their own. A one-slot difference
 * between two models is inside that, so the gate's total can neither convict
 * nor acquit a candidate on one run.
 *
 * The per-page OCR table can. `lines`, `chars`, `cover` and `collapsed` are
 * properties of one page's transcription rather than of a judgement call, and
 * across 29 pages they give 29 paired observations instead of one twelfth-scale
 * verdict. That is a real measurement, and comparing 29 rows by eye across two
 * terminal scrollbacks is how a systematic 5% regression gets called "looks
 * about the same".
 *
 * ## What it does NOT tell you
 *
 * Equivalent geometry is not equivalent READING. Two models can box the same
 * 29 pages identically and disagree about what a digit says, and this script
 * would call them identical -- character COUNTS are compared, never the
 * characters. That failure is precisely what `src/lib/pipeline/verify.ts`
 * exists for and what the gate's own crop-text comparison scores, so the
 * honest reading of a clean diff here is "the candidate found the same text in
 * the same places", never "the candidate is as accurate".
 *
 * Usage:
 *   node scripts/compare-ocr.mjs <baseline.txt> <candidate.txt>
 */

import { readFile } from "node:fs/promises";

/**
 * Pull the per-page rows out of a transcript.
 *
 * Parsed off the printed table rather than from a machine-readable artifact,
 * because the transcript is what actually exists: the harness prints and does
 * not persist. That makes this parser tied to a log format, so it FAILS LOUDLY
 * on finding no rows rather than reporting a clean diff of two empty sets,
 * which is the one way a tool like this could mislead.
 *
 * The row shape it matches (from measure-locate.mjs's summary):
 *   merged p0      48    2206   0.968   1.016   1.3%     52          0    0.925      39
 *   page          lines   chars   cover     ink  uncov   medH  collapsed  density  interp
 */
function parseOcrTable(text) {
  const rows = new Map();
  const re =
    /^\s{2}(\S+\s+p\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)%\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s*$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    rows.set(m[1], {
      page: m[1],
      lines: Number(m[2]),
      chars: Number(m[3]),
      cover: Number(m[4]),
      ink: Number(m[5]),
      uncovered: Number(m[6]),
      medH: Number(m[7]),
      collapsed: Number(m[8]),
      density: Number(m[9]),
      interpolated: Number(m[10]),
    });
  }
  return rows;
}

/** The run's identity, so a diff cannot silently compare a file to itself. */
function parseIdentity(text) {
  const model = /^Model:\s*(\S+)/m.exec(text)?.[1];
  const ocrModel = /^OCR model:\s*(\S+)/m.exec(text)?.[1];
  const engine = /OCR engine:\s*([^)\n]+)/.exec(text)?.[1]?.trim();
  const total = /^TOTAL:\s*(\d+)\s*\/\s*(\d+)/m.exec(text);
  const fieldSlots = /field slots \(model-located\):\s*(\d+)\s*\/\s*(\d+)/.exec(text);
  const shortReads = /Completeness assertion:\s*(\d+) short read/.exec(text)?.[1];
  return {
    model: model ?? "(unknown)",
    // Unset means OCR ran on the reasoning model, which is the default.
    ocrModel: ocrModel ?? model ?? "(unknown)",
    engine: engine ?? "(unknown)",
    total: total ? `${total[1]}/${total[2]}` : "(unknown)",
    fieldSlots: fieldSlots ? `${fieldSlots[1]}/${fieldSlots[2]}` : "(unknown)",
    shortReads: shortReads ?? "(unknown)",
  };
}

function mean(xs) {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * A signed relative change, as a percentage, guarding the zero denominator.
 *
 * Returns null rather than 0 or Infinity when the baseline is zero: "collapsed
 * blocks went from 0 to 3" is a real and important change that no percentage
 * describes, and printing `+Inf%` or `+0%` would either alarm or hide.
 */
function relative(base, candidate) {
  if (base === 0) return candidate === 0 ? 0 : null;
  return ((candidate - base) / base) * 100;
}

function pad(s, n) {
  return String(s).padEnd(n);
}
function padStart(s, n) {
  return String(s).padStart(n);
}

function signed(n, digits = 1) {
  if (n === null) return "n/a";
  const s = n.toFixed(digits);
  return n > 0 ? `+${s}` : s;
}

async function main() {
  const [basePath, candPath] = process.argv.slice(2);
  if (!basePath || !candPath) {
    console.error(
      "Usage: node scripts/compare-ocr.mjs <baseline.txt> <candidate.txt>\n\n" +
        "Both files are `pnpm measure:locate` transcripts. Capture them with\n" +
        "  OCR_ENGINE=gemini node scripts/measure-locate.mjs > baseline.txt\n" +
        "  OCR_ENGINE=gemini OCR_MODEL_ID=<candidate> node scripts/measure-locate.mjs > candidate.txt",
    );
    process.exit(2);
  }

  const [baseText, candText] = await Promise.all([
    readFile(basePath, "utf8"),
    readFile(candPath, "utf8"),
  ]);

  const base = parseOcrTable(baseText);
  const cand = parseOcrTable(candText);
  const baseId = parseIdentity(baseText);
  const candId = parseIdentity(candText);

  // FAIL LOUDLY ON AN EMPTY PARSE. A silent "0 pages differ" is exactly the
  // wrong-and-quiet answer: it looks like a perfect result.
  if (base.size === 0 || cand.size === 0) {
    console.error(
      `Could not find a per-page OCR table in ` +
        `${base.size === 0 ? basePath : candPath}. This parser reads the table ` +
        `printed under "Per-page OCR, every page of the bundle:", so either the ` +
        `run did not get that far or the log format changed.`,
    );
    process.exit(1);
  }

  console.log("OCR comparison");
  console.log("=".repeat(78));
  console.log(`  baseline : ${basePath}`);
  console.log(
    `             OCR ${baseId.ocrModel}, reasoning ${baseId.model}, ` +
      `gate ${baseId.total} (fields ${baseId.fieldSlots}), ` +
      `${baseId.shortReads} short read(s)`,
  );
  console.log(`  candidate: ${candPath}`);
  console.log(
    `             OCR ${candId.ocrModel}, reasoning ${candId.model}, ` +
      `gate ${candId.total} (fields ${candId.fieldSlots}), ` +
      `${candId.shortReads} short read(s)`,
  );
  if (baseId.ocrModel === candId.ocrModel) {
    console.log(
      `\n  NOTE: both transcripts name the same OCR model (${baseId.ocrModel}). ` +
        "Any difference below is run-to-run variation in the same model, which " +
        "is useful as a noise floor and is not a comparison.",
    );
  }
  console.log();

  const pages = [...base.keys()].filter((p) => cand.has(p));
  const onlyBase = [...base.keys()].filter((p) => !cand.has(p));
  const onlyCand = [...cand.keys()].filter((p) => !base.has(p));

  if (onlyBase.length || onlyCand.length) {
    console.log(
      `  WARNING: page sets differ. Only in baseline: ` +
        `${onlyBase.join(", ") || "none"}. Only in candidate: ` +
        `${onlyCand.join(", ") || "none"}.\n`,
    );
  }

  // Per-page rows, but only the ones that actually moved. A 29-row table of
  // "identical" is noise that hides the three rows that matter.
  const MOVED_LINES = 2;
  const MOVED_CHARS_PCT = 5;
  const moved = [];
  for (const page of pages) {
    const b = base.get(page);
    const c = cand.get(page);
    const dLines = c.lines - b.lines;
    const dCharsPct = relative(b.chars, c.chars);
    const dCollapsed = c.collapsed - b.collapsed;
    if (
      Math.abs(dLines) >= MOVED_LINES ||
      (dCharsPct !== null && Math.abs(dCharsPct) >= MOVED_CHARS_PCT) ||
      dCollapsed !== 0
    ) {
      moved.push({ page, b, c, dLines, dCharsPct, dCollapsed });
    }
  }

  console.log(
    `  Pages whose reading moved (>=${MOVED_LINES} lines, >=${MOVED_CHARS_PCT}% chars, ` +
      `or any change in collapsed blocks): ${moved.length} of ${pages.length}`,
  );
  if (moved.length > 0) {
    console.log(
      "    " +
        pad("page", 13) +
        padStart("lines", 14) +
        padStart("chars", 18) +
        padStart("collapsed", 14) +
        padStart("cover", 16),
    );
    for (const r of moved) {
      console.log(
        "    " +
          pad(r.page, 13) +
          padStart(`${r.b.lines}->${r.c.lines} (${signed(r.dLines, 0)})`, 14) +
          padStart(
            `${r.b.chars}->${r.c.chars} (${signed(r.dCharsPct)}%)`,
            18,
          ) +
          padStart(
            `${r.b.collapsed}->${r.c.collapsed} (${signed(r.dCollapsed, 0)})`,
            14,
          ) +
          padStart(`${r.b.cover.toFixed(3)}->${r.c.cover.toFixed(3)}`, 16),
      );
    }
  }
  console.log();

  // The aggregate, which is what actually decides the question. A handful of
  // pages moving in both directions is normal; the same pages all moving the
  // same way is a systematic regression.
  const metrics = [
    ["lines", (r) => r.lines],
    ["chars", (r) => r.chars],
    ["cover", (r) => r.cover],
    ["ink", (r) => r.ink],
    ["uncovered %", (r) => r.uncovered],
    ["collapsed", (r) => r.collapsed],
    ["interpolated", (r) => r.interpolated],
  ];

  console.log("  Aggregate over the paired pages:");
  console.log(
    "    " +
      pad("metric", 14) +
      padStart("baseline", 11) +
      padStart("candidate", 11) +
      padStart("delta", 11) +
      padStart("rel", 9),
  );
  for (const [name, get] of metrics) {
    const b = mean(pages.map((p) => get(base.get(p))));
    const c = mean(pages.map((p) => get(cand.get(p))));
    const rel = relative(b, c);
    console.log(
      "    " +
        pad(name, 14) +
        padStart(b.toFixed(3), 11) +
        padStart(c.toFixed(3), 11) +
        padStart(signed(c - b, 3), 11) +
        padStart(rel === null ? "n/a" : `${signed(rel)}%`, 9),
    );
  }
  console.log();

  // A verdict, stated as what the evidence supports and no more. The
  // thresholds are deliberately modest: this is a screen for a systematic
  // shift, and anything it passes still has to survive the gate and verify.
  const totalBaseLines = pages.reduce((a, p) => a + base.get(p).lines, 0);
  const totalCandLines = pages.reduce((a, p) => a + cand.get(p).lines, 0);
  const totalBaseChars = pages.reduce((a, p) => a + base.get(p).chars, 0);
  const totalCandChars = pages.reduce((a, p) => a + cand.get(p).chars, 0);
  const linesRel = relative(totalBaseLines, totalCandLines);
  const charsRel = relative(totalBaseChars, totalCandChars);
  const collapsedBase = pages.reduce((a, p) => a + base.get(p).collapsed, 0);
  const collapsedCand = pages.reduce((a, p) => a + cand.get(p).collapsed, 0);

  console.log(
    `  Totals: ${totalBaseLines} -> ${totalCandLines} lines (${signed(linesRel)}%), ` +
      `${totalBaseChars} -> ${totalCandChars} chars (${signed(charsRel)}%), ` +
      `${collapsedBase} -> ${collapsedCand} collapsed blocks`,
  );

  const concerns = [];
  if (charsRel !== null && charsRel < -3) {
    concerns.push(
      `the candidate transcribed ${Math.abs(charsRel).toFixed(1)}% FEWER characters, ` +
        "which is what reading less of each page looks like",
    );
  }
  if (linesRel !== null && linesRel < -5) {
    concerns.push(
      `the candidate produced ${Math.abs(linesRel).toFixed(1)}% fewer lines`,
    );
  }
  if (collapsedCand > collapsedBase * 1.5 && collapsedCand - collapsedBase >= 3) {
    concerns.push(
      `collapsed blocks rose ${collapsedBase} -> ${collapsedCand}; a collapsed block ` +
        "is a paragraph read down to its first line, so the geometry is coarser",
    );
  }
  if (candId.shortReads !== "(unknown)" && Number(candId.shortReads) > 0) {
    concerns.push(
      `the candidate had ${candId.shortReads} short read(s), where the baseline ` +
        `had ${baseId.shortReads}`,
    );
  }

  console.log();
  if (concerns.length === 0) {
    console.log(
      "  VERDICT: no systematic degradation in what was found or where.\n" +
        "  This is a screen, not a proof of accuracy: character COUNTS are compared,\n" +
        "  never the characters, so a candidate that reads the same amount of text\n" +
        "  incorrectly passes this. The gate's crop comparison and verify.ts are\n" +
        "  what test the reading itself.",
    );
  } else {
    console.log("  VERDICT: concerns found.");
    for (const c of concerns) console.log(`    - ${c}`);
  }
}

await main();
