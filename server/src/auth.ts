import type { CookieOptions, NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";

import type { ID } from "@shared/index";
import { isProd, SESSION_COOKIE } from "./env";
import { prisma } from "./prisma";

export interface SessionScope {
  /** Effective user — the masqueraded user when masquerading, else the real one. */
  userId: ID;
  /** Effective orchard — the masquerade orchard when masquerading, else the real one. */
  orchardId: ID;
  /** The real signed-in user (the admin, when masquerading). */
  realUserId: ID;
  /** Whether this session is currently masquerading as another user. */
  masquerading: boolean;
}

/** 30 days — the messenger session outlives any single OIDC token exchange. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(userId: ID, orchardId: ID): Promise<string> {
  const token = nanoid(24);
  await prisma.session.create({ data: { token, userId, orchardId } });
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } });
}

/** Start masquerading: the session now ACTS as another user in their orchard. */
export async function setSessionMasquerade(
  token: string,
  masqueradeUserId: ID,
  masqueradeOrchardId: ID,
): Promise<void> {
  await prisma.session.updateMany({
    where: { token },
    data: { masqueradeUserId, masqueradeOrchardId },
  });
}

/** Stop masquerading: restore the session to the real admin's own identity. */
export async function clearSessionMasquerade(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { token },
    data: { masqueradeUserId: null, masqueradeOrchardId: null },
  });
}

/**
 * Resolve a session to its EFFECTIVE scope. While masquerading, the effective
 * user/orchard are the masquerade targets; the real admin is kept for gating
 * admin actions (you stay an admin even while viewing as a non-admin) + restore.
 */
export async function resolveToken(token: string): Promise<SessionScope | undefined> {
  const session = await prisma.session.findUnique({ where: { token } });
  if (!session) return undefined;
  const masquerading = !!session.masqueradeUserId;
  return {
    userId: session.masqueradeUserId ?? session.userId,
    orchardId: session.masqueradeOrchardId ?? session.orchardId,
    realUserId: session.userId,
    masquerading,
  };
}

/** Cookie attributes for the session cookie (and for clearing it). */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd, // dev runs over http://localhost
    sameSite: "lax", // the OIDC callback is a top-level GET navigation
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}

/** The session token for a request: the cookie first, then a Bearer header. */
export function tokenFromRequest(req: Request): string | undefined {
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (cookieToken) return cookieToken;
  const header = req.header("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : undefined;
}

export interface AuthedRequest extends Request {
  scope: SessionScope;
}

/** Express guard: requires a valid session (cookie or `Authorization: Bearer`). */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = tokenFromRequest(req);
  const scope = token ? await resolveToken(token) : undefined;

  if (!scope) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  (req as AuthedRequest).scope = scope;
  next();
}
