import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import type { Orchard } from "@shared/index";
import { rest } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Logo } from "./Logo";

const SUGGESTIONS = ["willow", "fern", "sol", "robin", "moss", "dale"];

export function Login({
  onLogin,
}: {
  onLogin: (username: string, orchardId: string, displayName?: string) => Promise<void>;
}) {
  const [orchards, setOrchards] = useState<Orchard[]>([]);
  const [orchardId, setOrchardId] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const list = await rest.orchards();
        setOrchards(list);
        if (list[0]) setOrchardId(list[0].id);
      } catch {
        setError("Couldn't load orchards");
      }
    })();
  }, []);

  const submit = async (name: string, display?: string) => {
    const trimmed = name.trim();
    if (!trimmed || !orchardId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onLogin(trimmed, orchardId, display?.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setBusy(false);
    }
  };

  return (
    <div className="glow glow-breathe relative grid min-h-dvh place-items-center overflow-hidden px-6">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md rounded-3xl border border-line bg-white p-8 shadow-floating"
      >
        <div className="mb-7 flex items-center gap-3">
          <Logo className="size-12" />
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
              FruitScope Messenger
            </h1>
            <p className="text-sm text-ink-dim">Fast, real-time team chat.</p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(username, displayName);
          }}
          className="space-y-4"
        >
          <Field label="Orchard">
            <select
              value={orchardId}
              onChange={(e) => setOrchardId(e.target.value)}
              className="w-full appearance-none rounded-xl border border-line bg-surface px-4 py-3 text-ink focus:focus-ring"
            >
              {orchards.length === 0 && <option value="">Loading…</option>}
              {orchards.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.code})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Username">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. willow"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink placeholder:text-ink-faint focus:focus-ring"
            />
          </Field>

          <Field label="Display name" hint="optional">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Willow Vale"
              autoComplete="off"
              className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-ink placeholder:text-ink-faint focus:focus-ring"
            />
          </Field>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={busy || !username.trim() || !orchardId}
            className="group flex w-full items-center justify-center gap-2 rounded-full bg-brand-500 px-4 py-3 font-semibold text-white shadow-soft transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </button>
        </form>

        <div className="mt-7 border-t border-line pt-5">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-ink-faint">
            <Sparkles className="size-3.5" /> Jump in as a teammate
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((name) => (
              <button
                key={name}
                type="button"
                disabled={busy || !orchardId}
                onClick={() => {
                  setUsername(name);
                  void submit(name);
                }}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink-dim transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className={cn("mb-1.5 flex items-center gap-2 text-sm font-medium text-ink-dim")}>
        {label}
        {hint && <span className="text-xs text-ink-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
