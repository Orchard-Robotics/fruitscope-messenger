import type { Channel, ID, User } from "@shared/index";

/** The other participant in a DM (undefined for non-DMs). */
export function dmPartnerId(channel: Channel, meId: ID): ID | undefined {
  if (channel.kind !== "dm") return undefined;
  return channel.memberIds.find((id) => id !== meId);
}

/** Human title: channel name, or the partner's display name for DMs. */
export function channelTitle(
  channel: Channel,
  users: Record<ID, User>,
  meId: ID,
): string {
  if (channel.kind === "channel") return channel.name;
  const partnerId = dmPartnerId(channel, meId);
  const partner = partnerId ? users[partnerId] : undefined;
  return partner?.displayName ?? "Direct message";
}
