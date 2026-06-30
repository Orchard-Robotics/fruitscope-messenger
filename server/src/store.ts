import { Prisma } from "@prisma/client";
import type { Orchard as DbOrchard, User as DbUser } from "@prisma/client";
import { nanoid } from "nanoid";

import type {
  AdminUser,
  Bootstrap,
  Channel,
  ChannelKind,
  ID,
  Message,
  MessageCursor,
  MessagePage,
  MessageWindow,
  Orchard,
  Reaction,
  User,
  UserStatus,
} from "@shared/index";
import type { FruitscopeIdentity } from "./oidc";
import { prisma } from "./prisma";
import { publicUrl } from "./storage";

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
    isBot: row.isBot,
    hue: row.hue,
    // Build the public CDN/emulator URL from the stored key at read time.
    avatarUrl: row.avatarKey ? publicUrl(row.avatarKey) : null,
    status: row.status as UserStatus,
    createdAt: row.createdAt.getTime(),
  };
}

function mapOrchard(row: DbOrchard): Orchard {
  return { id: row.id, code: row.code, name: row.name, createdAt: row.createdAt.getTime() };
}

function mapChannel(row: DbChannel): Channel {
  return {
    id: row.id,
    orchardId: row.orchardId,
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
    // Admin-only Canary thinking. The socket layer strips this before it reaches
    // non-admin recipients (see redactMessage), so non-admins never receive it.
    canaryReasoning: row.canaryReasoning,
  };
}

/** Map a seed (username / OIDC sub) to a stable avatar hue (0–360). */
function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/** A minimal orchard for the picker / fallback cache. */
export interface OrchardLite {
  code: string;
  name: string;
}

/** Seed list of accessible orchards from the OIDC claim (codes; primary has a name). */
function seedOrchardsFromIdentity(identity: FruitscopeIdentity): OrchardLite[] {
  const byCode = new Map<string, string>();
  for (const code of identity.orchardCodes) byCode.set(code, code);
  if (identity.primaryOrchard) byCode.set(identity.primaryOrchard.code, identity.primaryOrchard.name);
  return [...byCode].map(([code, name]) => ({ code, name }));
}

/** Coerce a stored JSON value back into a clean OrchardLite[] (or null). */
function parseOrchardsCache(raw: unknown): OrchardLite[] | null {
  if (!Array.isArray(raw)) return null;
  const list = raw
    .filter((x): x is { code: string; name?: unknown } => !!x && typeof x === "object" && typeof (x as { code?: unknown }).code === "string")
    .map((x) => ({ code: x.code, name: typeof x.name === "string" && x.name ? x.name : x.code }));
  return list.length ? list : null;
}

/** Reduce an arbitrary handle to the allowed username charset. */
function sanitizeHandle(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || "user";
}

/** First unused username at/after `base` (`base`, `base-2`, `base-3`, …). */
async function freeUsername(base: string): Promise<string> {
  let candidate = base;
  let n = 2;
  while (await prisma.user.findUnique({ where: { username: candidate } })) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

/* ------------------------------------------------------------------ */
/* Orchards (tenants)                                                  */
/* ------------------------------------------------------------------ */

export const orchards = {
  all: async (): Promise<Orchard[]> =>
    (await prisma.orchard.findMany({ orderBy: { name: "asc" } })).map(mapOrchard),

  byId: async (id: ID): Promise<Orchard | undefined> => {
    const row = await prisma.orchard.findUnique({ where: { id } });
    return row ? mapOrchard(row) : undefined;
  },

  /** Users who belong to an orchard. */
  members: async (orchardId: ID): Promise<User[]> => {
    const rows = await prisma.user.findMany({
      where: { orchards: { some: { orchardId } } },
      orderBy: { displayName: "asc" },
    });
    return rows.map(mapUser);
  },

  /** Orchards the user is a member of (the regular user's switcher list). */
  forUser: async (userId: ID): Promise<Orchard[]> => {
    const rows = await prisma.orchard.findMany({
      where: { members: { some: { userId } } },
      orderBy: { name: "asc" },
    });
    return rows.map(mapOrchard);
  },

  isMember: async (orchardId: ID, userId: ID): Promise<boolean> =>
    (await prisma.orchardMembership.count({ where: { orchardId, userId } })) > 0,

  ensureMembership: async (orchardId: ID, userId: ID): Promise<void> => {
    await prisma.orchardMembership.upsert({
      where: { orchardId_userId: { orchardId, userId } },
      create: { orchardId, userId },
      update: {},
    });
  },

  /** Add (or update the role of) a member — used by the FruitScope sync. */
  upsertMembership: async (orchardId: ID, userId: ID, role: string): Promise<void> => {
    await prisma.orchardMembership.upsert({
      where: { orchardId_userId: { orchardId, userId } },
      create: { orchardId, userId, role },
      update: { role },
    });
  },

  /**
   * Find-or-create an orchard by its FruitScope code. New orchards are created
   * lazily the first time a member of them signs in (first writer sets the name).
   */
  upsertByCode: async (code: string, name: string): Promise<Orchard> => {
    const row = await prisma.orchard.upsert({
      where: { code },
      create: { id: nanoid(10), code, name },
      update: {},
    });
    return mapOrchard(row);
  },

  /** Find an orchard by its code (or undefined) — used to guard manual creates. */
  byCode: async (code: string): Promise<Orchard | undefined> => {
    const row = await prisma.orchard.findUnique({ where: { code } });
    return row ? mapOrchard(row) : undefined;
  },
};

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export const users = {
  byId: async (id: ID): Promise<User | undefined> => {
    const row = await prisma.user.findUnique({ where: { id } });
    return row ? mapUser(row) : undefined;
  },

  isSuperAdmin: async (id: ID): Promise<boolean> =>
    (await prisma.user.findUnique({ where: { id } }))?.isSuperAdmin ?? false,

  /** Of the given OIDC subs, which already have a local user — for sync previews. */
  existingOidcSubs: async (subs: string[]): Promise<Set<string>> => {
    if (subs.length === 0) return new Set();
    const rows = await prisma.user.findMany({
      where: { oidcSub: { in: subs } },
      select: { oidcSub: true },
    });
    return new Set(rows.map((r) => r.oidcSub));
  },

  displayName: async (id: ID): Promise<string | undefined> =>
    (await prisma.user.findUnique({ where: { id } }))?.displayName,

  /**
   * Every real user (the Canary bot excluded) with their orchard memberships +
   * roles — for the admin User Management page / masquerade picker.
   */
  allForAdmin: async (): Promise<AdminUser[]> => {
    const rows = await prisma.user.findMany({
      where: { isBot: false },
      include: { orchards: { include: { orchard: true } } },
      orderBy: { displayName: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      email: row.email,
      avatarUrl: row.avatarKey ? publicUrl(row.avatarKey) : null,
      hue: row.hue,
      status: row.status as UserStatus,
      isSuperAdmin: row.isSuperAdmin,
      isBot: row.isBot,
      orchards: row.orchards.map((m) => ({
        code: m.orchard.code,
        name: m.orchard.name,
        role: m.role,
      })),
    }));
  },

  /** Current avatar object key (to delete the old object on change/removal). */
  avatarKey: async (id: ID): Promise<string | null> =>
    (await prisma.user.findUnique({ where: { id } }))?.avatarKey ?? null,

  /** Set (or clear, with null) the avatar object key; returns the updated user. */
  setAvatarKey: async (id: ID, key: string | null): Promise<User> =>
    mapUser(await prisma.user.update({ where: { id }, data: { avatarKey: key } })),

  /**
   * Provision (or refresh) the local user record from a verified FruitScope
   * identity. Keyed by the OIDC `sub`; display name / email / admin flag are
   * re-synced on every login so the snapshot tracks the IdP.
   */
  upsertFromOidc: async (identity: FruitscopeIdentity): Promise<User> => {
    const displayName =
      identity.displayName ?? identity.preferredUsername ?? identity.email ?? "FruitScope user";

    // The `session_jwt` we'll act with against the FruitScope API (Canary). Only
    // overwrite the stored token when the claim actually carries one, so a path
    // without it (dev-login) never clears a previously-captured token.
    const ttl = identity.authJwtTtlSeconds ?? 24 * 60 * 60;
    const jwtData = identity.authJwt
      ? {
          fruitscopeAuthJwt: identity.authJwt,
          fruitscopeAuthJwtExpiresAt: new Date(Date.now() + ttl * 1000),
        }
      : {};

    // Seed the orchard fallback cache from the claim on first login (or if it was
    // never populated); a successful /user-info later overwrites it with names.
    const seed = seedOrchardsFromIdentity(identity) as unknown as Prisma.InputJsonValue;
    const seedLen = seedOrchardsFromIdentity(identity).length;

    const existing = await prisma.user.findUnique({ where: { oidcSub: identity.sub } });
    if (existing) {
      const row = await prisma.user.update({
        where: { id: existing.id },
        data: {
          displayName,
          email: identity.email ?? null,
          isSuperAdmin: identity.isSuperAdmin,
          ...jwtData,
          ...(existing.fruitscopeOrchardsCache == null && seedLen
            ? { fruitscopeOrchardsCache: seed }
            : {}),
        },
      });
      return mapUser(row);
    }

    const base = sanitizeHandle(
      identity.preferredUsername ?? identity.email?.split("@")[0] ?? `user-${identity.sub}`,
    );
    const row = await prisma.user.create({
      data: {
        id: nanoid(10),
        oidcSub: identity.sub,
        username: await freeUsername(base),
        displayName,
        email: identity.email ?? null,
        isSuperAdmin: identity.isSuperAdmin,
        hue: hashHue(identity.sub),
        ...jwtData,
        ...(seedLen ? { fruitscopeOrchardsCache: seed } : {}),
      },
    });
    return mapUser(row);
  },

  /**
   * Provision (or refresh) a local user from a FruitScope sync — for users who
   * haven't logged in yet. Keyed by the OIDC `sub` (= the FruitScope user id as a
   * string), so when they later sign in, `upsertFromOidc` finds this same record
   * instead of creating a duplicate. Never sets a session token (they have none
   * until they log in) and only ever PROMOTES to admin, never demotes.
   */
  upsertFromFruitscope: async (input: {
    userId: number;
    name: string | null;
    email: string | null;
    makeAdmin: boolean;
  }): Promise<{ user: User; created: boolean }> => {
    const oidcSub = String(input.userId);
    const niceName = input.name?.trim() || null;
    const email = input.email?.trim() || null;

    const existing = await prisma.user.findUnique({ where: { oidcSub } });
    if (existing) {
      const row = await prisma.user.update({
        where: { id: existing.id },
        data: {
          ...(niceName ? { displayName: niceName } : {}),
          ...(email ? { email } : {}),
          ...(input.makeAdmin ? { isSuperAdmin: true } : {}),
        },
      });
      return { user: mapUser(row), created: false };
    }

    const displayName = niceName ?? email ?? `FruitScope user ${input.userId}`;
    const base = sanitizeHandle(email?.split("@")[0] || niceName || `user-${input.userId}`);
    const row = await prisma.user.create({
      data: {
        id: nanoid(10),
        oidcSub,
        username: await freeUsername(base),
        displayName,
        email,
        isSuperAdmin: input.makeAdmin,
        hue: hashHue(oidcSub),
      },
    });
    return { user: mapUser(row), created: true };
  },

  /**
   * The user's current FruitScope `auth_jwt` for API calls (Canary), or null if
   * we never captured one or it has expired. The proxy presents this to
   * api.fruitscope.com as the `auth_jwt` cookie. Never leaves the server.
   */
  fruitscopeAuthJwt: async (id: ID): Promise<string | null> => {
    const row = await prisma.user.findUnique({ where: { id } });
    if (!row?.fruitscopeAuthJwt) return null;
    if (row.fruitscopeAuthJwtExpiresAt && row.fruitscopeAuthJwtExpiresAt.getTime() < Date.now()) {
      return null;
    }
    return row.fruitscopeAuthJwt;
  },

  /** The cached accessible-orchard fallback list (or null if we have none). */
  fruitscopeOrchards: async (id: ID): Promise<OrchardLite[] | null> => {
    const row = await prisma.user.findUnique({
      where: { id },
      select: { fruitscopeOrchardsCache: true },
    });
    return parseOrchardsCache(row?.fruitscopeOrchardsCache);
  },

  /** Refresh the fallback cache after a successful /user-info fetch. */
  setFruitscopeOrchards: async (id: ID, list: OrchardLite[]): Promise<void> => {
    await prisma.user.update({
      where: { id },
      data: { fruitscopeOrchardsCache: list as unknown as Prisma.InputJsonValue },
    });
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
/* Canary — the built-in AI assistant (a global bot)                   */
/* ------------------------------------------------------------------ */

/** The Canary bot's stable identity. Fixed id so the client can rely on it. */
export const CANARY = {
  id: "canary",
  oidcSub: "fruitscope:canary-bot",
  username: "canary",
  displayName: "Canary",
  /** A warm canary-yellow hue for the avatar fallback. */
  hue: 47,
} as const;

export const canary = {
  /** Find-or-create the global Canary bot user (idempotent; call on boot). */
  ensureUser: async (): Promise<User> => {
    const row = await prisma.user.upsert({
      where: { id: CANARY.id },
      // Bots are always "present"; they never hold a socket, so this status sticks.
      create: {
        id: CANARY.id,
        oidcSub: CANARY.oidcSub,
        username: CANARY.username,
        displayName: CANARY.displayName,
        isBot: true,
        status: "online",
        hue: CANARY.hue,
      },
      update: { isBot: true, displayName: CANARY.displayName, status: "online" },
    });
    return mapUser(row);
  },

  /**
   * Ensure Canary is a member of an orchard, so it shows up in the people list
   * and a DM can be opened with it. Lazy + idempotent — called when an orchard is
   * bootstrapped, so the bot is global without a one-shot backfill.
   */
  ensureMembership: async (orchardId: ID): Promise<void> => {
    await canary.ensureUser();
    await orchards.ensureMembership(orchardId, CANARY.id);
  },
};

/** Whether a user id is the Canary bot. */
export const isCanary = (userId: ID): boolean => userId === CANARY.id;

/* ------------------------------------------------------------------ */
/* Generic LLM bots — admin-created, run under a chosen pi-ai model     */
/* ------------------------------------------------------------------ */

export const bots = {
  /** Create an admin-configured LLM bot and add it to its workspace. */
  create: async (input: {
    displayName: string;
    orchardId: ID;
    model: string;
    systemPrompt: string;
  }): Promise<User> => {
    const oidcSub = `bot:${nanoid(12)}`; // never collides with numeric OIDC subs
    const displayName = input.displayName.trim() || "Bot";
    const row = await prisma.user.create({
      data: {
        id: nanoid(10),
        oidcSub,
        username: await freeUsername(sanitizeHandle(displayName)),
        displayName,
        isBot: true,
        status: "online",
        hue: hashHue(oidcSub),
        botModel: input.model,
        botSystemPrompt: input.systemPrompt,
      },
    });
    await orchards.ensureMembership(input.orchardId, row.id);
    return mapUser(row);
  },

  /** A bot's runtime config (model + system prompt), or null if not an LLM bot. */
  config: async (
    botId: ID,
  ): Promise<{ displayName: string; model: string; systemPrompt: string } | null> => {
    const row = await prisma.user.findUnique({ where: { id: botId } });
    if (!row || !row.isBot || !row.botModel) return null;
    return { displayName: row.displayName, model: row.botModel, systemPrompt: row.botSystemPrompt ?? "" };
  },
};

/* ------------------------------------------------------------------ */
/* Channels — always scoped to an orchard                              */
/* ------------------------------------------------------------------ */

export const channels = {
  byId: async (id: ID): Promise<Channel | undefined> => {
    const row = await prisma.channel.findUnique({ where: { id }, include: channelInclude });
    return row ? mapChannel(row) : undefined;
  },

  /** Channels in `orchardId` that are public, or that the user is a member of. */
  visibleTo: async (userId: ID, orchardId: ID): Promise<Channel[]> => {
    const rows = await prisma.channel.findMany({
      where: {
        orchardId,
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
    orchardId: ID;
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
        orchard: { connect: { id: input.orchardId } },
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

  findDm: async (orchardId: ID, a: ID, b: ID): Promise<Channel | undefined> => {
    const row = await prisma.channel.findFirst({
      where: {
        orchardId,
        kind: "dm",
        AND: [{ members: { some: { userId: a } } }, { members: { some: { userId: b } } }],
      },
      include: channelInclude,
    });
    return row ? mapChannel(row) : undefined;
  },

  /**
   * Find a DM whose member set is EXACTLY the given users (any size: self, 1:1,
   * or group) — so opening a group DM reuses the existing conversation.
   */
  findByMembers: async (orchardId: ID, memberIds: ID[]): Promise<Channel | undefined> => {
    const ids = [...new Set(memberIds)];
    const rows = await prisma.channel.findMany({
      where: { orchardId, kind: "dm", members: { every: { userId: { in: ids } } } },
      include: channelInclude,
    });
    // `every` allows subsets; an equal member count means an exact match.
    const match = rows.find((r) => r.members.length === ids.length);
    return match ? mapChannel(match) : undefined;
  },

  /** The "message yourself" DM: a dm whose only member is the user. */
  findSelfDm: async (orchardId: ID, userId: ID): Promise<Channel | undefined> => {
    const row = await prisma.channel.findFirst({
      where: {
        orchardId,
        kind: "dm",
        // every member is me (and at least one) → exactly the self-DM, never a
        // two-person DM that happens to include me.
        members: { some: { userId }, every: { userId } },
      },
      include: channelInclude,
    });
    return row ? mapChannel(row) : undefined;
  },
};

/**
 * A user may read/write a channel only within their orchard, and only if it is
 * public or they are a member.
 */
export function canAccess(channel: Channel, userId: ID, orchardId: ID): boolean {
  if (channel.orchardId !== orchardId) return false;
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

  /**
   * One page of a channel's messages, oldest-first, plus whether older messages
   * remain. Keyset pagination over (createdAt, id) — an index range-scan that
   * costs O(limit) regardless of channel size. Omit `before` for the newest page.
   */
  page: async (
    channelId: ID,
    opts: { before?: MessageCursor; limit: number },
  ): Promise<MessagePage> => {
    const before = opts.before;
    const cursor: Prisma.MessageWhereInput = before
      ? {
          OR: [
            { createdAt: { lt: new Date(before.createdAt) } },
            { createdAt: new Date(before.createdAt), id: { lt: before.id } },
          ],
        }
      : {};

    // Fetch one extra row to detect whether an older page exists.
    const rows = await prisma.message.findMany({
      where: { channelId, ...cursor },
      include: messageInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: opts.limit + 1,
    });

    const hasMore = rows.length > opts.limit;
    const pageRows = hasMore ? rows.slice(0, opts.limit) : rows;
    return { messages: pageRows.reverse().map(mapMessage), hasMore };
  },

  create: async (
    channelId: ID,
    authorId: ID,
    content: string,
    canaryReasoning?: string | null,
  ): Promise<Message> => {
    const row = await prisma.message.create({
      data: {
        id: nanoid(12),
        channelId,
        authorId,
        content,
        ...(canaryReasoning ? { canaryReasoning } : {}),
      },
      include: messageInclude,
    });
    return mapMessage(row);
  },

  /** Edit a message's text (caller checks authorship); stamps `editedAt`. */
  edit: async (id: ID, content: string): Promise<Message | undefined> => {
    try {
      const row = await prisma.message.update({
        where: { id },
        data: { content, editedAt: new Date() },
        include: messageInclude,
      });
      return mapMessage(row);
    } catch {
      return undefined; // gone
    }
  },

  /**
   * Full-text-ish search across the given channels (the caller passes the ones
   * the user may see). Case-insensitive substring match, newest first — backed
   * by the trigram GIN index on content, so it stays fast as history grows.
   */
  search: async (channelIds: ID[], query: string, limit: number): Promise<Message[]> => {
    if (channelIds.length === 0) return [];
    const rows = await prisma.message.findMany({
      where: { channelId: { in: channelIds }, content: { contains: query, mode: "insensitive" } },
      include: messageInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return rows.map(mapMessage);
  },

  /** A window centered on a message identified by id (deep-link open), or null
   *  if it's gone or not in this channel. */
  aroundById: async (channelId: ID, messageId: ID, half: number): Promise<MessageWindow | null> => {
    const target = await prisma.message.findUnique({ where: { id: messageId } });
    if (!target || target.channelId !== channelId) return null;
    return messages.around(channelId, { createdAt: target.createdAt.getTime(), id: target.id }, half);
  },

  /**
   * A window of messages centered on `cursor` (the target): up to `half` older,
   * the target, and up to `half` newer — oldest-first — for jumping to a result.
   */
  around: async (
    channelId: ID,
    cursor: MessageCursor,
    half: number,
  ): Promise<MessageWindow> => {
    const at = new Date(cursor.createdAt);
    const olderRows = await prisma.message.findMany({
      where: {
        channelId,
        OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }],
      },
      include: messageInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: half + 1,
    });
    // Includes the target (id >= cursor.id at the same instant) then newer ones.
    const targetAndNewer = await prisma.message.findMany({
      where: {
        channelId,
        OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gte: cursor.id } }],
      },
      include: messageInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: half + 2,
    });

    const hasBefore = olderRows.length > half;
    const older = (hasBefore ? olderRows.slice(0, half) : olderRows).reverse();
    const hasAfter = targetAndNewer.length > half + 1;
    const tail = hasAfter ? targetAndNewer.slice(0, half + 1) : targetAndNewer;
    return { messages: [...older, ...tail].map(mapMessage), hasBefore, hasAfter };
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
/* Bootstrap snapshot — for one (user, orchard)                        */
/* ------------------------------------------------------------------ */

export async function bootstrap(userId: ID, orchardId: ID): Promise<Bootstrap> {
  // Canary is a global bot — lazily ensure it's a member of whatever orchard is
  // being bootstrapped, so it always appears in the people/DM list (no backfill).
  await canary.ensureMembership(orchardId);

  const [meRow, orchard] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    orchards.byId(orchardId),
  ]);
  if (!meRow) throw new Error(`Unknown user ${userId}`);
  if (!orchard) throw new Error(`Unknown orchard ${orchardId}`);

  // No messages here — the client loads each channel's first page lazily on open
  // (and older pages on scroll), so connect stays O(1) in channel count.
  const [members, visible] = await Promise.all([
    orchards.members(orchardId),
    channels.visibleTo(userId, orchardId),
  ]);

  return {
    me: mapUser(meRow),
    orchard,
    users: members,
    channels: visible,
    isSuperAdmin: meRow.isSuperAdmin,
    // Canary "general" mode is Orchard Robotics staff only (matches the
    // FruitScope backend gate, which is strictly email-domain based).
    canUseGeneralMode: (meRow.email ?? "").trim().toLowerCase().endsWith("@orchard-robotics.com"),
    // Set by the /bootstrap route when this session is masquerading.
    masquerade: null,
  };
}
