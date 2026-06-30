/**
 * FruitScope API proxy — the server-side client behind the Canary AI assistant.
 *
 * Canary lives in the FruitScope backend, not here. The messenger acts as the
 * signed-in user by presenting their `session_jwt` (captured at OIDC login) to
 * the FruitScope API as the `auth_jwt` cookie. None of this ever reaches the
 * browser — the client only ever talks to our own `/api/canary/*` routes.
 *
 * Orchard scoping ("switch-first"): the FruitScope AI/history endpoints read the
 * active orchard from the Flask session (`session["database"]`), and the history
 * blueprint is "meta-only" — it never re-establishes the session from the cookie
 * itself. So for EVERY orchard-scoped call we first `POST /switch-orchard`, which
 * (a) rehydrates the session from `auth_jwt`, (b) validates the user's access to
 * the target orchard, and (c) returns a Flask `session` cookie scoped to it. We
 * then replay `auth_jwt` + that `session` cookie on the real call. This is
 * stateless (no cross-instance cookie jar) and uniform for every endpoint.
 */

import { FRUITSCOPE_API_BASE } from "./env";

const AUTH_JWT_COOKIE = "auth_jwt";

/** An error from the FruitScope API, carrying the upstream HTTP status. */
export class FruitscopeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "FruitscopeApiError";
  }
}

/* ------------------------------------------------------------------ */
/* Cookie plumbing                                                     */
/* ------------------------------------------------------------------ */

/** Parse `Set-Cookie` response headers into a `name -> value` map (value only). */
function parseSetCookies(res: Response): Map<string, string> {
  const jar = new Map<string, string>();
  // undici (Node 18+) exposes the un-folded list via getSetCookie().
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];
  for (const line of raw) {
    const pair = line.split(";", 1)[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return jar;
}

/** Serialize a cookie jar (always including `auth_jwt`) into a Cookie header. */
function cookieHeader(authJwt: string, jar?: Map<string, string>): string {
  const parts = new Map<string, string>(jar);
  parts.set(AUTH_JWT_COOKIE, authJwt);
  return [...parts].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Read the `auth_jwt` payload (not verified — we already trust the token; we only
 * read claims off it, e.g. the primary orchard and admin flag).
 */
function jwtPayload(jwt: string): { db?: unknown; orchard?: unknown; is_admin?: unknown } | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The user's primary orchard code (`db`), used to seed `/user-info`. */
function jwtPrimaryOrchard(jwt: string): string | null {
  const p = jwtPayload(jwt);
  if (typeof p?.db === "string" && p.db) return p.db;
  if (typeof p?.orchard === "string" && p.orchard) return p.orchard;
  return null;
}

/** Whether the token's owner is a FruitScope admin. */
function jwtIsAdmin(jwt: string): boolean {
  return jwtPayload(jwt)?.is_admin === true;
}

/** Best-effort error message from an upstream JSON/text body. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as { error?: string; message?: string };
      return body.error ?? body.message ?? (text.slice(0, 200) || res.statusText);
    } catch {
      return text.slice(0, 200) || res.statusText;
    }
  } catch {
    return res.statusText;
  }
}

const url = (path: string): string => `${FRUITSCOPE_API_BASE}${path}`;

/* ------------------------------------------------------------------ */
/* Instrumented fetch — one place that logs EVERY upstream call        */
/* ------------------------------------------------------------------ */

/**
 * Make one FruitScope call, logging it (method, path, orchard, status, ms) and
 * normalising failures to `FruitscopeApiError`. A network failure is logged and
 * surfaced as a 502. The successful `Response` is returned with its body intact
 * (callers read JSON, capture cookies, or stream it).
 */
async function call(
  method: string,
  path: string,
  orchardCode: string | null,
  cookie: string,
  init: { headers?: Record<string, string>; body?: string | FormData } = {},
): Promise<Response> {
  const tag = `[canary→fs] ${method} ${path}${orchardCode ? ` orchard=${orchardCode}` : ""}`;
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url(path), {
      method,
      headers: { Cookie: cookie, ...(init.headers ?? {}) },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`${tag} → NETWORK_ERROR ${Date.now() - t0}ms: ${msg}`);
    throw new FruitscopeApiError(502, `Couldn't reach FruitScope (${msg}).`);
  }
  const ms = Date.now() - t0;
  if (!res.ok) {
    const detail = await errorMessage(res);
    console.warn(`${tag} → ${res.status} ${ms}ms: ${detail}`);
    throw new FruitscopeApiError(res.status, detail);
  }
  console.log(`${tag} → ${res.status} ${ms}ms`);
  return res;
}

/* ------------------------------------------------------------------ */
/* Orchard switch — the "switch-first" primitive                       */
/* ------------------------------------------------------------------ */

/**
 * Switch the user's active orchard and return a cookie jar scoped to it (to be
 * replayed on the subsequent call). Throws FruitscopeApiError(403) when the user
 * has no access to that orchard, (401) when the token is rejected.
 */
async function switchOrchard(authJwt: string, orchardCode: string): Promise<Map<string, string>> {
  // Admins must use /admin/switch-orchard: the public /switch-orchard enforces
  // explicit per-orchard access (has_any_orchard_access), which an admin can lack
  // even though they can use every orchard. The admin endpoint is gated on the
  // token's admin flag and switches anywhere.
  const path = jwtIsAdmin(authJwt) ? "/admin/switch-orchard" : "/switch-orchard";
  const res = await call("POST", path, orchardCode, cookieHeader(authJwt), {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orchard_code: orchardCode }),
  });
  const jar = parseSetCookies(res);
  await res.body?.cancel().catch(() => {});
  return jar;
}

/* ------------------------------------------------------------------ */
/* Generic request helpers                                             */
/* ------------------------------------------------------------------ */

/** A JSON request scoped to an orchard (switch-first), parsed as `T`. */
async function orchardJson<T>(
  authJwt: string,
  orchardCode: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const jar = await switchOrchard(authJwt, orchardCode);
  const res = await call(method, path, orchardCode, cookieHeader(authJwt, jar), {
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Response shapes (only the fields we use)                            */
/* ------------------------------------------------------------------ */

export interface FsOrchard {
  orchard_id: number;
  orchard_name: string;
  orchard_code: string;
}

export interface FsUserInfo {
  accessible_orchards?: FsOrchard[];
  is_admin?: boolean;
  [k: string]: unknown;
}

export interface FsConversationSummary {
  id: string;
  title: string | null;
  block_name: string | null;
  agent_mode?: string;
  general_mode?: boolean;
  updated_at: string;
  preview?: string;
}

export interface FsBlockScan {
  scan_id: number;
  scan_name: string;
  timestamp: string;
  stage_type?: string | null;
}

export interface FsBlock {
  block_name: string;
  block_id: number;
  ranch_name?: string | null;
  block_variety?: string | null;
  last_scan_date?: string | null;
  scans?: FsBlockScan[];
}

export interface FsPrepareContextResult {
  session_id: string;
  scan_report_pending?: boolean;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * The user's accessible orchards (with names), the same source the FruitScope AI
 * view uses. `/user-info` REQUIRES an `orchard_code` (any orchard the user can
 * access), so we seed it with the primary from the token (or a cached fallback
 * passed by the caller). `accessible_orchards` is the user's full list regardless
 * of which seed we pass.
 */
export async function getUserInfo(authJwt: string, fallbackOrchard?: string): Promise<FsUserInfo> {
  const seed = jwtPrimaryOrchard(authJwt) ?? fallbackOrchard;
  if (!seed) {
    throw new FruitscopeApiError(409, "No orchard is associated with your FruitScope account.");
  }
  const res = await call(
    "GET",
    `/user-info?orchard_code=${encodeURIComponent(seed)}`,
    seed,
    cookieHeader(authJwt),
  );
  return (await res.json()) as FsUserInfo;
}

/** Blocks (and their scans) in an orchard — for the block picker. */
export function getBlocks(authJwt: string, orchardCode: string): Promise<FsBlock[]> {
  return orchardJson<FsBlock[]>(authJwt, orchardCode, "GET", "/util/get_block_scan_map");
}

export function listConversations(
  authJwt: string,
  orchardCode: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<FsConversationSummary[]> {
  const q = new URLSearchParams();
  if (opts.limit != null) q.set("limit", String(opts.limit));
  if (opts.offset != null) q.set("offset", String(opts.offset));
  const qs = q.toString();
  return orchardJson(authJwt, orchardCode, "GET", `/ai/conversations${qs ? `?${qs}` : ""}`);
}

export function searchConversations(
  authJwt: string,
  orchardCode: string,
  query: string,
  limit = 15,
): Promise<unknown[]> {
  const q = new URLSearchParams({ q: query, limit: String(limit) });
  return orchardJson(authJwt, orchardCode, "GET", `/ai/conversations/search?${q.toString()}`);
}

export function getConversation(
  authJwt: string,
  orchardCode: string,
  id: string,
): Promise<unknown> {
  return orchardJson(authJwt, orchardCode, "GET", `/ai/conversations/${encodeURIComponent(id)}`);
}

export function createConversation(
  authJwt: string,
  orchardCode: string,
  body: {
    block_id: number | null;
    block_name: string;
    agent_mode: string;
    fast_mode: boolean;
    general_mode: boolean;
  },
): Promise<{ conversation_id: string }> {
  return orchardJson(authJwt, orchardCode, "POST", "/ai/conversations", body);
}

export function renameConversation(
  authJwt: string,
  orchardCode: string,
  id: string,
  title: string,
): Promise<{ id: string; title: string }> {
  return orchardJson(authJwt, orchardCode, "PATCH", `/ai/conversations/${encodeURIComponent(id)}`, {
    title,
  });
}

export function deleteConversation(
  authJwt: string,
  orchardCode: string,
  id: string,
): Promise<{ deleted: boolean }> {
  return orchardJson(authJwt, orchardCode, "DELETE", `/ai/conversations/${encodeURIComponent(id)}`);
}

/**
 * Build the turn-0 context (multipart) and return its `session_id`. We send only
 * the fields the messenger drives; everything else uses the backend defaults.
 */
export async function prepareContext(
  authJwt: string,
  orchardCode: string,
  fields: {
    block_info?: { block_name: string; block_id?: number | undefined } | null | undefined;
    scan_ids?: number[] | null | undefined;
    conversation_id?: string | undefined;
    agent_mode?: string | undefined;
    fast_mode?: boolean | undefined;
    general_mode?: boolean | undefined;
    is_imperial?: boolean | undefined;
  },
): Promise<FsPrepareContextResult> {
  const jar = await switchOrchard(authJwt, orchardCode);
  const form = new FormData();
  if (fields.block_info) form.set("block_info", JSON.stringify(fields.block_info));
  if (fields.scan_ids && fields.scan_ids.length) form.set("scan_ids", JSON.stringify(fields.scan_ids));
  if (fields.conversation_id) form.set("conversation_id", fields.conversation_id);
  if (fields.agent_mode) form.set("agent_mode", fields.agent_mode);
  form.set("fast_mode", String(fields.fast_mode ?? false));
  form.set("general_mode", String(fields.general_mode ?? false));
  form.set("is_imperial", String(fields.is_imperial ?? true));

  const res = await fetch(url("/ai/prepare-context"), {
    method: "POST",
    headers: { Cookie: cookieHeader(authJwt, jar) },
    body: form,
  });
  if (!res.ok) throw new FruitscopeApiError(res.status, await errorMessage(res));
  return (await res.json()) as FsPrepareContextResult;
}

/**
 * Start a chat turn. Returns the raw streaming `Response` (Vercel-AI-SDK SSE) so
 * the route can pipe it straight to our client unchanged — the browser's useChat
 * parses the protocol natively.
 */
export async function chat(
  authJwt: string,
  orchardCode: string,
  body: unknown,
): Promise<Response> {
  const jar = await switchOrchard(authJwt, orchardCode);
  const res = await fetch(url("/ai/chat"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Cookie: cookieHeader(authJwt, jar),
    },
    body: JSON.stringify(body),
  });
  // Surface non-stream errors (e.g. 429 budget) before the route starts piping.
  if (!res.ok) throw new FruitscopeApiError(res.status, await errorMessage(res));
  return res;
}
