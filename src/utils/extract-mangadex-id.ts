import { tryToDetermineSeriesSource } from "./try-to-determine-series-source";
import { SeriesSource } from "../db";

/** MangaDex series ids are UUIDs; anything else is a paste of the wrong URL. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns null rather than throwing. `url.split("/title/")[1]` was `undefined` for
 * any mangadex.org URL without a `/title/` segment — a chapter link, or the bare
 * domain — and calling `.includes` on it threw a TypeError that surfaced to the
 * user only as the generic "there was an error" reply.
 */
const extractMangadexId = (url: string): string | null => {
  if (tryToDetermineSeriesSource(url) !== SeriesSource.MangaDex) {
    return null;
  }

  const afterTitle = url.split("/title/")[1];
  if (!afterTitle) {
    return null;
  }

  const id = afterTitle.split("/")[0]?.split("?")[0] ?? "";
  return UUID.test(id) ? id : null;
};

export default extractMangadexId;
