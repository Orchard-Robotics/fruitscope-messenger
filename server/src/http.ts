import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { nanoid } from "nanoid";
import { z } from "zod";

import type { Orchard } from "@shared/index";
import type { AuthedRequest } from "./auth";
import {
  clearSessionMasquerade,
  createSession,
  deleteSession,
  requireAuth,
  sessionCookieOptions,
  setSessionMasquerade,
  tokenFromRequest,
} from "./auth";
import {
  allowDevLogin,
  APP_URL,
  isProd,
  OIDC_TX_COOKIE,
  oidcConfigured,
  SESSION_COOKIE,
  superAdminOrchard,
} from "./env";
import type { FruitscopeIdentity } from "./oidc";
import { beginLogin, completeLogin, decodeTx, encodeTx } from "./oidc";
import { broadcastUserUpdate, resumePendingCanary } from "./socket";
import { canaryCodeTools } from "./canaryCodeTools";
import { FruitscopeApiError } from "./fruitscope";
import { DEFAULT_MODEL_ID, isKnownModelId, modelCatalog } from "./llm";
import { redactMessages } from "./messageEmit";
import { bootstrap, bots, channels, mentions, messages, orchards, users } from "./store";
import { listSyncOrchards, previewOrchard, syncOrchard } from "./sync";
import { deleteObject, uploadObject } from "./storage";

export const api: Router = Router();

/** Raised when a (non-admin) user's claim carries no orchard to land them in. */
class NoOrchardError extends Error {}

/**
 * Provision the local user + landing orchard from a verified FruitScope identity
 * and open a session scoped to that orchard.
 *
 * - Super admins always land on the orchard-robotics namespace (and can switch).
 * - Everyone else lands on their `primary_orchard` (falling back to the first
 *   orchard they have permissions on). The orchard is created if it's new.
 */
async function provisionSession(
  identity: FruitscopeIdentity,
): Promise<{ token: string; orchard: Orchard; userId: string }> {
  const user = await users.upsertFromOidc(identity);

  let orchard: Orchard;
  if (identity.isSuperAdmin) {
    orchard = await orchards.upsertByCode(superAdminOrchard.code, superAdminOrchard.name);
  } else {
    const primary = identity.primaryOrchard;
    const code = primary?.code ?? identity.orchardCodes[0];
    if (!code) throw new NoOrchardError();
    orchard = await orchards.upsertByCode(code, primary?.name ?? code);
  }

  await orchards.ensureMembership(orchard.id, user.id);
  const token = await createSession(user.id, orchard.id);
  return { token, orchard, userId: user.id };
}

/** A tiny page that a silent (iframe) re-auth returns, telling the parent app
 *  whether the refresh succeeded so it can continue or fall back to a button. */
function reauthResultPage(ok: boolean): string {
  return (
    `<!doctype html><meta charset="utf-8"><title>…</title><script>` +
    `try{window.parent.postMessage({type:"fruitscope-reauth",ok:${ok ? "true" : "false"}},${JSON.stringify(APP_URL)});}catch(e){}` +
    `</script>`
  );
}

/* ------------------------------------------------------------------ */
/* OIDC — "Sign in with FruitScope"                                    */
/* ------------------------------------------------------------------ */

const TX_COOKIE_MAX_AGE_MS = 10 * 60 * 1000; // an in-flight login is short-lived

/** Kick off the authorization-code + PKCE flow: redirect to the IdP. `?silent=1`
 *  does a prompt=none refresh in a hidden iframe (answered via postMessage). */
api.get("/auth/login", async (req, res) => {
  const silent = req.query.silent === "1";
  if (!oidcConfigured) {
    if (silent) res.send(reauthResultPage(false));
    else res.redirect(`${APP_URL}/?login_error=unconfigured`);
    return;
  }
  try {
    const { url, tx } = await beginLogin({ silent });
    res.cookie(OIDC_TX_COOKIE, encodeTx(tx), {
      httpOnly: true,
      // A silent login runs in an iframe: the IdP→callback redirect is a framed
      // cross-site navigation, so the tx cookie needs SameSite=None (+ Secure) to
      // ride along. The tx is signed + state/nonce-checked, so this is safe.
      secure: isProd || silent,
      sameSite: silent ? "none" : "lax",
      path: "/",
      maxAge: TX_COOKIE_MAX_AGE_MS,
    });
    res.redirect(url);
  } catch (err) {
    console.error("[oidc] login init failed:", err);
    if (silent) res.send(reauthResultPage(false));
    else res.redirect(`${APP_URL}/?login_error=unavailable`);
  }
});

/** OIDC redirect target: verify, provision, open a session, land on the app. */
api.get("/auth/callback", async (req, res) => {
  const tx = decodeTx((req.cookies as Record<string, string> | undefined)?.[OIDC_TX_COOKIE]);
  res.clearCookie(OIDC_TX_COOKIE, { path: "/" });

  if (!tx) {
    res.redirect(`${APP_URL}/?login_error=expired`);
    return;
  }

  try {
    const identity = await completeLogin(req.originalUrl, tx);
    const { token, userId } = await provisionSession(identity);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    // The token refresh lives on the user row, so any re-login resumes Canary.
    await resumePendingCanary(userId);
    if (tx.silent) {
      res.send(reauthResultPage(true));
      return;
    }
    res.redirect(`${APP_URL}/`);
  } catch (err) {
    console.error("[oidc] callback failed:", err);
    if (tx.silent) {
      res.send(reauthResultPage(false)); // e.g. prompt=none needs interaction
      return;
    }
    const code = err instanceof NoOrchardError ? "no_orchard" : "auth_failed";
    res.redirect(`${APP_URL}/?login_error=${code}`);
  }
});

/** Clear the local session. (The IdP SSO session is left intact.) */
api.post("/auth/logout", async (req, res) => {
  const token = tokenFromRequest(req);
  if (token) await deleteSession(token);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

/**
 * Local-dev only (ALLOW_DEV_LOGIN): forge a session without the real IdP, so the
 * UI + orchard switcher can be exercised offline. Never mounted in production.
 */
if (allowDevLogin) {
  const devSchema = z.object({
    sub: z.string().min(1),
    displayName: z.string().optional(),
    username: z.string().optional(),
    email: z.string().optional(),
    isSuperAdmin: z.boolean().optional(),
    orchardCode: z.string().optional(),
    orchardName: z.string().optional(),
    // Optional: paste a real FruitScope `session_jwt` to exercise Canary against
    // a live backend without the full OIDC round-trip. Dev-only.
    authJwt: z.string().optional(),
  });

  api.post("/auth/dev-login", async (req, res) => {
    const parsed = devSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid dev login" });
      return;
    }
    const d = parsed.data;
    const identity: FruitscopeIdentity = {
      sub: d.sub,
      displayName: d.displayName,
      preferredUsername: d.username,
      email: d.email,
      isSuperAdmin: d.isSuperAdmin ?? false,
      primaryOrchard: d.orchardCode
        ? { code: d.orchardCode, name: d.orchardName ?? d.orchardCode }
        : undefined,
      orchardCodes: d.orchardCode ? [d.orchardCode] : [],
      authJwt: d.authJwt,
      authJwtTtlSeconds: undefined,
    };
    try {
      const { token, orchard } = await provisionSession(identity);
      res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
      res.json({ ok: true, orchard });
    } catch (err) {
      res.status(400).json({ error: err instanceof NoOrchardError ? "no_orchard" : "failed" });
    }
  });
}

/* ------------------------------------------------------------------ */
/* Session-scoped resources                                            */
/* ------------------------------------------------------------------ */

api.get("/me", requireAuth, async (req, res) => {
  const user = await users.byId((req as AuthedRequest).scope.userId);
  if (!user) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(user);
});

/* ------------------------------------------------------------------ */
/* Profile picture                                                     */
/* Server-side upload: validate → normalize (square 512 webp, EXIF     */
/* stripped) → store in GCS. Clients then read it straight from the    */
/* CDN/emulator (never through this backend).                          */
/* ------------------------------------------------------------------ */

const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const uploadAvatarFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES },
}).single("file");

api.post("/me/avatar", requireAuth, (req, res) => {
  uploadAvatarFile(req, res, async (err: unknown) => {
    if (err) {
      const tooBig = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE";
      res.status(400).json({ error: tooBig ? "Image too large (max 8MB)" : "Upload failed" });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No image provided" });
      return;
    }
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      res.status(400).json({ error: "Unsupported image type (use JPEG, PNG, WebP or GIF)" });
      return;
    }

    // Normalize: honor EXIF orientation, square-crop, cap at 512px, re-encode to
    // WebP. Re-encoding also strips metadata (incl. location) and any payload
    // hidden in a non-image upload — sharp throws on anything that isn't an image.
    let webp: Buffer;
    try {
      webp = await sharp(file.buffer)
        .rotate()
        .resize(512, 512, { fit: "cover", position: "centre" })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      res.status(400).json({ error: "That file isn't a valid image" });
      return;
    }

    const { userId } = (req as AuthedRequest).scope;
    // Unique key per upload → the URL changes on every change, so the immutable
    // CDN cache never serves a stale picture.
    const key = `avatars/${userId}-${nanoid(8)}.webp`;
    try {
      await uploadObject(key, webp, "image/webp");
    } catch (uploadErr) {
      console.error("[avatar] upload failed:", uploadErr);
      res.status(502).json({ error: "Couldn't store the image, try again" });
      return;
    }

    const prevKey = await users.avatarKey(userId);
    const user = await users.setAvatarKey(userId, key);
    // Drop the previous object (best-effort; a leak here is harmless).
    if (prevKey && prevKey !== key) await deleteObject(prevKey).catch(() => {});

    void broadcastUserUpdate(user); // live avatar update for everyone in-orchard
    res.json(user);
  });
});

api.delete("/me/avatar", requireAuth, async (req, res) => {
  const { userId } = (req as AuthedRequest).scope;
  const prevKey = await users.avatarKey(userId);
  const user = await users.setAvatarKey(userId, null);
  if (prevKey) await deleteObject(prevKey).catch(() => {});
  void broadcastUserUpdate(user);
  res.json(user);
});

api.get("/bootstrap", requireAuth, async (req, res) => {
  const scope = (req as AuthedRequest).scope;
  const data = await bootstrap(scope.userId, scope.orchardId);
  // The bootstrap above is the EFFECTIVE (masqueraded) user's view; flag it so
  // the client can show the "viewing as" banner with the real admin's name.
  if (scope.masquerading) {
    data.masquerade = { realName: (await users.displayName(scope.realUserId)) ?? "Admin" };
  }
  res.json(data);
});

/* ------------------------------------------------------------------ */
/* Admin — user management + masquerade ("view as another user")        */
/* All gated on the REAL signed-in user being a super admin, so they    */
/* still work while masquerading (to switch target or exit).            */
/* ------------------------------------------------------------------ */

async function requireRealAdmin(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
): Promise<void> {
  const scope = (req as AuthedRequest).scope;
  if (!(await users.isSuperAdmin(scope.realUserId))) {
    res.status(403).json({ error: "Admins only" });
    return;
  }
  next();
}

/** Every real user + their orchards/roles — for the User Management page. */
api.get("/admin/users", requireAuth, requireRealAdmin, async (_req, res) => {
  res.json({ users: await users.allForAdmin() });
});

const masqueradeSchema = z.object({ userId: z.string().min(1) });

/** Start masquerading as another user (their orchard, identity, permissions). */
api.post("/admin/masquerade", requireAuth, requireRealAdmin, async (req, res) => {
  const parsed = masqueradeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const scope = (req as AuthedRequest).scope;
  const targetId = parsed.data.userId;
  if (targetId === scope.realUserId) {
    res.status(400).json({ error: "You can't masquerade as yourself" });
    return;
  }
  const target = await users.byId(targetId);
  if (!target || target.isBot) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  // You can't masquerade as another admin (no peeking at admin contexts).
  if (await users.isSuperAdmin(targetId)) {
    res.status(403).json({ error: "You can't masquerade as another admin" });
    return;
  }
  // Act in the target's own orchard (their first membership).
  const [targetOrchard] = await orchards.forUser(targetId);
  if (!targetOrchard) {
    res.status(400).json({ error: "That user isn't in any orchard" });
    return;
  }
  await setSessionMasquerade(tokenFromRequest(req) as string, targetId, targetOrchard.id);
  res.json({ ok: true });
});

/** Stop masquerading — back to the admin's own identity. */
api.post("/admin/masquerade/stop", requireAuth, requireRealAdmin, async (req, res) => {
  await clearSessionMasquerade(tokenFromRequest(req) as string);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Admin — sync workspaces + users from FruitScope                     */
/* Acts as the REAL admin via their captured FruitScope session token.  */
/* ------------------------------------------------------------------ */

/** The real admin's FruitScope auth_jwt, or send 409 and return null. */
async function adminFruitscopeJwt(
  req: import("express").Request,
  res: import("express").Response,
): Promise<string | null> {
  const scope = (req as AuthedRequest).scope;
  const jwt = await users.fruitscopeAuthJwt(scope.realUserId);
  if (!jwt) {
    res.status(409).json({ error: "Reconnect FruitScope — sign out and sign in again." });
    return null;
  }
  return jwt;
}

/** Turn a FruitScope failure into a tidy HTTP response. */
function sendSyncError(res: import("express").Response, err: unknown): void {
  if (err instanceof FruitscopeApiError) {
    // 401 from upstream = the admin's token was rejected → ask them to re-login.
    const status = err.status === 401 ? 409 : err.status;
    res.status(status).json({ error: err.message });
    return;
  }
  console.error("[sync] failed:", err);
  res.status(500).json({ error: "Sync failed. Please try again." });
}

/** Orchards the admin can sync (from FruitScope), flagged if already a workspace. */
api.get("/admin/sync/orchards", requireAuth, requireRealAdmin, async (req, res) => {
  const jwt = await adminFruitscopeJwt(req, res);
  if (!jwt) return;
  try {
    res.json({ orchards: await listSyncOrchards(jwt) });
  } catch (err) {
    sendSyncError(res, err);
  }
});

/** Preview the users that syncing an orchard would provision (no writes). */
api.get("/admin/sync/orchards/:code/users", requireAuth, requireRealAdmin, async (req, res) => {
  const jwt = await adminFruitscopeJwt(req, res);
  if (!jwt) return;
  const code = req.params.code?.trim();
  if (!code) {
    res.status(400).json({ error: "Missing orchard code" });
    return;
  }
  try {
    res.json(await previewOrchard(jwt, code));
  } catch (err) {
    sendSyncError(res, err);
  }
});

const syncSchema = z.object({ orchardCode: z.string().min(1) });

/** Run the sync: create/refresh the workspace + its users. Returns a report. */
api.post("/admin/sync/orchard", requireAuth, requireRealAdmin, async (req, res) => {
  const jwt = await adminFruitscopeJwt(req, res);
  if (!jwt) return;
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing orchard code" });
    return;
  }
  try {
    res.json(await syncOrchard(jwt, parsed.data.orchardCode));
  } catch (err) {
    sendSyncError(res, err);
  }
});

/* ------------------------------------------------------------------ */
/* Admin — create workspaces + LLM bots                                 */
/* ------------------------------------------------------------------ */

/** Every workspace (for the bot-creation picker). */
api.get("/admin/workspaces", requireAuth, requireRealAdmin, async (_req, res) => {
  res.json({ workspaces: await orchards.all() });
});

const createWorkspaceSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
});

/** Create a workspace (orchard). Fails if the code is already taken. */
api.post("/admin/workspaces", requireAuth, requireRealAdmin, async (req, res) => {
  const parsed = createWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A code and a name are required." });
    return;
  }
  const code = parsed.data.code.toUpperCase();
  if (await orchards.byCode(code)) {
    res.status(409).json({ error: `A workspace with code "${code}" already exists.` });
    return;
  }
  const workspace = await orchards.upsertByCode(code, parsed.data.name);
  res.json({ workspace });
});

/** The catalog of every model that can back a bot (live from pi-ai). */
api.get("/admin/llm/models", requireAuth, requireRealAdmin, (_req, res) => {
  res.json({ catalog: modelCatalog(), defaultModelId: DEFAULT_MODEL_ID });
});

const createBotSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  orchardId: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().max(8000).optional(),
});

/** Create an LLM bot, run under the chosen model, placed in a workspace. */
api.post("/admin/bots", requireAuth, requireRealAdmin, async (req, res) => {
  const parsed = createBotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A name, workspace, and model are required." });
    return;
  }
  if (!isKnownModelId(parsed.data.model)) {
    res.status(400).json({ error: "That model isn't available." });
    return;
  }
  const orchard = await orchards.byId(parsed.data.orchardId);
  if (!orchard) {
    res.status(404).json({ error: "That workspace doesn't exist." });
    return;
  }
  const bot = await bots.create({
    displayName: parsed.data.displayName,
    orchardId: orchard.id,
    model: parsed.data.model,
    systemPrompt: parsed.data.systemPrompt ?? "",
  });
  await broadcastUserUpdate(bot); // surface the new bot to that workspace live
  res.json({ bot });
});

/** Every managed bot (for the admin Bots section). */
api.get("/admin/bots", requireAuth, requireRealAdmin, async (_req, res) => {
  res.json({ bots: await bots.all() });
});

const updateBotSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  model: z.string().min(1).optional(),
  systemPrompt: z.string().max(8000).optional(),
  orchardId: z.string().min(1).optional(),
});

/** Edit a bot: name, model, system prompt, and/or workspace. */
api.patch("/admin/bots/:id", requireAuth, requireRealAdmin, async (req, res) => {
  const parsed = updateBotSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }
  if (parsed.data.model && !isKnownModelId(parsed.data.model)) {
    res.status(400).json({ error: "That model isn't available." });
    return;
  }
  if (parsed.data.orchardId && !(await orchards.byId(parsed.data.orchardId))) {
    res.status(404).json({ error: "That workspace doesn't exist." });
    return;
  }
  const bot = await bots.update((req.params.id ?? ""), parsed.data);
  if (!bot) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }
  const updated = await users.byId(bot.id);
  if (updated) await broadcastUserUpdate(updated); // reflect a name change live
  res.json({ bot });
});

/** Permanently delete a bot and its messages. */
api.delete("/admin/bots/:id", requireAuth, requireRealAdmin, async (req, res) => {
  const ok = await bots.remove((req.params.id ?? ""));
  if (!ok) {
    res.status(404).json({ error: "Bot not found" });
    return;
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Admin — conversation monitor (read any channel across workspaces)    */
/* ------------------------------------------------------------------ */

/** Every conversation across all workspaces (newest activity first). */
api.get("/admin/conversations", requireAuth, requireRealAdmin, async (_req, res) => {
  res.json({ conversations: await channels.allForAdmin() });
});

/** Read a conversation's messages (admins can read any). Pages back via
 *  ?beforeAt=<ms>&beforeId=<id> (the oldest loaded cursor). */
api.get("/admin/conversations/:id/messages", requireAuth, requireRealAdmin, async (req, res) => {
  const channel = await channels.byId((req.params.id ?? ""));
  if (!channel) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const beforeAt = Number(req.query.beforeAt);
  const beforeId = typeof req.query.beforeId === "string" ? req.query.beforeId : undefined;
  const before = beforeId && Number.isFinite(beforeAt) ? { createdAt: beforeAt, id: beforeId } : undefined;
  const page = await messages.page(channel.id, { ...(before ? { before } : {}), limit: 50 });
  // Resolve authors here — the admin reads across workspaces, so the client's
  // user store won't have them all.
  const authors = await users.byIds([...new Set(page.messages.map((m) => m.authorId))]);
  res.json({ channel, messages: page.messages, authors, hasMore: page.hasMore });
});

/* ------------------------------------------------------------------ */
/* CanaryCode — Orchard-Robotics-only dev assistant (Claude Opus)       */
/* ------------------------------------------------------------------ */

const CANARYCODE_SYSTEM = [
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
  "Use them whenever a question needs live PR, CI, ticket, production-error, or database state — don't guess when",
  "you can look. Every tool is strictly read-only: you cannot merge, comment, deploy,",
  "create, or change anything, so never claim you did. If a tool reports it isn't",
  "configured, tell the user the integration needs a token and answer from what you know.",
].join("\n");

/** Stream an Opus chat turn for CanaryCode (Orchard Robotics staff only). Uses
 *  the Vercel AI SDK so the reply speaks the same protocol the client's useChat
 *  panel already renders. */
api.post("/canarycode/chat", requireAuth, async (req, res) => {
  const scope = (req as AuthedRequest).scope;
  if (!(await users.isStaff(scope.realUserId))) {
    res.status(403).json({ error: "CanaryCode is available to Orchard Robotics staff only." });
    return;
  }
  const messages = (req.body as { messages?: UIMessage[] } | undefined)?.messages;
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const result = streamText({
      model: anthropic("claude-opus-4-8"),
      system: CANARYCODE_SYSTEM,
      messages: await convertToModelMessages(messages),
      tools: canaryCodeTools,
      // Let Opus call read-only tools and then answer from the results; cap the
      // number of tool round-trips so a turn always terminates.
      stopWhen: stepCountIs(8),
    });
    result.pipeUIMessageStreamToResponse(res);
  } catch (err) {
    console.error("[canarycode] failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "CanaryCode is unavailable right now." });
  }
});

/** Your Threads inbox: recent messages that @mention you in this workspace
 *  (fast indexed lookup via the Mention table, each with an unread flag). */
api.get("/mentions", requireAuth, async (req, res) => {
  const { userId, orchardId } = (req as AuthedRequest).scope;
  const visible = await channels.visibleTo(userId, orchardId);
  const inbox = await mentions.inbox(
    userId,
    visible.map((c) => c.id),
    50,
  );
  res.json({ mentions: inbox });
});

/**
 * Message search across the channels the user can see in their orchard.
 * Channels/people are searched client-side (already in the store); this is the
 * server-backed message half. Newest-first, capped.
 */
api.get("/search", requireAuth, async (req, res) => {
  const { userId, orchardId } = (req as AuthedRequest).scope;
  const q = (typeof req.query.q === "string" ? req.query.q : "").trim();
  if (q.length < 2) {
    res.json({ messages: [] });
    return;
  }
  const visible = await channels.visibleTo(userId, orchardId);
  const found = await messages.search(
    visible.map((c) => c.id),
    q,
    25,
  );
  // Hide Canary's admin-only reasoning from non-admin searchers.
  const isAdmin = await users.isSuperAdmin(userId);
  res.json({ messages: redactMessages(found, isAdmin) });
});

/**
 * Orchards the signed-in user can switch into: every orchard for a super admin,
 * otherwise just the ones they belong to.
 */
api.get("/orchards", requireAuth, async (req, res) => {
  const { userId } = (req as AuthedRequest).scope;
  const isAdmin = await users.isSuperAdmin(userId);
  res.json(isAdmin ? await orchards.all() : await orchards.forUser(userId));
});

const switchSchema = z.object({ orchardId: z.string().min(1) });

/** Re-scope the session to another orchard (super admins anywhere; others to
 *  orchards they belong to). Returns the new active orchard. */
api.post("/orchards/switch", requireAuth, async (req, res) => {
  const scope = (req as AuthedRequest).scope;
  const userId = scope.userId; // effective user
  const parsed = switchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid orchard" });
    return;
  }

  const target = await orchards.byId(parsed.data.orchardId);
  if (!target) {
    res.status(404).json({ error: "Unknown orchard" });
    return;
  }

  const isAdmin = await users.isSuperAdmin(userId);
  const allowed = isAdmin || (await orchards.isMember(target.id, userId));
  if (!allowed) {
    res.status(403).json({ error: "You don't have access to that orchard" });
    return;
  }

  // While masquerading, just move the EFFECTIVE orchard — keep the same session
  // (still owned by the admin) so the masquerade isn't lost.
  if (scope.masquerading) {
    await setSessionMasquerade(tokenFromRequest(req) as string, userId, target.id);
    res.json({ orchard: target });
    return;
  }

  await orchards.ensureMembership(target.id, userId);

  // A fresh session bound to the target orchard; retire the previous one.
  const oldToken = tokenFromRequest(req);
  if (oldToken) await deleteSession(oldToken);
  const token = await createSession(userId, target.id);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.json({ orchard: target });
});
