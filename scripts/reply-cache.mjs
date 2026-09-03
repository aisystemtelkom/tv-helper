/**
 * An on-disk cache for model replies, for the two SCRIPTS and never for the app.
 *
 * ## Read this before turning it on
 *
 * AGENTS.md says, correctly, that `pnpm generate` does not cache model replies
 * because "a model reply is not a pure function of its input, and a stale
 * verdict served silently is worse than paying again". THAT RULE IS NOT
 * REVERSED BY THIS FILE. What is added here is an explicitly-requested
 * development affordance, off unless a developer asks for it by name, and loud
 * enough on every run that a cached result cannot be mistaken for a fresh
 * measurement.
 *
 * The case for it is a measured bill. Re-running `pnpm generate` on one
 * unchanged 29-page bundle spent about $1.19 of which roughly $0.53 was
 * `locate` re-asking the same eight questions about the same unchanged pages.
 * Across a development month that was the largest single line on the invoice,
 * and every one of those calls had already been answered. The OCR cache exists
 * for exactly this reason and is content-addressed; this is the same argument
 * applied to the stage that costs more.
 *
 * ## The three defects in the existing implementation this one does not copy
 *
 * `scripts/measure-locate.mjs` has had a reply cache for a while
 * (`makeCachedAsk`). It works, and it has three problems that only bite when
 * you do what this project is now doing, which is changing the model:
 *
 *  1. ITS KEY IS THE PROMPT ALONE. Not the model id, not the thinking level,
 *     not the output cap. Under `OCR_ENGINE=tesseract`, where the OCR text and
 *     therefore the prompt are model-independent, swapping `MODEL_ID` and
 *     re-running serves the PREVIOUS model's answers while the banner names
 *     the new one. The gate would print a plausible score for a model it never
 *     called. `fingerprintFor` below puts all three in the key, so a settings
 *     change misses by construction rather than by luck.
 *  2. ITS WRITE IS NOT ATOMIC. It rewrites the whole JSON file on every entry,
 *     and its loader answers a parse failure with `catch { return {} }`. A
 *     crash or a Ctrl-C mid-write therefore truncates the file and the next run
 *     silently starts from an empty cache, which looks like nothing more than a
 *     slow day. Here the write is temp-then-rename, which is atomic on both
 *     platforms this repo runs on.
 *  3. ITS WRITES CAN RACE. One shared mutable object plus a whole-file rewrite
 *     per entry is safe only while callers are strictly sequential. Writes are
 *     serialised through a promise chain below so a parallel caller cannot
 *     interleave two rewrites and lose one.
 *
 * ## What keeps it honest
 *
 * `stats()` counts hits and misses, and the caller is expected to print them
 * next to the cost line. A run that served twelve replies from disk and made
 * one call must not be readable as a run that cost one call, because the next
 * question anybody asks of a cheap run is whether the change worked.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";

/**
 * Everything outside the prompt that changes what the model would answer.
 *
 * THE POINT OF THIS FUNCTION IS THAT IT IS NOT THE PROMPT. A cache keyed on
 * the prompt text alone is correct exactly until somebody changes a setting in
 * order to find out what it does, which is the one occasion on which they are
 * certain to be misled. Every argument here is a value that a caller can move
 * without touching a single character of any prompt.
 *
 * Deliberately a readable string rather than a hash: it lands in the cache
 * file, and being able to see `gemini-3.5-flash/low/2048` while grepping a
 * stale cache is worth more than the bytes it costs.
 */
export function fingerprintFor({ modelId, thinkingLevel, maxOutputTokens }) {
  return [modelId ?? "?", thinkingLevel ?? "?", maxOutputTokens ?? "?"].join("/");
}

async function loadCache(path) {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    // A JSON file that parses to a non-object would otherwise be indexed
    // happily and behave as an empty cache with a confusing shape.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // A truncated or hand-edited file is a cold cache, not a crash. The
    // difference from the implementation this replaces is that a truncated
    // file cannot be PRODUCED here; see the atomic write below.
    return {};
  }
}

/**
 * Temp-then-rename, so an interrupted run leaves either the old cache or the
 * new one and never half of either. `rename` over an existing path replaces it
 * atomically on POSIX and on Windows' NTFS.
 */
async function saveCache(path, cache) {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(cache), "utf8");
  await rename(temp, path);
}

/**
 * A reply cache, or a transparent pass-through when `enabled` is false.
 *
 * Returning the same shape either way is what keeps the call sites free of
 * `if (cacheEnabled)`. A disabled cache still counts calls, so the stats line
 * can report `0 of 13 replies from cache` and say plainly that the run was
 * fresh rather than saying nothing at all.
 *
 * @param path        where to keep it, normally under `tmpdir()`
 * @param enabled     opt-in; false makes this a pass-through
 * @param force       ignore existing entries but still write new ones, so a
 *                    forced run refreshes rather than leaving a stale entry
 * @param fingerprint from `fingerprintFor`, mixed into every key
 * @param log         where the per-hit line goes
 */
export function createReplyCache({
  path,
  enabled = false,
  force = false,
  fingerprint = "",
  log = () => {},
}) {
  let cache = null;
  let hits = 0;
  let misses = 0;

  // Writes are serialised through this chain. Two callers awaiting `ask` in
  // parallel would otherwise both read `cache`, both add their own entry, and
  // both rewrite the file from their own copy, losing whichever landed first.
  let writeQueue = Promise.resolve();

  function keyFor(label, prompt) {
    // 16 hex chars is 64 bits of the prompt's sha256. Collision risk across a
    // cache that holds hundreds of entries is negligible, and the short key
    // keeps the file greppable by hand, which is how a stale entry gets found.
    const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 16);
    return `${fingerprint}|${label}|${hash}`;
  }

  return {
    /**
     * Serve `label`'s reply to `prompt` from disk, or call `produce` and keep
     * what it returns.
     *
     * `produce` is only ever invoked on a miss, so a caller's own retry,
     * logging and cost accounting stay exactly where they were: this wraps the
     * ask, it does not reimplement it.
     */
    async reply(label, prompt, produce) {
      if (!enabled) {
        misses += 1;
        return produce();
      }

      if (cache === null) cache = await loadCache(path);
      const key = keyFor(label, prompt);

      if (!force && typeof cache[key] === "string") {
        hits += 1;
        log(`    [reply-cache] served "${label}" from disk, no model call`);
        return cache[key];
      }

      misses += 1;
      const reply = await produce();
      cache[key] = reply;

      // Chained rather than awaited directly so a slow disk cannot serialise
      // the model calls themselves, while still guaranteeing one writer.
      writeQueue = writeQueue.then(() => saveCache(path, cache)).catch((error) => {
        // A cache that cannot be written is a performance problem, never a
        // correctness one: the reply has already been produced and returned.
        // Say so and carry on rather than failing a run that has succeeded.
        log(`    [reply-cache] could not write ${path}: ${error.message}`);
      });
      await writeQueue;

      return reply;
    },

    stats() {
      return { enabled, force, hits, misses, total: hits + misses, path, fingerprint };
    },

    /**
     * One line for the run summary, next to the cost.
     *
     * SAYS SO WHEN NOTHING WAS CACHED, which is the case that matters: a
     * silent absence reads as "no cache involved" and so does a silent
     * presence. A measurement is only quotable if the transcript says which it
     * was.
     */
    summary() {
      if (!enabled) return "reply cache: off (every reply came from the model)";
      const { hits: h, total } = { hits, total: hits + misses };
      return (
        `reply cache: ${h} of ${total} repl${total === 1 ? "y" : "ies"} served from disk` +
        `${force ? " (FORCED refresh, existing entries ignored)" : ""}` +
        `\n  key fingerprint ${fingerprint}` +
        `\n  ${path}` +
        (h > 0
          ? "\n  A CACHED RUN IS NOT A MEASUREMENT. Model replies are not a pure " +
            "function of\n  their input; re-run without the cache before quoting " +
            "accuracy or cost from it."
          : "")
      );
    },
  };
}
