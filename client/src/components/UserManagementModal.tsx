import { Eye, Loader2, Search, ShieldCheck, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { AdminUser } from "@shared/index";
import { rest } from "@/lib/api";
import { cn } from "@/lib/cn";
import { startMasquerade } from "@/lib/masquerade";
import { useChatStore } from "@/store/store";
import { Avatar } from "./Avatar";
import { PresenceDot } from "./PresenceDot";

type Filter = "all" | "admins";

/** Admin-only User Management: browse everyone and masquerade ("view as"). */
export function UserManagementModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const meId = useChatStore((s) => s.me?.id);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsers(null);
    setError(null);
    setQuery("");
    setFilter("all");
    rest
      .adminUsers()
      .then(setUsers)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load users."));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const list = users ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((u) => {
      if (filter === "admins" && !u.isSuperAdmin) return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        u.orchards.some((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q))
      );
    });
  }, [users, query, filter]);

  if (!open) return null;

  const adminCount = (users ?? []).filter((u) => u.isSuperAdmin).length;

  const viewAs = async (id: string) => {
    setPending(id);
    try {
      await startMasquerade(id); // reloads on success
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't masquerade.");
      setPending(null);
    }
  };

  return createPortal(
    <div className="anim-fade-in fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="anim-card-in relative z-10 flex h-[40rem] max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl shadow-ink/10">
        {/* Header */}
        <div className="shrink-0 border-b border-line p-4">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-brand-500/10 text-brand-600">
              <Users className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-base font-bold text-ink">User management</h2>
              <p className="text-xs text-ink-dim">
                {users ? `${users.length} ${users.length === 1 ? "user" : "users"} · ${adminCount} admin${adminCount === 1 ? "" : "s"}` : "Loading…"}
              </p>
            </div>
            <button
              onClick={onClose}
              className="grid size-8 place-items-center rounded-lg text-ink-dim transition hover:bg-surface-2 hover:text-ink"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5">
              <Search className="size-4 shrink-0 text-ink-faint" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, @username, email, orchard…"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
            <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
              {(["all", "admins"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition",
                    filter === f ? "bg-raised text-brand-700 shadow-sm" : "text-ink-dim hover:text-ink",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
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
        disabled={isSelf || disabled}
        title={isSelf ? "You can't masquerade as yourself" : `View as ${user.displayName}`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-dim transition hover:bg-brand-500/10 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
        View as
      </button>
    </li>
  );
}
