import { Brain, ChevronRight, FileText, Link2, ListChecks, Quote, Sparkles, Wrench } from "lucide-react";
import { lazy, Suspense } from "react";

import type { SqlQueryResult } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CanaryAvatar } from "./CanaryAvatar";
import { Markdown } from "./Markdown";

// The SQL IDE pulls in CodeMirror — load it only when a SQL tool card renders.
const SqlToolCard = lazy(() =>
  import("./SqlToolCard").then((m) => ({ default: m.SqlToolCard })),
);
const LogToolCard = lazy(() =>
  import("./LogToolCard").then((m) => ({ default: m.LogToolCard })),
);

/** A loose view of an AI-SDK UIMessage part — we render every type we see. */
export interface UIPart {
  type: string;
  text?: string;
  state?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  data?: unknown;
  url?: string;
  title?: string;
  filename?: string;
  mediaType?: string;
  [k: string]: unknown;
}

export interface UIMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: UIPart[];
}

/** Data parts a normal user is meant to see; everything else is debug/internal. */
const USER_FACING_DATA = new Set(["citations", "plan", "questions"]);

/** One chat message. User messages are right-aligned bubbles; Canary's answers
 *  render every part type (text, reasoning, tool calls, structured data).
 *  `showDebug` gates internal/debug data parts (admins only, toggleable). */
export function CanaryMessage({ message, showDebug }: { message: UIMessage; showDebug: boolean }) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("\n");
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-500 px-4 py-2 text-sm text-white shadow-sm">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <CanaryAvatar size={30} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-2">
        {message.parts.map((part, i) => (
          <Part key={i} part={part} showDebug={showDebug} />
        ))}
      </div>
    </div>
  );
}

function Part({ part, showDebug }: { part: UIPart; showDebug: boolean }) {
  const { type } = part;

  if (type === "text") {
    if (!part.text) return null;
    // FruitScope prefixes the model's running status/summary commentary with a
    // zero-width space (U+200B). Those belong with the thinking, not the answer —
    // render them muted instead of as conversation.
    if (part.text.startsWith("\u200b")) {
      const status = part.text.replace(/\u200b/g, "").trim();
      return status ? <StatusLine text={status} /> : null;
    }
    return <Markdown>{part.text}</Markdown>;
  }

  if (type === "reasoning") {
    if (!part.text?.trim()) return null;
    return (
      <Disclosure icon={<Brain className="size-3.5" />} label="Thought process">
        <div className="text-xs leading-relaxed text-ink-dim [&_strong]:text-ink-dim">
          <Markdown>{part.text}</Markdown>
        </div>
      </Disclosure>
    );
  }

  if (type === "step-start") {
    return null; // round boundary — no visual needed
  }

  if (type.startsWith("data-")) {
    const name = type.slice("data-".length);
    // Debug/internal context (debug-prompt, debug-context, context-usage, …) is
    // hidden unless an admin has it toggled on. Non-admins never see it.
    if (!USER_FACING_DATA.has(name) && !showDebug) return null;
    return <DataPart name={name} data={part.data} />;
  }

  if (type.startsWith("tool-") || type === "dynamic-tool") {
    const name = part.toolName ?? (type.startsWith("tool-") ? type.slice("tool-".length) : "tool");
    // The read-only DB tool gets a full in-chat SQL IDE (editor + console).
    if (name === "db_query_readonly") {
      return (
        <Suspense
          fallback={<div className="px-1 text-xs text-ink-faint">Loading SQL editor…</div>}
        >
          <SqlToolCard
            input={part.input as { sql?: string; database?: string; limit?: number } | undefined}
            output={part.output as SqlQueryResult | undefined}
            state={part.state}
          />
        </Suspense>
      );
    }
    // The logs tool gets a full in-chat log viewer (filter / search / refresh).
    if (name === "logs_recent") {
      return (
        <Suspense fallback={<div className="px-1 text-xs text-ink-faint">Loading log viewer…</div>}>
          <LogToolCard
            input={
              part.input as
                | { service?: string; env?: string; severity?: string; hours?: number }
                | undefined
            }
            output={part.output as never}
            state={part.state}
          />
        </Suspense>
      );
    }
    return <ToolPart name={name} state={part.state} input={part.input} output={part.output} errorText={part.errorText} />;
  }

  if (type === "source-url" || type === "source-document") {
    return (
      <a
        href={part.url ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 underline underline-offset-2"
      >
        <Link2 className="size-3.5" />
        {part.title ?? part.url ?? "Source"}
      </a>
    );
  }

  if (type === "file") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs text-ink-dim">
        <FileText className="size-3.5" />
        {part.filename ?? part.mediaType ?? "Attachment"}
      </div>
    );
  }

  return null; // unknown part type — render nothing rather than raw JSON
}

/** A muted "thinking aloud" status line (the model's U+200B-prefixed commentary). */
function StatusLine({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-1.5 text-xs italic text-ink-faint">
      <Sparkles className="mt-0.5 size-3 shrink-0" />
      <span>{text}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Tool calls                                                          */
/* ------------------------------------------------------------------ */

function ToolPart({
  name,
  state,
  input,
  output,
  errorText,
}: {
  name: string;
  state?: string | undefined;
  input?: unknown;
  output?: unknown;
  errorText?: string | undefined;
}) {
  const running = state === "input-streaming" || state === "input-available";
  const failed = state === "output-error" || !!errorText;
  return (
    <Disclosure
      icon={<Wrench className="size-3.5" />}
      label={
        <span className="inline-flex items-center gap-2">
          <span className="font-mono text-[0.8rem]">{name}</span>
          <StatusPill running={running} failed={failed} />
        </span>
      }
    >
      <div className="space-y-2">
        {input != null && <LabeledJson label="Input" value={input} />}
        {errorText && <p className="text-xs text-danger">{errorText}</p>}
        {output != null && <LabeledJson label="Result" value={output} />}
      </div>
    </Disclosure>
  );
}

function StatusPill({ running, failed }: { running: boolean; failed: boolean }) {
  const [label, klass] = failed
    ? ["error", "bg-danger/15 text-danger"]
    : running
      ? ["running…", "bg-sun-500/15 text-sun-500"]
      : ["done", "bg-brand-500/15 text-brand-700"];
  return <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", klass)}>{label}</span>;
}

/* ------------------------------------------------------------------ */
/* Structured data parts (plan / citations / questions / …)            */
/* ------------------------------------------------------------------ */

function DataPart({ name, data }: { name: string; data: unknown }) {
  if (name === "citations") return <Citations data={data} />;
  if (name === "plan") return <Plan data={data} />;
  if (name === "questions") return <Questions data={data} />;
  // Unknown data part — show it as a labeled, collapsed card so nothing is lost.
  return (
    <Disclosure icon={<ListChecks className="size-3.5" />} label={name}>
      <LabeledJson label="Data" value={data} />
    </Disclosure>
  );
}

function asArray(data: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const k of keys) {
      const v = (data as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function Citations({ data }: { data: unknown }) {
  const items = asArray(data, "citations", "sources");
  if (!items.length) return null;
  return (
    <Card icon={<Quote className="size-3.5" />} title="Sources">
      <ol className="space-y-1">
        {items.map((c, i) => {
          const item = (c ?? {}) as { url?: string; title?: string; text?: string };
          return (
            <li key={i} className="text-xs">
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-brand-600 underline underline-offset-2"
                >
                  {item.title ?? item.url}
                </a>
              ) : (
                <span className="text-ink-dim">{item.title ?? item.text ?? "Source"}</span>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Plan({ data }: { data: unknown }) {
  const steps = asArray(data, "steps", "plan");
  if (!steps.length) return null;
  return (
    <Card icon={<ListChecks className="size-3.5" />} title="Plan">
      <ol className="list-decimal space-y-1 pl-4 text-xs text-ink-dim">
        {steps.map((s, i) => {
          const step = s as { title?: string; text?: string; status?: string } | string;
          const text = typeof step === "string" ? step : (step.title ?? step.text ?? "");
          return <li key={i}>{text}</li>;
        })}
      </ol>
    </Card>
  );
}

function Questions({ data }: { data: unknown }) {
  const qs = asArray(data, "questions");
  if (!qs.length) return null;
  return (
    <Card icon={<ListChecks className="size-3.5" />} title="Canary needs a bit more">
      <ul className="list-disc space-y-1 pl-4 text-xs text-ink-dim">
        {qs.map((q, i) => {
          const question = q as { question?: string; text?: string } | string;
          const text = typeof question === "string" ? question : (question.question ?? question.text ?? "");
          return <li key={i}>{text}</li>;
        })}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface/60 p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-dim">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}

function Disclosure({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-line bg-surface/60 [&[open]>summary_svg.chev]:rotate-90">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-semibold text-ink-dim">
        <ChevronRight className="chev size-3.5 transition-transform" />
        {icon}
        {label}
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
}

function LabeledJson({ label, value }: { label: string; value: unknown }) {
  const text = typeof value === "string" ? value : safeStringify(value);
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <pre className="max-h-60 overflow-auto rounded-lg bg-surface-2 p-2 text-[11px] leading-relaxed text-ink-dim">
        {text}
      </pre>
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
