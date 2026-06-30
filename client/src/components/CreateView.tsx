import { Bot, Building2, Check, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ModelCatalog, Orchard } from "@shared/index";
import { rest } from "@/lib/api";
import { cn } from "@/lib/cn";

const errText = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong.");

type Tab = "bot" | "workspace";

/** Admin "Create" view: a workspace (orchard) or an LLM bot. Calls `onCreated`
 *  after a successful create so the directory behind it refreshes. */
export function CreateView({ onCreated }: { onCreated: () => void }) {
  const [tab, setTab] = useState<Tab>("bot");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-line p-2">
        <TabButton active={tab === "bot"} onClick={() => setTab("bot")} icon={<Bot className="size-4" />}>
          Bot
        </TabButton>
        <TabButton
          active={tab === "workspace"}
          onClick={() => setTab("workspace")}
          icon={<Building2 className="size-4" />}
        >
          Workspace
        </TabButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tab === "bot" ? <BotForm onCreated={onCreated} /> : <WorkspaceForm onCreated={onCreated} />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
        active ? "bg-brand-500/12 text-brand-700" : "text-ink-dim hover:bg-surface-2 hover:text-ink",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

function WorkspaceForm({ onCreated }: { onCreated: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Orchard | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const ws = await rest.createWorkspace(code.trim().toUpperCase(), name.trim());
      setCreated(ws);
      setCode("");
      setName("");
      onCreated();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const valid = code.trim().length > 0 && name.trim().length > 0;

  return (
    <div className="max-w-md space-y-4">
      <p className="text-sm text-ink-dim">
        Create a new workspace. The code is its short identifier; the name is what people see.
      </p>
      <Field label="Code">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. DEMO"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm uppercase text-ink outline-none focus:border-brand-400"
        />
      </Field>
      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Demo Orchard"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-400"
        />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      {created && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
          <Check className="size-4" /> Created workspace {created.name} ({created.code}).
        </p>
      )}
      <button
        onClick={() => void submit()}
        disabled={!valid || busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
        Create workspace
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bot                                                                 */
/* ------------------------------------------------------------------ */

function BotForm({ onCreated }: { onCreated: () => void }) {
  const [workspaces, setWorkspaces] = useState<Orchard[] | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [orchardId, setOrchardId] = useState("");
  const [model, setModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([rest.adminWorkspaces(), rest.llmModels()])
      .then(([ws, cat]) => {
        setWorkspaces(ws);
        setCatalog(cat);
        if (ws[0]) setOrchardId(ws[0].id);
        setModel(cat.defaultModelId);
      })
      .catch((e) => setLoadError(errText(e)));
  }, []);

  const valid = name.trim().length > 0 && orchardId !== "" && model !== "";

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const bot = await rest.createBot({
        displayName: name.trim(),
        orchardId,
        model,
        systemPrompt: systemPrompt.trim(),
      });
      setCreatedName(bot.displayName);
      setName("");
      setSystemPrompt("");
      onCreated();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const wsName = useMemo(
    () => workspaces?.find((w) => w.id === orchardId)?.name,
    [workspaces, orchardId],
  );

  if (loadError) {
    return <p className="text-sm text-danger">{loadError}</p>;
  }
  if (!workspaces || !catalog) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-faint">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </p>
    );
  }
  if (workspaces.length === 0) {
    return (
      <p className="max-w-md text-sm text-ink-dim">
        No workspaces yet — create one on the Workspace tab first, then add a bot to it.
      </p>
    );
  }

  return (
    <div className="max-w-md space-y-4">
      <p className="text-sm text-ink-dim">
        Create a bot that replies when @mentioned in its workspace (and to every message in a 1:1 DM
        with it), running under the model and system prompt you choose.
      </p>
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
            <optgroup
              key={group.provider}
              label={group.authed ? group.label : `${group.label} (no key)`}
            >
              {group.models.map((m) => (
                <option key={m.id} value={m.id} disabled={!group.authed}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label="System prompt" hint="Optional — defines the bot's persona and instructions.">
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          placeholder="You are a helpful assistant for orchard operators. Be concise and practical."
          className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-400"
        />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      {createdName && (
        <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
          <Check className="size-4" /> Created {createdName}
          {wsName ? ` in ${wsName}` : ""}.
        </p>
      )}
      <button
        onClick={() => void submit()}
        disabled={!valid || busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
        Create bot
      </button>
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
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}
