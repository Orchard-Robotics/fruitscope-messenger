import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Orchard } from "@shared/index";
import { rest } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useChatStore } from "@/store/store";

/**
 * The workspace title. For super admins it's a dropdown that lists every orchard
 * and re-scopes the session to the chosen one (a full reload lands in the new
 * workspace with a clean store). Regular users see a static title.
 */
export function OrchardSwitcher({ onlineCount }: { onlineCount: number }) {
  const orchard = useChatStore((s) => s.orchard);
  const isSuperAdmin = useChatStore((s) => s.isSuperAdmin);

  const [open, setOpen] = useState(false);
  const [orchards, setOrchards] = useState<Orchard[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Lazy-load the orchard list the first time the menu is opened.
  useEffect(() => {
    if (open && orchards === null) {
      void rest
        .orchards()
        .then(setOrchards)
        .catch(() => setOrchards([]));
    }
  }, [open, orchards]);

  const title = (
    <div className="min-w-0 text-left leading-tight">
      <h1 className="truncate font-display text-lg font-bold text-ink">
        {orchard?.name ?? "FruitScope"}
      </h1>
      <p className="flex items-center gap-1.5 text-xs text-ink-dim">
        <span className="size-1.5 rounded-full bg-brand-500" />
        {onlineCount} online
      </p>
    </div>
  );

  if (!isSuperAdmin) return title;

  const choose = async (o: Orchard) => {
    if (o.id === orchard?.id) {
      setOpen(false);
      return;
    }
    setSwitching(o.id);
    try {
      await rest.switchOrchard(o.id);
      window.location.assign("/"); // reload cleanly into the new workspace
    } catch {
      setSwitching(null);
    }
  };

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 -ml-1.5 transition hover:bg-surface-2"
        title="Switch workspace"
      >
        {title}
        <ChevronDown
          className={cn("size-4 shrink-0 text-ink-faint transition", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 max-h-80 w-64 overflow-y-auto rounded-xl border border-line bg-raised p-1.5 shadow-floating">
          <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Switch workspace
          </p>
          {orchards === null && <p className="px-2 py-2 text-sm text-ink-faint">Loading…</p>}
          {orchards?.map((o) => {
            const active = o.id === orchard?.id;
            return (
              <button
                key={o.id}
                onClick={() => void choose(o)}
                disabled={switching !== null}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition disabled:opacity-50",
                  active ? "bg-brand-500/12 text-brand-700" : "text-ink-dim hover:bg-surface-2 hover:text-ink",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                <span className="shrink-0 text-xs text-ink-faint">{o.code}</span>
                {active && <Check className="size-4 shrink-0 text-brand-600" />}
              </button>
            );
          })}
          {orchards?.length === 0 && (
            <p className="px-2 py-2 text-sm text-ink-faint">No other workspaces</p>
          )}
        </div>
      )}
    </div>
  );
}
