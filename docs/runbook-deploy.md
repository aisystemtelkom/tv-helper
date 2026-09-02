# Deploy runbook: Cloud Run, Jakarta

What this deploys: the tv-helper container on Cloud Run in `asia-southeast2`,
with Google sign-in and a Firestore allowlist. Cloud Run is the only GCP compute
that bills nothing while idle, which is the normal state of an internal tool
used by a handful of operators, and Jakarta disposes of the data residency
question rather than leaving it open for a state telco.

Read the four traps first. Each one costs an afternoon if you meet it as a
symptom instead of as a step.

**Follow the steps in order.** Prerequisites, then 1 build, 2 secrets,
3 allowlist, 4 bootstrap deploy, 5 OAuth client, 6 real deploy, then
"Post-deploy verification", which is not optional: it is the only thing
standing between a revision that looks deployed and one that works.

---

## Trap 1: the OAuth redirect URI is circular

The Google OAuth client needs the exact redirect URI
`https://<service-url>/api/auth/callback/google`. That URL does not exist until
Cloud Run has created the service, and the app cannot authenticate anyone until
the client exists. Read as a checklist it is a deadlock, and the first time you
hit it, it looks like a broken deploy rather than an ordering problem.

**Resolution: deploy once with auth disabled to mint the URL.** Step 4 below
does exactly that. Two things make it safe:

- The bootstrap deploy is `--no-allow-unauthenticated`, so only a caller with an
  IAM token can reach it at all. Cloud Run assigns the URL when the service is
  created, not when it first serves a public request, so this is enough.
- `AUTH_DISABLED=true` is honored **only while no `AUTH_GOOGLE_ID` is set**
  (`isAuthDisabled` in `src/lib/auth/guard.ts`). That interlock is the point: it
  means a forgotten `AUTH_DISABLED=true` cannot quietly un-gate the real
  deployment, because mounting the OAuth client id kills the switch. While the
  switch is live, callers are admitted as an anonymous `member` and never as an
  admin, so the allowlist itself stays un-editable during the window.

Verified locally: with `AUTH_DISABLED=true` and no client id, `GET /` returns
200; add `AUTH_GOOGLE_ID` and the same request returns 307 to sign-in.

## Trap 2: the consent screen must be External, and Testing mode expires people

Operators sign in with ordinary gmail accounts, not Workspace accounts, so the
OAuth consent screen has to be **External**. That has two consequences worth
knowing before an operator is locked out mid-week:

- **Testing mode caps at 100 users** and every one of them must be listed
  individually as a test user. That is a second list to keep in sync with the
  Firestore allowlist, and forgetting it produces a Google-side "app has not
  completed verification" error that looks nothing like an allowlist problem.
- **Testing mode expires refresh tokens after seven days.** An operator who
  signed in last Tuesday is silently signed out this Tuesday.

So publish the consent screen to **Production**. The scopes this app requests are
`openid email profile` only (set explicitly in `src/lib/auth/config.ts`), which
are non-sensitive and should not require Google's verification review. Confirm
that during setup rather than discovering it when someone cannot log in.

## Trap 3: the standalone build does not copy `public/` or `.next/static`

Next's own output reference says so: the minimal `server.js` "does not copy the
`public` or `.next/static` folders by default as these should ideally be handled
by a CDN instead".

Verified in this repo, not taken on faith. After `pnpm build`:

```
$ ls .next/standalone/
node_modules/  package.json  server.js
$ ls .next/standalone/public
ls: cannot access '.next/standalone/public': No such file or directory
```

The `Dockerfile` therefore copies both explicitly:

```dockerfile
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public       ./public
```

**Why this matters more here than in a normal Next app.** This project vendors
its OCR runtime into `public/tesseract` (`pnpm vendor:ocr`, run at `prebuild`):
the tesseract worker, six wasm cores, and `ind`/`eng` traineddata, about 15-20MB.
They are served from this app on purpose, because the library's default fetches
them from a CDN and that would put an unapproved third party in the browser's
request path.

Forget the `public/` copy and the app still boots, still renders, still signs
people in. Only OCR breaks, in production, with a 404 in a Web Worker that no
one is watching. `next dev` serves the same files off disk and looks perfect.
That is the wrong-and-quiet failure shape this project is organised against,
which is why it gets a numbered trap rather than a line in a Dockerfile.

Verified end to end **from inside the running container**, 2026-09-01:

```
GET /tesseract/ind.traineddata.gz -> 200  1194182 bytes
Cache-Control: public, max-age=604800, must-revalidate
```

(`next.config.ts` sets that header. Deliberately not `immutable`: these
filenames carry no content hash, so `immutable` would pin every browser to the
wasm it first saw and a tesseract upgrade would reach nobody, silently.)

**The `.next/static` copy carries three more things that are new and easy to
miss**, because none of them is reachable until an operator actually drops a
PDF on the page. A curl of `/` will not touch any of them:

| Asset | Served as | What breaks without it |
| --- | --- | --- |
| the render/OCR Web Worker | `/_next/static/chunks/turbopack-worker-*.js` plus its three dependency chunks | ingest never starts |
| the pdf.js worker | `/_next/static/media/pdf.worker.min.*.mjs` | PDFs do not parse |
| the tesseract runtime | `/tesseract/worker.min.js`, `/tesseract/tesseract-core-*-lstm.wasm.js`, `/tesseract/ind.traineddata.gz` | OCR does not start |

All seven were observed returning 200 from the container during a real ingest
(see "Post-deploy verification", check 7).

**The tesseract core is chosen at runtime by CPU feature detection**, so a
browser with relaxed-SIMD asks for `tesseract-core-relaxedsimd-lstm.wasm.js`
and one without asks for the plain `tesseract-core-lstm.wasm.js`. An image that
shipped only the variant the build machine favours would pass every check its
builder ran and 404 on someone else's laptop. The `Dockerfile`'s runner stage
therefore asserts all three OEM 1 cores, both their `.wasm` and `.wasm.js`
halves, `worker.min.js`, and both traineddata files -- nine files, and a
missing one fails `docker build` by name. Negative-tested on 2026-09-01 by
deleting `tesseract-core-relaxedsimd-lstm.wasm` before the check and watching
the build fail with that filename in the message.

One curiosity, benign, so that nobody re-investigates it: the build also emits
`/_next/static/media/pipeline.worker.*.ts`, the raw TypeScript source, as a
static asset. It is served with `Content-Type: video/mp2t` and would indeed be
unusable as a worker. **Nothing requests it.** Turbopack defines the module
that holds that URL and no chunk ever requires it; the real worker is the
compiled `turbopack-worker-*.js` above, confirmed by watching the network
during an ingest. It is dead weight in the image, not a broken worker.

## Trap 4: the traced `node_modules` is incomplete, and only a container shows it

**Found by building the image, 2026-09-01. Before the fix, the image built
clean, pushed clean, and the container died on the first line of
`node server.js`:**

```
Error: Cannot find module
  '/app/node_modules/.pnpm/next@16.3.1_.../node_modules/@swc/helpers/esm/_interop_require_default.js'
```

`next/dist/shared/lib/constants.js` does
`require("@swc/helpers/_/_interop_require_default")`. That package's `exports`
map lists its conditions in the order `module-sync`, `webpack`, `import`,
`default`, where the first three resolve to `esm/*.js` and only `default`
resolves to `cjs/*.cjs`.

- **Next's file tracer** resolves it with the `require` conditions, matches
  `default`, and copies `cjs/_interop_require_default.cjs`.
- **Node 24 at runtime** honours `module-sync` (it can `require()` ESM
  synchronously), matches the *first* condition, and asks for
  `esm/_interop_require_default.js` -- which the tracer therefore never copied.

The tracer and the runtime read the same `exports` map and disagree. The
`Dockerfile` repairs it by copying the full `@swc/helpers` over the traced
partial one, version-agnostically, and fails the build loudly if the glob ever
stops matching.

**The part that makes this a trap rather than a bug: `node
.next/standalone/server.js` run in place DOES NOT REPRODUCE IT.** The standalone
tree sits inside the project, so Node's resolution walks up into the real
`node_modules` and silently finds the missing file there. It starts, it serves,
it looks like proof. The failure only appears where `/app` is the whole world:
this image, and Cloud Run.

> **So: an unbuilt Dockerfile is not a verified one, and neither is one you only
> smoke-tested by running the standalone directory.** Run the container.

`@swc/helpers` is currently the only package in the traced tree whose `exports`
mention `module-sync`, which is why the repair is targeted. Re-check after any
Next or pnpm upgrade:

```bash
grep -rl module-sync .next/standalone/node_modules/.pnpm/*/node_modules/*/package.json
```

The runner stage now ends with `RUN node -e "require('next/dist/server/next')"`
plus asset existence checks, so a regression fails `docker build` rather than
Cloud Run's first request.

---

## Prerequisites

```bash
PROJECT_ID=<your-project>
REGION=asia-southeast2
SERVICE=tv-helper
REPO=tv-helper

gcloud config set project "$PROJECT_ID"

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com

gcloud artifacts repositories create "$REPO" \
  --repository-format=docker --location="$REGION"
```

Create the Firestore **default** database in `asia-southeast2`, Native mode.
One collection, `allowlist`, is all this app writes. Nothing else is persisted
server-side: documents, crops and runs stay in the browser's IndexedDB, which is
the single largest cost avoidance in this design (no bucket, no egress on 13MB
PDFs, no lifecycle policy).

A dedicated runtime service account, least privilege:

```bash
SA="tv-helper-run@${PROJECT_ID}.iam.gserviceaccount.com"
gcloud iam service-accounts create tv-helper-run

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA" --role=roles/datastore.user
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
```

Firestore is reached through this account and Application Default Credentials.
No key file is downloaded, and nothing in `src/lib/auth/firestore.ts` reads a
credential itself.

## Step 1: build the image

```bash
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:$(git rev-parse --short HEAD)"
gcloud auth configure-docker "${REGION}-docker.pkg.dev"

docker build -t "$IMAGE" .
docker push "$IMAGE"
```

**On a Mac (darwin-arm64), that command builds an arm64 image and Cloud Run
serves amd64 only.** The push succeeds and the revision then fails to start,
which reads as an application crash rather than an architecture mismatch. Build
for the target explicitly:

```bash
docker buildx build --platform linux/amd64 -t "$IMAGE" --push .
```

Emulated amd64 on Apple silicon runs `next build` slowly but correctly. If that
is too slow, hand the build to Cloud Build instead, which is amd64 natively:

```bash
gcloud builds submit --tag "$IMAGE" .
```

The `Dockerfile` pins no `--platform` on any `FROM`, so a plain `docker build`
on either machine produces a working image for **that** machine, which is what
you want for local testing and not what you want for Cloud Run.

**arm64 does build, and this was measured rather than assumed.** A teammate on
a Mac needs a local image to test against, and that is the reverse of the Cloud
Run case: they want an arm64 image for `docker run` and an amd64 one to push.

```bash
docker buildx build --platform linux/arm64 -t tv-helper:arm64 --load .
```

Verified on 2026-09-01 by running exactly that on an amd64 host under QEMU
emulation. Every stage completes, including `pnpm install`, `pnpm build`, the
health-invariant assertion, the `@swc/helpers` repair of Trap 4 and the runner
stage's `require('next/dist/server/next')` load check.
`docker image inspect --format '{{.Os}}/{{.Architecture}}'` reports
`linux/arm64`, and **it was then booted, not merely built**: run gated
(`AUTH_GOOGLE_ID` set), it passes post-deploy checks 2 through 6 with results
byte-identical to the amd64 image -- 307 to `/signin` on `/`, 401 JSON on
`/api/chat` and `/api/propose`, and the same 1,194,182-byte
`ind.traineddata.gz`. Nothing in the image is architecture-pinned --
`node:24-bookworm-slim` is multi-arch, and Next's native SWC binary is selected
by pnpm per platform.

Two caveats a Mac user should have before they start. Emulated, the build takes
roughly fifteen to twenty times as long as native, almost all of it in
`pnpm install` and `pnpm build`; on a Mac the arm64 build is native and fast,
and it is the **amd64** one that will be slow. And an arm64 image is for local
testing only: pushing one to Artifact Registry and deploying it produces a
revision that fails to start with no application log, which is the first row of
the troubleshooting table.

**Run the container before you push it.** Building is not verifying: Trap 4 was
an image that built and pushed clean and then died at boot. In bootstrap mode it
needs no credential at all:

```bash
docker run --rm -d --name tvh -p 8080:8080 -e AUTH_DISABLED=true "$IMAGE"
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/health           # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/                     # 200
curl -sI http://localhost:8080/tesseract/ind.traineddata.gz | head -1               # 200
docker rm -f tvh
```

**That container is in BOOTSTRAP mode, and two of the post-deploy checks read
differently there.** `AUTH_DISABLED=true` is exactly the switch step 4 uses, so
`/` answers 200 rather than 307 and `/api/chat` gets past the gate and fails on
the missing Gemini key with a 503. Neither is a fault; both are the flag doing
its job. Run the gated checks against a second container that has the interlock
tripped, which needs no real credential because nothing verifies these values
until someone actually signs in:

```bash
docker run --rm -d --name tvh-gated -p 8081:8080 \
  -e AUTH_GOOGLE_ID=not-a-real-client.apps.googleusercontent.com \
  -e AUTH_SECRET="$(openssl rand -base64 32)" "$IMAGE"
```

Then run "Post-deploy verification" below with `SERVICE_URL=http://localhost:8081`
before you push anything. Checks 0 and 1 are Cloud Run state and have no local
meaning; check 8 needs a real OAuth client. **Checks 2 to 6 all pass locally
against the gated container**, and finding a problem here costs a minute instead
of a revision. Then `docker rm -f tvh-gated`.

Both containers are worth running. The bootstrap one is what step 4 actually
deploys, and the gated one is what step 6 does; a check that passes in one mode
proves nothing about the other, which is the whole reason this reads as two
blocks instead of one.

**Check 7, the browser one, is easiest against the BOOTSTRAP container** and is
worth doing before a push rather than after. It needs a browser and a real PDF
rather than curl, and it is the only check that exercises the Web Worker, the
pdf.js worker and the tesseract wasm -- none of which any curl above touches.
Bootstrap mode has no sign-in step in the way, so open `http://localhost:8080`
with DevTools and drop a bundle on step 1.

**What has actually been executed, and what has not.** Kept honest on purpose,
because this project has been burned by build-output inspection standing in for
a real run.

*Verified by curl against a running container, 2026-09-01, on both
`linux/amd64` and `linux/arm64` (Docker 29.2.1, images built from this tree),
with byte-identical results on the two architectures:* the container boots;
`/api/health` returns `{"status":"ok"}` with no credential, on GET and on HEAD,
with `Cache-Control: no-store`, and it stays 200 **even with `AUTH_GOOGLE_ID`
set**, which is the property the startup probe depends on; `/` returns 200 in
bootstrap mode and 307 to `/signin?callbackUrl=%2F` once `AUTH_GOOGLE_ID` is
set; `POST /api/chat` and `POST /api/propose` both return 401 with a JSON body
and no markup; `/tesseract/ind.traineddata.gz` serves exactly 1,194,182 bytes
with its `Cache-Control`, and all six other vendored OCR assets return 200; the
served HTML of `/` and `/signin` contains no absolute URL at all; and the two
worker assets serve from the image --
`/_next/static/chunks/turbopack-worker-*.js` (200) and
`/_next/static/media/pdf.worker.min.*.mjs` (200, 1,262,398 bytes).

*Verified by building, 2026-09-01:* a full `docker build --no-cache` for
`linux/amd64`, and a `buildx --platform linux/arm64` build under QEMU, each
running every stage including the health-invariant assertion, the
`@swc/helpers` repair of Trap 4 and the runner's
`require('next/dist/server/next')` load check. **The arm64 image was then
booted, not merely built**, and passes checks 2 to 6 identically.

*Verified by deliberately breaking it, 2026-09-01:* the `Dockerfile`'s health
assertion was negative-tested three ways -- dropping `api/health` from the
proxy matcher, adding an auth-guard import to the health route, and deleting
the route file. Each fails `docker build` with its own named message. An
assertion nobody has watched fail is not known to work.

*Observed once, in a browser, and NOT re-run since:* a real 27-page client scan
ingested end to end against the container, with the Web Worker, the pdf.js
worker and the tesseract assets all loading from this app and every request
going to the container's own origin. That is the origin of the two application
defects recorded under check 7. It is a single manual session rather than a
repeatable command, so treat it as evidence that the assets wire up, not as a
standing guarantee -- re-run check 7 yourself.

*NOT verified, and nobody should say otherwise until it is:* an actual
`docker push`, an actual Cloud Run revision, a real Google OAuth round trip,
Firestore reached through a real service account, and every `gcloud` command
in steps 2 to 6, which were checked for flag validity against
`gcloud version 565.0.0` but never executed.

## Step 2: secrets

Three secrets, mounted from Secret Manager, never baked into the image and never
set as plain Cloud Run environment variables.

```bash
# The Gemini key. Same value as GOOGLE_GENERATIVE_AI_API_KEY in .env.local.
printf %s "$GEMINI_KEY" | gcloud secrets create gemini-api-key --data-file=-

# Auth.js JWT signing key. Rotating it invalidates every live session.
openssl rand -base64 32 | gcloud secrets create auth-secret --data-file=-
```

The OAuth client secret does not exist yet. That is Trap 1; it arrives in
step 5.

## Step 3: create the Firestore allowlist collection

You can leave it empty. `aisystemtelkom@gmail.com` is hardcoded as the bootstrap
owner in `src/lib/auth/allowlist.ts` and is admitted **even when Firestore is
empty or unreachable**, checked before the store is consulted so that a hung
Firestore call cannot delay or deny it either.

That rule looks like a smell and it is the only thing standing between an empty
collection (or a mis-scoped IAM binding, or a Firestore outage) and the owner
being locked out of the very admin page that would fix it. Without it the only
way back in is a redeploy. Do not remove it.

Everyone else is a document in `allowlist`, id = lowercased email:

| Field | Type | Meaning |
| --- | --- | --- |
| `role` | string | `owner`, `admin`, or `member`. Anything else degrades to `member` with a warning in the log. |
| `addedBy` | string / null | Email of the admin who added the row. |
| `addedAt` | string / null | ISO 8601. A `Timestamp` typed by hand in the console is also accepted. |

Add rows through `/admin` rather than the console once you are in.

## Step 4: the bootstrap deploy, to mint the URL

```bash
gcloud run deploy "$SERVICE" \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$SA" \
  --no-allow-unauthenticated \
  --set-env-vars=AUTH_DISABLED=true \
  --memory=512Mi --min-instances=0 --port=8080 \
  --startup-probe=httpGet.path=/api/health,httpGet.port=8080,timeoutSeconds=5,periodSeconds=5,failureThreshold=6

SERVICE_URL=$(gcloud run services describe "$SERVICE" --region="$REGION" \
  --format='value(status.url)')
echo "$SERVICE_URL"
```

`--min-instances=0` is what makes idle free; do not raise it to paper over a
cold start.

### The startup probe, and why it points where it does

`--startup-probe` is optional -- Cloud Run's default is a TCP connect to
`$PORT`, which passes the moment the socket is open. The HTTP probe is better
because it waits until the Node process can actually serve a request, so a
container that binds the port and then dies during module initialisation is
caught as a failed revision instead of as 500s to the first operators.

**It must point at `/api/health` and nothing else**, and that is the whole
reason `src/app/api/health/route.ts` exists:

- The probe carries **no session cookie**. Every other path either redirects to
  `/signin` (307) or answers 401, and Cloud Run treats anything outside 200-399
  as a failed probe. Point the probe at `/` on a real deploy and the revision
  never goes healthy, while the app itself is working perfectly.
- `/api/health` is excluded from the proxy matcher in `src/proxy.ts` and is the
  one route that deliberately does not call `requireApiUser()`. Those two facts
  are load-bearing together; the route's own header says so.
- It touches **neither Firestore nor Gemini** on purpose. A probe that checked
  its dependencies would turn a Firestore blip or a Gemini quota error into a
  restart loop, which is strictly worse than the fault it was reporting: the
  app degrades gracefully for both, but not for being killed.

`--liveness-probe` takes the same syntax and is deliberately **not** used here.
A liveness probe restarts the container when it fails, and on a service that
already scales to zero the upside is small while the downside -- killing an
instance in the middle of an operator's run -- is not. Add one only with a
reason.

`--startup-probe=""` removes it again.

## Step 5: create the OAuth client against that URL

In the Google Cloud console, APIs & Services:

1. **OAuth consent screen**: User Type **External** (see Trap 2). App name
   `tv-helper`, support email, developer email. Scopes: `openid`, `email`,
   `profile`. Publish to **Production**.
2. **Credentials -> Create credentials -> OAuth client ID -> Web application**.
   - Authorized JavaScript origins: `$SERVICE_URL`
   - Authorized redirect URI: `$SERVICE_URL/api/auth/callback/google`

   The redirect URI must match exactly, including scheme and no trailing slash.
   A mismatch produces Google's `redirect_uri_mismatch`, which names the URI it
   received, so read the error rather than guessing.

Store the client secret:

```bash
printf %s "$OAUTH_CLIENT_SECRET" | gcloud secrets create auth-google-secret --data-file=-
```

## Step 6: the real deploy

```bash
gcloud run deploy "$SERVICE" \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$SA" \
  --allow-unauthenticated \
  --memory=512Mi --min-instances=0 --port=8080 \
  --startup-probe=httpGet.path=/api/health,httpGet.port=8080,timeoutSeconds=5,periodSeconds=5,failureThreshold=6 \
  --set-env-vars="AUTH_URL=${SERVICE_URL},AUTH_GOOGLE_ID=${OAUTH_CLIENT_ID}" \
  --set-secrets="AUTH_SECRET=auth-secret:latest,AUTH_GOOGLE_SECRET=auth-google-secret:latest,GOOGLE_GENERATIVE_AI_API_KEY=gemini-api-key:latest"
```

**`--set-env-vars` on its own is what drops `AUTH_DISABLED` from step 4.** Do
not add `--clear-env-vars` alongside it: gcloud puts them in a mutually
exclusive group and rejects the command outright, at the exact step that closes
the bootstrap window. From `gcloud run deploy --help`:

> At most one of these can be specified:
> `--clear-env-vars` [...] `--set-env-vars=[KEY=VALUE,...]` List of key-value
> pairs to set as environment variables. **All existing environment variables
> will be removed first.**

So `--set-env-vars` already replaces the whole set, which is exactly the intent:
the deployed revision ends up with `AUTH_URL` and `AUTH_GOOGLE_ID` and nothing
else. The interlock would neutralise a leftover `AUTH_DISABLED` anyway once
`AUTH_GOOGLE_ID` is set, but leaving a dead switch in the service config invites
someone to "clean up" the wrong half of it later.

(`--set-secrets` is a separate group and is unaffected. If you ever need to keep
some existing variables, the combination that *is* legal is
`--remove-env-vars=AUTH_DISABLED --update-env-vars="..."`.)

Confirm the flag landed, rather than assuming it:

```bash
gcloud run services describe "$SERVICE" --region="$REGION" \
  --format='value(spec.template.spec.containers[0].env)'
```

`AUTH_DISABLED` must not appear.

`--allow-unauthenticated` at the IAM layer is correct here, not a shortcut:
operators signing in with ordinary gmail accounts cannot present IAM tokens, so
all gating is app-level. Identity-Aware Proxy would move it to the edge and
requires a load balancer at roughly $18/month, which is more than everything
else in this design combined.

Then sign in as `aisystemtelkom@gmail.com`, open `/admin`, and add the
operators.

---

## Environment variables

| Variable | Where from | Required | Notes |
| --- | --- | --- | --- |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Secret Manager | yes | Gemini. The app has no local fallback. |
| `AUTH_SECRET` | Secret Manager | yes | Signs the session JWT. Rotating it signs everyone out. |
| `AUTH_GOOGLE_ID` | env | yes | OAuth client id. Also the interlock that disables `AUTH_DISABLED`. |
| `AUTH_GOOGLE_SECRET` | Secret Manager | yes | OAuth client secret. |
| `AUTH_URL` | env | recommended | The canonical service URL. `trustHost: true` derives it from forwarded headers otherwise. |
| `AUTH_DISABLED` | env | no | `"true"` only, and only for the step 4 bootstrap deploy. Ignored once `AUTH_GOOGLE_ID` is set. |
| `ALLOWLIST_COLLECTION` | env | no | Defaults to `allowlist`. |
| `ALLOWLIST_TIMEOUT_MS` | env | no | Defaults to 5000. Ceiling on one Firestore read. |
| `MODEL_ID` | env | no | Defaults to `gemini-3.5-flash`. Must be vision-capable. |
| `GEMINI_MEDIA_RESOLUTION`, `GEMINI_THINKING_LEVEL`, `GEMINI_MAX_OUTPUT_TOKENS` | env | no | Cost levers. See AGENTS.md. |
| `PORT`, `HOSTNAME` | container | no | The `Dockerfile` sets 8080 and 0.0.0.0, which is what Cloud Run requires. Do not override them in the service config. |

**A blank value is a chosen value, not a default.** Every optional setting is
applied with `??`, which falls back on `undefined` but not on `""`. Setting
`GEMINI_THINKING_LEVEL` to an empty string in the Cloud Run config sends an
empty thinking level to Gemini rather than restoring `low`, and `MODEL_ID=`
asks for a model with no name. To restore a default, REMOVE the variable
(`--remove-env-vars=NAME`) rather than blanking it. `.env.example` keeps every
optional variable commented out for the same reason.

**`next-auth` is pinned to the exact prerelease `5.0.0-beta.32`.** There is no
stable v5: as of 2026-09-01 `npm view next-auth dist-tags` reports
`latest 4.24.15` and `beta 5.0.0-beta.32`. So `pnpm up next-auth` is a
*downgrade* to a 4.x API this code does not compile against, and `^5.0.0-beta.32`
is not a pin because it also matches every later beta in a line that ships
breaking changes between them. The full note is in `src/lib/auth/index.ts`,
where someone about to bump it will actually be looking.

For local development, copy `.env.example` to `.env.local` and fill it in. It
lists all four `AUTH_*` variables with empty values, so a fresh clone can see
what is missing instead of reaching a sign-in page that cannot complete.

A separate OAuth client with `http://localhost:3000/api/auth/callback/google` as
its redirect URI is the usual way to do this. Firestore locally needs
`gcloud auth application-default login`; without it every lookup returns
`lookup-failed` and only the bootstrap owner gets in, which is a fair local
simulation of an outage.

---

## How authorization actually works, and where it does not yet

**The boundary is `requireUser()` / `requireAdmin()` in
`src/lib/auth/require-user.ts`, not `src/proxy.ts`.** Next 16's own reference
says why:

> A matcher change or a refactor that moves a Server Function to a different
> route can silently remove Proxy coverage. Always verify authentication and
> authorization inside each Server Function rather than relying on Proxy alone.

The same page also warns that proxy "is meant to be invoked separately of your
render code and in optimized cases deployed to your CDN [...] you should not
attempt relying on shared modules or globals", which is why the 60-second
allowlist cache lives in the guard and not in proxy: module state there is
unreliable or simply absent.

So `src/proxy.ts` verifies the session JWT signature and nothing else, turning
"not signed in" into a redirect (or a 401 for `/api/*`). It never reads
Firestore. Its matcher is negative so it does not gate `_next/static`,
`_next/image`, `favicon.ico`, `/tesseract/`, `/api/auth`, `/api/health` or
`/signin`.

**Every route that touches a run now calls the guard itself.** As of
2026-09-01:

| Entry point | Call | Denial |
| --- | --- | --- |
| `src/app/page.tsx` | `authorize()` | redirect to `/signin`, or a sentence for a signed-in stranger |
| `src/app/api/chat/route.ts` | `requireApiUser()` | 401 / 403 JSON |
| `src/app/api/propose/route.ts` | `requireApiUser()` | 401 / 403 JSON |
| `src/app/admin/page.tsx` | `authorize()` then `isAdmin` | a sentence, rendered in place |
| `src/app/admin/actions.ts` | `requireAdmin()` per action | the thrown message, shown in the form |
| `src/app/api/health/route.ts` | **none, deliberately** | never denies; see below |

**`/api/health` is the one intentional exception and it is worth understanding
before someone "fixes" it.** A platform health probe arrives with no session
cookie, so a gated probe is a 401, and Cloud Run reads anything outside 200-399
as a failed probe. The result is a service that works for every real user while
the platform keeps restarting it. So that route skips the guard and the matcher
skips that route, and each half carries a comment naming the other. It returns
`{"status":"ok"}` and nothing else -- no build id, no environment, no
hostname -- because it is reachable without credentials. It touches neither
Firestore nor the model on purpose: a probe that checked its dependencies would
convert a Firestore blip into a restart loop.

Anything added later needs one line:

```ts
// server component or Server Function
import { requireUser } from "@/lib/auth/require-user";
const user = await requireUser();          // throws AuthorizationError

// route handler
import { requireApiUser } from "@/lib/auth/require-user";
const gate = await requireApiUser();
if (gate.response) return gate.response;   // 401 or 403 JSON
```

`src/lib/auth/auth.test.mts` holds the regression test for this: it drives the
real chat handler through a real guard with **no proxy anywhere** and asserts
an anonymous POST gets 401, that the model is never reached, and that the
request body is never even read. Deleting the gate from the route fails three
tests. Do not "de-duplicate" the guard call back into proxy to make them pass.

Two things proxy structurally could not do here, worth knowing before someone
proposes exactly that:

- Proxy verifies a JWT signature. It never reads Firestore, so it cannot tell a
  currently-allowlisted operator from one removed this morning who still holds a
  valid twelve-hour token. Only the guard asks that question.
- A Server Function is a POST to whatever route it is used from, so no matcher
  reliably covers it. `src/app/admin/actions.ts` is gated by its own
  `requireAdmin()` calls, not by the matcher that happens to cover `/admin`.

**The sign-in page is ours, and that is a constraint, not a preference.**
Auth.js's built-in sign-in page renders each provider's logo from
`https://authjs.dev/img/providers/<id>.svg`; the host is hardcoded in
`@auth/core/lib/pages/signin.js` and the bundled Google provider sets only
`brandColor`, so nothing overrides it. That is a third party in the request path
of a page this app serves, which is the same objection that ruled out Firebase
Auth. `pages.signIn` and `pages.error` in `src/lib/auth/config.ts` both point at
`src/app/signin/page.tsx`, which has no external reference of any kind. Check 5
under "Verifying a deploy" has to pass on `/signin` too, not only on the app.

**Revocation lag is a designed property, not a bug.** JWT sessions mean removing
someone from the allowlist does not by itself end their live session. Rather
than papering over that with a short expiry, the allowlist is cached in server
memory for 60 seconds and re-checked on every request that matters, so
revocation lands within a minute at a cost of one Firestore read per minute per
instance instead of one per request. Additions have the same lag in the other
direction. The instance that performs the write invalidates its own cache
immediately; other instances wait out the TTL.

A login costs one Firestore read against a free-tier allowance of 50,000 per day.

---

## Cost inventory

| Piece | Purpose | Expected cost |
| --- | --- | --- |
| Cloud Run, `asia-southeast2` | the app, scaling to zero | within free tier |
| Artifact Registry | container image, 533MB as `docker images` reports it (measured 2026-09-01); the layers the registry stores are compressed and smaller | about $0.05/month |
| Firestore, default database | the allowlist, nothing else | free tier |
| Secret Manager | three secrets | free at three |
| IndexedDB, in the browser | every document, crop, and run | free |

Two options rejected on cost: Cloud SQL, roughly $9/month and never scales to
zero; Identity-Aware Proxy, roughly $18/month for the load balancer it requires.
Both are the obvious-looking answers to "database" and "auth" respectively.

---

## What the first real deploy actually hit (2026-09-02)

The steps above were written before anyone ran them against
`gen-lang-client-0956394022` ("AI for TV"). Four of them did not survive contact.
Recorded here rather than edited into the steps, because the steps are still
right for a project where you hold Owner, and this section is what to read when
you do not.

### Cloud Build is unusable from at least one Windows machine

`gcloud builds submit` hung for a full ten minutes and **registered no build at
all** -- `gcloud builds list` returned "Listed 0 items" both regionally and
globally, so nothing was queued, throttled, or failing. `--async`, which should
return the moment the upload finishes, hung identically. One attempt exited with
a bare gcloud crash footer ("please run the following command: gcloud
feedback") and no cause.

Do not debug this from the app side; nothing about the repo is involved. Build
locally and push straight to Artifact Registry:

```bash
gcloud auth configure-docker asia-southeast2-docker.pkg.dev --quiet
IMAGE=asia-southeast2-docker.pkg.dev/$PROJECT/tv-helper/tv-helper:$(git rev-parse --short HEAD)
docker build --platform linux/amd64 -t "$IMAGE" .   # --platform is REQUIRED on arm64
docker push "$IMAGE"
```

`--platform linux/amd64` is not optional on an Apple Silicon machine: Cloud Run
runs amd64, and an arm64 image deploys successfully and then crash-loops with an
exec-format error that reads like a broken entrypoint.

### `roles/editor` cannot create the Firestore database

Test what you hold before believing a role name:

```bash
curl -s -X POST \
  "https://cloudresourcemanager.googleapis.com/v1/projects/$PROJECT:testIamPermissions" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -d '{"permissions":["datastore.databases.create","datastore.entities.create","secretmanager.versions.access"]}'
```

On this project, as Editor, that returns `datastore.entities.create` and
withholds the other two. So Editor can **read and write allowlist documents but
cannot create the database that holds them**. Creating it is a one-time Owner
action:

```bash
gcloud firestore databases create --location=asia-southeast2 --type=firestore-native
```

**The app does not wait for it.** `BOOTSTRAP_OWNER_EMAIL` in
`src/lib/auth/allowlist.ts` short-circuits before the store is consulted, so the
bootstrap owner signs in and gets `owner` against a project with no Firestore
database at all. Everyone else gets a clean `lookup-failed` deny. That is the
designed behaviour and it is what makes a partial deployment useful: one person
can drive the whole app while the database is still pending.

### Editor cannot read secret payloads either, so Step 2 does not apply

`secretmanager.versions.access` is deliberately excluded from `roles/editor` by
Google. The consequence is easy to get backwards: it is **not** fixed by running
as a different service account, because the default compute service account
carries Editor too. Without an Owner to grant `roles/secretmanager.secretAccessor`,
Secret Manager cannot be read by anything in the project.

Pass the values as environment variables instead, via a file so the value never
reaches a shell history or a CI log:

```bash
printf 'GOOGLE_GENERATIVE_AI_API_KEY: "%s"\nAUTH_SECRET: "%s"\n' "$KEY" "$SECRET" > env.yaml
gcloud run services update tv-helper --region=asia-southeast2 --env-vars-file=env.yaml
rm -f env.yaml    # do this in the same command; it holds a live credential
```

This is a real step down in posture and should be recorded as debt rather than
forgotten: a Cloud Run env var is readable by anyone with `run.services.get`,
where a secret version is readable only by holders of one narrow role. In this
project that is close to the same set of people, which is why it is acceptable
here and not in general. Migrating back is Step 2 unchanged, once an Owner has
run the two `add-iam-policy-binding` commands in Prerequisites.

### Browsing a private prod service, before the OAuth client exists

The OAuth client cannot be created until the URL exists (Trap 1), so there is a
window where prod is deployed and unreachable in a browser. Do not widen it with
`--allow-unauthenticated` plus `AUTH_DISABLED=true`: that is a publicly open app
holding a live Gemini key, and it is the one combination this runbook most wants
to avoid.

Tunnel instead. The service stays `--no-allow-unauthenticated`, and the proxy
attaches your own gcloud identity to every request:

```bash
gcloud run services proxy tv-helper --region=asia-southeast2 --port=8080
# then browse http://localhost:8080
```

`AUTH_DISABLED` is honoured only while `AUTH_GOOGLE_ID` is unset, so setting the
OAuth client later closes the bootstrap switch by construction rather than by
your remembering to unset a flag.

## Post-deploy verification

**Run all of it, in order, every time.** A Cloud Run revision that reports
`True` for `Ready` has proved that a process started and answered one probe.
It has not proved that the OAuth client matches, that `public/` was copied,
that the API refuses strangers, or that the browser is talking only to this
app. Each of those has failed at least once in this project's history, and
three of the four fail silently.

Set the target once. **Checks 2 to 6 work unchanged against a local container**,
which is where you should run them first -- but against the *gated* one from
step 1 (`AUTH_GOOGLE_ID` set), not the bootstrap one. Against a container still
carrying `AUTH_DISABLED=true`, check 3 reads 200 and check 4 reads 503, and
both are the bootstrap flag working rather than a fault to chase. Checks 0, 1
and 8 are Cloud Run and OAuth state and only mean anything against a real
revision.

```bash
SERVICE_URL=$(gcloud run services describe "$SERVICE" --region="$REGION" \
  --format='value(status.url)')
echo "$SERVICE_URL"
```

### 0. The revision is serving the image you think it is

```bash
gcloud run services describe "$SERVICE" --region="$REGION" \
  --format='value(status.latestReadyRevisionName)'
gcloud run services describe "$SERVICE" --region="$REGION" \
  --format='value(spec.template.spec.containers[0].image)'
```

The image digest or tag must be the `$IMAGE` you just pushed. A deploy that
"did nothing" is almost always a revision still serving the previous image.

### 1. The bootstrap switch is gone

This is the check that closes the window opened in step 4, and the one whose
absence would leave the app open to the internet.

```bash
gcloud run services describe "$SERVICE" --region="$REGION" --format=json \
  | grep -c AUTH_DISABLED          # 0
```

`grep` on the JSON rather than a `--format` path on purpose: this assertion is
"the string does not appear anywhere in the service config", which no field
path can express and no schema change can quietly break. Expect `0`. If it is
not `0`, re-run step 6 -- and note that the `AUTH_GOOGLE_ID` interlock means
the app is still gated even while the dead flag sits there.

### 2. Health, unauthenticated

```bash
curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/api/health"   # 200
curl -s "$SERVICE_URL/api/health"                                    # {"status":"ok"}
```

200 **without a session**. If this is 307 or 401, `api/health` has been dropped
from the matcher in `src/proxy.ts`, and the startup probe configured in step 6
will fail every revision from here on.

### 3. Everything else redirects

```bash
curl -sI "$SERVICE_URL/" | head -1     # HTTP/2 307
curl -sI "$SERVICE_URL/" | grep -i ^location
```

307 to `/signin?callbackUrl=%2F`. Note `/signin`, this app's own page, not
Auth.js's `/api/auth/signin`. A 200 here means the app is serving without
authentication -- go back to check 1.

### 4. The API refuses strangers, with proxy out of the picture

Proxy is not the authorization boundary, so verify the route refuses on its
own merits and returns an error rather than a page of HTML:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/json' -d '{"messages":[]}' \
  "$SERVICE_URL/api/chat"                                            # 401

curl -s -X POST -H 'content-type: application/json' -d '{"messages":[]}' \
  "$SERVICE_URL/api/chat"          # {"error":"unauthenticated","message":"..."}

curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/json' -d '{}' \
  "$SERVICE_URL/api/propose"                                         # 401
```

JSON, not markup: an API caller that follows a redirect to a sign-in page gets
a confusing 200. The same assertion runs offline in `pnpm test`
(`src/lib/auth/auth.test.mts`, `src/app/api/propose/propose.test.mts`), which
also proves the model is never reached and the request body never read.

### 5. The OCR assets serve, with the right byte count

```bash
curl -sI "$SERVICE_URL/tesseract/ind.traineddata.gz" \
  | grep -iE '^(HTTP|content-length|cache-control)'
```

Expect exactly:

```
HTTP/2 200
content-length: 1194182
cache-control: public, max-age=604800, must-revalidate
```

**The byte count matters, not just the 200.** 1,194,182 bytes is the vendored
`ind` traineddata. A 404 here is Trap 3, the `public/` copy missing. A 200 with
a much smaller body would be an error page served with the wrong status, and a
different large number means `pnpm vendor:ocr` shipped a different language
data version than the one this line was written against -- worth knowing, not
necessarily wrong.

The wasm cores are chosen at runtime by CPU feature detection, so check that
the whole set is there rather than the one your laptop happens to pick:

```bash
for f in worker.min.js eng.traineddata.gz \
         tesseract-core-simd-lstm.wasm tesseract-core-relaxedsimd-lstm.wasm; do
  printf '%s ' "$f"
  curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/tesseract/$f"
done
```

All 200.

### 6. No third-party host in the served HTML

This is the check that would have caught the Auth.js default sign-in page, and
it has to pass on `/signin` as well as on the app:

```bash
curl -s "$SERVICE_URL/signin" | grep -oE 'https?://[^"'"'"' )]+' | sort -u
```

Every line must be this service's own host, or there must be no output at all.
`authjs.dev` appearing here means `pages.signIn` was dropped from
`src/lib/auth/config.ts` and Auth.js's built-in page -- which loads each
provider logo from `https://authjs.dev/img/providers/<id>.svg` -- is serving.

### 7. The browser end, which curl cannot reach

Checks 1 to 6 are all server-side. The constraint this project is built around
is a **browser** one, and the three assets that carry it are only fetched once
an operator drops a PDF on the page. Sign in, open the app, and with DevTools
open drop one real bundle PDF on step 1.

Watch for, in the Network panel:

| Request | Meaning |
| --- | --- |
| `/_next/static/chunks/turbopack-worker-*.js` | the render/OCR Web Worker started |
| `/_next/static/media/pdf.worker.min.*.mjs` | pdf.js is using this app's worker, not a CDN |
| `/tesseract/worker.min.js`, `/tesseract/tesseract-core-*.wasm.js`, `/tesseract/ind.traineddata.gz` | OCR started from the vendored assets |

Then the standing proof that the browser talks to nothing but this app, run in
the console on the working page **and on `/signin`**:

```js
new Set(performance.getEntriesByType("resource")
  .map(r => r.name)
  .filter(n => !n.startsWith("blob:"))
  .map(n => new URL(n).host))
```

One entry: this service's host. The `blob:` filter is there because pdf.js
creates one and `new URL()` on a `blob:` name is not a host you want to reason
about. The OAuth hop itself is a top-level redirect, not a resource request, so
it never appears here.

The page must reach "page N of M" with the counter advancing. Verified this way
against the container on 2026-09-01: a 27-page scan rendered and OCR'd, every
request to the container's own origin and no external host at any point.

### Two known application defects you will meet at check 7

Both were found by running this check against the container on 2026-09-01.
**Neither is a deployment fault** -- both reproduce identically under
`next dev`, so no change to the image, the runbook or the Cloud Run config
fixes either. They are recorded here so that whoever runs check 7 knows what
they are looking at and does not spend the afternoon on the deployment.

**1. Some documents abort ingest.**
`Cannot read properties of undefined (reading 'URL')`, thrown by pdf.js's
`DOMFilterFactory` while rendering a soft mask inside a tiling pattern. That
factory needs a DOM to build an SVG filter and there is no `document` in the
render Web Worker. It is document-dependent: of two real bundle PDFs, one
aborts on page 1 and the other renders all 27 pages. The shape of the fix is a
worker-safe `FilterFactory` passed to `pdfjs.getDocument` next to the
`CanvasFactory` already there -- pdf.js's own Node build does exactly this by
subclassing a no-op base whose every method returns `"none"`.

**2. A completed ingest persists nothing, and says so only at the very end.**
This is the more serious of the two and it is the wrong-and-quiet shape. On a
clean profile, ingesting a 27-page PDF shows the progress counter advance to
27 of 27 over about two minutes of real OCR, and then fails with:

```
run <id> has moved on: this write is based on revision 2, but revision 1
is stored. Something else wrote to this run [...]
```

That is `StaleRunWriteError` from `src/lib/storage/runs.ts`, the deliberate
revision guard. After it fires, the run opens with **"0 pages"**, and reading
IndexedDB directly confirms it: the `runs` and `sources` stores hold one record
each and the `pages` store holds **zero**. Note the direction the message
reports -- the write is *ahead* of what is stored, not behind, which is the
opposite of the case the guard's wording describes.

So an operator can spend minutes ingesting a bundle, watch it complete, and be
left with an empty run. **Do not read a green check 7 progress bar as a working
product**; open the run afterwards and confirm it reports a non-zero page
count.

### 8. Sign in and reach admin

Sign in as `aisystemtelkom@gmail.com`, the bootstrap owner. `/admin` renders
the allowlist and shows `via bootstrap`. Add the operators there rather than in
the Firestore console.

If sign-in fails with `redirect_uri_mismatch`, read the URI Google names in the
error and compare it character for character with the one in the console; the
usual cause is a trailing slash or `http` against `https`.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Revision fails to start, no application log | arm64 image on Cloud Run. Rebuild `--platform linux/amd64`. |
| Revision never goes healthy, but the app answers when you curl it | The startup probe is pointing somewhere that needs a session. It must be `/api/health`; everything else 307s or 401s. |
| `/api/health` returns 307 or 401 | `api/health` was dropped from the matcher in `src/proxy.ts`, or the route started calling the guard. Both halves are commented; restore whichever went. |
| Container restarts under load or mid-run | A `--liveness-probe` was added. This service does not use one; `--liveness-probe=""` removes it. |
| A cost lever behaves as if unset but is present | It is set to the empty string. `??` does not fall back on `""`. Use `--remove-env-vars=NAME`. |
| Ingest aborts with `Cannot read properties of undefined (reading 'URL')` | **An application bug, not a deployment one.** pdf.js's `DOMFilterFactory` needs a DOM to build the SVG filter for a soft mask, and there is no `document` in the render Web Worker. It fires on PDFs that use a tiling pattern with a soft mask, so some bundle documents ingest and others abort. Reproduces identically under `next dev`. The fix is a worker-safe `FilterFactory` passed to `pdfjs.getDocument` alongside the `CanvasFactory` already there, mirroring what pdf.js's own Node build does. |
| OCR 404s on a `tesseract-core-*.wasm.js` you did not expect | The core variant is picked at runtime from CPU features. `pnpm vendor:ocr` must ship the whole set, not the one your machine requested. |
| Ingest reaches "27 of 27" and then errors with `has moved on: this write is based on revision N` | **An application bug, not a deployment one.** `StaleRunWriteError` fires at the end of a clean ingest and the run is left with zero stored pages. Reproduces under `next dev`. See "Two known application defects" above. |
| A run opens with "0 pages" after a successful-looking ingest | Same defect. The `pages` object store in IndexedDB is genuinely empty; nothing was persisted. |
| CSS missing, page unstyled | `.next/static` not copied into the standalone tree. |
| OCR fails, 404 on `*.wasm` or `ind.traineddata.gz` | `public/` not copied. Trap 3. |
| `redirect_uri_mismatch` | The console's redirect URI is not exactly `$SERVICE_URL/api/auth/callback/google`. |
| Everyone denied, log says `lookup-failed` | Firestore unreachable or the service account lacks `roles/datastore.user`. The bootstrap owner still gets in; use `/admin`. |
| Signed in, then denied with `not-listed` | Not in the allowlist, or removed within the last 60 seconds by another instance. |
| Signed out every seventh day | Consent screen still in Testing mode. Trap 2. |
| Redirect loop at `/api/auth/signin` | The `api/auth` exclusion is missing from the proxy matcher. |
| Redirect loop at `/signin` | The `signin` exclusion is missing from the proxy matcher. Proxy redirects the sign-in page to itself. |
| `/signin` requests `authjs.dev` | `pages.signIn` was dropped from `src/lib/auth/config.ts`, so Auth.js's built-in page is serving. Verification step 4. |
| `argument --clear-env-vars: At most one of ...` | Step 6 was run with both `--clear-env-vars` and `--set-env-vars`. `--set-env-vars` alone already replaces the whole set. |
