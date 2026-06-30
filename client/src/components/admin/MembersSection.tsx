import { Building2, Eye, Layers, Loader2, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AdminUser } from "@shared/index";
import { rest } from "@/lib/api";
import { cn } from "@/lib/cn";
import { startMasquerade } from "@/lib/masquerade";
import { useChatStore } from "@/store/store";
import { Avatar } from "../Avatar";
import { PresenceDot } from "../PresenceDot";

interface Workspace {
  code: string;
  name: string;
  count: number;
}

/** Browse every workspace + user, search across both, and "view as" (masquerade)
 *  any non-admin user. */
export function MembersSection() {
  const meId = useChatStore((s) => s.me?.id);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    rest
      .adminUsers()
      .then(setUsers)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load users."));
  }, []);

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
    () =>
      !q
        ? workspaces
        : workspaces.filter((w) => w.name.toLowerCase().includes(q) || w.code.toLowerCase().includes(q)),
    [workspaces, q],
  );

  const filtered = useMemo(() => {
    return (users ?? []).filter((u) => {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line p-3">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5">
          <Search className="size-4 shrink-0 text-ink-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workspaces and users — name, @username, email, orchard…"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
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
    </div>
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
          {user.isBot && (
            <span className="rounded bg-sky-500/15 px-1 text-[10px] font-bold uppercase tracking-wide text-sky-600">
              Bot
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
