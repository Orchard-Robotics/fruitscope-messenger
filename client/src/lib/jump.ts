import type { ID, Message } from "@shared/index";
import { chat } from "@/lib/socket";
import { useChatStore } from "@/store/store";

/**
 * Open a message's channel and scroll to + highlight it (Slack search-result
 * jump). If the message isn't already in the loaded window, a window centered on
 * it is fetched first.
 */
export async function jumpToMessage(message: Message): Promise<void> {
  const channelId = message.channelId;
  const loaded = (useChatStore.getState().messages[channelId] ?? []).some(
    (m) => m.id === message.id,
  );
  if (!loaded) {
    const res = await chat.around(channelId, { createdAt: message.createdAt, id: message.id });
    if (res.ok) useChatStore.getState().setWindowAround(channelId, res.data);
  }
  useChatStore.getState().setActiveChannel(channelId);
  useChatStore.getState().requestJump(channelId, message.id);
}

/** Return a detached (jumped) channel view to the live tail. */
export async function resetToLatest(channelId: ID): Promise<void> {
  const res = await chat.history(channelId);
  if (res.ok) useChatStore.getState().setRecentWindow(channelId, res.data);
  useChatStore.getState().clearJump();
}
