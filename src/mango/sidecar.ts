import { decode, encode } from "./coder";
import puppeteer from "puppeteer-extra";
import { DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdBlocker from "puppeteer-extra-plugin-adblocker";
import mangasee from "../scrapers/mangasee";
import asura from "../scrapers/asura";
import reaper from "../scrapers/reaper";
import weebcentral from "../scrapers/weebcentral";
import { Task } from "../types/task";
import { SeriesSource } from "@prisma/client";
import { ScraperResult } from "../types/scraper";
import fs from "fs";
puppeteer.use(StealthPlugin());
puppeteer.use(
  AdBlocker({
    interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
  })
);

const puppeteerArgs = [
  "--no-sandbox",
  "--aggressive-cache-discard",
  "--disable-cache",
  "--disable-application-cache",
  "--disable-offline-load-stale-cache",
  "--disable-gpu-shader-disk-cache",
  "--media-cache-size=0",
  "--disk-cache-size=0",
  "--disable-dev-shm-usage",
];

const browser = await puppeteer.launch({ args: puppeteerArgs, headless: true });

if (!browser) {
  throw new Error("Failed to launch browser");
}

let chromeTempDataDir = null;

let chromeSpawnArgs = browser.process()?.spawnargs;

if (chromeSpawnArgs?.length) {
  for (let i = 0; i < chromeSpawnArgs.length; i++) {
    if (chromeSpawnArgs[i].indexOf("--user-data-dir=") === 0) {
      chromeTempDataDir = chromeSpawnArgs[i].replace("--user-data-dir=", "");
    }
  }
}

try {
  const args = Bun.argv.slice(2);

  const rawData = args[0];

  const input = decode(rawData) as Task;

  switch (input.type) {
    case "scrape":
      let results: ScraperResult[] = [];
      const mangaseeSeries = input.data.filter((item) => item.source === SeriesSource.MangaSee);
      const asuraSeries = input.data.filter((item) => item.source === SeriesSource.AsuraScans);
      const reaperSeries = input.data.filter((item) => item.source === SeriesSource.ReaperScans);
      const weebcentralSeries = input.data.filter((item) => item.source === SeriesSource.WeebCentral);

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

      if (reaperSeries.length > 0) {
        const reaperResults = await reaper.scrape({
          browser,
          urls: reaperSeries.map((item) => item.url),
        });

        results.push(...reaperResults);
      }

      if (weebcentralSeries.length > 0) {
        const weebcentralResults = await weebcentral.scrape({
          browser,
          urls: weebcentralSeries.map((item) => item.url),
        });

        results.push(...weebcentralResults);
      }

      Bun.write(Bun.stdout, encode(results));
      break;
    default:
      break;
  }
} catch (error) {
  console.error(error);
}

browser.close();

if (chromeTempDataDir) {
  fs.rmSync(chromeTempDataDir, { recursive: true, force: true });
}

process.exit(0);
