/**
 * Allowlist and guard tests.
 *
 * No GCP credential, no network, no Next runtime: `allowlist.ts` and
 * `guard.ts` take their store and their clock as arguments precisely so this
 * suite can drive the Firestore-unreachable and TTL-expiry paths, which are
 * the ones that would otherwise only be exercised during an outage.
 *
 * `src/lib/auth/require-user.ts` is a five-line binding of `createGuard` to the
 * real `auth()` and the real Firestore reader; the logic it exposes is what is
 * tested here.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWLIST_TTL_MS,
  BOOTSTRAP_OWNER_EMAIL,
  coerceRole,
  createAllowlist,
  isAdminRole,
  normalizeEmail,
  type AllowlistEntry,
  type AllowlistReader,
} from "./allowlist.ts";
import {
  AuthorizationError,
  createGuard,
  denialResponse,
  isAuthDisabled,
  type SessionLike,
} from "./guard.ts";

const silent = () => {};

/** An in-memory reader. `fail` makes every call throw, standing in for an outage. */
function fakeReader(seed: AllowlistEntry[] = []) {
  const rows = new Map(seed.map((e) => [e.email, e]));
  const state = { fail: false, reads: 0 };
  const boom = () => {
    throw new Error("Firestore unavailable");
  };
  const reader: AllowlistReader = {
    async get(email) {
      state.reads += 1;
      if (state.fail) boom();
      return rows.get(email) ?? null;
    },
    async list() {
      if (state.fail) boom();
      return [...rows.values()];
    },
    async put(entry) {
      if (state.fail) boom();
      rows.set(entry.email, entry);
    },
    async remove(email) {
      if (state.fail) boom();
      rows.delete(email);
    },
  };
  return { reader, state, rows };
}

const entry = (
  email: string,
  role: AllowlistEntry["role"] = "member",
): AllowlistEntry => ({
  email,
  role,
  addedBy: "someone@gmail.com",
  addedAt: "2026-08-31T00:00:00.000Z",
});

// --- allowlist ------------------------------------------------------------

test("normalizeEmail lowercases and trims", () => {
  assert.equal(normalizeEmail("  Operator@Gmail.COM "), "operator@gmail.com");
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail(undefined), "");
});

test("a listed address is admitted with its stored role", async () => {
  const { reader } = fakeReader([entry("op@gmail.com", "admin")]);
  const list = createAllowlist(reader, { warn: silent });

  const decision = await list.lookup("OP@gmail.com");
  assert.deepEqual(decision, {
    allowed: true,
    email: "op@gmail.com",
    role: "admin",
    via: "allowlist",
  });
  assert.equal(isAdminRole("admin"), true);
  assert.equal(isAdminRole("member"), false);
});

test("an unlisted address is denied as not-listed, not as an error", async () => {
  const { reader } = fakeReader();
  const list = createAllowlist(reader, { warn: silent });

  assert.deepEqual(await list.lookup("stranger@gmail.com"), {
    allowed: false,
    email: "stranger@gmail.com",
    reason: "not-listed",
  });
});

test("an empty email is denied without touching the store", async () => {
  const { reader, state } = fakeReader();
  const list = createAllowlist(reader, { warn: silent });

  assert.deepEqual(await list.lookup(""), {
    allowed: false,
    email: "",
    reason: "no-email",
  });
  assert.equal(state.reads, 0);
});

test("a store failure denies everyone else, and says why", async () => {
  const { reader, state } = fakeReader([entry("op@gmail.com")]);
  const list = createAllowlist(reader, { warn: silent });
  state.fail = true;

  const decision = await list.lookup("op@gmail.com");
  assert.deepEqual(decision, {
    allowed: false,
    email: "op@gmail.com",
    // Distinct from "not-listed" on purpose: revoked and outage are different
    // incidents and the log has to tell them apart.
    reason: "lookup-failed",
  });
});

test("the bootstrap owner is admitted when the store is unreachable", async () => {
  const { reader, state } = fakeReader();
  const list = createAllowlist(reader, { warn: silent });
  state.fail = true;

  assert.deepEqual(await list.lookup(BOOTSTRAP_OWNER_EMAIL), {
    allowed: true,
    email: BOOTSTRAP_OWNER_EMAIL,
    role: "owner",
    via: "bootstrap",
  });
  // Never even asked. A hung Firestore call must not delay the one account
  // that can repair a broken allowlist.
  assert.equal(state.reads, 0);
});

test("the bootstrap owner is admitted when the collection is empty", async () => {
  const { reader } = fakeReader();
  const list = createAllowlist(reader, { warn: silent });

  const decision = await list.lookup(` ${BOOTSTRAP_OWNER_EMAIL.toUpperCase()} `);
  assert.equal(decision.allowed, true);
  assert.equal(decision.allowed && decision.role, "owner");
});

test("the bootstrap owner stays owner even if the store demotes them", async () => {
  const { reader } = fakeReader([entry(BOOTSTRAP_OWNER_EMAIL, "member")]);
  const list = createAllowlist(reader, { warn: silent });

  const decision = await list.lookup(BOOTSTRAP_OWNER_EMAIL);
  assert.equal(decision.allowed && decision.role, "owner");
  assert.equal(decision.allowed && decision.via, "bootstrap");
});

test("an answer is cached for the TTL and re-read after it", async () => {
  const { reader, state, rows } = fakeReader([entry("op@gmail.com")]);
  let clock = 1_000_000;
  const list = createAllowlist(reader, { now: () => clock, warn: silent });

  assert.equal((await list.lookup("op@gmail.com")).allowed, true);
  assert.equal(state.reads, 1);

  // Revoked in the store, but still cached.
  rows.delete("op@gmail.com");
  clock += ALLOWLIST_TTL_MS - 1;
  assert.equal((await list.lookup("op@gmail.com")).allowed, true);
  assert.equal(state.reads, 1);

  // One millisecond past the TTL the store is consulted again and the
  // revocation lands. This is the whole point of the cache being short.
  clock += 1;
  const after = await list.lookup("op@gmail.com");
  assert.equal(after.allowed, false);
  assert.equal(state.reads, 2);
});

test("a lookup failure is not cached, so a blip is not amplified", async () => {
  const { reader, state } = fakeReader([entry("op@gmail.com")]);
  // Frozen clock: both lookups happen at the same instant, so anything the
  // first one cached is still inside its TTL when the second one runs.
  const clock = 0;
  const list = createAllowlist(reader, { now: () => clock, warn: silent });

  state.fail = true;
  assert.equal((await list.lookup("op@gmail.com")).allowed, false);

  // Same instant, so a cached denial would still be live. It must not be.
  state.fail = false;
  assert.equal((await list.lookup("op@gmail.com")).allowed, true);
  assert.equal(state.reads, 2);
});

test("adding writes a normalized entry and drops the cached denial", async () => {
  const { reader, rows } = fakeReader();
  const clock = Date.parse("2026-08-31T10:00:00.000Z");
  const list = createAllowlist(reader, { now: () => clock, warn: silent });

  assert.equal((await list.lookup("New@Gmail.com")).allowed, false);

  const added = await list.add({
    email: " New@Gmail.com ",
    role: "member",
    addedBy: "Boss@Gmail.com",
  });
  assert.deepEqual(added, {
    email: "new@gmail.com",
    role: "member",
    addedBy: "boss@gmail.com",
    addedAt: "2026-08-31T10:00:00.000Z",
  });
  assert.equal(rows.has("new@gmail.com"), true);

  // Not waiting out the TTL: the writing instance invalidates its own cache.
  // The clock never moves in this test, so a surviving cached denial would
  // still be inside its window and would fail here.
  assert.equal((await list.lookup("new@gmail.com")).allowed, true);
});

test("adding rejects a non-email and an unknown role", async () => {
  const { reader } = fakeReader();
  const list = createAllowlist(reader, { warn: silent });

  await assert.rejects(
    () => list.add({ email: "not-an-email", role: "member", addedBy: null }),
    // Bahasa: this message reaches the admin's screen through
    // `describe()` in src/app/admin/actions.ts, which matches the same
    // fragment. If you reword the throw, both move together.
    /bukan alamat email/,
  );
  await assert.rejects(
    () =>
      list.add({
        email: "op@gmail.com",
        // Deliberately outside the union: the value arrives from a form post.
        role: "superuser" as never,
        addedBy: null,
      }),
    /bukan peran yang dikenal/,
  );
});

test("the bootstrap owner cannot be added or removed through the store", async () => {
  const { reader } = fakeReader([entry("op@gmail.com")]);
  const list = createAllowlist(reader, { warn: silent });

  await assert.rejects(
    () =>
      list.add({ email: BOOTSTRAP_OWNER_EMAIL, role: "owner", addedBy: null }),
    /tidak mengubah apa pun/,
  );
  // The dangerous version of this is a delete that reports success and revokes
  // nothing, leaving an admin believing access was withdrawn.
  await assert.rejects(
    () => list.remove(BOOTSTRAP_OWNER_EMAIL.toUpperCase()),
    /tidak bisa dihapus/,
  );
});

test("removing drops the entry and the cached admission", async () => {
  const { reader, rows } = fakeReader([entry("op@gmail.com")]);
  const list = createAllowlist(reader, { warn: silent });

  assert.equal((await list.lookup("op@gmail.com")).allowed, true);
  await list.remove("OP@gmail.com");
  assert.equal(rows.has("op@gmail.com"), false);
  assert.equal((await list.lookup("op@gmail.com")).allowed, false);
});

test("list always includes the bootstrap owner exactly once", async () => {
  const { reader } = fakeReader([
    entry("zed@gmail.com"),
    entry(BOOTSTRAP_OWNER_EMAIL, "member"),
    entry("amy@gmail.com", "admin"),
  ]);
  const list = createAllowlist(reader, { warn: silent });

  const rows = await list.list();
  assert.deepEqual(
    rows.map((r) => r.email),
    ["aisystemtelkom@gmail.com", "amy@gmail.com", "zed@gmail.com"],
  );
  const owner = rows.find((r) => r.email === BOOTSTRAP_OWNER_EMAIL);
  assert.equal(owner?.role, "owner");
});

test("an unrecognised stored role degrades to member and warns", async () => {
  const warnings: string[] = [];
  assert.equal(
    coerceRole("root", "op@gmail.com", (m) => warnings.push(m)),
    "member",
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /not one of/);
  assert.equal(coerceRole("owner", "op@gmail.com", silent), "owner");
});

// --- guard (requireUser / requireAdmin / authorize) -----------------------

function guardFor(
  session: SessionLike,
  seed: AllowlistEntry[] = [],
  options: { fail?: boolean; authDisabled?: boolean } = {},
) {
  const { reader, state } = fakeReader(seed);
  state.fail = options.fail ?? false;
  const list = createAllowlist(reader, { warn: silent });
  return createGuard({
    getSession: async () => session,
    allowlist: () => list,
    authDisabled: () => options.authDisabled ?? false,
    warn: silent,
  });
}

const sessionFor = (email: string): SessionLike => ({
  user: { email, name: "Operator", image: null },
});

test("requireUser returns an allowlisted caller", async () => {
  const guard = guardFor(sessionFor("op@gmail.com"), [
    entry("op@gmail.com", "member"),
  ]);

  const user = await guard.requireUser();
  assert.equal(user.email, "op@gmail.com");
  assert.equal(user.role, "member");
  assert.equal(user.isAdmin, false);
  assert.equal(user.via, "allowlist");
});

test("requireUser throws 401 with no session", async () => {
  const guard = guardFor(null);
  await assert.rejects(() => guard.requireUser(), (error: unknown) => {
    assert.ok(error instanceof AuthorizationError);
    assert.equal(error.status, 401);
    assert.equal(error.reason, "unauthenticated");
    return true;
  });
});

test("requireUser throws 403 for a signed-in stranger", async () => {
  const guard = guardFor(sessionFor("stranger@gmail.com"));
  await assert.rejects(() => guard.requireUser(), (error: unknown) => {
    assert.ok(error instanceof AuthorizationError);
    assert.equal(error.status, 403);
    assert.equal(error.reason, "not-listed");
    return true;
  });
});

test("a session with no email is refused rather than treated as anonymous", async () => {
  const guard = guardFor({ user: { email: null, name: "Nameless" } });
  const result = await guard.authorize();
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "no-email");
});

test("an unreachable store denies an ordinary operator", async () => {
  const guard = guardFor(sessionFor("op@gmail.com"), [entry("op@gmail.com")], {
    fail: true,
  });

  const result = await guard.authorize();
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 403);
  assert.equal(result.ok === false && result.reason, "lookup-failed");
});

test("the bootstrap owner still gets in through requireAdmin when the store is unreachable", async () => {
  // The scenario the hardcoded owner exists for: empty or broken collection,
  // and the only way to repair it is the admin page this call gates.
  const guard = guardFor(sessionFor(BOOTSTRAP_OWNER_EMAIL), [], { fail: true });

  const user = await guard.requireAdmin();
  assert.equal(user.email, BOOTSTRAP_OWNER_EMAIL);
  assert.equal(user.role, "owner");
  assert.equal(user.isAdmin, true);
  assert.equal(user.via, "bootstrap");
});

test("requireAdmin refuses a member and admits an admin", async () => {
  const member = guardFor(sessionFor("op@gmail.com"), [
    entry("op@gmail.com", "member"),
  ]);
  await assert.rejects(() => member.requireAdmin(), (error: unknown) => {
    assert.ok(error instanceof AuthorizationError);
    assert.equal(error.status, 403);
    assert.equal(error.reason, "not-admin");
    return true;
  });

  const admin = guardFor(sessionFor("boss@gmail.com"), [
    entry("boss@gmail.com", "admin"),
  ]);
  assert.equal((await admin.requireAdmin()).isAdmin, true);
});

test("auth-disabled admits anonymously but never as an admin", async () => {
  const guard = guardFor(null, [], { authDisabled: true });

  const user = await guard.requireUser();
  assert.equal(user.via, "auth-disabled");
  assert.equal(user.role, "member");
  assert.equal(user.isAdmin, false);

  // The allowlist must stay un-editable during the bootstrap window, or the
  // one deploy that is briefly open is also the one that can grant access.
  await assert.rejects(() => guard.requireAdmin(), /hanya untuk administrator/);
});

test("isAuthDisabled needs the flag AND an unconfigured OAuth client", async () => {
  assert.equal(isAuthDisabled({ AUTH_DISABLED: "true" }), true);
  assert.equal(isAuthDisabled({}), false);
  assert.equal(isAuthDisabled({ AUTH_DISABLED: "1" }), false);
  assert.equal(isAuthDisabled({ AUTH_DISABLED: "TRUE" }), false);
  // The interlock: once the real client id is mounted the switch is dead, so a
  // forgotten AUTH_DISABLED cannot quietly un-gate a working deployment.
  assert.equal(
    isAuthDisabled({ AUTH_DISABLED: "true", AUTH_GOOGLE_ID: "123.apps" }),
    false,
  );
});

// --- the boundary is IN THE ROUTE, not in proxy ----------------------------
//
// `src/proxy.ts` also refuses an unauthenticated `/api/*` request, and Next's
// own reference says not to trust it: a matcher change, or a refactor that
// moves work to another route, silently removes proxy coverage. These tests
// therefore drive the chat route's own control flow with NO PROXY ANYWHERE,
// which is exactly the request proxy-only coverage misses.
//
// They live in this file rather than beside the route because `pnpm test` runs
// a fixed list of suites. `src/app/api/chat/handler.ts` is written with no
// runtime imports precisely so it loads here under plain `node --test`.

import { createChatHandler } from "../../app/api/chat/handler.ts";
import {
  safeCallbackUrl,
  signInErrorDetail,
  signInErrorMessage,
} from "../../app/signin/query.ts";

/** A POST shaped like the one assistant-ui sends. */
function chatRequest(body = '{"messages":[],"system":"be brief"}'): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

/**
 * The real handler, wired to a real guard over the given session. Only
 * `stream` is a fake, and it records whether it was reached at all: "returned
 * 401" and "never spent the credential" are two different claims and this
 * suite makes both.
 */
function chatHandlerFor(
  session: SessionLike,
  seed: AllowlistEntry[] = [],
  options: { fail?: boolean; authDisabled?: boolean } = {},
) {
  const guard = guardFor(session, seed, options);
  const calls: unknown[] = [];
  const handler = createChatHandler({
    gate: () => guard.apiUser(),
    stream: (body) => {
      calls.push(body);
      return new Response("stream", { status: 200 });
    },
    unreachable: () => new Response("unreachable", { status: 503 }),
  });
  return { handler, calls };
}

test("an unauthenticated POST to the chat route is refused even though proxy never ran", async () => {
  const { handler, calls } = chatHandlerFor(null);
  const request = chatRequest();

  const response = await handler(request);

  assert.equal(response.status, 401);
  // JSON, not a redirect to an HTML sign-in page: an API caller following a
  // 307 to markup gets a confusing 200 full of markup instead of an error.
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  // Deep-equal, not a substring match, so the absence of `detail` is asserted
  // too: a refusal an operator caused carries no deployer half, and a caller
  // that renders one would be showing an empty disclosure on every 401.
  // `src/proxy.ts` hand-copies this exact body, so the two move together.
  assert.deepEqual(await response.json(), {
    error: "unauthenticated",
    message: "Anda belum masuk. Masuk dengan Google untuk melanjutkan.",
  });

  assert.equal(calls.length, 0, "the model must not be reached");
  assert.equal(
    request.bodyUsed,
    false,
    "the gate must run before the body is read",
  );
});

test("a signed-in stranger is refused by the chat route with 403 not-listed", async () => {
  const { handler, calls } = chatHandlerFor(sessionFor("stranger@gmail.com"));

  const response = await handler(chatRequest());

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "not-listed");
  assert.equal(calls.length, 0);
});

test("an unreachable allowlist denies the chat route rather than admitting", async () => {
  // Note the seed: this caller IS on the list. The store just cannot say so,
  // and the route must fail closed rather than fall back to the JWT.
  const { handler, calls } = chatHandlerFor(
    sessionFor("op@gmail.com"),
    [entry("op@gmail.com")],
    { fail: true },
  );

  const response = await handler(chatRequest());

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "lookup-failed");
  assert.equal(calls.length, 0);
});

test("an allowlisted caller reaches the model with the parsed body", async () => {
  const { handler, calls } = chatHandlerFor(sessionFor("op@gmail.com"), [
    entry("op@gmail.com"),
  ]);

  const response = await handler(chatRequest());

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { messages: [], system: "be brief" });
});

test("a malformed chat body is the caller's fault, not the provider's", async () => {
  // Distinguishable from the 503 `unreachable` sends, so a 503 in the log
  // always means the credential or the provider and never a bad request.
  const { handler, calls } = chatHandlerFor(sessionFor("op@gmail.com"), [
    entry("op@gmail.com"),
  ]);

  const response = await handler(chatRequest("{ not json"));

  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("denialResponse carries the guard's own status and reason", async () => {
  assert.equal(
    denialResponse({
      ok: true,
      user: {
        email: "op@gmail.com",
        name: null,
        image: null,
        role: "member",
        isAdmin: false,
        via: "allowlist",
      },
    }),
    null,
  );

  const forbidden = denialResponse({
    ok: false,
    status: 403,
    reason: "not-admin",
    message: "Halaman ini hanya untuk administrator.",
  });
  assert.equal(forbidden?.status, 403);
  assert.equal((await forbidden?.json()).error, "not-admin");
});

test("a refusal keeps the deployer's half out of the operator's sentence", async () => {
  // `lookup-failed` used to read "check the Firestore binding" INSIDE the
  // refusal, so an operator whose only fault was arriving during an outage was
  // told to go and repair a database they have never heard of. The two halves
  // now travel as separate fields: `message` is the sentence they read,
  // `detail` is for whoever deployed the app and is rendered apart from it.
  const guard = guardFor(sessionFor("op@gmail.com"), [entry("op@gmail.com")], {
    fail: true,
  });

  const result = await guard.authorize();
  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.match(result.message, /Daftar izin akses tidak dapat dibaca/);
  assert.doesNotMatch(result.message, /Firestore/);
  assert.match(result.detail ?? "", /Firestore/);

  // Both halves reach a route handler, still apart, so an API caller can show
  // the operator's sentence and log the rest.
  const body = await denialResponse(result)?.json();
  assert.equal(body.message, result.message);
  assert.equal(body.detail, result.detail);

  // And the throwing path carries it too: `src/app/admin/actions.ts` puts
  // `error.message` straight on the screen, so `detail` must not be folded in.
  await assert.rejects(() => guard.requireUser(), (error: unknown) => {
    assert.ok(error instanceof AuthorizationError);
    assert.equal(error.message, result.message);
    assert.equal(error.detail, result.detail);
    return true;
  });
});

test("every refusal an operator reads is Bahasa Indonesia and carries no double hyphen", async () => {
  const messages: string[] = [];
  for (const guard of [
    guardFor(null),
    guardFor({ user: { email: null, name: "Nameless" } }),
    guardFor(sessionFor("stranger@gmail.com")),
    guardFor(sessionFor("op@gmail.com"), [entry("op@gmail.com")], {
      fail: true,
    }),
  ]) {
    const result = await guard.authorize();
    assert.equal(result.ok, false);
    if (!result.ok) messages.push(result.message);
  }
  const member = guardFor(sessionFor("op@gmail.com"), [
    entry("op@gmail.com", "member"),
  ]);
  await assert.rejects(() => member.requireAdmin(), (error: unknown) => {
    assert.ok(error instanceof AuthorizationError);
    messages.push(error.message);
    return true;
  });

  // One per DenialReason, so a new reason with an untranslated message fails
  // this count before anyone has to notice its wording.
  assert.equal(messages.length, 5);
  for (const message of messages) {
    // Not typographic fussiness. The double hyphen stood in for an em dash in
    // exactly the sentence that told an operator to check a Firestore binding,
    // and this asserts the split that removed it has not been undone.
    assert.doesNotMatch(message, /--|\u2014/, message);
    // These are read by Indonesian operators reading Indonesian contracts. A
    // refusal still saying "Sign in" or "allowlist" was never translated.
    assert.doesNotMatch(
      message,
      /\b(sign in|allowlist|admins only|account)\b/i,
      message,
    );
  }
});

// --- the sign-in page's query string --------------------------------------

test("safeCallbackUrl accepts only a same-origin path", () => {
  assert.equal(safeCallbackUrl("/admin"), "/admin");
  assert.equal(safeCallbackUrl("/?a=1&b=2"), "/?a=1&b=2");

  // Every one of these would be an open redirect wearing this app's hostname,
  // which is worth more to a phisher than a redirect from anywhere else.
  assert.equal(safeCallbackUrl("https://evil.example"), "/");
  assert.equal(safeCallbackUrl("//evil.example"), "/");
  assert.equal(safeCallbackUrl("/\\evil.example"), "/");
  assert.equal(safeCallbackUrl("javascript:alert(1)"), "/");
  assert.equal(safeCallbackUrl(""), "/");
  assert.equal(safeCallbackUrl(undefined), "/");
  // A repeated query parameter arrives as an array; only the first is read,
  // so appending a second one does not smuggle a destination past this.
  assert.equal(safeCallbackUrl(["/admin", "https://evil.example"]), "/admin");
  assert.equal(safeCallbackUrl(["https://evil.example", "/admin"]), "/");
});

test("signInErrorMessage explains a code it knows and never swallows one it does not", () => {
  assert.equal(signInErrorMessage(undefined), null);

  // WORDING IS DELIBERATELY NOT ASSERTED HERE. These strings live in
  // `src/app/signin/query.ts`, they are Bahasa Indonesia now, and the
  // deployer's half of a failure (Auth.js codes, environment variable names,
  // the runbook path) has moved out of the sentence into `signInErrorDetail`
  // for a `Detail teknis` disclosure. This test used to match /not on the
  // allowlist/ and /AUTH_GOOGLE_ID/, which pinned the English AND pinned the
  // deployer text into the operator's sentence: it would have failed the
  // translation and argued against the split. What must hold is the
  // behaviour below.
  assert.equal(signInErrorDetail(undefined), null);

  for (const code of ["AccessDenied", "Configuration", "Verification"]) {
    const message = signInErrorMessage(code) ?? "";
    assert.ok(message.length > 0, `${code} must say something`);
    // A code the page recognises earns a written explanation, and the raw
    // code never appears in the sentence the operator reads: it arrives from
    // the query string, so whoever writes the link would otherwise choose the
    // loudest words on the page.
    assert.doesNotMatch(
      message,
      new RegExp(code),
      `${code} must get an explanation, not the raw code`,
    );
  }

  // An unrecognised code stays VISIBLE, in the technical half: it is the only
  // searchable string an operator can quote to whoever deploys this.
  assert.ok((signInErrorMessage("OAuthCallbackError") ?? "").length > 0);
  assert.match(
    signInErrorDetail("OAuthCallbackError") ?? "",
    /OAuthCallbackError/,
  );
});
