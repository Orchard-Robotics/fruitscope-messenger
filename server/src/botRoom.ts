import type { ID, User } from "@shared/index";

import { orchards } from "./store";

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

interface Candidate {
  needle: string; // lowercased handle or display name
  id: string;
}

/**
 * Build the set of mention needles for a roster. Usernames (always unique) map
 * directly; display names, the spaceless form, AND individual name parts (first
 * name, last name) are added too — but only when unambiguous (a needle shared by
 * two people, or already a username, is dropped so we never tag the wrong
 * person). This makes "@Brian Yeh", "@brianyeh", and "@Brian" all resolve to the
 * same person when there's only one Brian. Longest needles first so the fullest
 * match wins ("@Brian Yeh" beats "@Brian").
 */
function buildCandidates(members: User[]): Candidate[] {
  const usernames = new Map<string, string>();
  for (const m of members) {
    const u = m.username.trim().toLowerCase();
    if (u.length >= 2) usernames.set(u, m.id);
  }
  const names = new Map<string, Set<string>>();
  const addName = (raw: string, id: string): void => {
    const n = raw.trim().toLowerCase();
    if (n.length < 2 || usernames.has(n)) return;
    const set = names.get(n) ?? new Set<string>();
    set.add(id);
    names.set(n, set);
  };
  for (const m of members) {
    const dn = m.displayName.trim();
    addName(dn, m.id);
    addName(dn.replace(/\s+/g, ""), m.id);
    // Individual name parts (>=3 chars, so "Jo"/initials don't over-match).
    for (const part of dn.split(/\s+/)) {
      if (part.length >= 3) addName(part, m.id);
    }
  }

  const list: Candidate[] = [];
  for (const [needle, id] of usernames) list.push({ needle, id });
  for (const [needle, ids] of names) {
    if (ids.size === 1) list.push({ needle, id: [...ids][0] as string });
  }
  return list.sort((a, b) => b.needle.length - a.needle.length);
}

const isWordChar = (c: string | undefined): boolean => !!c && /[A-Za-z0-9_.-]/.test(c);
const isAlnum = (c: string | undefined): boolean => !!c && /[A-Za-z0-9]/.test(c);

/**
 * Encode a bot's typed `@mention` — whether it used the @handle (`@brianyeh`) or
 * the person's display name (`@Brian Yeh`) — into a canonical `<@id>` token, so
 * it renders as a pill and actually notifies / triggers the mentioned member.
 * The `@` must sit at a word boundary (so an email like `a@b.com` is never a
 * mention), and the match must end at a non-alphanumeric boundary (so `@Brian`
 * doesn't fire inside `@Brianna`). Trailing punctuation is preserved.
 */
export function encodeMentions(text: string, members: User[]): string {
  if (members.length === 0) return text;
  const candidates = buildCandidates(members);
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    // A mention starts at an "@" on a word boundary — but not inside an existing
    // "<@id>" token (preceded by "<") and not inside an email (preceded by a word char).
    if (c === "@" && !isWordChar(text[i - 1]) && text[i - 1] !== "<") {
      const rest = text.slice(i + 1);
      const restLower = rest.toLowerCase();
      const hit = candidates.find(
        (cand) => restLower.startsWith(cand.needle) && !isAlnum(rest[cand.needle.length]),
      );
      if (hit) {
        out += `<@${hit.id}>`;
        i += 1 + hit.needle.length;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
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
