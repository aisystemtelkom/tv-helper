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
    /is not an email address/,
  );
  await assert.rejects(
    () =>
      list.add({
        email: "op@gmail.com",
        // Deliberately outside the union: the value arrives from a form post.
        role: "superuser" as never,
        addedBy: null,
      }),
    /is not one of/,
  );
});

test("the bootstrap owner cannot be added or removed through the store", async () => {
  const { reader } = fakeReader([entry("op@gmail.com")]);
  const list = createAllowlist(reader, { warn: silent });

  await assert.rejects(
    () =>
      list.add({ email: BOOTSTRAP_OWNER_EMAIL, role: "owner", addedBy: null }),
    /would change nothing/,
  );
  // The dangerous version of this is a delete that reports success and revokes
  // nothing, leaving an admin believing access was withdrawn.
  await assert.rejects(
    () => list.remove(BOOTSTRAP_OWNER_EMAIL.toUpperCase()),
    /cannot be removed/,
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
  await assert.rejects(() => guard.requireAdmin(), /admins only/);
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
