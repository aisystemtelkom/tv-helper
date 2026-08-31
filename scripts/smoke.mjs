import {
  MODEL_ID,
  GEMINI_API_KEY,
  geminiBaseUrl,
  MEDIA_RESOLUTION,
  THINKING_LEVEL,
  MAX_OUTPUT_TOKENS,
  DEFAULT_PAGE_LIMIT,
} from "./env.mjs";
import { solidPng } from "./png.mjs";

const results = [];

/**
 * `fetch` reports every transport problem as a bare "fetch failed" and hides
 * the reason on `cause`. Unfolding it is the difference between "the key is
 * wrong" and "the network blinked".
 */
function describe(error) {
  const cause = error.cause?.code ?? error.cause?.message;
  return cause ? `${error.message} (${cause})` : error.message;
}

/** A dropped connection is not a failing model, so give it exactly one retry. */
const isTransport = (error) =>
  error instanceof TypeError && error.message === "fetch failed";

async function check(name, fn) {
  const started = Date.now();
  let note = "";
  try {
    let detail;
    try {
      detail = await fn();
    } catch (error) {
      if (!isTransport(error)) throw error;
      // Say so rather than hiding it: a run that needed a retry is a weaker
      // pass than one that did not.
      note = `\n        (first attempt failed: ${describe(error)}; retried)`;
      detail = await fn();
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  PASS  ${name}  (${seconds}s)\n        ${detail}${note}\n`);
    results.push(true);
  } catch (error) {
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  FAIL  ${name}  (${seconds}s)\n        ${describe(error)}\n`);
    results.push(false);
  }
}

if (!GEMINI_API_KEY) {
  console.error(
    "GOOGLE_GENERATIVE_AI_API_KEY is not set. Add it to .env.local (see .env.example).",
  );
  process.exit(1);
}

const headers = {
  "content-type": "application/json",
  "x-goog-api-key": GEMINI_API_KEY,
};

/**
 * Mirrors `providerOptions` and `maxOutputTokens` in src/lib/model.ts, so a
 * setting that breaks the app breaks the smoke test too.
 *
 * This calls the native Gemini REST surface on purpose -- the same one
 * @ai-sdk/google calls. Driving the OpenAI compatibility endpoint instead would
 * be less code and would pass while the app was failing, which defeats the
 * point of a boundary test.
 */
const generationConfig = {
  temperature: 0,
  maxOutputTokens: MAX_OUTPUT_TOKENS,
  mediaResolution: MEDIA_RESOLUTION,
  thinkingConfig: { thinkingLevel: THINKING_LEVEL },
};

async function generate(parts, { stream = false } = {}) {
  const method = stream ? "streamGenerateContent?alt=sse" : "generateContent";
  const response = await fetch(`${geminiBaseUrl}/models/${MODEL_ID}:${method}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ contents: [{ parts }], generationConfig }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response;
}

// Thinking arrives as parts flagged `thought`. They are not the answer.
const answerOf = (payload) =>
  (payload.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text)
    .join("");

const imagePart = (png) => ({
  inline_data: { mime_type: "image/png", data: png },
});

console.log(
  `Smoke testing ${MODEL_ID} on the Gemini API\n` +
    `  mediaResolution=${MEDIA_RESOLUTION} thinkingLevel=${THINKING_LEVEL} ` +
    `maxOutputTokens=${MAX_OUTPUT_TOKENS}\n`,
);

await check("model is reachable", async () => {
  const response = await fetch(`${geminiBaseUrl}/models/${MODEL_ID}`, { headers });
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `The API key was rejected (HTTP ${response.status}). Check GOOGLE_GENERATIVE_AI_API_KEY in .env.local.`,
    );
  }
  if (response.status === 404) {
    throw new Error(`${MODEL_ID} is not available to this key. Check MODEL_ID.`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

  const model = await response.json();
  if (!(model.supportedGenerationMethods ?? []).includes("generateContent")) {
    throw new Error(`${MODEL_ID} does not support generateContent.`);
  }
  return `${model.displayName} reachable, ${model.inputTokenLimit} token context`;
});

// The load-bearing test: can it actually answer, and how fast.
await check("text inference returns a correct answer", async () => {
  const payload = await (
    await generate([{ text: "What is 2+2? Reply with only the digit." }])
  ).json();
  const content = answerOf(payload);
  if (!content.includes("4")) {
    throw new Error(`Expected "4", got: ${JSON.stringify(content)}`);
  }
  const tokens = payload.usageMetadata?.candidatesTokenCount;
  return `answered ${JSON.stringify(content.trim())}${tokens ? ` (${tokens} completion tokens)` : ""}`;
});

// assistant-ui renders token-by-token, so streaming is not optional.
await check("streaming delivers incremental chunks", async () => {
  const response = await generate(
    [{ text: "Count from 1 to 40, separated by spaces." }],
    { stream: true },
  );

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
      const delta = answerOf(JSON.parse(line.slice(6)));
      if (delta) {
        chunks += 1;
        text += delta;
      }
    }
  }

  if (chunks < 2) throw new Error(`Expected multiple chunks, got ${chunks}`);
  return `${chunks} chunks, assembled ${JSON.stringify(text.trim().slice(0, 48))}`;
});

// The capability the real document validator is built on. Proving it now means
// a vision regression cannot hide behind a working text chat.
await check("vision accepts an image and describes it", async () => {
  const png = solidPng(224, 224, [220, 20, 60]).toString("base64");
  const content = answerOf(
    await (
      await generate([
        { text: "What color fills this image? Answer with one word." },
        imagePart(png),
      ])
    ).json(),
  );
  if (!/red|crimson|maroon/i.test(content)) {
    throw new Error(`Expected a red-family colour, got: ${JSON.stringify(content.trim())}`);
  }
  return `saw ${JSON.stringify(content.trim())} in a crimson test image`;
});

// Every page of every scan is billed. Price it here, where the number is cheap
// to look at, instead of discovering it on an invoice.
await check("a scanned page costs what we budgeted", async () => {
  // The shape src/lib/attachments/pdf.ts emits: letter aspect, 1024 long edge.
  const page = solidPng(791, 1024, [245, 245, 240]).toString("base64");
  const payload = await (
    await generate([
      { text: "Describe this page in one short sentence." },
      imagePart(page),
    ])
  ).json();

  const prompt = payload.usageMetadata?.promptTokenCount;
  if (!prompt) throw new Error("No promptTokenCount in usageMetadata.");

  // Wide band on purpose: this catches "mediaResolution silently stopped
  // applying", not small drift between model revisions.
  if (prompt < 100 || prompt > 5000) {
    throw new Error(
      `${prompt} prompt tokens for one page is outside the expected 100-5000 band. ` +
        `Check GEMINI_MEDIA_RESOLUTION (currently ${MEDIA_RESOLUTION}).`,
    );
  }

  const perPdf = prompt * DEFAULT_PAGE_LIMIT;
  return (
    `${prompt} prompt tokens per page at ${MEDIA_RESOLUTION}; ` +
    `a full ${DEFAULT_PAGE_LIMIT}-page PDF costs about ${perPdf} input tokens`
  );
});

const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} checks passed.`);
process.exitCode = passed === results.length ? 0 : 1;
