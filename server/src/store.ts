import { Prisma } from "@prisma/client";
import type { User as DbUser } from "@prisma/client";
import { nanoid } from "nanoid";

import type {
  Bootstrap,
  Channel,
  ChannelKind,
  ID,
  Message,
  Reaction,
  User,
  UserStatus,
} from "@shared/index";
import { prisma } from "./prisma";

/* ------------------------------------------------------------------ */
/* Row → DTO mapping                                                   */
/* ------------------------------------------------------------------ */

type DbChannel = Prisma.ChannelGetPayload<{ include: { members: true } }>;
type DbMessage = Prisma.MessageGetPayload<{ include: { reactions: true } }>;

const channelInclude = { members: true } satisfies Prisma.ChannelInclude;
const messageInclude = { reactions: true } satisfies Prisma.MessageInclude;

function mapUser(row: DbUser): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    hue: row.hue,
    status: row.status as UserStatus,
    createdAt: row.createdAt.getTime(),
  };
}

function mapChannel(row: DbChannel): Channel {
  return {
    id: row.id,
    kind: row.kind as ChannelKind,
    name: row.name,
    topic: row.topic,
    isPrivate: row.isPrivate,
    memberIds: row.members.map((m) => m.userId),
    createdBy: row.createdById,
    createdAt: row.createdAt.getTime(),
  };
}

function mapMessage(row: DbMessage): Message {
  const byEmoji = new Map<string, ID[]>();
  for (const r of row.reactions) {
    const ids = byEmoji.get(r.emoji) ?? [];
    ids.push(r.userId);
    byEmoji.set(r.emoji, ids);
  }
  const reactions: Reaction[] = [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds }));

  return {
    id: row.id,
    channelId: row.channelId,
    authorId: row.authorId,
    content: row.content,
    createdAt: row.createdAt.getTime(),
    editedAt: row.editedAt ? row.editedAt.getTime() : null,
    reactions,
  };
}

/** Map a username to a stable avatar hue (0–360). */
function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export const users = {
  all: async (): Promise<User[]> => (await prisma.user.findMany()).map(mapUser),

  byId: async (id: ID): Promise<User | undefined> => {
    const row = await prisma.user.findUnique({ where: { id } });
    return row ? mapUser(row) : undefined;
  },

  byUsername: async (username: string): Promise<User | undefined> => {
    const row = await prisma.user.findUnique({ where: { username } });
    return row ? mapUser(row) : undefined;
  },

  create: async (username: string, displayName: string): Promise<User> => {
    const row = await prisma.user.create({
      data: { id: nanoid(10), username, displayName, hue: hashHue(username) },
    });
    return mapUser(row);
  },

  setStatus: async (id: ID, status: UserStatus): Promise<User | undefined> => {
    try {
      return mapUser(await prisma.user.update({ where: { id }, data: { status } }));
    } catch {
      return undefined;
    }
  },
};

/* ------------------------------------------------------------------ */
/* Channels                                                            */
/* ------------------------------------------------------------------ */

export const channels = {
  byId: async (id: ID): Promise<Channel | undefined> => {
    const row = await prisma.channel.findUnique({ where: { id }, include: channelInclude });
    return row ? mapChannel(row) : undefined;
  },

  /** Public channels are visible to everyone; private channels & DMs only to members. */
  visibleTo: async (userId: ID): Promise<Channel[]> => {
    const rows = await prisma.channel.findMany({
      where: {
        OR: [
          { kind: "channel", isPrivate: false },
          { members: { some: { userId } } },
        ],
      },
      include: channelInclude,
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapChannel);
  },

  create: async (input: {
    kind: ChannelKind;
    name: string;
    topic?: string;
    isPrivate?: boolean;
    createdBy: ID;
    memberIds: ID[];
  }): Promise<Channel> => {
    const row = await prisma.channel.create({
      data: {
        id: nanoid(10),
        kind: input.kind,
        name: input.name,
        topic: input.topic ?? "",
        isPrivate: input.isPrivate ?? false,
        createdBy: { connect: { id: input.createdBy } },
        members: { create: input.memberIds.map((userId) => ({ user: { connect: { id: userId } } })) },
      },
      include: channelInclude,
    });
    return mapChannel(row);
  },

  addMember: async (channelId: ID, userId: ID): Promise<Channel | undefined> => {
    await prisma.channelMember.upsert({
      where: { channelId_userId: { channelId, userId } },
      create: { channelId, userId },
      update: {},
    });
    return channels.byId(channelId);
  },

  findDm: async (a: ID, b: ID): Promise<Channel | undefined> => {
    const row = await prisma.channel.findFirst({
      where: {
        kind: "dm",
        AND: [{ members: { some: { userId: a } } }, { members: { some: { userId: b } } }],
      },
      include: channelInclude,
    });
    return row ? mapChannel(row) : undefined;
  },
};

/** A user may read/write a channel if it is public, or they are a member. */
export function canAccess(channel: Channel, userId: ID): boolean {
  return (channel.kind === "channel" && !channel.isPrivate) || channel.memberIds.includes(userId);
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

export const messages = {
  byId: async (id: ID): Promise<Message | undefined> => {
    const row = await prisma.message.findUnique({ where: { id }, include: messageInclude });
    return row ? mapMessage(row) : undefined;
  },

  /** Returns up to `limit` messages (optionally before a cursor), oldest-first. */
  forChannel: async (
    channelId: ID,
    opts: { before?: number; limit: number },
  ): Promise<Message[]> => {
    const rows = await prisma.message.findMany({
      where: {
        channelId,
        ...(opts.before !== undefined ? { createdAt: { lt: new Date(opts.before) } } : {}),
      },
      include: messageInclude,
      orderBy: { createdAt: "desc" },
      take: opts.limit,
    });
    return rows.reverse().map(mapMessage);
  },

  create: async (channelId: ID, authorId: ID, content: string): Promise<Message> => {
    const row = await prisma.message.create({
      data: { id: nanoid(12), channelId, authorId, content },
      include: messageInclude,
    });
    return mapMessage(row);
  },

  toggleReaction: async (
    messageId: ID,
    userId: ID,
    emoji: string,
  ): Promise<Message | undefined> => {
    const existing = await prisma.reaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
    });
    if (existing) await prisma.reaction.delete({ where: { id: existing.id } });
    else await prisma.reaction.create({ data: { messageId, userId, emoji } });

    return messages.byId(messageId);
  },
};

/* ------------------------------------------------------------------ */
/* Read receipts                                                       */
/* ------------------------------------------------------------------ */

export const reads = {
  set: async (userId: ID, channelId: ID, at: number): Promise<void> => {
    const lastReadAt = new Date(at);
    await prisma.read.upsert({
      where: { userId_channelId: { userId, channelId } },
      create: { userId, channelId, lastReadAt },
      update: { lastReadAt },
    });
  },
};

/* ------------------------------------------------------------------ */
/* Bootstrap snapshot                                                  */
/* ------------------------------------------------------------------ */

export async function bootstrap(userId: ID): Promise<Bootstrap> {
  const me = await users.byId(userId);
  if (!me) throw new Error(`Unknown user ${userId}`);

  const [allUsers, visible] = await Promise.all([users.all(), channels.visibleTo(userId)]);

  const entries = await Promise.all(
    visible.map(
      async (channel) => [channel.id, await messages.forChannel(channel.id, { limit: 50 })] as const,
    ),
  );

  return { me, users: allUsers, channels: visible, messages: Object.fromEntries(entries) };
}
