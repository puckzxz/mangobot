import { SeriesSource } from "@prisma/client";
import { ScraperResult } from "./types/scraper";
import { dispatchToSidecar } from "./dispatcher";
import mangadex from "./scrapers/mangadex";

const SIDE_CAR_SOURCES: SeriesSource[] = [
  SeriesSource.AsuraScans,
  SeriesSource.MangaSee,
  SeriesSource.ReaperScans,
  SeriesSource.WeebCentral,
];

const fetchManga = async (
  items: Array<{
    url: string;
    source: SeriesSource;
  }>
): Promise<ScraperResult[]> => {
  const results: ScraperResult[] = [];

  const sideCarableItems = items.filter((item) => SIDE_CAR_SOURCES.includes(item.source));

  const response = await dispatchToSidecar<ScraperResult[]>({
    type: "scrape",
    data: sideCarableItems,
  });

  results.push(...response);

  // Mangadex is a special case, since it's not a sidecarable source
  // Our only special case for now
  const mangadexItems = items.filter((item) => !SIDE_CAR_SOURCES.includes(item.source));

  const mangadexResponse = await mangadex.scrape(mangadexItems.map((item) => item.url));

  results.push(...mangadexResponse);

  return results;
};

export default fetchManga;
