import type { Server } from "socket.io";

import type {
  Channel,
  ClientToServerEvents,
  ID,
  Message,
  ServerToClientEvents,
  SocketData,
} from "@shared/index";
import { respondAsCanary } from "./canaryAgent";
import { botsPaused, canBotReplyTo, chainInitiator, recordBotTurn, resetBots } from "./botControl";
import { buildRoster, encodeMentions, mentionGuidance } from "./botRoom";
import { llmComplete } from "./llm";
import { emitMessage } from "./messageEmit";
import { bots, CANARY, channels, messages, users } from "./store";

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

// Room name mirrors socket.ts's `chanRoom`.
const chanRoom = (id: ID): string => `chan:${id}`;
const MENTION_RE = /<@([A-Za-z0-9_-]+)>/g;

/** Distinct user ids @mentioned in a message body. */
function mentionedUserIds(content: string): ID[] {
  return [...new Set([...content.matchAll(MENTION_RE)].map((m) => m[1] as ID))];
}

/** Replace `<@id>` mention tokens with readable `@Name` for the transcript. */
async function withNames(content: string, name: (id: ID) => Promise<string>): Promise<string> {
  let out = content;
  const ids = [...content.matchAll(MENTION_RE)].map((m) => m[1] as ID);
  for (const id of new Set(ids)) out = out.split(`<@${id}>`).join(`@${await name(id)}`);
  return out;
}

/**
 * An admin-created LLM bot was @mentioned (or messaged in its 1:1 DM). Make it a
 * member of the room, build the recent transcript, and answer via its configured
 * model + system prompt. Best-effort — any failure posts a short apology.
 */
export async function respondAsBot(io: IO, channelId: ID, botId: ID): Promise<void> {
  const cfg = await bots.config(botId);
  if (!cfg) return; // not an LLM bot (or deleted)

  const typing = (on: boolean): void => {
    io.to(chanRoom(channelId)).emit("typing:update", { channelId, userIds: on ? [botId] : [] });
  };

  try {
    const channel = await channels.byId(channelId);
    if (!channel) return;
    // Make the bot a visible member of the room it's now chatting in.
    if (!channel.memberIds.includes(botId)) {
      const updated = await channels.addMember(channelId, botId);
      if (updated) io.to(chanRoom(channelId)).emit("channel:updated", updated);
    }

    typing(true);

    // Who's in the room — so the bot can address / @mention people and bots.
    const roster = await buildRoster(channel.orchardId, botId);

    // Recent transcript (oldest→newest), with mentions rendered as @names.
    const page = await messages.page(channelId, { limit: 14 });
    const nameCache = new Map<ID, string>();
    const nameOf = async (id: ID): Promise<string> => {
      if (!nameCache.has(id)) nameCache.set(id, (await users.byId(id))?.displayName ?? "Someone");
      return nameCache.get(id) as string;
    };
    const lines: string[] = [];
    for (const m of page.messages) {
      lines.push(`${await nameOf(m.authorId)}: ${await withNames(m.content, nameOf)}`);
    }

    // The admin's system prompt stays authoritative as the system role; the chat
    // context (roster + transcript + mention rules) rides in the user turn.
    const system = cfg.systemPrompt.trim() || `You are ${cfg.displayName}, a helpful assistant.`;
    const prompt =
      `You are "${cfg.displayName}", a bot participating in a team chat. ` +
      "Continue the conversation: reply to the latest message helpfully and concisely, staying in " +
      "character. Don't repeat the question or add a greeting.\n\n" +
      `People and bots in this workspace:\n${roster.text || "- (just you)"}\n\n` +
      `${mentionGuidance()}\n\n` +
      `Recent conversation:\n${lines.join("\n")}\n\nYour reply:`;

    const reply = await llmComplete({ modelId: cfg.model, system, prompt, maxTokens: 1024 });
    typing(false);

    // Stopped (manually or by the circuit-breaker) while we were thinking? Drop it.
    if (botsPaused(channelId)) return;

    const text = encodeMentions(
      reply || "I’m not sure how to help with that — could you give me a bit more detail?",
      roster.members,
    );
    const msg = await messages.create(channelId, botId, text);
    await emitMessage(io, channelId, "message:new", msg);
    await afterBotPost(io, channel, msg);
  } catch (err) {
    console.warn(`[bot-agent] ${botId} failed:`, err instanceof Error ? err.message : err);
    typing(false);
    try {
      const msg = await messages.create(channelId, botId, "⚠️ I hit an error trying to answer that one.");
      await emitMessage(io, channelId, "message:new", msg);
    } catch {
      /* give up */
    }
  }
}

/**
 * After ANY bot posts: record the turn (auto-pausing a too-long chain), then —
 * unless bots are now paused — trigger every OTHER bot it @mentioned. This is the
 * bot-to-bot mechanic: a bot reaches Canary or another bot only by @mentioning
 * it. Canary is grounded with the chain initiator's token (bots have none).
 */
export async function afterBotPost(io: IO, channel: Channel, message: Message): Promise<void> {
  recordBotTurn(io, channel.id);

  const initiator = chainInitiator(channel.id);
  const botIds = new Set<ID>();
  for (const id of mentionedUserIds(message.content)) {
    if (id === message.authorId) continue;
    if ((await users.byId(id))?.isBot) botIds.add(id);
  }
  for (const botId of botIds) {
    // The mentioned bot would reply to message.author (also a bot): enforce the
    // 5-replies-in-a-row-per-pair limit + 3-minute cooldown.
    if (!canBotReplyTo(channel.id, botId, message.authorId)) continue;
    if (botId === CANARY.id) {
      if (initiator) void respondAsCanary(io, channel.id, initiator);
    } else {
      void respondAsBot(io, channel.id, botId);
    }
  }
}

/**
 * A human posted a message — fire any bots that should reply: every bot
 * @mentioned in a channel/group, plus the bot partner in a 1:1 DM (which answers
 * every message). Canary routes to its FruitScope-backed responder; generic LLM
 * bots route to `respondAsBot`. Bots post via `messages.create` (not the socket
 * send path), so a bot's reply never re-triggers this — no loops.
 */
export async function dispatchBotReplies(
  io: IO,
  channel: Channel,
  message: Message,
  senderId: ID,
): Promise<void> {
  // A human posted: resume bots + reset the chain, and record this human as the
  // initiator whose token grounds Canary during any bot-to-bot chain that follows.
  resetBots(io, channel.id, senderId);

  const botIds = new Set<ID>();

  for (const id of mentionedUserIds(message.content)) {
    if (id === senderId) continue;
    if ((await users.byId(id))?.isBot) botIds.add(id);
  }
  if (channel.kind === "dm") {
    for (const mid of channel.memberIds) {
      if (mid === senderId) continue;
      if ((await users.byId(mid))?.isBot) botIds.add(mid);
    }
  }

  for (const botId of botIds) {
    if (botId === CANARY.id) void respondAsCanary(io, channel.id, senderId);
    else void respondAsBot(io, channel.id, botId);
  }
}
