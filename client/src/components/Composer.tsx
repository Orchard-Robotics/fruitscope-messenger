import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Send,
  Smile,
  SquareCode,
  Strikethrough,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ID, User } from "@shared/index";
import { REACTION_EMOJI } from "@shared/index";
import { cn } from "@/lib/cn";
import { resetToLatest } from "@/lib/jump";
import { applyMarkdown, type MdKind } from "@/lib/markdownInput";
import {
  detectMentionQuery,
  encodeMentions,
  mentionedIds,
  type MentionQuery,
} from "@/lib/mentions";
import { chat } from "@/lib/socket";
import { useChatStore } from "@/store/store";
import { Avatar } from "./Avatar";
import { PresenceDot } from "./PresenceDot";

const MAX_HEIGHT = 180;
const TYPING_IDLE_MS = 2500;
const MAX_SUGGESTIONS = 8;

/** People mentioned in `content` who can't see this conversation (Slack's prompt). */
type MentionNotice = { kind: "channel"; users: User[]; channelName: string } | { kind: "dm"; users: User[] };

export function Composer({ channelId, placeholder }: { channelId: ID; placeholder: string }) {
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [notice, setNotice] = useState<MentionNotice | null>(null);

  const users = useChatStore((s) => s.users);
  const meId = useChatStore((s) => s.me?.id);
  const channel = useChatStore((s) => s.channels[channelId]);

  /* @mention autocomplete state */
  const [mention, setMention] = useState<MentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const dismissedStart = useRef<number | null>(null); // Esc keeps the menu shut for this @

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const typingActive = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** username (lowercased) → user, for encoding mentions on send. */
  const usersByUsername = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of Object.values(users)) map.set(u.username.toLowerCase(), u);
    return map;
  }, [users]);

  /** Ranked suggestions for the active query (startsWith beats includes). */
  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return Object.values(users)
      .filter((u) => u.id !== meId)
      .map((u) => {
        const dn = u.displayName.toLowerCase();
        const un = u.username.toLowerCase();
        let score = -1;
        if (!q) score = 0;
        else if (un.startsWith(q) || dn.startsWith(q)) score = 2;
        else if (un.includes(q) || dn.includes(q)) score = 1;
        return { u, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || a.u.displayName.localeCompare(b.u.displayName))
      .slice(0, MAX_SUGGESTIONS)
      .map((x) => x.u);
  }, [mention, users, meId]);

  const menuOpen = mention !== null && suggestions.length > 0;

  const stopTyping = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (typingActive.current) {
      typingActive.current = false;
      chat.typingStop(channelId);
    }
  };

  const pingTyping = () => {
    if (!typingActive.current) {
      typingActive.current = true;
      chat.typingStart(channelId);
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  useEffect(() => {
    setText("");
    setEmojiOpen(false);
    setMention(null);
    setNotice(null);
    return () => stopTyping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // Resize to fit, and apply a queued caret position after a mention insert.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (pendingCaret.current != null) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
    if (pendingSelection.current) {
      el.focus();
      el.setSelectionRange(pendingSelection.current.start, pendingSelection.current.end);
      pendingSelection.current = null;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const syncMention = (value: string, caret: number) => {
    const q = detectMentionQuery(value, caret);
    if (q && dismissedStart.current === q.start) {
      setMention(null);
      return;
    }
    dismissedStart.current = null;
    setMention(q);
    setActiveIndex(0);
  };

  const accept = (user: User) => {
    const el = textareaRef.current;
    if (!mention || !el) return;
    const caret = el.selectionStart ?? text.length;
    const before = text.slice(0, mention.start);
    const after = text.slice(caret);
    const insert = `@${user.username} `;
    setText(before + insert + after);
    pendingCaret.current = before.length + insert.length;
    setMention(null);
  };

  /** Apply a markdown format to the current textarea selection. */
  const format = (kind: MdKind) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? start;
    const res = applyMarkdown(text, start, end, kind);
    setText(res.value);
    pendingSelection.current = { start: res.selStart, end: res.selEnd };
    pingTyping();
  };

  /** People mentioned in `content` who can't see this conversation. */
  const outsiders = (content: string): User[] => {
    if (!channel) return [];
    // Public channels are readable by the whole orchard — nobody is an outsider.
    if (channel.kind === "channel" && !channel.isPrivate) return [];
    const members = new Set(channel.memberIds);
    return mentionedIds(content)
      .filter((id) => id !== meId && !members.has(id))
      .map((id) => users[id])
      .filter((u): u is User => Boolean(u));
  };

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const content = encodeMentions(trimmed, usersByUsername);
    setText("");
    setMention(null);
    stopTyping();
    const res = await chat.send(channelId, content);
    if (!res.ok) {
      setText(trimmed);
      textareaRef.current?.focus();
      return;
    }
    if (useChatStore.getState().detached[channelId]) {
      // Sending from a jumped-to (historical) view snaps back to live.
      void resetToLatest(channelId);
    }
    // Slack-style: if you mentioned someone who can't see this conversation,
    // prompt to add them (channel) or note they can't be added (DM).
    const missing = outsiders(content);
    if (missing.length && channel) {
      setNotice(
        channel.kind === "dm"
          ? { kind: "dm", users: missing }
          : { kind: "channel", users: missing, channelName: channel.name },
      );
    }
    textareaRef.current?.focus();
  };

  const addMissingToChannel = async () => {
    if (!notice || notice.kind !== "channel") return;
    const res = await chat.addMembers(channelId, notice.users.map((u) => u.id));
    if (res.ok) setNotice(null);
  };

  return (
    <div className="px-4 pb-5 pt-1">
      {/* Slack-style "not in this conversation" prompt (only you see it). */}
      {notice && (
        <div className="anim-pop-in mb-2 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
          <span className="flex-1 text-ink-dim">
            <span className="font-medium text-ink">
              {notice.users.map((u) => `@${u.displayName}`).join(", ")}
            </span>{" "}
            {notice.users.length > 1 ? "aren’t" : "isn’t"} in this conversation
            {notice.kind === "channel"
              ? " yet."
              : " — you can’t add people to a direct message."}
          </span>
          {notice.kind === "channel" && (
            <button
              onClick={() => void addMissingToChannel()}
              className="shrink-0 rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand-600"
            >
              Add to #{notice.channelName}
            </button>
          )}
          <button
            onClick={() => setNotice(null)}
            className="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-ink-faint transition hover:bg-surface-2 hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Slack-style formatting toolbar */}
      <div className="mb-1.5 flex flex-wrap items-center gap-0.5 px-2">
        <FmtBtn icon={Bold} title="Bold  ⌘B" onClick={() => format("bold")} />
        <FmtBtn icon={Italic} title="Italic  ⌘I" onClick={() => format("italic")} />
        <FmtBtn icon={Strikethrough} title="Strikethrough  ⌘⇧X" onClick={() => format("strike")} />
        <FmtDivider />
        <FmtBtn icon={Code} title="Code  ⌘⇧C" onClick={() => format("code")} />
        <FmtBtn icon={SquareCode} title="Code block" onClick={() => format("codeblock")} />
        <FmtBtn icon={Quote} title="Quote" onClick={() => format("quote")} />
        <FmtDivider />
        <FmtBtn icon={List} title="Bulleted list" onClick={() => format("bullet")} />
        <FmtBtn icon={ListOrdered} title="Numbered list" onClick={() => format("ordered")} />
        <FmtBtn icon={LinkIcon} title="Link" onClick={() => format("link")} />
      </div>

      <div className="relative flex items-end gap-2 rounded-[26px] border border-line bg-canvas px-3 py-2 shadow-floating transition focus-within:border-brand-400">
        {/* @mention autocomplete */}
        {menuOpen && (
          <div className="anim-pop-in absolute bottom-full left-2 z-30 mb-2 w-80 overflow-hidden rounded-xl border border-line bg-raised py-1 shadow-floating">
            <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              People
            </p>
            <ul className="max-h-64 overflow-y-auto">
              {suggestions.map((u, i) => (
                <li key={u.id}>
                  <button
                    type="button"
                    // mousedown (not click) so the textarea doesn't blur first
                    onMouseDown={(e) => {
                      e.preventDefault();
                      accept(u);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition",
                      i === activeIndex ? "bg-brand-500/12" : "hover:bg-surface-2",
                    )}
                  >
                    <span className="relative">
                      <Avatar user={u} size={24} className="rounded-lg" />
                      <PresenceDot
                        status={u.status}
                        className="absolute -bottom-1 -right-1 size-2"
                        ring="ring-raised"
                      />
                    </span>
                    <span className="truncate font-medium text-ink">{u.displayName}</span>
                    <span className="truncate text-xs text-ink-faint">@{u.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="relative">
          <button
            onClick={() => setEmojiOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-xl text-ink-dim transition hover:bg-surface-2 hover:text-brand-600"
            title="Emoji"
          >
            <Smile className="size-5" />
          </button>
          {emojiOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setEmojiOpen(false)} />
              <div className="anim-pop-in absolute bottom-12 left-0 z-20 flex gap-1 rounded-xl border border-line bg-raised p-1.5 shadow-lg">
                {REACTION_EMOJI.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      setText((t) => t + emoji);
                      setEmojiOpen(false);
                      textareaRef.current?.focus();
                    }}
                    className="grid size-8 place-items-center rounded-lg text-lg transition hover:scale-110 hover:bg-surface-2"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            pingTyping();
            syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onBlur={stopTyping}
          onKeyDown={(e) => {
            if (menuOpen) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (i + 1) % suggestions.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                accept(suggestions[activeIndex] ?? suggestions[0]!);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                dismissedStart.current = mention?.start ?? null;
                setMention(null);
                return;
              }
            }
            // Formatting shortcuts (Slack-style).
            if (e.metaKey || e.ctrlKey) {
              const k = e.key.toLowerCase();
              const map: Record<string, MdKind> = e.shiftKey
                ? { x: "strike", c: "code" }
                : { b: "bold", i: "italic" };
              if (map[k]) {
                e.preventDefault();
                format(map[k]);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="max-h-44 flex-1 resize-none bg-transparent py-2 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
        />

        <button
          onClick={() => void send()}
          disabled={!text.trim()}
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full transition",
            text.trim()
              ? "bg-brand-500 text-white hover:bg-brand-600"
              : "bg-surface-2 text-ink-faint",
          )}
          title="Send"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** A formatting-toolbar button. mousedown (not click) so the textarea keeps focus
 *  + its selection while the markdown is applied. */
function FmtBtn({
  icon: Icon,
  title,
  onClick,
}: {
  icon: typeof Bold;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="grid size-7 place-items-center rounded-md text-ink-faint transition hover:bg-surface-2 hover:text-ink"
    >
      <Icon className="size-4" />
    </button>
  );
}

function FmtDivider() {
  return <span className="mx-1 h-4 w-px bg-line" />;
}
