# 🌱 Verdant

A simplified, real-time Slack clone with a calm, solarpunk look. Channels, DMs,
presence, typing indicators, emoji reactions and unread badges — all over
Socket.IO, all in strict TypeScript, all running locally under Vite.

<sub>React 19 · Vite 6 · Tailwind v4 · Socket.IO · Express · Prisma + SQLite · Zustand</sub>

---

## Features

- **Channels** — public & private, create on the fly
- **Direct messages** — start a DM with anyone, created on demand
- **Real-time everything** — messages, reactions, presence and typing all stream over Socket.IO
- **Presence** — live online/away/offline dots and an online count
- **Typing indicators**, **emoji reactions**, **unread badges**, message grouping & day dividers
- **History pagination** — older messages load as you scroll up
- Passwordless username login (local demo), seeded with a lively little workspace

## Architecture

```
fruitscope-messenger/
├── shared/        # Types + fully-typed Socket.IO event contracts (one source of truth)
├── server/        # Express + Socket.IO + Prisma (SQLite). Strict TS, run via tsx.
│   └── prisma/    # schema.prisma  →  swap provider to postgresql for prod
└── client/        # Vite + React 19 + Tailwind v4 + Zustand
```

- The **wire protocol is type-checked end-to-end**: `shared/events.ts` defines
  `ServerToClientEvents` / `ClientToServerEvents`, consumed by both ends.
- The client talks to the server through Vite's dev proxy (`/api` + `/socket.io`),
  so it's a single origin with no CORS fuss.
- Data lives in **SQLite via Prisma** locally. For production, change the
  `datasource` provider in `prisma/schema.prisma` to `postgresql` and point
  `DATABASE_URL` at GCP Cloud SQL — the models are provider-agnostic.

## Getting started

```bash
npm install      # installs all workspaces
npm run dev      # generates the Prisma client, syncs the DB, seeds it,
                 # then runs the server (:3001) + client (:5173) together
```

Open **http://localhost:5173** and sign in with any username — or click one of
the seeded residents (willow, fern, sol, robin, moss). Open a second browser (or
an incognito window) as a different user to watch messages, reactions and
presence update live.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run server + client together (hot-reload) |
| `npm run typecheck` | Strict type-check both packages |
| `npm run build` | Type-check + build the client bundle |
| `npm --workspace server run db:studio` | Browse the SQLite data in Prisma Studio |

### Configuration

- `server/.env` → `DATABASE_URL` (SQLite by default) and optional `PORT`.
- `client` proxies to `http://localhost:3001`; override with `SERVER_URL`.

## How it fits together

1. `POST /api/auth/login` returns a session token (stored in `localStorage`).
2. The client connects a Socket.IO with that token; the server authenticates it
   in middleware and tracks presence per connection.
3. `GET /api/bootstrap` hydrates the workspace (users, channels, recent messages).
4. From there everything is event-driven: `message:send`, `message:react`,
   `channel:create`, `dm:open`, `typing:*`, `channel:history`, `channel:read`.

Built to be idiomatic, fast and easy to extend. 🍃
