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
  /** ISO timestamp of the last scrape that saw this series. */
  lastCheckedAt: string;
  /** ISO timestamp of when the series was added to the guild's catalog. */
  addedAt: string;
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
