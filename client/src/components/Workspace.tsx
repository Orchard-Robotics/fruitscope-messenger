import { MessageSquareHeart, WifiOff } from "lucide-react";
import { useMemo } from "react";

import { channelTitle } from "@/lib/channel";
import { useChatStore } from "@/store/store";
import { ChannelHeader } from "./ChannelHeader";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { Sidebar } from "./Sidebar";

export function Workspace() {
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const channel = useChatStore((s) => (activeChannelId ? s.channels[activeChannelId] : undefined));
  const users = useChatStore((s) => s.users);
  const meId = useChatStore((s) => s.me?.id);
  const connected = useChatStore((s) => s.connected);

  const placeholder = useMemo(() => {
    if (!channel || !meId) return "Message";
    return channel.kind === "channel"
      ? `Message #${channel.name}`
      : `Message ${channelTitle(channel, users, meId)}`;
  }, [channel, users, meId]);

  return (
    <div className="relative z-10 flex h-dvh">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col bg-bark-950/20">
        {!connected && <ConnectionBanner />}
        {channel && activeChannelId ? (
          <>
            <ChannelHeader />
            <MessageList channelId={activeChannelId} />
            <Composer channelId={activeChannelId} placeholder={placeholder} />
          </>
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  );
}

function ConnectionBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-sun-500/15 py-1.5 text-xs font-medium text-sun-300">
      <WifiOff className="size-3.5" />
      Reconnecting to the grove…
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid flex-1 place-items-center text-center">
      <div>
        <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-leaf-400/20 to-leaf-600/10 text-leaf-300">
          <MessageSquareHeart className="size-8" />
        </div>
        <p className="mt-4 font-display text-lg font-semibold text-ink">Pick a place to talk</p>
        <p className="mt-1 text-sm text-ink-dim">Choose a channel or a person from the left.</p>
      </div>
    </div>
  );
}
