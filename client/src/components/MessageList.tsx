import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import type { ID, Message } from "@shared/index";
import { dayLabel, isNewDay } from "@/lib/format";
import { chat } from "@/lib/socket";
import { useChatStore } from "@/store/store";
import { Logo } from "./Logo";
import { MessageItem } from "./MessageItem";
import { TypingIndicator } from "./TypingIndicator";

const GROUP_GAP_MS = 5 * 60 * 1000;
const EMPTY: Message[] = [];
/** Large base so prepended items get a non-negative virtual index. */
const START_INDEX = 1_000_000;

/**
 * Virtualized message list — only on-screen rows live in the DOM. Each channel's
 * first page loads lazily on open; older pages stream in as you scroll up, with
 * the scroll position held stable via Virtuoso's firstItemIndex.
 */
export function MessageList({ channelId }: { channelId: ID }) {
  const messages = useChatStore((s) => s.messages[channelId] ?? EMPTY);
  const hydrated = useChatStore((s) => s.hydrated[channelId] ?? false);
  const historyComplete = useChatStore((s) => s.historyComplete[channelId] ?? false);
  const users = useChatStore((s) => s.users);
  const meId = useChatStore((s) => s.me?.id ?? "");
  const setInitialPage = useChatStore((s) => s.setInitialPage);
  const prependPage = useChatStore((s) => s.prependPage);

  const virtuoso = useRef<VirtuosoHandle>(null);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const atBottom = useRef(true);
  const loadingOlder = useRef(false);
  const prevFirstId = useRef<string | undefined>(undefined);
  const lastId = useRef<string | undefined>(undefined);
  const seededLast = useRef(false);

  // When *I* send a message while scrolled up, jump to the bottom to show it
  // (followOutput only sticks when already at the bottom).
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (!seededLast.current) {
      seededLast.current = true;
      lastId.current = last.id;
      return;
    }
    // A prepend changes messages[0], never the last id — so a changed last id
    // is always a new message at the bottom.
    if (last.id !== lastId.current) {
      lastId.current = last.id;
      if (last.authorId === meId) {
        virtuoso.current?.scrollToIndex({ index: "LAST", behavior: "smooth", align: "end" });
      }
    }
  }, [messages, meId]);

  // Lazy first-page load when a channel is opened for the first time.
  useEffect(() => {
    if (hydrated) return;
    let cancelled = false;
    void (async () => {
      const res = await chat.history(channelId);
      if (!cancelled && res.ok) setInitialPage(channelId, res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [channelId, hydrated, setInitialPage]);

  // Keep the viewport anchored when older messages are prepended: shift the
  // virtual index by however many rows appeared before the previous first row.
  useEffect(() => {
    const oldFirst = prevFirstId.current;
    if (oldFirst) {
      const idx = messages.findIndex((m) => m.id === oldFirst);
      if (idx > 0) setFirstItemIndex((v) => v - idx);
    }
    prevFirstId.current = messages[0]?.id;
  }, [messages]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder.current || historyComplete) return;
    const oldest = messages[0];
    if (!oldest) return;
    loadingOlder.current = true;
    const res = await chat.history(channelId, { createdAt: oldest.createdAt, id: oldest.id });
    if (res.ok) prependPage(channelId, res.data);
    loadingOlder.current = false;
  }, [channelId, messages, historyComplete, prependPage]);

  if (!hydrated) {
    return <div className="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading…</div>;
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-end">
        <Intro hasMessages={false} />
      </div>
    );
  }

  return (
    <Virtuoso
      ref={virtuoso}
      className="flex-1"
      data={messages}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={messages.length - 1}
      startReached={() => void loadOlder()}
      followOutput={(isAtBottom) => (isAtBottom ? "auto" : false)}
      atBottomStateChange={(b) => {
        atBottom.current = b;
      }}
      increaseViewportBy={{ top: 600, bottom: 200 }}
      components={{
        Header: () => (historyComplete ? <Intro hasMessages /> : <LoadingOlder />),
        Footer: () => (
          <div className="mt-1 pb-2">
            <TypingIndicator channelId={channelId} />
          </div>
        ),
      }}
      itemContent={(index, message) => {
        const arrIndex = index - firstItemIndex;
        const prev = arrIndex > 0 ? messages[arrIndex - 1] : undefined;
        const showDivider = !prev || isNewDay(prev.createdAt, message.createdAt);
        const grouped =
          prev !== undefined &&
          prev.authorId === message.authorId &&
          message.createdAt - prev.createdAt < GROUP_GAP_MS &&
          !showDivider;
        return (
          <>
            {showDivider && <DayDivider ts={message.createdAt} />}
            <MessageItem
              message={message}
              author={users[message.authorId]}
              showHeader={!grouped}
              meId={meId}
            />
          </>
        );
      }}
    />
  );
}

function DayDivider({ ts }: { ts: number }) {
  return (
    <div className="my-3 flex items-center gap-3 px-4">
      <span className="h-px flex-1 bg-line" />
      <span className="rounded-full border border-line bg-white px-3 py-0.5 text-xs font-medium text-ink-dim">
        {dayLabel(ts)}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function LoadingOlder() {
  return <div className="py-3 text-center text-xs text-ink-faint">Loading earlier messages…</div>;
}

function Intro({ hasMessages }: { hasMessages: boolean }) {
  return (
    <div className="px-5 pb-2 pt-6">
      <Logo className="size-12" />
      <p className="mt-3 text-sm text-ink-dim">
        {hasMessages
          ? "This is the very beginning of the conversation 🌱"
          : "No messages yet — send the first one 🌱"}
      </p>
    </div>
  );
}
