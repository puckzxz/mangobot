import { chaptersBehind } from "./series-status";

/**
 * How often a given series is worth checking.
 *
 * Keyed on how long it has actually been silent — never on its upstream status.
 * That distinction is the whole point: of 22 series WeebCentral marks `Complete`,
 * 19 received a chapter within 90 days, so slowing a series down because a site
 * called it finished would delay exactly the announcements this bot exists for.
 * Observed silence is evidence; a status field is not.
 *
 * Pure, and free of any database import — see the note in scrape-health.ts.
 */

export const BASE_INTERVAL_MS = 30 * 60 * 1000;

/**
 * The floor on how often anything is checked.
 *
 * Capped at a day rather than a week because quiet does not mean dead — the same
 * 19-of-22 measurement says a long-silent series can wake up. A day bounds the
 * worst-case lateness at 24 hours on something that has been silent for six
 * months, and the difference between weekly and daily across the whole catalog is
 * about 20 requests a day, which is not worth the extra six days of delay.
 */
export const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Doubles every 30 days of silence, from 30 minutes up to the daily cap. */
export const scrapeIntervalMs = (quietDays: number): number => {
  if (!Number.isFinite(quietDays) || quietDays < 0) return BASE_INTERVAL_MS;
  const doublings = Math.floor(quietDays / 30);
  // 2 ** 40 would overflow into Infinity long before the clamp; bound it first.
  const scaled = doublings > 20 ? MAX_INTERVAL_MS : BASE_INTERVAL_MS * 2 ** doublings;
  return Math.min(scaled, MAX_INTERVAL_MS);
};

export interface ScheduleInput {
  /** Upstream publish time of the newest chapter we know about. */
  latestChapterPublishedAt: Date | null;
  /** When we last tried, successful or not. */
  lastAttemptAt: Date | null;
  /** The highest chapter number the source lists, when it states one. */
  sourceHighestChapter: number | null;
  latestChapter: string;
}

export const quietDays = (latestChapterPublishedAt: Date | null, now: Date): number | null =>
  latestChapterPublishedAt ? (now.getTime() - latestChapterPublishedAt.getTime()) / 86_400_000 : null;

/**
 * Whether this series should be scraped on this pass.
 *
 * Three things force a check regardless of how quiet a series has been, because
 * each means our picture of it is either absent or known to be stale:
 *   - never attempted
 *   - no known publish date, so silence cannot be measured yet
 *   - the source lists a chapter newer than the one we can read
 *
 * The last one is what stops a back-off from stranding a series, and it only earns
 * its keep now that both sides of the comparison are chapter numbers. While it was
 * subtracting a chapter number from a count of chapters it fired on 11 series
 * permanently — 10 of which had nothing waiting at all — so the rows most likely to
 * be finished were also the ones that never backed off.
 *
 * A gap that is real closes by itself: the gated chapter unlocks, the next pass
 * announces it, and the publish date moving collapses the interval back to 30
 * minutes with nothing needing to reset it.
 */
export const isDueForScrape = (input: ScheduleInput, now: Date): boolean => {
  if (!input.lastAttemptAt) return true;

  if (chaptersBehind(input.sourceHighestChapter, input.latestChapter) !== null) return true;

  const quiet = quietDays(input.latestChapterPublishedAt, now);
  if (quiet === null) return true;

  const elapsed = now.getTime() - input.lastAttemptAt.getTime();
  return elapsed >= scrapeIntervalMs(quiet);
};
