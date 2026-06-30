-- Canary AI assistant — a global bot user present in every orchard, plus the
-- per-user FruitScope `session_jwt` the messenger uses to call the FruitScope
-- API as that user (Canary lives behind that API).

-- Bot marker: the client renders the Canary DM as the embedded AI panel.
ALTER TABLE "User" ADD COLUMN "isBot" BOOLEAN NOT NULL DEFAULT false;

-- The OIDC `session_jwt` (24h bearer) + its expiry. Presented to the FruitScope
-- API as the `auth_jwt` cookie so the proxy can act as the user. Server-side
-- only; re-minted on every login; null for the bot and dev-login users.
ALTER TABLE "User" ADD COLUMN "fruitscopeAuthJwt" TEXT;
ALTER TABLE "User" ADD COLUMN "fruitscopeAuthJwtExpiresAt" TIMESTAMP(3);
