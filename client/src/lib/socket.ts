import { io, type Socket } from "socket.io-client";

import type {
  Channel,
  ClientToServerEvents,
  ID,
  Message,
  Result,
  ServerToClientEvents,
} from "@shared/index";
import { useChatStore } from "@/store/store";

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: ChatSocket | null = null;

/** Connect (idempotently) and bind every server event to a store mutation. */
export function connectSocket(token: string): ChatSocket {
  if (socket) return socket;

  socket = io({ auth: { token }, transports: ["websocket", "polling"] });
  const store = useChatStore.getState;

  socket.on("connect", () => store().setConnected(true));
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
}

function getSocket(): ChatSocket {
  if (!socket) throw new Error("Socket not connected");
  return socket;
}

const withAck = <T>(run: (cb: (res: Result<T>) => void) => void): Promise<Result<T>> =>
  new Promise((resolve) => run(resolve));

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
