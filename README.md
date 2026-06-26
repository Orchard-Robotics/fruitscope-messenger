# 🍎 FruitScope Messenger

A simplified, real-time Slack-style chat app with a clean, light FruitScope
look (white + green). Channels, DMs, presence, typing indicators, emoji
reactions and unread badges — all over Socket.IO, all in strict TypeScript,
responsive down to mobile.

<sub>React 19 · Vite 6 · Tailwind v4 · Socket.IO · Express · Prisma + Postgres · Zustand</sub>

---

## Features

- **Channels** — public & private, create on the fly
- **Direct messages** — start a DM with anyone, created on demand
- **Real-time everything** — messages, reactions, presence and typing all stream over Socket.IO
- **Presence** — live online/away/offline dots and an online count
- **Typing indicators**, **emoji reactions**, **unread badges**, message grouping & day dividers
- **History pagination** — older messages load as you scroll up
- **Sign in with FruitScope (OIDC)** — per-orchard workspaces; super admins can switch between orchards

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

Open **http://localhost:5173**. Production authentication is "Sign in with
FruitScope" (OIDC against `login.fruitscope.com`). For local development, set
`ALLOW_DEV_LOGIN=true` and forge a session without the IdP:

```bash
curl -i -c cookies.txt -X POST http://localhost:3001/api/auth/dev-login \
  -H 'content-type: application/json' \
  -d '{"sub":"42","displayName":"Willow Vale","orchardCode":"SUN","orchardName":"Sunrise Orchard"}'
# add "isSuperAdmin": true to land on orchard-robotics with the workspace switcher
```

The session is delivered as an httpOnly cookie; open a second browser (or an
incognito window) as a different `sub` to watch messages, reactions and presence
update live.

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

1. `GET /api/auth/login` starts the OIDC authorization-code + PKCE flow; the
   `/api/auth/callback` verifies the ID token, provisions the user + their
   orchard (from the `fruitscope` claim), and sets an httpOnly session cookie.
2. The client connects Socket.IO with `withCredentials`; the server reads the
   session cookie in middleware and tracks presence per connection.
3. `GET /api/bootstrap` hydrates the workspace (users, channels) for the orchard
   the session is scoped to; super admins can re-scope via `/api/orchards/switch`.
4. From there everything is event-driven: `message:send`, `message:react`,
   `channel:create`, `dm:open`, `typing:*`, `channel:history`, `channel:read`.

Built to be idiomatic, fast and easy to extend. 🍃
