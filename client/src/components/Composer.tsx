import { Send, Smile } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ID } from "@shared/index";
import { REACTION_EMOJI } from "@shared/index";
import { cn } from "@/lib/cn";
import { chat } from "@/lib/socket";

const MAX_HEIGHT = 180;
const TYPING_IDLE_MS = 2500;

export function Composer({ channelId, placeholder }: { channelId: ID; placeholder: string }) {
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingActive = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return () => stopTyping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const autosize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  };

  useEffect(autosize, [text]);

  const send = async () => {
    const content = text.trim();
    if (!content) return;
    setText("");
    stopTyping();
    const res = await chat.send(channelId, content);
    if (!res.ok) setText(content);
    textareaRef.current?.focus();
  };

  return (
    <div className="px-4 pb-5 pt-1">
      <div className="relative flex items-end gap-2 rounded-[26px] border border-line bg-canvas px-3 py-2 shadow-floating transition focus-within:border-brand-400">
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
              <div className="anim-pop-in absolute bottom-12 left-0 z-20 flex gap-1 rounded-xl border border-line bg-white p-1.5 shadow-lg">
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
          }}
          onBlur={stopTyping}
          onKeyDown={(e) => {
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
