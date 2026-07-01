import { createServer } from "node:http";

import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";

import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@shared/index";
import { canary as canaryRoutes } from "./canaryRoutes";
import { isProd, oidcConfigured, PORT, usingGcsEmulator } from "./env";
import { api } from "./http";
import { prisma } from "./prisma";
import { attachSockets } from "./socket";
import { ensureMediaBucket } from "./storage";
import { canary, canaryCode } from "./store";

if (isProd && !oidcConfigured) {
  console.warn(
    "⚠️  OIDC_CLIENT_SECRET is not set — 'Sign in with FruitScope' is disabled until it is configured.",
  );
}

// Ensure the global Canary AI bot user exists (idempotent). It's added to each
// orchard lazily on bootstrap, so it shows up everywhere without a backfill.
try {
  await canary.ensureUser();
  await canaryCode.ensureUser();
} catch (err) {
  console.warn("⚠️  Could not ensure the Canary bot user:", err);
}

// Local dev: create the media bucket in the fake-gcs emulator if it's missing.
// (In prod the bucket is provisioned by Terraform.)
if (usingGcsEmulator) {
  try {
    await ensureMediaBucket();
    console.log("🪣  Media bucket ready (fake-gcs emulator)");
  } catch (err) {
    console.warn("⚠️  Could not ensure the media bucket (avatar uploads may fail):", err);
  }
}

const app = express();
app.set("trust proxy", true); // behind the GCP load balancer
app.use(compression()); // gzip API responses (the static SPA is served by GCS+CDN)
app.use(cors());
app.use(express.json());
app.use(cookieParser()); // reads the httpOnly session cookie
app.use("/api/canary", canaryRoutes);
app.use("/api", api);
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// The static SPA is served separately from GCS + Cloud CDN; this service is
// API + WebSockets only. The load balancer routes /api, /socket.io and /health
// here and everything else to the bucket.

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
  console.log(`🌱 FruitScope Messenger server listening on http://localhost:${PORT}`);
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
