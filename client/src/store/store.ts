import { create } from "zustand";

import type {
  Bootstrap,
  Channel,
  ID,
  Message,
  MessagePage,
  Orchard,
  User,
  UserStatus,
} from "@shared/index";

export type SessionStatus = "loading" | "anon" | "ready";

interface ChatState {
  /* session */
  me: User | null;
  /** The orchard this session is scoped to. */
  orchard: Orchard | null;
  /** Whether the signed-in user is a FruitScope super admin (can switch orchards). */
  isSuperAdmin: boolean;
  session: SessionStatus;
  connected: boolean;

  /* data, keyed by id — messages hold only a bounded recent window per channel */
  users: Record<ID, User>;
  channels: Record<ID, Channel>;
  messages: Record<ID, Message[]>;
  /** Whether a channel's first page has been loaded (lazy, on open). */
  hydrated: Record<ID, boolean>;
  /** Whether we've paged back to the channel's very first message. */
  historyComplete: Record<ID, boolean>;

  /* ui */
  activeChannelId: ID | null;
  typing: Record<ID, ID[]>;
  unread: Record<ID, number>;

  /* session actions */
  signIn: (me: User) => void;
  /** Update the signed-in user (e.g. after a profile-picture change). */
  setMe: (me: User) => void;
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
  /** Most-recent page for a channel (initial open / resync) — merges live msgs. */
  setInitialPage: (channelId: ID, page: MessagePage) => void;
  /** Older page prepended on scroll-up. */
  prependPage: (channelId: ID, page: MessagePage) => void;
  setTyping: (channelId: ID, userIds: ID[]) => void;

  /* ui actions */
  setActiveChannel: (channelId: ID) => void;
}

/** Max messages kept in memory per channel — bounds the store + DOM. */
const MEMORY_CAP = 200;

const byChrono = (a: Message, b: Message): number =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

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
  me: null,
  orchard: null,
  isSuperAdmin: false,
  session: "loading",
  connected: false,

  users: {},
  channels: {},
  messages: {},
  hydrated: {},
  historyComplete: {},

  activeChannelId: null,
  typing: {},
  unread: {},

  // Sets identity but keeps `session` as-is; `loadBootstrap` flips to "ready"
  // once data has arrived so the workspace never flashes empty.
  signIn: (me) => set({ me }),

  setMe: (me) => set((s) => ({ me, users: { ...s.users, [me.id]: me } })),

  signOut: () =>
    set({
      me: null,
      orchard: null,
      isSuperAdmin: false,
      session: "anon",
      connected: false,
      users: {},
      channels: {},
      messages: {},
      hydrated: {},
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
      // Messages are NOT in the bootstrap — channels hydrate lazily on open.
      // Existing message windows are preserved (matters on reconnect/resync).
      return {
        me,
        orchard: data.orchard,
        isSuperAdmin: data.isSuperAdmin,
        users,
        channels: toRecord(data.channels),
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

      let next = [...list, message];
      let historyComplete = s.historyComplete;
      // Bound memory: trimming from the front means older messages are no longer
      // all in memory, so allow scroll-up to re-fetch them.
      if (next.length > MEMORY_CAP) {
        next = next.slice(next.length - MEMORY_CAP);
        historyComplete = { ...s.historyComplete, [message.channelId]: false };
      }

      const isActive = s.activeChannelId === message.channelId;
      const mine = message.authorId === s.me?.id;
      const unread =
        !isActive && !mine
          ? { ...s.unread, [message.channelId]: (s.unread[message.channelId] ?? 0) + 1 }
          : s.unread;

      return { messages: { ...s.messages, [message.channelId]: next }, unread, historyComplete };
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

  setInitialPage: (channelId, page) =>
    set((s) => {
      // Merge the authoritative recent page with any live messages that arrived
      // before/while hydrating (dedup by id, keep chronological order).
      const existing = s.messages[channelId] ?? [];
      const byId = new Map<ID, Message>();
      for (const m of page.messages) byId.set(m.id, m);
      for (const m of existing) byId.set(m.id, m);
      const merged = [...byId.values()].sort(byChrono);
      return {
        messages: { ...s.messages, [channelId]: merged },
        hydrated: { ...s.hydrated, [channelId]: true },
        historyComplete: { ...s.historyComplete, [channelId]: !page.hasMore },
      };
    }),

  prependPage: (channelId, page) =>
    set((s) => {
      const existing = s.messages[channelId] ?? [];
      const seen = new Set(existing.map((m) => m.id));
      const fresh = page.messages.filter((m) => !seen.has(m.id));
      return {
        messages: { ...s.messages, [channelId]: [...fresh, ...existing] },
        historyComplete: { ...s.historyComplete, [channelId]: !page.hasMore },
      };
    }),

  setTyping: (channelId, userIds) => set((s) => ({ typing: { ...s.typing, [channelId]: userIds } })),

  setActiveChannel: (channelId) => {
    const prev = get().activeChannelId;
    if (prev === channelId) return;
    set((s) => {
      const base = { activeChannelId: channelId, unread: { ...s.unread, [channelId]: 0 } };
      // Free the deep-scroll history of the channel we're leaving, keeping only a
      // recent window so re-opening still shows context instantly.
      const leaving = prev ? s.messages[prev] : undefined;
      if (prev && leaving && leaving.length > MEMORY_CAP) {
        return {
          ...base,
          messages: { ...s.messages, [prev]: leaving.slice(leaving.length - MEMORY_CAP) },
          historyComplete: { ...s.historyComplete, [prev]: false },
        };
      }
      return base;
    });
  },
}));
