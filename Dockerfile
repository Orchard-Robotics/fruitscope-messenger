# syntax=docker/dockerfile:1

# Server image only — the static client is built in CI and uploaded to GCS+CDN,
# so this image no longer runs `vite build`.

# ---- build: install server deps + generate the Prisma client ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# OpenSSL is required by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Install with the lockfile first for better layer caching. The client workspace
# is omitted so none of its (heavy) build tooling is installed.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN --mount=type=cache,target=/root/.npm npm ci --workspace server --include-workspace-root

# Server + shared source, Prisma schema/migrations.
COPY server ./server
COPY shared ./shared
COPY tsconfig.base.json ./
RUN npm --workspace server run generate

# ---- runtime: ship source + node_modules, run via tsx ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080

# node_modules (incl. tsx + prisma CLI), server/shared source, Prisma schema +
# migrations + generated client all come from the build stage.
COPY --from=build /app ./

EXPOSE 8080

# Run from server/ so tsx resolves the @shared/* tsconfig paths (as in dev).
# Apply migrations, then start. `exec` so the server is PID 1 and receives SIGTERM.
WORKDIR /app/server
CMD ["sh", "-c", "../node_modules/.bin/prisma migrate deploy && exec ../node_modules/.bin/tsx src/index.ts"]
