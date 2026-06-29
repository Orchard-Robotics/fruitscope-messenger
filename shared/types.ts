/**
 * Domain model shared between the server and the client.
 * Kept intentionally small and serialisable (plain JSON over the wire).
 */

export type ID = string;

/** Unix epoch milliseconds. */
export type Timestamp = number;

export type UserStatus = "online" | "away" | "offline";

export interface User {
  id: ID;
  username: string;
  displayName: string;
  /** A stable HSL hue (0–360) used to render the avatar gradient fallback. */
  hue: number;
  /**
   * Public URL of the user's uploaded profile picture, or null when they have
   * none (the client falls back to the hue gradient + initials). Served from GCS
   * behind a CDN in prod, and from the local fake-gcs emulator in development.
   */
  avatarUrl: string | null;
  status: UserStatus;
  createdAt: Timestamp;
}

/**
 * A tenant: each orchard has its own isolated chat environment (members,
 * channels, DMs, messages) — like a Slack workspace, scoped per orchard.
 */
export interface Orchard {
  id: ID;
  /** Orchard code (e.g. "SEA"), matching FruitScope's orchard codes. */
  code: string;
  name: string;
  createdAt: Timestamp;
}

export type ChannelKind = "channel" | "dm";

export interface Channel {
  id: ID;
  /** The orchard this channel belongs to. Everything is scoped by orchard. */
  orchardId: ID;
  kind: ChannelKind;
  /** Human name for `channel`; for `dm` the client derives a name from members. */
  name: string;
  topic: string;
  isPrivate: boolean;
  memberIds: ID[];
  createdBy: ID;
  createdAt: Timestamp;
}

export interface Reaction {
  emoji: string;
  userIds: ID[];
}

export interface Message {
  id: ID;
  channelId: ID;
  authorId: ID;
  content: string;
  createdAt: Timestamp;
  editedAt: Timestamp | null;
  reactions: Reaction[];
}

/**
 * Everything the client needs to render one orchard's workspace on connect.
 * Messages are intentionally NOT included — they are loaded lazily per channel
 * (most recent page on open, older pages on scroll) so the initial payload is
 * O(1) in channel count, not O(channels × messages).
 */
export interface Bootstrap {
  me: User;
  /** The active orchard this session is scoped to. */
  orchard: Orchard;
  /** Members of this orchard. */
  users: User[];
  channels: Channel[];
  /**
   * Whether the signed-in user is a FruitScope super admin. Super admins land on
   * the orchard-robotics namespace and may switch into any other orchard via the
   * workspace switcher; regular users are scoped to the orchards they belong to.
   */
  isSuperAdmin: boolean;
}

/**
 * Keyset-pagination cursor: a stable total order over (createdAt, id). Paging
 * by this (rather than a bare timestamp) avoids dropping/duplicating messages
 * that share a millisecond at a page boundary.
 */
export interface MessageCursor {
  createdAt: Timestamp;
  id: ID;
}

/** A page of messages (oldest-first) plus whether older messages remain. */
export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
}

/**
 * A window of messages centered on a target (for jumping to a search result):
 * some older messages, the target, and some newer ones, oldest-first — plus
 * whether more exist on each side.
 */
export interface MessageWindow {
  messages: Message[];
  hasBefore: boolean;
  hasAfter: boolean;
}

/** Discriminated result returned through Socket.IO acknowledgements. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Curated reaction palette — keeps the picker tasteful and the payloads tiny. */
export const REACTION_EMOJI = ["🌱", "🌿", "☀️", "🍃", "🔥", "💚", "👏", "🎉"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];
