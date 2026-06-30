import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  ArrowUp,
  Leaf,
  Loader2,
  MapPin,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCw,
  Search,
  Sparkles,
  Square,
  Trash2,
  Trees,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { type CanaryBlock, type CanaryConversation, CanaryError, canaryApi, chatApiPath } from "@/lib/canary";
import { useCanaryUi } from "@/store/canary";
import { useChatStore } from "@/store/store";
import { CanaryAvatar } from "./CanaryAvatar";
import { CanaryMessage, type UIMessage } from "./CanaryMessage";
import { PickerMenu } from "./PickerMenu";

type Mode = "farm" | "general";

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
  const canUseGeneralMode = useChatStore((s) => s.canUseGeneralMode);

  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<{ message: string; reconnect: boolean } | null>(null);

  const [orchards, setOrchards] = useState<{ code: string; name: string }[]>([]);
  const [orchard, setOrchard] = useState<string>("");
  const [mode, setMode] = useState<Mode>("farm");
  const [blocks, setBlocks] = useState<CanaryBlock[]>([]);
  const [blockId, setBlockId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<CanaryConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Shared with the sidebar's conversation tree.
  const publishCanary = useCanaryUi((s) => s.publish);
  const setCanaryActive = useCanaryUi((s) => s.setActiveConversationId);
  const openRequest = useCanaryUi((s) => s.openRequest);
  const consumeOpenRequest = useCanaryUi((s) => s.consumeOpenRequest);

  // Mutable per-conversation context the send path reads without re-rendering.
  const sessionIdRef = useRef<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const general = mode === "general";
  const block = useMemo(() => blocks.find((b) => b.blockId === blockId) ?? null, [blocks, blockId]);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: chatApiPath(orchard), credentials: "same-origin" }),
    [orchard],
  );

  const refreshConversations = useCallback(async (code: string) => {
    if (!code) return;
    try {
      setConversations(await canaryApi.conversations(code));
    } catch {
      /* non-fatal — the rail just stays as-is */
    }
  }, []);

  // Stable callbacks so `useChat`'s returned helpers don't change identity each
  // render (which would re-fire effects that depend on them).
  const onChatError = useCallback((err: unknown) => setError(extractError(err)), []);
  const orchardRef = useRef(orchard);
  orchardRef.current = orchard;
  const onChatFinish = useCallback(() => void refreshConversations(orchardRef.current), [refreshConversations]);

  const { messages, sendMessage, setMessages, status, stop } = useChat({
    transport,
    onError: onChatError,
    onFinish: onChatFinish,
  });

  /* Load the orchard list. On success, default to the messenger's current
   * orchard (or the only one); leave unset for multi-orchard users so they
   * consciously choose. Failures are recoverable (retry), not a dead end. */
  const loadOrchards = useCallback(async () => {
    setLoadState("loading");
    setLoadError(null);
    try {
      const list = await canaryApi.orchards();
      setOrchards(list);
      setLoadState("ready");
      setOrchard((prev) => {
        if (prev) return prev;
        const preferred = list.find((x) => x.code === storeOrchard?.code)?.code;
        return preferred ?? (list.length === 1 ? (list[0]?.code ?? "") : "");
      });
    } catch (err) {
      setLoadError(toFatal(err));
      setLoadState("error");
    }
  }, [storeOrchard?.code]);

  useEffect(() => {
    void loadOrchards();
  }, [loadOrchards]);

  /* On orchard/mode change: reset the chat and load history (+ blocks for farm). */
  useEffect(() => {
    if (!orchard) return;
    let alive = true;
    setMessages([]);
    setActiveId(null);
    sessionIdRef.current = null;
    setError(null);
    void (async () => {
      try {
        const [bl, convos] = await Promise.all([
          general ? Promise.resolve<CanaryBlock[]>([]) : canaryApi.blocks(orchard),
          canaryApi.conversations(orchard),
        ]);
        if (!alive) return;
        setBlocks(bl);
        setConversations(convos);
      } catch (err) {
        if (!alive) return;
        if (err instanceof CanaryError && err.code === "reconnect") {
          setLoadError(toFatal(err));
          setLoadState("error");
        } else {
          setError(extractError(err));
        }
      }
    })();
    return () => {
      alive = false;
    };
    // setMessages is stable in practice; keep it out of deps so an unstable
    // identity can never turn this fetch into a render loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orchard, general]);

  /* ----- actions ----- */

  const newChat = () => {
    setActiveId(null);
    sessionIdRef.current = null;
    setMessages([]);
    setError(null);
  };

  const chooseOrchard = (code: string) => {
    if (code === orchard) return;
    setBlockId(null);
    setOrchard(code); // the effect resets the chat + loads the new orchard
  };

  const selectMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    if (m === "general") {
      setBlockId(null);
      if (!orchard && orchards[0]) setOrchard(orchards[0].code); // general still needs a container
    }
    newChat();
  };

  const openConversation = async (id: string) => {
    setActiveId(id);
    sessionIdRef.current = null;
    setError(null);
    try {
      const { conversation, messages: stored, sessionId } = await canaryApi.conversation(orchard, id);
      if (!general) setBlockId(conversation.blockId);
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
    if (!orchard) {
      setError("Pick an orchard first.");
      return;
    }
    setError(null);
    const b = general ? null : block;
    const scan = b ? latestScan(b) : undefined;

    try {
      let convId = activeIdRef.current;
      if (!convId) {
        const res = await canaryApi.createConversation(orchard, {
          block_id: b?.blockId ?? null,
          block_name: b?.blockName ?? "",
          agent_mode: "analytical",
          general_mode: general,
        });
        convId = res.conversation_id;
        setActiveId(convId);
        activeIdRef.current = convId;
        void refreshConversations(orchard);
      }
      if (!sessionIdRef.current) {
        const ctx = await canaryApi.prepareContext(orchard, {
          conversation_id: convId,
          block_info: b ? { block_name: b.blockName, block_id: b.blockId } : null,
          scan_ids: scan ? [scan.scanId] : null,
          agent_mode: "analytical",
          general_mode: general,
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

  /* ----- keep the sidebar conversation tree in sync ----- */

  useEffect(() => {
    publishCanary(orchard, conversations);
  }, [orchard, conversations, publishCanary]);

  useEffect(() => {
    setCanaryActive(activeId);
  }, [activeId, setCanaryActive]);

  // Open a conversation the sidebar asked for, once the orchard is ready.
  useEffect(() => {
    if (!openRequest || loadState !== "ready" || !orchard) return;
    void openConversation(openRequest.id);
    consumeOpenRequest();
    // openConversation is a fresh closure each render with the current orchard;
    // we intentionally key only on the request/readiness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest, loadState, orchard]);

  /* ----- render ----- */

  if (loadState === "loading") {
    return (
      <div className="grid flex-1 place-items-center text-ink-dim">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }
  if (loadState === "error" && loadError) {
    return loadError.reconnect ? (
      <FatalState message={loadError.message} reconnect />
    ) : (
      <ErrorState message={loadError.message} onRetry={() => void loadOrchards()} />
    );
  }

  const showChooser = !general && !orchard;
  const busy = status === "submitted" || status === "streaming";
  const composerHint = general ? "Ask Canary anything…" : block ? `Ask about ${block.blockName}…` : "Ask Canary…";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header
        mode={mode}
        canGeneral={canUseGeneralMode}
        onMode={selectMode}
        general={general}
        orchards={orchards}
        orchard={orchard}
        onOrchard={chooseOrchard}
        blocks={blocks}
        blockId={blockId}
        onBlock={setBlockId}
        railOpen={railOpen}
        onToggleRail={() => setRailOpen((v) => !v)}
        onNewChat={newChat}
      />

      <div className="relative flex min-h-0 flex-1">
        {railOpen && !showChooser && (
          <ConversationRail
            conversations={conversations}
            activeId={activeId}
            onOpen={openConversation}
            onDelete={removeConversation}
          />
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {showChooser ? (
            <OrchardChooser orchards={orchards} onChoose={chooseOrchard} />
          ) : (
            <>
              <Thread messages={messages as unknown as UIMessage[]} thinking={status === "submitted"} general={general} block={block} />
              {error && (
                <div className="mx-4 mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
              )}
              <Composer busy={busy} onSend={send} onStop={stop} hint={composerHint} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header — identity, mode, context pickers                            */
/* ------------------------------------------------------------------ */

function Header({
  mode,
  canGeneral,
  onMode,
  general,
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
  mode: Mode;
  canGeneral: boolean;
  onMode: (m: Mode) => void;
  general: boolean;
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
    <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-raised/70 px-3 py-2.5 backdrop-blur-xl sm:px-5">
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
        {canGeneral && <ModeToggle mode={mode} onMode={onMode} />}

        {!general && (
          <PickerMenu
            primary
            icon={<Trees className="size-4" />}
            label="Orchard"
            placeholder="Select orchard"
            value={orchard || null}
            items={orchards.map((o) => ({ value: o.code, label: o.name, sublabel: o.code }))}
            onSelect={onOrchard}
            emptyText="No orchards available"
          />
        )}
        {!general && (
          <PickerMenu
            icon={<MapPin className="size-4" />}
            label="Block"
            placeholder="All blocks"
            value={blockId === null ? "all" : String(blockId)}
            items={[
              { value: "all", label: "All blocks", sublabel: "No specific block" },
              ...[...blocks]
                .sort((a, b) => a.blockName.localeCompare(b.blockName))
                .map((b) => ({
                  value: String(b.blockId),
                  label: b.blockName,
                  ...(b.ranchName ? { sublabel: b.ranchName } : {}),
                })),
            ]}
            onSelect={(v) => onBlock(v === "all" ? null : Number(v))}
            emptyText="No blocks in this orchard"
          />
        )}
        {general && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50/60 px-3 py-1.5 text-xs font-medium text-amber-700">
            <Sparkles className="size-4" />
            General chat — not tied to a block or orchard
          </span>
        )}

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

function ModeToggle({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  const opts: { key: Mode; label: string; icon: React.ReactNode }[] = [
    { key: "farm", label: "Farm", icon: <Leaf className="size-3.5" /> },
    { key: "general", label: "General", icon: <Sparkles className="size-3.5" /> },
  ];
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {opts.map((o) => (
        <button
          key={o.key}
          onClick={() => onMode(o.key)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition",
            mode === o.key ? "bg-raised text-brand-700 shadow-sm" : "text-ink-dim hover:text-ink",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Orchard chooser (prominent, when nothing is selected yet)           */
/* ------------------------------------------------------------------ */

function OrchardChooser({
  orchards,
  onChoose,
}: {
  orchards: { code: string; name: string }[];
  onChoose: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orchards;
    return orchards.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q));
  }, [orchards, query]);

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
      <div className="w-full max-w-md">
        <div className="text-center">
          <CanaryAvatar size={56} className="mx-auto" />
          <h3 className="mt-4 font-display text-lg font-bold text-ink">Choose an orchard</h3>
          <p className="mt-1 text-sm text-ink-dim">
            Canary answers about the orchard you pick. You can switch any time.
          </p>
        </div>

        {orchards.length > 7 && (
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
            <Search className="size-4 shrink-0 text-ink-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search orchards…"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
        )}

        <ul className="mt-3 max-h-[22rem] space-y-1.5 overflow-y-auto">
          {filtered.map((o) => (
            <li key={o.code}>
              <button
                onClick={() => onChoose(o.code)}
                className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition hover:border-brand-300 hover:bg-brand-500/5"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-600">
                  <Trees className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{o.name}</span>
                  <span className="block truncate text-xs text-ink-faint">{o.code}</span>
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-1 py-2 text-sm text-ink-faint">No orchards match “{query}”.</li>
          )}
        </ul>
      </div>
    </div>
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

function Thread({
  messages,
  thinking,
  general,
  block,
}: {
  messages: UIMessage[];
  thinking: boolean;
  general: boolean;
  block: CanaryBlock | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  return (
    <div ref={ref} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
      {messages.length === 0 && !thinking && <Welcome general={general} block={block} />}
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

function Welcome({ general, block }: { general: boolean; block: CanaryBlock | null }) {
  return (
    <div className="grid h-full place-items-center px-6 text-center">
      <div>
        <CanaryAvatar size={56} className="mx-auto" />
        <p className="mt-4 font-display text-lg font-semibold text-ink">Ask Canary</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-dim">
          {general
            ? "General chat — Canary answers freely, without farm data, blocks, or scans."
            : block
              ? `Grounded on ${block.blockName}. Ask about yields, scans, sizing, or anything in this block.`
              : "Pick a block above for grounded answers, or just ask about this orchard."}
        </p>
      </div>
    </div>
  );
}

function Composer({
  busy,
  onSend,
  onStop,
  hint,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  hint: string;
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
          placeholder={hint}
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
            disabled={!text.trim()}
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
/* Error states                                                        */
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

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid flex-1 place-items-center px-6 text-center">
      <div>
        <CanaryAvatar size={56} className="mx-auto" />
        <p className="mt-4 font-display text-lg font-semibold text-ink">Couldn’t reach Canary</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-dim">{message}</p>
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600"
        >
          <RotateCw className="size-4" />
          Try again
        </button>
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
