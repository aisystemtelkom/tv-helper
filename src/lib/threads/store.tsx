"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RuntimeAdapterProvider,
  useAui,
  type RemoteThreadListAdapter,
} from "@assistant-ui/react";
import {
  createLocalStorageAdapter,
  createSimpleTitleAdapter,
} from "@assistant-ui/core/react";
import { createIndexedDBStorage } from "@/lib/storage/indexeddb";
import { createLocalHistoryAdapter } from "./history";
import type { FC, PropsWithChildren } from "react";

const PREFIX = "tv-helper:";

// One storage handle per tab; the IndexedDB connection opens lazily.
const storage = createIndexedDBStorage();

/**
 * Supplies the per-thread history adapter.
 *
 * The adapter outlives any single render but must always write against the
 * thread that is currently active, so the live `aui` client is handed to it
 * through a mutable holder that an effect keeps current.
 */
const useHistoryAdapters = () => {
  const aui = useAui();
  const auiRef = useRef(aui);

  useEffect(() => {
    auiRef.current = aui;
  });

  // The ref is read only from async storage callbacks (append/load/delete),
  // never during render, so this is safe -- but the React compiler cannot see
  // that through the closure. This mirrors assistant-ui's own
  // `useLocalStorageThreadAdapters`, which builds its history adapter the
  // same way.
  // eslint-disable-next-line react-hooks/refs
  const [history] = useState(() =>
    createLocalHistoryAdapter(storage, PREFIX, () => {
      const item = auiRef.current?.threadListItem;
      // `source` is unset until the thread list item is bound.
      return item?.source ? item : undefined;
    }),
  );

  return useMemo(() => ({ history }), [history]);
};

const HistoryProvider: FC<PropsWithChildren> = ({ children }) => (
  <RuntimeAdapterProvider adapters={useHistoryAdapters()}>
    {children}
  </RuntimeAdapterProvider>
);

/**
 * Thread list persisted to IndexedDB.
 *
 * The bundled adapter handles list/rename/archive/delete/title. Its history
 * provider is replaced because the bundled one lacks `withFormat`, which
 * `useChatRuntime` requires -- see `./history.ts`.
 */
export const createThreadListAdapter = (): RemoteThreadListAdapter => ({
  ...createLocalStorageAdapter({
    storage,
    prefix: PREFIX,
    // Titles come from the first user message. Asking a 4B model on a local
    // GPU to name every thread would cost an extra generation per conversation
    // for no real benefit.
    titleGenerator: createSimpleTitleAdapter(),
  }),
  unstable_Provider: HistoryProvider,
  unstable_useAdapters: useHistoryAdapters,
});
