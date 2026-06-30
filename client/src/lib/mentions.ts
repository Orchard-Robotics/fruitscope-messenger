import type { User } from "@shared/index";

/**
 * Mentions, Slack-style.
 *
 * Stored message content uses canonical tokens `<@userId>` — unambiguous and
 * robust (a display-name change never breaks an old mention; punctuation around a
 * mention is never misparsed). The composer lets people type `@username`, which is
 * encoded to a token on send; rendering resolves the token back to the user's
 * current display name.
 */

/** A `<@userId>` token in stored content. userId is a nanoid: [A-Za-z0-9_-]. */
const tokenRe = (): RegExp => /<@([A-Za-z0-9_-]+)>/g;
/** A typed `@username` at a word boundary (so `foo@bar.com` is never a mention). */
const typedRe = (): RegExp => /(^|\s)@([A-Za-z0-9_.-]+)/g;

export type MentionSegment =
  | { type: "text"; text: string }
  | { type: "mention"; userId: string };

/** Split stored content into text + mention segments for rendering. */
export function parseMentionSegments(content: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const m of content.matchAll(tokenRe())) {
    const idx = m.index ?? 0;
    if (idx > last) segments.push({ type: "text", text: content.slice(last, idx) });
    segments.push({ type: "mention", userId: m[1] ?? "" });
    last = idx + m[0].length;
  }
  if (last < content.length) segments.push({ type: "text", text: content.slice(last) });
  return segments;
}

/** Stored content → editable text: `<@id>` tokens become `@username` so the
 *  composer's `encodeMentions` can re-encode them on save (round-trips cleanly). */
export function decodeMentionsToInput(content: string, users: Record<string, User>): string {
  return parseMentionSegments(content)
    .map((seg) => (seg.type === "text" ? seg.text : `@${users[seg.userId]?.username ?? "unknown"}`))
    .join("");
}

/** Whether stored content mentions a given user id. */
export function contentMentions(content: string, userId: string): boolean {
  for (const m of content.matchAll(tokenRe())) {
    if (m[1] === userId) return true;
  }
  return false;
}

/** Unique user ids mentioned in stored content. */
export function mentionedIds(content: string): string[] {
  const ids = new Set<string>();
  for (const m of content.matchAll(tokenRe())) {
    if (m[1]) ids.add(m[1]);
  }
  return [...ids];
}

/**
 * Encode typed `@username` mentions to `<@userId>` tokens for storage, matching
 * against the orchard's members. Resolves the longest valid username so trailing
 * punctuation (e.g. "hey @willow.") still recognizes the mention and keeps the
 * "."; unknown handles are left as literal text.
 */
export function encodeMentions(text: string, usersByUsername: Map<string, User>): string {
  return text.replace(typedRe(), (full, pre: string, raw: string) => {
    let name = raw;
    let user = usersByUsername.get(name.toLowerCase());
    while (!user && /[.\-]$/.test(name)) {
      name = name.slice(0, -1);
      user = usersByUsername.get(name.toLowerCase());
    }
    if (!user) return full;
    // Re-append anything trimmed (e.g. the trailing ".").
    return `${pre}<@${user.id}>${raw.slice(name.length)}`;
  });
}

export interface MentionQuery {
  /** Index of the `@` in the text. */
  start: number;
  /** Text typed after the `@`, up to the caret. */
  query: string;
}

/**
 * If the caret sits inside an `@mention` being typed, return its start + query.
 * The `@` must begin a word (start-of-text or after whitespace), and everything
 * between it and the caret must be valid username characters.
 */
export function detectMentionQuery(text: string, caret: number): MentionQuery | null {
  for (let i = caret - 1; i >= 0; i -= 1) {
    const ch = text[i] ?? "";
    if (ch === "@") {
      const atWordStart = i === 0 || /\s/.test(text[i - 1] ?? "");
      if (!atWordStart) return null;
      const query = text.slice(i + 1, caret);
      return /^[A-Za-z0-9_.-]*$/.test(query) ? { start: i, query } : null;
    }
    if (/\s/.test(ch)) return null; // whitespace before any '@' → not in a mention
  }
  return null;
}
