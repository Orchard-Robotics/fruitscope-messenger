import { Router } from "express";
import { z } from "zod";

import type { AuthedRequest } from "./auth";
import { createSession, requireAuth } from "./auth";
import { bootstrap, orchards, users } from "./store";

const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^[a-zA-Z0-9_.-]+$/, "Letters, numbers, dot, dash and underscore only"),
  displayName: z.string().trim().min(1).max(40).optional(),
  orchardId: z.string().min(1),
});

/** Turn "willow_vale" into "Willow Vale" for a sensible default display name. */
function prettify(username: string): string {
  return username
    .split(/[_.\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const api: Router = Router();

/** Public: the orchards a client can sign into (later filtered by OIDC). */
api.get("/orchards", async (_req, res) => {
  res.json(await orchards.all());
});

api.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid login" });
    return;
  }

  const { username, orchardId } = parsed.data;
  const orchard = await orchards.byId(orchardId);
  if (!orchard) {
    res.status(404).json({ error: "Unknown orchard" });
    return;
  }

  const displayName = parsed.data.displayName ?? prettify(username);
  const user = (await users.byUsername(username)) ?? (await users.create(username, displayName));

  // Membership grants access to this orchard's chat (a future OIDC layer decides this).
  await orchards.ensureMembership(orchard.id, user.id);

  const token = await createSession(user.id, orchard.id);
  res.json({ token, user, orchard });
});

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
