import prisma from "./prisma";
import { Prisma, Series } from "./db";
import fetchManga from "./fetch-manga";
import { tryToDetermineSeriesSource } from "./utils/try-to-determine-series-source";
import extractMangadexId from "./utils/extract-mangadex-id";
import { updateCatalog } from "./update-catalog";

/**
 * The one implementation of add/remove/list, shared by the Discord commands and
 * the web API. Both callers translate these results into their own replies; the
 * catalog refresh is owned here so no caller can forget it.
 */

export type AddSeriesResult =
  | { ok: true; series: Series; addedAt: Date; alreadyInCatalog: boolean }
  | { ok: false; reason: "unsupported-url" | "scrape-failed" }
  | { ok: false; reason: "name-conflict"; conflictingSeries: { name: string; url: string } | null };

export type RemoveSeriesResult =
  { ok: true; seriesName: string; seriesRowDeleted: boolean } | { ok: false; reason: "not-found" | "not-in-catalog" };

export type GuildSeriesEntry = {
  series: Series;
  addedAt: Date;
  subscriberIds: string[];
};

const refreshCatalog = (guildId: string) =>
  updateCatalog(guildId).catch((error) => console.error("Failed to update the catalog:", error));

export const addSeriesToGuild = async (guildId: string, url: string): Promise<AddSeriesResult> => {
  const source = tryToDetermineSeriesSource(url);
  if (!source) {
    return { ok: false, reason: "unsupported-url" };
  }

  const [scraped] = await fetchManga([{ url, source }]);
  if (!scraped) {
    return { ok: false, reason: "scrape-failed" };
  }

  const { title, latestChapter, seriesUrl, imageUrl } = scraped;
  const fields = {
    name: title,
    latestChapter,
    sourceId: extractMangadexId(seriesUrl),
    source: scraped.source,
    imageUrl,
  };

  let series: Series;
  try {
    // Keyed by URL, not by the scraped title: titles are mutable site text, and the
    // update loop joins by URL for the same reason. Re-adding a URL after the site
    // re-titles it updates `name` in place; the only P2002 left is a genuine
    // "another series already owns this title".
    series = await prisma.series.upsert({
      where: { url: seriesUrl },
      update: fields,
      create: { ...fields, url: seriesUrl },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const conflicting = await prisma.series.findUnique({ where: { name: title } });
      return {
        ok: false,
        reason: "name-conflict",
        conflictingSeries: conflicting ? { name: conflicting.name, url: conflicting.url } : null,
      };
    }
    throw error;
  }

  const key = { guildId, seriesId: series.id };
  const existing = await prisma.guildsSeries.findUnique({ where: { guildId_seriesId: key } });
  const link = existing ?? (await prisma.guildsSeries.create({ data: key }));

  // Even a re-add can change the catalog: the upsert above may have renamed the series.
  void refreshCatalog(guildId);

  return { ok: true, series, addedAt: link.createdAt, alreadyInCatalog: existing !== null };
};

export const removeSeriesFromGuild = async (
  guildId: string,
  ref: { seriesId: string } | { url: string }
): Promise<RemoveSeriesResult> => {
  const series = await prisma.series.findUnique({
    where: "seriesId" in ref ? { id: ref.seriesId } : { url: ref.url },
  });
  if (!series) {
    return { ok: false, reason: "not-found" };
  }

  const key = { guildId, seriesId: series.id };

  const removed = await prisma.$transaction(async (tx) => {
    const link = await tx.guildsSeries.findUnique({ where: { guildId_seriesId: key } });
    if (!link) {
      return null;
    }

    await tx.subscription.deleteMany({ where: key });
    await tx.guildsSeries.delete({ where: { guildId_seriesId: key } });

    // Once no guild references the series, scraping it every 30 minutes serves
    // nobody — delete the row outright. Any subscriptions still pointing at it are
    // orphans by definition here, and the FK is restrict, so they go first.
    const remaining = await tx.guildsSeries.count({ where: { seriesId: series.id } });
    if (remaining === 0) {
      await tx.subscription.deleteMany({ where: { seriesId: series.id } });
      await tx.series.delete({ where: { id: series.id } });
    }

    return { seriesRowDeleted: remaining === 0 };
  });

  if (!removed) {
    return { ok: false, reason: "not-in-catalog" };
  }

  void refreshCatalog(guildId);

  return { ok: true, seriesName: series.name, seriesRowDeleted: removed.seriesRowDeleted };
};

export const listGuildSeries = async (guildId: string): Promise<GuildSeriesEntry[]> => {
  const rows = await prisma.guildsSeries.findMany({
    where: { guildId },
    // Catalog order — the same ordering update-catalog.ts renders.
    orderBy: { createdAt: "asc" },
    include: {
      series: {
        include: { subscription: { where: { guildId }, select: { userId: true } } },
      },
    },
  });

  return rows.map((row) => ({
    series: row.series,
    addedAt: row.createdAt,
    subscriberIds: row.series.subscription.map((sub) => sub.userId),
  }));
};
