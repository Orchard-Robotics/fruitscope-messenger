-- Bot groups (teams): a named set of bots in a workspace, mirrored as a channel.
CREATE TABLE "BotGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "orchardId" TEXT NOT NULL,
    "channelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotGroup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BotGroup_orchardId_idx" ON "BotGroup"("orchardId");

ALTER TABLE "BotGroup" ADD CONSTRAINT "BotGroup_orchardId_fkey"
    FOREIGN KEY ("orchardId") REFERENCES "Orchard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "botGroupId" TEXT;

CREATE INDEX "User_botGroupId_idx" ON "User"("botGroupId");

ALTER TABLE "User" ADD CONSTRAINT "User_botGroupId_fkey"
    FOREIGN KEY ("botGroupId") REFERENCES "BotGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
