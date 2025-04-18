/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { SeriesSource } from "@prisma/client";
import { ScraperResult, ScraperArgs } from "../types/scraper";

interface SeriesData {
  title: string;
  latestChapter: string;
  chapterUrl: string;
  imageUrl: string;
}

export default {
  async scrape({ browser, urls }: ScraperArgs): Promise<ScraperResult[]> {
    const page = await browser.newPage();
    let series: SeriesData[] = [];
    let seriesUrllist: string[] = [];
    try {
      for (const url of urls) {
        seriesUrllist.push(url);
        await page.goto(url, { timeout: 0, waitUntil: "domcontentloaded" });
        const data = (await page.evaluate(() => {
          const title = document.querySelector("div.text-center.sm\\:text-left > span.text-xl.font-bold")?.textContent;
          const imageUrl = document.querySelector('img[alt="poster"]')?.getAttribute("src") ?? '';
          const chapterDivs = Array.from(
            document.querySelectorAll('div[class*="pl-4 py-2 border rounded-md group w-full"]')
          );
          const latestDiv = chapterDivs[0];
          if (latestDiv?.querySelector("svg")) {
            return null;
          }
          const latestUrl = latestDiv?.querySelector("a")?.href;
          const latestChapter = latestUrl?.split("/").pop();
          if (title && latestChapter && latestUrl) {
            return {
              title,
              latestChapter,
              chapterUrl: latestUrl,
              imageUrl,
            };
          }
          return null;
        })) as SeriesData | null;
        if (data) {
          series.push(data);
        }
      }
    } catch (e) {
      console.error('Error scraping Asura:', e);
    } finally {
      await page.close();
    }
    return series.map((s) => {
      return {
        title: s.title,
        latestChapter: s.latestChapter,
        seriesUrl: seriesUrllist[series.findIndex((item) => item.title === s.title)],
        source: SeriesSource.AsuraScans,
        chapterUrl: s.chapterUrl,
        imageUrl: s.imageUrl,
      };
    });
  },
};
