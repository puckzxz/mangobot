import { Chapter, Relationship } from "../types/mangdaex-chapter";
import { Scraper, ScrapeOutcome, failure, statusReason, success } from "../types/scraper";
import { SeriesSource } from "../db";
import extractMangadexId from "../utils/extract-mangadex-id";
import { fetchWithPolicy } from "../http";

const baseUrl = "https://api.mangadex.org";
const SOURCE = SeriesSource.MangaDex;

/** MangaDex rate-limits at roughly 5 requests/second, and this makes two per series. */
const REQUEST_GAP_MS = 350;

const request = (path: string) => fetchWithPolicy(`${baseUrl}${path}`);

/**
 * MangaDex stores the canonical title in its original language, so `title.en` is
 * frequently absent — Frieren returns only `ja-ro`. Reading `.en` directly yielded
 * `undefined`, which then matched no series row and froze that series permanently.
 */
export const pickTitle = (manga: Relationship | undefined): string | undefined => {
  const titles = manga?.attributes?.title ?? {};
  const altTitles = manga?.attributes?.altTitles ?? [];
  return titles.en ?? altTitles.find((alt) => alt.en)?.en ?? Object.values(titles).find(Boolean);
};

/** A missing cover must never drop the update — the column is nullable. */
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

const scraper: Scraper = {
  requestGapMs: REQUEST_GAP_MS,

  async scrapeOne(url: string): Promise<ScrapeOutcome> {
    const id = extractMangadexId(url);
    if (!id) {
      return failure(url, SOURCE, "derive-url", `could not extract a series id from ${url}`);
    }

    const response = await request(
      `/manga/${id}/feed?translatedLanguage[]=en&order[chapter]=desc&includes[]=manga&limit=1`
    );
    if (!response.ok) {
      return failure(url, SOURCE, statusReason(response.status), `feed returned ${response.status}`, response.status);
    }

    const json = (await response.json()) as Chapter;
    const latest = json.data[0];
    if (!latest) {
      return failure(url, SOURCE, "empty", "no English chapters available (they may have been purged)");
    }

    const title = pickTitle(latest.relationships.find((r) => r.type === "manga"));
    const latestChapter = latest.attributes.chapter;

    if (!title || !latestChapter) {
      return failure(url, SOURCE, "parse", `missing a ${!title ? "title" : "chapter number"}`);
    }

    const readableAt = latest.attributes.readableAt ?? latest.attributes.publishAt;
    const publishedAt = readableAt ? new Date(readableAt) : undefined;

    return success({
      title,
      latestChapter,
      // Chapters hosted elsewhere (Manga Plus, webnovel sites) have no readable page
      // on mangadex.org, so link where the chapter actually is.
      chapterUrl: latest.attributes.externalUrl ?? `https://mangadex.org/chapter/${latest.id}`,
      seriesUrl: url,
      source: SOURCE,
      imageUrl: await fetchCover(id),
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
    });
  },
};

export default scraper;
