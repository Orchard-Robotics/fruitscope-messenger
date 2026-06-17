import { AnimatePresence, motion } from "framer-motion";
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

  // Reset draft + typing state when switching channels / unmounting.
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
    if (!res.ok) setText(content); // restore draft on failure
    textareaRef.current?.focus();
  };

  return (
    <div className="px-4 pb-5 pt-1">
      <div className="glass relative flex items-end gap-2 rounded-2xl px-3 py-2 shadow-lg shadow-black/20 focus-within:focus-ring">
        <div className="relative">
          <button
            onClick={() => setEmojiOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-xl text-ink-dim transition hover:bg-bark-700 hover:text-leaf-300"
            title="Emoji"
          >
            <Smile className="size-5" />
          </button>
          <AnimatePresence>
            {emojiOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setEmojiOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.95 }}
                  transition={{ duration: 0.14 }}
                  className="glass absolute bottom-12 left-0 z-20 flex gap-1 rounded-xl p-1.5 shadow-2xl shadow-black/40"
                >
                  {REACTION_EMOJI.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => {
                        setText((t) => t + emoji);
                        setEmojiOpen(false);
                        textareaRef.current?.focus();
                      }}
                      className="grid size-8 place-items-center rounded-lg text-lg transition hover:scale-110 hover:bg-bark-700"
                    >
                      {emoji}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
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
            "grid size-9 shrink-0 place-items-center rounded-xl transition",
            text.trim()
              ? "bg-gradient-to-br from-leaf-400 to-leaf-600 text-bark-950 hover:brightness-105"
              : "bg-bark-700 text-ink-faint",
          )}
          title="Send"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}
