/**
 * Which project a Cloud Vision request is billed to, read off the request
 * Vision actually receives.
 *
 * No GCP credential and no network: `annotateImage` takes its credential and
 * its `fetch` as arguments, so the `x-goog-user-project` header these tests are
 * about is read straight off a fake.
 *
 * `VISION_ENDPOINT` and `VISION_LOCATION` are read at module load, so they are
 * cleared before the import below rather than inside a test.
 */

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { GoogleAuth, OAuth2Client } from "google-auth-library";

delete process.env.VISION_ENDPOINT;
delete process.env.VISION_LOCATION;

const { annotateImage } = await import("./vision.ts");

/** Every variable `annotateImage` consults ahead of the credential itself. */
const AHEAD_OF_CREDENTIAL = [
  "VISION_QUOTA_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
  "VISION_ACCESS_TOKEN",
];

/** Clear those for one test, set what it asks for, and put them all back. */
function isolateEnv(t: TestContext, set: Record<string, string> = {}) {
  const saved = new Map(AHEAD_OF_CREDENTIAL.map((k) => [k, process.env[k]]));
  for (const key of AHEAD_OF_CREDENTIAL) delete process.env[key];
  Object.assign(process.env, set);
  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

/**
 * A credential that needs no network: a live access token, the quota project
 * `set-quota-project` writes onto a user credential (a service account has
 * none), and the project gcloud's ACTIVE configuration would answer with.
 */
function credential(options: { quotaProjectId?: string; activeProject?: string }) {
  const client = new OAuth2Client();
  client.setCredentials({
    access_token: "test-token",
    expiry_date: Date.now() + 3_600_000,
  });
  if (options.quotaProjectId) client.quotaProjectId = options.quotaProjectId;
  return new GoogleAuth({ authClient: client, projectId: options.activeProject });
}

function fakeVision() {
  const calls: { url: string; headers: Headers }[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return Response.json({ responses: [{}] });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const page = { bytes: new Uint8Array([0]), mediaType: "image/png" };
const options = { feature: "DOCUMENT_TEXT_DETECTION", languageHints: ["id"] };

test("the credential's own quota project outranks gcloud's active project", async (t) => {
  // The failure this pins, on a developer machine on 2026-09-11: ADC carried
  // this app's quota project, gcloud's active project had been switched to an
  // unrelated one, and every capture came back 403 "Caller does not have
  // required permission to use project <other>".
  isolateEnv(t);
  const vision = fakeVision();

  await annotateImage(page, options, {
    auth: credential({
      quotaProjectId: "contoh-quota-project",
      activeProject: "contoh-other-project",
    }),
    fetchImpl: vision.fetchImpl,
  });

  assert.equal(vision.calls.length, 1);
  assert.equal(
    vision.calls[0].headers.get("x-goog-user-project"),
    "contoh-quota-project",
  );
  assert.equal(vision.calls[0].headers.get("authorization"), "Bearer test-token");
});

test("a credential with no quota project still bills the project ADC resolves", async (t) => {
  // A service account's shape, which is Cloud Run's: no quota project on the
  // credential, and the metadata server naming the runtime project.
  isolateEnv(t);
  const vision = fakeVision();

  await annotateImage(page, options, {
    auth: credential({ activeProject: "contoh-runtime-project" }),
    fetchImpl: vision.fetchImpl,
  });

  assert.equal(
    vision.calls[0].headers.get("x-goog-user-project"),
    "contoh-runtime-project",
  );
});

test("VISION_QUOTA_PROJECT still outranks the credential's quota project", async (t) => {
  // An explicit variable is a decision somebody made for this deployment; the
  // credential is a default.
  isolateEnv(t, { VISION_QUOTA_PROJECT: "contoh-explicit-project" });
  const vision = fakeVision();

  await annotateImage(page, options, {
    auth: credential({
      quotaProjectId: "contoh-quota-project",
      activeProject: "contoh-other-project",
    }),
    fetchImpl: vision.fetchImpl,
  });

  assert.equal(
    vision.calls[0].headers.get("x-goog-user-project"),
    "contoh-explicit-project",
  );
});

test("an ADC file's quota_project_id is what the library puts on quotaProjectId", async () => {
  // The fix reads `quotaProjectId` off the loaded credential. This pins that
  // google-auth-library still maps the ADC file's own field onto it, so a
  // library upgrade that stops doing so fails here rather than on a machine.
  const auth = new GoogleAuth({
    credentials: {
      type: "authorized_user",
      client_id: "contoh-client",
      client_secret: "contoh-secret",
      refresh_token: "contoh-refresh",
      quota_project_id: "contoh-quota-project",
    },
  });

  const client = await auth.getClient();
  assert.equal(client.quotaProjectId, "contoh-quota-project");
});
