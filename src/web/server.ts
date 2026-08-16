import page from "./index.html";
import prisma from "../prisma";
import client from "../client";
import { addSeriesToGuild, listGuildSeries, removeSeriesFromGuild, GuildSeriesEntry } from "../series-service";
import { SUPPORTED_HOSTNAMES } from "../utils/try-to-determine-series-source";
import { AddSeriesRequest, AddSeriesResponse, ApiError, ListSeriesResponse, SeriesDto } from "./api-types";
import { assessCompletion } from "../series-status";

/**
 * The web UI for managing the catalog. Deliberately unauthenticated — it is only
 * deployed on a private network.
 */

const toDto = (entry: GuildSeriesEntry, names: ReadonlyMap<string, string | null>): SeriesDto => {
  const verdict = assessCompletion(
    {
      upstreamStatus: entry.series.upstreamStatus,
      latestChapterPublishedAt: entry.series.latestChapterPublishedAt,
      sourceChapterCount: entry.series.sourceChapterCount,
      latestChapter: entry.series.latestChapter,
      consecutiveFailures: entry.series.consecutiveFailures,
    },
    new Date()
  );

  return {
    id: entry.series.id,
    name: entry.series.name,
    url: entry.series.url,
    source: entry.series.source,
    latestChapter: entry.series.latestChapter,
    imageUrl: entry.series.imageUrl,
    lastSuccessAt: entry.series.lastSuccessAt.toISOString(),
    lastAttemptAt: entry.series.lastAttemptAt?.toISOString() ?? null,
    consecutiveFailures: entry.series.consecutiveFailures,
    lastFailureReason: entry.series.lastFailureReason,
    lastFailureMessage: entry.series.lastFailureMessage,
    latestChapterAt: entry.series.latestChapterAt?.toISOString() ?? null,
    latestChapterPublishedAt: entry.series.latestChapterPublishedAt?.toISOString() ?? null,
    addedAt: entry.addedAt.toISOString(),
    subscribers: entry.subscriberIds.map((id) => ({ id, name: names.get(id) ?? null })),
    upstreamState: verdict.state,
    upstreamStatusRaw: entry.series.upstreamStatus,
    dormant: verdict.dormant,
    chaptersBehind: verdict.behind,
    looksCompleted: verdict.looksCompleted,
    chapterTotalKnown: verdict.chapterTotalKnown,
    author: entry.series.author,
  };
};

/**
 * Subscriber rows store Discord user ids; the display names live with the bot.
 * Explicit-id member fetches need no privileged intent and carry per-guild
 * nicknames; `time` caps the gateway wait so a hiccup cannot stall the list.
 */
const resolveSubscriberNames = async (guildId: string, ids: string[]): Promise<Map<string, string | null>> => {
  const names = new Map<string, string | null>(ids.map((id) => [id, null]));
  if (!client.isReady() || ids.length === 0) {
    return names;
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    const members = await guild.members.fetch({ user: ids, time: 5_000 });
    for (const [id, member] of members) {
      names.set(id, member.displayName);
    }
  } catch (error) {
    console.error("Could not fetch guild members for subscriber names:", error);
  }

  // Anyone still unresolved (left the guild, or the member fetch failed) gets
  // their global profile name; discord.js caches these after the first lookup.
  for (const id of ids) {
    if (names.get(id) === null) {
      try {
        names.set(id, (await client.users.fetch(id)).displayName);
      } catch {
        // Deleted or unknown account — the UI falls back to the raw id.
      }
    }
  }

  return names;
};

const apiError = (error: string, status: number) => Response.json({ error } satisfies ApiError, { status });

// The bot serves one guild in practice; the web UI simply manages the oldest one
// rather than growing a guild picker nobody would use.
const resolveGuild = () => prisma.guild.findFirst({ orderBy: { createdAt: "asc" } });

const noGuildYet = () =>
  apiError("No guild is registered yet — invite the bot to a server, or run scripts/seed-dev.ts locally", 503);

export const startWebServer = () => {
  const server = Bun.serve({
    port: Number(process.env.PORT) || 3000,
    hostname: "0.0.0.0",
    development: process.env.NODE_ENV !== "production",
    // An in-flight add scrapes the source before writing any response bytes, which
    // counts as "idle" — the 10s default would kill the socket mid-request.
    idleTimeout: 60,

    routes: {
      "/": page,
      "/healthz": Response.json({ ok: true }),

      "/api/series": {
        GET: async () => {
          const guild = await resolveGuild();
          if (!guild) {
            return Response.json({ guild: null, series: [] } satisfies ListSeriesResponse);
          }

          const entries = await listGuildSeries(guild.id);
          const names = await resolveSubscriberNames(guild.id, [...new Set(entries.flatMap((e) => e.subscriberIds))]);
          return Response.json({
            guild: { id: guild.id, name: guild.name },
            series: entries.map((entry) => toDto(entry, names)),
          } satisfies ListSeriesResponse);
        },

        POST: async (req) => {
          const guild = await resolveGuild();
          if (!guild) {
            return noGuildYet();
          }

          let body: Partial<AddSeriesRequest>;
          try {
            body = (await req.json()) as Partial<AddSeriesRequest>;
          } catch {
            return apiError("Request body must be JSON", 400);
          }

          const url = typeof body?.url === "string" ? body.url.trim() : "";
          if (!url) {
            return apiError('Provide a series URL as { "url": "…" }', 400);
          }

          const result = await addSeriesToGuild(guild.id, url);
          if (!result.ok) {
            switch (result.reason) {
              case "unsupported-url":
                return apiError(
                  `Unsupported URL — must be an https link to one of: ${SUPPORTED_HOSTNAMES.join(", ")}`,
                  400
                );
              case "scrape-failed":
                // The reason comes from the scraper now, so a blocked source and a
                // mistyped URL no longer read identically.
                return apiError(`Could not fetch that series from its source — ${result.detail}`, 502);
              case "name-conflict":
                return apiError(
                  result.conflictingSeries
                    ? `That title already belongs to a different series: ${result.conflictingSeries.url}`
                    : "That title already belongs to a different series",
                  409
                );
            }
          }

          const subscriptions = await prisma.subscription.findMany({
            where: { guildId: guild.id, seriesId: result.series.id },
            select: { userId: true },
          });
          const subscriberIds = subscriptions.map((sub) => sub.userId);
          const names = await resolveSubscriberNames(guild.id, subscriberIds);

          return Response.json(
            {
              series: toDto({ series: result.series, addedAt: result.addedAt, subscriberIds }, names),
              alreadyInCatalog: result.alreadyInCatalog,
            } satisfies AddSeriesResponse,
            { status: result.alreadyInCatalog ? 200 : 201 }
          );
        },
      },

      "/api/series/:id": {
        DELETE: async (req) => {
          const guild = await resolveGuild();
          if (!guild) {
            return noGuildYet();
          }

          const result = await removeSeriesFromGuild(guild.id, { seriesId: req.params.id });
          if (!result.ok) {
            return apiError(
              result.reason === "not-found" ? "Series not found" : "Series is not in this guild's catalog",
              404
            );
          }

          return new Response(null, { status: 204 });
        },
      },
    },

    error: (error) => {
      console.error("Web request failed:", error);
      return apiError("Internal server error", 500);
    },
  });

  console.log(`Web UI listening on http://localhost:${server.port}`);
  return server;
};
