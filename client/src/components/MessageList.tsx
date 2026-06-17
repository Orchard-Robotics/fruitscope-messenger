import { Leaf } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import type { ID, Message } from "@shared/index";
import { dayLabel, isNewDay } from "@/lib/format";
import { chat } from "@/lib/socket";
import { useChatStore } from "@/store/store";
import { MessageItem } from "./MessageItem";
import { TypingIndicator } from "./TypingIndicator";

const GROUP_GAP_MS = 5 * 60 * 1000;
const EMPTY: Message[] = [];

type Row =
  | { kind: "day"; key: string; ts: number }
  | { kind: "message"; key: string; message: Message; showHeader: boolean };

export function MessageList({ channelId }: { channelId: ID }) {
  const messages = useChatStore((s) => s.messages[channelId] ?? EMPTY);
  const users = useChatStore((s) => s.users);
  const meId = useChatStore((s) => s.me?.id ?? "");
  const typing = useChatStore((s) => s.typing[channelId]);
  const historyComplete = useChatStore((s) => s.historyComplete[channelId] ?? false);
  const prependHistory = useChatStore((s) => s.prependHistory);

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const restoreFromBottom = useRef<number | null>(null);
  const loading = useRef(false);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let prev: Message | undefined;
    for (const message of messages) {
      if (!prev || isNewDay(prev.createdAt, message.createdAt)) {
        out.push({ kind: "day", key: `day-${message.id}`, ts: message.createdAt });
      }
      const grouped =
        prev !== undefined &&
        prev.authorId === message.authorId &&
        message.createdAt - prev.createdAt < GROUP_GAP_MS &&
        !isNewDay(prev.createdAt, message.createdAt);
      out.push({ kind: "message", key: message.id, message, showHeader: !grouped });
      prev = message;
    }
    return out;
  }, [messages]);

  // Jump to the bottom whenever the active channel changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottom.current = true;
  }, [channelId]);

  // Keep position on prepend; otherwise follow new messages when already at bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - restoreFromBottom.current;
      restoreFromBottom.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Follow typing indicator appearing when pinned to bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [typing]);

  const loadOlder = useCallback(async () => {
    const el = scrollRef.current;
    const oldest = messages[0];
    if (!el || loading.current || historyComplete || !oldest) return;
    loading.current = true;
    const res = await chat.history(channelId, oldest.createdAt);
    if (res.ok) {
      restoreFromBottom.current = el.scrollHeight - el.scrollTop;
      prependHistory(channelId, res.data);
    }
    loading.current = false;
  }, [channelId, messages, historyComplete, prependHistory]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60) void loadOlder();
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col justify-end py-3">
        {(historyComplete || messages.length === 0) && <Intro hasMessages={messages.length > 0} />}

        {rows.map((row) =>
          row.kind === "day" ? (
            <DayDivider key={row.key} ts={row.ts} />
          ) : (
            <MessageItem
              key={row.key}
              message={row.message}
              author={users[row.message.authorId]}
              showHeader={row.showHeader}
              meId={meId}
            />
          ),
        )}

        <div className="mt-1">
          <TypingIndicator channelId={channelId} />
        </div>
      </div>
    </div>
  );
}

function DayDivider({ ts }: { ts: number }) {
  return (
    <div className="my-3 flex items-center gap-3 px-4">
      <span className="h-px flex-1 bg-bark-700" />
      <span className="rounded-full border border-bark-700 bg-bark-900/70 px-3 py-0.5 text-xs font-medium text-ink-dim">
        {dayLabel(ts)}
      </span>
      <span className="h-px flex-1 bg-bark-700" />
    </div>
  );
}

function Intro({ hasMessages }: { hasMessages: boolean }) {
  return (
    <div className="px-5 pb-2 pt-6">
      <div className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-leaf-400/20 to-leaf-600/10 text-leaf-300">
        <Leaf className="size-6" />
      </div>
      <p className="mt-3 text-sm text-ink-dim">
        {hasMessages
          ? "This is the very beginning of the conversation 🌱"
          : "No messages yet — plant the first one 🌱"}
      </p>
    </div>
  );
}
