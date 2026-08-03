-- Drop MangaSee and ReaperScans from SeriesSource.
--
-- mangasee123.com no longer resolves and reaperscans.com has been returning 502;
-- both scrapers have been deleted. Verified before writing this: zero rows in
-- `series` reference either value, so the USING cast below cannot fail.
--
-- Postgres cannot remove a value from an enum in place, so the type is rebuilt.

ALTER TYPE "SeriesSource" RENAME TO "SeriesSource_old";

CREATE TYPE "SeriesSource" AS ENUM ('MangaDex', 'AsuraScans', 'WeebCentral');

ALTER TABLE "series"
  ALTER COLUMN "source" TYPE "SeriesSource" USING ("source"::text::"SeriesSource");

DROP TYPE "SeriesSource_old";
