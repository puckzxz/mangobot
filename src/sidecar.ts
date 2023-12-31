import { decode, encode } from "./coder";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import mangasee from "./scrapers/mangasee";
import asura from "./scrapers/asura";
import { Task } from "./types/task";
import { SeriesSource } from "@prisma/client";
import { ScraperResult } from "./types/scraper";
puppeteer.use(StealthPlugin());

const puppeteerArgs = [
  "--aggressive-cache-discard",
  "--disable-cache",
  "--disable-application-cache",
  "--disable-offline-load-stale-cache",
  "--disable-gpu-shader-disk-cache",
  "--media-cache-size=0",
  "--disk-cache-size=0",
];

const browser = await puppeteer.launch({ headless: "new", args: puppeteerArgs });

const args = Bun.argv.slice(2);

const rawData = args[0];

const input = decode(rawData) as Task;

let results: ScraperResult[] = [];

switch (input.type) {
  case "scrape":
    const mangaseeSeries = input.data.filter((item) => item.source === SeriesSource.MangaSee);
    const asuraSeries = input.data.filter((item) => item.source === SeriesSource.AsuraScans);

    if (mangaseeSeries.length > 0) {
      const mangaseeResults = await mangasee.scrape({
        browser,
        urls: mangaseeSeries.map((item) => item.url),
      });

      results.push(...mangaseeResults);
    }

    if (asuraSeries.length > 0) {
      const asuraResults = await asura.scrape({
        browser,
        urls: asuraSeries.map((item) => item.url),
      });

      results.push(...asuraResults);
    }
    break;
  default:
    break;
}

Bun.write(Bun.stdout, encode(results));

process.exit(0);
