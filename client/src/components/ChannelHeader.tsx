import { Hash, Lock, Menu, Users } from "lucide-react";

import type { UserStatus } from "@shared/index";
import { dmPartnerId } from "@/lib/channel";
import { useChatStore } from "@/store/store";
import { Avatar } from "./Avatar";
import { PresenceDot } from "./PresenceDot";

const PRESENCE_LABEL: Record<UserStatus, string> = {
  online: "Active now",
  away: "Away",
  offline: "Offline",
};

export function ChannelHeader({ onOpenNav }: { onOpenNav?: (() => void) | undefined }) {
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const channel = useChatStore((s) => (activeChannelId ? s.channels[activeChannelId] : undefined));
  const users = useChatStore((s) => s.users);
  const meId = useChatStore((s) => s.me?.id);

  if (!channel || !meId) return null;

  if (channel.kind === "dm") {
    const partnerId = dmPartnerId(channel, meId);
    const partner = partnerId ? users[partnerId] : undefined;
    return (
      <Bar onOpenNav={onOpenNav}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {partner && (
            <span className="relative">
              <Avatar user={partner} size={30} className="rounded-lg" />
              <PresenceDot
                status={partner.status}
                className="absolute -bottom-1 -right-1 size-2.5"
                ring="ring-white"
              />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="truncate font-display text-base font-bold text-ink">
              {partner?.displayName ?? "Direct message"}
            </h2>
            {partner && (
              <p className="truncate text-xs text-ink-dim">{PRESENCE_LABEL[partner.status]}</p>
            )}
          </div>
        </div>
      </Bar>
    );
  }

  const Icon = channel.isPrivate ? Lock : Hash;
  return (
    <Bar onOpenNav={onOpenNav}>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Icon className="size-5 shrink-0 text-ink-faint" />
        <div className="min-w-0">
          <h2 className="truncate font-display text-base font-bold text-ink">{channel.name}</h2>
          {channel.topic && <p className="truncate text-xs text-ink-dim">{channel.topic}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-sm text-ink-dim">
        <Users className="size-4" />
        {channel.memberIds.length}
      </div>
    </Bar>
  );
}

function Bar({
  children,
  onOpenNav,
}: {
  children: React.ReactNode;
  onOpenNav?: (() => void) | undefined;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line bg-white/70 px-3 backdrop-blur-xl sm:px-5">
      {onOpenNav && (
        <button
          onClick={onOpenNav}
          className="-ml-1 grid size-9 shrink-0 place-items-center rounded-lg text-ink-dim transition hover:bg-surface-2 md:hidden"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
      )}
      {children}
    </header>
  );
}
