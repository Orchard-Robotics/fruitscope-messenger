import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  ArrowUp,
  Loader2,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Square,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { type CanaryBlock, type CanaryConversation, CanaryError, canaryApi, chatApiPath } from "@/lib/canary";
import { useChatStore } from "@/store/store";
import { CanaryAvatar } from "./CanaryAvatar";
import { CanaryMessage, type UIMessage } from "./CanaryMessage";

/* A monotonic id for restored/local messages (UIMessages need a stable id). */
let _seq = 0;
const localId = (): string => `local-${(_seq += 1)}`;

/** Most-recent scan in a block (FruitScope grounds answers on a scan). */
function latestScan(block: CanaryBlock): CanaryBlock["scans"][number] | undefined {
  return [...block.scans].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
}

/** FruitScope persists message content as `{ parts: [...] }`; rebuild UIMessages. */
function toUiMessage(m: { role: "user" | "assistant"; content: unknown }): UIMessage {
  const c = m.content;
  let parts: UIMessage["parts"] = [];
  if (c && typeof c === "object" && Array.isArray((c as { parts?: unknown }).parts)) {
    parts = (c as { parts: UIMessage["parts"] }).parts;
  } else if (typeof c === "string") {
    parts = [{ type: "text", text: c }];
  } else if (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string") {
    parts = [{ type: "text", text: (c as { text: string }).text }];
  }
  return { id: localId(), role: m.role, parts };
}

export function CanaryPanel() {
  const storeOrchard = useChatStore((s) => s.orchard);

  const [orchards, setOrchards] = useState<{ code: string; name: string }[]>([]);
  const [orchard, setOrchard] = useState<string>("");
  const [blocks, setBlocks] = useState<CanaryBlock[]>([]);
  const [blockId, setBlockId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<CanaryConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [fatal, setFatal] = useState<{ message: string; reconnect: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mutable per-conversation context the send path reads without re-rendering.
  const sessionIdRef = useRef<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const block = useMemo(() => blocks.find((b) => b.blockId === blockId) ?? null, [blocks, blockId]);
  const blockRef = useRef<CanaryBlock | null>(null);
  blockRef.current = block;

  const transport = useMemo(
    () => new DefaultChatTransport({ api: chatApiPath(orchard), credentials: "same-origin" }),
    [orchard],
  );

  const { messages, sendMessage, setMessages, status, stop } = useChat({
    transport,
    onError: (err) => setError(extractError(err)),
    onFinish: () => void refreshConversations(orchard),
  });

  const refreshConversations = useCallback(async (code: string) => {
    if (!code) return;
    try {
      setConversations(await canaryApi.conversations(code));
    } catch {
      /* non-fatal — the rail just stays as-is */
    }
  }, []);

  /* Load the orchard list once; default to the messenger's current orchard. */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await canaryApi.orchards();
        if (!alive) return;
        setOrchards(list);
        const preferred = list.find((x) => x.code === storeOrchard?.code)?.code ?? list[0]?.code ?? "";
        setOrchard(preferred);
        if (!list.length) setFatal({ message: "You don't have access to any orchards.", reconnect: false });
      } catch (err) {
        if (alive) setFatal(toFatal(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [storeOrchard?.code]);

  /* On orchard change: reset the chat and load that orchard's blocks + history. */
  useEffect(() => {
    if (!orchard) return;
    let alive = true;
    setMessages([]);
    setActiveId(null);
    setBlockId(null);
    sessionIdRef.current = null;
    setError(null);
    void (async () => {
      try {
        const [bl, convos] = await Promise.all([
          canaryApi.blocks(orchard),
          canaryApi.conversations(orchard),
        ]);
        if (!alive) return;
        setBlocks(bl);
        setConversations(convos);
      } catch (err) {
        if (alive && err instanceof CanaryError && err.code === "reconnect") setFatal(toFatal(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [orchard, setMessages]);

  /* ----- actions ----- */

  const newChat = () => {
    setActiveId(null);
    sessionIdRef.current = null;
    setMessages([]);
    setError(null);
  };

  const openConversation = async (id: string) => {
    setActiveId(id);
    sessionIdRef.current = null;
    setError(null);
    try {
      const { conversation, messages: stored, sessionId } = await canaryApi.conversation(orchard, id);
      setBlockId(conversation.blockId);
      setMessages(stored.map(toUiMessage) as never);
      sessionIdRef.current = sessionId;
    } catch (err) {
      setError(extractError(err));
    }
  };

  const removeConversation = async (id: string) => {
    try {
      await canaryApi.deleteConversation(orchard, id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeIdRef.current === id) newChat();
    } catch (err) {
      setError(extractError(err));
    }
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || status === "submitted" || status === "streaming") return;
    setError(null);
    const b = blockRef.current;
    const scan = b ? latestScan(b) : undefined;

    try {
      // Lazily create the conversation on the first turn.
      let convId = activeIdRef.current;
      if (!convId) {
        const res = await canaryApi.createConversation(orchard, {
          block_id: b?.blockId ?? null,
          block_name: b?.blockName ?? "",
          agent_mode: "analytical",
        });
        convId = res.conversation_id;
        setActiveId(convId);
        activeIdRef.current = convId;
      }
      // Build turn-0 context once per conversation.
      if (!sessionIdRef.current) {
        const ctx = await canaryApi.prepareContext(orchard, {
          conversation_id: convId,
          block_info: b ? { block_name: b.blockName, block_id: b.blockId } : null,
          scan_ids: scan ? [scan.scanId] : null,
          agent_mode: "analytical",
        });
        sessionIdRef.current = ctx.session_id;
      }
      const currentView = {
        block_name: b?.blockName ?? null,
        scan_ids: scan ? [scan.scanId] : null,
        sub_block_id: null,
        scan_label: scan?.scanName ?? null,
      };
      sendMessage(
        { text: trimmed },
        { body: { session_id: sessionIdRef.current, conversation_id: convId, current_view: currentView } },
      );
    } catch (err) {
      setError(extractError(err));
    }
  };

  if (fatal) return <FatalState message={fatal.message} reconnect={fatal.reconnect} />;

  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header
        orchards={orchards}
        orchard={orchard}
        onOrchard={setOrchard}
        blocks={blocks}
        blockId={blockId}
        onBlock={setBlockId}
        railOpen={railOpen}
        onToggleRail={() => setRailOpen((v) => !v)}
        onNewChat={newChat}
      />

      <div className="relative flex min-h-0 flex-1">
        {railOpen && (
          <ConversationRail
            conversations={conversations}
            activeId={activeId}
            onOpen={openConversation}
            onDelete={removeConversation}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <Thread messages={messages as unknown as UIMessage[]} thinking={status === "submitted"} />
          {error && (
            <div className="mx-4 mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
          )}
          <Composer disabled={!orchard} busy={busy} onSend={send} onStop={stop} blockName={block?.blockName} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header — identity + context pickers                                 */
/* ------------------------------------------------------------------ */

function Header({
  orchards,
  orchard,
  onOrchard,
  blocks,
  blockId,
  onBlock,
  railOpen,
  onToggleRail,
  onNewChat,
}: {
  orchards: { code: string; name: string }[];
  orchard: string;
  onOrchard: (code: string) => void;
  blocks: CanaryBlock[];
  blockId: number | null;
  onBlock: (id: number | null) => void;
  railOpen: boolean;
  onToggleRail: () => void;
  onNewChat: () => void;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-raised/70 px-3 py-2.5 backdrop-blur-xl sm:px-5">
      <button
        onClick={onToggleRail}
        className="grid size-8 place-items-center rounded-lg text-ink-dim transition hover:bg-surface-2 hover:text-ink"
        title={railOpen ? "Hide chats" : "Show chats"}
      >
        {railOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
      </button>

      <CanaryAvatar size={30} />
      <div className="mr-1 min-w-0">
        <h2 className="truncate font-display text-base font-bold text-ink">Canary</h2>
        <p className="truncate text-[11px] text-ink-dim">FruitScope AI assistant</p>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Select
          label="Orchard"
          value={orchard}
          onChange={onOrchard}
          options={orchards.map((o) => ({ value: o.code, label: o.name || o.code }))}
        />
        <Select
          label="Block"
          value={blockId === null ? "" : String(blockId)}
          onChange={(v) => onBlock(v === "" ? null : Number(v))}
          options={[
            { value: "", label: "All blocks" },
            ...[...blocks]
              .sort((a, b) => a.blockName.localeCompare(b.blockName))
              .map((b) => ({ value: String(b.blockId), label: b.blockName })),
          ]}
        />
        <button
          onClick={onNewChat}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600"
        >
          <MessageSquarePlus className="size-4" />
          New chat
        </button>
      </div>
    </header>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink-dim">
      <span className="text-ink-faint">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[10rem] truncate bg-transparent text-ink outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Conversation rail                                                   */
/* ------------------------------------------------------------------ */

function ConversationRail({
  conversations,
  activeId,
  onOpen,
  onDelete,
}: {
  conversations: CanaryConversation[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface/60 p-2 sm:flex">
      <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        History
      </p>
      {conversations.length === 0 && (
        <p className="px-2 py-1 text-xs text-ink-faint">No conversations yet.</p>
      )}
      <ul className="space-y-0.5">
        {conversations.map((c) => (
          <li key={c.id} className="group relative">
            <button
              onClick={() => onOpen(c.id)}
              className={cn(
                "w-full rounded-lg px-2 py-1.5 pr-7 text-left transition",
                c.id === activeId ? "bg-brand-500/12" : "hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "block truncate text-xs font-medium",
                  c.id === activeId ? "text-brand-700" : "text-ink",
                )}
              >
                {c.title || c.blockName || "Untitled chat"}
              </span>
              {c.preview && <span className="block truncate text-[11px] text-ink-faint">{c.preview}</span>}
            </button>
            <button
              onClick={() => onDelete(c.id)}
              className="absolute right-1 top-1.5 hidden size-5 place-items-center rounded text-ink-faint transition hover:bg-surface-2 hover:text-danger group-hover:grid"
              title="Delete chat"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Thread + composer                                                   */
/* ------------------------------------------------------------------ */

function Thread({ messages, thinking }: { messages: UIMessage[]; thinking: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  return (
    <div ref={ref} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
      {messages.length === 0 && !thinking && <Welcome />}
      {messages.map((m) => (
        <CanaryMessage key={m.id} message={m} />
      ))}
      {thinking && (
        <div className="flex items-center gap-3 text-ink-dim">
          <CanaryAvatar size={30} />
          <span className="inline-flex items-center gap-1.5 text-sm">
            <Loader2 className="size-3.5 animate-spin" />
            Thinking…
          </span>
        </div>
      )}
    </div>
  );
}

function Welcome() {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div>
        <CanaryAvatar size={56} className="mx-auto" />
        <p className="mt-4 font-display text-lg font-semibold text-ink">Ask Canary</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-dim">
          Your FruitScope AI assistant. Pick an orchard and (optionally) a block above, then ask about
          yields, scans, blocks, or anything in your data.
        </p>
      </div>
    </div>
  );
}

function Composer({
  disabled,
  busy,
  onSend,
  onStop,
  blockName,
}: {
  disabled: boolean;
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  blockName?: string | undefined;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text);
    setText("");
    if (ref.current) ref.current.style.height = "auto";
  };

  return (
    <div className="shrink-0 border-t border-line bg-raised px-3 py-3 sm:px-5">
      <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface px-3 py-2 focus-within:border-brand-300">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          disabled={disabled}
          placeholder={blockName ? `Ask Canary about ${blockName}…` : "Ask Canary…"}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-40 flex-1 resize-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        />
        {busy ? (
          <button
            onClick={onStop}
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-dim transition hover:text-ink"
            title="Stop"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!text.trim() || disabled}
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-500 text-white transition hover:bg-brand-600 disabled:opacity-40"
            title="Send"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

function FatalState({ message, reconnect }: { message: string; reconnect: boolean }) {
  return (
    <div className="grid flex-1 place-items-center px-6 text-center">
      <div>
        <CanaryAvatar size={56} className="mx-auto" />
        <p className="mt-4 font-display text-lg font-semibold text-ink">Canary is unavailable</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-dim">{message}</p>
        {reconnect && (
          <a
            href="/api/auth/login"
            className="mt-4 inline-block rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600"
          >
            Reconnect FruitScope
          </a>
        )}
      </div>
    </div>
  );
}

function extractError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const body = JSON.parse(raw) as { error?: string };
    return body.error ?? raw;
  } catch {
    return raw || "Something went wrong.";
  }
}

function toFatal(err: unknown): { message: string; reconnect: boolean } {
  if (err instanceof CanaryError && err.code === "reconnect") {
    return { message: err.message, reconnect: true };
  }
  return { message: extractError(err), reconnect: false };
}
