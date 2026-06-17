import { motion } from "framer-motion";
import { ArrowRight, Leaf, Sparkles } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";

const SUGGESTIONS = ["willow", "fern", "sol", "robin", "moss"];

export function Login({
  onLogin,
}: {
  onLogin: (username: string, displayName?: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (name: string, display?: string) => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onLogin(trimmed, display?.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-6">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="glass relative z-10 w-full max-w-md rounded-3xl p-8 shadow-2xl shadow-black/40"
      >
        <div className="mb-7 flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-leaf-400 to-leaf-600 text-bark-950 shadow-lg shadow-leaf-600/30">
            <Leaf className="size-6" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Verdant</h1>
            <p className="text-sm text-ink-dim">A calmer place to talk.</p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(username, displayName);
          }}
          className="space-y-4"
        >
          <Field label="Username">
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. willow"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl border border-bark-600 bg-bark-900/70 px-4 py-3 text-ink placeholder:text-ink-faint focus:focus-ring"
            />
          </Field>

          <Field label="Display name" hint="optional">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Willow Vale"
              autoComplete="off"
              className="w-full rounded-xl border border-bark-600 bg-bark-900/70 px-4 py-3 text-ink placeholder:text-ink-faint focus:focus-ring"
            />
          </Field>

          {error && <p className="text-sm text-clay-400">{error}</p>}

          <button
            type="submit"
            disabled={busy || !username.trim()}
            className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-leaf-400 to-leaf-600 px-4 py-3 font-semibold text-bark-950 shadow-lg shadow-leaf-600/25 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Entering the grove…" : "Enter Verdant"}
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </button>
        </form>

        <div className="mt-7 border-t border-bark-700 pt-5">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-ink-faint">
            <Sparkles className="size-3.5" /> Hop in as a resident
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((name) => (
              <button
                key={name}
                type="button"
                disabled={busy}
                onClick={() => {
                  setUsername(name);
                  void submit(name);
                }}
                className="rounded-full border border-bark-600 bg-bark-800/60 px-3 py-1.5 text-sm text-sage-300 transition hover:border-leaf-500/50 hover:text-leaf-200 disabled:opacity-50"
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
