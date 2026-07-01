import type { Message } from "@shared/index";

import { channelTitle } from "@/lib/channel";
import { jumpToMessage } from "@/lib/jump";
import { contentMentions } from "@/lib/mentions";
import { messagePlainText } from "@/lib/messageLink";
import { usePrefs } from "@/store/prefs";
import { useChatStore } from "@/store/store";

const supported = (): boolean => typeof window !== "undefined" && "Notification" in window;

/** Ask for notification permission (best-effort; browsers may need a gesture). */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!supported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

/**
 * On a new message, fire a Slack-style desktop notification if it @mentions you
 * and you're not already looking at it — same info Slack shows: who, where, and
 * the message text; clicking jumps to it.
 */
export function maybeNotifyMention(message: Message): void {
  if (!supported() || Notification.permission !== "granted") return;
  if (!usePrefs.getState().mentionNotifications) return;

  const s = useChatStore.getState();
  const me = s.me;
  if (!me || message.authorId === me.id) return;
  if (!contentMentions(message.content, me.id)) return;

  // Don't notify if you're actively looking at that conversation.
  const looking =
    !document.hidden && !s.threadsOpen && s.activeChannelId === message.channelId;
  if (looking) return;

  const author = s.users[message.authorId];
  const channel = s.channels[message.channelId];
  const where = channel
    ? channel.kind === "channel"
      ? `#${channel.name}`
      : channelTitle(channel, s.users, me.id)
    : "a conversation";

  try {
    // Slack-style content: WHO (sender name + avatar), WHERE (channel/DM, and the
    // workspace as the app badge), WHAT (the message text). Clicking jumps to it.
    const n = new Notification(`${author?.displayName ?? "Someone"} in ${where}`, {
      body: messagePlainText(message.content, s.users),
      icon: author?.avatarUrl ?? "/fruitscope-logo.svg",
      badge: "/fruitscope-logo.svg",
      tag: message.id, // collapse duplicates for the same message
      timestamp: message.createdAt,
    } as NotificationOptions & { timestamp?: number });
    n.onclick = () => {
      window.focus();
      void jumpToMessage(message);
      n.close();
    };
  } catch {
    /* notification construction can throw on some platforms — ignore */
  }
}
