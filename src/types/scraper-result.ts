import { SeriesSource } from "@prisma/client";

export interface ScraperResult {
  title: string;
  seriesUrl: string;
  chapterUrl: string;
  latestChapter: string;
  source: SeriesSource;
}
