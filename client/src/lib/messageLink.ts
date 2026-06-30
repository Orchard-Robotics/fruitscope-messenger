import type { ID, User } from "@shared/index";
import { chat } from "@/lib/socket";
import { parseMentionSegments } from "@/lib/mentions";
import { useChatStore } from "@/store/store";

/**
 * A shareable deep link to a specific message. Encoded as query params on the
 * site root so it always resolves to the app shell (a 200), unlike an unknown
 * path which the static host serves as a 404.
 */
export function messageLink(channelId: ID, messageId: ID): string {
  const u = new URL(window.location.origin);
  u.searchParams.set("c", channelId);
  u.searchParams.set("m", messageId);
  return u.toString();
}

/** Parse a message deep link off the current URL, if present. */
export function readMessageLink(): { channelId: ID; messageId: ID } | null {
  const params = new URLSearchParams(window.location.search);
  const c = params.get("c");
  const m = params.get("m");
  return c && m ? { channelId: c, messageId: m } : null;
}

/** Strip the `c`/`m` deep-link params from the URL (after handling them). */
export function clearMessageLink(): void {
  const params = new URLSearchParams(window.location.search);
  params.delete("c");
  params.delete("m");
  const qs = params.toString();
  window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
}

/** Stored content → human-readable plain text (mention tokens become @Name). */
export function messagePlainText(content: string, users: Record<ID, User>): string {
  return parseMentionSegments(content)
    .map((seg) => (seg.type === "text" ? seg.text : `@${users[seg.userId]?.displayName ?? "someone"}`))
    .join("");
}

/** Copy text to the clipboard; returns whether it succeeded. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts / older browsers.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Open a message from a deep link: switch to its channel and scroll to +
 * highlight it, fetching a window around it if it isn't already loaded. Returns
 * false if the channel isn't visible to this user or the message is gone.
 */
export async function openMessageLink(channelId: ID, messageId: ID): Promise<boolean> {
  const store = useChatStore.getState();
  if (!store.channels[channelId]) return false; // not in this user's orchard / not visible
  const loaded = (store.messages[channelId] ?? []).some((m) => m.id === messageId);
  if (!loaded) {
    const res = await chat.aroundMessage(channelId, messageId);
    if (!res.ok) return false;
    store.setWindowAround(channelId, res.data);
  }
  store.setActiveChannel(channelId);
  store.requestJump(channelId, messageId);
  return true;
}
