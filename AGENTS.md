# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

FruitScope Messenger is a strict TypeScript monorepo for a real-time Slack-style
chat app.

- `client/` - Vite, React 19, Tailwind v4, Zustand, Socket.IO client.
- `server/` - Express, Socket.IO, Prisma, OIDC auth, GCS-backed avatar storage.
- `shared/` - shared domain types and fully typed Socket.IO event contracts.
- `terraform/` - standalone GCP Cloud Run, Cloud SQL, load balancer, and CI
  infrastructure.

Treat `shared/events.ts` and `shared/types.ts` as the public contract between
client and server. Changes to Socket.IO events or cross-package data shapes
usually need coordinated updates in all three packages.

## Commands

Use npm workspaces from the repository root unless there is a reason to work in a
single package.

```bash
npm install
npm run dev
npm run typecheck
npm run build
npm --workspace server run db:studio
```

Notes:

- `npm run dev` starts Docker services for Postgres and fake-gcs, runs server
  migrations, then starts the server on `:3001` and client on `:5173`.
- `npm run typecheck` runs strict TypeScript checks for both packages.
- `npm run build` type-checks and builds the client bundle.
- Server Prisma commands live under the `server` workspace.

## Development Workflow

- Prefer small, scoped changes that match the existing package boundaries.
- Keep the wire protocol typed end-to-end. Add or update shared event/type
  definitions before consuming them in `client` or `server`.
- When changing database models, update `server/prisma/schema.prisma` and use
  Prisma migrations rather than ad hoc database changes.
- Preserve the local development path: Vite proxies `/api` and `/socket.io` to
  the server, so client code should normally use same-origin requests.
- For authentication-sensitive work, keep production OIDC behavior intact.
  `ALLOW_DEV_LOGIN=true` is only for local development.
- Avatar uploads go through the backend, but browser reads should continue to use
  the configured CDN/fake-gcs URL directly rather than proxying images through
  the server.

## Code Style

- Use strict TypeScript and existing local patterns.
- Keep React components functional and colocate UI-specific helpers with the
  client code that uses them.
- Use existing utilities such as `client/src/lib/cn.ts` and shared channel,
  session, avatar, mention, and formatting helpers before adding new helpers.
- Use lucide-react icons when adding icon buttons in the client.
- Keep server validation explicit, preferably with existing Zod patterns where
  request or event payloads cross a trust boundary.
- Avoid broad refactors, formatting churn, or dependency upgrades unless they are
  required for the task.

## Verification

Before handing off code changes, run the narrowest meaningful checks. For most
changes this is:

```bash
npm run typecheck
```

For client-facing changes, also run:

```bash
npm run build
```

If a command cannot be run because Docker, network access, credentials, or local
services are unavailable, state that clearly in the handoff.

## Infrastructure

Terraform in `terraform/` manages production infrastructure for
`fruitscope-messenger.com`. Pull requests should plan only; merges to `main`
deploy. Be careful with changes that affect Cloud Run instance count, Cloud SQL,
Secret Manager, DNS, certificates, or the state bucket.

Presence and typing are currently in-memory and assume a single Cloud Run
instance. Scaling past one instance requires adding shared Socket.IO state, such
as Redis and the Socket.IO Redis adapter.

## Git Hygiene

- Do not revert user changes unless explicitly asked.
- Check worktree status before editing and keep unrelated changes intact.
- Keep generated files and lockfile updates only when they are a direct result of
  the requested change.
- Do not commit unless the user asks.
