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
  /** A stable HSL hue (0–360) used to render the avatar gradient. */
  hue: number;
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

/** Everything the client needs to render one orchard's workspace on connect. */
export interface Bootstrap {
  me: User;
  /** The active orchard this session is scoped to. */
  orchard: Orchard;
  /** Members of this orchard. */
  users: User[];
  channels: Channel[];
  /** Most recent messages per channel, oldest-first. */
  messages: Record<ID, Message[]>;
}

/** Discriminated result returned through Socket.IO acknowledgements. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Curated reaction palette — keeps the picker tasteful and the payloads tiny. */
export const REACTION_EMOJI = ["🌱", "🌿", "☀️", "🍃", "🔥", "💚", "👏", "🎉"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];
