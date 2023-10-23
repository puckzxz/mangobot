import tryDetermineSource from "./try-to-determine-series-source";
import { SeriesSource } from "@prisma/client";

const extractMangadexId = (url: string): string | null => {
  if (tryDetermineSource(url) !== SeriesSource.MangaDex) {
    return null;
  }

  const split = url.split("/title/")[1];

  if (split.includes("/")) {
    return split.split("/")[0];
  }

  return split;
};

export default extractMangadexId;