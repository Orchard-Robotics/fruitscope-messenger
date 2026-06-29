import { Image, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef } from "react";

import type { User } from "@shared/index";
import { cn } from "@/lib/cn";
import { type Theme, usePrefs } from "@/store/prefs";
import { Avatar } from "./Avatar";

const THEMES: ReadonlyArray<readonly [Theme, typeof Sun, string]> = [
  ["light", Sun, "Light"],
  ["dark", Moon, "Dark"],
  ["system", Monitor, "System"],
];

/** Slack-style account/preferences menu, anchored above the sidebar footer. */
export function AppMenu({
  me,
  onClose,
  onEditProfile,
  onSignOut,
}: {
  me: User;
  onClose: () => void;
  onEditProfile: () => void;
  onSignOut: () => void;
}) {
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const compact = usePrefs((s) => s.compact);
  const setCompact = usePrefs((s) => s.setCompact);
  const reduceMotion = usePrefs((s) => s.reduceMotion);
  const setReduceMotion = usePrefs((s) => s.setReduceMotion);

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

  return (
    <div
      ref={ref}
      className="anim-pop-in absolute bottom-full left-2 right-2 z-40 mb-2 overflow-hidden rounded-xl border border-line bg-raised py-1.5 shadow-floating"
      style={{ transformOrigin: "bottom" }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <Avatar user={me} size={36} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{me.displayName}</p>
          <p className="truncate text-xs text-ink-faint">@{me.username}</p>
        </div>
      </div>

      <Divider />

      <MenuButton
        icon={Image}
        label="Edit profile picture"
        onClick={() => {
          onClose();
          onEditProfile();
        }}
      />

      <Divider />

      <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        Appearance
      </p>
      <div className="px-3 pb-1.5">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface p-1">
          {THEMES.map(([value, Icon, label]) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition",
                theme === value
                  ? "bg-raised text-ink shadow-sm"
                  : "text-ink-dim hover:text-ink",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <ToggleRow label="Compact messages" checked={compact} onChange={setCompact} />
      <ToggleRow label="Reduce motion" checked={reduceMotion} onChange={setReduceMotion} />

      <Divider />

      <MenuButton
        icon={LogOut}
        label="Sign out"
        danger
        onClick={() => {
          onClose();
          onSignOut();
        }}
      />
    </div>
  );
}

function Divider() {
  return <div className="my-1 h-px bg-line" />;
}

function MenuButton({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Sun;
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

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-ink-dim transition hover:bg-surface-2"
    >
      <span>{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-brand-500" : "bg-surface-2",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-all",
            checked ? "left-[1.125rem]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
