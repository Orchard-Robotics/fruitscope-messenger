-- Multi-tenant orchard scoping.
--
-- Backfill-safe: existing installs get a default "MAIN" orchard and all existing
-- channels/sessions/users are moved into it (no data loss). On a fresh database
-- (no users) the backfill is a no-op and seed() creates the demo orchards.

-- CreateTable
CREATE TABLE "Orchard" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Orchard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrchardMembership" (
    "orchardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrchardMembership_pkey" PRIMARY KEY ("orchardId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Orchard_code_key" ON "Orchard"("code");

-- Backfill: only for existing installs (a fresh DB has no users -> no-op).
INSERT INTO "Orchard" ("id", "code", "name", "createdAt")
SELECT 'orch_main_default', 'MAIN', 'FruitScope', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "User");

-- AlterTable Channel: add nullable, backfill, then enforce NOT NULL.
ALTER TABLE "Channel" ADD COLUMN "orchardId" TEXT;
UPDATE "Channel" SET "orchardId" = 'orch_main_default' WHERE "orchardId" IS NULL;
ALTER TABLE "Channel" ALTER COLUMN "orchardId" SET NOT NULL;

-- AlterTable Session: add nullable, backfill, then enforce NOT NULL.
ALTER TABLE "Session" ADD COLUMN "orchardId" TEXT;
UPDATE "Session" SET "orchardId" = 'orch_main_default' WHERE "orchardId" IS NULL;
ALTER TABLE "Session" ALTER COLUMN "orchardId" SET NOT NULL;

-- Backfill memberships: existing users join the default orchard.
INSERT INTO "OrchardMembership" ("orchardId", "userId", "role", "joinedAt")
SELECT 'orch_main_default', "id", 'member', CURRENT_TIMESTAMP FROM "User"
ON CONFLICT DO NOTHING;

-- CreateIndex
CREATE INDEX "Channel_orchardId_idx" ON "Channel"("orchardId");

-- AddForeignKey
ALTER TABLE "OrchardMembership" ADD CONSTRAINT "OrchardMembership_orchardId_fkey" FOREIGN KEY ("orchardId") REFERENCES "Orchard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrchardMembership" ADD CONSTRAINT "OrchardMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_orchardId_fkey" FOREIGN KEY ("orchardId") REFERENCES "Orchard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_orchardId_fkey" FOREIGN KEY ("orchardId") REFERENCES "Orchard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
