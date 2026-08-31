/**
 * The Auth.js instance. `handlers` is mounted by
 * `src/app/api/auth/[...nextauth]/route.ts`; `auth()` reads the signed JWT
 * session for a server component, Server Function, or route handler.
 *
 * Import `requireUser` / `requireAdmin` from `./require-user.ts` instead of
 * calling `auth()` directly. `auth()` answers "who is this", which is not the
 * same question as "may they be here" -- only the guard consults the allowlist.
 *
 * ---
 *
 * **`next-auth` IS PINNED TO AN EXACT PRERELEASE, `5.0.0-beta.32`, AND MUST
 * STAY EXACT.** There is no stable v5. Checked 2026-09-01,
 * `npm view next-auth dist-tags`:
 *
 *     latest  4.24.15          <- the 4.x line: getServerSession, a pages-router
 *                                 [...nextauth].ts, no auth() helper at all
 *     beta    5.0.0-beta.32    <- what this app is written against
 *
 * Two consequences a reader will otherwise hit:
 *
 * - **`pnpm up next-auth` is a DOWNGRADE to 4.24.15**, not an upgrade, and the
 *   whole of `./index.ts`, `./config.ts` and `src/proxy.ts` stops compiling.
 * - **A `^` range is not a pin.** `^5.0.0-beta.32` also matches `5.0.0-beta.33`
 *   and every later beta, and this line ships breaking changes between betas.
 *   Keep the version bare.
 *
 * Moving it deliberately means re-reading the Auth.js release notes, re-running
 * `pnpm test`, and re-checking the served sign-in HTML for external hosts (see
 * `pages` in `./config.ts`), not just watching the build pass.
 *
 * Same rule, same reason, as the frozen `xlsx` entry in AGENTS.md: the version
 * number is a decision, not a default.
 */

import NextAuth from "next-auth";

import { authConfig } from "./config.ts";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
