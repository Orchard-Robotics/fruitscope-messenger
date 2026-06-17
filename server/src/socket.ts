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
import { canAccess, channels, messages, reads, users } from "./store";

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

const userRoom = (id: ID): string => `user:${id}`;
const chanRoom = (id: ID): string => `chan:${id}`;

const TYPING_TTL_MS = 5_000;

/** userId -> set of live socket ids (presence). */
const liveSockets = new Map<ID, Set<string>>();
/** channelId -> (userId -> auto-stop timer). */
const typingByChannel = new Map<ID, Map<ID, ReturnType<typeof setTimeout>>>();

/* -------------------------------- validation ------------------------------- */

const sendSchema = z.object({
  channelId: z.string().min(1),
  content: z.string().trim().min(1).max(4000),
});
const reactSchema = z.object({
  messageId: z.string().min(1),
  emoji: z.enum(REACTION_EMOJI),
});
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
const historySchema = z.object({ channelId: z.string().min(1), before: z.number().positive() });
const dmSchema = z.object({ userId: z.string().min(1) });

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

async function onConnect(io: IOServer, socket: IOSocket, userId: ID): Promise<void> {
  const sockets = liveSockets.get(userId) ?? new Set<string>();
  const wasOffline = sockets.size === 0;
  sockets.add(socket.id);
  liveSockets.set(userId, sockets);

  socket.join(userRoom(userId));
  for (const channel of await channels.visibleTo(userId)) socket.join(chanRoom(channel.id));

  if (wasOffline) {
    const me = await users.setStatus(userId, "online");
    if (me) io.emit("user:upserted", me);
  }
}

function onDisconnect(io: IOServer, socket: IOSocket, userId: ID): void {
  const sockets = liveSockets.get(userId);
  if (sockets) {
    sockets.delete(socket.id);
    if (sockets.size === 0) {
      liveSockets.delete(userId);
      void users.setStatus(userId, "offline");
      io.emit("presence:update", { userId, status: "offline" });
    }
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
        const userId = typeof token === "string" ? await resolveToken(token) : undefined;
        if (!userId) {
          next(new Error("Unauthorized"));
          return;
        }
        socket.data.userId = userId;
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
  const userId = socket.data.userId;
  await onConnect(io, socket, userId);

  socket.on("message:send", async (payload, ack) => {
    const parsed = sendSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid message" });

    const channel = await channels.byId(parsed.data.channelId);
    if (!channel || !canAccess(channel, userId)) {
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
    if (!target || !channel || !canAccess(channel, userId)) {
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
      kind: "channel",
      name,
      ...(topic !== undefined ? { topic } : {}),
      ...(isPrivate !== undefined ? { isPrivate } : {}),
      createdBy: userId,
      memberIds: [userId],
    });

    if (channel.isPrivate) {
      void io.in(userRoom(userId)).socketsJoin(chanRoom(channel.id));
      io.to(userRoom(userId)).emit("channel:created", channel);
    } else {
      void io.socketsJoin(chanRoom(channel.id));
      io.emit("channel:created", channel);
    }
    ack({ ok: true, data: channel });
  });

  socket.on("channel:join", async (payload, ack) => {
    const parsed = channelRef.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid channel" });

    const channel = await channels.byId(parsed.data.channelId);
    if (!channel || !canAccess(channel, userId)) {
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
    if (!(await users.byId(otherId))) return ack({ ok: false, error: "User not found" });

    const existing = await channels.findDm(userId, otherId);
    if (existing) return ack({ ok: true, data: existing });

    const channel = await channels.create({
      kind: "dm",
      name: "",
      isPrivate: true,
      createdBy: userId,
      memberIds: [userId, otherId],
    });

    for (const member of [userId, otherId]) {
      void io.in(userRoom(member)).socketsJoin(chanRoom(channel.id));
      io.to(userRoom(member)).emit("channel:created", channel);
    }
    ack({ ok: true, data: channel });
  });

  socket.on("channel:history", async (payload, ack) => {
    const parsed = historySchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid request" });

    const channel = await channels.byId(parsed.data.channelId);
    if (!channel || !canAccess(channel, userId)) {
      return ack({ ok: false, error: "Channel not found" });
    }
    const history = await messages.forChannel(channel.id, {
      before: parsed.data.before,
      limit: 30,
    });
    ack({ ok: true, data: history });
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

  socket.on("disconnect", () => onDisconnect(io, socket, userId));
}
