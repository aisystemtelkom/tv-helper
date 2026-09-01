"use client";

/**
 * THE PRODUCTION RUNTIME. One module, one binding, one line.
 *
 * `src/lib/browser/runtime.ts` declares the contract as free functions; the UI
 * consumes it as a `Runtime` value (see `./runtime.ts`). This file is the only
 * place those two meet in a shipped build.
 *
 * WHY IT IS ITS OWN FILE, and a plain `.ts` rather than part of the component
 * that uses it. Node's type stripping cannot load `.tsx`, so a test cannot
 * import the operator app to ask what runtime it chose. It can import THIS,
 * so the choice is a value a test can assert on -- see
 * `src/lib/ui/wiring.test.mts`. A wiring mistake that used to be invisible
 * (the app ran on `createStubRuntime()` for an entire track and nothing
 * failed) now fails a test instead of shipping.
 *
 * The `import * as` is load-bearing too. Assigning the namespace object to
 * `Runtime` is what makes `tsc` compare the real module's exported functions
 * against the shape every screen calls, so a signature that drifts is a
 * compile error rather than a runtime `undefined is not a function` in front
 * of an operator.
 */

import * as browserRuntime from "../browser/runtime.ts";
import type { Runtime } from "./runtime.ts";

export const liveRuntime: Runtime = browserRuntime;
