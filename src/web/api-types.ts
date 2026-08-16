import type { SeriesSource } from "../db";

/**
 * Wire contract between the web server and the browser, imported from both sides
 * so tsc enforces it. Must stay runtime-free (interfaces and type-only imports):
 * this module is bundled into the client, where Prisma must not follow.
 */

export interface SubscriberDto {
  id: string;
  /** Discord display name; null when unresolvable (web-only mode, deleted account). */
  name: string | null;
}

export interface SeriesDto {
  id: string;
  name: string;
  url: string;
  source: SeriesSource;
  latestChapter: string;
  imageUrl: string | null;
  /** ISO timestamp of the last scrape that actually succeeded. */
  lastSuccessAt: string;
  /** ISO timestamp of the last scrape attempt, successful or not. Null until one runs. */
  lastAttemptAt: string | null;
  /** Consecutive failed scrapes. 0 means healthy — any success resets it. */
  consecutiveFailures: number;
  /** Why the last scrape failed, e.g. "blocked" | "parse" | "empty". Null when healthy. */
  lastFailureReason: string | null;
  /** The failure detail, safe to render. Null when healthy. */
  lastFailureMessage: string | null;
  /** ISO timestamp of the last announced chapter; null until one lands post-Aug 2026. */
  latestChapterAt: string | null;
  /**
   * ISO timestamp of when the SOURCE published the latest chapter. This is the one
   * to show a human — `latestChapterAt` only records when the bot noticed.
   */
  latestChapterPublishedAt: string | null;
  /** ISO timestamp of when the series was added to the guild's catalog. */
  addedAt: string;
  /** Normalised upstream state. Triage only — it never gates scraping. */
  upstreamState: "ongoing" | "completed" | "hiatus" | "dropped" | "unknown";
  /** The source's own word for it, e.g. "Complete". Null until first refreshed. */
  upstreamStatusRaw: string | null;
  /** No new chapter upstream for 120+ days, and the scrape is healthy. */
  dormant: boolean;
  /**
   * How far the source's newest chapter is ahead of the newest we can read. Both
   * are chapter numbers; on AsuraScans, the only source that states one, a gap
   * means early access is holding the chapter back. Null when not behind.
   */
  chaptersBehind: number | null;
  /** The highest chapter number the source lists, gated included. Null when unstated. */
  sourceHighestChapter: number | null;
  /** Chapters the original work has that this source never translated. */
  untranslated: number | null;
  /** What AniList matched this title to, so a wrong match is visible. */
  anilistTitle: string | null;
  /**
   * A recommendation to a human, never an action: the work has ended, nothing has
   * arrived in months, and no chapters remain upstream that we have missed.
   */
  looksCompleted: boolean;
  /** Whether the source publishes a chapter total, so the UI can avoid overclaiming. */
  chapterTotalKnown: boolean;
  author: string | null;
  subscribers: SubscriberDto[];
}

export interface ListSeriesResponse {
  guild: { id: string; name: string } | null;
  series: SeriesDto[];
}

export interface AddSeriesRequest {
  url: string;
}

export interface AddSeriesResponse {
  series: SeriesDto;
  alreadyInCatalog: boolean;
}

export interface ApiError {
  error: string;
}
