import { Chapter } from "../types/mangdaex-chapter";
import { ScraperResult } from "../types/scraper";
import { SeriesSource } from "@prisma/client";
import extractMangadexId from "../utils/extract-mangadex-id";

const baseUrl = "https://api.mangadex.org";

export default {
  async scrape(urls: string[]): Promise<ScraperResult[]> {
    const results: ScraperResult[] = [];
    for (const url of urls) {
      const id = extractMangadexId(url);
      const response = await fetch(
        `${baseUrl}/manga/${id}/feed?translatedLanguage[]=en&order[chapter]=desc&includes[]=manga&limit=1`
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch latest chapter from id ${id}`);
      }

      const json = await (<Promise<Chapter>>response.json());

      if (!json.data.length) {
        throw new Error(`No chapters found for id ${id}`);
      }

      const latestChapter = json.data[0].attributes.chapter;
      const title = json.data[0].relationships.find((r) => r.type === "manga")!.attributes.title.en;
      const chapterId = json.data[0].id;
      const chapterUrl = `https://mangadex.org/chapter/${chapterId}`;
      const seriesUrl = `https://mangadex.org/title/${id}`;

      const fileAttributes = await fetch(`${baseUrl}/manga/${id}?includes[]=cover_art`).then((r) => r.json());
      const fileName = fileAttributes.data.relationships.find((r: any) => r.type === "cover_art")!.attributes
        .fileName;

      const imageUrl = `https://uploads.mangadex.org/covers/${id}/${fileName}`;

      results.push({
        title,
        latestChapter,
        chapterUrl,
        seriesUrl,
        source: SeriesSource.MangaDex,
        imageUrl,
      });
    }
    return results;
  },
};
