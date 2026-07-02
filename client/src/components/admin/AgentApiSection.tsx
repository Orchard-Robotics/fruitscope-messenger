import { Check, Copy, Terminal } from "lucide-react";
import { useState } from "react";

const EXAMPLE = `import { io } from "socket.io-client";

// Connect to the app as yourself. The httpOnly session cookie authenticates the
// socket (same-origin), so run this where your session cookie is available.
const socket = io("https://fruitscope-messenger.com", { withCredentials: true });

socket.on("connect", () => {
  socket.emit(
    "message:send",
    {
      channelId: "<channel-id>",       // the channel to post in
      content: "Deploy finished ✅",   // supports markdown, @mentions, code blocks
      agent: { name: "Deploy Bot" },   // marks this as YOUR agent (name optional)
    },
    (res) => console.log(res.ok ? res.data : res.error),
  );
});`;

/**
 * Admin-only reference for the "agent message" socket API — how an admin's AI
 * agent can post messages attributed to them but visibly marked as an agent.
 */
export function AgentApiSection() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-5 py-4">
        <span className="grid size-8 place-items-center rounded-lg bg-violet-500/15 text-violet-600">
          <Terminal className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-ink">Agent message API</h2>
          <p className="text-xs text-ink-faint">
            Let an AI agent you own post messages as you — clearly marked as an agent.
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 text-sm text-ink-dim">
        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-faint">Overview</h3>
          <p>
            As an admin, any message you send over Socket.IO can be flagged as coming from an{" "}
            <strong className="text-ink">AI agent you own</strong>. The message is still attributed
            to you, but the client shows the agent's name and marks it{" "}
            <span className="inline-flex items-center gap-0.5 rounded bg-violet-500/15 px-1 py-px text-[10px] font-bold uppercase tracking-wide text-violet-600">
              Agent
            </span>{" "}
            with a subtle violet accent — so everyone can tell it's your agent, not you typing.
          </p>
          <p className="text-xs text-ink-faint">
            The flag only works for admins; for everyone else it's ignored and the message posts
            normally.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-faint">Connection</h3>
          <p>
            Connect with <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.85em]">socket.io-client</code>{" "}
            to this app. Auth rides on your httpOnly session cookie (same-origin), so run the agent
            in a context where that cookie is present — no separate token to manage.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-faint">Event</h3>
          <p>
            Emit <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.85em]">message:send</code>{" "}
            with an added <code className="rounded bg-surface-2 px-1 py-0.5 text-[0.85em]">agent</code>{" "}
            field:
          </p>
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-2/70 text-ink-faint">
                <tr>
                  <th className="px-3 py-1.5 font-semibold">Field</th>
                  <th className="px-3 py-1.5 font-semibold">Type</th>
                  <th className="px-3 py-1.5 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono">
                <Row field="channelId" type="string" note="Target channel id (required)." />
                <Row field="content" type="string" note="Message text; markdown, @mentions, code blocks (required)." />
                <Row field="agent" type="{ name?: string }" note="Presence marks it as your agent." />
                <Row
                  field="agent.name"
                  type="string"
                  note={`Agent display name. Omit → "<you>'s agent".`}
                />
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-faint">Example</h3>
          <CodeSample code={EXAMPLE} />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-faint">Behavior</h3>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li>The message is authored by you; the header shows <em>AgentName · Agent · via {"<you>"}</em>.</li>
            <li>Agent messages get a distinct violet accent and never group with your human messages.</li>
            <li>@mentions, reactions, threads, and notifications all work exactly as for normal messages.</li>
            <li>Non-admins can't spoof an agent — the flag is silently ignored for them.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function Row({ field, type, note }: { field: string; type: string; note: string }) {
  return (
    <tr>
      <td className="px-3 py-1.5 text-brand-700">{field}</td>
      <td className="px-3 py-1.5 text-ink-dim">{type}</td>
      <td className="px-3 py-1.5 font-sans text-ink-faint">{note}</td>
    </tr>
  );
}

function CodeSample({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="flex items-center justify-between border-b border-line bg-surface-2/70 px-3 py-1">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          JavaScript
        </span>
        <button
          onClick={() => void copy()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-faint transition hover:bg-surface-2 hover:text-ink"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto bg-ink/95 p-3 text-[0.78rem] leading-relaxed text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}
