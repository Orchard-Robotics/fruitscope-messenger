import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";
import { Server } from "socket.io";

import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@shared/index";
import { PORT } from "./env";
import { api } from "./http";
import { prisma } from "./prisma";
import { seed } from "./seed";
import { attachSockets } from "./socket";

await seed();

const app = express();
app.set("trust proxy", true); // behind the GCP load balancer
app.use(cors());
app.use(express.json());
app.use("/api", api);
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// In production we serve the built client from this same origin — one domain,
// no CORS, WebSockets share the origin.
if (process.env.NODE_ENV === "production") {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = process.env.CLIENT_DIST ?? path.resolve(dirname, "../../client/dist");
  app.use(express.static(clientDist));
  // SPA fallback — anything that isn't the API or the socket endpoint gets index.html.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const httpServer = createServer(app);
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>(httpServer, {
  cors: { origin: true, credentials: true },
});
attachSockets(io);

httpServer.listen(PORT, () => {
  console.log(`🌱 Verdant server listening on http://localhost:${PORT}`);
});

// Graceful shutdown: close sockets (clients get a clean close frame and
// auto-reconnect), drain HTTP, disconnect the DB. A hard timeout guarantees
// exit well within Cloud Run's termination grace period.
let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down…`);
  const force = setTimeout(() => process.exit(0), 5_000);
  force.unref();
  io.close(() => {
    void prisma.$disconnect().finally(() => {
      clearTimeout(force);
      process.exit(0);
    });
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
