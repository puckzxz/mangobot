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
    try {
      for (const url of urls) {
        seriesUrllist.push(url);
        await page.goto(url, { waitUntil: "networkidle2" });
        await page.waitForSelector("#chapter-list");
        const data = (await page.evaluate(() => {
          // This is a div that contains a bunch of a tags
          const chapterList = document.getElementById("chapter-list");
          if (!chapterList) {
            return [];
          }

          const mostRecentChapter = chapterList.querySelector("a");
          if (!mostRecentChapter) {
            return [];
          }

          // The chapter number is a span under a span that has the class 'grow flex items-center gap-2'
          const rawChapterNumber = mostRecentChapter.querySelector("span.grow.flex.items-center.gap-2 > span")
            ?.textContent;
          const latestChapter = rawChapterNumber?.split(" ")[1];

          // The chapter url is the href attribute of the most recent chapter
          const chapterUrl = mostRecentChapter.getAttribute("href");

          // The image url is a picture element that has a img element as a child
          const imageUrl = document.querySelector("picture > img")?.getAttribute("src");

          const titleElement = document.getElementsByClassName("hidden md:block text-2xl font-bold")[0];
          const title = titleElement?.textContent;
          if (!title || !latestChapter || !chapterUrl || !imageUrl) {
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
      .filter((s) => s.title && s.latestChapter && s.chapterUrl && s.imageUrl)
      .map((s) => {
        return {
          title: s.title!,
          latestChapter: s.latestChapter!,
          seriesUrl: seriesUrllist[series.findIndex((s) => s.title === s.title)],
          source: SeriesSource.WeebCentral,
          chapterUrl: s.chapterUrl!,
          imageUrl: s.imageUrl!,
        };
      });
  },
};
