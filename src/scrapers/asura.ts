import { SeriesSource } from "@prisma/client";
import { ScraperResult, ScraperArgs } from "../types/scraper";

export default {
  async scrape({ browser, urls }: ScraperArgs): Promise<ScraperResult[]> {
    const page = await browser.newPage();
    let series: any[] = [];
    let seriesUrllist: string[] = [];
    try {
      for (const url of urls) {
        seriesUrllist.push(url);
        await page.goto(url, { timeout: 0, waitUntil: "domcontentloaded" });
        const data = (await page.evaluate(() => {
          const title = document.querySelector("span.text-xl.font-bold")?.textContent;
          const imageUrl = document.querySelector('img[alt="poster"]')?.getAttribute("src");
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
};
