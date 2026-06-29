import { Image, LogOut, Settings } from "lucide-react";
import { useEffect, useRef } from "react";

import type { User, UserStatus } from "@shared/index";
import { cn } from "@/lib/cn";
import { Avatar } from "./Avatar";

const STATUS: Record<UserStatus, { label: string; dot: string }> = {
  online: { label: "Active", dot: "bg-brand-500" },
  away: { label: "Away", dot: "bg-sun-500" },
  offline: { label: "Offline", dot: "bg-ink-faint" },
};

/** Top-right account dropdown (Slack-style): identity + status, then actions. */
export function AccountMenu({
  me,
  onClose,
  onOpenPrefs,
  onEditProfile,
  onSignOut,
}: {
  me: User;
  onClose: () => void;
  onOpenPrefs: () => void;
  onEditProfile: () => void;
  onSignOut: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const status = STATUS[me.status];

  return (
    <div
      ref={ref}
      className="anim-pop-in absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-raised py-1.5 shadow-floating"
      style={{ transformOrigin: "top right" }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Avatar user={me} size={40} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{me.displayName}</p>
          <p className="flex items-center gap-1.5 text-xs text-ink-dim">
            <span className={cn("size-1.5 rounded-full", status.dot)} />
            {status.label}
          </p>
        </div>
      </div>

      <div className="my-1 h-px bg-line" />

      <Item icon={Settings} label="Preferences" onClick={() => { onClose(); onOpenPrefs(); }} />
      <Item icon={Image} label="Edit profile picture" onClick={() => { onClose(); onEditProfile(); }} />

      <div className="my-1 h-px bg-line" />

      <Item icon={LogOut} label="Sign out" danger onClick={() => { onClose(); onSignOut(); }} />
    </div>
  );
}

function Item({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Settings;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition hover:bg-surface-2",
        danger ? "text-danger" : "text-ink-dim hover:text-ink",
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
