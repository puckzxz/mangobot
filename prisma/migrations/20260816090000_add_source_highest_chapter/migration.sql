-- The highest chapter NUMBER the source lists, gated chapters included.
--
-- Replaces source_chapter_count, which held a count of chapter entries while
-- latest_chapter holds a chapter number. Subtracting one from the other made any
-- series numbered from chapter 0, or carrying a decimal chapter, look permanently
-- behind — 10 of the 11 rows it flagged were arithmetic rather than content.
--
-- DOUBLE PRECISION, not an integer: real chapter numbers include 112.7.
-- Left NULL on purpose. Every Asura row repopulates on its next successful scrape
-- (at most 24h away), and until then the gap simply reads as unknown.
ALTER TABLE "series" ADD COLUMN "source_highest_chapter" DOUBLE PRECISION;

-- source_chapter_count is deliberately NOT dropped here. Keeping it one more
-- release means the previous image still starts if this deploy is rolled back.
