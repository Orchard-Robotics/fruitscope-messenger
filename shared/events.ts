import type {
  Channel,
  ID,
  Message,
  MessageCursor,
  MessagePage,
  MessageWindow,
  Result,
  User,
  UserStatus,
} from "./types";

/**
 * Strongly-typed Socket.IO event maps. Both ends import these so the wire
 * protocol is checked at compile time — payloads, acks and all.
 */

export interface ServerToClientEvents {
  "message:new": (message: Message) => void;
  "message:updated": (message: Message) => void;
  "channel:created": (channel: Channel) => void;
  "channel:updated": (channel: Channel) => void;
  "user:upserted": (user: User) => void;
  "presence:update": (payload: { userId: ID; status: UserStatus }) => void;
  "typing:update": (payload: { channelId: ID; userIds: ID[] }) => void;
}

export interface ClientToServerEvents {
  "message:send": (
    payload: { channelId: ID; content: string },
    ack: (res: Result<Message>) => void,
  ) => void;
  "message:react": (
    payload: { messageId: ID; emoji: string },
    ack: (res: Result<Message>) => void,
  ) => void;
  // Edit your own message's text. Sets `editedAt`; broadcasts message:updated.
  "message:edit": (
    payload: { messageId: ID; content: string },
    ack: (res: Result<Message>) => void,
  ) => void;
  "channel:create": (
    payload: { name: string; topic?: string; isPrivate?: boolean },
    ack: (res: Result<Channel>) => void,
  ) => void;
  "channel:join": (
    payload: { channelId: ID },
    ack: (res: Result<Channel>) => void,
  ) => void;
  // Add other people to a channel (e.g. after @mentioning a non-member) — the
  // "Add them to the channel?" action. Returns the updated channel.
  "channel:addMembers": (
    payload: { channelId: ID; userIds: ID[] },
    ack: (res: Result<Channel>) => void,
  ) => void;
  // Loads a window centered on a message by id (for opening a shared deep link,
  // where we only know the channel + message id, not the cursor). Fails if the
  // message is gone or not in this channel.
  "channel:aroundMessage": (
    payload: { channelId: ID; messageId: ID },
    ack: (res: Result<MessageWindow>) => void,
  ) => void;
  // Loads one page of a channel's messages. Omit `before` for the most recent
  // page (initial open); pass the oldest loaded cursor to page backwards.
  "channel:history": (
    payload: { channelId: ID; before?: MessageCursor },
    ack: (res: Result<MessagePage>) => void,
  ) => void;
  // Loads a window of messages centered on a target cursor — for jumping to a
  // search result deep in history.
  "channel:around": (
    payload: { channelId: ID; cursor: MessageCursor },
    ack: (res: Result<MessageWindow>) => void,
  ) => void;
  "dm:open": (payload: { userId: ID }, ack: (res: Result<Channel>) => void) => void;
  // Open (or create) a multi-person direct message with the given people (you're
  // always included). Reuses an existing DM with the exact same set.
  "dm:openGroup": (payload: { userIds: ID[] }, ack: (res: Result<Channel>) => void) => void;
  "typing:start": (payload: { channelId: ID }) => void;
  "typing:stop": (payload: { channelId: ID }) => void;
  "channel:read": (payload: { channelId: ID }) => void;
}

/** Data attached to every authenticated socket (server-side bookkeeping). */
export interface SocketData {
  userId: ID;
  /** The orchard this socket is scoped to — every operation is bound to it. */
  orchardId: ID;
  /** True when an admin is masquerading — used to suppress fake presence. */
  masquerading: boolean;
  /**
   * Whether the EFFECTIVE user is a super admin — gates delivery of Canary's
   * admin-only in-channel reasoning. False while masquerading as a non-admin, so
   * the impersonated view never leaks debug context.
   */
  isSuperAdmin: boolean;
}
