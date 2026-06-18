import { create } from "zustand";

import type { Bootstrap, Channel, ID, Message, Orchard, User, UserStatus } from "@shared/index";

export type SessionStatus = "loading" | "anon" | "ready";

interface ChatState {
  /* session */
  token: string | null;
  me: User | null;
  /** The orchard this session is scoped to. */
  orchard: Orchard | null;
  session: SessionStatus;
  connected: boolean;

  /* data, keyed by id */
  users: Record<ID, User>;
  channels: Record<ID, Channel>;
  messages: Record<ID, Message[]>;
  historyComplete: Record<ID, boolean>;

  /* ui */
  activeChannelId: ID | null;
  typing: Record<ID, ID[]>;
  unread: Record<ID, number>;

  /* session actions */
  signIn: (token: string, me: User) => void;
  signOut: () => void;
  setSession: (session: SessionStatus) => void;
  setConnected: (connected: boolean) => void;
  loadBootstrap: (data: Bootstrap) => void;

  /* data actions */
  upsertUser: (user: User) => void;
  setPresence: (userId: ID, status: UserStatus) => void;
  upsertChannel: (channel: Channel) => void;
  addMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  prependHistory: (channelId: ID, msgs: Message[]) => void;
  setTyping: (channelId: ID, userIds: ID[]) => void;

  /* ui actions */
  setActiveChannel: (channelId: ID) => void;
}

const HISTORY_PAGE = 30;

const toRecord = <T extends { id: ID }>(items: T[]): Record<ID, T> =>
  Object.fromEntries(items.map((item) => [item.id, item]));

/** Prefer #general, else the earliest-created public channel, else anything. */
function pickInitialChannel(channels: Channel[]): ID | null {
  const ordered = [...channels].sort((a, b) => a.createdAt - b.createdAt);
  const general = ordered.find((c) => c.kind === "channel" && c.name === "general");
  const firstPublic = ordered.find((c) => c.kind === "channel");
  return (general ?? firstPublic ?? ordered[0])?.id ?? null;
}

export const useChatStore = create<ChatState>((set, get) => ({
  token: null,
  me: null,
  orchard: null,
  session: "loading",
  connected: false,

  users: {},
  channels: {},
  messages: {},
  historyComplete: {},

  activeChannelId: null,
  typing: {},
  unread: {},

  // Sets identity but keeps `session` as-is; `loadBootstrap` flips to "ready"
  // once data has arrived so the workspace never flashes empty.
  signIn: (token, me) => set({ token, me }),

  signOut: () =>
    set({
      token: null,
      me: null,
      orchard: null,
      session: "anon",
      connected: false,
      users: {},
      channels: {},
      messages: {},
      historyComplete: {},
      activeChannelId: null,
      typing: {},
      unread: {},
    }),

  setSession: (session) => set({ session }),
  setConnected: (connected) => set({ connected }),

  loadBootstrap: (data) =>
    set((state) => {
      // We're connected, so we're online — own presence events can race the
      // bootstrap fetch, so assert it here rather than trust the snapshot.
      const me: User = { ...data.me, status: "online" };
      const users = toRecord(data.users);
      users[me.id] = me;
      return {
        me,
        orchard: data.orchard,
        users,
        channels: toRecord(data.channels),
        messages: data.messages,
        session: "ready",
        activeChannelId: state.activeChannelId ?? pickInitialChannel(data.channels),
      };
    }),

  upsertUser: (user) => set((s) => ({ users: { ...s.users, [user.id]: user } })),

  setPresence: (userId, status) =>
    set((s) => {
      const user = s.users[userId];
      if (!user) return {};
      return { users: { ...s.users, [userId]: { ...user, status } } };
    }),

  upsertChannel: (channel) => set((s) => ({ channels: { ...s.channels, [channel.id]: channel } })),

  addMessage: (message) =>
    set((s) => {
      const list = s.messages[message.channelId] ?? [];
      if (list.some((m) => m.id === message.id)) return {};

      const isActive = s.activeChannelId === message.channelId;
      const mine = message.authorId === s.me?.id;
      const unread =
        !isActive && !mine
          ? { ...s.unread, [message.channelId]: (s.unread[message.channelId] ?? 0) + 1 }
          : s.unread;

      return {
        messages: { ...s.messages, [message.channelId]: [...list, message] },
        unread,
      };
    }),

  updateMessage: (message) =>
    set((s) => {
      const list = s.messages[message.channelId];
      if (!list) return {};
      return {
        messages: {
          ...s.messages,
          [message.channelId]: list.map((m) => (m.id === message.id ? message : m)),
        },
      };
    }),

  prependHistory: (channelId, msgs) =>
    set((s) => {
      const existing = s.messages[channelId] ?? [];
      const seen = new Set(existing.map((m) => m.id));
      const fresh = msgs.filter((m) => !seen.has(m.id));
      return {
        messages: { ...s.messages, [channelId]: [...fresh, ...existing] },
        historyComplete: { ...s.historyComplete, [channelId]: msgs.length < HISTORY_PAGE },
      };
    }),

  setTyping: (channelId, userIds) => set((s) => ({ typing: { ...s.typing, [channelId]: userIds } })),

  setActiveChannel: (channelId) => {
    if (get().activeChannelId === channelId) return;
    set((s) => ({ activeChannelId: channelId, unread: { ...s.unread, [channelId]: 0 } }));
  },
}));
