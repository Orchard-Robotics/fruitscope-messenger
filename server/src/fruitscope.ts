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
export function jwtPrimaryOrchard(jwt: string): string | null {
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
  canary_mode?: number;
  [k: string]: unknown;
}

/** Per-block grower context (season goals + management plan) for prepare-context. */
export interface FsBlockInfo {
  season_goals?: string | null;
  management_plan?: string | null;
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

/** One block from `/util/get_block_scan_map` (the values of its `blocks` dict). */
export interface FsBlock {
  block_id: number;
  block_name: string;
  center_lat?: number | null;
  center_lon?: number | null;
  last_scan_timestamp?: string | null;
  last_scan_type?: string | null;
  last_scan_id?: number | null;
  block_variety?: string | null;
  fruit_type?: string | null;
  acreage?: number | null;
  ranches?: Record<string, number> | null;
}

interface FsBlockScanMap {
  blocks?: Record<string, FsBlock>;
  ranches?: { ranch_id: number; name: string }[];
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

/**
 * Blocks in an orchard — for the block picker/map. `get_block_scan_map` returns
 * `{ blocks: { "<name>": {...} }, ranches: [...] }` (a dict keyed by block name),
 * so flatten it to an array.
 */
export async function getBlocks(authJwt: string, orchardCode: string): Promise<FsBlock[]> {
  const data = await orchardJson<FsBlockScanMap>(authJwt, orchardCode, "GET", "/util/get_block_scan_map");
  const blocks = data?.blocks;
  return blocks && typeof blocks === "object" ? Object.values(blocks) : [];
}

/**
 * Block boundary polygons for the map selector — a GeoJSON FeatureCollection of
 * MultiPolygons (properties: block_id, block_name, center_lat/lon). Returned
 * verbatim for the client to hand to MapLibre.
 */
export async function getBlockBoundaries(
  authJwt: string,
  orchardCode: string,
): Promise<Record<string, unknown>> {
  return orchardJson<Record<string, unknown>>(authJwt, orchardCode, "GET", "/geojson/points_block");
}

/** One scan from `/util/block_timeline` (newest-first). */
export interface FsScan {
  scan_id: number;
  scan_name: string;
  time: string;
  entity_type?: string | null;
  stage_type?: string | null;
  variety_type?: string | null;
  rows_scanned?: number | null;
  total_trees?: number | null;
}

/**
 * A block's scan timeline. NOTE the FruitScope quirk: `/util/block_timeline`'s
 * `block_id` query param is actually matched against `Block.block_name`, so we
 * pass the block NAME here, not the numeric id. Returns a plain array.
 */
export function getBlockTimeline(
  authJwt: string,
  orchardCode: string,
  blockName: string,
): Promise<FsScan[]> {
  return orchardJson<FsScan[]>(
    authJwt,
    orchardCode,
    "GET",
    `/util/block_timeline?block_id=${encodeURIComponent(blockName)}`,
  );
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

/** A block's grower context (goals / management plan) — used to enrich turn 0. */
export function getBlockInfo(
  authJwt: string,
  orchardCode: string,
  blockName: string,
): Promise<FsBlockInfo> {
  return orchardJson<FsBlockInfo>(
    authJwt,
    orchardCode,
    "GET",
    `/util/get_block_info?block_name=${encodeURIComponent(blockName)}`,
  );
}

/**
 * Build the turn-0 context (multipart) and return its `session_id`. Mirrors the
 * FruitScope web app's prepare-context payload so Canary gets the SAME grounding
 * (rich block_info, goals/management plan, home_chat + canary_mode tooling).
 */
export async function prepareContext(
  authJwt: string,
  orchardCode: string,
  fields: {
    block_info?: Record<string, unknown> | null | undefined;
    scan_ids?: number[] | null | undefined;
    conversation_id?: string | undefined;
    general_mode?: boolean | undefined;
    fast_mode?: boolean | undefined;
    is_imperial?: boolean | undefined;
    canary_mode?: number | undefined;
    goals?: string | null | undefined;
    management_plan?: string | null | undefined;
  },
): Promise<FsPrepareContextResult> {
  const jar = await switchOrchard(authJwt, orchardCode);
  const form = new FormData();
  form.set("block_info", JSON.stringify(fields.block_info ?? {}));
  form.set("canary_mode", String(fields.canary_mode ?? 5));
  form.set("clarifying_qa", "[]");
  form.set("provider", "gemini");
  // Mark as an AI-native homepage chat — the backend hands structured tasks
  // (yield, charts, PDF) to the farm assistant when not in general mode.
  form.set("home_chat", "true");
  form.set("fast_mode", String(fields.fast_mode ?? false));
  form.set("general_mode", String(fields.general_mode ?? false));
  form.set("is_imperial", String(fields.is_imperial ?? true));
  if (fields.scan_ids && fields.scan_ids.length) form.set("scan_ids", JSON.stringify(fields.scan_ids));
  if (fields.conversation_id) form.set("conversation_id", fields.conversation_id);
  if (fields.goals) form.set("goals", fields.goals);
  if (fields.management_plan) form.set("management_plan", fields.management_plan);

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

/** A collected Canary turn: the user-facing answer and the model's hidden
 *  "thinking" (reasoning + status commentary), kept separate so the channel
 *  agent can post a clean reply and stash the thinking for admins only. */
export interface CollectedChat {
  answer: string;
  /** Reasoning + status commentary, or empty if the model emitted none. */
  reasoning: string;
}

// Zero-width space (U+200B): FruitScope prefixes the model's running status
// commentary text blocks with it, marking them as "thinking", not answer.
const ZW = 0x200b;

/**
 * Like `chat()`, but consumes the SSE stream server-side and returns the
 * assembled answer + thinking — for the in-channel Canary agent, which posts a
 * normal chat message instead of streaming to a browser.
 *
 * Text streams as blocks keyed by id (text-start/-delta/-end). The status
 * commentary arrives as separate text blocks whose first char is U+200B, and
 * the chain-of-thought as `reasoning-delta` frames. The un-prefixed text blocks
 * are the actual answer; everything else is "thinking" — mirrors the browser's
 * CanaryMessage rendering.
 */
export async function chatCollect(
  authJwt: string,
  orchardCode: string,
  body: unknown,
): Promise<CollectedChat> {
  const res = await chat(authJwt, orchardCode, body);
  if (!res.body) return { answer: "", reasoning: "" };
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const textBlocks = new Map<string, string>(); // text-delta, keyed by block id
  const reasonBlocks = new Map<string, string>(); // reasoning-delta, keyed by id
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 2);
      for (const line of frame.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const obj = JSON.parse(payload) as { type?: string; id?: string; delta?: string };
          if (typeof obj.delta !== "string") continue;
          const id = obj.id ?? "";
          if (obj.type === "text-delta") textBlocks.set(id, (textBlocks.get(id) ?? "") + obj.delta);
          else if (obj.type === "reasoning-delta")
            reasonBlocks.set(id, (reasonBlocks.get(id) ?? "") + obj.delta);
        } catch {
          /* ignore non-JSON frames */
        }
      }
    }
  }

  const all = [...textBlocks.values()];
  const zw = String.fromCharCode(ZW);
  // Answer = un-prefixed text blocks. Thinking = reasoning + the U+200B status
  // blocks (with the marker stripped for readability).
  const answer = all
    .filter((t) => t.charCodeAt(0) !== ZW)
    .join("\n\n")
    .trim();
  const statusLines = all
    .filter((t) => t.charCodeAt(0) === ZW)
    .map((t) => t.split(zw).join("").trim())
    .filter(Boolean);
  const reasoning = [...reasonBlocks.values(), ...statusLines]
    .map((t) => t.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return { answer, reasoning };
}

/* ------------------------------------------------------------------ */
/* User-management sync — list orchards + their users (admin only)     */
/*                                                                     */
/* Powers the admin "sync users from FruitScope" action. We act AS the */
/* signed-in admin via their auth_jwt cookie. These /user-management/* */
/* endpoints take the orchard as a query param (no switch-first), and  */
/* serialize snake_case (by_alias=False) — mirrors farmagent's client. */
/* ------------------------------------------------------------------ */

/** A FruitScope orchard the acting admin can see. */
export interface FsSyncOrchard {
  code: string;
  name: string | null;
  accountTier: string | null;
}

/** A FruitScope user with access to an orchard, plus their permission level. */
export interface FsSyncUser {
  /** Integer FruitScope user id — the SAME value that becomes the OIDC `sub`. */
  userId: number;
  email: string | null;
  name: string | null;
  /** "admin" | "owner" | "orchard" | "block" | "ranch" | "none". */
  permissionLevel: string;
}

export interface FsOrchardUsers {
  orchardCode: string;
  orchardName: string | null;
  users: FsSyncUser[];
}

/**
 * GET a /user-management endpoint as the acting admin (auth_jwt cookie only).
 * A 401/403 — or any redirect, which means an unauthenticated bounce to /login —
 * is surfaced as FruitscopeApiError(401) so the caller can prompt a re-login.
 */
async function syncGet(authJwt: string, path: string): Promise<unknown> {
  const tag = `[sync→fs] GET ${path}`;
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url(path), {
      headers: { Cookie: cookieHeader(authJwt), Accept: "application/json" },
      redirect: "manual", // a 3xx to /login means the token was rejected
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`${tag} → NETWORK_ERROR ${Date.now() - t0}ms: ${msg}`);
    throw new FruitscopeApiError(502, `Couldn't reach FruitScope (${msg}).`);
  }
  const ms = Date.now() - t0;
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    console.warn(`${tag} → ${res.status} ${ms}ms (auth)`);
    await res.body?.cancel().catch(() => {});
    throw new FruitscopeApiError(401, "FruitScope rejected the request — sign in again.");
  }
  if (!res.ok) {
    const detail = await errorMessage(res);
    console.warn(`${tag} → ${res.status} ${ms}ms: ${detail}`);
    throw new FruitscopeApiError(res.status, detail);
  }
  console.log(`${tag} → ${res.status} ${ms}ms`);
  return res.json();
}

/** Build a display name from a FruitScope user's name parts. */
function fsDisplayName(u: {
  first_name?: string | null;
  last_name?: string | null;
  user_name?: string | null;
}): string | null {
  const full = [u.first_name, u.last_name]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(" ")
    .trim();
  return full || (u.user_name?.trim() || null);
}

/** Orchards the acting admin can see (every orchard, for a super admin). */
export async function listAccessibleOrchards(authJwt: string): Promise<FsSyncOrchard[]> {
  const data = (await syncGet(authJwt, "/user-management/accessible-orchards")) as {
    orchards?: { orchard_code?: string; orchard_name?: string | null; account_tier?: string | null }[];
  };
  return (data.orchards ?? [])
    .filter((o): o is { orchard_code: string } & typeof o => typeof o.orchard_code === "string")
    .map((o) => ({
      code: o.orchard_code,
      name: o.orchard_name?.trim() || null,
      accountTier: o.account_tier ?? null,
    }));
}

/** Every user with access to `orchardCode`, with their permission level. */
export async function listOrchardUsers(authJwt: string, orchardCode: string): Promise<FsOrchardUsers> {
  const data = (await syncGet(
    authJwt,
    `/user-management/orchard-users?orchard_code=${encodeURIComponent(orchardCode)}`,
  )) as {
    orchard_code?: string;
    orchard_name?: string | null;
    users?: {
      user_id?: number;
      email?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      user_name?: string | null;
      permission_level?: string | null;
    }[];
  };
  return {
    orchardCode: data.orchard_code ?? orchardCode,
    orchardName: data.orchard_name?.trim() || null,
    users: (data.users ?? [])
      .filter((u): u is { user_id: number } & typeof u => typeof u.user_id === "number")
      .map((u) => ({
        userId: u.user_id,
        email: u.email?.trim() || null,
        name: fsDisplayName(u),
        permissionLevel: (u.permission_level ?? "none").toLowerCase(),
      })),
  };
}
