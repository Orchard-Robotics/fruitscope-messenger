import { create } from "zustand";

import type {
  Bootstrap,
  Channel,
  ID,
  Message,
  MessagePage,
  MessageWindow,
  Orchard,
  User,
  UserStatus,
} from "@shared/index";
import { contentMentions } from "@/lib/mentions";

/** A request to scroll to + highlight a message (e.g. from a search result). */
export interface JumpTarget {
  channelId: ID;
  messageId: ID;
  /** Bumped each request so re-jumping to the same message re-triggers it. */
  token: number;
}

export type SessionStatus = "loading" | "anon" | "ready";

interface ChatState {
  /* session */
  me: User | null;
  /** The orchard this session is scoped to. */
  orchard: Orchard | null;
  /** Whether the signed-in user is a FruitScope super admin (can switch orchards). */
  isSuperAdmin: boolean;
  /** Whether the user may use Canary's "general" (non-farm) chat mode. */
  canUseGeneralMode: boolean;
  /** Set when a super admin is masquerading — carries the real admin's name. */
  masquerade: { realName: string } | null;
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
  /**
   * Whether a channel is showing a historical window (jumped to an old message)
   * rather than the live tail. Live messages aren't appended while detached;
   * the UI offers "Jump to latest" to return.
   */
  detached: Record<ID, boolean>;
  /** Pending scroll-to-message request (search result jump), or null. */
  jumpTarget: JumpTarget | null;

  /* ui */
  activeChannelId: ID | null;
  typing: Record<ID, ID[]>;
  /** Per-channel bot-to-bot conversation state (drives the "Stop bots" control). */
  botState: Record<ID, { active: boolean; paused: boolean }>;
  unread: Record<ID, number>;
  /** Channels with an unread message that @mentions me (Slack-style emphasis). */
  mentions: Record<ID, boolean>;

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
  /** Replace a channel's window with a window centered on a jump target. */
  setWindowAround: (channelId: ID, window: MessageWindow) => void;
  /** Replace a channel's window with the live recent page ("jump to latest"). */
  setRecentWindow: (channelId: ID, page: MessagePage) => void;
  /** Request a scroll-to + highlight of a message. */
  requestJump: (channelId: ID, messageId: ID) => void;
  clearJump: () => void;
  setTyping: (channelId: ID, userIds: ID[]) => void;
  setBotState: (channelId: ID, active: boolean, paused: boolean) => void;

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
  canUseGeneralMode: false,
  masquerade: null,
  session: "loading",
  connected: false,

  users: {},
  channels: {},
  messages: {},
  hydrated: {},
  historyComplete: {},
  detached: {},
  jumpTarget: null,

  activeChannelId: null,
  typing: {},
  botState: {},
  unread: {},
  mentions: {},

  // Sets identity but keeps `session` as-is; `loadBootstrap` flips to "ready"
  // once data has arrived so the workspace never flashes empty.
  signIn: (me) => set({ me }),

  setMe: (me) => set((s) => ({ me, users: { ...s.users, [me.id]: me } })),

  signOut: () =>
    set({
      me: null,
      orchard: null,
      isSuperAdmin: false,
      canUseGeneralMode: false,
      masquerade: null,
      session: "anon",
      connected: false,
      users: {},
      channels: {},
      messages: {},
      hydrated: {},
      historyComplete: {},
      detached: {},
      jumpTarget: null,
      activeChannelId: null,
      typing: {},
      botState: {},
      unread: {},
      mentions: {},
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
        canUseGeneralMode: data.canUseGeneralMode,
        masquerade: data.masquerade,
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
      const isActiveEarly = s.activeChannelId === message.channelId;
      const mineEarly = message.authorId === s.me?.id;

      // While detached (viewing a historical jump window) we don't append live
      // messages — they'd create a gap. Unread/mention counts still update; the
      // "Jump to latest" affordance brings the user back to live.
      if (s.detached[message.channelId]) {
        const counts = !isActiveEarly && !mineEarly;
        const unread = counts
          ? { ...s.unread, [message.channelId]: (s.unread[message.channelId] ?? 0) + 1 }
          : s.unread;
        const mentionsMe = counts && s.me ? contentMentions(message.content, s.me.id) : false;
        const mentions = mentionsMe
          ? { ...s.mentions, [message.channelId]: true }
          : s.mentions;
        return { unread, mentions };
      }

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
      const countsAsUnread = !isActive && !mine;
      const unread = countsAsUnread
        ? { ...s.unread, [message.channelId]: (s.unread[message.channelId] ?? 0) + 1 }
        : s.unread;
      // Flag the channel if this unread message @mentions me (Slack-style).
      const mentionsMe =
        countsAsUnread && s.me ? contentMentions(message.content, s.me.id) : false;
      const mentions = mentionsMe
        ? { ...s.mentions, [message.channelId]: true }
        : s.mentions;

      return {
        messages: { ...s.messages, [message.channelId]: next },
        unread,
        mentions,
        historyComplete,
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

  setWindowAround: (channelId, window) =>
    set((s) => ({
      messages: { ...s.messages, [channelId]: window.messages },
      hydrated: { ...s.hydrated, [channelId]: true },
      historyComplete: { ...s.historyComplete, [channelId]: !window.hasBefore },
      detached: { ...s.detached, [channelId]: window.hasAfter },
    })),

  setRecentWindow: (channelId, page) =>
    set((s) => ({
      messages: { ...s.messages, [channelId]: page.messages },
      hydrated: { ...s.hydrated, [channelId]: true },
      historyComplete: { ...s.historyComplete, [channelId]: !page.hasMore },
      detached: { ...s.detached, [channelId]: false },
    })),

  requestJump: (channelId, messageId) =>
    set((s) => ({ jumpTarget: { channelId, messageId, token: (s.jumpTarget?.token ?? 0) + 1 } })),

  clearJump: () => set({ jumpTarget: null }),

  setTyping: (channelId, userIds) => set((s) => ({ typing: { ...s.typing, [channelId]: userIds } })),

  setBotState: (channelId, active, paused) =>
    set((s) => ({ botState: { ...s.botState, [channelId]: { active, paused } } })),

  setActiveChannel: (channelId) => {
    const prev = get().activeChannelId;
    if (prev === channelId) return;
    set((s) => {
      const base = {
        activeChannelId: channelId,
        unread: { ...s.unread, [channelId]: 0 },
        mentions: { ...s.mentions, [channelId]: false },
        // A normal channel switch isn't a jump — drop any pending jump.
        jumpTarget: null,
      };
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
