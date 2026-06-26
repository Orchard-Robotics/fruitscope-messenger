-- "Sign in with FruitScope" (OIDC) — wipe demo state and add OIDC identity.
--
-- The messenger is moving to OIDC-driven identity: users come from the FruitScope
-- provider (keyed by the OIDC `sub`) and orchards are created lazily on first
-- login. None of the previous seeded/demo state should survive, so we truncate
-- everything before adding the new NOT NULL identity column (safe on an empty
-- table). This wipe runs once, automatically, on the next `migrate deploy`.

-- 1. Wipe all existing state. CASCADE covers the full FK graph.
TRUNCATE TABLE
  "Read",
  "Reaction",
  "Message",
  "ChannelMember",
  "Channel",
  "Session",
  "OrchardMembership",
  "User",
  "Orchard"
  RESTART IDENTITY CASCADE;

-- 2. OIDC identity fields on User.
ALTER TABLE "User" ADD COLUMN "oidcSub" TEXT NOT NULL;
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- 3. The OIDC `sub` is the stable identity key.
CREATE UNIQUE INDEX "User_oidcSub_key" ON "User"("oidcSub");
