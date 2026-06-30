import type { Server } from "socket.io";

import type {
  ClientToServerEvents,
  ID,
  Message,
  ServerToClientEvents,
  SocketData,
} from "@shared/index";

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Room name for a channel — mirrors socket.ts's `chanRoom`. */
const chanRoom = (channelId: ID): string => `chan:${channelId}`;

/**
 * A view of a message safe for non-admin recipients: Canary's admin-only
 * reasoning removed. A no-op (returns the same object) when there's nothing to
 * hide, so normal messages pay nothing.
 */
export function redactMessage(msg: Message, isAdmin: boolean): Message {
  if (isAdmin || msg.canaryReasoning == null) return msg;
  return { ...msg, canaryReasoning: null };
}

/** Strip admin-only reasoning from a list of messages for a non-admin viewer. */
export function redactMessages(msgs: Message[], isAdmin: boolean): Message[] {
  if (isAdmin || !msgs.some((m) => m.canaryReasoning != null)) return msgs;
  return msgs.map((m) => redactMessage(m, false));
}

/**
 * Emit a message event to a channel room, hiding Canary's admin-only reasoning
 * from non-admin recipients. Messages without reasoning take the plain room-emit
 * fast path; only a reasoning-bearing message (a Canary @mention reply) fans out
 * per-socket so admins get the thinking and everyone else gets the clean message.
 */
export async function emitMessage(
  io: IO,
  channelId: ID,
  event: "message:new" | "message:updated",
  msg: Message,
): Promise<void> {
  if (msg.canaryReasoning == null) {
    io.to(chanRoom(channelId)).emit(event, msg);
    return;
  }
  const stripped = redactMessage(msg, false);
  const sockets = await io.in(chanRoom(channelId)).fetchSockets();
  for (const s of sockets) {
    s.emit(event, s.data.isSuperAdmin ? msg : stripped);
  }
}
