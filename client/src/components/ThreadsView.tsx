import { AtSign, Hash, Loader2, Lock, Users } from "lucide-react";
import { useEffect, useState } from "react";

import type { Channel, Message, User } from "@shared/index";
import { channelTitle } from "@/lib/channel";
import { cn } from "@/lib/cn";
import { rest } from "@/lib/api";
import { jumpToMessage } from "@/lib/jump";
import { useChatStore } from "@/store/store";
import { Avatar } from "./Avatar";
import { MessageContent } from "./MessageContent";

const FALLBACK: Pick<User, "displayName" | "hue"> = { displayName: "?", hue: 0 };
const fmt = (ts: number): string =>
  new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The Threads inbox: every message that @mentions you, newest first. Clicking
 *  one jumps to it in its conversation. */
export function ThreadsView() {
  const users = useChatStore((s) => s.users);
  const channels = useChatStore((s) => s.channels);
  const meId = useChatStore((s) => s.me?.id ?? "");
  const [mentions, setMentions] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rest
      .mentions()
      .then((r) => setMentions(r.mentions))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your mentions."));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <AtSign className="size-4 text-brand-600" />
        <div>
          <h2 className="text-sm font-bold text-ink">Threads</h2>
          <p className="text-xs text-ink-faint">Messages that mention you</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error && <p className="px-1 py-3 text-sm text-danger">{error}</p>}
        {!mentions && !error && (
          <p className="flex items-center gap-2 px-1 py-3 text-sm text-ink-faint">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        )}
        {mentions && mentions.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ink-faint">
            <AtSign className="size-8" />
            <p className="text-sm">No mentions yet. When someone @mentions you, it shows up here.</p>
          </div>
        )}
        <ul className="space-y-2">
          {(mentions ?? []).map((m) => {
            const author = users[m.authorId];
            const channel = channels[m.channelId];
            return (
              <li key={m.id}>
                <button
                  onClick={() => void jumpToMessage(m)}
                  className="w-full rounded-xl border border-line bg-surface/50 p-3 text-left transition hover:border-brand-300 hover:bg-brand-500/5"
                >
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-dim">
                    <ConvIcon channel={channel} />
                    <span className="truncate">
                      {channel ? channelTitle(channel, users, meId) : "a conversation"}
                    </span>
                  </div>
                  <div className="flex gap-2.5">
                    <Avatar user={author ?? FALLBACK} size={28} className="mt-0.5 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-ink">
                          {author?.displayName ?? "Someone"}
                        </span>
                        <span className="text-[11px] text-ink-faint">{fmt(m.createdAt)}</span>
                      </div>
                      <MessageContent content={m.content} meId={meId} />
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ConvIcon({ channel }: { channel: Channel | undefined }) {
  if (!channel || channel.kind === "dm") return <Users className={cn("size-3.5 shrink-0")} />;
  if (channel.isPrivate) return <Lock className="size-3.5 shrink-0" />;
  return <Hash className="size-3.5 shrink-0" />;
}
