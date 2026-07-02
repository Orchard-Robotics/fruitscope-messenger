import { parse as parseCookie } from "cookie";
import type { Server, Socket } from "socket.io";
import { z } from "zod";

import type {
  ClientToServerEvents,
  ID,
  ServerToClientEvents,
  SocketData,
  User,
} from "@shared/index";
import { REACTION_EMOJI } from "@shared/index";
import { resolveToken } from "./auth";
import { dispatchBotReplies } from "./botAgent";
import { encodeMentions } from "./botRoom";
import { stopBots } from "./botControl";
import { respondAsCanary } from "./canaryAgent";
import { takeCanaryReauth } from "./canaryReauth";
import { SESSION_COOKIE } from "./env";
import { emitMessage, redactMessage, redactMessages } from "./messageEmit";
import { canAccess, channels, mentions, messages, orchards, reads, users } from "./store";

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

/* Set once on attach, so non-socket code (HTTP routes) can broadcast too. */
let ioRef: IOServer | null = null;

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
const editSchema = z.object({
  messageId: z.string().min(1),
  content: z.string().trim().min(1).max(4000),
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
const addMembersSchema = z.object({
  channelId: z.string().min(1),
  userIds: z.array(z.string().min(1)).min(1).max(50),
});
const historySchema = z.object({
  channelId: z.string().min(1),
  before: z.object({ createdAt: z.number().positive(), id: z.string().min(1) }).optional(),
});
const aroundSchema = z.object({
  channelId: z.string().min(1),
  cursor: z.object({ createdAt: z.number().positive(), id: z.string().min(1) }),
});
const dmSchema = z.object({ userId: z.string().min(1) });
const openGroupSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(8),
});

const HISTORY_PAGE = 30;
/** Messages loaded on each side of a jump target. */
const AROUND_HALF = 20;

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
  // Always join the rooms so a masquerading admin sees + can act in the channels.
  socket.join(orchRoom(orchardId));
  socket.join(userRoom(orchardId, userId));
  for (const channel of await channels.visibleTo(userId, orchardId)) socket.join(chanRoom(channel.id));

  // Masquerade is invisible: don't track presence (it would make the impersonated
  // user appear online and corrupt their real socket count on disconnect).
  if (socket.data.masquerading) return;

  const key = `${orchardId}:${userId}`;
  const sockets = liveByOrchard.get(key) ?? new Set<string>();
  const wasOffline = sockets.size === 0;
  sockets.add(socket.id);
  liveByOrchard.set(key, sockets);
  userSocketCount.set(userId, (userSocketCount.get(userId) ?? 0) + 1);

  if (wasOffline) {
    const me = await users.setStatus(userId, "online");
    if (me) io.to(orchRoom(orchardId)).emit("user:upserted", me);
  }
}

async function onDisconnect(io: IOServer, socket: IOSocket, userId: ID, orchardId: ID): Promise<void> {
  // Clear any typing indicators this socket left behind (tracked even for masquerade).
  for (const [channelId, typers] of typingByChannel) {
    if (typers.has(userId)) stopTyping(io, channelId, userId);
  }
  // Masquerade never registered presence, so there's nothing to tear down.
  if (socket.data.masquerading) return;

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
}

/* ------------------------------ wiring ------------------------------------- */

/**
 * Broadcast a changed user (e.g. a new profile picture) to everyone who shares
 * an orchard with them, so avatars update live. Safe to call from HTTP routes.
 */
export async function broadcastUserUpdate(user: User): Promise<void> {
  if (!ioRef) return;
  for (const orchard of await orchards.forUser(user.id)) {
    ioRef.to(orchRoom(orchard.id)).emit("user:upserted", user);
  }
}

/** After a user re-authenticates, finish any Canary reply that stalled on an
 *  expired FruitScope token — their token is now refreshed on the user row. */
export async function resumePendingCanary(userId: ID): Promise<void> {
  if (!ioRef) return;
  for (const channelId of takeCanaryReauth(userId)) {
    void respondAsCanary(ioRef, channelId, userId);
  }
}

export function attachSockets(io: IOServer): void {
  ioRef = io;
  io.use((socket, next) => {
    void (async () => {
      try {
        // The session rides on the httpOnly cookie (sent on the same-origin
        // handshake); fall back to an explicit auth token for non-browser use.
        const header = socket.handshake.headers.cookie;
        const cookieToken = header ? parseCookie(header)[SESSION_COOKIE] : undefined;
        const authToken = socket.handshake.auth?.token;
        const token = cookieToken ?? (typeof authToken === "string" ? authToken : undefined);
        const scope = token ? await resolveToken(token) : undefined;
        if (!scope) {
          next(new Error("Unauthorized"));
          return;
        }
        socket.data.userId = scope.userId;
        socket.data.orchardId = scope.orchardId;
        socket.data.masquerading = scope.masquerading;
        // Effective-user admin flag — gates delivery of Canary's admin-only
        // in-channel reasoning. False while masquerading as a non-admin.
        socket.data.isSuperAdmin = await users.isSuperAdmin(scope.userId);
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

    // Encode @mentions server-side as a safety net: the client composer already
    // turns picked @handles into <@id> tokens, but this also catches a typed
    // "@Brian Yeh" (display name) the composer left as plain text — so a mention
    // reliably becomes a real, notifying token no matter how it was written. Only
    // pay the roster lookup when there's a raw "@name" that isn't already a token.
    const raw = parsed.data.content;
    const hasRawMention = /(^|[^<A-Za-z0-9_.-])@[A-Za-z]/.test(raw);
    const content = hasRawMention
      ? encodeMentions(raw, await orchards.members(orchardId))
      : raw;
    const message = await messages.create(channel.id, userId, content);
    io.to(chanRoom(channel.id)).emit("message:new", message);
    stopTyping(io, channel.id, userId);
    ack({ ok: true, data: message });

    // Fire any bots that should reply (@mentioned, or the partner in a bot DM).
    void dispatchBotReplies(io, channel, message, userId);
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
    // Gated emit: a reaction on a Canary reply must not leak its reasoning to
    // non-admins. The ack goes back to the reactor, redacted unless they're admin.
    await emitMessage(io, channel.id, "message:updated", updated);
    ack({ ok: true, data: redactMessage(updated, socket.data.isSuperAdmin) });
  });

  socket.on("message:edit", async (payload, ack) => {
    const parsed = editSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid edit" });

    const target = await messages.byId(parsed.data.messageId);
    const channel = target ? await channels.byId(target.channelId) : undefined;
    if (!target || !channel || !canAccess(channel, userId, orchardId)) {
      return ack({ ok: false, error: "Message not found" });
    }
    // Only the author may edit (no editing bots' or other people's messages).
    if (target.authorId !== userId) {
      return ack({ ok: false, error: "You can only edit your own messages" });
    }

    const updated = await messages.edit(target.id, parsed.data.content);
    if (!updated) return ack({ ok: false, error: "Message not found" });
    await emitMessage(io, channel.id, "message:updated", updated);
    ack({ ok: true, data: redactMessage(updated, socket.data.isSuperAdmin) });
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

  // Add other people to a channel ("Add them to the channel?" after an @mention).
  socket.on("channel:addMembers", async (payload, ack) => {
    const parsed = addMembersSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid request" });

    const channel = await channels.byId(parsed.data.channelId);
    if (!channel || !canAccess(channel, userId, orchardId)) {
      return ack({ ok: false, error: "Channel not found" });
    }
    if (channel.kind !== "channel") {
      return ack({ ok: false, error: "You can't add people to a direct message" });
    }

    for (const uid of parsed.data.userIds) {
      if (uid === userId) continue;
      if (!(await orchards.isMember(orchardId, uid))) continue;
      await channels.addMember(channel.id, uid);
    }
    const updated = (await channels.byId(channel.id)) ?? channel;

    // Newly-added members join the room and see the channel in their sidebar.
    for (const uid of parsed.data.userIds) {
      void io.in(userRoom(orchardId, uid)).socketsJoin(chanRoom(channel.id));
      io.to(userRoom(orchardId, uid)).emit("channel:created", updated);
    }
    io.to(chanRoom(channel.id)).emit("channel:updated", updated);
    ack({ ok: true, data: updated });
  });

  socket.on("dm:open", async (payload, ack) => {
    const parsed = dmSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid user" });

    const otherId = parsed.data.userId;

    // Message yourself: a DM whose only member is you (Slack's notes space).
    if (otherId === userId) {
      const existing = await channels.findSelfDm(orchardId, userId);
      if (existing) return ack({ ok: true, data: existing });
      const selfDm = await channels.create({
        orchardId,
        kind: "dm",
        name: "",
        isPrivate: true,
        createdBy: userId,
        memberIds: [userId],
      });
      void io.in(userRoom(orchardId, userId)).socketsJoin(chanRoom(selfDm.id));
      io.to(userRoom(orchardId, userId)).emit("channel:created", selfDm);
      return ack({ ok: true, data: selfDm });
    }

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

  // Multi-person (group) DM — like Slack's "new message" to several people.
  socket.on("dm:openGroup", async (payload, ack) => {
    const parsed = openGroupSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid request" });

    const others = [...new Set(parsed.data.userIds)].filter((id) => id !== userId);
    if (others.length === 0) return ack({ ok: false, error: "Pick at least one person" });
    for (const id of others) {
      if (!(await orchards.isMember(orchardId, id))) {
        return ack({ ok: false, error: "Everyone must be in this orchard" });
      }
    }

    const memberIds = [userId, ...others];
    const existing = await channels.findByMembers(orchardId, memberIds);
    if (existing) return ack({ ok: true, data: existing });

    const channel = await channels.create({
      orchardId,
      kind: "dm",
      name: "",
      isPrivate: true,
      createdBy: userId,
      memberIds,
    });

    for (const member of memberIds) {
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
    // Hide Canary's admin-only reasoning from non-admins in history too.
    ack({
      ok: true,
      data: { ...page, messages: redactMessages(page.messages, socket.data.isSuperAdmin) },
    });
  });

  socket.on("channel:around", async (payload, ack) => {
    const parsed = aroundSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid request" });

    const channel = await channels.byId(parsed.data.channelId);
    if (!channel || !canAccess(channel, userId, orchardId)) {
      return ack({ ok: false, error: "Channel not found" });
    }
    const window = await messages.around(channel.id, parsed.data.cursor, AROUND_HALF);
    ack({
      ok: true,
      data: { ...window, messages: redactMessages(window.messages, socket.data.isSuperAdmin) },
    });
  });

  socket.on("channel:aroundMessage", async (payload, ack) => {
    const parsed = channelRef.safeParse({ channelId: payload?.channelId });
    if (!parsed.success || typeof payload?.messageId !== "string") {
      return ack({ ok: false, error: "Invalid request" });
    }
    const channel = await channels.byId(parsed.data.channelId);
    if (!channel || !canAccess(channel, userId, orchardId)) {
      return ack({ ok: false, error: "You can't open that message" });
    }
    const window = await messages.aroundById(channel.id, payload.messageId, AROUND_HALF);
    if (!window) return ack({ ok: false, error: "That message no longer exists" });
    ack({
      ok: true,
      data: { ...window, messages: redactMessages(window.messages, socket.data.isSuperAdmin) },
    });
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
    if (parsed.success) {
      void reads.set(userId, parsed.data.channelId, Date.now());
      void mentions.markRead(userId, parsed.data.channelId);
    }
  });

  // Emergency brake: anyone in the room can stop bots talking to each other.
  socket.on("bots:stop", async (payload) => {
    const parsed = channelRef.safeParse(payload);
    if (!parsed.success) return;
    const channel = await channels.byId(parsed.data.channelId);
    if (channel && canAccess(channel, userId, orchardId)) stopBots(io, channel.id);
  });

  socket.on("disconnect", () => void onDisconnect(io, socket, userId, orchardId));
}
