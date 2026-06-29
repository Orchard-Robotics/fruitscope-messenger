import type { Channel, ID, User } from "@shared/index";

/** The "message yourself" DM — a DM whose only member is you. */
export function isSelfDm(channel: Channel, meId: ID): boolean {
  return channel.kind === "dm" && channel.memberIds.every((id) => id === meId);
}

/** The other participant in a DM (undefined for non-DMs and self-DMs). */
export function dmPartnerId(channel: Channel, meId: ID): ID | undefined {
  if (channel.kind !== "dm") return undefined;
  return channel.memberIds.find((id) => id !== meId);
}

/** Human title: channel name, the partner's name for DMs, or "… (you)" for self. */
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
  const partnerId = dmPartnerId(channel, meId);
  const partner = partnerId ? users[partnerId] : undefined;
  return partner?.displayName ?? "Direct message";
}
