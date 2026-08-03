import { SeriesSource } from "../db";
import { ScraperResult } from "../types/scraper";
import { USER_AGENT } from "../user-agent";
import { decodeEntities } from "../utils/html-entities";

const SITE = "https://weebcentral.com";

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
  let response = await fetch(feedUrl, { headers: { "User-Agent": USER_AGENT } });

  for (let attempt = 1; attempt < MAX_ATTEMPTS && response.status === 429; attempt++) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : RETRY_BASE_MS * 2 ** (attempt - 1);
    console.error(`[weebcentral] 429 for ${feedUrl}; retrying in ${waitMs}ms (${attempt}/${MAX_ATTEMPTS - 1})`);
    await Bun.sleep(waitMs);
    response = await fetch(feedUrl, { headers: { "User-Agent": USER_AGENT } });
  }

  return response;
};

const tag = (xml: string, name: string): string | undefined => {
  const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  if (!match) return undefined;
  const value = match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim();
  return value ? decodeEntities(value) : undefined;
};

interface FeedItem {
  label: string;
  link: string;
  publishedAt: number;
}

const scrapeOne = async (seriesUrl: string): Promise<ScraperResult | null> => {
  const feedUrl = weebcentralRssUrl(seriesUrl);
  if (!feedUrl) {
    console.error(`[weebcentral] could not derive a feed URL from ${seriesUrl}`);
    return null;
  }

  const response = await fetchFeed(feedUrl);
  if (!response.ok) {
    // 403/429 here mean Cloudflare refused us, not that the series is gone —
    // distinct from a 404, and worth being able to tell apart in the logs.
    console.error(`[weebcentral] ${response.status} for ${feedUrl}`);
    return null;
  }

  const xml = await response.text();

  // Everything before the first <item> is channel metadata, so splitting here keeps
  // the channel title from being confused with a chapter title.
  const [channel, ...rawItems] = xml.split("<item>");

  const title = tag(channel, "title");
  const imageUrl = tag(channel, "url");

  const items = rawItems
    .map((raw): FeedItem | null => {
      const label = tag(raw, "title");
      const link = tag(raw, "link");
      if (!label || !link) return null;
      return { label, link, publishedAt: Date.parse(tag(raw, "pubDate") ?? "") || 0 };
    })
    .filter((item): item is FeedItem => item !== null);

  if (!title || items.length === 0) {
    console.error(`[weebcentral] feed for ${seriesUrl} had no ${!title ? "title" : "chapters"}`);
    return null;
  }

  // Newest by publication date rather than by feed order or by the largest number —
  // chapter labels are not uniform enough to sort on.
  const latest = items.reduce((a, b) => (b.publishedAt > a.publishedAt ? b : a));

  // Labels vary wildly across series — "Chapter 51", "No. 107", "Episode 267",
  // "Mag Version 236" — but all of them end with the number. Reading a fixed token
  // position is what silently froze One-Punch Man on the literal string "Version".
  const latestChapter = latest.label.match(/(\d+(?:\.\d+)?)\s*$/)?.[1];

  if (!latestChapter) {
    console.error(`[weebcentral] no chapter number in ${JSON.stringify(latest.label)} for ${seriesUrl}`);
    return null;
  }

  return {
    title,
    latestChapter,
    chapterUrl: latest.link,
    // The URL we asked for, carried straight through.
    seriesUrl,
    source: SeriesSource.WeebCentral,
    imageUrl,
  };
};

export default {
  /**
   * Plain HTTP against the per-series RSS feed. This replaced a puppeteer scrape,
   * which is what allowed the browser, the sidecar subprocess and the stealth
   * plugins to be deleted outright.
   */
  async scrape(urls: string[]): Promise<ScraperResult[]> {
    const results: ScraperResult[] = [];

    for (const [index, url] of urls.entries()) {
      if (index > 0) await Bun.sleep(REQUEST_GAP_MS);
      try {
        const result = await scrapeOne(url);
        if (result) results.push(result);
      } catch (error) {
        console.error(`[weebcentral] failed to scrape ${url}:`, error);
      }
    }

    if (urls.length > 0 && results.length === 0) {
      console.error(
        `[weebcentral] returned 0 results for ${urls.length} URLs — the feed contract has probably changed`
      );
    }

    return results;
  },
};
