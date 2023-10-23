import { decode, encode } from "./coder";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import mangasee from "./scrapers/mangasee";
import asura from "./scrapers/asura";
import { Task } from "./types/task";
import { SeriesSource } from "@prisma/client";
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

let result = null;

switch (input.type) {
  case "scrape":
    for (const item of input.data) {
      const { url, source } = item;
      switch (source) {
        case SeriesSource.MangaSee:
          result = await mangasee.scrape({
            browser,
            urls: [url],
          });
          break;
        case SeriesSource.AsuraScans:
          result = await asura.scrape({
            browser,
            urls: [url],
          });
          break;
        default:
          break;
      }
    }
    break;
  default:
    break;
}

Bun.write(Bun.stdout, encode(result));

process.exit(0);
