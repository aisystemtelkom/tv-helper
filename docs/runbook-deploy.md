# Deploy runbook: Cloud Run, Jakarta

What this deploys: the tv-helper container on Cloud Run in `asia-southeast2`,
with Google sign-in and a Firestore allowlist. Cloud Run is the only GCP compute
that bills nothing while idle, which is the normal state of an internal tool
used by a handful of operators, and Jakarta disposes of the data residency
question rather than leaving it open for a state telco.

Read the three traps first. Each one costs an afternoon if you meet it as a
symptom instead of as a step.

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

Verified end to end against the built standalone server:

```
GET /tesseract/ind.traineddata.gz -> 200  1194182 bytes
Cache-Control: public, max-age=604800, must-revalidate
```

(`next.config.ts` sets that header. Deliberately not `immutable`: these
filenames carry no content hash, so `immutable` would pin every browser to the
wasm it first saw and a tesseract upgrade would reach nobody, silently.)

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
  --memory=512Mi --min-instances=0 --port=8080

SERVICE_URL=$(gcloud run services describe "$SERVICE" --region="$REGION" \
  --format='value(status.url)')
echo "$SERVICE_URL"
```

`--min-instances=0` is what makes idle free; do not raise it to paper over a
cold start.

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
  --clear-env-vars \
  --set-env-vars="AUTH_URL=${SERVICE_URL},AUTH_GOOGLE_ID=${OAUTH_CLIENT_ID}" \
  --set-secrets="AUTH_SECRET=auth-secret:latest,AUTH_GOOGLE_SECRET=auth-google-secret:latest,GOOGLE_GENERATIVE_AI_API_KEY=gemini-api-key:latest"
```

`--clear-env-vars` is there to drop `AUTH_DISABLED` from step 4. The interlock
would neutralise it anyway once `AUTH_GOOGLE_ID` is set, but leaving a dead
switch in the service config invites someone to "clean up" the wrong half of it
later.

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
| `GEMINI_MEDIA_RESOLUTION`, `GEMINI_THINKING_LEVEL`, `GEMINI_MAX_OUTPUT_TOKENS` | env | no | Cost levers. See AGENTS.md. |

For local development, add the Auth.js variables to your `.env.local` alongside
the Gemini key. `.env.example` does not list them yet; the block to add is:

```sh
# Auth.js. Only needed once you are working on sign-in; `pnpm dev` without
# these redirects to a sign-in page that cannot complete.
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_URL=http://localhost:3000
```

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
`_next/image`, `favicon.ico`, `/tesseract/` or `/api/auth`.

**Not yet enforced, and this is the one thing to finish.** The pipeline UI and
`/api/chat` are owned by other tracks and were not edited here, so they do not
call the guard yet. Until they do, `/` and `/api/chat` are protected only by
proxy's signature check, which is weaker than the design intends. Each route
handler, server component and Server Function that touches a run needs one line:

```ts
// server component or Server Function
import { requireUser } from "@/lib/auth/require-user";
const user = await requireUser();          // throws AuthorizationError

// route handler
import { requireApiUser } from "@/lib/auth/require-user";
const gate = await requireApiUser();
if (gate.response) return gate.response;   // 401 or 403 JSON
```

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
| Artifact Registry | container image, about 400MB | about $0.05/month |
| Firestore, default database | the allowlist, nothing else | free tier |
| Secret Manager | three secrets | free at three |
| IndexedDB, in the browser | every document, crop, and run | free |

Two options rejected on cost: Cloud SQL, roughly $9/month and never scales to
zero; Identity-Aware Proxy, roughly $18/month for the load balancer it requires.
Both are the obvious-looking answers to "database" and "auth" respectively.

---

## Verifying a deploy

1. `curl -sI "$SERVICE_URL/" ` returns **307** to `/api/auth/signin`.
2. `curl -s "$SERVICE_URL/api/chat" -X POST` returns **401** with
   `{"error":"unauthenticated",...}` rather than an HTML sign-in page.
3. `curl -sI "$SERVICE_URL/tesseract/ind.traineddata.gz"` returns **200** with
   about 1.19MB and a `Cache-Control` header. A 404 here is Trap 3.
4. Sign in as the bootstrap owner. `/admin` renders the allowlist and shows
   `via bootstrap`.
5. In the browser console on the working page,
   `performance.getEntriesByType("resource").map(r => new URL(r.name).host)`
   shows only the service's own host. Sign-in is a top-level redirect, not a
   resource request, so it does not appear here. This check is the standing
   proof that the browser talks to nothing but this app.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Revision fails to start, no application log | arm64 image on Cloud Run. Rebuild `--platform linux/amd64`. |
| CSS missing, page unstyled | `.next/static` not copied into the standalone tree. |
| OCR fails, 404 on `*.wasm` or `ind.traineddata.gz` | `public/` not copied. Trap 3. |
| `redirect_uri_mismatch` | The console's redirect URI is not exactly `$SERVICE_URL/api/auth/callback/google`. |
| Everyone denied, log says `lookup-failed` | Firestore unreachable or the service account lacks `roles/datastore.user`. The bootstrap owner still gets in; use `/admin`. |
| Signed in, then denied with `not-listed` | Not in the allowlist, or removed within the last 60 seconds by another instance. |
| Signed out every seventh day | Consent screen still in Testing mode. Trap 2. |
| Redirect loop at `/api/auth/signin` | The `api/auth` exclusion is missing from the proxy matcher. |
