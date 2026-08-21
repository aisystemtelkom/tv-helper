import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  streamText,
  convertToModelMessages,
  type UIMessage,
  type JSONSchema7,
} from "ai";
import { chatModel, MODEL_ID, BASE_URL } from "@/lib/model";

// Local inference on a laptop GPU is slower than a hosted API. Give a long
// document or a cold model load room to finish.
export const maxDuration = 120;

export async function POST(req: Request) {
  const {
    messages,
    system,
    tools,
  }: {
    messages: UIMessage[];
    system?: string;
    tools?: Record<string, { description?: string; parameters: JSONSchema7 }>;
  } = await req.json();

  const frontend = frontendTools(tools ?? {});

  try {
    const result = streamText({
      model: chatModel,
      messages: await convertToModelMessages(messages),
      // Gemma 3's chat template has no native tool-calling section, so only
      // send a `tools` field when the client actually registered one.
      ...(Object.keys(frontend).length > 0 ? { tools: frontend } : {}),
      ...(system === undefined ? {} : { system }),
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    return unreachable(error);
  }
}

/**
 * The overwhelmingly likely failure in local development is "the model server
 * isn't running". Say so plainly instead of surfacing a bare fetch error.
 */
function unreachable(error: unknown) {
  const cause = error instanceof Error ? error.message : String(error);
  console.error(`[chat] ${MODEL_ID} via ${BASE_URL} failed:`, error);

  return Response.json(
    {
      error: `Could not reach the local model at ${BASE_URL}. Start it with \`pnpm ollama:serve\`, then confirm the model is present with \`pnpm model:pull\`.`,
      cause,
    },
    { status: 503 },
  );
}
