import { Hash, Lock } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { chat } from "@/lib/socket";
import { useChatStore } from "@/store/store";
import { Modal } from "./Modal";

export function CreateChannelModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName("");
    setTopic("");
    setIsPrivate(false);
    setError(null);
    setBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await chat.createChannel({
      name,
      ...(topic.trim() ? { topic: topic.trim() } : {}),
      isPrivate,
    });
    if (res.ok) {
      setActiveChannel(res.data.id);
      chat.read(res.data.id);
      close();
    } else {
      setError(res.error);
      setBusy(false);
    }
  };

  const preview = name.trim().replace(/\s+/g, "-").toLowerCase();

  return (
    <Modal open={open} onClose={close} title="Create a channel">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-dim">Name</span>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:focus-ring">
            {isPrivate ? (
              <Lock className="size-4 text-ink-faint" />
            ) : (
              <Hash className="size-4 text-ink-faint" />
            )}
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="rooftop-garden"
              spellCheck={false}
              className="w-full bg-transparent py-3 text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </div>
          {preview && preview !== name && (
            <span className="mt-1 block text-xs text-ink-faint">Will be created as #{preview}</span>
          )}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-dim">
            Topic <span className="text-xs text-ink-faint">optional</span>
          </span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What's this channel about?"
            className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink placeholder:text-ink-faint focus:focus-ring"
          />
        </label>

        <button
          type="button"
          onClick={() => setIsPrivate((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-line bg-surface/60 px-4 py-3 text-left transition hover:bg-surface-2"
        >
          <span>
            <span className="block text-sm font-medium text-ink">Private channel</span>
            <span className="block text-xs text-ink-faint">Only invited members can see it</span>
          </span>
          <span
            className={cn(
              "relative h-6 w-11 rounded-full transition",
              isPrivate ? "bg-brand-500" : "bg-surface-2 ring-1 ring-line",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-5 rounded-full bg-raised shadow-sm transition",
                isPrivate ? "left-[22px]" : "left-0.5",
              )}
            />
          </span>
        </button>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={close}
            className="rounded-xl px-4 py-2.5 text-ink-dim transition hover:bg-surface-2 hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-xl bg-brand-500 px-5 py-2.5 font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}
