import { ChevronRight, Hash, Lock, MessageSquare, Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";

import type { Channel, ID, User } from "@shared/index";
import { cn } from "@/lib/cn";
import { channelTitle, isGroupDm, isSelfDm } from "@/lib/channel";
import { chat } from "@/lib/socket";
import { useCanaryUi } from "@/store/canary";
import { useChatStore } from "@/store/store";
import { Avatar } from "./Avatar";
import { CanaryAvatar } from "./canary/CanaryAvatar";
import { CreateChannelModal } from "./CreateChannelModal";
import { NewDmModal } from "./NewDmModal";
import { OrchardSwitcher } from "./OrchardSwitcher";
import { PresenceDot } from "./PresenceDot";

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
  const mentions = useChatStore((s) => s.mentions);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);

  const [creating, setCreating] = useState(false);
  const [newDm, setNewDm] = useState(false);

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

  // Canary (the AI bot) gets its own pinned row, so keep it out of the people list.
  const canaryBot = useMemo(() => Object.values(users).find((u) => u.isBot), [users]);

  const people = useMemo(
    () =>
      Object.values(users)
        .filter((u) => u.id !== me?.id && !u.isBot)
        .sort((a, b) => rankStatus(b) - rankStatus(a) || a.displayName.localeCompare(b.displayName)),
    [users, me],
  );

  const onlineCount = useMemo(
    () => Object.values(users).filter((u) => u.status === "online").length,
    [users],
  );

  // The "message yourself" DM, if it's been opened (always offered via the row).
  const selfDm = useMemo(
    () => (me ? Object.values(channels).find((c) => isSelfDm(c, me.id)) : undefined),
    [channels, me],
  );

  // Group (multi-person) DMs, newest first.
  const groupDms = useMemo(
    () =>
      me
        ? Object.values(channels)
            .filter((c) => isGroupDm(c, me.id))
            .sort((a, b) => b.createdAt - a.createdAt)
        : [],
    [channels, me],
  );

  const select = (channelId: ID) => {
    setActiveChannel(channelId);
    chat.read(channelId);
    onNavigate?.(); // close the drawer on mobile
  };

  const openDm = async (userId: ID) => {
    const res = await chat.openDm(userId);
    if (res.ok) select(res.data.id);
  };

  if (!me) return null;

  return (
    <aside
      className={cn(
        "z-30 flex h-full w-72 shrink-0 flex-col border-r border-line bg-surface/95 backdrop-blur-xl",
        "absolute inset-y-0 left-0 transition-transform duration-200 md:static md:translate-x-0",
        navOpen ? "translate-x-0 shadow-2xl shadow-ink/20" : "-translate-x-full md:translate-x-0",
      )}
    >
      <header className="px-3 pb-2 pt-4">
        <OrchardSwitcher onlineCount={onlineCount} />
      </header>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        <section>
          <SectionHeader label="Channels" onAdd={() => setCreating(true)} addTitle="Create channel" />
          <ul className="mt-1 space-y-0.5">
            {channelList.map((c) => (
              <ChannelRow
                key={c.id}
                channel={c}
                active={c.id === activeChannelId}
                unread={unread[c.id] ?? 0}
                mentioned={mentions[c.id] ?? false}
                onClick={() => select(c.id)}
              />
            ))}
            {channelList.length === 0 && <Empty>No channels</Empty>}
          </ul>
        </section>

        <section>
          <SectionHeader label="Direct messages" onAdd={() => setNewDm(true)} addTitle="New message" />
          <ul className="mt-1 space-y-0.5">
            {/* Pinned Canary (AI assistant) row, expandable into its chats. */}
            {canaryBot && (
              <CanaryTree
                dmActive={(() => {
                  const dm = dmByPartner.get(canaryBot.id);
                  return !!dm && dm.id === activeChannelId;
                })()}
                onOpenDm={() => void openDm(canaryBot.id)}
                onOpenConversation={async (id) => {
                  await openDm(canaryBot.id);
                  useCanaryUi.getState().requestOpen(id);
                }}
              />
            )}
            {/* Pinned "message yourself" row, Slack-style. */}
            <SelfDmRow
              me={me}
              active={!!selfDm && selfDm.id === activeChannelId}
              unread={selfDm ? (unread[selfDm.id] ?? 0) : 0}
              onClick={() => void openDm(me.id)}
            />
            {/* Group (multi-person) DMs. */}
            {groupDms.map((c) => (
              <GroupDmRow
                key={c.id}
                title={channelTitle(c, users, me.id)}
                count={c.memberIds.length}
                active={c.id === activeChannelId}
                unread={unread[c.id] ?? 0}
                mentioned={mentions[c.id] ?? false}
                onClick={() => select(c.id)}
              />
            ))}
            {people.map((person) => {
              const dm = dmByPartner.get(person.id);
              const dmUnread = dm ? (unread[dm.id] ?? 0) : 0;
              return (
                <PersonRow
                  key={person.id}
                  person={person}
                  active={dm?.id === activeChannelId}
                  unread={dmUnread}
                  mentioned={dm ? (mentions[dm.id] ?? false) : false}
                  onClick={() => void openDm(person.id)}
                />
              );
            })}
          </ul>
        </section>
      </nav>

      <CreateChannelModal open={creating} onClose={() => setCreating(false)} />
      <NewDmModal open={newDm} onClose={() => setNewDm(false)} />
    </aside>
  );
}

const rankStatus = (u: User): number => (u.status === "online" ? 2 : u.status === "away" ? 1 : 0);

function SectionHeader({
  label,
  onAdd,
  addTitle,
}: {
  label: string;
  onAdd?: () => void;
  addTitle?: string;
}) {
  return (
    <div className="flex items-center justify-between px-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
      {onAdd && (
        <button
          onClick={onAdd}
          title={addTitle ?? "Add"}
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
  mentioned,
  onClick,
}: {
  channel: Channel;
  active: boolean;
  unread: number;
  mentioned: boolean;
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
        {unread > 0 && <UnreadBadge count={unread} mentioned={mentioned} />}
      </button>
    </li>
  );
}

function PersonRow({
  person,
  active,
  unread,
  mentioned,
  onClick,
}: {
  person: User;
  active: boolean;
  unread: number;
  mentioned: boolean;
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
        {unread > 0 && <UnreadBadge count={unread} mentioned={mentioned} />}
      </button>
    </li>
  );
}

// The pinned Canary (AI assistant) row — bird avatar + an "AI" tag — that
// expands into its conversations, shown indented beneath it (a small tree).
function CanaryTree({
  dmActive,
  onOpenDm,
  onOpenConversation,
}: {
  dmActive: boolean;
  onOpenDm: () => void;
  onOpenConversation: (id: string) => void;
}) {
  const expanded = useCanaryUi((s) => s.expanded);
  const setExpanded = useCanaryUi((s) => s.setExpanded);
  const conversations = useCanaryUi((s) => s.conversations);
  const activeConversationId = useCanaryUi((s) => s.activeConversationId);
  // The panel publishes the (valid) orchard + its conversations; the tree just
  // mirrors them. `loaded` distinguishes "panel hasn't run yet" from "no chats".
  const loaded = useCanaryUi((s) => s.orchard !== "");

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-lg pr-1 transition",
          dmActive && !activeConversationId ? "bg-brand-500/12" : "hover:bg-surface-2",
        )}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="grid size-6 shrink-0 place-items-center rounded text-ink-faint transition hover:text-ink"
          aria-label={expanded ? "Collapse Canary chats" : "Expand Canary chats"}
        >
          <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} />
        </button>
        <button
          onClick={onOpenDm}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm transition",
            dmActive && !activeConversationId ? "text-brand-700" : "text-ink-dim group-hover:text-ink",
          )}
        >
          <CanaryAvatar size={24} className="rounded-lg" />
          <span className="truncate font-medium">Canary</span>
          <span className="rounded bg-sun-500/15 px-1 text-[10px] font-bold uppercase tracking-wide text-sun-500">
            AI
          </span>
        </button>
      </div>

      {expanded && (
        <ul className="ml-3 mt-0.5 space-y-0.5 border-l border-line pl-2">
          {conversations.length === 0 && (
            <li className="px-2 py-1 text-xs text-ink-faint">
              {loaded ? "No chats yet" : "Open Canary to view your chats"}
            </li>
          )}
          {conversations.map((c) => {
            const active = dmActive && c.id === activeConversationId;
            return (
              <li key={c.id}>
                <button
                  onClick={() => onOpenConversation(c.id)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition",
                    active ? "bg-brand-500/12 text-brand-700" : "text-ink-dim hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  <MessageSquare className="size-3 shrink-0 text-ink-faint" />
                  <span className="truncate">{c.title || c.blockName || "Untitled chat"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

// The pinned "message yourself" row — your own avatar + a "you" tag.
function SelfDmRow({
  me,
  active,
  unread,
  onClick,
}: {
  me: User;
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
        <Avatar user={me} size={24} className="rounded-lg" />
        <span className={cn("truncate", unread > 0 && "font-semibold text-ink")}>
          {me.displayName}
        </span>
        <span className="rounded bg-surface-2 px-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
          you
        </span>
        {unread > 0 && <UnreadBadge count={unread} mentioned={false} />}
      </button>
    </li>
  );
}

// A multi-person DM: a group glyph + the participants' names.
function GroupDmRow({
  title,
  count,
  active,
  unread,
  mentioned,
  onClick,
}: {
  title: string;
  count: number;
  active: boolean;
  unread: number;
  mentioned: boolean;
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
        <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-dim">
          <Users className="size-3.5" />
        </span>
        <span className={cn("truncate", unread > 0 && "font-semibold text-ink")}>{title}</span>
        <span className="shrink-0 text-xs text-ink-faint">{count}</span>
        {unread > 0 && <UnreadBadge count={unread} mentioned={mentioned} />}
      </button>
    </li>
  );
}

// A mention shows a red badge (Slack-style); plain unread stays brand green.
function UnreadBadge({ count, mentioned }: { count: number; mentioned: boolean }) {
  return (
    <span
      className={cn(
        "ml-auto grid min-w-5 place-items-center rounded-full px-1.5 text-xs font-bold text-white",
        mentioned ? "bg-danger" : "bg-brand-500",
      )}
    >
      {(mentioned ? "@" : "") + (count > 99 ? "99+" : count)}
    </span>
  );
}
