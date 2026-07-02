import { Bell, BellOff, BellRing } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/cn";
import { ensureNotificationPermission } from "@/lib/notifications";
import { usePrefs } from "@/store/prefs";

type Perm = NotificationPermission | "unsupported";

const readPerm = (): Perm =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

/**
 * A bell in the top bar that makes desktop mention-notifications discoverable and
 * fixable: it shows whether they're on, prompts for permission on click (a real
 * user gesture — the reliable way to get the browser prompt), and surfaces the
 * "blocked in browser settings" state that an automatic request can't recover.
 */
export function NotificationBell() {
  const wanted = usePrefs((s) => s.mentionNotifications);
  const setWanted = usePrefs((s) => s.setMentionNotifications);
  const [perm, setPerm] = useState<Perm>(readPerm);

  // Keep in sync if the user changes it in the browser's site settings.
  useEffect(() => {
    const sync = () => setPerm(readPerm());
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  if (perm === "unsupported") return null;

  const on = perm === "granted" && wanted;
  const blocked = perm === "denied";

  const onClick = async () => {
    if (blocked) return; // can't re-prompt; the tooltip tells them to fix it in the browser
    if (perm !== "granted") {
      const granted = await ensureNotificationPermission();
      setPerm(readPerm());
      setWanted(granted);
      return;
    }
    setWanted(!wanted); // granted already — just toggle the preference
  };

  const title = blocked
    ? "Notifications are blocked — enable them for this site in your browser settings"
    : on
      ? "Mention notifications on — click to mute"
      : "Turn on desktop notifications for @mentions";

  const Icon = blocked ? BellOff : on ? BellRing : Bell;

  return (
    <button
      onClick={() => void onClick()}
      title={title}
      aria-label={title}
      className={cn(
        "relative grid size-9 place-items-center rounded-lg transition hover:bg-surface-2",
        blocked ? "text-danger" : on ? "text-brand-600" : "text-ink-faint hover:text-ink",
      )}
    >
      <Icon className="size-[18px]" />
      {/* Nudge dot when notifications aren't on yet (and aren't blocked). */}
      {!on && !blocked && (
        <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand-500 ring-2 ring-raised" />
      )}
    </button>
  );
}
