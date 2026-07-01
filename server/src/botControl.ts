import type { Server } from "socket.io";

import type { ClientToServerEvents, ID, ServerToClientEvents, SocketData } from "@shared/index";

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const chanRoom = (id: ID): string => `chan:${id}`;

/**
 * Per-channel bot conversation state (in-memory; the single always-on instance
 * makes this consistent). Bots can talk to each other by @mentioning, which could
 * loop forever — so we auto-pause a channel after a run of consecutive bot turns
 * with no human message, and let anyone stop it manually. A human message resets.
 */
interface ChannelBots {
  /** Bot messages since the last human message. */
  consecutiveBotTurns: number;
  paused: boolean;
  /** The human who last engaged — their FruitScope token grounds Canary when a
   *  bot (which has no token) @mentions it during a chain. */
  initiatorId?: ID;
}

/** Auto-pause once bots have taken this many turns in a row without a human. */
const CHAIN_LIMIT = 6;
/** "Bots are talking" (show the Stop control) once they've chained this far. */
const ACTIVE_AT = 2;

const byChannel = new Map<ID, ChannelBots>();
const get = (channelId: ID): ChannelBots =>
  byChannel.get(channelId) ?? { consecutiveBotTurns: 0, paused: false };

export function botsPaused(channelId: ID): boolean {
  return get(channelId).paused;
}

/** A human posted — bots resume, the chain counter resets, and this human
 *  becomes the initiator whose token grounds Canary during the chain. */
export function resetBots(io: IO, channelId: ID, humanId: ID): void {
  const had = byChannel.get(channelId);
  byChannel.set(channelId, { consecutiveBotTurns: 0, paused: false, initiatorId: humanId });
  if (had && (had.paused || had.consecutiveBotTurns > 0)) emitBotState(io, channelId);
}

/** The human whose FruitScope token should ground Canary in this channel's chain. */
export function chainInitiator(channelId: ID): ID | undefined {
  return byChannel.get(channelId)?.initiatorId;
}

/** Manually stop bots in a channel (the emergency brake; anyone may call). */
export function stopBots(io: IO, channelId: ID): void {
  const s = get(channelId);
  s.paused = true;
  byChannel.set(channelId, s);
  emitBotState(io, channelId);
}

/**
 * Record that a bot just posted. Auto-pauses the channel once the chain is too
 * long. Returns whether bots are now paused (caller stops chaining if so).
 */
export function recordBotTurn(io: IO, channelId: ID): boolean {
  const s = get(channelId);
  s.consecutiveBotTurns += 1;
  if (s.consecutiveBotTurns >= CHAIN_LIMIT) s.paused = true;
  byChannel.set(channelId, s);
  emitBotState(io, channelId);
  return s.paused;
}

/** Broadcast the channel's bot state so clients can show the Stop control. */
export function emitBotState(io: IO, channelId: ID): void {
  const s = get(channelId);
  io.to(chanRoom(channelId)).emit("bots:state", {
    channelId,
    active: !s.paused && s.consecutiveBotTurns >= ACTIVE_AT,
    paused: s.paused,
  });
}
