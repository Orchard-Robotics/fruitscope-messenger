import { io, type Socket } from "socket.io-client";

import type {
  Channel,
  ClientToServerEvents,
  ID,
  Message,
  Result,
  ServerToClientEvents,
} from "@shared/index";
import { rest } from "@/lib/api";
import { useChatStore } from "@/store/store";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** If an ack doesn't arrive in time (e.g. the instance was recycled mid-send). */
const ACK_TIMEOUT_MS = 10_000;

let socket: ChatSocket | null = null;
let sessionToken: string | null = null;
let hasConnectedOnce = false;

/** Connect (idempotently) and bind every server event to a store mutation. */
export function connectSocket(token: string): ChatSocket {
  if (socket) return socket;

  sessionToken = token;
  socket = io({ auth: { token }, transports: ["websocket", "polling"] });
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
  sessionToken = null;
  hasConnectedOnce = false;
}

async function resync(): Promise<void> {
  if (!sessionToken) return;
  try {
    useChatStore.getState().loadBootstrap(await rest.bootstrap(sessionToken));
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

  createChannel: (input: {
    name: string;
    topic?: string;
    isPrivate?: boolean;
  }): Promise<Result<Channel>> => withAck((cb) => getSocket().emit("channel:create", input, cb)),

  openDm: (userId: ID): Promise<Result<Channel>> =>
    withAck((cb) => getSocket().emit("dm:open", { userId }, cb)),

  history: (channelId: ID, before: number): Promise<Result<Message[]>> =>
    withAck((cb) => getSocket().emit("channel:history", { channelId, before }, cb)),

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
