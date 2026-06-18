# syntax=docker/dockerfile:1

# ---- build: install deps, generate Prisma client, build client + nothing else ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# OpenSSL is required by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Install with the lockfile first for better layer caching.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN --mount=type=cache,target=/root/.npm npm ci

# Build everything.
COPY . .
RUN npm --workspace server run generate \
 && npm --workspace client run build

# ---- runtime: ship source + node_modules, run via tsx ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV CLIENT_DIST=/app/client/dist
ENV PORT=8080

# node_modules (incl. tsx + prisma CLI), built client, server/shared source,
# Prisma schema + migrations + generated client all come from the build stage.
COPY --from=build /app ./

EXPOSE 8080

# Run from server/ so tsx resolves the @shared/* tsconfig paths (as in dev).
# Apply migrations, then start. `exec` so the server is PID 1 and receives SIGTERM.
WORKDIR /app/server
CMD ["sh", "-c", "../node_modules/.bin/prisma migrate deploy && exec ../node_modules/.bin/tsx src/index.ts"]
