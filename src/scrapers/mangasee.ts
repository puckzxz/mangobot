import { Browser } from "puppeteer";
import { SeriesSource } from "@prisma/client";
import { ScraperResult } from "../types/scraper-result";

export default {
  async scrape(browser: Browser, urls: string[]): Promise<ScraperResult[]> {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    let series: any[] = [];
    let seriesUrllist: string[] = [];
    // Go to each url and scrape
    try {
      for (const url of urls) {
        seriesUrllist.push(url);
        await page.goto(url, { waitUntil: "networkidle2" });
        await page.waitForSelector(
          "body > div.container.MainContainer > div > div > div > div > div:nth-child(1) > div.d-sm-none.col-9.top-5.bottom-5 > div.bottom-10"
        );
        const data = (await page.evaluate(() => {
          const siteUrl = "https://mangasee123.com";
          const title = document.querySelector("li.list-group-item.d-none.d-sm-block > h1")?.textContent;
          const chapterUrl =
            siteUrl +
            document
              .querySelector(".list-group-item.ChapterLink")
              ?.getAttribute("href")
              ?.replace(/-page-\d+\.html$/, ".html");
          const regex = /chapter-(\d+)/;
          const latestChapter = chapterUrl?.match(regex)?.[1];
          if (!title || !latestChapter || !chapterUrl) {
            return [];
          }
          return {
            title,
            latestChapter,
            chapterUrl,
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
          source: SeriesSource.MangaSee,
          chapterUrl: s.chapterUrl!,
        };
      });
  },
};
