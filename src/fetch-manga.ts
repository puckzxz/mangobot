import { SeriesSource } from "./db";
import { ScraperResult } from "./types/scraper";
import mangadex from "./scrapers/mangadex";
import asura from "./scrapers/asura";
import weebcentral from "./scrapers/weebcentral";

type Scraper = { scrape(urls: string[]): Promise<ScraperResult[]> };

/**
 * How each source is fetched. Every source is a plain HTTP call — Asura
 * server-renders its chapter list and WeebCentral publishes per-series RSS — which
 * is what allowed the puppeteer sidecar to be deleted outright.
 *
 * `satisfies Record<SeriesSource, …>` is the point of this table: adding a value to
 * the enum stops compiling until it is routed here. Routing used to be by negation
 * — "anything not in the sidecar list goes to MangaDex" — so an unrouted source was
 * silently handed to the MangaDex API and surfaced as a confusing `id null` 404.
 */
const SCRAPERS = {
  [SeriesSource.WeebCentral]: weebcentral,
  [SeriesSource.AsuraScans]: asura,
  [SeriesSource.MangaDex]: mangadex,
} satisfies Record<SeriesSource, Scraper>;

type Item = { url: string; source: SeriesSource };

const fetchManga = async (items: Item[]): Promise<ScraperResult[]> => {
  const results: ScraperResult[] = [];

  for (const [source, scraper] of Object.entries(SCRAPERS)) {
    const urls = items.filter((item) => item.source === source).map((item) => item.url);
    if (urls.length === 0) continue;

    // Each source is isolated: one upstream failing must not discard results
    // already collected from the others, which is what happened when a single
    // MangaDex 429 rejected out of the whole batch.
    try {
      results.push(...(await scraper.scrape(urls)));
    } catch (error) {
      console.error(`[fetch] ${source} failed:`, error);
    }
  }

  return results;
};

export default fetchManga;
