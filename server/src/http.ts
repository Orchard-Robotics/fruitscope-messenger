import { Router } from "express";
import { z } from "zod";

import type { Orchard } from "@shared/index";
import type { AuthedRequest } from "./auth";
import {
  createSession,
  deleteSession,
  requireAuth,
  sessionCookieOptions,
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
import { bootstrap, orchards, users } from "./store";

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

api.get("/bootstrap", requireAuth, async (req, res) => {
  const { userId, orchardId } = (req as AuthedRequest).scope;
  res.json(await bootstrap(userId, orchardId));
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
  const { userId } = (req as AuthedRequest).scope;
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

  await orchards.ensureMembership(target.id, userId);

  // A fresh session bound to the target orchard; retire the previous one.
  const oldToken = tokenFromRequest(req);
  if (oldToken) await deleteSession(oldToken);
  const token = await createSession(userId, target.id);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.json({ orchard: target });
});
