/**
 * The Auth.js instance. `handlers` is mounted by
 * `src/app/api/auth/[...nextauth]/route.ts`; `auth()` reads the signed JWT
 * session for a server component, Server Function, or route handler.
 *
 * Import `requireUser` / `requireAdmin` from `./require-user.ts` instead of
 * calling `auth()` directly. `auth()` answers "who is this", which is not the
 * same question as "may they be here" -- only the guard consults the allowlist.
 */

import NextAuth from "next-auth";

import { authConfig } from "./config.ts";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
