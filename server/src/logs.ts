/**
 * Read-only production log access for CanaryCode's `logs_recent` tool and the
 * in-chat log viewer. Queries Cloud Logging (GKE container logs for the
 * FruitScope services) via Application Default Credentials — the Cloud Run
 * runtime service account, granted roles/logging.viewer. Read-only: the Logging
 * read client can only fetch entries, never write.
 */
import { Logging } from "@google-cloud/logging";

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "braided-visitor-372321";

// Friendly service name → the pod's app.kubernetes.io/name label (see CLAUDE.md).
const SERVICE_APPS: Record<string, string> = {
  server: "fruitscope-server",
  worker: "fruitscope-celery-worker",
  beat: "fruitscope-celery-beat",
  flower: "fruitscope-celery-flower",
  ingester: "fruitscope-ingester",
  client: "fruitscope-client",
  "client-lite": "fruitscope-client-lite",
  "server-lite": "fruitscope-server-lite",
  "scan-mover": "fruitscope-scan-mover",
};
const ENV_NAMESPACES: Record<string, string> = {
  prod: "fruitscope-prod",
  staging: "fruitscope-staging",
  dev: "fruitscope-dev",
};
const SEVERITIES = ["DEFAULT", "DEBUG", "INFO", "NOTICE", "WARNING", "ERROR", "CRITICAL"];

export const LOG_SERVICES = Object.keys(SERVICE_APPS);
export const LOG_ENVIRONMENTS = Object.keys(ENV_NAMESPACES);

let client: Logging | null = null;
const logging = (): Logging => (client ??= new Logging({ projectId: PROJECT_ID }));

export interface LogQueryOptions {
  service?: string; // one of LOG_SERVICES; omitted = all services in the namespace
  env?: string; // prod | staging | dev (default prod)
  severity?: string; // minimum severity (default WARNING)
  hours?: number; // look-back window (default 1)
  contains?: string; // free-text substring filter
  limit?: number; // max entries (default 100)
}

export interface LogEntry {
  timestamp: string;
  severity: string;
  service: string;
  message: string;
  labels?: Record<string, string>;
}

/** Escape a value for safe inclusion inside a double-quoted Logging filter term. */
function q(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function buildFilter(opts: LogQueryOptions): string {
  const env = opts.env && ENV_NAMESPACES[opts.env] ? opts.env : "prod";
  const namespace = ENV_NAMESPACES[env] as string;
  const hours = Math.min(Math.max(opts.hours ?? 1, 1), 168);
  const sinceMs = Date.now() - hours * 3_600_000;
  const since = new Date(sinceMs).toISOString();

  const parts = [
    `resource.type="k8s_container"`,
    `resource.labels.namespace_name="${namespace}"`,
    `timestamp>="${since}"`,
  ];
  if (opts.service && SERVICE_APPS[opts.service]) {
    parts.push(`labels."k8s-pod/app_kubernetes_io/name"="${SERVICE_APPS[opts.service]}"`);
  }
  if (opts.severity && SEVERITIES.includes(opts.severity.toUpperCase())) {
    parts.push(`severity>=${opts.severity.toUpperCase()}`);
  }
  if (opts.contains?.trim()) {
    parts.push(`"${q(opts.contains.trim())}"`);
  }
  return parts.join(" AND ");
}

/** Pull a readable message + service name out of a Cloud Logging entry. */
function normalize(entry: {
  metadata?: {
    timestamp?: string | Date;
    severity?: string | number;
    resource?: { labels?: Record<string, string> };
    labels?: Record<string, string>;
  };
  data?: unknown;
}): LogEntry {
  const md = entry.metadata ?? {};
  const podLabels = md.labels ?? {};
  const app = podLabels["k8s-pod/app_kubernetes_io/name"];
  const service =
    (app && Object.keys(SERVICE_APPS).find((k) => SERVICE_APPS[k] === app)) ?? app ?? "unknown";

  let message = "";
  const data = entry.data;
  if (typeof data === "string") message = data;
  else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    message =
      (typeof obj.message === "string" && obj.message) ||
      (typeof obj.msg === "string" && obj.msg) ||
      (typeof obj.event === "string" && obj.event) ||
      JSON.stringify(obj);
  }

  const ts = md.timestamp;
  const timestamp = ts instanceof Date ? ts.toISOString() : (ts ?? new Date(0).toISOString());
  return {
    timestamp: String(timestamp),
    severity: String(md.severity ?? "DEFAULT"),
    service,
    message,
  };
}

/** Fetch recent log entries (newest first) matching the options. */
export async function queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const filter = buildFilter(opts);
  const [entries] = await logging().getEntries({
    filter,
    orderBy: "timestamp desc",
    pageSize: limit,
    resourceNames: [`projects/${PROJECT_ID}`],
    autoPaginate: false,
  });
  return entries.map((e) => normalize(e as never));
}
