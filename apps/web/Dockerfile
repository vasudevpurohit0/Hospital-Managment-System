FROM node:20-alpine AS base
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Copy package files
COPY package.json ./

# Install dependencies
RUN pnpm install

# Copy source
COPY . .

# V-10: run as the image's built-in non-root user rather than root.
RUN chown -R node:node /app
USER node

# Expose port
EXPOSE 5173

# Start dev server
CMD ["pnpm", "dev"]
