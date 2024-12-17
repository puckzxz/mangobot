import { SeriesSource } from "@prisma/client";

export const tryToDetermineSeriesSource = (url: string): SeriesSource | null => {
  if (url.startsWith("https://mangasee123.com")) {
    return SeriesSource.MangaSee;
  }

  if (url.startsWith("https://asura")) {
    return SeriesSource.AsuraScans;
  }

  if (url.startsWith("https://mangadex.org")) {
    return SeriesSource.MangaDex;
  }

  if (url.startsWith("https://reaperscans.com")) {
    return SeriesSource.ReaperScans;
  }

  if (url.startsWith("https://weebcentral.com")) {
    return SeriesSource.WeebCentral;
  }

  return null;
};
