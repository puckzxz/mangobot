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
        await page.waitForSelector("#chapterlist");
        const data = (await page.evaluate(() => {
          const title = document.querySelector(".entry-title")?.textContent;
          const elems = document.querySelectorAll(".eph-num");
          const pageElems = Array.from(elems);
          for (const pageElem of pageElems) {
            const aHref = pageElem.querySelector("a")?.getAttribute("href");
            // This is in a span under the a with the class chapternum
            const chapter = pageElem.querySelector("a")?.querySelector("span.chapternum")?.textContent?.split(" ")[1];
            //Get image source
            const imageUrl = document.querySelector(".thumb")?.querySelector("img")?.getAttribute("src");
            if (aHref && chapter) {
              return {
                title,
                chapterUrl: aHref,
                latestChapter: chapter,
                imageUrl,
              };
            }
          }
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
          source: SeriesSource.AsuraScans,
          chapterUrl: s.chapterUrl!,
          imageUrl: s.imageUrl!,
        };
      });
  },
  async getLatestId({ browser }: { browser: any }): Promise<string | null> {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    try {
      await page.goto("https://asuratoon.com/", { waitUntil: "networkidle2" });
      await page.waitForSelector(".series");
      const data = (await page.evaluate(() => {
        const elems = document.getElementsByClassName("series");
        const firstSeries = elems[4] as HTMLAnchorElement;
        const seriesUrl = firstSeries.href;
        const maybeSeriesId = seriesUrl.split("manga/")[1].split("-")[0];
        return Number.isNaN(parseInt(maybeSeriesId)) ? null : maybeSeriesId;
      })) as any;
      return data;
    } catch (e) {
      return null;
    } finally {
      await page.close();
    }
  },
};
