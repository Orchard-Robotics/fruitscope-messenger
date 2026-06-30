import { Hash, Loader2, Lock, MessagesSquare, Search, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AdminConversation, Message, User } from "@shared/index";
import { rest } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useChatStore } from "@/store/store";
import { Avatar } from "../Avatar";
import { MessageContent } from "../MessageContent";

const errText = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong.");
const FALLBACK: Pick<User, "displayName" | "hue"> = { displayName: "?", hue: 0 };
const fmt = (ts: number): string => new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Admin conversation monitor: browse every channel/DM across all workspaces and
 *  read any of them. */
export function ConversationsSection() {
  const [conversations, setConversations] = useState<AdminConversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    rest
      .adminConversations()
      .then(setConversations)
      .catch((e) => setError(errText(e)));
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (conversations ?? []).filter(
        (c) =>
          !q ||
          c.title.toLowerCase().includes(q) ||
          c.orchard.name.toLowerCase().includes(q) ||
          c.orchard.code.toLowerCase().includes(q),
      ),
    [conversations, q],
  );

  const active = useMemo(
    () => conversations?.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* List */}
      <aside className="flex w-80 shrink-0 flex-col border-r border-line bg-surface/60">
        <div className="shrink-0 p-2">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5">
            <Search className="size-4 shrink-0 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations…"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {error && <p className="px-2 py-3 text-sm text-danger">{error}</p>}
          {!conversations && !error && (
            <p className="flex items-center gap-2 px-2 py-3 text-sm text-ink-faint">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          )}
          <ul className="space-y-0.5">
            {filtered.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setActiveId(c.id)}
                  className={cn(
                    "w-full rounded-lg px-2.5 py-2 text-left transition",
                    activeId === c.id ? "bg-brand-500/12" : "hover:bg-surface-2",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <ConvIcon kind={c.kind} isPrivate={c.isPrivate} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{c.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-faint">{c.orchard.code}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
                    <Users className="size-3" /> {c.memberCount}
                    <span>·</span>
                    <MessagesSquare className="size-3" /> {c.messageCount}
                    {c.lastMessageAt && <span className="ml-auto">{fmt(c.lastMessageAt)}</span>}
                  </span>
                  {c.lastMessagePreview && (
                    <span className="mt-0.5 block truncate text-xs text-ink-dim">{c.lastMessagePreview}</span>
                  )}
                </button>
              </li>
            ))}
            {conversations && filtered.length === 0 && (
              <p className="px-2 py-3 text-sm text-ink-faint">No conversations match.</p>
            )}
          </ul>
        </div>
      </aside>

      {/* Reader */}
      <div className="min-h-0 flex-1">
        {active ? (
          <ConversationReader key={active.id} conversation={active} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ink-faint">
            <MessagesSquare className="size-8" />
            <p className="text-sm">Select a conversation to read it.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ConvIcon({ kind, isPrivate }: { kind: string; isPrivate: boolean }) {
  if (kind === "dm") return <Users className="size-3.5 shrink-0 text-ink-faint" />;
  if (isPrivate) return <Lock className="size-3.5 shrink-0 text-ink-faint" />;
  return <Hash className="size-3.5 shrink-0 text-ink-faint" />;
}

function ConversationReader({ conversation }: { conversation: AdminConversation }) {
  const meId = useChatStore((s) => s.me?.id) ?? "";
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [authors, setAuthors] = useState<Record<string, User>>({});
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mergeAuthors = (list: User[]) =>
    setAuthors((prev) => {
      const next = { ...prev };
      for (const u of list) next[u.id] = u;
      return next;
    });

  useEffect(() => {
    setMessages(null);
    setError(null);
    rest
      .adminConversationMessages(conversation.id)
      .then((r) => {
        setMessages(r.messages);
        mergeAuthors(r.authors);
        setHasMore(r.hasMore);
      })
      .catch((e) => setError(errText(e)));
  }, [conversation.id]);

  const loadOlder = async () => {
    if (!messages || messages.length === 0) return;
    const oldest = messages[0]!;
    setLoadingMore(true);
    try {
      const r = await rest.adminConversationMessages(conversation.id, {
        createdAt: oldest.createdAt,
        id: oldest.id,
      });
      setMessages((prev) => [...r.messages, ...(prev ?? [])]);
      mergeAuthors(r.authors);
      setHasMore(r.hasMore);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line p-3">
        <p className="text-sm font-bold text-ink">{conversation.title}</p>
        <p className="text-xs text-ink-faint">
          {conversation.orchard.name} ({conversation.orchard.code}) · {conversation.kind}
          {conversation.isPrivate ? " · private" : ""} · {conversation.memberCount} members
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error && <p className="text-sm text-danger">{error}</p>}
        {!messages && !error && (
          <p className="flex items-center gap-2 text-sm text-ink-faint">
            <Loader2 className="size-4 animate-spin" /> Loading messages…
          </p>
        )}
        {messages && messages.length === 0 && (
          <p className="text-sm text-ink-faint">No messages in this conversation yet.</p>
        )}
        {hasMore && messages && messages.length > 0 && (
          <button
            onClick={() => void loadOlder()}
            disabled={loadingMore}
            className="mb-2 w-full rounded-lg border border-line bg-surface py-1.5 text-xs font-semibold text-ink-dim transition hover:bg-surface-2 disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load older messages"}
          </button>
        )}
        <ul className="space-y-3">
          {(messages ?? []).map((m) => {
            const author = authors[m.authorId];
            return (
              <li key={m.id} className="flex gap-2.5">
                <Avatar user={author ?? FALLBACK} size={32} className="mt-0.5 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {author?.displayName ?? "Someone"}
                    </span>
                    <span className="text-[11px] text-ink-faint">{fmt(m.createdAt)}</span>
                    {m.editedAt && <span className="text-[10px] text-ink-faint">(edited)</span>}
                  </div>
                  <MessageContent content={m.content} meId={meId} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
