import prisma from "./prisma";
import type { ScrapeFailureReason, ScraperResult } from "./types/scraper";
import { crossedAlertThreshold } from "./scrape-health";

/**
 * The only writer of the scrape-health columns.
 *
 * Success and failure each touch several fields that must move together — a
 * failure that forgets to stamp `lastFailureAt`, or a success that forgets to clear
 * `consecutiveFailures`, leaves the row lying about its own state. Keeping both
 * transitions in one module is what makes "is this series healthy?" answerable from
 * the row alone.
 *
 * Note what is deliberately absent: nothing here can mark a series completed. The
 * health axis and the editorial axis do not share a cell, so a broken scraper is
 * structurally incapable of being recorded as a finished series.
 */

export interface RecordedFailure {
  reason: ScrapeFailureReason;
  detail: string;
}

/**
 * A failure writes the health columns and nothing else — `latestChapter`,
 * `lastSuccessAt` and `imageUrl` are all left exactly as they were. That is the
 * point: a failed scrape must never look like a successful one that found nothing,
 * and it must never overwrite good data with the absence of data.
 */
export const recordFailure = async (
  series: { id: string; name: string; consecutiveFailures: number },
  failure: RecordedFailure
): Promise<void> => {
  const consecutiveFailures = series.consecutiveFailures + 1;
  const now = new Date();

  await prisma.series.update({
    where: { id: series.id },
    data: {
      lastAttemptAt: now,
      consecutiveFailures,
      lastFailureReason: failure.reason,
      // Bounded: these are third-party strings and this column is read by the panel.
      lastFailureMessage: failure.detail.slice(0, 300),
      lastFailureAt: now,
    },
  });

  if (crossedAlertThreshold(failure.reason, consecutiveFailures)) {
    console.error(
      `[health] ${series.name} has failed ${consecutiveFailures}x with ${failure.reason}: ${failure.detail}`
    );
  }
};

export interface SuccessOptions {
  /** A new chapter was found AND actually delivered to someone. */
  announced: boolean;
  /** A new chapter was found but reached nobody — leave it pending for next pass. */
  deliveryFailed: boolean;
}

/**
 * A success clears the whole failure axis. A series that recovers needs no
 * intervention, and a stale `lastFailureReason` sitting beside a fresh
 * `lastSuccessAt` would be worse than no information at all.
 */
export const recordSuccess = async (
  series: { id: string },
  update: ScraperResult,
  { announced, deliveryFailed }: SuccessOptions
): Promise<void> => {
  const now = new Date();

  await prisma.series.update({
    where: { id: series.id },
    data: {
      lastSuccessAt: now,
      lastAttemptAt: now,
      consecutiveFailures: 0,
      lastFailureReason: null,
      lastFailureMessage: null,
      lastFailureAt: null,
      imageUrl: update.imageUrl,
      // Only advance the chapter once it actually reached somebody. Advancing on a
      // failed send lost that chapter permanently — the next pass compares against
      // the new number and sees nothing new.
      ...(announced ? { latestChapter: update.latestChapter, latestChapterAt: now } : {}),
      // Written whenever the source gives us one, not only on an announcement: a
      // series we are already caught up on still needs a real "last published"
      // date, and that is exactly the row whose dormancy we cannot otherwise judge.
      ...(update.publishedAt ? { latestChapterPublishedAt: update.publishedAt } : {}),
      deliveryFailedAt: deliveryFailed ? now : null,
      // Absent metadata means "this pass did not refresh it", never "the source has
      // none" — so the stored value is left alone rather than being wiped. Only the
      // fields the source actually answered for are written.
      ...(update.metadata
        ? {
            upstreamStatusAt: now,
            ...(update.metadata.status !== undefined ? { upstreamStatus: update.metadata.status } : {}),
            ...(update.metadata.highestChapterNumber !== undefined
              ? { sourceHighestChapter: update.metadata.highestChapterNumber }
              : {}),
            ...(update.metadata.author !== undefined ? { author: update.metadata.author } : {}),
          }
        : {}),
    },
  });
};
