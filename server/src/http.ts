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
import { broadcastUserUpdate } from "./socket";
import { FruitscopeApiError } from "./fruitscope";
import { DEFAULT_MODEL_ID, isKnownModelId, modelCatalog } from "./llm";
import { redactMessages } from "./messageEmit";
import { bootstrap, bots, channels, messages, orchards, users } from "./store";
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
): Promise<{ token: string; orchard: Orchard }> {
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
  return { token, orchard };
}

/* ------------------------------------------------------------------ */
/* OIDC — "Sign in with FruitScope"                                    */
/* ------------------------------------------------------------------ */

const TX_COOKIE_MAX_AGE_MS = 10 * 60 * 1000; // an in-flight login is short-lived

/** Kick off the authorization-code + PKCE flow: redirect to the IdP. */
api.get("/auth/login", async (_req, res) => {
  if (!oidcConfigured) {
    res.redirect(`${APP_URL}/?login_error=unconfigured`);
    return;
  }
  try {
    const { url, tx } = await beginLogin();
    res.cookie(OIDC_TX_COOKIE, encodeTx(tx), {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: TX_COOKIE_MAX_AGE_MS,
    });
    res.redirect(url);
  } catch (err) {
    console.error("[oidc] login init failed:", err);
    res.redirect(`${APP_URL}/?login_error=unavailable`);
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
    const { token } = await provisionSession(identity);
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    res.redirect(`${APP_URL}/`);
  } catch (err) {
    const code = err instanceof NoOrchardError ? "no_orchard" : "auth_failed";
    console.error("[oidc] callback failed:", err);
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
