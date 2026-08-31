/**
 * The Auth.js endpoint: sign-in, the Google callback, sign-out, session, CSRF.
 *
 * This is the one route `src/proxy.ts` deliberately does not gate -- it has to
 * be reachable while signed out, or sign-in redirects to itself.
 */

import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
