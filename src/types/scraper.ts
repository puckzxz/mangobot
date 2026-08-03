import { SeriesSource } from "../db";

export interface ScraperResult {
  title: string;
  /** The URL we asked for, carried through so results never have to be re-matched to inputs. */
  seriesUrl: string;
  chapterUrl: string;
  latestChapter: string;
  source: SeriesSource;
  /** Optional: `series.image_url` is nullable, and a missing cover must never drop an update. */
  imageUrl: string | undefined;
}
