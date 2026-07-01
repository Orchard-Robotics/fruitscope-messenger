import type { ID, User } from "@shared/index";

import { orchards } from "./store";

/** A typed `@handle` at a boundary (so an email like foo@bar isn't a mention). */
const TYPED_MENTION_RE = /(^|[^A-Za-z0-9_.-])@([A-Za-z0-9_.-]+)/g;

export interface Roster {
  /** A human-readable list of participants for the bot's prompt. */
  text: string;
  /** Lowercased username → user, for encoding the bot's @mentions. */
  byUsername: Map<string, User>;
}

/**
 * Build a roster of a workspace's people + bots (Canary included) for a bot's
 * context, so it knows who's around and can @mention them. `excludeId` drops the
 * responding bot itself.
 */
export async function buildRoster(orchardId: ID, excludeId?: ID): Promise<Roster> {
  const members = await orchards.members(orchardId);
  const byUsername = new Map<string, User>();
  const lines: string[] = [];
  for (const m of members) {
    if (m.id === excludeId) continue;
    byUsername.set(m.username.toLowerCase(), m);
    const kind = m.isCanary
      ? "the FruitScope AI assistant (a bot)"
      : m.isBot
        ? "a bot"
        : "a person";
    lines.push(`- @${m.username} — ${m.displayName} (${kind})`);
  }
  return { text: lines.join("\n"), byUsername };
}

/**
 * Encode a bot's typed `@username` mentions into `<@id>` tokens against the
 * roster, so they render as pills and can notify/trigger the mentioned member.
 * Resolves the longest matching username so trailing punctuation is preserved;
 * unknown handles are left as literal text.
 */
export function encodeMentions(text: string, byUsername: Map<string, User>): string {
  return text.replace(TYPED_MENTION_RE, (full: string, pre: string, handle: string) => {
    let name = handle.toLowerCase();
    while (name.length > 0 && !byUsername.has(name)) name = name.slice(0, -1);
    const user = name ? byUsername.get(name) : undefined;
    if (!user) return full;
    return `${pre}<@${user.id}>${handle.slice(name.length)}`;
  });
}

/** The mention-guidance appended to a bot's prompt. */
export function mentionGuidance(): string {
  return (
    "You can mention anyone above by their @username to get their attention. " +
    "Mentioning a person notifies them; mentioning a bot (for example @canary) makes that bot reply — " +
    "so to involve another bot you MUST @mention it. Only do so when you genuinely want its input."
  );
}
