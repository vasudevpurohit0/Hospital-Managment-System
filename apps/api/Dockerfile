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

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy package files
COPY package.json ./
COPY prisma ./prisma

# Install dependencies
RUN pnpm install

# Copy source
COPY . .

# Generate Prisma client
RUN pnpm prisma generate

# V-10: run as the image's built-in non-root user rather than root, so an
# RCE in the app or a dependency doesn't get root inside the container.
# `node` (uid 1000) ships in every official Node image; chown after all the
# root-owned install/generate steps above so the app can still read/write
# its own files under it.
RUN chown -R node:node /app
USER node

# Headless Chrome for Puppeteer-rendered PDFs -- installed as `node` so
# `~/.cache/puppeteer` ends up owned by the same user the app runs as (the
# preceding `apt-get install` above provides the shared libraries it needs;
# without this step the browser binary itself is simply never downloaded).
RUN npx puppeteer browsers install chrome

# Expose port
EXPOSE 3000

# Start dev server
CMD ["pnpm", "start:dev"]
