import type { NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";

import type { ID } from "@shared/index";
import { prisma } from "./prisma";

export interface SessionScope {
  userId: ID;
  orchardId: ID;
}

export async function createSession(userId: ID, orchardId: ID): Promise<string> {
  const token = nanoid(24);
  await prisma.session.create({ data: { token, userId, orchardId } });
  return token;
}

/** A session is bound to a single orchard — that is the scope of everything. */
export async function resolveToken(token: string): Promise<SessionScope | undefined> {
  const session = await prisma.session.findUnique({ where: { token } });
  return session ? { userId: session.userId, orchardId: session.orchardId } : undefined;
}

export interface AuthedRequest extends Request {
  scope: SessionScope;
}

/** Express guard: requires a valid `Authorization: Bearer <token>` header. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const scope = token ? await resolveToken(token) : undefined;

  if (!scope) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  (req as AuthedRequest).scope = scope;
  next();
}
