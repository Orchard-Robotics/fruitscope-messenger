import { Brain, ChevronRight } from "lucide-react";

import { usePrefs } from "@/store/prefs";
import { Markdown } from "./Markdown";

/**
 * Canary's admin-only "thinking" for an in-channel @mention reply, shown as a
 * collapsible box. The server only sends `canaryReasoning` to admins, so the
 * mere presence of text here means the viewer is an admin; the debug toggle
 * (shared with the Canary DM) hides it when an admin doesn't want it. Default
 * collapsed — expand to read.
 */
export function CanaryReasoning({ reasoning }: { reasoning: string | null | undefined }) {
  const showDebug = usePrefs((s) => s.showCanaryDebug);
  if (!reasoning?.trim() || !showDebug) return null;

  return (
    <details className="group mt-1 rounded-lg border border-line bg-surface/60 [&[open]>summary_svg.chev]:rotate-90">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-ink-faint">
        <ChevronRight className="chev size-3.5 transition-transform" />
        <Brain className="size-3.5" />
        Thought process
      </summary>
      <div className="px-3 pb-2.5 text-xs leading-relaxed text-ink-dim [&_strong]:text-ink-dim">
        <Markdown>{reasoning}</Markdown>
      </div>
    </details>
  );
}
