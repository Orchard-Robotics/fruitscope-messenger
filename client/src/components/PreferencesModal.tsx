import { Monitor, Moon, Palette, Sun, User as UserIcon, X } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { type Theme, usePrefs } from "@/store/prefs";
import { useChatStore } from "@/store/store";
import { Avatar } from "./Avatar";

type Section = "appearance" | "profile";

const NAV: ReadonlyArray<readonly [Section, typeof Palette, string]> = [
  ["appearance", Palette, "Appearance"],
  ["profile", UserIcon, "Profile"],
];

const THEMES: ReadonlyArray<readonly [Theme, typeof Sun, string]> = [
  ["light", Sun, "Light"],
  ["dark", Moon, "Dark"],
  ["system", Monitor, "System"],
];

/** Slack-style Preferences window: a left category nav + a content pane. */
export function PreferencesModal({
  open,
  onClose,
  onEditPhoto,
}: {
  open: boolean;
  onClose: () => void;
  onEditPhoto: () => void;
}) {
  const [section, setSection] = useState<Section>("appearance");

  useEffect(() => {
    if (!open) return;
    setSection("appearance");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="anim-fade-in fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="anim-card-in relative z-10 flex h-[34rem] max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-line bg-raised shadow-2xl shadow-ink/10">
        {/* Left category nav */}
        <nav className="w-48 shrink-0 border-r border-line bg-surface p-3">
          <p className="px-2 pb-2 font-display text-base font-bold text-ink">Preferences</p>
          {NAV.map(([key, Icon, label]) => (
            <button
              key={key}
              onClick={() => setSection(key)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition",
                section === key
                  ? "bg-brand-500/12 font-medium text-brand-700"
                  : "text-ink-dim hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="relative flex-1 overflow-y-auto p-6">
          <button
            onClick={onClose}
            className="absolute right-4 top-4 grid size-8 place-items-center rounded-lg text-ink-dim transition hover:bg-surface-2 hover:text-ink"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>

          {section === "appearance" && <Appearance />}
          {section === "profile" && <Profile onEditPhoto={onEditPhoto} />}
        </div>
      </div>
    </div>
  );
}

function Appearance() {
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const compact = usePrefs((s) => s.compact);
  const setCompact = usePrefs((s) => s.setCompact);
  const reduceMotion = usePrefs((s) => s.reduceMotion);
  const setReduceMotion = usePrefs((s) => s.setReduceMotion);
  const showCanaryDebug = usePrefs((s) => s.showCanaryDebug);
  const setShowCanaryDebug = usePrefs((s) => s.setShowCanaryDebug);
  // Admin-only: also gates the "Thought process" boxes on Canary's @mention
  // replies in channels (the same pref the Bug toggle in the Canary DM flips).
  const isSuperAdmin = useChatStore((s) => s.isSuperAdmin);

  return (
    <div className="max-w-md">
      <h3 className="font-display text-lg font-bold text-ink">Appearance</h3>

      <p className="mt-5 text-sm font-semibold text-ink">Theme</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {THEMES.map(([value, Icon, label]) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-xl border p-3 text-sm font-medium transition",
              theme === value
                ? "border-brand-400 bg-brand-500/10 text-brand-700"
                : "border-line text-ink-dim hover:bg-surface-2 hover:text-ink",
            )}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 divide-y divide-line border-y border-line">
        <SettingToggle
          label="Compact messages"
          hint="Tighter spacing between messages."
          checked={compact}
          onChange={setCompact}
        />
        <SettingToggle
          label="Reduce motion"
          hint="Turn off interface animations."
          checked={reduceMotion}
          onChange={setReduceMotion}
        />
        {isSuperAdmin && (
          <SettingToggle
            label="Show Canary thinking"
            hint="Reveal Canary's reasoning in its DM and on its channel replies (admins only)."
            checked={showCanaryDebug}
            onChange={setShowCanaryDebug}
          />
        )}
      </div>
    </div>
  );
}

function Profile({ onEditPhoto }: { onEditPhoto: () => void }) {
  const me = useChatStore((s) => s.me);
  if (!me) return null;
  return (
    <div className="max-w-md">
      <h3 className="font-display text-lg font-bold text-ink">Profile</h3>
      <div className="mt-5 flex items-center gap-4">
        <Avatar user={me} size={72} className="rounded-2xl" />
        <button
          onClick={onEditPhoto}
          className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink-dim transition hover:bg-surface-2 hover:text-ink"
        >
          Change photo
        </button>
      </div>
      <dl className="mt-6 space-y-3 text-sm">
        <Field label="Display name" value={me.displayName} />
        <Field label="Username" value={`@${me.username}`} />
      </dl>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

function SettingToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 py-3 text-left"
    >
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink-faint">{hint}</span>
      </span>
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
