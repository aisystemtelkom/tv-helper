/**
 * Cloud Storage allowlist store tests.
 *
 * No GCP credential and no network: `gcsAllowlistReader` takes its token
 * source and its `fetch` as arguments, which is what lets this suite drive the
 * three paths that would otherwise only be exercised in production -- an
 * object that does not exist yet, a corrupt object, and two admins racing.
 *
 * `ALLOWLIST_BUCKET` is read at module load, so it is set before the import
 * below rather than inside a test.
 */

import assert from "node:assert/strict";
import test from "node:test";

process.env.ALLOWLIST_BUCKET ??= "test-bucket";

const { gcsAllowlistReader } = await import("./gcs.ts");

type Call = { url: string; method: string; body: string | null };

/**
 * A fake GCS holding one object. `generation` advances on every accepted
 * write, which is what makes the precondition mean anything: a stale
 * generation is rejected exactly as the real service rejects it.
 */
function fakeGcs(initial: { body?: string; generation?: string } = {}) {
  const state = {
    body: initial.body,
    generation: initial.generation ?? "0",
    calls: [] as Call[],
    /** Runs before a write is evaluated, to simulate another writer landing. */
    beforeWrite: undefined as undefined | (() => void),
  };

  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    state.calls.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : null,
    });

    if (method === "GET") {
      if (state.body === undefined) {
        return new Response("not found", { status: 404 });
      }
      return new Response(state.body, {
        status: 200,
        headers: { "x-goog-generation": state.generation },
      });
    }

    state.beforeWrite?.();
    const expected = new URL(url).searchParams.get("ifGenerationMatch");
    if (expected !== state.generation) {
      return new Response("precondition failed", { status: 412 });
    }
    state.body = String(init?.body ?? "");
    state.generation = String(Number(state.generation) + 1);
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  return {
    state,
    reader: gcsAllowlistReader({
      fetchImpl,
      authorization: async () => "Bearer test",
    }),
  };
}

const doc = (entries: Record<string, unknown>) => JSON.stringify({ entries });

test("a missing object is an empty allowlist, not an error", async () => {
  const { reader } = fakeGcs();
  assert.equal(await reader.get("someone@example.com"), null);
  assert.deepEqual(await reader.list(), []);
});

test("the first write uses generation 0, so it creates only if still absent", async () => {
  const { reader, state } = fakeGcs();
  await reader.put({
    email: "op@example.com",
    role: "member",
    addedBy: "admin@example.com",
    addedAt: "2026-09-02T00:00:00.000Z",
  });
  const write = state.calls.find((c) => c.method === "POST");
  assert.ok(write, "expected a write");
  assert.equal(
    new URL(write.url).searchParams.get("ifGenerationMatch"),
    "0",
    "a create must be conditional on the object still being absent",
  );
  assert.equal((await reader.get("op@example.com"))?.role, "member");
});

test("a corrupt object is refused rather than read as an empty allowlist", async () => {
  // This is the wrong-and-quiet failure this store most needs to avoid:
  // treating unparseable JSON as {} would deny every operator while looking
  // exactly like a store nobody has populated yet.
  const { reader } = fakeGcs({ body: "{not json", generation: "7" });
  await assert.rejects(() => reader.get("op@example.com"), /not valid JSON/);
  await assert.rejects(() => reader.list(), /not valid JSON/);
});

test("a lost generation race retries against the winner's document", async () => {
  const { reader, state } = fakeGcs({
    body: doc({ "first@example.com": { role: "member" } }),
    generation: "1",
  });

  // Another admin lands one write between our read and our write, exactly
  // once. Without the precondition, our write would carry our own read and
  // silently delete their entry.
  let interfered = false;
  state.beforeWrite = () => {
    if (interfered) return;
    interfered = true;
    state.body = doc({
      "first@example.com": { role: "member" },
      "other-admin@example.com": { role: "admin" },
    });
    state.generation = "2";
  };

  await reader.put({
    email: "ours@example.com",
    role: "member",
    addedBy: null,
    addedAt: null,
  });

  const rows = (await reader.list()).map((e) => e.email).sort();
  assert.deepEqual(
    rows,
    ["first@example.com", "other-admin@example.com", "ours@example.com"],
    "the concurrent admin's entry must survive our write",
  );
});

test("a write that keeps losing gives up instead of hanging", async () => {
  const { reader, state } = fakeGcs({ body: doc({}), generation: "1" });
  // Every write loses, forever.
  state.beforeWrite = () => {
    state.generation = String(Number(state.generation) + 1);
  };
  await assert.rejects(
    () =>
      reader.put({
        email: "op@example.com",
        role: "member",
        addedBy: null,
        addedAt: null,
      }),
    /generation races/,
  );
});

test("emails are normalized on read and write", async () => {
  const { reader } = fakeGcs();
  await reader.put({
    email: "  Mixed.Case@Example.COM ",
    role: "admin",
    addedBy: null,
    addedAt: null,
  });
  assert.equal((await reader.get("mixed.case@example.com"))?.role, "admin");
  assert.equal((await reader.get("MIXED.CASE@EXAMPLE.COM"))?.role, "admin");
});

test("remove deletes only the named entry", async () => {
  const { reader } = fakeGcs({
    body: doc({
      "a@example.com": { role: "member" },
      "b@example.com": { role: "admin" },
    }),
    generation: "3",
  });
  await reader.remove("a@example.com");
  assert.equal(await reader.get("a@example.com"), null);
  assert.equal((await reader.get("b@example.com"))?.role, "admin");
});

test("an unrecognised stored role degrades to member, never upward", async () => {
  const { reader } = fakeGcs({
    body: doc({ "op@example.com": { role: "superuser" } }),
    generation: "1",
  });
  assert.equal((await reader.get("op@example.com"))?.role, "member");
});

test("a prototype-shadowing key is refused", async () => {
  // `doc.entries.__proto__ = x` on a plain object does not create an own
  // property, so such an entry would vanish on write and could never be
  // removed. Refuse it rather than store something unremovable.
  const { reader } = fakeGcs();
  await assert.rejects(() => reader.get("__proto__"), /cannot be used/);
  await assert.rejects(() => reader.remove("constructor"), /cannot be used/);
});

test("a non-404 read failure is an error, not an empty allowlist", async () => {
  const fetchImpl = (async () =>
    new Response("nope", {
      status: 503,
      statusText: "Service Unavailable",
    })) as unknown as typeof fetch;
  const reader = gcsAllowlistReader({
    fetchImpl,
    authorization: async () => "Bearer test",
  });
  await assert.rejects(() => reader.list(), /503/);
});
