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
interface GhCheckRuns {
  total_count?: number;
  check_runs?: Array<{ name?: string; status?: string; conclusion?: string | null }>;
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
  if (!cfg.githubToken) {
    return {
      ok: false,
      error:
        "GitHub integration is not configured yet (no GITHUB_TOKEN). Ask an admin to add a " +
        "read-only token to the canarycode-github-token secret.",
    };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${GH_API}${path}`, {
      method: "GET", // read-only: this helper NEVER issues any other verb.
      headers: {
        Authorization: `Bearer ${cfg.githubToken}`,
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
    "Get CI status (GitHub Actions check runs + commit statuses) for a pull request " +
    "or a branch/SHA in an Orchard-Robotics repo (read-only). Use to see if a build passed.",
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
    const [runsR, statusR] = await Promise.all([
      ghFetch(`/repos/${slug}/commits/${encodeURIComponent(sha)}/check-runs?per_page=50`),
      ghFetch(`/repos/${slug}/commits/${encodeURIComponent(sha)}/status`),
    ]);
    if (!runsR.ok) return { error: runsR.error };
    const runs = runsR.data as GhCheckRuns;
    const checks = (runs.check_runs ?? []).map((c) => ({
      name: c.name,
      status: c.status,
      conclusion: c.conclusion,
    }));
    const combined = statusR.ok ? (statusR.data as GhCombinedStatus).state : undefined;
    const failing = checks.filter(
      (c) => c.conclusion && !["success", "neutral", "skipped"].includes(c.conclusion),
    );
    return {
      repo: slug,
      ref: sha,
      combinedStatus: combined,
      totalChecks: checks.length,
      failing: failing.length,
      checks,
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

/** The read-only tool set handed to CanaryCode's Opus agent. */
export const canaryCodeTools = {
  github_prs,
  github_ci,
  github_pr_summary,
  linear_search,
};
