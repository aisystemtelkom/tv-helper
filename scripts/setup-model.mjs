import { MODEL_ID, baseUrl, modelsDir } from "./env.mjs";
import { ensureServer } from "./server.mjs";

const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

async function alreadyPresent() {
  const response = await fetch(`${baseUrl}/api/tags`);
  const { models = [] } = await response.json();
  return models.find((m) => m.name === MODEL_ID || m.model === MODEL_ID);
}

/** Stream Ollama's NDJSON pull progress into a single rewriting line. */
async function pull() {
  const response = await fetch(`${baseUrl}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL_ID, stream: true }),
  });

  if (!response.ok) {
    throw new Error(`Pull failed: ${response.status} ${await response.text()}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);

      if (event.error) throw new Error(event.error);

      const progress =
        event.total && event.completed
          ? ` ${gb(event.completed)} / ${gb(event.total)} ` +
            `(${Math.round((event.completed / event.total) * 100)}%)`
          : "";

      process.stdout.write(`\r  ${event.status}${progress}`.padEnd(72));
    }
  }
  process.stdout.write("\n");
}

const stop = await ensureServer();
try {
  console.log(`Model directory: ${modelsDir}`);

  const existing = await alreadyPresent();
  if (existing) {
    console.log(`${MODEL_ID} is already present (${gb(existing.size)}). Nothing to do.`);
  } else {
    console.log(`Pulling ${MODEL_ID}...`);
    await pull();
    const pulled = await alreadyPresent();
    if (!pulled) throw new Error(`${MODEL_ID} is still missing after the pull.`);
    console.log(`Done. ${MODEL_ID} (${gb(pulled.size)}) is in ./models.`);
  }

  console.log(`\nNext: \`pnpm ollama:serve\` in one terminal, \`pnpm smoke\` in another.`);
} finally {
  await stop();
}
