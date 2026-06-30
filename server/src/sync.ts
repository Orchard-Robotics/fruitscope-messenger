/**
 * Admin "sync from FruitScope": provision a workspace (orchard) + its users from
 * FruitScope's user-management API. Acts AS the signed-in admin via their
 * auth_jwt. Additive + idempotent — upserts users/memberships keyed by the OIDC
 * sub (= FruitScope user id), never deletes. A later real login of a synced user
 * updates the same record (see users.upsertFromFruitscope) instead of duping.
 */

import type {
  SyncedRole,
  SyncOrchardOption,
  SyncPreview,
  SyncReport,
  SyncUserResult,
} from "@shared/index";
import * as fs from "./fruitscope";
import { orchards, users } from "./store";

/** Map a FruitScope permission level to the local role we provision. */
export function roleForLevel(level: string): SyncedRole {
  switch (level) {
    case "admin":
      return "admin"; // global super admin — no per-orchard membership
    case "owner":
      return "manager";
    case "orchard":
    case "block":
    case "ranch":
      return "member";
    default:
      return "skipped"; // "none" or anything unexpected — no access
  }
}

/** Orchards the admin can sync, annotated with whether a workspace exists yet. */
export async function listSyncOrchards(authJwt: string): Promise<SyncOrchardOption[]> {
  const [fsOrchards, local] = await Promise.all([
    fs.listAccessibleOrchards(authJwt),
    orchards.all(),
  ]);
  const have = new Set(local.map((o) => o.code));
  return fsOrchards.map((o) => ({
    code: o.code,
    name: o.name,
    accountTier: o.accountTier,
    existing: have.has(o.code),
  }));
}

/** Preview the users that syncing `orchardCode` would provision (no writes). */
export async function previewOrchard(authJwt: string, orchardCode: string): Promise<SyncPreview> {
  const data = await fs.listOrchardUsers(authJwt, orchardCode);
  const existing = await users.existingOidcSubs(data.users.map((u) => String(u.userId)));
  return {
    orchardCode: data.orchardCode,
    orchardName: data.orchardName,
    users: data.users.map((u) => ({
      userId: u.userId,
      name: u.name,
      email: u.email,
      permissionLevel: u.permissionLevel,
      role: roleForLevel(u.permissionLevel),
      existing: existing.has(String(u.userId)),
    })),
  };
}

/** Provision the workspace + its users from FruitScope. */
export async function syncOrchard(authJwt: string, orchardCode: string): Promise<SyncReport> {
  const data = await fs.listOrchardUsers(authJwt, orchardCode);
  const code = data.orchardCode;
  const orchardName = data.orchardName;

  // Did the workspace exist before this sync?
  const before = new Set((await orchards.all()).map((o) => o.code));
  const workspaceCreated = !before.has(code);
  const orchard = await orchards.upsertByCode(code, orchardName ?? code);

  const results: SyncUserResult[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let members = 0;

  for (const u of data.users) {
    const role = roleForLevel(u.permissionLevel);
    if (role === "skipped") {
      results.push({ ...userResultBase(u), role, action: "skipped" });
      skipped += 1;
      continue;
    }

    const { user, created: wasCreated } = await users.upsertFromFruitscope({
      userId: u.userId,
      name: u.name,
      email: u.email,
      makeAdmin: role === "admin",
    });

    // Global admins get super-admin access but no per-orchard membership (they
    // can switch into any orchard); managers/members join the workspace. Keyed by
    // the local user id (a nanoid), NOT the FruitScope id.
    if (role !== "admin") {
      await orchards.upsertMembership(orchard.id, user.id, role);
      members += 1;
    }

    results.push({ ...userResultBase(u), role, action: wasCreated ? "created" : "updated" });
    if (wasCreated) created += 1;
    else updated += 1;
  }

  return {
    orchardCode: code,
    orchardName,
    workspaceCreated,
    total: data.users.length,
    created,
    updated,
    skipped,
    members,
    users: results,
  };
}

function userResultBase(u: fs.FsSyncUser): Omit<SyncUserResult, "role" | "action"> {
  return { userId: u.userId, name: u.name, email: u.email, permissionLevel: u.permissionLevel };
}
