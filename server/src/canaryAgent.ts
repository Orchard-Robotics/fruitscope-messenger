import type { Server } from "socket.io";

import type { ClientToServerEvents, ID, ServerToClientEvents, SocketData } from "@shared/index";
import { afterBotPost } from "./botAgent";
import { botsPaused } from "./botControl";
import { markCanaryReauth } from "./canaryReauth";
import { buildRoster, encodeMentions, mentionGuidance } from "./botRoom";
import * as fs from "./fruitscope";
import { emitMessage } from "./messageEmit";
import { CANARY, channels, messages, orchards, users } from "./store";

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

// Room name mirrors socket.ts's `chanRoom`.
const chanRoom = (id: ID): string => `chan:${id}`;
const MENTION_RE = /<@([A-Za-z0-9_-]+)>/g;

/** Whether a message body @mentions the Canary bot. */
export function mentionsCanary(content: string): boolean {
  return content.includes(`<@${CANARY.id}>`);
}

/** Replace `<@id>` mention tokens with readable `@Name` for the transcript. */
async function withNames(content: string, name: (id: ID) => Promise<string>): Promise<string> {
  let out = content;
  const ids = [...content.matchAll(MENTION_RE)].map((m) => m[1] as string);
  for (const id of new Set(ids)) out = out.split(`<@${id}>`).join(`@${await name(id)}`);
  return out;
}

/**
 * Canary was @mentioned in a channel/group DM. Make it a visible member of the
 * room, then answer in "general farm mode": ground in an orchard via the SENDER's
 * FruitScope token, give the harness the recent thread + a note that it's been
 * invoked in chat and should continue the conversation, and post the reply as the
 * Canary bot. Best-effort — any failure posts a short apology instead.
 */
export async function respondAsCanary(io: IO, channelId: ID, senderId: ID): Promise<void> {
  const post = async (text: string, reasoning?: string): Promise<void> => {
    const msg = await messages.create(channelId, CANARY.id, text, reasoning ?? null);
    // Reasoning-bearing replies fan out per-socket so only admins receive the
    // thinking; plain apologies take the fast path.
    await emitMessage(io, channelId, "message:new", msg);
  };
  const typing = (on: boolean): void => {
    io.to(chanRoom(channelId)).emit("typing:update", { channelId, userIds: on ? [CANARY.id] : [] });
  };

  try {
    const channel = await channels.byId(channelId);
    if (!channel) return;
    // Make Canary a visible member of the room it's now chatting in.
    if (!channel.memberIds.includes(CANARY.id)) {
      const updated = await channels.addMember(channelId, CANARY.id);
      if (updated) io.to(chanRoom(channelId)).emit("channel:updated", updated);
    }
    const orchard = await orchards.byId(channel.orchardId);
    if (!orchard) return;

    const jwt = await users.fruitscopeAuthJwt(senderId);
    if (!jwt) {
      // Session expired — don't dead-end in the channel. Privately ask this sender
      // to re-authenticate, and remember to finish the reply once they do.
      markCanaryReauth(senderId, channelId);
      io.to(`u:${channel.orchardId}:${senderId}`).emit("canary:reauth", { channelId });
      return;
    }
    // Ground in the sender's primary orchard (always accessible); fall back to the
    // channel's orchard.
    const orchardCode = fs.jwtPrimaryOrchard(jwt) ?? orchard.code;

    typing(true);

    // Who's in the room — so Canary can address / @mention people and bots.
    const roster = await buildRoster(channel.orchardId, CANARY.id);

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
    // The message that triggered you is the most recent one — name who sent it and
    // quote it so you know exactly who to answer and what they asked.
    const trigger = page.messages[page.messages.length - 1];
    const triggerLine = trigger
      ? `You were just @mentioned by ${await nameOf(trigger.authorId)}, in this message:\n` +
        `"${await withNames(trigger.content, nameOf)}"\n` +
        `Reply to them (and @mention ${await nameOf(trigger.authorId)} so they see it).\n\n`
      : "";

    const prompt =
      "You are Canary, the FruitScope AI farm assistant, and you've been @mentioned in a team chat. " +
      "Continue the conversation: answer helpfully and concisely as a knowledgeable " +
      "farm / agronomy assistant, in a friendly chat tone. Don't repeat the question or add a greeting.\n\n" +
      `People and bots in this workspace:\n${roster.text || "- (just you)"}\n\n` +
      `${mentionGuidance()}\n\n` +
      triggerLine +
      `Recent conversation:\n${lines.join("\n")}\n\nYour reply:`;

    const ctx = await fs.prepareContext(jwt, orchardCode, { general_mode: false, canary_mode: 5 });
    const { answer, reasoning } = await fs.chatCollect(jwt, orchardCode, {
      messages: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
      session_id: ctx.session_id,
      current_view: { block_name: null, scan_ids: null, sub_block_id: null, scan_label: null },
    });

    typing(false);
    // Stopped while Canary was thinking? Drop the reply.
    if (botsPaused(channelId)) return;

    const text = encodeMentions(
      answer || "I’m not sure how to help with that yet — could you give me a bit more detail?",
      roster.members,
    );
    const msg = await messages.create(channelId, CANARY.id, text, reasoning ?? null);
    await emitMessage(io, channelId, "message:new", msg);
    await afterBotPost(io, channel, msg);
  } catch (err) {
    console.warn("[canary-agent] failed:", err instanceof Error ? err.message : err);
    typing(false);
    try {
      await post("⚠️ I hit an error trying to answer that one.");
    } catch {
      /* give up */
    }
  }
}
