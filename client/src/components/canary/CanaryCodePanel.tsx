import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { ArrowUp, Code2, Loader2, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { usePrefs } from "@/store/prefs";
import { useChatStore } from "@/store/store";
import { CanaryMessage, type UIMessage } from "./CanaryMessage";

/**
 * CanaryCode — the Orchard-Robotics-only developer assistant. Reuses Canary's
 * message rendering (markdown, reasoning, tool cards) but streams from a
 * first-party Claude Opus agent (POST /api/canarycode/chat) instead of the
 * FruitScope AI proxy. Runs strictly read-only dev tools (GitHub PRs/CI, Linear).
 */
export function CanaryCodePanel() {
  const showCanaryDebug = usePrefs((s) => s.showCanaryDebug);
  const isSuperAdmin = useChatStore((s) => s.isSuperAdmin);
  const showDebug = isSuperAdmin && showCanaryDebug;

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/canarycode/chat" }), []);
  const { messages, sendMessage, status, stop, error } = useChat({ transport });
  const busy = status === "submitted" || status === "streaming";

  // Keep pinned to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void sendMessage({ text });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
        <span className="grid size-8 place-items-center rounded-lg bg-sky-500/15 text-sky-600">
          <Code2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-ink">CanaryCode</h2>
          <p className="text-xs text-ink-faint">Developer assistant · Claude Opus</p>
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ink-faint">
            <Code2 className="size-8" />
            <p className="max-w-sm text-sm">
              Ask CanaryCode about the FruitScope codebase, debugging, or infrastructure. It has
              read-only tools into GitHub (PRs &amp; CI) and Linear — ask “what PRs are open?” or
              “is the build passing?”. More read-only tools coming soon.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <CanaryMessage key={m.id} message={m as UIMessage} showDebug={showDebug} />
        ))}
        {status === "submitted" && (
          <p className="flex items-center gap-2 px-1 text-xs text-ink-faint">
            <Loader2 className="size-3.5 animate-spin" /> CanaryCode is thinking…
          </p>
        )}
        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            CanaryCode is unavailable right now. Try again in a moment.
          </p>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:border-brand-400">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Message CanaryCode…"
            className="max-h-40 min-h-6 w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          {busy ? (
            <button
              onClick={() => void stop()}
              title="Stop"
              className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-dim transition hover:text-ink"
            >
              <Square className="size-4" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              title="Send"
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-lg transition",
                input.trim()
                  ? "bg-brand-500 text-white hover:bg-brand-600"
                  : "bg-surface-2 text-ink-faint",
              )}
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
