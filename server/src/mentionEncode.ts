import type { User } from "@shared/index";

/**
 * Pure @mention encoding — turns the many ways a person or bot writes a mention
 * (@handle, @Display Name, @DisplayName, or an unambiguous @FirstName) into the
 * canonical `<@userId>` token that the app stores, renders as a pill, and uses to
 * drive mention rows / badges / notifications. No I/O, so it's unit-testable and
 * cheap to call on every post.
 */

interface Candidate {
  needle: string; // lowercased handle or (part of a) display name
  id: string;
}

/**
 * Build the set of mention needles for a set of members. Usernames (always
 * unique) map directly; display names, the spaceless form, AND individual name
 * parts (first/last name, >=3 chars) are added too — but only when unambiguous (a
 * needle shared by two people, or already a username, is dropped so we never tag
 * the wrong person). Longest needles first so the fullest match wins ("@Brian
 * Yeh" beats "@Brian").
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
 * Encode a typed `@mention` — whatever form was used — into a `<@id>` token, so
 * it renders as a pill and actually notifies / triggers the mentioned member.
 * The `@` must sit at a word boundary (an email `a@b.com` is never a mention),
 * must not be inside an existing `<@id>` token (idempotent — safe to run over
 * already-encoded content), and the match must end on a non-alphanumeric
 * boundary (so `@Brian` doesn't fire inside `@Brianna`). Trailing punctuation is
 * preserved.
 */
export function encodeMentions(text: string, members: User[]): string {
  if (members.length === 0) return text;
  const candidates = buildCandidates(members);
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
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
