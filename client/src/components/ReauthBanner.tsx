import { LogIn } from "lucide-react";

import { useChatStore } from "@/store/store";

/**
 * Shown when a silent FruitScope re-auth failed and Canary is waiting to resume.
 * Signing in refreshes the token; the server then finishes the stalled reply.
 */
export function ReauthBanner() {
  const reauthNeeded = useChatStore((s) => s.reauthNeeded);
  if (!reauthNeeded) return null;

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-800">
      <span className="min-w-0 flex-1">
        Your FruitScope session expired. Sign in to continue — Canary will pick up where it left off.
      </span>
      <button
        onClick={() => {
          window.location.href = "/api/auth/login";
        }}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600"
      >
        <LogIn className="size-3.5" />
        Sign in to continue
      </button>
    </div>
  );
}
