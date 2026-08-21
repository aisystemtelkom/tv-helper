import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * The single place the app learns how to reach a model.
 *
 * Everything upstream of this file speaks plain OpenAI-compatible HTTP and
 * knows nothing about Ollama. Moving to llama.cpp, vLLM, or a hosted endpoint
 * later is a change to these two env vars -- not a change to app code.
 */
export const MODEL_ID = process.env.MODEL_ID ?? "gemma3:4b";

export const BASE_URL =
  process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11435/v1";

const local = createOpenAICompatible({
  name: "local",
  baseURL: BASE_URL,
  // Ollama ignores the credential, but the OpenAI wire format requires one.
  apiKey: "local",
});

export const chatModel = local.chatModel(MODEL_ID);
