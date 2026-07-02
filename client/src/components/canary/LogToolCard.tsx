import { AlertTriangle, Loader2, RefreshCw, ScrollText, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { rest, type LogEntry } from "@/lib/api";
import { cn } from "@/lib/cn";

interface LogInput {
  service?: string;
  env?: string;
  severity?: string;
  hours?: number;
  contains?: string;
  limit?: number;
}
interface LogOutput {
  env?: string;
  service?: string;
  count?: number;
  entries?: LogEntry[];
  error?: string;
}

const SERVICES = [
  "all",
  "server",
  "worker",
  "beat",
  "flower",
  "ingester",
  "client",
  "scan-mover",
  "server-lite",
  "client-lite",
];
const ENVS = ["prod", "staging", "dev"];
const SEVERITIES = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];

/** Severity → text/badge colors on the dark console. */
function sevClass(sev: string): string {
  const s = sev.toUpperCase();
  if (s === "CRITICAL" || s === "ERROR" || s === "ALERT" || s === "EMERGENCY")
    return "text-rose-400";
  if (s === "WARNING") return "text-amber-300";
  if (s === "NOTICE" || s === "INFO") return "text-sky-300";
  return "text-slate-400";
}

const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleTimeString(undefined, { hour12: false }) +
        "." +
        String(d.getMilliseconds()).padStart(3, "0");
};

/**
 * The in-chat log viewer for CanaryCode's `logs_recent` tool. Shows the agent's
 * fetched entries in a severity-colored console, and lets a staff user re-query
 * live (service / env / severity / window) plus filter the loaded rows instantly.
 * All read-only.
 */
export function LogToolCard({
  input,
  output,
  state,
}: {
  input?: LogInput | undefined;
  output?: LogOutput | undefined;
  state?: string | undefined;
}) {
  const [service, setService] = useState(input?.service || output?.service || "all");
  const [env, setEnv] = useState(input?.env || output?.env || "prod");
  const [severity, setSeverity] = useState(input?.severity || "WARNING");
  const [hours, setHours] = useState(input?.hours ?? 1);
  const [entries, setEntries] = useState<LogEntry[]>(output?.entries ?? []);
  const [error, setError] = useState<string | undefined>(output?.error);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (output?.entries) setEntries(output.entries);
    if (output?.error !== undefined) setError(output.error);
  }, [output]);

  const refresh = async () => {
    if (loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const r = await rest.logsQuery({
        service: service === "all" ? "" : service,
        env,
        severity,
        hours,
        limit: 200,
      });
      setEntries(r.entries ?? []);
      setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Log query failed");
    } finally {
      setLoading(false);
    }
  };

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return entries;
    return entries.filter(
      (e) => e.message.toLowerCase().includes(f) || e.service.toLowerCase().includes(f),
    );
  }, [entries, filter]);

  const streaming = state === "input-streaming" || state === "input-available";

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface-2/60 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-dim">
          <ScrollText className="size-3.5 text-brand-600" />
          Logs
        </span>
        <Picker value={service} onChange={setService} options={SERVICES} title="Service" />
        <Picker value={env} onChange={setEnv} options={ENVS} title="Environment" />
        <Picker value={severity} onChange={setSeverity} options={SEVERITIES} title="Min severity" />
        <select
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          title="Window"
          className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs font-medium text-ink outline-none focus:border-brand-400"
        >
          {[1, 3, 6, 12, 24, 72, 168].map((h) => (
            <option key={h} value={h}>
              {h < 24 ? `${h}h` : `${h / 24}d`}
            </option>
          ))}
        </select>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-brand-500 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
          title="Re-query logs"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Refresh
        </button>
      </div>

      {/* Instant filter over loaded rows */}
      <div className="flex items-center gap-1.5 border-b border-line bg-surface px-3 py-1.5">
        <Search className="size-3.5 text-ink-faint" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter loaded logs…"
          spellCheck={false}
          className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
        />
        <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
          {shown.length}/{entries.length}
        </span>
      </div>

      {/* Console */}
      <div className="max-h-96 overflow-auto bg-ink/95 font-mono text-[11px] leading-relaxed">
        {error && (
          <div className="flex items-start gap-1.5 px-3 py-2 text-rose-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {!error && streaming && entries.length === 0 && (
          <div className="flex items-center gap-1.5 px-3 py-2 text-slate-400">
            <Loader2 className="size-3.5 animate-spin" /> fetching logs…
          </div>
        )}
        {!error && !streaming && shown.length === 0 && (
          <div className="px-3 py-2 text-slate-500">no matching log entries</div>
        )}
        {shown.map((e, i) => (
          <LogRow key={i} entry={e} />
        ))}
      </div>
    </div>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [open, setOpen] = useState(false);
  const multiline = entry.message.includes("\n") || entry.message.length > 160;
  return (
    <button
      onClick={() => multiline && setOpen((v) => !v)}
      className={cn(
        "flex w-full gap-2 border-b border-slate-800/60 px-3 py-1 text-left",
        multiline && "cursor-pointer hover:bg-slate-800/40",
      )}
    >
      <span className="shrink-0 tabular-nums text-slate-500">{fmtTime(entry.timestamp)}</span>
      <span className={cn("w-16 shrink-0 font-semibold uppercase", sevClass(entry.severity))}>
        {entry.severity.slice(0, 5)}
      </span>
      <span className="w-24 shrink-0 truncate text-brand-300">{entry.service}</span>
      <span
        className={cn(
          "min-w-0 flex-1 text-slate-200",
          open ? "whitespace-pre-wrap break-words" : "truncate",
        )}
      >
        {entry.message}
      </span>
    </button>
  );
}

function Picker({
  value,
  onChange,
  options,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  title: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title}
      className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs font-medium text-ink outline-none focus:border-brand-400"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
