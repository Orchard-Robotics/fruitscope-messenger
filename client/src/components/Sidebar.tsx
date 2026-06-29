import { Hash, Lock, LogOut, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { Channel, ID, User } from "@shared/index";
import { cn } from "@/lib/cn";
import { rest } from "@/lib/api";
import { chat, disconnectSocket } from "@/lib/socket";
import { useChatStore } from "@/store/store";
import { Avatar } from "./Avatar";
import { CreateChannelModal } from "./CreateChannelModal";
import { Logo } from "./Logo";
import { OrchardSwitcher } from "./OrchardSwitcher";
import { PresenceDot } from "./PresenceDot";
import { ProfileModal } from "./ProfileModal";

export function Sidebar({
  navOpen = false,
  onNavigate,
}: {
  navOpen?: boolean;
  onNavigate?: () => void;
}) {
  const me = useChatStore((s) => s.me);
  const users = useChatStore((s) => s.users);
  const channels = useChatStore((s) => s.channels);
  const unread = useChatStore((s) => s.unread);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);

  const channelList = useMemo(
    () =>
      Object.values(channels)
        .filter((c) => c.kind === "channel")
        .sort((a, b) => (a.name === "general" ? -1 : b.name === "general" ? 1 : a.createdAt - b.createdAt)),
    [channels],
  );

  const dmByPartner = useMemo(() => {
    const map = new Map<ID, Channel>();
    if (!me) return map;
    for (const c of Object.values(channels)) {
      if (c.kind !== "dm") continue;
      const partner = c.memberIds.find((id) => id !== me.id);
      if (partner) map.set(partner, c);
    }
    return map;
  }, [channels, me]);

  const people = useMemo(
    () =>
      Object.values(users)
        .filter((u) => u.id !== me?.id)
        .sort((a, b) => rankStatus(b) - rankStatus(a) || a.displayName.localeCompare(b.displayName)),
    [users, me],
  );

  const onlineCount = useMemo(
    () => Object.values(users).filter((u) => u.status === "online").length,
    [users],
  );

  const q = query.trim().toLowerCase();
  const visibleChannels = q ? channelList.filter((c) => c.name.includes(q)) : channelList;
  const visiblePeople = q
    ? people.filter((p) => p.displayName.toLowerCase().includes(q) || p.username.includes(q))
    : people;

  const select = (channelId: ID) => {
    setActiveChannel(channelId);
    chat.read(channelId);
    onNavigate?.(); // close the drawer on mobile
  };

  const openDm = async (userId: ID) => {
    const res = await chat.openDm(userId);
    if (res.ok) select(res.data.id);
  };

  const signOut = async () => {
    disconnectSocket();
    await rest.logout().catch(() => {}); // best-effort: clear the server session + cookie
    useChatStore.getState().signOut();
  };

  if (!me) return null;

  return (
    <aside
      className={cn(
        "z-30 flex h-full w-72 shrink-0 flex-col border-r border-line bg-surface/95 backdrop-blur-xl",
        "fixed inset-y-0 left-0 transition-transform duration-200 md:static md:translate-x-0",
        navOpen ? "translate-x-0 shadow-2xl shadow-ink/20" : "-translate-x-full md:translate-x-0",
      )}
    >
      <header className="flex items-center gap-3 px-5 pb-3 pt-5">
        <Logo className="size-9 shrink-0" />
        <OrchardSwitcher onlineCount={onlineCount} />
      </header>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 focus-within:focus-ring">
          <Search className="size-4 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to…"
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        <section>
          <SectionHeader label="Channels" onAdd={() => setCreating(true)} />
          <ul className="mt-1 space-y-0.5">
            {visibleChannels.map((c) => (
              <ChannelRow
                key={c.id}
                channel={c}
                active={c.id === activeChannelId}
                unread={unread[c.id] ?? 0}
                onClick={() => select(c.id)}
              />
            ))}
            {visibleChannels.length === 0 && <Empty>No channels</Empty>}
          </ul>
        </section>

        <section>
          <SectionHeader label="Direct messages" />
          <ul className="mt-1 space-y-0.5">
            {visiblePeople.map((person) => {
              const dm = dmByPartner.get(person.id);
              const dmUnread = dm ? (unread[dm.id] ?? 0) : 0;
              return (
                <PersonRow
                  key={person.id}
                  person={person}
                  active={dm?.id === activeChannelId}
                  unread={dmUnread}
                  onClick={() => void openDm(person.id)}
                />
              );
            })}
            {visiblePeople.length === 0 && <Empty>No people</Empty>}
          </ul>
        </section>
      </nav>

      <footer className="flex items-center gap-3 border-t border-line px-3 py-3">
        <button
          onClick={() => setEditingProfile(true)}
          title="Edit profile picture"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 -m-1 text-left transition hover:bg-surface-2"
        >
          <div className="relative">
            <Avatar user={me} size={36} />
            <PresenceDot status={me.status} className="absolute -bottom-0.5 -right-0.5" ring="ring-surface" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{me.displayName}</p>
            <p className="truncate text-xs text-ink-faint">@{me.username}</p>
          </div>
        </button>
        <button
          onClick={() => void signOut()}
          title="Sign out"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-dim transition hover:bg-surface-2 hover:text-danger"
        >
          <LogOut className="size-4" />
        </button>
      </footer>

      <CreateChannelModal open={creating} onClose={() => setCreating(false)} />
      <ProfileModal open={editingProfile} onClose={() => setEditingProfile(false)} />
    </aside>
  );
}

const rankStatus = (u: User): number => (u.status === "online" ? 2 : u.status === "away" ? 1 : 0);

function SectionHeader({ label, onAdd }: { label: string; onAdd?: () => void }) {
  return (
    <div className="flex items-center justify-between px-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
      {onAdd && (
        <button
          onClick={onAdd}
          title="Create channel"
          className="grid size-6 place-items-center rounded-md text-ink-faint transition hover:bg-surface-2 hover:text-brand-600"
        >
          <Plus className="size-4" />
        </button>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="px-2 py-1 text-sm text-ink-faint">{children}</li>;
}

function ChannelRow({
  channel,
  active,
  unread,
  onClick,
}: {
  channel: Channel;
  active: boolean;
  unread: number;
  onClick: () => void;
}) {
  const Icon = channel.isPrivate ? Lock : Hash;
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition",
          active
            ? "bg-brand-500/12 text-brand-700"
            : unread > 0
              ? "text-ink hover:bg-surface-2"
              : "text-ink-dim hover:bg-surface-2 hover:text-ink",
        )}
      >
        <Icon className={cn("size-4 shrink-0", active ? "text-brand-600" : "text-ink-faint")} />
        <span className={cn("truncate", unread > 0 && !active && "font-semibold text-ink")}>
          {channel.name}
        </span>
        {unread > 0 && <UnreadBadge count={unread} />}
      </button>
    </li>
  );
}

function PersonRow({
  person,
  active,
  unread,
  onClick,
}: {
  person: User;
  active: boolean;
  unread: number;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition",
          active ? "bg-brand-500/12 text-brand-700" : "text-ink-dim hover:bg-surface-2 hover:text-ink",
        )}
      >
        <span className="relative">
          <Avatar user={person} size={24} className="rounded-lg" />
          <PresenceDot
            status={person.status}
            className="absolute -bottom-1 -right-1 size-2"
            ring="ring-surface"
          />
        </span>
        <span className={cn("truncate", unread > 0 && "font-semibold text-ink")}>
          {person.displayName}
        </span>
        {unread > 0 && <UnreadBadge count={unread} />}
      </button>
    </li>
  );
}

function UnreadBadge({ count }: { count: number }) {
  return (
    <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-brand-500 px-1.5 text-xs font-bold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}
