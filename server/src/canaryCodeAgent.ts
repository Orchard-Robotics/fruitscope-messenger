import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";
import type { Server } from "socket.io";

import type { ClientToServerEvents, ID, ServerToClientEvents, SocketData } from "@shared/index";
import { afterBotPost } from "./botAgent";
import { botsPaused } from "./botControl";
import { buildRoster, encodeMentions, mentionGuidance } from "./botRoom";
import { canaryCodeTools } from "./canaryCodeTools";
import { superAdminOrchard } from "./env";
import { emitMessage } from "./messageEmit";
import { CANARYCODE, channels, messages, orchards, users } from "./store";

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const chanRoom = (id: ID): string => `chan:${id}`;
const MENTION_RE = /<@([A-Za-z0-9_-]+)>/g;

/** Whether a message body @mentions CanaryCode. */
export function mentionsCanaryCode(content: string): boolean {
  return content.includes(`<@${CANARYCODE.id}>`);
}

/**
 * CanaryCode's identity + tool catalog. Shared by the DM streaming route
 * (/canarycode/chat) and the in-channel responder so both behave identically.
 * Every tool is strictly read-only.
 */
export const CANARYCODE_SYSTEM = [
  "You are CanaryCode, a senior software engineer and pair-programmer for the Orchard",
  "Robotics / FruitScope team. FruitScope is an agricultural-robotics platform: a",
  "Python/Flask backend + Celery workers on GKE (GitOps via ArgoCD), PostgreSQL on",
  "Cloud SQL, a React/TypeScript frontend, and this messenger app (Node/Express +",
  "React + Prisma on Cloud Run). Help developers debug issues, understand the",
  "codebase, write and review code, and reason about the infrastructure. Be precise,",
  "concise, and practical; put code in fenced markdown blocks.",
  "",
  "You have READ-ONLY tools into the team's GitHub and Linear:",
  "- github_prs: list pull requests in a repo (default repo: fruitscope).",
  "- github_ci: CI status (Actions workflow runs + commit statuses) for a PR or a branch/SHA.",
  "- github_pr_summary: details of one PR (description, reviews, mergeability, diff size).",
  "- linear_search: search Linear issues by text.",
  "- errors_recent: recent production errors from PostHog (exceptions, or backend HTTP 4xx/5xx).",
  "- db_query_readonly: run a read-only SELECT against the shared FruitScope DB (per-orchard databases).",
  "- logs_recent: read recent production logs (Cloud Logging) for a FruitScope service.",
  "Use them whenever a question needs live PR, CI, ticket, production-error, database, or log state — don't guess when",
  "you can look. Every tool is strictly read-only: you cannot merge, comment, deploy,",
  "create, or change anything, so never claim you did. If a tool reports it isn't",
  "configured, tell the user the integration needs a token and answer from what you know.",
].join("\n");

interface RawToolCall {
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  args?: unknown;
}
interface RawToolResult {
  toolCallId?: string;
  output?: unknown;
  result?: unknown;
}

/** Flatten a generateText result's steps into {name,input,output} tool calls. */
function collectToolCalls(result: {
  steps?: ReadonlyArray<{ toolCalls?: unknown; toolResults?: unknown }>;
}): Array<{ name: string; input?: unknown; output?: unknown }> {
  const out: Array<{ name: string; input?: unknown; output?: unknown }> = [];
  for (const step of result.steps ?? []) {
    const calls = (step.toolCalls ?? []) as RawToolCall[];
    const results = (step.toolResults ?? []) as RawToolResult[];
    for (const c of calls) {
      const r = results.find((x) => x.toolCallId === c.toolCallId);
      out.push({
        name: c.toolName ?? "tool",
        input: c.input ?? c.args,
        output: r?.output ?? r?.result,
      });
    }
  }
  return out;
}

/** Replace `<@id>` mention tokens with readable `@Name` for the transcript. */
async function withNames(content: string, name: (id: ID) => Promise<string>): Promise<string> {
  let out = content;
  const ids = [...content.matchAll(MENTION_RE)].map((m) => m[1] as string);
  for (const id of new Set(ids)) out = out.split(`<@${id}>`).join(`@${await name(id)}`);
  return out;
}

/**
 * CanaryCode was @mentioned in a channel. It's Orchard-Robotics-only, so this is
 * a no-op outside that workspace or when a non-staff member triggered it. Runs the
 * same read-only Opus tool agent as its DM, but collects the final answer and
 * posts it as a channel message (so its full capability works in any channel it's
 * in, not just its DM panel). Best-effort — failures post a short apology.
 */
export async function respondAsCanaryCode(io: IO, channelId: ID, senderId: ID): Promise<void> {
  const typing = (on: boolean): void => {
    io.to(chanRoom(channelId)).emit("typing:update", { channelId, userIds: on ? [CANARYCODE.id] : [] });
  };
  try {
    const channel = await channels.byId(channelId);
    if (!channel) return;
    const orchard = await orchards.byId(channel.orchardId);
    // Orchard-Robotics workspace only, and only for staff (matches the DM gate).
    if (!orchard || orchard.code !== superAdminOrchard.code) return;
    if (!(await users.isStaff(senderId))) return;

    // Make CanaryCode a visible member of the room it's now working in.
    if (!channel.memberIds.includes(CANARYCODE.id)) {
      const updated = await channels.addMember(channelId, CANARYCODE.id);
      if (updated) io.to(chanRoom(channelId)).emit("channel:updated", updated);
    }

    typing(true);

    const roster = await buildRoster(channel.orchardId, CANARYCODE.id);
    const page = await messages.page(channelId, { limit: 14 });
    const nameCache = new Map<ID, string>();
    const nameOf = async (id: ID): Promise<string> => {
      if (!nameCache.has(id)) nameCache.set(id, (await users.byId(id))?.displayName ?? "Someone");
      return nameCache.get(id) as string;
    };
    const lines: string[] = [];
    for (const m of page.messages) {
      lines.push(`${await nameOf(m.authorId)}: ${await withNames(m.content, nameOf)}`);
    }
    // Name who @mentioned you and quote their message so you answer the right
    // person about the right thing.
    const trigger = page.messages[page.messages.length - 1];
    const triggerLine = trigger
      ? `You were just @mentioned by ${await nameOf(trigger.authorId)}, in this message:\n` +
        `"${await withNames(trigger.content, nameOf)}"\n` +
        `Reply to them (and @mention ${await nameOf(trigger.authorId)} so they see it).\n\n`
      : "";

    const prompt =
      "You've been @mentioned in a team chat channel. Answer helpfully and concisely, using your " +
      "read-only tools when the question needs live data. Don't repeat the question or add a greeting.\n\n" +
      `People and bots in this workspace:\n${roster.text || "- (just you)"}\n\n` +
      `${mentionGuidance()}\n\n` +
      triggerLine +
      `Recent conversation:\n${lines.join("\n")}\n\nYour reply:`;

    const result = await generateText({
      model: anthropic("claude-opus-4-8"),
      system: CANARYCODE_SYSTEM,
      prompt,
      tools: canaryCodeTools,
      stopWhen: stepCountIs(8),
    });

    typing(false);
    if (botsPaused(channelId)) return;

    // Capture the tool calls (input + output) so the channel renders the same
    // rich tool cards (SQL editor, log viewer, …) CanaryCode shows in its DM.
    const toolCalls = collectToolCalls(result);
    const toolCallsJson = toolCalls.length ? JSON.stringify(toolCalls) : null;

    const text = encodeMentions(
      result.text.trim() || "I’m not sure how to help with that one — could you give me more detail?",
      roster.members,
    );
    const msg = await messages.create(channelId, CANARYCODE.id, text, null, null, toolCallsJson);
    await emitMessage(io, channelId, "message:new", msg);
    await afterBotPost(io, channel, msg);
  } catch (err) {
    console.warn("[canarycode-agent] failed:", err instanceof Error ? err.message : err);
    typing(false);
    try {
      const msg = await messages.create(channelId, CANARYCODE.id, "⚠️ I hit an error trying to answer that one.");
      await emitMessage(io, channelId, "message:new", msg);
    } catch {
      /* give up */
    }
  }
}
