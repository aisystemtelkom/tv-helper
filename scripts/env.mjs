import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Weights live in the project, not in the machine-wide ~/.ollama store. */
export const modelsDir = join(repoRoot, "models");

export const MODEL_ID = process.env.MODEL_ID ?? "gemma3:4b";

/**
 * Deliberately not Ollama's default 11434. A project-owned server on its own
 * port cannot collide with -- or be silently served by -- a global Ollama
 * install that is using the machine-wide model directory.
 */
export const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "127.0.0.1:11435";

export const baseUrl = `http://${OLLAMA_HOST}`;
export const openAiBaseUrl = `${baseUrl}/v1`;

/**
 * VRAM guards. The laptop this targets has 8 GB, which must also cover the
 * desktop compositor and a browser.
 */
export const serverEnv = {
  ...process.env,
  OLLAMA_HOST,
  OLLAMA_MODELS: modelsDir,
  // The single biggest lever: Gemma 3's default 128K context would size a KV
  // cache far past an 8 GB card. 8K is ample for chat and document pages.
  OLLAMA_CONTEXT_LENGTH: process.env.OLLAMA_CONTEXT_LENGTH ?? "8192",
  // Hand the VRAM back when idle instead of squatting on it.
  OLLAMA_KEEP_ALIVE: process.env.OLLAMA_KEEP_ALIVE ?? "5m",
  OLLAMA_MAX_LOADED_MODELS: "1",
  // Together these roughly halve KV cache footprint.
  OLLAMA_FLASH_ATTENTION: "1",
  OLLAMA_KV_CACHE_TYPE: "q8_0",
};

const binaryCandidates = {
  win32: [
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Ollama", "ollama.exe"),
    join(process.env.ProgramFiles ?? "", "Ollama", "ollama.exe"),
  ],
  darwin: [
    "/usr/local/bin/ollama",
    "/opt/homebrew/bin/ollama",
    "/Applications/Ollama.app/Contents/Resources/ollama",
    join(homedir(), ".local", "bin", "ollama"),
  ],
  linux: ["/usr/local/bin/ollama", "/usr/bin/ollama"],
};

export const installHint = {
  win32: "winget install --id Ollama.Ollama -e",
  darwin: "brew install ollama   (or download from https://ollama.com/download)",
  linux: "curl -fsSL https://ollama.com/install.sh | sh",
}[platform()] ?? "https://ollama.com/download";

/**
 * Resolve the binary without depending on PATH. A fresh install has not yet
 * propagated to already-open shells, and on macOS the app bundle is not on
 * PATH at all -- both would otherwise look like "Ollama is not installed".
 */
export function resolveOllama() {
  for (const candidate of binaryCandidates[platform()] ?? []) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  // Fall back to PATH lookup and let spawn decide.
  return platform() === "win32" ? "ollama.exe" : "ollama";
}
