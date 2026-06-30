import { SmilePlus } from "lucide-react";
import { useState } from "react";

import type { ID, Message, User } from "@shared/index";
import { REACTION_EMOJI } from "@shared/index";
import { cn } from "@/lib/cn";
import { timeOfDay } from "@/lib/format";
import { chat } from "@/lib/socket";
import { Avatar } from "./Avatar";
import { CanaryAvatar } from "./canary/CanaryAvatar";
import { CanaryReasoning } from "./canary/CanaryReasoning";
import { MessageContent } from "./MessageContent";

const FALLBACK: Pick<User, "displayName" | "hue"> = { displayName: "?", hue: 0 };

interface MessageItemProps {
  message: Message;
  author: User | undefined;
  showHeader: boolean;
  meId: ID;
  /** Briefly highlighted after jumping to it from search. */
  highlighted?: boolean;
}

export function MessageItem({ message, author, showHeader, meId, highlighted }: MessageItemProps) {
  const [picking, setPicking] = useState(false);

  const react = (emoji: string) => {
    setPicking(false);
    void chat.react(message.id, emoji);
  };

  return (
    <div
      data-msg
      className={cn(
        "group relative flex gap-3 px-4 transition-colors duration-1000",
        showHeader ? "mt-3 pt-1" : "py-0.5",
        highlighted ? "bg-amber-100" : "anim-rise-in hover:bg-surface",
      )}
    >
      <div className="w-10 shrink-0">
        {showHeader ? (
          author?.isBot ? (
            <CanaryAvatar size={40} className="rounded-xl" />
          ) : (
            <Avatar user={author ?? FALLBACK} size={40} />
          )
        ) : (
          <span className="mt-0.5 hidden select-none text-right text-[10px] leading-5 text-ink-faint group-hover:block">
            {timeOfDay(message.createdAt)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-ink">{author?.displayName ?? "Someone"}</span>
            <span className="text-xs text-ink-faint">{timeOfDay(message.createdAt)}</span>
          </div>
        )}

        <MessageContent content={message.content} meId={meId} />

        {/* Canary's admin-only thinking (collapsible). Present only for admins —
            the server strips it for everyone else. */}
        {message.canaryReasoning && <CanaryReasoning reasoning={message.canaryReasoning} />}

        {message.reactions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {message.reactions.map((r) => {
              const mine = r.userIds.includes(meId);
              return (
                <button
                  key={r.emoji}
                  onClick={() => react(r.emoji)}
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition",
                    mine
                      ? "border-brand-300 bg-brand-50 text-brand-700"
                      : "border-line bg-surface text-ink-dim hover:bg-surface-2",
                  )}
                >
                  <span className="text-sm leading-none">{r.emoji}</span>
                  <span className="font-semibold tabular-nums">{r.userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Hover toolbar */}
      <div className="absolute -top-3 right-3 opacity-0 transition group-hover:opacity-100">
        <div className="relative">
          <button
            onClick={() => setPicking((v) => !v)}
            className="grid size-8 place-items-center rounded-lg border border-line bg-raised text-ink-dim shadow-sm transition hover:text-brand-600"
            title="Add reaction"
          >
            <SmilePlus className="size-4" />
          </button>

          {picking && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPicking(false)} />
              <div className="anim-pop-in absolute right-0 top-9 z-20 flex gap-1 rounded-xl border border-line bg-raised p-1.5 shadow-lg">
                {REACTION_EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => react(emoji)}
                    className="grid size-8 place-items-center rounded-lg text-lg transition hover:scale-110 hover:bg-surface-2"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
