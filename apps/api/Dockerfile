# Build context is the MONOREPO ROOT (not apps/api) -- pnpm-lock.yaml and
# pnpm-workspace.yaml only exist there. On Railway: set the service's Dockerfile
# path to `apps/api/Dockerfile` and leave the build/root directory as the repo
# root so this COPY layout resolves.
FROM node:20-bookworm-slim AS base
WORKDIR /app

# Prisma's query engine needs libssl to detect the right binary target at
# generate time and to load the engine at runtime. Without it, Prisma can't
# probe the installed OpenSSL version, silently defaults to the wrong engine
# (openssl-1.1.x), and the app crashes on startup with
# "libssl.so.1.1: cannot open shared object file".
#
# The rest of this list is what `DocumentRenderService` (receipts, statements,
# lab report PDFs -- anything rendered via Puppeteer) needs to actually launch
# headless Chrome: `unzip` for `npx puppeteer browsers install` to extract the
# downloaded archive (it otherwise fails with "no zip archiver is available"),
# and the GTK/X11/NSS shared-library set Chrome itself dynamically links
# against (confirmed via `ldd` against the actual installed binary -- this is
# not a guessed list). Without these, every PDF endpoint 500s with either
# "Could not find Chrome" or "error while loading shared libraries:
# libglib-2.0.so.0", discovered live against a container that was missing
# both.
RUN apt-get update -y && apt-get install -y \
      openssl \
      unzip \
      libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
      libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libasound2 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 \
      libx11-6 libxext6 libxi6 libxtst6 \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# --- deps stage: only the files pnpm needs to resolve + install the api's
# workspace deps, so this layer stays cached across app-source-only changes.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma
RUN pnpm install --frozen-lockfile --filter @esic-hms/api

# --- build stage: compile TypeScript + generate both Prisma clients
FROM deps AS build
COPY apps/api ./apps/api
RUN pnpm --filter @esic-hms/api prisma:generate
RUN pnpm --filter @esic-hms/api prisma:platform:generate
RUN pnpm --filter @esic-hms/api run build

# --- runtime stage: prod deps only + compiled dist, no TS/build tooling
FROM base AS runtime

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/prisma ./apps/api/prisma
# NOTE: NODE_ENV=production is deliberately NOT set yet here -- pnpm treats
# that env var as an implicit --prod (skips devDependencies) regardless of
# any --prod flag passed explicitly, and the package's own `postinstall`
# script runs `prisma generate` for both schemas using the `prisma` CLI,
# which is a devDependency. Installing with NODE_ENV=production set fails
# postinstall with "prisma: not found" (confirmed by trying it). Keeping
# devDependencies for this install costs some image size but is the
# reliable option; Prisma's own CLI + engines aren't large next to the
# Puppeteer/Chrome install below anyway. NODE_ENV is set for the actual
# running app below, after everything that needs devDependencies is done.
RUN pnpm install --frozen-lockfile --filter @esic-hms/api

COPY --from=build /app/apps/api/dist ./apps/api/dist
# prisma/seed.ts imports raw TypeScript from ../src/... and runs via
# `ts-node -r tsconfig-paths/register` (see package.json's `prisma.seed`
# script) -- without src/ and the tsconfig files here, that import fails
# at runtime since only the compiled dist/ output was copied above.
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json ./apps/api/
RUN pnpm --filter @esic-hms/api prisma:generate
RUN pnpm --filter @esic-hms/api prisma:platform:generate

ENV NODE_ENV=production

# V-10: run as the image's built-in non-root user rather than root, so an
# RCE in the app or a dependency doesn't get root inside the container.
# `node` (uid 1000) ships in every official Node image; chown after all the
# root-owned install/generate steps above so the app can still read/write
# its own files under it.
RUN chown -R node:node /app
USER node
WORKDIR /app/apps/api

# Headless Chrome for Puppeteer-rendered PDFs -- installed as `node` so
# `~/.cache/puppeteer` ends up owned by the same user the app runs as (the
# preceding `apt-get install` above provides the shared libraries it needs;
# without this step the browser binary itself is simply never downloaded).
# Run from apps/api, not /app -- `npx` resolves the `puppeteer` binary via
# the nearest node_modules/.bin, which pnpm's workspace layout puts under
# apps/api, not the monorepo root (confirmed: running this from /app fails
# with "sh: 1: puppeteer: not found").
RUN npx puppeteer browsers install chrome

EXPOSE 3000
CMD ["node", "dist/main"]
