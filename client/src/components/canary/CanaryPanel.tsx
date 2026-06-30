import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  ArrowUp,
  Bug,
  Leaf,
  Loader2,
  MapPin,
  MessageSquarePlus,
  RotateCw,
  Search,
  Sparkles,
  Square,
  Trees,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { type CanaryBlock, CanaryError, canaryApi, chatApiPath } from "@/lib/canary";
import { useCanaryUi } from "@/store/canary";
import { usePrefs } from "@/store/prefs";
import { useChatStore } from "@/store/store";
import { CanaryAvatar } from "./CanaryAvatar";
import { CanaryMessage, type UIMessage } from "./CanaryMessage";
import { PickerMenu } from "./PickerMenu";

// The block selector pulls in MapLibre — load it only when opened.
const BlockSelectorModal = lazy(() =>
  import("./BlockSelectorModal").then((m) => ({ default: m.BlockSelectorModal })),
);

type Mode = "farm" | "general";

/* A monotonic id for restored/local messages (UIMessages need a stable id). */
let _seq = 0;
const localId = (): string => `local-${(_seq += 1)}`;

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
  // Effective admin (false while masquerading as a non-admin) gates debug context.
  const isSuperAdmin = useChatStore((s) => s.isSuperAdmin);
  const showCanaryDebug = usePrefs((s) => s.showCanaryDebug);
  const setShowCanaryDebug = usePrefs((s) => s.setShowCanaryDebug);
  const showDebug = isSuperAdmin && showCanaryDebug;

  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<{ message: string; reconnect: boolean } | null>(null);

  const [orchards, setOrchards] = useState<{ code: string; name: string }[]>([]);
  const [orchard, setOrchard] = useState<string>("");
  const [canaryMode, setCanaryMode] = useState(5);
  const [mode, setMode] = useState<Mode>("farm");
  const [blocks, setBlocks] = useState<CanaryBlock[]>([]);
  const [blockId, setBlockId] = useState<number | null>(null);
  // The selected scan(s) for the chosen block (null = use the block's latest scan).
  const [scanSel, setScanSel] = useState<{ ids: number[] | null; label: string | null }>({
    ids: null,
    label: null,
  });
  const [blockModalOpen, setBlockModalOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The conversation list lives in the shared store (the sidebar renders it; the
  // panel owns fetching it and the active thread).
  const publishCanary = useCanaryUi((s) => s.publish);
  const setCanaryConversations = useCanaryUi((s) => s.setConversations);
  const setCanaryActive = useCanaryUi((s) => s.setActiveConversationId);
  const openRequest = useCanaryUi((s) => s.openRequest);
  const consumeOpenRequest = useCanaryUi((s) => s.consumeOpenRequest);
  const newChatRequest = useCanaryUi((s) => s.newChatRequest);
  const consumeNewChatRequest = useCanaryUi((s) => s.consumeNewChatRequest);

  // Mutable per-conversation context the send path reads without re-rendering.
  const sessionIdRef = useRef<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const general = mode === "general";
  const block = useMemo(() => blocks.find((b) => b.blockId === blockId) ?? null, [blocks, blockId]);

  // Read the active orchard at send time (not when the transport was built) — the
  // orchard is chosen after mount, so a transport with the URL baked in would post
  // to a stale (empty) orchard. A stable transport + ref avoids that.
  const orchardRef = useRef(orchard);
  orchardRef.current = orchard;
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        credentials: "same-origin",
        prepareSendMessagesRequest: ({ messages, id, trigger, messageId, body }) => ({
          api: chatApiPath(orchardRef.current),
          body: { id, messages, trigger, messageId, ...body },
        }),
      }),
    [],
  );

  const refreshConversations = useCallback(
    async (code: string) => {
      if (!code) return;
      try {
        setCanaryConversations(await canaryApi.conversations(code));
      } catch {
        /* non-fatal — the tree just stays as-is */
      }
    },
    [setCanaryConversations],
  );

  // Stable callbacks so `useChat`'s returned helpers don't change identity each
  // render (which would re-fire effects that depend on them).
  const onChatError = useCallback((err: unknown) => setError(extractError(err)), []);
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
      const { orchards: list, canaryMode: cm } = await canaryApi.orchards();
      setOrchards(list);
      setCanaryMode(cm);
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
    publishCanary(orchard, []); // tell the sidebar the active orchard; list loads next
    void (async () => {
      try {
        const [bl, convos] = await Promise.all([
          general ? Promise.resolve<CanaryBlock[]>([]) : canaryApi.blocks(orchard),
          canaryApi.conversations(orchard),
        ]);
        if (!alive) return;
        setBlocks(bl);
        setCanaryConversations(convos);
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

  const clearBlock = () => {
    setBlockId(null);
    setScanSel({ ids: null, label: null });
  };

  const chooseOrchard = (code: string) => {
    if (code === orchard) return;
    clearBlock();
    setOrchard(code); // the effect resets the chat + loads the new orchard
  };

  const selectMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    if (m === "general") {
      clearBlock();
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
      if (!general) {
        setBlockId(conversation.blockId);
        setScanSel({ ids: null, label: null }); // restored block uses its latest scan
      }
      setMessages(stored.map(toUiMessage) as never);
      sessionIdRef.current = sessionId;
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
    // Use the explicitly-picked scan(s); otherwise default to the block's latest.
    const scanIds = b ? (scanSel.ids ?? (b.lastScanId != null ? [b.lastScanId] : null)) : null;
    const scanLbl = b ? (scanSel.label ?? b.lastScanStage) : null;

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
          block: b
            ? {
                name: b.blockName,
                fruitType: b.fruitType,
                variety: b.variety,
                acreage: b.acreage,
                lastScanStage: b.lastScanStage,
                lat: b.lat,
                lon: b.lon,
              }
            : null,
          scan_ids: scanIds,
          general_mode: general,
          canary_mode: canaryMode,
        });
        sessionIdRef.current = ctx.session_id;
      }
      const currentView = {
        block_name: b?.blockName ?? null,
        scan_ids: scanIds,
        sub_block_id: null,
        scan_label: scanLbl,
      };
      sendMessage(
        { text: trimmed },
        { body: { session_id: sessionIdRef.current, conversation_id: convId, current_view: currentView } },
      );
    } catch (err) {
      setError(extractError(err));
    }
  };

  /* ----- coordinate with the sidebar conversation tree ----- */

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

  // Start a fresh chat when the sidebar asks (e.g. its "+" or deleting the open one).
  useEffect(() => {
    if (!newChatRequest) return;
    newChat();
    consumeNewChatRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newChatRequest]);

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
        blockLabel={
          block ? (scanSel.label ? `${block.blockName} · ${scanSel.label}` : block.blockName) : "All blocks"
        }
        onOpenBlocks={() => setBlockModalOpen(true)}
        canDebug={isSuperAdmin}
        debugOn={showCanaryDebug}
        onToggleDebug={() => setShowCanaryDebug(!showCanaryDebug)}
        onNewChat={newChat}
      />

      {showChooser ? (
        <OrchardChooser orchards={orchards} onChoose={chooseOrchard} />
      ) : (
        <>
          <Thread
            messages={messages as unknown as UIMessage[]}
            thinking={status === "submitted"}
            general={general}
            block={block}
            showDebug={showDebug}
          />
          {error && (
            <div className="mx-4 mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>
          )}
          <Composer busy={busy} onSend={send} onStop={stop} hint={composerHint} />
        </>
      )}

      {blockModalOpen && !general && (
        <Suspense fallback={null}>
          <BlockSelectorModal
            blocks={blocks}
            orchard={orchard}
            selectedBlockId={blockId}
            onSelect={(sel) => {
              setBlockId(sel.blockId);
              setScanSel({ ids: sel.scanIds, label: sel.scanLabel });
              setBlockModalOpen(false);
            }}
            onClose={() => setBlockModalOpen(false)}
          />
        </Suspense>
      )}
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
  blockLabel,
  onOpenBlocks,
  canDebug,
  debugOn,
  onToggleDebug,
  onNewChat,
}: {
  mode: Mode;
  canGeneral: boolean;
  onMode: (m: Mode) => void;
  general: boolean;
  orchards: { code: string; name: string }[];
  orchard: string;
  onOrchard: (code: string) => void;
  blockLabel: string;
  onOpenBlocks: () => void;
  canDebug: boolean;
  debugOn: boolean;
  onToggleDebug: () => void;
  onNewChat: () => void;
}) {
  return (
    <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-raised/70 px-3 py-2.5 backdrop-blur-xl sm:px-5">
      <CanaryAvatar size={30} />
      <div className="mr-1 min-w-0">
        <h2 className="truncate font-display text-base font-bold text-ink">Canary</h2>
        <p className="truncate text-[11px] text-ink-dim">FruitScope AI assistant</p>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {canGeneral && <ModeToggle mode={mode} onMode={onMode} />}

        {!general && (
          <PickerMenu
            primary
            icon={<Trees className="size-3.5" />}
            label="Orchard"
            placeholder="Select orchard"
            value={orchard || null}
            items={orchards.map((o) => ({ value: o.code, label: o.name, sublabel: o.code }))}
            onSelect={onOrchard}
            emptyText="No orchards available"
          />
        )}
        {!general && (
          <button
            onClick={onOpenBlocks}
            title="Choose a block"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-ink-dim transition hover:bg-surface-2 hover:text-ink"
          >
            <MapPin className="size-3.5 shrink-0 text-ink-faint" />
            <span className="max-w-[10rem] truncate">{blockLabel}</span>
          </button>
        )}
        {general && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50/60 px-2.5 text-xs font-medium text-amber-700">
            <Sparkles className="size-3.5" />
            General chat
          </span>
        )}

        {canDebug && (
          <button
            onClick={onToggleDebug}
            title={debugOn ? "Hide debug context" : "Show debug context"}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg border transition",
              debugOn
                ? "border-brand-300 bg-brand-500/10 text-brand-700"
                : "border-line bg-surface text-ink-faint hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Bug className="size-4" />
          </button>
        )}

        <button
          onClick={onNewChat}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-500 px-2.5 text-xs font-semibold text-white transition hover:bg-brand-600"
        >
          <MessageSquarePlus className="size-3.5" />
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
    <div className="inline-flex h-8 items-center rounded-lg border border-line bg-surface p-0.5">
      {opts.map((o) => (
        <button
          key={o.key}
          onClick={() => onMode(o.key)}
          className={cn(
            "inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition",
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
/* Thread + composer                                                   */
/* ------------------------------------------------------------------ */

function Thread({
  messages,
  thinking,
  general,
  block,
  showDebug,
}: {
  messages: UIMessage[];
  thinking: boolean;
  general: boolean;
  block: CanaryBlock | null;
  showDebug: boolean;
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
        <CanaryMessage key={m.id} message={m} showDebug={showDebug} />
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
