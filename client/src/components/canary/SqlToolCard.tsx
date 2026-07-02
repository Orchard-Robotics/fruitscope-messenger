import { sql, PostgreSQL } from "@codemirror/lang-sql";
import CodeMirror from "@uiw/react-codemirror";
import { AlertTriangle, Check, Database, Loader2, Pencil, Play } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { rest, type SqlQueryResult } from "@/lib/api";
import { cn } from "@/lib/cn";
import { usePrefs } from "@/store/prefs";

interface SqlInput {
  sql?: string;
  database?: string;
  limit?: number;
}

/**
 * The in-chat SQL IDE for CanaryCode's `db_query_readonly` tool. Renders the
 * agent's query in a real editor (CodeMirror, Postgres highlighting + line
 * numbers), lets a staff user pick a database, edit the SQL, and re-run it — all
 * read-only — with results streaming into a console/table below. The Run button
 * hits the same triple-guarded read-only endpoint the agent's tool uses.
 */
export function SqlToolCard({
  input,
  output,
  state,
}: {
  input?: SqlInput | undefined;
  output?: SqlQueryResult | undefined;
  state?: string | undefined;
}) {
  const theme = usePrefs((s) => s.theme);
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-color-scheme: dark)").matches);

  const [sqlText, setSqlText] = useState(input?.sql ?? "");
  const [database, setDatabase] = useState(input?.database || output?.database || "postgres");
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<SqlQueryResult | undefined>(output);
  const [running, setRunning] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const dbListId = useId();

  // The tool's streamed input/output can arrive after first render.
  useEffect(() => {
    if (input?.sql != null) setSqlText(input.sql);
  }, [input?.sql]);
  useEffect(() => {
    if (output) setResult(output);
  }, [output]);

  // Populate the database picker (best-effort).
  useEffect(() => {
    let alive = true;
    rest
      .dbDatabases()
      .then((r) => {
        if (alive) setDatabases(r.databases ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const extensions = useMemo(() => [sql({ dialect: PostgreSQL })], []);

  const run = async () => {
    const q = sqlText.trim();
    if (!q || running) return;
    setRunning(true);
    try {
      setResult(await rest.dbQuery(q, database, input?.limit));
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Request failed" });
    } finally {
      setRunning(false);
    }
  };

  const streaming = state === "input-streaming" || state === "input-available";

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/60 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-dim">
          <Database className="size-3.5 text-brand-600" />
          SQL
        </span>

        {/* Database picker — typeahead over all databases (there are hundreds). */}
        <input
          list={dbListId}
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
          spellCheck={false}
          placeholder="database"
          title="Database (type to search)"
          className="w-36 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-ink outline-none focus:border-brand-400"
        />
        <datalist id={dbListId}>
          {databases.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setEditing((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition",
              editing
                ? "border-brand-400 bg-brand-500/10 text-brand-700"
                : "border-line text-ink-dim hover:bg-surface-2 hover:text-ink",
            )}
            title={editing ? "Done editing" : "Edit query"}
          >
            <Pencil className="size-3.5" />
            {editing ? "Done" : "Edit"}
          </button>
          <button
            onClick={() => void run()}
            disabled={running || !sqlText.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-brand-500 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-brand-600 disabled:opacity-50"
            title="Run query (read-only)"
          >
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Run
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="max-h-72 overflow-auto text-[0.8rem]">
        <CodeMirror
          value={sqlText}
          onChange={setSqlText}
          extensions={extensions}
          theme={dark ? "dark" : "light"}
          editable={editing && !streaming}
          basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: editing }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
        />
      </div>

      {/* Console / results */}
      <ResultConsole running={running} streaming={streaming} result={result} />
    </div>
  );
}

function ResultConsole({
  running,
  streaming,
  result,
}: {
  running: boolean;
  streaming: boolean;
  result: SqlQueryResult | undefined;
}) {
  if (streaming && !result) {
    return (
      <div className="border-t border-line bg-ink/95 px-3 py-2 font-mono text-xs text-emerald-300">
        <span className="inline-flex items-center gap-1.5 text-slate-400">
          <Loader2 className="size-3.5 animate-spin" /> preparing query…
        </span>
      </div>
    );
  }

  const status = running
    ? { icon: <Loader2 className="size-3.5 animate-spin" />, text: "running…", cls: "text-slate-300" }
    : result?.error
      ? { icon: <AlertTriangle className="size-3.5" />, text: result.error, cls: "text-rose-400" }
      : result
        ? {
            icon: <Check className="size-3.5" />,
            text: `${result.rowCount ?? result.rows?.length ?? 0} row${
              (result.rowCount ?? result.rows?.length ?? 0) === 1 ? "" : "s"
            }${result.ms != null ? ` · ${result.ms}ms` : ""}${result.truncated ? " · truncated" : ""}`,
            cls: "text-emerald-400",
          }
        : null;

  return (
    <div className="border-t border-line bg-ink/95">
      {status && (
        <div
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 font-mono text-[11px]",
            status.cls,
          )}
        >
          {status.icon}
          <span className="min-w-0 break-words">{status.text}</span>
        </div>
      )}
      {result && !result.error && result.rows && result.rows.length > 0 && (
        <ResultTable fields={result.fields ?? Object.keys(result.rows[0] ?? {})} rows={result.rows} />
      )}
      {result && !result.error && (result.rows?.length ?? 0) === 0 && !running && (
        <div className="px-3 pb-2 font-mono text-[11px] text-slate-400">no rows</div>
      )}
    </div>
  );
}

function ResultTable({
  fields,
  rows,
}: {
  fields: string[];
  rows: Array<Record<string, unknown>>;
}) {
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full border-collapse font-mono text-[11px]">
        <thead className="sticky top-0 z-10 bg-slate-800 text-slate-200">
          <tr>
            {fields.map((f) => (
              <th
                key={f}
                className="whitespace-nowrap border-b border-slate-700 px-2.5 py-1.5 text-left font-semibold"
              >
                {f}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 ? "bg-slate-900/40" : "bg-slate-900/10"}>
              {fields.map((f) => (
                <td
                  key={f}
                  className="max-w-[22rem] truncate border-b border-slate-800 px-2.5 py-1 text-slate-300"
                  title={cellTitle(row[f])}
                >
                  <Cell value={row[f]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-slate-600 italic">null</span>;
  if (typeof value === "object") return <span className="text-sky-300">{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className="text-amber-300">{value}</span>;
  if (typeof value === "boolean") return <span className="text-purple-300">{String(value)}</span>;
  return <>{String(value)}</>;
}

function cellTitle(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
