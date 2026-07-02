-- Agent-authored messages: an admin's AI agent posts as them, with a display name.
ALTER TABLE "Message" ADD COLUMN "agentName" TEXT;
