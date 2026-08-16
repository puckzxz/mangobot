-- Metadata-only: every column is nullable, so no table rewrite and no lock held
-- while rows are touched.
ALTER TABLE "series" ADD COLUMN     "upstream_status" TEXT;
ALTER TABLE "series" ADD COLUMN     "upstream_status_at" TIMESTAMP(3);
ALTER TABLE "series" ADD COLUMN     "source_chapter_count" INTEGER;
ALTER TABLE "series" ADD COLUMN     "author" TEXT;

-- Deliberately no backfill. upstream_status_at being NULL is what marks a row as
-- never-refreshed, and the pass uses exactly that to pick which series to fetch
-- status for. Seeding a timestamp here would tell it the work was already done.
