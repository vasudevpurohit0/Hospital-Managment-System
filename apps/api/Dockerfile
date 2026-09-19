FROM node:20-bookworm-slim AS base
WORKDIR /app

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
