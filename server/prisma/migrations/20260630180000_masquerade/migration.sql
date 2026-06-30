-- Masquerade ("view as another user"): when a super admin masquerades, the
-- session ACTS as masqueradeUserId in masqueradeOrchardId, while userId/orchardId
-- stay the real admin (for restore + audit). Effective identity = masquerade
-- fields when set, else the real ones.
ALTER TABLE "Session" ADD COLUMN "masqueradeUserId" TEXT;
ALTER TABLE "Session" ADD COLUMN "masqueradeOrchardId" TEXT;
