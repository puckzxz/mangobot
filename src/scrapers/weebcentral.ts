import { SeriesSource } from "../db";
import { Scraper, ScrapeOutcome, SeriesMetadata, failure, statusReason, success } from "../types/scraper";
import { fetchWithPolicy, retryAfterMs } from "../http";
import { decodeEntities } from "../utils/html-entities";

const SITE = "https://weebcentral.com";
const SOURCE = SeriesSource.WeebCentral;

/**
 * Every series publishes a feed at `/series/<id>/rss`, which carries the canonical
 * title, the cover, and the chapter list — everything the DOM scrape used to dig
 * out of rendered markup, but as a stable contract.
 *
 * Stored URLs come in two shapes (`/series/<id>` and `/series/<id>/<slug>`), so the
 * id is taken positionally rather than by stripping a suffix.
 */
export const weebcentralRssUrl = (seriesUrl: string): string | null => {
  let segments: string[];
  try {
    segments = new URL(seriesUrl).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
  if (segments[0] !== "series" || !segments[1]) return null;
  return `${SITE}/series/${segments[1]}/rss`;
};

/**
 * Cloudflare fronts these feeds and enforces a burst quota, not just a rate: a
 * 300ms gap across the catalog earned a wall of 429s, while 1s ran clean. Walking
 * the whole catalog once every 30 minutes leaves plenty of room, so pace generously.
 */
const REQUEST_GAP_MS = 1_000;

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 5_000;

/** Retries on 429 rather than dropping the series for a whole cycle. */
const fetchFeed = async (feedUrl: string): Promise<Response> => {
  let response = await fetchWithPolicy(feedUrl);

  for (let attempt = 1; attempt < MAX_ATTEMPTS && response.status === 429; attempt++) {
    const waitMs = retryAfterMs(response, attempt, RETRY_BASE_MS);
    console.error(`[weebcentral] 429 for ${feedUrl}; retrying in ${waitMs}ms (${attempt}/${MAX_ATTEMPTS - 1})`);
    await Bun.sleep(waitMs);
    response = await fetchWithPolicy(feedUrl);
  }

  return response;
};

export const tag = (xml: string, name: string): string | undefined => {
  const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  if (!match) return undefined;
  const value = match[1]!.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim();
  return value ? decodeEntities(value) : undefined;
};

interface FeedItem {
  label: string;
  link: string;
  publishedAt: number;
}

/**
 * Labels vary wildly across series — "Chapter 51", "No. 107", "Episode 267",
 * "Mag Version 236" — but all of them end with the number. Reading a fixed token
 * position is what silently froze One-Punch Man on the literal string "Version".
 */
export const chapterNumberFromLabel = (label: string): string | undefined => label.match(/(\d+(?:\.\d+)?)\s*$/)?.[1];

/** Split out from the fetch so it can be tested against fixture XML. */
export const parseFeed = (
  xml: string,
  seriesUrl: string
): { ok: true; result: ReturnType<typeof buildResult> } | { ok: false; reason: "parse" | "empty"; detail: string } => {
  // Everything before the first <item> is channel metadata, so splitting here keeps
  // the channel title from being confused with a chapter title.
  const [channel, ...rawItems] = xml.split("<item>");

  const title = tag(channel ?? "", "title");
  const imageUrl = tag(channel ?? "", "url");

  const items = rawItems
    .map((raw): FeedItem | null => {
      const label = tag(raw, "title");
      const link = tag(raw, "link");
      if (!label || !link) return null;
      return { label, link, publishedAt: Date.parse(tag(raw, "pubDate") ?? "") || 0 };
    })
    .filter((item): item is FeedItem => item !== null);

  if (!title) {
    return { ok: false, reason: "parse", detail: "feed had no channel title" };
  }
  if (items.length === 0) {
    return { ok: false, reason: "empty", detail: "feed listed no chapters" };
  }

  // Newest by publication date rather than by feed order or by the largest number —
  // chapter labels are not uniform enough to sort on.
  const latest = items.reduce((a, b) => (b.publishedAt > a.publishedAt ? b : a));
  const latestChapter = chapterNumberFromLabel(latest.label);

  if (!latestChapter) {
    return { ok: false, reason: "parse", detail: `no chapter number in ${JSON.stringify(latest.label)}` };
  }

  return { ok: true, result: buildResult(seriesUrl, title, imageUrl, latest, latestChapter) };
};

const buildResult = (
  seriesUrl: string,
  title: string,
  imageUrl: string | undefined,
  latest: FeedItem,
  latestChapter: string
) => ({
  title,
  latestChapter,
  chapterUrl: latest.link,
  // The URL we asked for, carried straight through.
  seriesUrl,
  source: SOURCE,
  imageUrl,
  publishedAt: latest.publishedAt > 0 ? new Date(latest.publishedAt) : undefined,
});

/**
 * Status lives on the series page, not in the feed — the RSS carries no occurrence
 * of the word at all. So this costs a second request, which is why the caller
 * budgets who gets one rather than paying it on every series every pass.
 *
 * The value is read from the `included_status=` query parameter rather than the
 * anchor text, because that is the site's own machine-readable form:
 *   <strong>Status: </strong><a href="…/search?included_status=Complete">Complete</a>
 */
export const parseSeriesPage = (html: string): SeriesMetadata => {
  const field = (label: string): string | undefined =>
    html.match(new RegExp(`<strong>\\s*${label}:\\s*</strong>\\s*(?:<a[^>]*>)?\\s*([^<]+)`))?.[1]?.trim() || undefined;

  const status = html.match(/included_status=([A-Za-z]+)/)?.[1] ?? field("Status");

  return {
    status,
    // WeebCentral publishes no total, so Gap A is unavailable for this source.
    chapterCount: undefined,
    author: field("Author"),
  };
};

const fetchMetadata = async (seriesUrl: string): Promise<SeriesMetadata | undefined> => {
  try {
    const response = await fetchWithPolicy(seriesUrl, { redirect: "follow" });
    if (!response.ok) {
      console.error(`[weebcentral] ${response.status} fetching series page for ${seriesUrl}`);
      return undefined;
    }
    return parseSeriesPage(await response.text());
  } catch (error) {
    // Never allowed to fail the scrape — the chapter update is the job.
    console.error(`[weebcentral] metadata fetch failed for ${seriesUrl}:`, error);
    return undefined;
  }
};

const scraper: Scraper = {
  requestGapMs: REQUEST_GAP_MS,

  /**
   * Plain HTTP against the per-series RSS feed. This replaced a puppeteer scrape,
   * which is what allowed the browser, the sidecar subprocess and the stealth
   * plugins to be deleted outright.
   */
  async scrapeOne(seriesUrl: string, refreshMetadata = false): Promise<ScrapeOutcome> {
    const feedUrl = weebcentralRssUrl(seriesUrl);
    if (!feedUrl) {
      return failure(seriesUrl, SOURCE, "derive-url", `cannot derive a feed URL from ${seriesUrl}`);
    }

    const response = await fetchFeed(feedUrl);
    if (!response.ok) {
      // 403/429 here mean Cloudflare refused us, not that the series is gone —
      // distinct from a 404, and worth being able to tell apart.
      return failure(
        seriesUrl,
        SOURCE,
        statusReason(response.status),
        `${response.status} for ${feedUrl}`,
        response.status
      );
    }

    const parsed = parseFeed(await response.text(), seriesUrl);
    if (!parsed.ok) {
      return failure(seriesUrl, SOURCE, parsed.reason, parsed.detail);
    }

    if (!refreshMetadata) {
      return success(parsed.result);
    }

    // Pace the second request like any other, so a metadata refresh cannot burst.
    await Bun.sleep(REQUEST_GAP_MS);
    return success({ ...parsed.result, metadata: await fetchMetadata(seriesUrl) });
  },
};

export default scraper;
