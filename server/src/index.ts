import { createServer } from "node:http";

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
app.use(cors());
app.use(express.json());
app.use("/api", api);
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

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

const shutdown = async (): Promise<void> => {
  await prisma.$disconnect();
  httpServer.close(() => process.exit(0));
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
