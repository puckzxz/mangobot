import { SeriesSource } from "@prisma/client";
import { ScraperResult } from "./types/scraper";
import { dispatchToSidecar } from "./dispatcher";
import mangadex from "./scrapers/mangadex";

const SIDE_CAR_SOURCES: SeriesSource[] = [SeriesSource.AsuraScans, SeriesSource.MangaSee];

const fetchManga = async ({ url, source }: { url: string; source: SeriesSource }): Promise<ScraperResult[]> => {
  if (SIDE_CAR_SOURCES.includes(source)) {
    return dispatchToSidecar<ScraperResult[]>({
      type: "scrape",
      data: [
        {
          url,
          source,
        },
      ],
    });
  }

  // We can safely assume it's MangaDex now
  return mangadex.scrape([url]);
};

export default fetchManga;
