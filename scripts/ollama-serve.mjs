import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import {
  MODEL_ID,
  OLLAMA_HOST,
  baseUrl,
  installHint,
  modelsDir,
  resolveOllama,
  serverEnv,
} from "./env.mjs";
import { isRunning } from "./server.mjs";

/**
 * Refuse to start on an occupied port.
 *
 * Without this check the banner below prints, `ollama serve` then fails to
 * bind, and every later request is answered by whatever process already owns
 * the port -- possibly with a different context length or model directory.
 * The setup looks healthy and is quietly wrong.
 */
if (await isRunning()) {
  console.error(`Something is already serving ${baseUrl}.`);
  console.error(
    `\nThis server was NOT started, so the settings below are not in effect.`,
  );
  console.error(`Its config may differ from this project's.\n`);
  console.error(`Stop it first, then re-run:`);
  console.error(
    process.platform === "win32"
      ? `  Get-NetTCPConnection -LocalPort ${OLLAMA_HOST.split(":")[1]} -State Listen |\n    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`
      : `  lsof -ti :${OLLAMA_HOST.split(":")[1]} | xargs kill`,
  );
  process.exit(1);
}

mkdirSync(modelsDir, { recursive: true });

const binary = resolveOllama();

console.log(`ollama serve  ->  ${baseUrl}`);
console.log(`models        ->  ${modelsDir}`);
console.log(`context       ->  ${serverEnv.OLLAMA_CONTEXT_LENGTH} tokens`);
console.log(`keep-alive    ->  ${serverEnv.OLLAMA_KEEP_ALIVE} (VRAM released when idle)`);
console.log(`default model ->  ${MODEL_ID}\n`);

const child = spawn(binary, ["serve"], { env: serverEnv, stdio: "inherit" });

child.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error(`\nOllama is not installed. Install it with:\n  ${installHint}\n`);
    process.exit(1);
  }
  throw error;
});

child.on("exit", (code) => process.exit(code ?? 0));

// Ctrl+C and orderly termination stop the child. A hard kill of this process
// (SIGKILL, or a task manager) cannot be intercepted and will orphan it --
// which is what the port check above exists to catch on the next run.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    child.kill();
    process.exit(0);
  });
}
process.on("exit", () => child.kill());
