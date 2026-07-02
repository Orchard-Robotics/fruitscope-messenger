/**
 * CanaryCode read-only developer tools (Phase 2 — "ship": GitHub + Linear).
 *
 * HARD RULE: every tool here is strictly READ-ONLY. There is no code path that
 * writes, creates, merges, closes, comments, deploys, or mutates anything.
 * - GitHub calls go through `ghFetch`, which hard-codes `method: "GET"` — no
 *   other verb is reachable, so even a jailbroken prompt cannot mutate a repo.
 * - Linear uses GraphQL (which is POST by transport) but only ever sends a
 *   server-authored `query` document; the model supplies a search string, never
 *   the operation, so no `mutation` can be issued.
 *
 * Each tool is dormant until its token is provisioned: with no credential it
 * returns a friendly "not configured" note rather than failing the turn. Tokens
 * must be scoped read-only at the source too (defense in depth) — a fine-grained
 * GitHub PAT with read-only permissions, and a Linear personal API key.
 */
import { tool } from "ai";
import { z } from "zod";

import { canaryCodeIntegrations as cfg } from "./env";
import { fruitscopeDbConfigured, runReadOnlyQuery } from "./fruitscopeDb";
import { getGithubInstallationToken, githubConfigured } from "./githubApp";
import { LOG_ENVIRONMENTS, LOG_SERVICES, queryLogs } from "./logs";
import { posthogConfigured, posthogQuery, type PosthogQueryResult } from "./posthog";

const REQUEST_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------------ */
/* GitHub (read-only)                                                  */
/* ------------------------------------------------------------------ */

const GH_API = "https://api.github.com";

/** Minimal shapes for the GitHub REST fields we surface. */
interface GhPull {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  merged?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  commits?: number;
  body?: string | null;
  html_url: string;
  updated_at?: string;
  user?: { login?: string };
  head?: { ref?: string; sha?: string };
  base?: { ref?: string };
}
interface GhReview {
  state?: string;
  user?: { login?: string };
}
interface GhWorkflowRuns {
  total_count?: number;
  workflow_runs?: Array<{
    name?: string;
    status?: string;
    conclusion?: string | null;
    html_url?: string;
  }>;
}
interface GhCombinedStatus {
  state?: string;
  statuses?: Array<{ context?: string; state?: string }>;
}

type GhResult = { ok: true; data: unknown } | { ok: false; error: string };

/**
 * The single choke point for every GitHub call. It is GET-only by construction —
 * read-only enforcement lives here, not in a convention a caller must remember.
 */
async function ghFetch(path: string): Promise<GhResult> {
  if (!githubConfigured()) {
    return {
      ok: false,
      error:
        "GitHub integration is not configured yet. Ask an admin to register the org-owned " +
        "GitHub App (read-only) and add its private key to the canarycode-github-app-key secret.",
    };
  }
  // Prefer the org-owned GitHub App installation token; fall back to a static token.
  let token: string | null;
  try {
    token = (await getGithubInstallationToken()) ?? cfg.githubToken;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "GitHub auth failed" };
  }
  if (!token) return { ok: false, error: "GitHub integration is not configured yet." };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${GH_API}${path}`, {
      method: "GET", // read-only: this helper NEVER issues any other verb.
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "canarycode",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `GitHub API ${res.status}: ${body.slice(0, 240)}` };
    }
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "GitHub request failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve a repo argument to `owner/repo`, defaulting the owner to the org and
 *  the repo to the default repo. Accepts a bare name or a full `owner/repo`. */
function resolveRepo(repo: string | undefined): string {
  const r = (repo ?? "").trim();
  if (!r) return `${cfg.githubOrg}/${cfg.githubDefaultRepo}`;
  return r.includes("/") ? r : `${cfg.githubOrg}/${r}`;
}

function truncate(s: string | null | undefined, max: number): string {
  const t = (s ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}…[truncated]` : t;
}

const github_prs = tool({
  description:
    "List pull requests in an Orchard-Robotics GitHub repo (read-only). Use to see " +
    "what's open, recently merged, or in review.",
  inputSchema: z.object({
    repo: z
      .string()
      .optional()
      .describe('Repo name (e.g. "fruitscope") or "owner/repo". Defaults to fruitscope.'),
    state: z
      .enum(["open", "closed", "all"])
      .optional()
      .describe("Filter by PR state. Default: open."),
    limit: z.number().int().min(1).max(30).optional().describe("Max PRs to return (default 15)."),
  }),
  execute: async ({ repo, state, limit }) => {
    const slug = resolveRepo(repo);
    const per = limit ?? 15;
    const r = await ghFetch(
      `/repos/${slug}/pulls?state=${state ?? "open"}&per_page=${per}&sort=updated&direction=desc`,
    );
    if (!r.ok) return { error: r.error };
    const pulls = (r.data as GhPull[]).map((p) => ({
      number: p.number,
      title: p.title,
      author: p.user?.login,
      state: p.state,
      draft: p.draft ?? false,
      headRef: p.head?.ref,
      baseRef: p.base?.ref,
      updatedAt: p.updated_at,
      url: p.html_url,
    }));
    return { repo: slug, count: pulls.length, pulls };
  },
});

const github_ci = tool({
  description:
    "Get CI status for a pull request or a branch/SHA in an Orchard-Robotics repo " +
    "(read-only): GitHub Actions workflow runs plus any commit statuses. Use to see if a build passed.",
  inputSchema: z.object({
    repo: z.string().optional().describe('Repo name or "owner/repo". Defaults to fruitscope.'),
    pr: z.number().int().optional().describe("PR number to check (resolves its head commit)."),
    ref: z
      .string()
      .optional()
      .describe("Branch name or commit SHA to check. Ignored if `pr` is given."),
  }),
  execute: async ({ repo, pr, ref }) => {
    const slug = resolveRepo(repo);
    let sha = ref?.trim();
    if (pr != null) {
      const pd = await ghFetch(`/repos/${slug}/pulls/${pr}`);
      if (!pd.ok) return { error: pd.error };
      sha = (pd.data as GhPull).head?.sha;
    }
    if (!sha) return { error: "Provide either a `pr` number or a `ref` (branch or SHA)." };

    // Actions workflow runs (Actions:Read) + combined commit status (Commit
    // statuses:Read). We avoid the check-runs API on purpose — it needs the
    // "Checks" permission, which fine-grained PATs don't expose.
    const [runsR, statusR] = await Promise.all([
      ghFetch(`/repos/${slug}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=30`),
      ghFetch(`/repos/${slug}/commits/${encodeURIComponent(sha)}/status`),
    ]);
    if (!runsR.ok) return { error: runsR.error };

    const runs = (runsR.data as GhWorkflowRuns).workflow_runs ?? [];
    const workflows = runs.map((r) => ({
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      url: r.html_url,
    }));

    const statusData = statusR.ok ? (statusR.data as GhCombinedStatus) : undefined;
    const statuses = (statusData?.statuses ?? []).map((s) => ({
      context: s.context,
      state: s.state,
    }));

    const bad = (c: string | null | undefined): boolean =>
      !!c && !["success", "neutral", "skipped"].includes(c);
    const failingWorkflows = workflows.filter((w) => bad(w.conclusion)).length;
    const running = workflows.some((w) => w.status !== "completed");
    const overall = failingWorkflows > 0 ? "failing" : running ? "in_progress" : "passing";

    return {
      repo: slug,
      ref: sha,
      overall,
      combinedStatus: statusData?.state,
      workflows,
      statuses,
    };
  },
});

const github_pr_summary = tool({
  description:
    "Detailed summary of a single pull request — description, author, state, " +
    "mergeability, review verdicts, and diff size (read-only).",
  inputSchema: z.object({
    repo: z.string().optional().describe('Repo name or "owner/repo". Defaults to fruitscope.'),
    pr: z.number().int().describe("PR number."),
  }),
  execute: async ({ repo, pr }) => {
    const slug = resolveRepo(repo);
    const pd = await ghFetch(`/repos/${slug}/pulls/${pr}`);
    if (!pd.ok) return { error: pd.error };
    const p = pd.data as GhPull;

    const rv = await ghFetch(`/repos/${slug}/pulls/${pr}/reviews?per_page=100`);
    let reviews: Record<string, number> | undefined;
    if (rv.ok) {
      reviews = {};
      for (const r of rv.data as GhReview[]) {
        const key = (r.state ?? "UNKNOWN").toLowerCase();
        reviews[key] = (reviews[key] ?? 0) + 1;
      }
    }

    return {
      repo: slug,
      number: p.number,
      title: p.title,
      author: p.user?.login,
      state: p.state,
      draft: p.draft ?? false,
      merged: p.merged ?? false,
      mergeable: p.mergeable ?? null,
      mergeableState: p.mergeable_state,
      baseRef: p.base?.ref,
      headRef: p.head?.ref,
      additions: p.additions,
      deletions: p.deletions,
      changedFiles: p.changed_files,
      commits: p.commits,
      reviews,
      url: p.html_url,
      body: truncate(p.body, 2000),
    };
  },
});

/* ------------------------------------------------------------------ */
/* Linear (read-only)                                                  */
/* ------------------------------------------------------------------ */

const LINEAR_API = "https://api.linear.app/graphql";

interface LinearIssueNode {
  identifier?: string;
  title?: string;
  url?: string;
  priorityLabel?: string;
  state?: { name?: string };
  assignee?: { displayName?: string };
  team?: { key?: string };
  updatedAt?: string;
}

const linear_search = tool({
  description:
    "Search Linear issues by text across title and description (read-only). Use to find " +
    "tickets, check status, or reference work items.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Search text to match in issue title or description."),
    limit: z.number().int().min(1).max(25).optional().describe("Max issues to return (default 15)."),
  }),
  execute: async ({ query, limit }) => {
    if (!cfg.linearApiKey) {
      return {
        error:
          "Linear integration is not configured yet (no LINEAR_API_KEY). Ask an admin to add a " +
          "read-only Linear API key to the canarycode-linear-key secret.",
      };
    }
    // Server-authored read-only query. The model supplies only `$term`/`$first`;
    // it can never turn this into a mutation.
    const document = `
      query CanaryCodeSearch($term: String!, $first: Int!) {
        issues(
          first: $first
          orderBy: updatedAt
          filter: { or: [
            { title: { containsIgnoreCase: $term } }
            { description: { containsIgnoreCase: $term } }
          ] }
        ) {
          nodes {
            identifier
            title
            url
            priorityLabel
            state { name }
            assignee { displayName }
            team { key }
            updatedAt
          }
        }
      }`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(LINEAR_API, {
        method: "POST",
        headers: { Authorization: cfg.linearApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ query: document, variables: { term: query, first: limit ?? 15 } }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { error: `Linear API ${res.status}: ${body.slice(0, 240)}` };
      }
      const json = (await res.json()) as {
        data?: { issues?: { nodes?: LinearIssueNode[] } };
        errors?: Array<{ message?: string }>;
      };
      if (json.errors?.length) {
        return { error: `Linear query error: ${json.errors.map((e) => e.message).join("; ")}` };
      }
      const nodes = json.data?.issues?.nodes ?? [];
      const issues = nodes.map((n) => ({
        identifier: n.identifier,
        title: n.title,
        state: n.state?.name,
        assignee: n.assignee?.displayName,
        priority: n.priorityLabel,
        team: n.team?.key,
        updatedAt: n.updatedAt,
        url: n.url,
      }));
      return { count: issues.length, issues };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Linear request failed" };
    } finally {
      clearTimeout(timer);
    }
  },
});

/* ------------------------------------------------------------------ */
/* PostHog (read-only)                                                 */
/* ------------------------------------------------------------------ */

/** Zip a HogQL result's columns + rows into plain objects. */
function rowsToObjects(r: PosthogQueryResult): Array<Record<string, unknown>> {
  return r.results.map((row) => {
    const obj: Record<string, unknown> = {};
    r.columns.forEach((c, i) => {
      obj[c] = row[i];
    });
    return obj;
  });
}

const errors_recent = tool({
  description:
    "Recent production errors from PostHog (read-only), grouped by frequency: either " +
    "frontend/backend exceptions (JS + Python) or backend HTTP 4xx/5xx errors. Use to see " +
    "what's breaking in prod right now.",
  inputSchema: z.object({
    kind: z
      .enum(["exceptions", "http"])
      .optional()
      .describe("'exceptions' = JS/Python exceptions (default); 'http' = backend 4xx/5xx."),
    hours: z
      .number()
      .int()
      .min(1)
      .max(336)
      .optional()
      .describe("Look-back window in hours (default 24, max 336)."),
    limit: z.number().int().min(1).max(30).optional().describe("Max rows (default 15)."),
  }),
  execute: async ({ kind, hours, limit }) => {
    if (!posthogConfigured()) {
      return {
        error:
          "PostHog integration is not configured yet (no POSTHOG_API_KEY). Ask an admin to add a " +
          "read-only PostHog key to the canarycode-posthog-key secret.",
      };
    }
    // `hours`/`limit` are zod-validated integers and `kind` an enum, so nothing
    // model-supplied is interpolated as text — the HogQL stays server-authored.
    const h = hours ?? 24;
    const n = limit ?? 15;
    try {
      if (kind === "http") {
        const r = await posthogQuery(
          `SELECT properties.status_code AS status, properties.method AS method, ` +
            `properties.path AS path, properties.orchard_code AS orchard, count() AS count, ` +
            `max(timestamp) AS last FROM events WHERE event = 'backend_http_error' ` +
            `AND timestamp > now() - INTERVAL ${h} HOUR GROUP BY status, method, path, orchard ` +
            `ORDER BY count DESC LIMIT ${n}`,
        );
        return { kind: "http", windowHours: h, errors: rowsToObjects(r) };
      }
      const r = await posthogQuery(
        `SELECT JSONExtractString(properties.$exception_types, 1) AS type, ` +
          `JSONExtractString(properties.$exception_values, 1) AS message, ` +
          `JSONExtractString(properties.$exception_sources, 1) AS source, count() AS count, ` +
          `max(timestamp) AS last FROM events WHERE event = '$exception' ` +
          `AND timestamp > now() - INTERVAL ${h} HOUR GROUP BY type, message, source ` +
          `ORDER BY count DESC LIMIT ${n}`,
      );
      return { kind: "exceptions", windowHours: h, errors: rowsToObjects(r) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "PostHog request failed" };
    }
  },
});

/* ------------------------------------------------------------------ */
/* FruitScope database (read-only)                                     */
/* ------------------------------------------------------------------ */

const db_query_readonly = tool({
  description:
    "Run a read-only SQL query against the shared FruitScope production database (read-only). " +
    "Databases are per-orchard (e.g. 'meta', 'SEA', 'AVM', 'WAS'; 'BETA-<code>' for beta) — pass " +
    "the one you want. Only a single SELECT/WITH/EXPLAIN statement is allowed; writes are rejected " +
    "and the session is forced read-only. Use for questions about orchards, scans, blocks, trees, etc.",
  inputSchema: z.object({
    sql: z
      .string()
      .min(1)
      .describe("A single read-only SQL query (SELECT/WITH/EXPLAIN). No writes, no ';'-chaining."),
    database: z
      .string()
      .optional()
      .describe("Target database (orchard code, e.g. 'AVM'). Defaults to 'postgres'."),
    limit: z.number().int().min(1).max(1000).optional().describe("Max rows to return (default 100)."),
  }),
  execute: async ({ sql, database, limit }) => {
    if (!fruitscopeDbConfigured()) {
      return {
        error:
          "FruitScope DB integration is not configured yet (no read-only credentials). Ask an admin " +
          "to add the read-only DB password to the canarycode-fruitscope-db-password secret.",
      };
    }
    try {
      return await runReadOnlyQuery(sql, database ?? "", limit ?? 100);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Query failed" };
    }
  },
});

/* ------------------------------------------------------------------ */
/* Production logs (read-only)                                         */
/* ------------------------------------------------------------------ */

const logs_recent = tool({
  description:
    "Read recent production logs from Cloud Logging (read-only) for a FruitScope service. " +
    `Services: ${LOG_SERVICES.join(", ")}. Use to investigate errors, crashes, or behavior in prod.`,
  inputSchema: z.object({
    service: z
      .enum(LOG_SERVICES as [string, ...string[]])
      .optional()
      .describe("Which service's logs (omit for all services in the namespace)."),
    env: z
      .enum(LOG_ENVIRONMENTS as [string, ...string[]])
      .optional()
      .describe("Environment (default prod)."),
    severity: z
      .enum(["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"])
      .optional()
      .describe("Minimum severity (default WARNING)."),
    hours: z.number().int().min(1).max(168).optional().describe("Look-back window in hours (default 1)."),
    contains: z.string().optional().describe("Only entries containing this text."),
    limit: z.number().int().min(1).max(300).optional().describe("Max entries (default 100)."),
  }),
  execute: async ({ service, env, severity, hours, contains, limit }) => {
    try {
      const entries = await queryLogs({
        ...(service ? { service } : {}),
        ...(env ? { env } : {}),
        severity: severity ?? "WARNING",
        hours: hours ?? 1,
        ...(contains ? { contains } : {}),
        limit: limit ?? 100,
      });
      return { env: env ?? "prod", service: service ?? "all", count: entries.length, entries };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Log query failed";
      return {
        error: /permission|denied|forbidden/i.test(msg)
          ? "Cloud Logging access isn't granted yet (needs roles/logging.viewer on the runtime service account)."
          : msg,
      };
    }
  },
});

/* ------------------------------------------------------------------ */

/** The read-only tool set handed to CanaryCode's Opus agent. */
export const canaryCodeTools = {
  github_prs,
  github_ci,
  github_pr_summary,
  linear_search,
  errors_recent,
  db_query_readonly,
  logs_recent,
};
