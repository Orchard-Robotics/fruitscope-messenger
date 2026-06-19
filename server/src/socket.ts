import type { Server, Socket } from "socket.io";
import { z } from "zod";

import type {
  ClientToServerEvents,
  ID,
  ServerToClientEvents,
  SocketData,
} from "@shared/index";
import { REACTION_EMOJI } from "@shared/index";
import { resolveToken } from "./auth";
import { canAccess, channels, messages, orchards, reads, users } from "./store";

type InterServerEvents = Record<string, never>;

export type IOServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
type IOSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/* Rooms are namespaced by orchard so broadcasts never cross tenants. */
const orchRoom = (orchardId: ID): string => `orch:${orchardId}`;
const userRoom = (orchardId: ID, userId: ID): string => `u:${orchardId}:${userId}`;
const chanRoom = (channelId: ID): string => `chan:${channelId}`;

const TYPING_TTL_MS = 5_000;

/** `${orchardId}:${userId}` -> live socket ids (presence, per orchard). */
const liveByOrchard = new Map<string, Set<string>>();
/** userId -> total live socket count (across orchards), for global status. */
const userSocketCount = new Map<ID, number>();
/** channelId -> (userId -> auto-stop timer). */
const typingByChannel = new Map<ID, Map<ID, ReturnType<typeof setTimeout>>>();

/* -------------------------------- validation ------------------------------- */

const sendSchema = z.object({
  channelId: z.string().min(1),
  content: z.string().trim().min(1).max(4000),
});
const reactSchema = z.object({ messageId: z.string().min(1), emoji: z.enum(REACTION_EMOJI) });
const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .transform((s) => s.replace(/\s+/g, "-").toLowerCase()),
  topic: z.string().trim().max(140).optional(),
  isPrivate: z.boolean().optional(),
});
const channelRef = z.object({ channelId: z.string().min(1) });
const historySchema = z.object({
  channelId: z.string().min(1),
  before: z.object({ createdAt: z.number().positive(), id: z.string().min(1) }).optional(),
});
const dmSchema = z.object({ userId: z.string().min(1) });

const HISTORY_PAGE = 30;

/* -------------------------------- typing ----------------------------------- */

function emitTyping(io: IOServer, channelId: ID): void {
  const typers = typingByChannel.get(channelId);
  io.to(chanRoom(channelId)).emit("typing:update", {
    channelId,
    userIds: typers ? [...typers.keys()] : [],
  });
}

function stopTyping(io: IOServer, channelId: ID, userId: ID): void {
  const typers = typingByChannel.get(channelId);
  const timer = typers?.get(userId);
  if (!typers || timer === undefined) return;
  clearTimeout(timer);
  typers.delete(userId);
  if (typers.size === 0) typingByChannel.delete(channelId);
  emitTyping(io, channelId);
}

function startTyping(io: IOServer, channelId: ID, userId: ID): void {
  const typers = typingByChannel.get(channelId) ?? new Map<ID, ReturnType<typeof setTimeout>>();
  const existing = typers.get(userId);
  if (existing !== undefined) clearTimeout(existing);
  typers.set(
    userId,
    setTimeout(() => stopTyping(io, channelId, userId), TYPING_TTL_MS),
  );
  typingByChannel.set(channelId, typers);
  emitTyping(io, channelId);
}

/* -------------------------------- presence --------------------------------- */

async function onConnect(io: IOServer, socket: IOSocket, userId: ID, orchardId: ID): Promise<void> {
  const key = `${orchardId}:${userId}`;
  const sockets = liveByOrchard.get(key) ?? new Set<string>();
  const wasOffline = sockets.size === 0;
  sockets.add(socket.id);
  liveByOrchard.set(key, sockets);
  userSocketCount.set(userId, (userSocketCount.get(userId) ?? 0) + 1);

  socket.join(orchRoom(orchardId));
  socket.join(userRoom(orchardId, userId));
  for (const channel of await channels.visibleTo(userId, orchardId)) socket.join(chanRoom(channel.id));

  if (wasOffline) {
    const me = await users.setStatus(userId, "online");
    if (me) io.to(orchRoom(orchardId)).emit("user:upserted", me);
  }
}

async function onDisconnect(io: IOServer, socket: IOSocket, userId: ID, orchardId: ID): Promise<void> {
  const key = `${orchardId}:${userId}`;
  const sockets = liveByOrchard.get(key);
  if (sockets) {
    sockets.delete(socket.id);
    if (sockets.size === 0) {
      liveByOrchard.delete(key);
      io.to(orchRoom(orchardId)).emit("presence:update", { userId, status: "offline" });
    }
  }

  const remaining = (userSocketCount.get(userId) ?? 1) - 1;
  if (remaining <= 0) {
    userSocketCount.delete(userId);
    await users.setStatus(userId, "offline");
  } else {
    userSocketCount.set(userId, remaining);
  }

  for (const [channelId, typers] of typingByChannel) {
    if (typers.has(userId)) stopTyping(io, channelId, userId);
  }
}

/* ------------------------------ wiring ------------------------------------- */

export function attachSockets(io: IOServer): void {
  io.use((socket, next) => {
    void (async () => {
      try {
        const token: unknown = socket.handshake.auth?.token;
        const scope = typeof token === "string" ? await resolveToken(token) : undefined;
        if (!scope) {
          next(new Error("Unauthorized"));
          return;
        }
        socket.data.userId = scope.userId;
        socket.data.orchardId = scope.orchardId;
        next();
      } catch (err) {
        next(err instanceof Error ? err : new Error("Auth failed"));
      }
    })();
  });

  io.on("connection", (socket) => {
    void registerSocket(io, socket);
  });
}

async function registerSocket(io: IOServer, socket: IOSocket): Promise<void> {
  const { userId, orchardId } = socket.data;
  await onConnect(io, socket, userId, orchardId);

  socket.on("message:send", async (payload, ack) => {
    const parsed = sendSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid message" });

    const channel = await channels.byId(parsed.data.channelId);
    if (!channel || !canAccess(channel, userId, orchardId)) {
      return ack({ ok: false, error: "You can't post here" });
    }

    const message = await messages.create(channel.id, userId, parsed.data.content);
    io.to(chanRoom(channel.id)).emit("message:new", message);
    stopTyping(io, channel.id, userId);
    ack({ ok: true, data: message });
  });

  socket.on("message:react", async (payload, ack) => {
    const parsed = reactSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid reaction" });

    const target = await messages.byId(parsed.data.messageId);
    const channel = target ? await channels.byId(target.channelId) : undefined;
    if (!target || !channel || !canAccess(channel, userId, orchardId)) {
      return ack({ ok: false, error: "Message not found" });
    }

    const updated = await messages.toggleReaction(target.id, userId, parsed.data.emoji);
    if (!updated) return ack({ ok: false, error: "Message not found" });
    io.to(chanRoom(channel.id)).emit("message:updated", updated);
    ack({ ok: true, data: updated });
  });

  socket.on("channel:create", async (payload, ack) => {
    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid channel name" });

    const { name, topic, isPrivate } = parsed.data;
    const channel = await channels.create({
      orchardId,
      kind: "channel",
      name,
      ...(topic !== undefined ? { topic } : {}),
      ...(isPrivate !== undefined ? { isPrivate } : {}),
      createdBy: userId,
      memberIds: [userId],
    });

    if (channel.isPrivate) {
      void io.in(userRoom(orchardId, userId)).socketsJoin(chanRoom(channel.id));
      io.to(userRoom(orchardId, userId)).emit("channel:created", channel);
    } else {
      void io.in(orchRoom(orchardId)).socketsJoin(chanRoom(channel.id));
      io.to(orchRoom(orchardId)).emit("channel:created", channel);
    }
    ack({ ok: true, data: channel });
  });

  socket.on("channel:join", async (payload, ack) => {
    const parsed = channelRef.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid channel" });

    const channel = await channels.byId(parsed.data.channelId);
    if (!channel || !canAccess(channel, userId, orchardId)) {
      return ack({ ok: false, error: "Channel not found" });
    }

    const updated = (await channels.addMember(channel.id, userId)) ?? channel;
    socket.join(chanRoom(channel.id));
    io.to(chanRoom(channel.id)).emit("channel:updated", updated);
    ack({ ok: true, data: updated });
  });

  socket.on("dm:open", async (payload, ack) => {
    const parsed = dmSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid user" });

    const otherId = parsed.data.userId;
    if (otherId === userId) return ack({ ok: false, error: "You can't DM yourself" });
    if (!(await orchards.isMember(orchardId, otherId))) {
      return ack({ ok: false, error: "User is not in this orchard" });
    }

    const existing = await channels.findDm(orchardId, userId, otherId);
    if (existing) return ack({ ok: true, data: existing });

    const channel = await channels.create({
      orchardId,
      kind: "dm",
      name: "",
      isPrivate: true,
      createdBy: userId,
      memberIds: [userId, otherId],
    });

    for (const member of [userId, otherId]) {
      void io.in(userRoom(orchardId, member)).socketsJoin(chanRoom(channel.id));
      io.to(userRoom(orchardId, member)).emit("channel:created", channel);
    }
    ack({ ok: true, data: channel });
  });

  socket.on("channel:history", async (payload, ack) => {
    const parsed = historySchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid request" });

    const channel = await channels.byId(parsed.data.channelId);
    if (!channel || !canAccess(channel, userId, orchardId)) {
      return ack({ ok: false, error: "Channel not found" });
    }
    const page = await messages.page(channel.id, {
      ...(parsed.data.before ? { before: parsed.data.before } : {}),
      limit: HISTORY_PAGE,
    });
    ack({ ok: true, data: page });
  });

  socket.on("typing:start", (payload) => {
    const parsed = channelRef.safeParse(payload);
    if (parsed.success) startTyping(io, parsed.data.channelId, userId);
  });

  socket.on("typing:stop", (payload) => {
    const parsed = channelRef.safeParse(payload);
    if (parsed.success) stopTyping(io, parsed.data.channelId, userId);
  });

  socket.on("channel:read", (payload) => {
    const parsed = channelRef.safeParse(payload);
    if (parsed.success) void reads.set(userId, parsed.data.channelId, Date.now());
  });

  socket.on("disconnect", () => void onDisconnect(io, socket, userId, orchardId));
}
