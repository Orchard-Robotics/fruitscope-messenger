import { Menu, MessageSquareHeart, WifiOff } from "lucide-react";
import { useMemo, useState } from "react";

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

  const [navOpen, setNavOpen] = useState(false);

  const placeholder = useMemo(() => {
    if (!channel || !meId) return "Message";
    return channel.kind === "channel"
      ? `Message #${channel.name}`
      : `Message ${channelTitle(channel, users, meId)}`;
  }, [channel, users, meId]);

  return (
    <div className="relative z-10 flex h-dvh overflow-hidden">
      {/* Drawer backdrop (mobile only) */}
      {navOpen && (
        <div
          className="fixed inset-0 z-20 bg-ink/30 backdrop-blur-sm md:hidden"
          onClick={() => setNavOpen(false)}
        />
      )}

      <Sidebar navOpen={navOpen} onNavigate={() => setNavOpen(false)} />

      <main className="relative flex min-w-0 flex-1 flex-col">
        {!connected && <ConnectionBanner />}
        {channel && activeChannelId ? (
          <>
            <ChannelHeader onOpenNav={() => setNavOpen(true)} />
            <MessageList key={activeChannelId} channelId={activeChannelId} />
            <Composer channelId={activeChannelId} placeholder={placeholder} />
          </>
        ) : (
          <EmptyState onOpenNav={() => setNavOpen(true)} />
        )}
      </main>
    </div>
  );
}

function ConnectionBanner() {
  return (
    <div className="flex items-center justify-center gap-2 bg-sun-500/10 py-1.5 text-xs font-medium text-sun-500">
      <WifiOff className="size-3.5" />
      Reconnecting…
    </div>
  );
}

function EmptyState({ onOpenNav }: { onOpenNav: () => void }) {
  return (
    <>
      <header className="flex h-16 shrink-0 items-center border-b border-line bg-white/70 px-4 backdrop-blur-xl md:hidden">
        <button
          onClick={onOpenNav}
          className="grid size-9 place-items-center rounded-lg text-ink-dim transition hover:bg-surface-2"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
      </header>
      <div className="grid flex-1 place-items-center px-6 text-center">
        <div>
          <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-brand-50 text-brand-600">
            <MessageSquareHeart className="size-8" />
          </div>
          <p className="mt-4 font-display text-lg font-semibold text-ink">Pick a place to talk</p>
          <p className="mt-1 text-sm text-ink-dim">Choose a channel or a person from the menu.</p>
        </div>
      </div>
    </>
  );
}
