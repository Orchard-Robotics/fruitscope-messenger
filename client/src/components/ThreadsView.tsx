import { AtSign, Hash, Loader2, Lock, SendHorizonal, Users } from "lucide-react";
import { useEffect, useState } from "react";

import type { Channel, ThreadMention, User } from "@shared/index";
import { channelTitle } from "@/lib/channel";
import { cn } from "@/lib/cn";
import { rest } from "@/lib/api";
import { jumpToMessage } from "@/lib/jump";
import { encodeMentions } from "@/lib/mentions";
import { chat } from "@/lib/socket";
import { useChatStore } from "@/store/store";
import { Avatar } from "./Avatar";
import { MessageContent } from "./MessageContent";

const FALLBACK: Pick<User, "displayName" | "hue"> = { displayName: "?", hue: 0 };
const fmt = (ts: number): string =>
  new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The Threads inbox: every message that @mentions you, newest first. Unread
 *  mentions are highlighted; you can jump to one or reply to it inline. */
export function ThreadsView() {
  const [mentions, setMentions] = useState<ThreadMention[] | null>(null);
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
          {(mentions ?? []).map((m) => (
            <ThreadItem key={m.message.id} mention={m} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ThreadItem({ mention }: { mention: ThreadMention }) {
  const users = useChatStore((s) => s.users);
  const channels = useChatStore((s) => s.channels);
  const meId = useChatStore((s) => s.me?.id ?? "");
  const { message, unread } = mention;
  const author = users[message.authorId];
  const channel = channels[message.channelId];

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    const byUsername = new Map(Object.values(users).map((u) => [u.username.toLowerCase(), u]));
    const res = await chat.send(message.channelId, encodeMentions(text, byUsername));
    setSending(false);
    if (res.ok) setReply("");
  };

  return (
    <li
      className={cn(
        "rounded-xl border bg-surface/50 p-3",
        unread ? "border-brand-300 bg-brand-500/5" : "border-line",
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-dim">
        {unread && <span className="size-2 shrink-0 rounded-full bg-brand-500" />}
        <ConvIcon channel={channel} />
        <button
          onClick={() => void jumpToMessage(message)}
          className="min-w-0 flex-1 truncate text-left hover:text-brand-700 hover:underline"
        >
          {channel ? channelTitle(channel, users, meId) : "a conversation"}
        </button>
      </div>

      <div className="flex gap-2.5">
        <Avatar user={author ?? FALLBACK} size={28} className="mt-0.5 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-ink">{author?.displayName ?? "Someone"}</span>
            <span className="text-[11px] text-ink-faint">{fmt(message.createdAt)}</span>
          </div>
          <MessageContent content={message.content} meId={meId} />
        </div>
      </div>

      {/* Inline reply — posts to the conversation, Slack-style. */}
      <div className="mt-2 flex items-end gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 focus-within:border-brand-400">
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Reply…"
          className="max-h-32 min-h-5 w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          onClick={() => void send()}
          disabled={!reply.trim() || sending}
          title="Send reply"
          className="grid size-7 shrink-0 place-items-center rounded-md text-ink-faint transition hover:text-brand-600 disabled:opacity-40"
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizonal className="size-4" />}
        </button>
      </div>
    </li>
  );
}

function ConvIcon({ channel }: { channel: Channel | undefined }) {
  if (!channel || channel.kind === "dm") return <Users className="size-3.5 shrink-0" />;
  if (channel.isPrivate) return <Lock className="size-3.5 shrink-0" />;
  return <Hash className="size-3.5 shrink-0" />;
}
