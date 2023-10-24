import { SeriesSource } from "@prisma/client";
import { ScraperResult } from "./types/scraper";
import { dispatchToSidecar } from "./dispatcher";
import mangadex from "./scrapers/mangadex";

const SIDE_CAR_SOURCES: SeriesSource[] = [SeriesSource.AsuraScans, SeriesSource.MangaSee];

const fetchManga = async (
  items: Array<{
    url: string;
    source: SeriesSource;
  }>
): Promise<ScraperResult[]> => {
  const results: ScraperResult[] = [];
  // While we could do this in parallel with a Promise.all
  // We don't want to get DDOS protection'd by sites we scrape with puppeteer
  // We also don't want to get rate limited by mangadex
  for (const item of items) {
    if (SIDE_CAR_SOURCES.includes(item.source)) {
      const response = await dispatchToSidecar<ScraperResult[]>({
        type: "scrape",
        data: [
          {
            url: item.url,
            source: item.source,
          },
        ],
      });
      results.push(...response);
    } else {
      const response = await mangadex.scrape([item.url]);
      results.push(...response);
    }
  }
  return results;
};

export default fetchManga;
