import type { CookieOptions, NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";

import type { ID } from "@shared/index";
import { isProd, SESSION_COOKIE } from "./env";
import { prisma } from "./prisma";

export interface SessionScope {
  userId: ID;
  orchardId: ID;
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

/** A session is bound to a single orchard — that is the scope of everything. */
export async function resolveToken(token: string): Promise<SessionScope | undefined> {
  const session = await prisma.session.findUnique({ where: { token } });
  return session ? { userId: session.userId, orchardId: session.orchardId } : undefined;
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
