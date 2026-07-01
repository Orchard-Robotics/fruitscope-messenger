import { Bot, OctagonX, PauseCircle } from "lucide-react";

import type { ID } from "@shared/index";
import { chat } from "@/lib/socket";
import { useChatStore } from "@/store/store";

/**
 * Slack-style safety bar for bot-to-bot conversations. Shows a prominent "Stop
 * bots" control while bots are talking to each other (anyone in the room can hit
 * it), or a "paused" note once they've been stopped — a human message resumes.
 */
export function BotActivityBanner({ channelId }: { channelId: ID }) {
  const state = useChatStore((s) => s.botState[channelId]);
  if (!state) return null;

  if (state.paused) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-4 py-1.5 text-xs text-ink-dim">
        <PauseCircle className="size-3.5 shrink-0" />
        Bots are paused — send a message to resume the conversation.
      </div>
    );
  }

  if (!state.active) return null;

  return (
    <div className="anim-rise-in flex shrink-0 items-center gap-2 border-t border-amber-300/60 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
      <Bot className="size-3.5 shrink-0" />
      <span className="flex-1">Bots are talking to each other.</span>
      <button
        onClick={() => chat.stopBots(channelId)}
        className="inline-flex items-center gap-1 rounded-md bg-danger px-2 py-1 text-[11px] font-semibold text-white transition hover:opacity-90"
      >
        <OctagonX className="size-3.5" />
        Stop bots
      </button>
    </div>
  );
}
