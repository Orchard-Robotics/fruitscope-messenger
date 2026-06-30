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

  const post = async (text: string): Promise<void> => {
    const msg = await messages.create(channelId, botId, text);
    await emitMessage(io, channelId, "message:new", msg);
  };
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
    // context + transcript ride in the user turn so the bot continues the thread.
    const system = cfg.systemPrompt.trim() || `You are ${cfg.displayName}, a helpful assistant.`;
    const prompt =
      `You are "${cfg.displayName}", a bot participating in a team chat. ` +
      "Continue the conversation: reply to the latest message helpfully and concisely, staying in " +
      "character. Don't repeat the question or add a greeting.\n\n" +
      `Recent conversation:\n${lines.join("\n")}\n\nYour reply:`;

    const reply = await llmComplete({ modelId: cfg.model, system, prompt, maxTokens: 1024 });

    typing(false);
    await post(reply || "I’m not sure how to help with that — could you give me a bit more detail?");
  } catch (err) {
    console.warn(`[bot-agent] ${botId} failed:`, err instanceof Error ? err.message : err);
    typing(false);
    try {
      await post("⚠️ I hit an error trying to answer that one.");
    } catch {
      /* give up */
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
