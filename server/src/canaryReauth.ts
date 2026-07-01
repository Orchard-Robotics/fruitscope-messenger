import type { ID } from "@shared/index";

/**
 * When Canary can't reach FruitScope because a user's session token expired, we
 * remember which channel(s) that user was mid-conversation in, ask them to
 * re-authenticate, and — once they do — re-trigger Canary's reply automatically
 * (their token is refreshed on the user row by any re-login). In-memory; the
 * single always-on instance keeps it consistent.
 */
const pendingByUser = new Map<ID, Set<ID>>();

/** Remember that `userId` needs to re-auth to continue Canary in `channelId`. */
export function markCanaryReauth(userId: ID, channelId: ID): void {
  const set = pendingByUser.get(userId) ?? new Set<ID>();
  set.add(channelId);
  pendingByUser.set(userId, set);
}

/** Take (and clear) the channels awaiting Canary for `userId` after they re-auth. */
export function takeCanaryReauth(userId: ID): ID[] {
  const set = pendingByUser.get(userId);
  if (!set) return [];
  pendingByUser.delete(userId);
  return [...set];
}
