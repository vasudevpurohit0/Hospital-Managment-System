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

# Expose port
EXPOSE 3000

# Start dev server
CMD ["pnpm", "start:dev"]
