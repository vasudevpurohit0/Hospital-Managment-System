FROM node:20-bookworm-slim AS base
WORKDIR /app

# Prisma's query engine needs libssl to detect the right binary target at
# generate time and to load the engine at runtime. Without it, Prisma can't
# probe the installed OpenSSL version, silently defaults to the wrong engine
# (openssl-1.1.x), and the app crashes on startup with
# "libssl.so.1.1: cannot open shared object file".
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

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

# Expose port
EXPOSE 3000

# Start dev server
CMD ["pnpm", "start:dev"]
