/**
 * The chat route's control flow, with its dependencies injected.
 *
 * This exists so the authorization gate on `/api/chat` can be TESTED rather
 * than read. `route.ts` binds the real `requireApiUser` and the real Gemini
 * call; `src/lib/auth/auth.test.mts` binds a real guard over an empty session
 * and asserts that an unauthenticated POST is refused **and that the model is
 * never reached** -- which is exactly the request `src/proxy.ts` would have
 * stopped, arriving at a handler proxy never ran for.
 *
 * The file has no runtime imports at all (every import is `import type`, which
 * is erased), so `node --test` can load it directly with no Next runtime, no
 * bundler and no path-alias resolution.
 *
 * THE ORDER IN `createChatHandler` IS THE POINT. The gate runs before the body
 * is read and before anything reaches `src/lib/model.ts`. Moving it after
 * either would still return 401 to an anonymous caller while letting them spend
 * the credential first.
 */

import type { JSONSchema7, UIMessage } from "ai";

import type { ApiGate } from "@/lib/auth/guard";

export type ChatBody = {
  messages: UIMessage[];
  system?: string;
  tools?: Record<string, { description?: string; parameters: JSONSchema7 }>;
};

export type ChatDeps = {
  /** The authorization gate. `requireApiUser` in production. */
  gate: () => Promise<ApiGate>;
  /** The model call. Only reached once `gate` has admitted the caller. */
  stream: (body: ChatBody) => Response | Promise<Response>;
  /** Turns a provider failure into an operator-readable 503. */
  unreachable: (error: unknown) => Response;
  /** Malformed request body. Separate from `unreachable`: it is the caller's. */
  badRequest?: (error: unknown) => Response;
};

function defaultBadRequest(error: unknown): Response {
  return Response.json(
    {
      error: "bad-request",
      message: "The request body is not valid JSON.",
      cause: error instanceof Error ? error.message : String(error),
    },
    { status: 400 },
  );
}

export function createChatHandler(deps: ChatDeps) {
  const badRequest = deps.badRequest ?? defaultBadRequest;

  return async function POST(req: Request): Promise<Response> {
    // 1. AUTHORIZE. First, unconditionally, in the handler itself.
    const gate = await deps.gate();
    if (gate.response) return gate.response;

    // 2. Only then read what the caller sent.
    let body: ChatBody;
    try {
      body = (await req.json()) as ChatBody;
    } catch (error) {
      return badRequest(error);
    }

    // 3. Only then spend the credential.
    try {
      return await deps.stream(body);
    } catch (error) {
      return deps.unreachable(error);
    }
  };
}
