-- Profile pictures: store the GCS object key of a user's uploaded avatar.
-- Null = no picture (the client falls back to the hue gradient + initials).
ALTER TABLE "User" ADD COLUMN "avatarKey" TEXT;
