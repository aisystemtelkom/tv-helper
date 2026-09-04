# tv-helper container image, for Cloud Run in asia-southeast2 (Jakarta).
#
# No `--platform` is pinned on any FROM, so this builds natively on a teammate's
# darwin-arm64 Mac and on amd64 alike. Cloud Run serves amd64 only, so a Mac
# build must be told the target explicitly:
#
#   docker buildx build --platform linux/amd64 -t tv-helper .
#
# See docs/runbook-deploy.md. Building the wrong architecture produces an image
# that pushes fine and then fails to start on Cloud Run.

# Debian slim rather than alpine: pdfjs-dist and exceljs are both
# JS/wasm, but Next ships a native SWC binary per platform and glibc is the
# combination upstream tests. Alpine saves ~40MB and buys a musl variant matrix
# on every future dependency.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
# Installed rather than enabled through corepack: corepack is deprecated in
# Node 24 and gone in 25, and this pins the same version as `packageManager`.
RUN npm install --global pnpm@10.33.0
WORKDIR /app


# --- dependencies ----------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile


# --- build -----------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# There is no asset-vendoring step any more. `prebuild` used to run
# `pnpm vendor:ocr` to copy the tesseract worker, wasm core and traineddata
# into public/tesseract; scans are read by Cloud Vision now and none of it
# ships.
# That is why public/ is populated inside the image rather than shipped in the
# build context -- .dockerignore excludes it, and vendor:ocr regenerates it.
#
# No secret is needed here. `src/lib/model.ts` builds its Gemini client lazily
# and `src/lib/auth/instance.ts` builds its Firestore client lazily, precisely
# so a missing credential fails the request that needs it and not the build.
RUN pnpm build

# THE HEALTH ENDPOINT MUST STAY UNGATED, and this is the only place a
# regression is caught before Cloud Run catches it.
#
# `src/app/api/health/route.ts` deliberately does not call the guard, and
# `src/proxy.ts` deliberately excludes `api/health` from its matcher. Both
# halves are needed: drop either and an unauthenticated probe becomes a 401 or
# a 307, Cloud Run reads that as a failed probe, and it restarts a container
# that is serving every real request correctly. The app looks fine to anyone
# who curls it with a session, so nothing else would notice.
#
# A build-time assertion rather than a test because the failure lands on the
# platform, not in the app, and this is the last gate before an image is
# pushed. Cheap, and loud in the right place.
#
# The first grep is anchored to `(?!`, the negative lookahead itself, and not
# to the bare string: `api/health` also appears in that file's prose, so a
# plain grep passes while the matcher no longer excludes anything. Verified by
# deleting the exclusion and watching this build fail.
RUN set -eu; \
    grep -qE '\(\?!.*api/health' src/proxy.ts \
      || { echo "Dockerfile: src/proxy.ts no longer excludes api/health from" >&2; \
           echo "its matcher. An unauthenticated Cloud Run probe would get a" >&2; \
           echo "401/307 and every revision would be marked unhealthy." >&2; \
           exit 1; }; \
    test -f src/app/api/health/route.ts \
      || { echo "Dockerfile: src/app/api/health/route.ts is gone, but the" >&2; \
           echo "runbook's --startup-probe still points at /api/health." >&2; \
           exit 1; }; \
    ! grep -qE '^ *import .*(@/lib/auth|lib/auth/)' src/app/api/health/route.ts \
      || { echo "Dockerfile: the health route now imports the auth guard. An" >&2; \
           echo "unauthenticated probe would get a 401 and Cloud Run would" >&2; \
           echo "restart healthy containers." >&2; \
           exit 1; }; \
    echo "health endpoint is present and ungated"

# REPAIR THE TRACED node_modules. Without this the image builds, pushes, and
# then the container dies on the first line of `node server.js` with
#
#   Cannot find module '.../@swc/helpers/esm/_interop_require_default.js'
#
# Next traces `@swc/helpers` with the `require` condition and copies
# `cjs/_interop_require_default.cjs`. Node 24 resolves the very same specifier
# (`next/dist/shared/lib/constants.js` does
# `require("@swc/helpers/_/_interop_require_default")`) through the
# `module-sync` condition instead, which that package maps to `esm/*.js` -- a
# file the tracer therefore never copied. The tracer and the runtime disagree
# about the same `exports` map, and the loser is the deployed container.
#
# NOTE THAT `node .next/standalone/server.js` RUN IN PLACE DOES NOT CATCH THIS.
# The standalone tree sits inside the project, so Node walks up into the real
# `node_modules` and finds the missing file there. Only an isolated root -- this
# image, or Cloud Run -- exposes it. Test the container, not the directory.
#
# `@swc/helpers` is the only package in the traced tree whose `exports` mention
# `module-sync`, which is why this repairs that package rather than everything:
#
#   grep -rl module-sync .next/standalone/node_modules/.pnpm/*/node_modules/*/package.json
#
# Version-agnostic, and loud if the assumption ever stops holding: an empty
# glob or a missing source fails the build rather than shipping a broken image.
RUN set -eu; \
    repaired=0; \
    for traced in .next/standalone/node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers; do \
      [ -d "$traced" ] || continue; \
      full="${traced#.next/standalone/}"; \
      if [ ! -d "$full" ]; then \
        echo "Dockerfile: no full copy of $full to repair from" >&2; exit 1; \
      fi; \
      cp -R "$full/." "$traced/"; \
      if [ ! -f "$traced/esm/_interop_require_default.js" ]; then \
        echo "Dockerfile: repaired $traced but esm/ is still missing" >&2; exit 1; \
      fi; \
      repaired=$((repaired + 1)); \
    done; \
    if [ "$repaired" -eq 0 ]; then \
      echo "Dockerfile: found no @swc/helpers in the standalone tree. The pnpm" >&2; \
      echo "layout or Next's tracing changed; re-check before deleting this." >&2; \
      exit 1; \
    fi; \
    echo "repaired $repaired traced @swc/helpers copy/copies"


# --- runtime ---------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
# Cloud Run sends traffic to $PORT and requires listening on all interfaces.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# The standalone server and its traced node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# THESE TWO COPIES ARE NOT OPTIONAL, and they are the trap this Dockerfile
# exists to avoid. Next's output reference: the minimal server "does not copy
# the public or .next/static folders by default [...] these folders can be
# copied to the standalone/public and standalone/.next/static folders manually,
# after which server.js file will serve these automatically."
#
# Drop the first and every stylesheet and client chunk 404s. Drop the second and
# /tesseract/*.wasm and ind.traineddata.gz 404s -- which does not break the
# page, it breaks OCR, in production only, while `next dev` serves them from
# disk and looks perfect. That is the wrong-and-quiet failure this project
# cares most about, so it is spelled out here rather than trusted to memory.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Prove the assembled tree can actually load, HERE, where /app is the whole
# world and nothing can be borrowed from a parent node_modules. This is the
# require chain that fails when the tracing repair above is missing
# (next.js -> config.js -> constants.js -> @swc/helpers), so a broken image now
# fails `docker build` instead of Cloud Run's first request. It costs about a
# second and it is the only check in this file that runs the code.
#
# The two asset copies get the same treatment: a missing `ind.traineddata.gz`
# breaks OCR in production only, silently, while `next dev` serves it from disk
# and looks perfect.
#
RUN set -eu; \
    node -e "require('next/dist/server/next')"; \
    test -d ./.next/static; \
    test -d ./public; \
    echo "standalone tree loads; static and public present"


USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
