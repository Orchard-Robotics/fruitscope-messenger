import type { Channel, ID, User } from "@shared/index";

/** The built-in Canary assistant's fixed id. Only this bot gets the embedded
 *  Canary panel; other (admin-created) bots are ordinary chat participants. */
export const CANARY_ID = "canary";

/** The "message yourself" DM — a DM whose only member is you. */
export function isSelfDm(channel: Channel, meId: ID): boolean {
  return channel.kind === "dm" && channel.memberIds.every((id) => id === meId);
}

/** The participants of a DM other than you (empty for a self-DM). */
export function dmOtherIds(channel: Channel, meId: ID): ID[] {
  if (channel.kind !== "dm") return [];
  return channel.memberIds.filter((id) => id !== meId);
}

/** A multi-person (group) DM — you plus 2+ others. */
export function isGroupDm(channel: Channel, meId: ID): boolean {
  return channel.kind === "dm" && dmOtherIds(channel, meId).length >= 2;
}

/** The other participant in a 1:1 DM (undefined for non-DMs, self, and groups). */
export function dmPartnerId(channel: Channel, meId: ID): ID | undefined {
  if (channel.kind !== "dm") return undefined;
  const others = dmOtherIds(channel, meId);
  return others.length === 1 ? others[0] : undefined;
}

/** The Canary bot user in the directory, if present (a global, per-orchard bot). */
export function canaryUser(users: Record<ID, User>): User | undefined {
  return users[CANARY_ID] ?? Object.values(users).find((u) => u.isCanary);
}

/** Whether a channel is the 1:1 DM with the Canary assistant (its embedded panel).
 *  Generic LLM bots are NOT Canary — their DMs are ordinary message threads.
 *  Recognized by Canary's fixed id OR the server's `isCanary` flag (robust to a
 *  legacy Canary row whose id isn't "canary"). */
export function isCanaryDm(channel: Channel, users: Record<ID, User>, meId: ID): boolean {
  const partnerId = dmPartnerId(channel, meId);
  if (!partnerId) return false;
  return partnerId === CANARY_ID || users[partnerId]?.isCanary === true;
}

/** Human title: channel name; for DMs the participants' names (or "… (you)"). */
export function channelTitle(
  channel: Channel,
  users: Record<ID, User>,
  meId: ID,
): string {
  if (channel.kind === "channel") return channel.name;
  if (isSelfDm(channel, meId)) {
    const me = users[meId];
    return me ? `${me.displayName} (you)` : "You";
  }
  const names = dmOtherIds(channel, meId).map((id) => users[id]?.displayName ?? "Someone");
  return names.length ? names.join(", ") : "Direct message";
}
