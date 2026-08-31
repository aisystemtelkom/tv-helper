import { frontendTools } from "@assistant-ui/react-ai-sdk";
import {
  streamText,
  convertToModelMessages,
  type UIMessage,
  type JSONSchema7,
} from "ai";
import {
  chatModel,
  providerOptions,
  MAX_OUTPUT_TOKENS,
  MODEL_ID,
  MODEL_TARGET,
} from "@/lib/model";

// A multi-page scan is a large upload followed by a vision pass over every
// page. Warm text turns land in a couple of seconds; this is the ceiling for
// the slow end, not the expected case.
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
      model: chatModel(),
      messages: await convertToModelMessages(messages),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions,
      // Only send a `tools` field when the client actually registered one.
      ...(Object.keys(frontend).length > 0 ? { tools: frontend } : {}),
      ...(system === undefined ? {} : { system }),

      // Every request now costs money, so make that visible in the server log
      // rather than only on a billing page a month later. Thought tokens bill
      // at the output rate, which is why they are broken out.
      onFinish({ usage, finishReason }) {
        const thoughts = usage.outputTokenDetails?.reasoningTokens ?? 0;
        console.log(
          `[chat] ${MODEL_ID} in=${usage.inputTokens ?? "?"} ` +
            `out=${usage.outputTokens ?? "?"} (thoughts=${thoughts}) ` +
            `total=${usage.totalTokens ?? "?"} finish=${finishReason}`,
        );
        if (finishReason === "length") {
          console.warn(
            `[chat] hit the ${MAX_OUTPUT_TOKENS}-token output cap; the reply is ` +
              "truncated. Raise GEMINI_MAX_OUTPUT_TOKENS if this is legitimate.",
          );
        }
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    return unreachable(error);
  }
}

/**
 * The likely failure is a missing or rejected credential, or quota. Say so
 * instead of surfacing a bare fetch error.
 */
function unreachable(error: unknown) {
  const cause = error instanceof Error ? error.message : String(error);
  console.error(`[chat] ${MODEL_TARGET} failed:`, error);

  return Response.json(
    {
      error:
        `Could not reach ${MODEL_TARGET}. Check that GOOGLE_GENERATIVE_AI_API_KEY ` +
        "is set in .env.local and still valid, that the key has the Generative " +
        "Language API enabled, and that you are not over quota. Run `pnpm smoke` " +
        "to test the key without the UI.",
      cause,
    },
    { status: 503 },
  );
}
