-- Fast message search. A trigram GIN index makes case-insensitive substring
-- matching (ILIKE '%query%') index-backed instead of a full scan, so search
-- stays fast as history grows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Message_content_trgm_idx" ON "Message" USING gin (content gin_trgm_ops);
