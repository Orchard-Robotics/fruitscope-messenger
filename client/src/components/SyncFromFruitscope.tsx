import {
  AlertTriangle,
  Building2,
  Check,
  ChevronDown,
  CloudDownload,
  Loader2,
  Search,
  UserPlus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { SyncedRole, SyncOrchardOption, SyncPreview, SyncReport } from "@shared/index";
import { rest } from "@/lib/api";
import { cn } from "@/lib/cn";

const errText = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong.");

const ROLE_LABEL: Record<SyncedRole, string> = {
  admin: "Admin",
  manager: "Manager",
  member: "Member",
  skipped: "No access",
};
const ROLE_STYLE: Record<SyncedRole, string> = {
  admin: "bg-brand-500/15 text-brand-700",
  manager: "bg-sky-500/15 text-sky-600",
  member: "bg-emerald-500/15 text-emerald-600",
  skipped: "bg-surface-2 text-ink-faint",
};

function RolePill({ role }: { role: SyncedRole }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", ROLE_STYLE[role])}>
      {ROLE_LABEL[role]}
    </span>
  );
}

/**
 * Admin "Sync from FruitScope": pick an orchard, preview its users, and sync —
 * creating the workspace + provisioning its people. Calls `onSynced` after a
 * successful run so the directory behind it can refresh.
 */
export function SyncFromFruitscope({ onSynced }: { onSynced: () => void }) {
  const [orchards, setOrchards] = useState<SyncOrchardOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SyncOrchardOption | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rest.syncOrchards().then(setOrchards).catch((e) => setLoadError(errText(e)));
  }, []);

  // Fetch a preview whenever the selected orchard changes.
  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    let live = true;
    setPreviewLoading(true);
    setPreview(null);
    setReport(null);
    setError(null);
    rest
      .syncOrchardUsers(selected.code)
      .then((p) => live && setPreview(p))
      .catch((e) => live && setError(errText(e)))
      .finally(() => live && setPreviewLoading(false));
    return () => {
      live = false;
    };
  }, [selected]);

  const provisionable = useMemo(
    () => preview?.users.filter((u) => u.role !== "skipped").length ?? 0,
    [preview],
  );

  const run = async () => {
    if (!selected) return;
    setSyncing(true);
    setError(null);
    try {
      const r = await rest.runSync(selected.code);
      setReport(r);
      onSynced();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSyncing(false);
    }
  };

  if (loadError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-amber-500/15 text-amber-600">
          <AlertTriangle className="size-6" />
        </span>
        <p className="max-w-sm text-sm text-ink-dim">{loadError}</p>
        <button
          onClick={() => {
            setLoadError(null);
            setOrchards(null);
            rest.syncOrchards().then(setOrchards).catch((e) => setLoadError(errText(e)));
          }}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink-dim transition hover:bg-surface-2"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Picker + action */}
      <div className="shrink-0 border-b border-line p-4">
        <p className="mb-2 text-xs text-ink-dim">
          Pick an orchard to create its workspace and provision everyone with access. Re-syncing is
          safe — it updates people and never removes anyone.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <OrchardCombobox
            orchards={orchards}
            selected={selected}
            onSelect={(o) => {
              setSelected(o);
              setReport(null);
            }}
          />
          <button
            onClick={() => void run()}
            disabled={!selected || syncing || previewLoading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {syncing ? <Loader2 className="size-4 animate-spin" /> : <CloudDownload className="size-4" />}
            {syncing ? "Syncing…" : "Sync orchard"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>

      {/* Body: report (after a sync) or preview (after a selection) */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {report ? (
          <ReportView report={report} />
        ) : previewLoading ? (
          <p className="flex items-center gap-2 px-1 py-4 text-sm text-ink-faint">
            <Loader2 className="size-4 animate-spin" /> Loading users…
          </p>
        ) : preview ? (
          <PreviewView preview={preview} provisionable={provisionable} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ink-faint">
            <Building2 className="size-8" />
            <p className="text-sm">Choose an orchard to see who will be synced.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Orchard combobox                                                    */
/* ------------------------------------------------------------------ */

function OrchardCombobox({
  orchards,
  selected,
  onSelect,
}: {
  orchards: SyncOrchardOption[] | null;
  selected: SyncOrchardOption | null;
  onSelect: (o: SyncOrchardOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const list = orchards ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    // Code matches rank first, then name matches.
    const score = (o: SyncOrchardOption) =>
      o.code.toLowerCase().startsWith(q) ? 0 : o.code.toLowerCase().includes(q) ? 1 : 2;
    return list
      .filter(
        (o) => o.code.toLowerCase().includes(q) || (o.name ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) => score(a) - score(b) || a.code.localeCompare(b.code));
  }, [orchards, query]);

  return (
    <div ref={ref} className="relative min-w-[18rem] flex-1">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!orchards}
        className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm transition hover:bg-surface-2 disabled:opacity-50"
      >
        <Building2 className="size-4 shrink-0 text-ink-faint" />
        {selected ? (
          <span className="min-w-0 flex-1 truncate text-ink">
            <span className="font-mono font-semibold">{selected.code}</span>
            {selected.name ? <span className="text-ink-dim"> — {selected.name}</span> : null}
          </span>
        ) : (
          <span className="flex-1 text-ink-faint">
            {orchards ? "Select an orchard…" : "Loading orchards…"}
          </span>
        )}
        <ChevronDown className={cn("size-4 shrink-0 text-ink-faint transition", open && "rotate-180")} />
      </button>

      {open && orchards && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line bg-raised shadow-xl shadow-ink/10">
          <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
            <Search className="size-4 shrink-0 text-ink-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by code or name…"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto p-1">
            {filtered.map((o) => (
              <li key={o.code}>
                <button
                  onClick={() => {
                    onSelect(o);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-surface-2"
                >
                  <span className="font-mono text-sm font-semibold text-ink">{o.code}</span>
                  {o.name && <span className="min-w-0 flex-1 truncate text-ink-dim">{o.name}</span>}
                  {!o.name && <span className="flex-1" />}
                  {o.accountTier && (
                    <span className="rounded bg-surface-2 px-1 text-[10px] font-medium uppercase text-ink-faint">
                      {o.accountTier}
                    </span>
                  )}
                  {o.existing && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1 text-[10px] font-semibold text-emerald-600">
                      <Check className="size-2.5" /> Synced
                    </span>
                  )}
                  {selected?.code === o.code && <Check className="size-4 text-brand-600" />}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-2.5 py-3 text-center text-xs text-ink-faint">No orchards match.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preview + report                                                    */
/* ------------------------------------------------------------------ */

function PreviewView({ preview, provisionable }: { preview: SyncPreview; provisionable: number }) {
  return (
    <>
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          {preview.orchardName ?? preview.orchardCode}
        </p>
        <p className="text-xs text-ink-dim">
          {provisionable} of {preview.users.length} will be synced
        </p>
      </div>
      <ul className="space-y-1">
        {preview.users.map((u) => (
          <li
            key={u.userId}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-line bg-surface/50 px-3 py-2",
              u.role === "skipped" && "opacity-50",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">
                {u.name ?? u.email ?? `FruitScope user ${u.userId}`}
              </p>
              {u.email && <p className="truncate text-xs text-ink-faint">{u.email}</p>}
            </div>
            <span className="text-[10px] font-medium text-ink-faint">{u.permissionLevel}</span>
            <RolePill role={u.role} />
            <span
              className={cn(
                "w-14 text-right text-[10px] font-semibold uppercase tracking-wide",
                u.role === "skipped" ? "text-ink-faint" : u.existing ? "text-sky-600" : "text-emerald-600",
              )}
            >
              {u.role === "skipped" ? "—" : u.existing ? "Update" : "New"}
            </span>
          </li>
        ))}
        {preview.users.length === 0 && (
          <li className="px-1 py-4 text-sm text-ink-faint">No users found for this orchard.</li>
        )}
      </ul>
    </>
  );
}

function ReportView({ report }: { report: SyncReport }) {
  return (
    <>
      <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-emerald-500/20 text-emerald-600">
          <UserPlus className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            Synced {report.orchardName ?? report.orchardCode}
            {report.workspaceCreated && " (new workspace)"}
          </p>
          <p className="text-xs text-ink-dim">
            <span className="font-semibold text-emerald-600">{report.created} created</span> ·{" "}
            <span className="font-semibold text-sky-600">{report.updated} updated</span> ·{" "}
            <span className="text-ink-faint">{report.skipped} skipped</span> · {report.members} members
            · {report.total} total
          </p>
        </div>
      </div>
      <ul className="space-y-1">
        {report.users.map((u) => (
          <li
            key={u.userId}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-line bg-surface/50 px-3 py-2",
              u.action === "skipped" && "opacity-50",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">
                {u.name ?? u.email ?? `FruitScope user ${u.userId}`}
              </p>
              {u.email && <p className="truncate text-xs text-ink-faint">{u.email}</p>}
            </div>
            <RolePill role={u.role} />
            <span
              className={cn(
                "w-16 text-right text-[10px] font-semibold uppercase tracking-wide",
                u.action === "created"
                  ? "text-emerald-600"
                  : u.action === "updated"
                    ? "text-sky-600"
                    : "text-ink-faint",
              )}
            >
              {u.action}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
