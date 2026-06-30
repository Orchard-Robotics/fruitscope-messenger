import { ArrowLeft, Building2, Check, CloudDownload, Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import type { Orchard } from "@shared/index";
import { rest } from "@/lib/api";
import { SyncFromFruitscope } from "../SyncFromFruitscope";

const errText = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong.");

type View = "list" | "create" | "sync";

/** Workspaces: list every workspace, create a new one, or sync one from FruitScope. */
export function WorkspacesSection() {
  const [workspaces, setWorkspaces] = useState<Orchard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");

  const load = () => {
    rest
      .adminWorkspaces()
      .then(setWorkspaces)
      .catch((e) => setError(errText(e)));
  };
  useEffect(load, []);

  if (view === "sync") {
    return (
      <SectionFrame title="Sync from FruitScope" onBack={() => setView("list")}>
        <SyncFromFruitscope onSynced={load} />
      </SectionFrame>
    );
  }
  if (view === "create") {
    return (
      <SectionFrame title="New workspace" onBack={() => setView("list")}>
        <WorkspaceForm
          onCreated={() => {
            load();
            setView("list");
          }}
        />
      </SectionFrame>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line p-3">
        <p className="text-sm text-ink-dim">
          {workspaces ? `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}` : "Loading…"}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setView("create")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-dim transition hover:bg-brand-500/10 hover:text-brand-700"
          >
            <Plus className="size-3.5" /> New workspace
          </button>
          <button
            onClick={() => setView("sync")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-dim transition hover:bg-brand-500/10 hover:text-brand-700"
          >
            <CloudDownload className="size-3.5" /> Sync from FruitScope
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error && <p className="px-1 py-2 text-sm text-danger">{error}</p>}
        {!workspaces && !error && (
          <p className="flex items-center gap-2 px-1 py-3 text-sm text-ink-faint">
            <Loader2 className="size-4 animate-spin" /> Loading workspaces…
          </p>
        )}
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(workspaces ?? []).map((w) => (
            <li
              key={w.id}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface/50 px-3 py-2.5"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-600">
                <Building2 className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{w.name}</p>
                <p className="truncate font-mono text-xs text-ink-faint">{w.code}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SectionFrame({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line p-3">
        <button
          onClick={onBack}
          className="grid size-7 place-items-center rounded-lg text-ink-dim transition hover:bg-surface-2 hover:text-ink"
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </button>
        <p className="text-sm font-semibold text-ink">{title}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function WorkspaceForm({ onCreated }: { onCreated: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await rest.createWorkspace(code.trim().toUpperCase(), name.trim());
      setDone(true);
      setTimeout(onCreated, 500);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  const valid = code.trim().length > 0 && name.trim().length > 0;

  return (
    <div className="max-w-md space-y-4 p-5">
      <p className="text-sm text-ink-dim">
        The code is the workspace's short identifier; the name is what people see.
      </p>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-faint">Code</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. DEMO"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm uppercase text-ink outline-none focus:border-brand-400"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-ink-faint">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Demo Orchard"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-400"
        />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button
        onClick={() => void submit()}
        disabled={!valid || busy || done}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : done ? <Check className="size-4" /> : <Building2 className="size-4" />}
        Create workspace
      </button>
    </div>
  );
}
