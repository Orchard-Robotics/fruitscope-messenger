import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ID } from "@shared/index";
import { chat } from "@/lib/socket";
import { useChatStore } from "@/store/store";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";

/** Slack-style "new message": pick one or more people → open a (group) DM. */
export function NewDmModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const users = useChatStore((s) => s.users);
  const meId = useChatStore((s) => s.me?.id ?? "");
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);

  const [selected, setSelected] = useState<ID[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSelected([]);
      setQ("");
      setBusy(false);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const candidates = useMemo(() => {
    const lq = q.trim().toLowerCase();
    return Object.values(users)
      .filter((u) => u.id !== meId && !selected.includes(u.id))
      .filter(
        (u) =>
          !lq || u.displayName.toLowerCase().includes(lq) || u.username.toLowerCase().includes(lq),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, 8);
  }, [users, meId, selected, q]);

  const toggle = (id: ID): void => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setQ("");
    inputRef.current?.focus();
  };

  const start = async (): Promise<void> => {
    if (!selected.length || busy) return;
    setBusy(true);
    setError(null);
    const res = await chat.openGroup(selected);
    if (res.ok) {
      setActiveChannel(res.data.id);
      chat.read(res.data.id);
      onClose();
    } else {
      setError(res.error);
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New message">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface px-2 py-2 focus-within:focus-ring">
          {selected.map((id) => {
            const u = users[id];
            if (!u) return null;
            return (
              <span
                key={id}
                className="flex items-center gap-1 rounded-full bg-brand-500/12 py-0.5 pl-1 pr-1.5 text-sm font-medium text-brand-700"
              >
                <Avatar user={u} size={18} className="rounded-md" />
                {u.displayName}
                <button
                  onClick={() => toggle(id)}
                  className="grid size-4 place-items-center rounded-full hover:bg-brand-500/20"
                  aria-label={`Remove ${u.displayName}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            );
          })}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={selected.length ? "Add another…" : "Type a name…"}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !q && selected.length) {
                setSelected((s) => s.slice(0, -1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (candidates[0]) toggle(candidates[0].id);
              }
            }}
            className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </div>

        {candidates.length > 0 && (
          <ul className="max-h-56 overflow-y-auto rounded-xl border border-line">
            {candidates.map((u) => (
              <li key={u.id}>
                <button
                  onClick={() => toggle(u.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-surface-2"
                >
                  <Avatar user={u} size={26} className="rounded-lg" />
                  <span className="font-medium text-ink">{u.displayName}</span>
                  <span className="text-xs text-ink-faint">@{u.username}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          onClick={() => void start()}
          disabled={!selected.length || busy}
          className="w-full rounded-full bg-brand-500 px-4 py-2.5 font-semibold text-white shadow-soft transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? "Starting…"
            : selected.length > 1
              ? `Start group message (${selected.length})`
              : "Start message"}
        </button>
      </div>
    </Modal>
  );
}
