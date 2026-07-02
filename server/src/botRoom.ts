import type { ID, User } from "@shared/index";

import { encodeMentions } from "./mentionEncode";
import { orchards } from "./store";

export { encodeMentions };

export interface Roster {
  /** A human-readable list of participants for the bot's prompt. */
  text: string;
  /** The room's members (minus the responding bot) — used to encode @mentions. */
  members: User[];
}

/**
 * Build a roster of a workspace's people + bots (Canary included) for a bot's
 * context, so it knows who's around and can @mention them. `excludeId` drops the
 * responding bot itself.
 */
export async function buildRoster(orchardId: ID, excludeId?: ID): Promise<Roster> {
  const members = (await orchards.members(orchardId)).filter((m) => m.id !== excludeId);
  const lines = members.map((m) => {
    const kind = m.isCanary
      ? "the FruitScope AI assistant (a bot)"
      : m.isBot
        ? "a bot"
        : "a person";
    return `- ${m.displayName} — @${m.username} (${kind})`;
  });
  return { text: lines.join("\n"), members };
}

/** The mention-guidance appended to a bot's prompt. */
export function mentionGuidance(): string {
  return (
    "To reach or notify anyone in this channel — a person OR a bot — you MUST tag them with an " +
    "@mention, EVERY time you want them to see or respond (a message with no @mention notifies no " +
    "one in particular). Tag them by their exact @handle from the roster above (e.g. @brianyeh); " +
    "their display name works too (e.g. @Brian Yeh), but the @ is required — plain text like " +
    '"Brian" does NOT notify anyone. When another bot replies to you, @mention that bot again to ' +
    "CONTINUE the conversation with it; if you do NOT @mention it, that means you want the " +
    "conversation to end. Only @mention a bot when you genuinely want its input."
  );
}
