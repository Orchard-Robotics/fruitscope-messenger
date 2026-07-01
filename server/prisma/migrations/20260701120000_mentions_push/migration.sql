-- Mentions: one row per (message, mentioned user) — powers the Threads inbox,
-- Slack-style per-channel mention badges, and @mention notifications.
CREATE TABLE "Mention" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "Mention_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Mention_messageId_userId_key" ON "Mention"("messageId", "userId");
CREATE INDEX "Mention_userId_createdAt_idx" ON "Mention"("userId", "createdAt");
CREATE INDEX "Mention_userId_channelId_readAt_idx" ON "Mention"("userId", "channelId", "readAt");

ALTER TABLE "Mention" ADD CONSTRAINT "Mention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Mention" ADD CONSTRAINT "Mention_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Browser Web Push subscriptions, so @mention notifications reach a user even
-- when the app is closed.
CREATE TABLE "PushSubscription" (
    "endpoint" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("endpoint")
);

CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
