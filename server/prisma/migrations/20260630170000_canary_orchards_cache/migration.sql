-- Fallback cache of the user's accessible orchards ([{code,name}]) for the
-- Canary orchard picker: the last successful FruitScope /user-info result,
-- seeded at login from the OIDC claim. Used only when /user-info is unreachable.
ALTER TABLE "User" ADD COLUMN "fruitscopeOrchardsCache" JSONB;
