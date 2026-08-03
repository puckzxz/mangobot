import { Chapter, Relationship } from "../types/mangdaex-chapter";
import { ScraperResult } from "../types/scraper";
import { SeriesSource } from "../db";
import extractMangadexId from "../utils/extract-mangadex-id";
import { USER_AGENT } from "../user-agent";

const baseUrl = "https://api.mangadex.org";

/** MangaDex rate-limits at roughly 5 requests/second, and this makes two per series. */
const REQUEST_GAP_MS = 350;

const request = (path: string) => fetch(`${baseUrl}${path}`, { headers: { "User-Agent": USER_AGENT } });

/**
 * MangaDex stores the canonical title in its original language, so `title.en` is
 * frequently absent — Frieren returns only `ja-ro`. Reading `.en` directly yielded
 * `undefined`, which then matched no series row and froze that series permanently.
 */
const pickTitle = (manga: Relationship | undefined): string | undefined => {
  const titles = manga?.attributes?.title ?? {};
  const altTitles = manga?.attributes?.altTitles ?? [];
  return titles.en ?? altTitles.find((alt) => alt.en)?.en ?? Object.values(titles).find(Boolean);
};

/** A missing cover must never drop the update — the column is nullable and unread. */
const fetchCover = async (id: string): Promise<string | undefined> => {
  try {
    const response = await request(`/manga/${id}?includes[]=cover_art`);
    if (!response.ok) {
      console.error(`[mangadex] cover lookup returned ${response.status} for ${id}`);
      return undefined;
    }
    const body = (await response.json()) as {
      data?: { relationships?: Array<{ type: string; attributes?: { fileName?: string } }> };
    };
    const fileName = body.data?.relationships?.find((r) => r.type === "cover_art")?.attributes?.fileName;
    return fileName ? `https://uploads.mangadex.org/covers/${id}/${fileName}` : undefined;
  } catch (error) {
    console.error(`[mangadex] cover lookup failed for ${id}:`, error);
    return undefined;
  }
};

const scrapeOne = async (url: string): Promise<ScraperResult | null> => {
  const id = extractMangadexId(url);
  if (!id) {
    console.error(`[mangadex] could not extract a series id from ${url}`);
    return null;
  }

  const response = await request(
    `/manga/${id}/feed?translatedLanguage[]=en&order[chapter]=desc&includes[]=manga&limit=1`
  );
  if (!response.ok) {
    console.error(`[mangadex] feed returned ${response.status} for ${id}`);
    return null;
  }

  const json = (await response.json()) as Chapter;
  const latest = json.data[0];
  if (!latest) {
    console.error(`[mangadex] no English chapters available for ${id} (they may have been purged)`);
    return null;
  }

  const title = pickTitle(latest.relationships.find((r) => r.type === "manga"));
  const latestChapter = latest.attributes.chapter;

  if (!title || !latestChapter) {
    console.error(`[mangadex] ${id} is missing a ${!title ? "title" : "chapter number"} — skipping`);
    return null;
  }

  return {
    title,
    latestChapter,
    // Chapters hosted elsewhere (Manga Plus, webnovel sites) have no readable page
    // on mangadex.org, so link where the chapter actually is.
    chapterUrl: latest.attributes.externalUrl ?? `https://mangadex.org/chapter/${latest.id}`,
    seriesUrl: url,
    source: SeriesSource.MangaDex,
    imageUrl: await fetchCover(id),
  };
};

export default {
  async scrape(urls: string[]): Promise<ScraperResult[]> {
    const results: ScraperResult[] = [];

    for (const [index, url] of urls.entries()) {
      if (index > 0) await Bun.sleep(REQUEST_GAP_MS);
      try {
        const result = await scrapeOne(url);
        if (result) results.push(result);
      } catch (error) {
        // Previously nothing caught here, so a single rate-limit response became an
        // unhandled rejection that killed the process and discarded every other
        // source's already-collected results.
        console.error(`[mangadex] failed to scrape ${url}:`, error);
      }
    }

    return results;
  },
};
