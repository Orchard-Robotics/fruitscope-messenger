import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

interface Persisted {
  theme: Theme;
  compact: boolean;
  reduceMotion: boolean;
  /** Admins-only: show Canary's debug context (prompt/context/token usage). */
  showCanaryDebug: boolean;
  /** Desktop notifications when you're @mentioned. */
  mentionNotifications: boolean;
}

interface PrefsState extends Persisted {
  setTheme: (theme: Theme) => void;
  setCompact: (compact: boolean) => void;
  setReduceMotion: (reduceMotion: boolean) => void;
  setShowCanaryDebug: (showCanaryDebug: boolean) => void;
  setMentionNotifications: (mentionNotifications: boolean) => void;
}

const KEY = "fruitscope.prefs";
// Default to light; users can switch to Dark or System in the menu.
// Admins see Canary debug context by default; they can toggle it off.
const DEFAULTS: Persisted = {
  theme: "light",
  compact: false,
  reduceMotion: false,
  showCanaryDebug: true,
  mentionNotifications: true,
};

function loadPrefs(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const systemDark = (): boolean =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;

/** Reflect preferences onto <html> via the class + data attributes the CSS keys off. */
export function applyPrefs(p: Pick<Persisted, "theme" | "compact" | "reduceMotion">): void {
  const root = document.documentElement;
  const dark = p.theme === "dark" || (p.theme === "system" && systemDark());
  root.classList.toggle("dark", dark);
  root.toggleAttribute("data-compact", p.compact);
  root.toggleAttribute("data-reduce-motion", p.reduceMotion);
}

function persist(p: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore (private mode etc.) */
  }
}

export const usePrefs = create<PrefsState>((set, get) => {
  const update = (partial: Partial<Persisted>): void => {
    set(partial);
    const { theme, compact, reduceMotion, showCanaryDebug, mentionNotifications } = get();
    const next: Persisted = { theme, compact, reduceMotion, showCanaryDebug, mentionNotifications };
    persist(next);
    applyPrefs(next);
  };
  return {
    ...loadPrefs(),
    setTheme: (theme) => update({ theme }),
    setCompact: (compact) => update({ compact }),
    setReduceMotion: (reduceMotion) => update({ reduceMotion }),
    setShowCanaryDebug: (showCanaryDebug) => update({ showCanaryDebug }),
    setMentionNotifications: (mentionNotifications) => update({ mentionNotifications }),
  };
});

/**
 * Apply stored prefs immediately (called before first paint to avoid a flash),
 * and keep "system" theme in sync with the OS.
 */
export function initPrefs(): void {
  applyPrefs(loadPrefs());
  if (typeof matchMedia !== "undefined") {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      const { theme, compact, reduceMotion } = usePrefs.getState();
      if (theme === "system") applyPrefs({ theme, compact, reduceMotion });
    });
  }
}
