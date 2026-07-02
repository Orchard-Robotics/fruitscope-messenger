import { ChevronRight, Wrench } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import type { AgentToolCall } from "@shared/index";
import type { SqlQueryResult } from "@/lib/api";
import { cn } from "@/lib/cn";

// Same rich tool UIs CanaryCode uses in its DM — loaded lazily.
const SqlToolCard = lazy(() => import("./SqlToolCard").then((m) => ({ default: m.SqlToolCard })));
const LogToolCard = lazy(() => import("./LogToolCard").then((m) => ({ default: m.LogToolCard })));

/**
 * Render CanaryCode's captured tool calls as the same rich cards its DM shows —
 * the SQL editor, the log viewer, and a generic card for the rest — so its full
 * tooling is usable wherever CanaryCode posts, not just its DM.
 */
export function AgentToolCards({ calls }: { calls: AgentToolCall[] }) {
  if (!calls.length) return null;
  return (
    <div className="mt-1.5 space-y-2">
      {calls.map((c, i) => (
        <AgentToolCard key={i} call={c} />
      ))}
    </div>
  );
}

function AgentToolCard({ call }: { call: AgentToolCall }) {
  const fallback = <div className="px-1 text-xs text-ink-faint">Loading…</div>;
  if (call.name === "db_query_readonly") {
    return (
      <Suspense fallback={fallback}>
        <SqlToolCard
          input={call.input as { sql?: string; database?: string; limit?: number } | undefined}
          output={call.output as SqlQueryResult | undefined}
          state="output-available"
        />
      </Suspense>
    );
  }
  if (call.name === "logs_recent") {
    return (
      <Suspense fallback={fallback}>
        <LogToolCard
          input={call.input as { service?: string; env?: string; severity?: string; hours?: number } | undefined}
          output={call.output as never}
          state="output-available"
        />
      </Suspense>
    );
  }
  return <GenericToolCard call={call} />;
}

/** Compact collapsible for the non-editor tools (GitHub, Linear, errors). */
function GenericToolCard({ call }: { call: AgentToolCall }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-ink-dim transition hover:bg-surface-2"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <Wrench className="size-3.5 shrink-0 text-brand-600" />
        <span className="font-mono font-semibold">{call.name}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2">
          {call.input != null && <LabeledJson label="Input" value={call.input} />}
          {call.output != null && <LabeledJson label="Result" value={call.output} />}
        </div>
      )}
    </div>
  );
}

function LabeledJson({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <pre className="max-h-60 overflow-auto rounded bg-ink/95 p-2 font-mono text-[11px] leading-relaxed text-slate-200">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
