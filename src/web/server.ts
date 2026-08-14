import page from "./index.html";
import prisma from "../prisma";
import { addSeriesToGuild, listGuildSeries, removeSeriesFromGuild, GuildSeriesEntry } from "../series-service";
import { SUPPORTED_HOSTNAMES } from "../utils/try-to-determine-series-source";
import { AddSeriesRequest, AddSeriesResponse, ApiError, ListSeriesResponse, SeriesDto } from "./api-types";

/**
 * The web UI for managing the catalog. Deliberately unauthenticated — it is only
 * deployed on a private network.
 */

const toDto = (entry: GuildSeriesEntry): SeriesDto => ({
  id: entry.series.id,
  name: entry.series.name,
  url: entry.series.url,
  source: entry.series.source,
  latestChapter: entry.series.latestChapter,
  imageUrl: entry.series.imageUrl,
  lastCheckedAt: entry.series.lastCheckedAt.toISOString(),
  addedAt: entry.addedAt.toISOString(),
  subscriberCount: entry.subscriberCount,
});

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
          return Response.json({
            guild: { id: guild.id, name: guild.name },
            series: entries.map(toDto),
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
                return apiError("Could not fetch that series from its source — check the URL", 502);
              case "name-conflict":
                return apiError(
                  result.conflictingSeries
                    ? `That title already belongs to a different series: ${result.conflictingSeries.url}`
                    : "That title already belongs to a different series",
                  409
                );
            }
          }

          const subscriberCount = await prisma.subscription.count({
            where: { guildId: guild.id, seriesId: result.series.id },
          });

          return Response.json(
            {
              series: toDto({ series: result.series, addedAt: result.addedAt, subscriberCount }),
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
