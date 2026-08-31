import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Next loads .env.local for the app; a plain node script does not. Without this
 * the smoke test would hunt for the Gemini key in a shell that never had it and
 * report a missing credential that is sitting in the file. Node's loader leaves
 * variables already set in the shell alone, so `MODEL_ID=x pnpm smoke` still
 * wins over the file -- the same precedence Next applies.
 */
for (const file of [".env.local", ".env"]) {
  const path = join(repoRoot, file);
  if (existsSync(path)) process.loadEnvFile(path);
}

/**
 * These mirror src/lib/model.ts so the smoke test exercises the settings the
 * app actually sends. Keep the defaults in step with that file.
 */
export const MODEL_ID = process.env.MODEL_ID ?? "gemini-3.5-flash";

export const GEMINI_API_KEY =
  process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ?? "";

/** The native Gemini REST surface -- the same one @ai-sdk/google calls. */
export const geminiBaseUrl =
  process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";

export const MEDIA_RESOLUTION =
  process.env.GEMINI_MEDIA_RESOLUTION ?? "MEDIA_RESOLUTION_HIGH";

export const THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL ?? "low";

export const MAX_OUTPUT_TOKENS = Number(
  process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 4096,
);

/**
 * Single source of truth is src/lib/attachments/pdf.ts, which is TypeScript and
 * cannot be imported from a plain node script. Read the constant rather than
 * duplicating a number that decides what a scanned PDF costs per request.
 */
export const DEFAULT_PAGE_LIMIT = (() => {
  const source = readFileSync(
    join(repoRoot, "src", "lib", "attachments", "pdf.ts"),
    "utf8",
  );
  const match = source.match(/DEFAULT_PAGE_LIMIT\s*=\s*(\d+)/);
  if (!match) {
    throw new Error(
      "Could not read DEFAULT_PAGE_LIMIT from src/lib/attachments/pdf.ts.",
    );
  }
  return Number(match[1]);
})();
