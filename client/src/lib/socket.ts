import { io, type Socket } from "socket.io-client";

import type {
  Channel,
  ClientToServerEvents,
  ID,
  Message,
  MessageCursor,
  MessagePage,
  MessageWindow,
  Result,
  ServerToClientEvents,
} from "@shared/index";
import { rest } from "@/lib/api";
import { useChatStore } from "@/store/store";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** If an ack doesn't arrive in time (e.g. the instance was recycled mid-send). */
const ACK_TIMEOUT_MS = 10_000;

let socket: ChatSocket | null = null;
let hasConnectedOnce = false;

/** Connect (idempotently) and bind every server event to a store mutation. */
export function connectSocket(): ChatSocket {
  if (socket) return socket;

  // The handshake carries the httpOnly session cookie (same-origin), so there's
  // no token to pass — the server reads the cookie to scope the socket.
  socket = io({ withCredentials: true, transports: ["websocket", "polling"] });
  const store = useChatStore.getState;

  socket.on("connect", () => {
    store().setConnected(true);
    // On *re*connect (after a drop / Cloud Run respawn), re-hydrate so we don't
    // miss anything that happened while we were gone. The first connect is
    // already covered by the initial bootstrap.
    if (hasConnectedOnce) void resync();
    hasConnectedOnce = true;
  });
  socket.on("disconnect", () => store().setConnected(false));

  socket.on("message:new", (m) => store().addMessage(m));
  socket.on("message:updated", (m) => store().updateMessage(m));
  socket.on("channel:created", (c) => store().upsertChannel(c));
  socket.on("channel:updated", (c) => store().upsertChannel(c));
  socket.on("user:upserted", (u) => store().upsertUser(u));
  socket.on("presence:update", ({ userId, status }) => store().setPresence(userId, status));
  socket.on("typing:update", ({ channelId, userIds }) => store().setTyping(channelId, userIds));

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  hasConnectedOnce = false;
}

async function resync(): Promise<void> {
  try {
    const store = useChatStore.getState();
    store.loadBootstrap(await rest.bootstrap());
    // Refresh the open channel's recent page so we catch anything missed while
    // disconnected (other channels re-hydrate lazily when next opened).
    const active = store.activeChannelId;
    if (active) {
      const res = await chat.history(active);
      if (res.ok) useChatStore.getState().setInitialPage(active, res.data);
    }
  } catch {
    /* best-effort; the next event or reconnect will reconcile */
  }
}

function getSocket(): ChatSocket {
  if (!socket) throw new Error("Socket not connected");
  return socket;
}

/** Resolve to the ack, or a failure Result if it doesn't arrive in time. */
function withAck<T>(run: (cb: (res: Result<T>) => void) => void): Promise<Result<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res: Result<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: "Timed out — check your connection" }),
      ACK_TIMEOUT_MS,
    );
    try {
      run(finish);
    } catch {
      finish({ ok: false, error: "Not connected" });
    }
  });
}

/** Typed wrappers around socket emits. Acked calls resolve to a `Result`. */
export const chat = {
  send: (channelId: ID, content: string): Promise<Result<Message>> =>
    withAck((cb) => getSocket().emit("message:send", { channelId, content }, cb)),

  react: (messageId: ID, emoji: string): Promise<Result<Message>> =>
    withAck((cb) => getSocket().emit("message:react", { messageId, emoji }, cb)),

  edit: (messageId: ID, content: string): Promise<Result<Message>> =>
    withAck((cb) => getSocket().emit("message:edit", { messageId, content }, cb)),

  createChannel: (input: {
    name: string;
    topic?: string;
    isPrivate?: boolean;
  }): Promise<Result<Channel>> => withAck((cb) => getSocket().emit("channel:create", input, cb)),

  openDm: (userId: ID): Promise<Result<Channel>> =>
    withAck((cb) => getSocket().emit("dm:open", { userId }, cb)),

  openGroup: (userIds: ID[]): Promise<Result<Channel>> =>
    withAck((cb) => getSocket().emit("dm:openGroup", { userIds }, cb)),

  addMembers: (channelId: ID, userIds: ID[]): Promise<Result<Channel>> =>
    withAck((cb) => getSocket().emit("channel:addMembers", { channelId, userIds }, cb)),

  history: (channelId: ID, before?: MessageCursor): Promise<Result<MessagePage>> =>
    withAck((cb) =>
      getSocket().emit("channel:history", { channelId, ...(before ? { before } : {}) }, cb),
    ),

  /** Load a window of messages centered on a target (for jumping to a result). */
  around: (channelId: ID, cursor: MessageCursor): Promise<Result<MessageWindow>> =>
    withAck((cb) => getSocket().emit("channel:around", { channelId, cursor }, cb)),

  /** Load a window centered on a message by id (opening a shared deep link). */
  aroundMessage: (channelId: ID, messageId: ID): Promise<Result<MessageWindow>> =>
    withAck((cb) => getSocket().emit("channel:aroundMessage", { channelId, messageId }, cb)),

  typingStart: (channelId: ID): void => {
    getSocket().emit("typing:start", { channelId });
  },
  typingStop: (channelId: ID): void => {
    getSocket().emit("typing:stop", { channelId });
  },
  read: (channelId: ID): void => {
    getSocket().emit("channel:read", { channelId });
  },
};
