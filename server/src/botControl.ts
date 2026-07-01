import type { Server } from "socket.io";

import type { ClientToServerEvents, ID, ServerToClientEvents, SocketData } from "@shared/index";

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const chanRoom = (id: ID): string => `chan:${id}`;

/**
 * Per-channel bot conversation state (in-memory; the single always-on instance
 * makes this consistent). Bots talk to each other by @mentioning, which could
 * loop forever — so a bot may reply to the SAME bot at most 5 times in a row in a
 * channel, then it won't reply to that bot for 3 minutes (the cooldown auto-
 * expires; no human needed). Anyone can also stop all bots manually; a human
 * message resets everything.
 */
interface ChannelBots {
  /** Bot messages since the last human message — drives the "bots talking" UI. */
  consecutiveBotTurns: number;
  /** Manually stopped (the emergency brake) until a human posts. */
  paused: boolean;
  /** The human who last engaged — their FruitScope token grounds Canary when a
   *  bot (which has no token) @mentions it during a chain. */
  initiatorId?: ID;
  /** Per (responder→source) reply streaks + cooldowns, for the 5-in-a-row rule. */
  pairs: Map<string, { count: number; blockedUntil: number }>;
}

/** A bot may reply to the same bot this many times in a row before a cooldown. */
const SAME_BOT_LIMIT = 5;
/** How long a bot won't reply to a specific bot after hitting the limit. */
const COOLDOWN_MS = 3 * 60 * 1000;
/** "Bots are talking" (show the Stop control) once they've chained this far. */
const ACTIVE_AT = 2;

const byChannel = new Map<ID, ChannelBots>();
const peek = (channelId: ID): ChannelBots | undefined => byChannel.get(channelId);
function state(channelId: ID): ChannelBots {
  let s = byChannel.get(channelId);
  if (!s) {
    s = { consecutiveBotTurns: 0, paused: false, pairs: new Map() };
    byChannel.set(channelId, s);
  }
  return s;
}

export function botsPaused(channelId: ID): boolean {
  return peek(channelId)?.paused ?? false;
}

/** A human posted — bots resume, all counters/cooldowns reset, and this human
 *  becomes the initiator whose token grounds Canary during the chain. */
export function resetBots(io: IO, channelId: ID, humanId: ID): void {
  const had = peek(channelId);
  byChannel.set(channelId, {
    consecutiveBotTurns: 0,
    paused: false,
    initiatorId: humanId,
    pairs: new Map(),
  });
  if (had && (had.paused || had.consecutiveBotTurns > 0)) emitBotState(io, channelId);
}

/** The human whose FruitScope token should ground Canary in this channel's chain. */
export function chainInitiator(channelId: ID): ID | undefined {
  return peek(channelId)?.initiatorId;
}

/** Manually stop bots in a channel (the emergency brake; anyone may call). */
export function stopBots(io: IO, channelId: ID): void {
  state(channelId).paused = true;
  emitBotState(io, channelId);
}

/**
 * Whether `responderId` may reply to a message from `sourceId` right now: not
 * manually paused, and within the 5-in-a-row limit for that specific bot pair.
 * Records the reply when it returns true, and starts a 3-minute cooldown when the
 * limit is hit.
 */
export function canBotReplyTo(channelId: ID, responderId: ID, sourceId: ID): boolean {
  const s = state(channelId);
  if (s.paused) return false;
  const key = `${responderId}>${sourceId}`;
  const now = Date.now();
  const p = s.pairs.get(key) ?? { count: 0, blockedUntil: 0 };
  if (p.blockedUntil > now) return false; // still cooling down
  if (p.blockedUntil !== 0) {
    p.count = 0; // cooldown elapsed — start the streak fresh
    p.blockedUntil = 0;
  }
  if (p.count >= SAME_BOT_LIMIT) {
    p.blockedUntil = now + COOLDOWN_MS;
    p.count = 0;
    s.pairs.set(key, p);
    return false;
  }
  p.count += 1;
  s.pairs.set(key, p);
  return true;
}

/** Record that a bot just posted (for the "bots talking" indicator). */
export function recordBotTurn(io: IO, channelId: ID): void {
  const s = state(channelId);
  s.consecutiveBotTurns += 1;
  emitBotState(io, channelId);
}

/** Broadcast the channel's bot state so clients can show the Stop control. */
export function emitBotState(io: IO, channelId: ID): void {
  const s = state(channelId);
  io.to(chanRoom(channelId)).emit("bots:state", {
    channelId,
    active: !s.paused && s.consecutiveBotTurns >= ACTIVE_AT,
    paused: s.paused,
  });
}
