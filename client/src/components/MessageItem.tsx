import { Check, Copy, Link2, MoreHorizontal, Pencil, SmilePlus } from "lucide-react";
import { useState } from "react";

import type { ID, Message, User } from "@shared/index";
import { REACTION_EMOJI } from "@shared/index";
import { cn } from "@/lib/cn";
import { timeOfDay } from "@/lib/format";
import { copyToClipboard, messageLink, messagePlainText } from "@/lib/messageLink";
import { decodeMentionsToInput, encodeMentions } from "@/lib/mentions";
import { chat } from "@/lib/socket";
import { useChatStore } from "@/store/store";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState<"link" | "text" | null>(null);

  const isOwn = message.authorId === meId;

  const react = (emoji: string) => {
    setPicking(false);
    void chat.react(message.id, emoji);
  };

  const flashCopied = (which: "link" | "text") => {
    setCopied(which);
    setMenuOpen(false);
    window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
  };

  const copyLink = async () => {
    if (await copyToClipboard(messageLink(message.channelId, message.id))) flashCopied("link");
  };
  const copyText = async () => {
    const text = messagePlainText(message.content, useChatStore.getState().users);
    if (await copyToClipboard(text)) flashCopied("text");
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
          author?.isCanary ? (
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

        {editing ? (
          <MessageEditor message={message} onDone={() => setEditing(false)} />
        ) : (
          <div>
            <MessageContent content={message.content} meId={meId} />
            {message.editedAt && (
              <span className="ml-1 align-baseline text-[10px] text-ink-faint">(edited)</span>
            )}
          </div>
        )}

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

      {/* Transient "Copied" confirmation */}
      {copied && (
        <div className="anim-pop-in absolute -top-2 right-3 z-30 inline-flex items-center gap-1 rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-canvas shadow-lg">
          <Check className="size-3" />
          {copied === "link" ? "Link copied" : "Copied"}
        </div>
      )}

      {/* Hover toolbar */}
      <div
        className={cn(
          "absolute -top-3 right-3 flex gap-1 transition",
          picking || menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        {/* React */}
        <div className="relative">
          <button
            onClick={() => {
              setMenuOpen(false);
              setPicking((v) => !v);
            }}
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

        {/* More actions */}
        <div className="relative">
          <button
            onClick={() => {
              setPicking(false);
              setMenuOpen((v) => !v);
            }}
            className="grid size-8 place-items-center rounded-lg border border-line bg-raised text-ink-dim shadow-sm transition hover:text-brand-600"
            title="More actions"
          >
            <MoreHorizontal className="size-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="anim-pop-in absolute right-0 top-9 z-20 w-44 overflow-hidden rounded-xl border border-line bg-raised py-1 shadow-lg">
                <MenuItem icon={<Link2 className="size-3.5" />} onClick={() => void copyLink()}>
                  Copy link
                </MenuItem>
                <MenuItem icon={<Copy className="size-3.5" />} onClick={() => void copyText()}>
                  Copy text
                </MenuItem>
                {isOwn && (
                  <MenuItem
                    icon={<Pencil className="size-3.5" />}
                    onClick={() => {
                      setMenuOpen(false);
                      setEditing(true);
                    }}
                  >
                    Edit message
                  </MenuItem>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-ink-dim transition hover:bg-surface-2 hover:text-ink"
    >
      {icon}
      {children}
    </button>
  );
}

/** Inline editor for your own message — Enter saves, Esc cancels, Shift+Enter newline. */
function MessageEditor({ message, onDone }: { message: Message; onDone: () => void }) {
  const [draft, setDraft] = useState(() =>
    decodeMentionsToInput(message.content, useChatStore.getState().users),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const text = draft.trim();
    if (!text) {
      setError("Message can't be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    const users = useChatStore.getState().users;
    const byUsername = new Map(Object.values(users).map((u) => [u.username.toLowerCase(), u]));
    const res = await chat.edit(message.id, encodeMentions(text, byUsername));
    setBusy(false);
    if (res.ok) onDone();
    else setError(res.error);
  };

  return (
    <div className="mt-1">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
        rows={Math.min(8, draft.split("\n").length + 1)}
        className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-400"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={busy}
          className="rounded-lg bg-brand-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={onDone}
          className="rounded-lg border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink-dim transition hover:bg-surface-2"
        >
          Cancel
        </button>
        <span className="text-[11px] text-ink-faint">Enter to save · Esc to cancel</span>
        {error && <span className="text-[11px] text-danger">{error}</span>}
      </div>
    </div>
  );
}
