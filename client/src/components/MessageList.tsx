import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import type { ID, Message } from "@shared/index";
import { dayLabel, isNewDay } from "@/lib/format";
import { resetToLatest } from "@/lib/jump";
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
  const detached = useChatStore((s) => s.detached[channelId] ?? false);
  // Set on (re)mount; the list is keyed by jump token so a jump remounts it.
  const jumpMessageId = useChatStore((s) =>
    s.jumpTarget?.channelId === channelId ? s.jumpTarget.messageId : null,
  );

  const virtuoso = useRef<VirtuosoHandle>(null);
  const [highlightId, setHighlightId] = useState<string | null>(jumpMessageId);
  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  // State (not a ref) so the scroll-to-bottom control can react to it.
  const [atBottom, setAtBottom] = useState(true);
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

  // The list remounts (keyed by jump token) when jumping to a search result, so
  // this runs once per jump: fade out the highlight after a moment.
  useEffect(() => {
    if (!jumpMessageId) return;
    const t = setTimeout(() => setHighlightId(null), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Where to open: centered on the jump target if any, else the latest message.
  const jumpIndex = jumpMessageId ? messages.findIndex((m) => m.id === jumpMessageId) : -1;
  const initialIndex = jumpIndex >= 0 ? jumpIndex : messages.length - 1;

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
    <div className="relative flex flex-1 flex-col">
    <Virtuoso
      ref={virtuoso}
      className="flex-1"
      data={messages}
      // Bottom-align so a short conversation sticks to the bottom (newest at the
      // bottom edge) instead of hanging from the top with empty space below.
      alignToBottom
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={initialIndex}
      startReached={() => void loadOlder()}
      // Slack-style: when you're at (or near) the bottom, a new message keeps you
      // pinned there so you always see it; when you've scrolled up, it doesn't
      // yank you down. The generous threshold treats "within ~120px of the bottom"
      // as at-bottom (the strict 4px default stops following the moment the typing
      // footer or a partial row nudges you off the very edge).
      atBottomThreshold={120}
      followOutput={(isAtBottom) => (isAtBottom ? "smooth" : false)}
      atBottomStateChange={setAtBottom}
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
              highlighted={message.id === highlightId}
            />
          </>
        );
      }}
    />
      {/* Slack-style scroll-to-latest: shown whenever you're not at the bottom
          (scrolled up in the live view) or viewing a historical jump window.
          Detached jumps back to the live tail; otherwise it scrolls to newest. */}
      {(detached || !atBottom) && (
        <button
          onClick={() => {
            if (detached) void resetToLatest(channelId);
            else virtuoso.current?.scrollToIndex({ index: "LAST", behavior: "smooth", align: "end" });
          }}
          title="Scroll to latest"
          aria-label="Scroll to latest"
          className="anim-pop-in absolute bottom-4 right-4 grid size-10 place-items-center rounded-full border border-line bg-raised text-ink-dim shadow-floating transition hover:bg-surface-2 hover:text-brand-600"
        >
          <ArrowDown className="size-5" />
        </button>
      )}
    </div>
  );
}

function DayDivider({ ts }: { ts: number }) {
  return (
    <div className="my-3 flex items-center gap-3 px-4">
      <span className="h-px flex-1 bg-line" />
      <span className="rounded-full border border-line bg-raised px-3 py-0.5 text-xs font-medium text-ink-dim">
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
