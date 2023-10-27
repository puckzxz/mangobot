import { SeriesSource } from "@prisma/client";
import { Browser } from "puppeteer";

export interface ScraperResult {
  title: string;
  seriesUrl: string;
  chapterUrl: string;
  latestChapter: string;
  source: SeriesSource;
  imageUrl: string;
}

export interface ScraperArgs {
  browser: Browser;
  urls: string[];
}
