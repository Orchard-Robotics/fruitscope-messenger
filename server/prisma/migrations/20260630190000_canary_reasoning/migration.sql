-- Canary in-channel @mention replies carry the model's "thinking" (reasoning +
-- status commentary) separately from the answer. It's admin-only: the server
-- strips it for non-admin recipients and the client renders it as a collapsible
-- box gated by the admin debug toggle. Null for all normal messages.
ALTER TABLE "Message" ADD COLUMN "canaryReasoning" TEXT;
