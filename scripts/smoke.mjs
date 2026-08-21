import { MODEL_ID, baseUrl, openAiBaseUrl } from "./env.mjs";
import { ensureServer } from "./server.mjs";
import { solidPng } from "./png.mjs";

const results = [];

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  PASS  ${name}  (${seconds}s)\n        ${detail}\n`);
    results.push(true);
  } catch (error) {
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  FAIL  ${name}  (${seconds}s)\n        ${error.message}\n`);
    results.push(false);
  }
}

async function chat(body) {
  const response = await fetch(`${openAiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL_ID, ...body }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response;
}

const stop = await ensureServer();

try {
  console.log(`Smoke testing ${MODEL_ID} at ${openAiBaseUrl}\n`);

  await check("model is registered", async () => {
    const { models = [] } = await (await fetch(`${baseUrl}/api/tags`)).json();
    const names = models.map((m) => m.name);
    if (!names.includes(MODEL_ID)) {
      throw new Error(`${MODEL_ID} not found. Run \`pnpm model:pull\`. Have: ${names.join(", ") || "none"}`);
    }
    return `./models contains ${names.join(", ")}`;
  });

  // The load-bearing test: can it actually answer, and how fast.
  await check("text inference returns a correct answer", async () => {
    const response = await chat({
      messages: [{ role: "user", content: "What is 2+2? Reply with only the digit." }],
      temperature: 0,
    });
    const json = await response.json();
    const content = json.choices?.[0]?.message?.content ?? "";
    if (!content.includes("4")) throw new Error(`Expected "4", got: ${JSON.stringify(content)}`);

    const tokens = json.usage?.completion_tokens;
    return `answered ${JSON.stringify(content.trim())}${tokens ? ` (${tokens} completion tokens)` : ""}`;
  });

  // assistant-ui renders token-by-token, so streaming is not optional.
  await check("streaming delivers incremental chunks", async () => {
    const response = await chat({
      stream: true,
      messages: [{ role: "user", content: "Count from 1 to 10, separated by spaces." }],
      temperature: 0,
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let chunks = 0;
    let text = "";
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (delta) {
          chunks += 1;
          text += delta;
        }
      }
    }

    if (chunks < 2) throw new Error(`Expected multiple chunks, got ${chunks}`);
    return `${chunks} chunks, assembled ${JSON.stringify(text.trim().slice(0, 48))}`;
  });

  // The capability the real document validator is built on. Proving it now
  // means a vision regression cannot hide behind a working text chat.
  await check("vision accepts an image and describes it", async () => {
    const png = solidPng(224, 224, [220, 20, 60]).toString("base64");
    const response = await chat({
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What color fills this image? Answer with one word." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${png}` } },
          ],
        },
      ],
    });
    const content = (await response.json()).choices?.[0]?.message?.content ?? "";
    if (!/red|crimson|maroon/i.test(content)) {
      throw new Error(`Expected a red-family colour, got: ${JSON.stringify(content.trim())}`);
    }
    return `saw ${JSON.stringify(content.trim())} in a crimson test image`;
  });

  const passed = results.filter(Boolean).length;
  console.log(`${passed}/${results.length} checks passed.`);
  process.exitCode = passed === results.length ? 0 : 1;
} finally {
  await stop();
}
