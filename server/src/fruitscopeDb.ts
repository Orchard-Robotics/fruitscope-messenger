/**
 * Read-only access to the shared FruitScope production database for CanaryCode's
 * `db_query_readonly` tool. Reached over the Cloud SQL unix socket (the runtime
 * SA has roles/cloudsql.client project-wide) — the same mechanism the app uses
 * for its own DB — so no VPC connector / private-IP path is needed.
 *
 * READ-ONLY is enforced at THREE layers (defense in depth):
 *   1. The `readonly` database role itself (SELECT-only, set up out of band).
 *   2. An explicit read-only transaction (`default_transaction_read_only` +
 *      `BEGIN ... READ ONLY`), so even a mis-scoped role cannot write.
 *   3. A query-shape guard: a single statement that starts with SELECT/WITH/
 *      EXPLAIN/SHOW/TABLE and contains no write keyword.
 * Plus a statement timeout and a row cap to keep queries cheap.
 */
import pg from "pg";

import { canaryCodeIntegrations as cfg } from "./env";

const { Client } = pg;

const STATEMENT_TIMEOUT_MS = 15_000;

export function fruitscopeDbConfigured(): boolean {
  return Boolean(cfg.fsDbInstance && cfg.fsDbPassword);
}

const READ_ONLY_START = /^(select|with|explain|show|table)\b/i;
// Reject anything that could mutate/side-effect, as a belt over the read-only txn.
const WRITE_KEYWORD =
  /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|merge|vacuum|reindex|cluster|comment|lock|refresh|import|prepare|listen|notify|set\s+role)\b/i;

export interface ReadOnlyQueryResult {
  database: string;
  fields: string[];
  rowCount: number;
  rows: unknown[];
  truncated: boolean;
}

/** Validate + run a single read-only query against a database on the shared instance. */
export async function runReadOnlyQuery(
  sql: string,
  database: string,
  limit: number,
): Promise<ReadOnlyQueryResult> {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.includes(";")) {
    throw new Error("Only a single statement is allowed (no ';').");
  }
  if (!READ_ONLY_START.test(trimmed)) {
    throw new Error("Only read-only queries are allowed (must start with SELECT/WITH/EXPLAIN).");
  }
  if (WRITE_KEYWORD.test(trimmed)) {
    throw new Error("Query rejected: it contains a non-read-only keyword.");
  }

  const db = (database || cfg.fsDbDefaultDb).trim();
  const client = new Client({
    host: `/cloudsql/${cfg.fsDbInstance}`, // Cloud SQL unix socket dir
    user: cfg.fsDbUser,
    password: cfg.fsDbPassword,
    database: db,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS + 5_000,
    connectionTimeoutMillis: 10_000,
  });

  await client.connect();
  try {
    // Layer 2: hard read-only transaction — any write errors out here.
    await client.query("SET default_transaction_read_only = on");
    await client.query("BEGIN READ ONLY");
    const res = await client.query(trimmed);
    await client.query("ROLLBACK");

    const rows = res.rows.slice(0, limit);
    return {
      database: db,
      fields: res.fields.map((f) => f.name),
      rowCount: res.rowCount ?? rows.length,
      rows,
      truncated: res.rows.length > limit,
    };
  } finally {
    await client.end();
  }
}
