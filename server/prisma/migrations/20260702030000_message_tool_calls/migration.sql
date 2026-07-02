-- CanaryCode in-channel tool calls (JSON array), so channels render its rich tool UIs.
ALTER TABLE "Message" ADD COLUMN "agentToolCalls" TEXT;
