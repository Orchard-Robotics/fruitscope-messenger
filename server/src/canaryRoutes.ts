/**
 * Canary AI assistant — the messenger's own API surface.
 *
 * The browser only ever talks to these `/api/canary/*` routes; they proxy the
 * FruitScope API server-side, acting as the signed-in user via their stored
 * `session_jwt` (see fruitscope.ts). The token never leaves the server.
 *
 * Every orchard-scoped route takes the orchard CODE in the path (`/o/:orchard/…`);
 * access is enforced upstream by `/switch-orchard` (403 if the user lacks it).
 */

import { Readable } from "node:stream";

import type { Request, Response as ExpressResponse } from "express";
import { Router } from "express";
import { z } from "zod";

import type { AuthedRequest } from "./auth";
import { requireAuth } from "./auth";
import * as fs from "./fruitscope";
import { users } from "./store";

export const canary: Router = Router();

canary.use(requireAuth);

/** The authenticated user id (requireAuth has run, so `scope` is present). */
const userIdOf = (req: Request): string => (req as unknown as AuthedRequest).scope.userId;

// Trace every Canary request (method, path, user) so the whole flow is visible
// in the logs — paired with the per-call `[canary→fs]` lines from fruitscope.ts.
canary.use((req, _res, next) => {
  console.log(`[canary] ${req.method} ${req.originalUrl} user=${userIdOf(req)}`);
  next();
});

/** Resolve the caller's FruitScope token, or send a 409 telling them to reconnect. */
async function tokenOr409(req: Request, res: ExpressResponse): Promise<string | null> {
  const jwt = await users.fruitscopeAuthJwt(userIdOf(req));
  if (!jwt) {
    res.status(409).json({
      error: "Your FruitScope session has expired — sign out and sign in again to use Canary.",
      code: "reconnect",
    });
    return null;
  }
  return jwt;
}

/** Map an upstream FruitScope error onto our response (preserving the status). */
function sendUpstreamError(res: ExpressResponse, err: unknown): void {
  if (err instanceof fs.FruitscopeApiError) {
    // 401/403 from upstream → the user can't act there; surface as-is. Collapse
    // 5xx to 502 (it's the upstream that failed, not this request).
    const status = err.status >= 500 ? 502 : err.status;
    console.warn(`[canary] → ${status}: ${err.message}`);
    res.status(status).json({ error: err.message });
    return;
  }
  console.error("[canary] proxy error:", err);
  res.status(502).json({ error: "Canary is unavailable right now. Try again in a moment." });
}

const orchardParam = z.string().min(1).max(64);

/* ------------------------------------------------------------------ */
/* Orchards + blocks (the context pickers)                             */
/* ------------------------------------------------------------------ */

/**
 * Orchards the signed-in user may use Canary in (code + display name) — sourced
 * straight from FruitScope's `/user-info`, NOT the messenger DB (the messenger
 * only knows orchards people have signed into, so it would be incomplete).
 * FruitScope returns EVERY orchard here for admins / super admins.
 */
canary.get("/orchards", async (req, res) => {
  const jwt = await tokenOr409(req, res);
  if (!jwt) return;
  const userId = userIdOf(req);
  try {
    const info = await fs.getUserInfo(jwt);
    const orchards = (info.accessible_orchards ?? []).map((o) => ({
      code: o.orchard_code,
      name: o.orchard_name || o.orchard_code,
    }));
    // Refresh the fallback cache (best-effort) for the next time FruitScope is down.
    await users.setFruitscopeOrchards(userId, orchards).catch(() => {});
    console.log(`[canary] user=${userId} orchards=${orchards.length}${info.is_admin ? " (admin: all)" : ""}`);
    res.json({ orchards });
  } catch (err) {
    // FruitScope unreachable (network / 5xx) → serve the cached list so the
    // picker still works. Auth failures (401/403) are NOT papered over with a
    // stale cache — those need a real reconnect, surfaced as-is.
    if (err instanceof fs.FruitscopeApiError && err.status >= 500) {
      const cached = await users.fruitscopeOrchards(userId).catch(() => null);
      if (cached && cached.length) {
        console.warn(`[canary] user=${userId} /user-info down (${err.status}); serving ${cached.length} cached orchards`);
        res.json({ orchards: cached });
        return;
      }
    }
    sendUpstreamError(res, err);
  }
});

/** Blocks (with recent scans) in an orchard — for the block picker. */
canary.get("/o/:orchard/blocks", async (req, res) => {
  const orchard = orchardParam.safeParse(req.params.orchard);
  if (!orchard.success) {
    res.status(400).json({ error: "Invalid orchard" });
    return;
  }
  const jwt = await tokenOr409(req, res);
  if (!jwt) return;
  try {
    const blocks = await fs.getBlocks(jwt, orchard.data);
    res.json({
      blocks: blocks.map((b) => ({
        blockId: b.block_id,
        blockName: b.block_name,
        ranchName: b.ranch_name ?? null,
        variety: b.block_variety ?? null,
        lastScanDate: b.last_scan_date ?? null,
        scans: (b.scans ?? []).map((s) => ({
          scanId: s.scan_id,
          scanName: s.scan_name,
          timestamp: s.timestamp,
          stage: s.stage_type ?? null,
        })),
      })),
    });
  } catch (err) {
    sendUpstreamError(res, err);
  }
});

/* ------------------------------------------------------------------ */
/* Conversation history                                                */
/* ------------------------------------------------------------------ */

canary.get("/o/:orchard/conversations", async (req, res) => {
  const orchard = orchardParam.safeParse(req.params.orchard);
  if (!orchard.success) {
    res.status(400).json({ error: "Invalid orchard" });
    return;
  }
  const jwt = await tokenOr409(req, res);
  if (!jwt) return;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;
  try {
    res.json({ conversations: await fs.listConversations(jwt, orchard.data, { limit, offset }) });
  } catch (err) {
    sendUpstreamError(res, err);
  }
});

canary.get("/o/:orchard/conversations/search", async (req, res) => {
  const orchard = orchardParam.safeParse(req.params.orchard);
  if (!orchard.success) {
    res.status(400).json({ error: "Invalid orchard" });
    return;
  }
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }
  const jwt = await tokenOr409(req, res);
  if (!jwt) return;
  try {
    res.json({ results: await fs.searchConversations(jwt, orchard.data, q) });
  } catch (err) {
    sendUpstreamError(res, err);
  }
});

canary.get("/o/:orchard/conversations/:id", async (req, res) => {
  const orchard = orchardParam.safeParse(req.params.orchard);
  if (!orchard.success) {
    res.status(400).json({ error: "Invalid orchard" });
    return;
  }
  const jwt = await tokenOr409(req, res);
  if (!jwt) return;
  try {
    res.json(await fs.getConversation(jwt, orchard.data, req.params.id));
  } catch (err) {
    sendUpstreamError(res, err);
  }
});

const createSchema = z.object({
  block_id: z.number().int().nullable().default(null),
  block_name: z.string().default(""),
  agent_mode: z.enum(["analytical", "ai_farmer"]).default("analytical"),
  fast_mode: z.boolean().default(false),
  general_mode: z.boolean().default(false),
});

canary.post("/o/:orchard/conversations", async (req, res) => {
  const orchard = orchardParam.safeParse(req.params.orchard);
  const body = createSchema.safeParse(req.body ?? {});
  if (!orchard.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const jwt = await tokenOr409(req, res);
  if (!jwt) return;
  try {
    res.json(await fs.createConversation(jwt, orchard.data, body.data));
  } catch (err) {
    sendUpstreamError(res, err);
  }
});

const renameSchema = z.object({ title: z.string().trim().min(1).max(255) });

canary.patch("/o/:orchard/conversations/:id", async (req, res) => {
  const orchard = orchardParam.safeParse(req.params.orchard);
  const body = renameSchema.safeParse(req.body ?? {});
  if (!orchard.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const jwt = await tokenOr409(req, res);
  if (!jwt) return;
  try {
    res.json(await fs.renameConversation(jwt, orchard.data, req.params.id, body.data.title));
  } catch (err) {
    sendUpstreamError(res, err);
  }
});

canary.delete("/o/:orchard/conversations/:id", async (req, res) => {
  const orchard = orchardParam.safeParse(req.params.orchard);
  if (!orchard.success) {
    res.status(400).json({ error: "Invalid orchard" });
    return;
  }
  const jwt = await tokenOr409(req, res);
  if (!jwt) return;
  try {
    res.json(await fs.deleteConversation(jwt, orchard.data, req.params.id));
  } catch (err) {
    sendUpstreamError(res, err);
  }
});

/* ------------------------------------------------------------------ */
/* Turn-0 context + streaming chat                                     */
/* ------------------------------------------------------------------ */

const prepareSchema = z.object({
  block_info: z.object({ block_name: z.string(), block_id: z.number().int().optional() }).nullish(),
  scan_ids: z.array(z.number().int()).nullish(),
  conversation_id: z.string().optional(),
  agent_mode: z.string().optional(),
  fast_mode: z.boolean().optional(),
  general_mode: z.boolean().optional(),
  is_imperial: z.boolean().optional(),
});

canary.post("/o/:orchard/prepare-context", async (req, res) => {
  const orchard = orchardParam.safeParse(req.params.orchard);
  const body = prepareSchema.safeParse(req.body ?? {});
  if (!orchard.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const jwt = await tokenOr409(req, res);
  if (!jwt) return;
  try {
    res.json(await fs.prepareContext(jwt, orchard.data, body.data));
  } catch (err) {
    sendUpstreamError(res, err);
  }
});

/**
 * Streaming chat. The browser's `useChat` POSTs the UIMessage payload (plus the
 * `session_id`/`conversation_id`/`current_view` it's carrying); we forward it and
 * pipe the FruitScope SSE straight back, preserving the AI-SDK stream protocol.
 */
canary.post("/o/:orchard/chat", async (req, res) => {
  const orchard = orchardParam.safeParse(req.params.orchard);
  if (!orchard.success) {
    res.status(400).json({ error: "Invalid orchard" });
    return;
  }
  const jwt = await tokenOr409(req, res);
  if (!jwt) return;

  let upstream: Awaited<ReturnType<typeof fs.chat>>;
  try {
    upstream = await fs.chat(jwt, orchard.data, req.body);
  } catch (err) {
    sendUpstreamError(res, err);
    return;
  }

  if (!upstream.body) {
    res.status(502).json({ error: "Canary returned an empty stream." });
    return;
  }

  // Mirror the upstream SSE headers so the client's AI-SDK transport recognises
  // the stream, and disable proxy buffering so deltas arrive live.
  res.status(upstream.status);
  res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "text/event-stream");
  const streamProto = upstream.headers.get("x-vercel-ai-ui-message-stream");
  if (streamProto) res.setHeader("x-vercel-ai-ui-message-stream", streamProto);
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
  // If the browser hangs up, stop pulling from FruitScope.
  res.on("close", () => nodeStream.destroy());
  nodeStream.on("error", () => {
    if (!res.writableEnded) res.end();
  });
  nodeStream.pipe(res);
});
