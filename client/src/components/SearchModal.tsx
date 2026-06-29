import { Hash, Lock, Search as SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Channel, ID, Message, User } from "@shared/index";
import { rest } from "@/lib/api";
import { channelTitle } from "@/lib/channel";
import { cn } from "@/lib/cn";
import { timeOfDay } from "@/lib/format";
import { jumpToMessage } from "@/lib/jump";
import { parseMentionSegments } from "@/lib/mentions";
import { chat } from "@/lib/socket";
import { useChatStore } from "@/store/store";
import { Avatar } from "./Avatar";

type Item =
  | { kind: "channel"; channel: Channel }
  | { kind: "person"; user: User }
  | { kind: "message"; message: Message };

const LIMIT = 6;

/** Resolve mention tokens to "@name" so search snippets read naturally. */
function plainText(content: string, users: Record<ID, User>): string {
  return parseMentionSegments(content)
    .map((seg) =>
      seg.type === "text" ? seg.text : `@${users[seg.userId]?.displayName ?? "someone"}`,
    )
    .join("");
}

/** A snippet windowed around the first match, with the match marked. */
function Snippet({ text, query }: { text: string; query: string }) {
  const lower = text.toLowerCase();
  const at = lower.indexOf(query.toLowerCase());
  const start = at > 40 ? at - 30 : 0;
  const clipped = (start > 0 ? "…" : "") + text.slice(start, start + 160);
  const q = query.toLowerCase();
  const cl = clipped.toLowerCase();
  const hit = cl.indexOf(q);
  if (hit < 0 || !query) return <>{clipped}</>;
  return (
    <>
      {clipped.slice(0, hit)}
      <mark className="rounded bg-amber-200/70 text-ink">{clipped.slice(hit, hit + query.length)}</mark>
      {clipped.slice(hit + query.length)}
    </>
  );
}

export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const channels = useChatStore((s) => s.channels);
  const users = useChatStore((s) => s.users);
  const meId = useChatStore((s) => s.me?.id ?? "");
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);

  const [q, setQ] = useState("");
  const [serverMsgs, setServerMsgs] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setServerMsgs([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const query = q.trim();
  const lq = query.toLowerCase();

  const channelHits = useMemo(
    () =>
      Object.values(channels)
        .filter((c) => c.kind === "channel" && c.name.toLowerCase().includes(lq))
        .slice(0, LIMIT),
    [channels, lq],
  );
  const peopleHits = useMemo(
    () =>
      Object.values(users)
        .filter(
          (u) =>
            u.id !== meId &&
            (u.displayName.toLowerCase().includes(lq) || u.username.toLowerCase().includes(lq)),
        )
        .slice(0, LIMIT),
    [users, meId, lq],
  );

  // Debounced server-side message search.
  useEffect(() => {
    if (!open) return;
    if (query.length < 2) {
      setServerMsgs([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(() => {
      void rest
        .search(query)
        .then((r) => {
          if (!cancelled) setServerMsgs(r.messages);
        })
        .catch(() => {
          if (!cancelled) setServerMsgs([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  const items = useMemo<Item[]>(
    () => [
      ...channelHits.map((c): Item => ({ kind: "channel", channel: c })),
      ...peopleHits.map((u): Item => ({ kind: "person", user: u })),
      ...serverMsgs.map((m): Item => ({ kind: "message", message: m })),
    ],
    [channelHits, peopleHits, serverMsgs],
  );

  // Keep the active row in range as results change.
  useEffect(() => {
    setActive((i) => (i >= items.length ? 0 : i));
  }, [items.length]);

  const choose = async (item: Item): Promise<void> => {
    if (item.kind === "channel") {
      setActiveChannel(item.channel.id);
      chat.read(item.channel.id);
    } else if (item.kind === "person") {
      const res = await chat.openDm(item.user.id);
      if (res.ok) {
        setActiveChannel(res.data.id);
        chat.read(res.data.id);
      }
    } else {
      await jumpToMessage(item.message);
    }
    onClose();
  };

  if (!open) return null;

  // A running index threads keyboard selection across the grouped sections.
  let idx = -1;
  const rowProps = (item: Item) => {
    idx += 1;
    const i = idx;
    return {
      "data-i": i,
      onMouseEnter: () => setActive(i),
      onMouseDown: (e: React.MouseEvent) => {
        e.preventDefault();
        void choose(item);
      },
      className: cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition",
        i === active ? "bg-brand-500/12" : "hover:bg-surface-2",
      ),
    };
  };

  return (
    <div className="anim-fade-in fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="anim-card-in relative z-10 flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl shadow-ink/10">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <SearchIcon className="size-5 shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            placeholder="Search messages, channels, people…"
            className="w-full bg-transparent py-3.5 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = items[active];
                if (item) void choose(item);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {channelHits.length > 0 && (
            <Section label="Channels">
              {channelHits.map((c) => (
                <button key={c.id} {...rowProps({ kind: "channel", channel: c })}>
                  {c.isPrivate ? (
                    <Lock className="size-4 shrink-0 text-ink-faint" />
                  ) : (
                    <Hash className="size-4 shrink-0 text-ink-faint" />
                  )}
                  <span className="truncate text-ink">{c.name}</span>
                </button>
              ))}
            </Section>
          )}

          {peopleHits.length > 0 && (
            <Section label="People">
              {peopleHits.map((u) => (
                <button key={u.id} {...rowProps({ kind: "person", user: u })}>
                  <Avatar user={u} size={22} className="rounded-md" />
                  <span className="truncate text-ink">{u.displayName}</span>
                  <span className="truncate text-xs text-ink-faint">@{u.username}</span>
                </button>
              ))}
            </Section>
          )}

          {query.length >= 2 && (
            <Section label="Messages">
              {searching && serverMsgs.length === 0 && (
                <p className="px-3 py-2 text-sm text-ink-faint">Searching…</p>
              )}
              {!searching && serverMsgs.length === 0 && (
                <p className="px-3 py-2 text-sm text-ink-faint">No messages found</p>
              )}
              {serverMsgs.map((m) => {
                const author = users[m.authorId];
                const ch = channels[m.channelId];
                const where = ch ? channelTitle(ch, users, meId) : "";
                return (
                  <button key={m.id} {...rowProps({ kind: "message", message: m })}>
                    <Avatar user={author ?? { displayName: "?", hue: 0 }} size={22} className="mt-0.5 self-start rounded-md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className="truncate font-semibold text-ink">
                          {author?.displayName ?? "Someone"}
                        </span>
                        {where && <span className="truncate text-xs text-ink-faint">in {where}</span>}
                        <span className="ml-auto shrink-0 text-xs text-ink-faint">
                          {timeOfDay(m.createdAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-ink-dim">
                        <Snippet text={plainText(m.content, users)} query={query} />
                      </span>
                    </span>
                  </button>
                );
              })}
            </Section>
          )}

          {query.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-ink-faint">
              Search for messages, channels, or people
            </p>
          )}
          {query.length > 0 && items.length === 0 && query.length < 2 && (
            <p className="px-3 py-8 text-center text-sm text-ink-faint">Keep typing to search…</p>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-ink-faint">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span>
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-1">
      <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </p>
      {children}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-sans text-[10px] text-ink-dim">
      {children}
    </kbd>
  );
}
