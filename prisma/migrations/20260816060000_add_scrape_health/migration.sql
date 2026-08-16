-- Hand-written rather than generated: Prisma renders a column rename as DROP + ADD,
-- which would discard every existing timestamp. RENAME keeps the data and is a
-- catalog-only change, so it is instant regardless of table size.
ALTER TABLE "series" RENAME COLUMN "last_checked_at" TO "last_success_at";

-- Health axis. All nullable or defaulted, so this is metadata-only — no table
-- rewrite, no lock held while rows are touched.
ALTER TABLE "series" ADD COLUMN     "last_attempt_at" TIMESTAMP(3);
ALTER TABLE "series" ADD COLUMN     "consecutive_failures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "series" ADD COLUMN     "last_failure_reason" TEXT;
ALTER TABLE "series" ADD COLUMN     "last_failure_message" TEXT;
ALTER TABLE "series" ADD COLUMN     "last_failure_at" TIMESTAMP(3);
ALTER TABLE "series" ADD COLUMN     "delivery_failed_at" TIMESTAMP(3);

-- Upstream publish time, as distinct from when we noticed.
ALTER TABLE "series" ADD COLUMN     "latest_chapter_published_at" TIMESTAMP(3);

-- Seed the new timestamp from what we already know, so dormancy is not uniformly
-- null on day one. Only the 8 rows that have ever announced have anything to give;
-- the rest fill in from the scrapers on the first pass after deploy.
UPDATE "series" SET "latest_chapter_published_at" = "latest_chapter_at" WHERE "latest_chapter_at" IS NOT NULL;
