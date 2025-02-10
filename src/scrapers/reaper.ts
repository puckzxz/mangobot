/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import { SeriesSource } from "@prisma/client";
import { ScraperResult, ScraperArgs } from "../types/scraper";

export default {
  async scrape({ browser, urls }: ScraperArgs): Promise<ScraperResult[]> {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    let series: any[] = [];
    let seriesUrllist: string[] = [];
    // Go to each url and scrape
    try {
      for (const url of urls) {
        seriesUrllist.push(url);
        await page.goto(url, { waitUntil: "networkidle2" });
        await page.waitForSelector("body");
        const data = (await page.evaluate(() => {
          // Only one h1 on the page and it's the title
          const title = document.querySelector("h1")?.textContent?.trim();
          const chapterUrl = document
            .querySelector(".mt-auto.justify-center.items-center > a:last-child")
            ?.getAttribute("href")
            ?.trim();
          const imageUrl = document
            .querySelector("img.h-full.w-full.lg\\:h-full.lg\\:w-full")
            ?.getAttribute("src")
            ?.trim();
          const latestChapter = document.querySelector("ul > li > a")?.getAttribute("href")?.split("-").pop();
          if (!title || !latestChapter || !chapterUrl) {
            return [];
          }
          return {
            title,
            latestChapter,
            chapterUrl,
            imageUrl,
          };
        })) as any;
        series.push(data);
      }
    } catch (e) {
    } finally {
      await page.close();
    }

    return series
      .filter((s) => s.title && s.latestChapter && s.chapterUrl)
      .map((s) => {
        return {
          title: s.title!,
          latestChapter: s.latestChapter!,
          seriesUrl: seriesUrllist[series.findIndex((s) => s.title === s.title)],
          source: SeriesSource.ReaperScans,
          chapterUrl: s.chapterUrl!,
          imageUrl: s.imageUrl!,
        };
      });
  },
};
