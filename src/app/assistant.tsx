"use client";

import { useMemo } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useChatRuntime,
} from "@assistant-ui/react-ai-sdk";
import { useRemoteThreadListRuntime } from "@assistant-ui/core/react";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Thread } from "@/components/thread";
import { ThreadList } from "@/components/thread-list";
import { createLocalAttachmentAdapter } from "@/lib/attachments/adapter";
import { createThreadListAdapter } from "@/lib/threads/store";

const attachments = createLocalAttachmentAdapter();

/** One AI SDK chat per thread; history is injected by the thread list adapter. */
const useThreadRuntime = () =>
  useChatRuntime({
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport: new AssistantChatTransport({ api: "/api/chat" }),
    adapters: { attachments },
  });

export const Assistant = () => {
  const adapter = useMemo(() => createThreadListAdapter(), []);
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useThreadRuntime,
    adapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-dvh">
        <aside className="hidden w-64 shrink-0 flex-col gap-2 border-r bg-muted/30 p-3 md:flex">
          <ThreadList />
        </aside>
        <main className="min-w-0 flex-1">
          <Thread />
        </main>
      </div>
    </AssistantRuntimeProvider>
  );
};
