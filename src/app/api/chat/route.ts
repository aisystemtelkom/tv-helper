/**
 * The chat route.
 *
 * IT GATES ITSELF. `src/proxy.ts` also refuses an unauthenticated `/api/*`
 * request, but proxy is an optimization, not the boundary: Next's own reference
 * warns that a matcher change or a refactor that moves work to a different
 * route silently removes proxy coverage. `requireApiUser()` below is the check
 * that decides, and `src/lib/auth/auth.test.mts` proves it holds when proxy
 * never ran.
 *
 * The control flow lives in `./handler.ts` so that test can execute it. This
 * file is the production binding and nothing else.
 */

import { frontendTools } from "@assistant-ui/react-ai-sdk";
import { streamText, convertToModelMessages } from "ai";

import {
  chatModel,
  providerOptions,
  MAX_OUTPUT_TOKENS,
  MODEL_ID,
  MODEL_TARGET,
} from "@/lib/model";
import { requireApiUser } from "@/lib/auth/require-user";

import { createChatHandler, type ChatBody } from "./handler.ts";

// A multi-page scan is a large upload followed by a vision pass over every
// page. Warm text turns land in a couple of seconds; this is the ceiling for
// the slow end, not the expected case.
export const maxDuration = 120;

async function stream(body: ChatBody): Promise<Response> {
  const frontend = frontendTools(body.tools ?? {});

  const result = streamText({
    model: chatModel(),
    messages: await convertToModelMessages(body.messages),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    providerOptions,
    // Only send a `tools` field when the client actually registered one.
    ...(Object.keys(frontend).length > 0 ? { tools: frontend } : {}),
    ...(body.system === undefined ? {} : { system: body.system }),

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

export const POST = createChatHandler({
  gate: requireApiUser,
  stream,
  unreachable,
});
