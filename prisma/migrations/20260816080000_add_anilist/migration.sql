-- Metadata-only: all nullable, no rewrite, and the previous image runs fine
-- against this schema.
ALTER TABLE "series" ADD COLUMN     "anilist_id" INTEGER;
ALTER TABLE "series" ADD COLUMN     "anilist_title" TEXT;
ALTER TABLE "series" ADD COLUMN     "anilist_chapters" INTEGER;
ALTER TABLE "series" ADD COLUMN     "anilist_checked_at" TIMESTAMP(3);

-- No backfill: anilist_checked_at being NULL is what marks a row as never looked
-- up, and the pass uses exactly that to choose who to query next.
