import prisma from "./prisma";
import { Prisma, Series } from "./db";
import fetchManga from "./fetch-manga";
import { tryToDetermineSeriesSource } from "./utils/try-to-determine-series-source";
import extractMangadexId from "./utils/extract-mangadex-id";

/**
 * The one implementation of add/remove/list, shared by the slash commands and the
 * web API. Both callers translate these results into their own replies.
 *
 * Adding and removing used to rebuild the reaction catalog from here, which meant
 * every add paid for deleting up to a hundred Discord messages and re-adding one
 * reaction per series against a rate limit. `/subscribe` reads the catalog from
 * the database instead, so there is nothing left to keep in sync.
 */

export type AddSeriesResult =
  | { ok: true; series: Series; addedAt: Date; alreadyInCatalog: boolean }
  | { ok: false; reason: "unsupported-url" }
  | { ok: false; reason: "scrape-failed"; detail: string }
  | { ok: false; reason: "name-conflict"; conflictingSeries: { name: string; url: string } | null };

export type RemoveSeriesResult =
  { ok: true; seriesName: string; seriesRowDeleted: boolean } | { ok: false; reason: "not-found" | "not-in-catalog" };

export type GuildSeriesEntry = {
  series: Series;
  addedAt: Date;
  subscriberIds: string[];
};

export const addSeriesToGuild = async (guildId: string, url: string): Promise<AddSeriesResult> => {
  const source = tryToDetermineSeriesSource(url);
  if (!source) {
    return { ok: false, reason: "unsupported-url" };
  }

  const [outcome] = await fetchManga([{ url, source }]);
  if (!outcome || !outcome.ok) {
    // Carry the reason through so the caller can say *why* instead of the blanket
    // "something went wrong" both surfaces used to show.
    return {
      ok: false,
      reason: "scrape-failed",
      detail: outcome ? `${outcome.reason}: ${outcome.detail}` : "the scraper returned no outcome",
    };
  }

  const { title, latestChapter, seriesUrl, imageUrl } = outcome.result;
  const fields = {
    name: title,
    latestChapter,
    sourceId: extractMangadexId(seriesUrl),
    source: outcome.result.source,
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

  return { ok: true, seriesName: series.name, seriesRowDeleted: removed.seriesRowDeleted };
};

export const listGuildSeries = async (guildId: string): Promise<GuildSeriesEntry[]> => {
  const rows = await prisma.guildsSeries.findMany({
    where: { guildId },
    // Oldest first, which is the order the panel and the /subscribe suggestions
    // both present — stable, and independent of titles that upstream can rename.
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
