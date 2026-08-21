import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import {
  baseUrl,
  installHint,
  modelsDir,
  resolveOllama,
  serverEnv,
} from "./env.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when a server is already answering on the project port. */
export async function isRunning() {
  try {
    const response = await fetch(`${baseUrl}/api/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilReady(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isRunning()) return true;
    await sleep(400);
  }
  return false;
}

/**
 * Guarantee a server is reachable, and return a disposer.
 *
 * If one is already up (because `pnpm ollama:serve` is running in another
 * terminal) we reuse it and the disposer is a no-op -- a setup script must
 * never tear down a server it did not start.
 */
export async function ensureServer() {
  if (await isRunning()) {
    console.log(`Using the Ollama server already listening on ${baseUrl}.`);
    return async () => {};
  }

  mkdirSync(modelsDir, { recursive: true });
  console.log(`Starting a temporary Ollama server on ${baseUrl}...`);

  const child = spawn(resolveOllama(), ["serve"], {
    env: serverEnv,
    stdio: "ignore",
  });

  child.on("error", (error) => {
    if (error.code === "ENOENT") {
      console.error(`\nOllama is not installed. Install it with:\n  ${installHint}\n`);
      process.exit(1);
    }
    throw error;
  });

  if (!(await waitUntilReady())) {
    child.kill();
    throw new Error(
      `Ollama did not become ready on ${baseUrl} within 30s. ` +
        `Try running \`pnpm ollama:serve\` in a separate terminal to see its output.`,
    );
  }

  console.log("Server ready.\n");
  return async () => {
    child.kill();
    await sleep(300);
  };
}
