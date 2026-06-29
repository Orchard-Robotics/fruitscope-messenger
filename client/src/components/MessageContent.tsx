import { useMemo } from "react";

import type { ID } from "@shared/index";
import { cn } from "@/lib/cn";
import { parseMentionSegments } from "@/lib/mentions";
import { useChatStore } from "@/store/store";

/**
 * Renders message text with `<@userId>` mentions as pills. Mentions of you are
 * highlighted distinctly (Slack-style). Each pill subscribes only to its own
 * user, so a presence/name change re-renders just that pill, not the message.
 */
export function MessageContent({ content, meId }: { content: string; meId: ID }) {
  const segments = useMemo(() => parseMentionSegments(content), [content]);

  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink/90">
      {segments.map((seg, i) =>
        seg.type === "text" ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <Mention key={i} userId={seg.userId} isMe={seg.userId === meId} />
        ),
      )}
    </p>
  );
}

function Mention({ userId, isMe }: { userId: ID; isMe: boolean }) {
  const name = useChatStore((s) => s.users[userId]?.displayName);
  return (
    <span
      className={cn(
        "rounded px-1 font-medium",
        isMe ? "bg-amber-200/80 text-amber-900" : "bg-brand-500/12 text-brand-700",
      )}
    >
      @{name ?? "someone"}
    </span>
  );
}
