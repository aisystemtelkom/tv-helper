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

# Debian slim rather than alpine: pdfjs-dist, exceljs and tesseract.js are all
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
# `prebuild` runs `pnpm vendor:ocr`, which copies the tesseract worker, wasm
# core and the ind/eng traineddata out of node_modules into public/tesseract.
# That is why public/ is populated inside the image rather than shipped in the
# build context -- .dockerignore excludes it, and vendor:ocr regenerates it.
#
# No secret is needed here. `src/lib/model.ts` builds its Gemini client lazily
# and `src/lib/auth/instance.ts` builds its Firestore client lazily, precisely
# so a missing credential fails the request that needs it and not the build.
RUN pnpm build


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

USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
