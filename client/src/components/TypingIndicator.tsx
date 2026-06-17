import type { ID } from "@shared/index";
import { useChatStore } from "@/store/store";

export function TypingIndicator({ channelId }: { channelId: ID }) {
  const typing = useChatStore((s) => s.typing[channelId]);
  const users = useChatStore((s) => s.users);
  const meId = useChatStore((s) => s.me?.id);

  const names = (typing ?? [])
    .filter((id) => id !== meId)
    .map((id) => users[id]?.displayName)
    .filter((n): n is string => Boolean(n));

  if (names.length === 0) return <div className="h-5" />;

  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : `${names.length} people are typing`;

  return (
    <div className="flex h-5 items-center gap-2 px-4 text-xs text-ink-dim">
      <span className="flex gap-1">
        {[0, 0.18, 0.36].map((delay, i) => (
          <span
            key={i}
            className="typing-dot size-1.5 rounded-full bg-brand-500"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </span>
      <span>{label}…</span>
    </div>
  );
}
