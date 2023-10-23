import { SeriesSource } from "@prisma/client";

const tryToDetermineSource = (url: string): SeriesSource | null => {
  if (url.startsWith("https://mangasee123.com")) {
    return SeriesSource.MangaSee;
  }

  if (url.startsWith("https://asura")) {
    return SeriesSource.AsuraScans;
  }

  if (url.startsWith("https://mangadex.org")) {
    return SeriesSource.MangaDex;
  }

  return null;
};

export default tryToDetermineSource;