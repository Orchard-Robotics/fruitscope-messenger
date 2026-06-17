import type { NextFunction, Request, Response } from "express";
import { nanoid } from "nanoid";

import type { ID } from "@shared/index";
import { prisma } from "./prisma";

export async function createSession(userId: ID): Promise<string> {
  const token = nanoid(24);
  await prisma.session.create({ data: { token, userId } });
  return token;
}

export async function resolveToken(token: string): Promise<ID | undefined> {
  const session = await prisma.session.findUnique({ where: { token } });
  return session?.userId;
}

export interface AuthedRequest extends Request {
  userId: ID;
}

/** Express guard: requires a valid `Authorization: Bearer <token>` header. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const userId = token ? await resolveToken(token) : undefined;

  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  (req as AuthedRequest).userId = userId;
  next();
}
