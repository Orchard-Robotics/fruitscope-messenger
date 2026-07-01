/**
 * PostHog read-only client for CanaryCode's `errors_recent` tool.
 *
 * Read-only by construction: we only ever POST server-authored HogQL to the
 * `/query/` endpoint, which is a SELECT language — it cannot mutate. The model
 * never supplies HogQL (only enum/number parameters), so there's no injection
 * surface. The personal API key should still be read-scoped (defense in depth).
 */
import { canaryCodeIntegrations as cfg } from "./env";

const REQUEST_TIMEOUT_MS = 20_000;
let cachedProjectId: string | null = null;

export function posthogConfigured(): boolean {
  return Boolean(cfg.posthogKey);
}

async function ph<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.posthogHost}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.posthogKey}`,
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> | undefined),
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`PostHog API ${res.status}: ${body.slice(0, 240)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve the project id (config override, else discover the Fruitscope project). */
async function projectId(): Promise<string> {
  if (cfg.posthogProjectId) return cfg.posthogProjectId;
  if (cachedProjectId) return cachedProjectId;
  const data = await ph<{ results?: Array<{ id?: number; name?: string }> }>("/api/projects/");
  const list = data.results ?? [];
  const pick = list.find((p) => p.name?.toLowerCase().includes("fruitscope")) ?? list[0];
  if (!pick?.id) throw new Error("No PostHog project found for this API key.");
  cachedProjectId = String(pick.id);
  return cachedProjectId;
}

export interface PosthogQueryResult {
  columns: string[];
  results: unknown[][];
}

/** Run a server-authored HogQL SELECT (read-only) and return columns + rows. */
export async function posthogQuery(hogql: string): Promise<PosthogQueryResult> {
  const id = await projectId();
  const data = await ph<{ columns?: string[]; results?: unknown[][] }>(
    `/api/projects/${id}/query/`,
    { method: "POST", body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql } }) },
  );
  return { columns: data.columns ?? [], results: data.results ?? [] };
}
