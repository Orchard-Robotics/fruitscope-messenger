-- Admin-created LLM bots: the pi-ai model id ("provider/key") and system prompt
-- they run under. Null for humans and for the built-in Canary bot.
ALTER TABLE "User" ADD COLUMN "botModel" TEXT;
ALTER TABLE "User" ADD COLUMN "botSystemPrompt" TEXT;
