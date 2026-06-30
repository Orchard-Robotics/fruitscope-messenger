import { Eye, Loader2, LogOut } from "lucide-react";
import { useState } from "react";

import { stopMasquerade } from "@/lib/masquerade";
import { useChatStore } from "@/store/store";

/**
 * A prominent banner shown while an admin is masquerading as another user. The
 * rest of the app is rendered AS that user; this is the always-present way back.
 */
export function MasqueradeBanner() {
  const masquerade = useChatStore((s) => s.masquerade);
  const me = useChatStore((s) => s.me);
  const [exiting, setExiting] = useState(false);

  if (!masquerade) return null;

  return (
    <div className="z-40 flex shrink-0 items-center justify-center gap-3 bg-sun-500 px-3 py-1.5 text-xs font-semibold text-white">
      <Eye className="size-4 shrink-0" />
      <span className="truncate">
        Viewing as <span className="font-bold">{me?.displayName}</span>
        <span className="hidden opacity-90 sm:inline"> — you’re signed in as {masquerade.realName}</span>
      </span>
      <button
        onClick={() => {
          setExiting(true);
          void stopMasquerade();
        }}
        disabled={exiting}
        className="inline-flex items-center gap-1.5 rounded-md bg-white/20 px-2 py-0.5 font-bold transition hover:bg-white/30 disabled:opacity-70"
      >
        {exiting ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
        Exit
      </button>
    </div>
  );
}
