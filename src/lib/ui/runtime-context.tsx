"use client";

/**
 * One place where the UI is handed its runtime.
 *
 * Every screen calls `useRuntime()`, so swapping the stub for the real
 * `src/lib/browser/runtime.ts` is a change to a single prop rather than a
 * search through the component tree. It also means a screen can be driven by
 * a fake without mocking a module.
 */

import { createContext, useContext, type ReactNode } from "react";

import type { Runtime } from "./runtime";

const RuntimeContext = createContext<Runtime | null>(null);

export function RuntimeProvider({
  runtime,
  children,
}: {
  runtime: Runtime;
  children: ReactNode;
}) {
  return (
    <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>
  );
}

export function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) {
    throw new Error("useRuntime must be used inside <RuntimeProvider>");
  }
  return runtime;
}
