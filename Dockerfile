# syntax=docker/dockerfile:1

# Server image only — the static client is built in CI and uploaded to GCS+CDN,
# so this image no longer runs `vite build`.

# ---- build: install server deps + generate the Prisma client ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# OpenSSL is required by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Install with the lockfile first for better layer caching. Scope to the server
# workspace so the client's (heavy) build tooling isn't installed.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN --mount=type=cache,target=/root/.npm npm ci --workspace server --include-workspace-root

# Server + shared source, Prisma schema/migrations.
COPY server ./server
COPY shared ./shared
COPY tsconfig.base.json ./
RUN npm --workspace server run generate
# Precompile the server to a single JS bundle (deps stay external). Running the
# bundle with `node` avoids tsx transpiling the whole app on every cold start —
# cutting startup from ~13s to ~3-4s.
RUN npm --workspace server run build

# ---- runtime: ship compiled bundle + node_modules, run via node ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080

# node_modules (incl. prisma CLI), the compiled server bundle (dist/), Prisma
# schema + migrations + generated client all come from the build stage.
COPY --from=build /app ./

EXPOSE 8080

# Apply migrations, then run the precompiled bundle with node (fast cold start —
# no on-boot TypeScript transpilation). `exec` so node is PID 1 and gets SIGTERM.
WORKDIR /app/server
CMD ["sh", "-c", "../node_modules/.bin/prisma migrate deploy && exec node dist/index.js"]
