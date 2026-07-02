import { Bot, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AdminBot, ModelCatalog, Orchard } from "@shared/index";
import { rest } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useChatStore } from "@/store/store";
import { Avatar } from "../Avatar";

const errText = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong.");

/** Manage LLM bots: list every bot, edit its name / workspace / model / system
 *  prompt, delete it, or create a new one. */
export function BotsSection() {
  const [bots, setBots] = useState<AdminBot[] | null>(null);
  const [workspaces, setWorkspaces] = useState<Orchard[] | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The selected bot id, or "new" for the create form, or null for none.
  const [selected, setSelected] = useState<string | "new" | null>(null);

  const load = () => {
    Promise.all([rest.adminBots(), rest.adminWorkspaces(), rest.llmModels()])
      .then(([b, w, c]) => {
        setBots(b);
        setWorkspaces(w);
        setCatalog(c);
      })
      .catch((e) => setLoadError(errText(e)));
  };
  useEffect(load, []);

  const selectedBot = useMemo(
    () => (selected && selected !== "new" ? bots?.find((b) => b.id === selected) ?? null : null),
    [bots, selected],
  );

  if (loadError) return <p className="p-5 text-sm text-danger">{loadError}</p>;
  if (!bots || !workspaces || !catalog) {
    return (
      <p className="flex items-center gap-2 p-5 text-sm text-ink-faint">
        <Loader2 className="size-4 animate-spin" /> Loading bots…
      </p>
    );
  }

  const refreshAndSelect = (id: string | null) => {
    Promise.all([rest.adminBots()]).then(([b]) => {
      setBots(b);
      setSelected(id);
    });
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* List */}
      <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface/60">
        <button
          onClick={() => setSelected("new")}
          className={cn(
            "m-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-2 text-sm font-semibold transition",
            selected === "new"
              ? "border-brand-400 bg-brand-500/10 text-brand-700"
              : "text-ink-dim hover:bg-surface-2 hover:text-ink",
          )}
        >
          <Plus className="size-4" /> New bot
        </button>
        {bots.length === 0 && (
          <p className="px-4 py-3 text-xs text-ink-faint">No bots yet. Create one to get started.</p>
        )}
        <ul className="px-2 pb-2">
          {bots.map((b) => (
            <li key={b.id}>
              <button
                onClick={() => setSelected(b.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition",
                  selected === b.id ? "bg-brand-500/12" : "hover:bg-surface-2",
                )}
              >
                <Avatar user={b} size={32} className="rounded-lg" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{b.displayName}</span>
                  <span className="block truncate text-[11px] text-ink-faint">
                    {b.modelLabel} · {b.orchard?.code ?? "—"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Editor */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected === "new" ? (
          <BotEditor
            key="new"
            workspaces={workspaces}
            catalog={catalog}
            onSaved={(id) => refreshAndSelect(id)}
          />
        ) : selectedBot ? (
          <BotEditor
            key={selectedBot.id}
            bot={selectedBot}
            workspaces={workspaces}
            catalog={catalog}
            onSaved={(id) => refreshAndSelect(id)}
            onDeleted={() => refreshAndSelect(null)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ink-faint">
            <Bot className="size-8" />
            <p className="text-sm">Select a bot to edit, or create a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function BotEditor({
  bot,
  workspaces,
  catalog,
  onSaved,
  onDeleted,
}: {
  bot?: AdminBot;
  workspaces: Orchard[];
  catalog: ModelCatalog;
  onSaved: (id: string) => void;
  onDeleted?: () => void;
}) {
  const isNew = !bot;
  // Default a new bot to the workspace you're currently in (matches intent), not
  // just the first workspace in the list.
  const currentOrchardId = useChatStore((s) => s.orchard?.id);
  const [name, setName] = useState(bot?.displayName ?? "");
  const [orchardId, setOrchardId] = useState(
    bot?.orchard?.id ?? currentOrchardId ?? workspaces[0]?.id ?? "",
  );
  const [model, setModel] = useState(bot?.model || catalog.defaultModelId);
  const [systemPrompt, setSystemPrompt] = useState(bot?.systemPrompt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const valid = name.trim().length > 0 && orchardId !== "" && model !== "";

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      if (isNew) {
        const created = await rest.createBot({
          displayName: name.trim(),
          orchardId,
          model,
          systemPrompt: systemPrompt.trim(),
        });
        // Show it instantly in the sidebar when it belongs to the workspace we're
        // viewing — independent of the socket broadcast (which covers everyone else).
        if (orchardId === useChatStore.getState().orchard?.id) {
          useChatStore.getState().upsertUser(created);
        }
        onSaved(created.id);
      } else {
        const updated = await rest.updateBot(bot.id, {
          displayName: name.trim(),
          orchardId,
          model,
          systemPrompt: systemPrompt.trim(),
        });
        setSaved(true);
        onSaved(updated.id);
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!bot) return;
    setBusy(true);
    setError(null);
    try {
      await rest.deleteBot(bot.id);
      onDeleted?.();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl space-y-4 p-5">
      <div className="flex items-center gap-3">
        {bot ? (
          <Avatar user={bot} size={40} className="rounded-xl" />
        ) : (
          <span className="grid size-10 place-items-center rounded-xl bg-brand-500/10 text-brand-600">
            <Bot className="size-5" />
          </span>
        )}
        <h3 className="font-display text-lg font-bold text-ink">
          {isNew ? "New bot" : bot.displayName}
        </h3>
      </div>

      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Orchard Helper"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-400"
        />
      </Field>

      <Field label="Workspace">
        <select
          value={orchardId}
          onChange={(e) => setOrchardId(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-400"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.code})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Model">
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-400"
        >
          {catalog.catalog.map((group) => (
            <optgroup key={group.provider} label={group.authed ? group.label : `${group.label} (no key)`}>
              {group.models.map((m) => (
                <option key={m.id} value={m.id} disabled={!group.authed}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>

      <Field label="System prompt" hint="Defines the bot's persona and instructions.">
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={8}
          placeholder="You are a helpful assistant for orchard operators. Be concise and practical."
          className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-400"
        />
      </Field>

      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && <p className="text-sm font-medium text-emerald-600">Saved.</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={() => void save()}
          disabled={!valid || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
          {isNew ? "Create bot" : "Save changes"}
        </button>

        {!isNew &&
          (confirmDelete ? (
            <span className="inline-flex items-center gap-2 text-sm">
              <span className="text-ink-dim">Delete bot + its messages?</span>
              <button
                onClick={() => void remove()}
                disabled={busy}
                className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-dim transition hover:bg-surface-2"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-danger transition hover:bg-danger/10 disabled:opacity-50"
            >
              <Trash2 className="size-4" /> Delete
            </button>
          ))}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}
