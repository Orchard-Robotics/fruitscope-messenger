import {
  ArrowLeft,
  Building2,
  CloudDownload,
  Eye,
  Layers,
  Loader2,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { AdminUser } from "@shared/index";
import { rest } from "@/lib/api";
import { cn } from "@/lib/cn";
import { startMasquerade } from "@/lib/masquerade";
import { useChatStore } from "@/store/store";
import { Avatar } from "./Avatar";
import { PresenceDot } from "./PresenceDot";
import { SyncFromFruitscope } from "./SyncFromFruitscope";

interface Workspace {
  code: string;
  name: string;
  count: number;
}

/** Admin-only User Management: browse every workspace + user, search across both,
 *  and masquerade ("view as") any non-admin user. */
export function UserManagementModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meId = useChatStore((s) => s.me?.id);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [workspace, setWorkspace] = useState<string | null>(null); // orchard code, or null = all
  const [pending, setPending] = useState<string | null>(null);
  const [view, setView] = useState<"directory" | "sync">("directory");

  const refreshUsers = () => {
    void rest
      .adminUsers()
      .then(setUsers)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load users."));
  };

  useEffect(() => {
    if (!open) return;
    setUsers(null);
    setError(null);
    setQuery("");
    setWorkspace(null);
    setView("directory");
    refreshUsers();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  // Workspaces are derived from everyone's memberships (every orchard has members).
  const workspaces = useMemo<Workspace[]>(() => {
    const map = new Map<string, Workspace>();
    for (const u of users ?? []) {
      for (const o of u.orchards) {
        const w = map.get(o.code) ?? { code: o.code, name: o.name, count: 0 };
        w.count += 1;
        map.set(o.code, w);
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  const q = query.trim().toLowerCase();
  const wsMatches = useMemo(
    () => (!q ? workspaces : workspaces.filter((w) => w.name.toLowerCase().includes(q) || w.code.toLowerCase().includes(q))),
    [workspaces, q],
  );

  const filtered = useMemo(() => {
    const list = users ?? [];
    return list.filter((u) => {
      if (workspace && !u.orchards.some((o) => o.code === workspace)) return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        u.orchards.some((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q))
      );
    });
  }, [users, q, workspace]);

  if (!open) return null;

  const viewAs = async (id: string) => {
    setPending(id);
    try {
      await startMasquerade(id); // reloads on success
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't masquerade.");
      setPending(null);
    }
  };

  const activeWs = workspace ? workspaces.find((w) => w.code === workspace) : null;

  return createPortal(
    <div className="anim-fade-in fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="anim-card-in relative z-10 flex h-[42rem] max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl shadow-ink/10">
        {/* Header (+ search in directory view) */}
        <div className="shrink-0 border-b border-line p-4">
          <div className="flex items-center gap-2">
            {view === "sync" ? (
              <button
                onClick={() => setView("directory")}
                className="grid size-8 place-items-center rounded-lg text-ink-dim transition hover:bg-surface-2 hover:text-ink"
                aria-label="Back to directory"
              >
                <ArrowLeft className="size-4" />
              </button>
            ) : (
              <span className="grid size-8 place-items-center rounded-lg bg-brand-500/10 text-brand-600">
                <Users className="size-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-bold text-ink">
                {view === "sync" ? "Sync from FruitScope" : "User management"}
              </h2>
              <p className="text-xs text-ink-dim">
                {view === "sync"
                  ? "Create a workspace and provision its users."
                  : users
                    ? `${users.length} ${users.length === 1 ? "user" : "users"} across ${workspaces.length} ${workspaces.length === 1 ? "workspace" : "workspaces"}`
                    : "Loading…"}
              </p>
            </div>
            {view === "directory" && (
              <button
                onClick={() => setView("sync")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-dim transition hover:bg-brand-500/10 hover:text-brand-700"
              >
                <CloudDownload className="size-3.5" />
                Sync from FruitScope
              </button>
            )}
            <button
              onClick={onClose}
              className="grid size-8 place-items-center rounded-lg text-ink-dim transition hover:bg-surface-2 hover:text-ink"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
          {view === "directory" && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5">
              <Search className="size-4 shrink-0 text-ink-faint" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search across workspaces and users — name, @username, email, orchard…"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
          )}
        </div>

        {/* Body: directory (two panes) or the FruitScope sync view */}
        {view === "sync" ? (
          <SyncFromFruitscope onSynced={refreshUsers} />
        ) : (
        <div className="flex min-h-0 flex-1">
          {/* Workspaces */}
          <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface/60 p-2 sm:flex">
            <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Workspaces
            </p>
            <button
              onClick={() => setWorkspace(null)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                workspace === null ? "bg-brand-500/12 text-brand-700" : "text-ink hover:bg-surface-2",
              )}
            >
              <Layers className="size-4 shrink-0 text-ink-faint" />
              <span className="flex-1 font-medium">All workspaces</span>
              <span className="text-xs text-ink-faint">{users?.length ?? 0}</span>
            </button>
            {wsMatches.map((w) => (
              <button
                key={w.code}
                onClick={() => setWorkspace(w.code)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                  workspace === w.code ? "bg-brand-500/12" : "hover:bg-surface-2",
                )}
              >
                <Building2 className="size-4 shrink-0 text-ink-faint" />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    workspace === w.code ? "font-medium text-brand-700" : "text-ink",
                  )}
                  title={w.code}
                >
                  {w.name}
                </span>
                <span className="text-xs text-ink-faint">{w.count}</span>
              </button>
            ))}
            {q && wsMatches.length === 0 && (
              <p className="px-2.5 py-1 text-xs text-ink-faint">No matching workspaces.</p>
            )}
          </aside>

          {/* Users */}
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {activeWs && (
              <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                {activeWs.name}
              </p>
            )}
            {!users && !error && (
              <p className="flex items-center gap-2 px-3 py-4 text-sm text-ink-faint">
                <Loader2 className="size-4 animate-spin" /> Loading users…
              </p>
            )}
            {error && <p className="px-3 py-4 text-sm text-danger">{error}</p>}
            {users && filtered.length === 0 && (
              <p className="px-3 py-4 text-sm text-ink-faint">No users match your search.</p>
            )}
            <ul className="space-y-1">
              {filtered.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  isSelf={u.id === meId}
                  pending={pending === u.id}
                  disabled={pending !== null}
                  onViewAs={() => void viewAs(u.id)}
                />
              ))}
            </ul>
          </div>
        </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function UserRow({
  user,
  isSelf,
  pending,
  disabled,
  onViewAs,
}: {
  user: AdminUser;
  isSelf: boolean;
  pending: boolean;
  disabled: boolean;
  onViewAs: () => void;
}) {
  // You can masquerade as anyone except yourself, bots, and other admins.
  const blocked = isSelf || user.isSuperAdmin || user.isBot;
  const reason = isSelf
    ? "You can't masquerade as yourself"
    : user.isSuperAdmin
      ? "You can't masquerade as another admin"
      : `View as ${user.displayName}`;

  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-surface/50 px-3 py-2.5">
      <span className="relative shrink-0">
        <Avatar user={user} size={36} />
        <PresenceDot status={user.status} className="absolute -bottom-0.5 -right-0.5" ring="ring-surface" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-ink">{user.displayName}</span>
          {user.isSuperAdmin && (
            <span className="inline-flex items-center gap-0.5 rounded bg-brand-500/15 px-1 text-[10px] font-bold uppercase tracking-wide text-brand-700">
              <ShieldCheck className="size-3" /> Admin
            </span>
          )}
          {isSelf && (
            <span className="rounded bg-surface-2 px-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              you
            </span>
          )}
        </div>
        <p className="truncate text-xs text-ink-faint">
          @{user.username}
          {user.email ? ` · ${user.email}` : ""}
        </p>
        {user.orchards.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {user.orchards.slice(0, 4).map((o) => (
              <span
                key={o.code}
                className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-dim"
                title={`${o.name} · ${o.role}`}
              >
                {o.name}
                {o.role !== "member" ? ` (${o.role})` : ""}
              </span>
            ))}
            {user.orchards.length > 4 && (
              <span className="text-[10px] text-ink-faint">+{user.orchards.length - 4}</span>
            )}
          </div>
        )}
      </div>

      <button
        onClick={onViewAs}
        disabled={blocked || disabled}
        title={reason}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-dim transition hover:bg-brand-500/10 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
        View as
      </button>
    </li>
  );
}
