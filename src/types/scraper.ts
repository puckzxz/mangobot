import { SeriesSource } from "../db";

export interface ScraperResult {
  title: string;
  /** The URL we asked for, carried through so results never have to be re-matched to inputs. */
  seriesUrl: string;
  chapterUrl: string;
  latestChapter: string;
  source: SeriesSource;
  /** Optional: `series.image_url` is nullable, and a missing cover must never drop an update. */
  imageUrl: string | undefined;
  /** When the source says the chapter was published. Absent where a source publishes no date. */
  publishedAt: Date | undefined;
  /**
   * Slow-changing metadata. Absent when this pass did not refresh it, which is not
   * the same as the source having none — so a caller must leave the stored value
   * alone rather than overwriting it with undefined.
   */
  metadata?: SeriesMetadata;
}

/**
 * What a source says about the series itself, as opposed to its newest chapter.
 * Changes on the order of months, so it is refreshed on a TTL rather than every pass.
 */
export interface SeriesMetadata {
  /** Raw, unnormalised — "Complete", "ongoing", "hiatus". See src/series-status.ts. */
  status: string | undefined;
  /** How many chapters the source claims to have. The gap against ours is Gap A. */
  chapterCount: number | undefined;
  author: string | undefined;
}

/**
 * Why one series produced no result. The distinction that matters most is
 * `empty` (the source answered, and genuinely has nothing new) versus everything
 * else (we never got a usable answer) — the first is normal, the rest are faults.
 */
export type ScrapeFailureReason =
  | "derive-url" // the stored URL cannot be turned into something fetchable — permanent
  | "http" // the source answered with a non-OK status
  | "blocked" // 403/429/503 — refused, not missing. The signal that a source has turned on bot rules
  | "parse" // the response arrived but the shape we read was not in it — the site changed
  | "empty" // parsed fine, but no readable chapter (all locked, or no English release)
  | "timeout"
  | "network"
  | "not-attempted" // the batch died before this URL was reached
  | "internal";

/**
 * Exactly one of these per requested URL — that totality is the whole point.
 *
 * Scrapers used to return `ScraperResult | null` and the batch returned an array
 * *shorter than* its input, so a series that failed was simply absent from the
 * caller's loop: no row written, nothing counted, indistinguishable from a series
 * nobody asked about. That is how 29 series froze silently in March.
 *
 * `seriesUrl` and `source` sit on both variants so a caller can reconcile against
 * what it requested without unwrapping first.
 */
export type ScrapeOutcome =
  | { ok: true; seriesUrl: string; source: SeriesSource; result: ScraperResult }
  | {
      ok: false;
      seriesUrl: string;
      source: SeriesSource;
      reason: ScrapeFailureReason;
      /** Human-readable, safe to persist and to show in the panel. */
      detail: string;
      httpStatus?: number;
    };

export interface Scraper {
  /**
   * Never throws for an expected fault — it returns a typed failure instead.
   *
   * `refreshMetadata` asks for the slow-changing fields as well. Asura and MangaDex
   * ignore it and always include them, because both arrive inside a response the
   * scraper already fetches. WeebCentral needs a second request for its status, so
   * it only pays that cost when asked — the caller budgets who gets one.
   */
  scrapeOne(url: string, refreshMetadata?: boolean): Promise<ScrapeOutcome>;
  /** Gap the shared runner leaves between requests to this source. */
  readonly requestGapMs: number;
}

export const failure = (
  seriesUrl: string,
  source: SeriesSource,
  reason: ScrapeFailureReason,
  detail: string,
  httpStatus?: number
): ScrapeOutcome => ({ ok: false, seriesUrl, source, reason, detail, ...(httpStatus ? { httpStatus } : {}) });

export const success = (result: ScraperResult): ScrapeOutcome => ({
  ok: true,
  seriesUrl: result.seriesUrl,
  source: result.source,
  result,
});

/** Cloudflare refusing us reads very differently from a series being gone. */
export const statusReason = (status: number): ScrapeFailureReason =>
  status === 403 || status === 429 || status === 503 ? "blocked" : "http";

/** Turns a thrown value into a typed failure — the only place that mapping lives. */
export const classifyThrown = (seriesUrl: string, source: SeriesSource, error: unknown): ScrapeOutcome => {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const reason: ScrapeFailureReason =
    name === "TimeoutError" || name === "AbortError"
      ? "timeout"
      : error instanceof TypeError || name === "ConnectionRefused" || /fetch|socket|ECONN|DNS/i.test(message)
        ? "network"
        : "internal";
  return failure(seriesUrl, source, reason, message.slice(0, 300));
};
