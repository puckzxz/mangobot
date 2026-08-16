import { Events, Guild, type SendableChannels } from "discord.js";
import client from "./client";
import prisma from "./prisma";
import schedule from "node-schedule";
import fetchManga from "./fetch-manga";
import type { ScraperResult } from "./types/scraper";
import { recordFailure, recordSuccess } from "./scrape-recorder";
import { wasAlerted } from "./scrape-health";
import { type HealthEvent, buildHealthAlert } from "./health-alert";
import { buildAnnouncement } from "./announcement";
import { refreshAnilistTotals } from "./anilist-refresh";
import { isDueForScrape } from "./scrape-schedule";
import { handleInteraction, registerSlashCommands, slashCommands } from "./slash";
import { startWebServer } from "./web/server";

/**
 * Nothing below is allowed to take the process down. Bun exits with code 1 on an
 * unhandled rejection, and with `restart: always` a persistent failure became an
 * infinite crash-and-rescrape loop. Every handler catches its own errors; these are
 * the backstop for anything that still slips through.
 */
process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));
process.on("uncaughtException", (error) => console.error("Uncaught exception:", error));

const registerGuild = (guild: Guild) =>
  prisma.guild.upsert({
    where: { id: guild.id },
    update: { name: guild.name },
    create: { id: guild.id, name: guild.name },
  });

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}!`);

  // allSettled, and awaited: this was a floating async forEach, so a failing upsert
  // became an unhandled rejection and one failure hid the rest.
  const registrations = await Promise.allSettled(readyClient.guilds.cache.map(registerGuild));
  for (const [index, result] of registrations.entries()) {
    if (result.status === "rejected") {
      console.error(`Failed to register guild ${index}:`, result.reason);
    }
  }

  console.log(`Loaded ${slashCommands.length} slash commands, watching ${readyClient.guilds.cache.size} guild(s)`);

  // Before the first scrape: a pass takes over a minute, and commands should be
  // usable while it runs. Registration is idempotent, so doing it every boot keeps
  // Discord's copy in step with the code without any migration step.
  await Promise.all(readyClient.guilds.cache.map(registerSlashCommands));

  // Only start scraping once the gateway is connected, otherwise the channel cache
  // is empty and the first pass posts nothing while still advancing latestChapter.
  void runUpdateCheck();
});

// Guilds joined while the bot is running previously had no row at all, so every
// command against them failed on a foreign key.
client.on(Events.GuildCreate, async (guild) => {
  try {
    await registerGuild(guild);
    // Guild-scoped commands exist only where they were written, so a server joined
    // after boot would otherwise have none until the next restart.
    await registerSlashCommands(guild);
    console.log(`Joined guild ${guild.name}`);
  } catch (error) {
    console.error(`Failed to register guild ${guild.name}:`, error);
  }
});

client.on(Events.InteractionCreate, handleInteraction);

/**
 * A pass takes over two minutes with pacing, and a stalled upstream could make it
 * much longer. Without this, the 30-minute schedule would stack passes on top of
 * each other and double-post.
 */
let updateCheckRunning = false;

/**
 * Metadata refresh budget. At 5 per pass the 49 WeebCentral series are covered in
 * about five hours of passes; after that the TTL keeps the steady-state cost to
 * roughly 7 extra requests a day for the whole catalog.
 */
const STATUS_REFRESH_PER_PASS = 5;
const STATUS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const runUpdateCheck = async () => {
  if (updateCheckRunning) {
    console.warn("Previous update check is still running — skipping this tick");
    return;
  }
  updateCheckRunning = true;

  const startedAt = Date.now();

  try {
    console.log(`Checking for updates at ${new Date().toISOString()}`);

    const allSeries = await prisma.series.findMany({ include: { subscription: true } });
    const guildsSeries = await prisma.guildsSeries.findMany({ include: { guild: true } });

    // Back off series that have not produced a chapter in months. This is keyed on
    // observed silence, never on upstream status — a site calling something
    // Complete is not evidence it has stopped, and slowing those down would delay
    // the announcements this bot exists to make.
    const now = new Date();
    const series = allSeries.filter((s) => isDueForScrape({ ...s, latestChapter: s.latestChapter }, now));
    const skipped = allSeries.length - series.length;

    // Status changes on the order of months, and WeebCentral charges a second
    // request for it. Refreshing the few stalest rows per pass covers the whole
    // catalog in a handful of hours and then costs roughly nothing: once every row
    // is inside the TTL, no row qualifies and no extra request is made.
    const dueForMetadata = new Set(
      (
        await prisma.series.findMany({
          where: {
            OR: [{ upstreamStatusAt: null }, { upstreamStatusAt: { lt: new Date(Date.now() - STATUS_TTL_MS) } }],
          },
          orderBy: { upstreamStatusAt: { sort: "asc", nulls: "first" } },
          take: STATUS_REFRESH_PER_PASS,
          select: { id: true },
        })
      ).map((row) => row.id)
    );

    const outcomes = await fetchManga(
      series.map((s) => ({ url: s.url, source: s.source, refreshMetadata: dueForMetadata.has(s.id) }))
    );

    // fetchManga guarantees one outcome per requested URL, so this loop walks the
    // rows we asked about rather than the results that came back. Iterating the
    // results is what made a failing series invisible: it fell out of the loop
    // entirely, no column was written, and nothing counted it.
    const byUrl = new Map(outcomes.map((outcome) => [outcome.seriesUrl, outcome]));

    let succeeded = 0;
    const failures: string[] = [];

    for (const serie of series) {
      const outcome = byUrl.get(serie.url);

      try {
        if (!outcome) {
          // reconcileOutcomes should make this unreachable; treat it as a fault
          // rather than trusting it.
          failures.push(`${serie.name}: no outcome returned`);
          continue;
        }

        if (!outcome.ok) {
          failures.push(`${serie.name} [${outcome.reason}] ${outcome.detail}`);
          const { consecutiveFailures, crossedThreshold } = await recordFailure(serie, outcome);
          if (crossedThreshold) {
            await postHealthAlert(
              serie,
              {
                kind: "failing",
                name: serie.name,
                consecutiveFailures,
                reason: outcome.reason,
                detail: outcome.detail,
              },
              guildsSeries
            );
          }
          continue;
        }

        succeeded++;

        // Read before applyUpdate, which clears the failure axis on success. Only a
        // series somebody was actually told about is worth an all-clear.
        const wasBroken = wasAlerted(serie.lastFailureReason, serie.consecutiveFailures);
        const failuresBefore = serie.consecutiveFailures;

        await applyUpdate(serie, outcome.result, guildsSeries);

        if (wasBroken) {
          await postHealthAlert(serie, { kind: "recovered", name: serie.name, failuresBefore }, guildsSeries);
        }
      } catch (error) {
        failures.push(`${serie.name}: threw while applying — ${error}`);
      }
    }

    // After the announcements, never before: AniList is not a chapter source and
    // must not sit in the path that delivers one.
    await refreshAnilistTotals().catch((error) => console.error("AniList refresh failed:", error));

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `Pass complete in ${seconds}s — checked=${series.length} ok=${succeeded} failed=${failures.length}` +
        ` skipped=${skipped} (backed off) of ${allSeries.length} total`
    );

    // The names matter more than the count: "6 failed" is not actionable, and this
    // is the only place a human learns a series has stopped working at all.
    for (const line of failures.slice(0, 15)) {
      console.error(`  [failed] ${line}`);
    }
    if (failures.length > 15) {
      console.error(`  [failed] …and ${failures.length - 15} more`);
    }
  } catch (error) {
    console.error("Update check failed:", error);
  } finally {
    updateCheckRunning = false;
  }
};

type SeriesRow = Awaited<ReturnType<typeof prisma.series.findMany<{ include: { subscription: true } }>>>[number];
type GuildSeriesRow = Awaited<ReturnType<typeof prisma.guildsSeries.findMany<{ include: { guild: true } }>>>[number];

/**
 * Where a series should be posted, once per guild that carries it.
 *
 * Shared by chapter announcements and health alerts, so "which channel, and can we
 * actually post there" has exactly one answer. A guild that resolves to nothing is
 * skipped rather than failing the others.
 */
const postTargets = async (seriesId: string, seriesName: string, guildsSeries: GuildSeriesRow[]) => {
  const targets: Array<{ guild: GuildSeriesRow["guild"]; guildId: string; channel: SendableChannels }> = [];

  for (const guildSeries of guildsSeries.filter((gs) => gs.seriesId === seriesId)) {
    const channelId = guildSeries.guild.updatesChannelId;
    if (!channelId) {
      console.warn(`${guildSeries.guild.name} has no updates channel — skipping ${seriesName}`);
      continue;
    }

    try {
      // fetch, not cache.get: the cache is cold on the first pass after a restart,
      // and a miss looked identical to "posted successfully".
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased() || !channel.isSendable()) {
        console.warn(`Cannot send to ${channelId} in ${guildSeries.guild.name}`);
        continue;
      }
      targets.push({ guild: guildSeries.guild, guildId: guildSeries.guildId, channel });
    } catch (error) {
      console.error(`Could not resolve the updates channel for ${guildSeries.guild.name}:`, error);
    }
  }

  return targets;
};

/**
 * Tells the server a series broke, or started working again.
 *
 * Cannot throw and cannot fail a pass: an alert is commentary on the work, and must
 * never become a reason the work is recorded as failed. No mentions either — this is
 * for whoever is looking, not something to wake anybody for.
 */
const postHealthAlert = async (serie: SeriesRow, event: HealthEvent, guildsSeries: GuildSeriesRow[]) => {
  try {
    const content = buildHealthAlert(event);
    for (const { guild, channel } of await postTargets(serie.id, serie.name, guildsSeries)) {
      await channel
        .send({ content, allowedMentions: { parse: [] } })
        .catch((error: unknown) =>
          console.error(`Could not post a health alert for ${serie.name} in ${guild.name}:`, error)
        );
    }
  } catch (error) {
    console.error(`Health alert for ${serie.name} could not be built or sent:`, error);
  }
};

const applyUpdate = async (serie: SeriesRow, update: ScraperResult, guildsSeries: GuildSeriesRow[]) => {
  // The caller starts from the row and hands it in, so results are matched to rows
  // by the URL we requested — never by the scraped title. Titles are mutable site
  // text: a re-romanisation froze "MAD (OOTORI Yuusuke)" at chapter 36, and an
  // appended word froze another at 212, both silently and both permanently.

  // Parse float here since sometimes we'll have partial chapters
  // For example we'll have 97, 98, **98.5**, 99, 100 - so we need to parse
  const scrapedChapter = parseFloat(update.latestChapter);
  const knownChapter = parseFloat(serie.latestChapter);

  // A non-numeric scrape used to reach the comparison as NaN, where every `>` is
  // false — indistinguishable from "no new chapter", and permanent.
  if (!Number.isFinite(scrapedChapter)) {
    console.error(`Refusing to compare non-numeric chapter ${JSON.stringify(update.latestChapter)} for ${serie.name}`);
    return;
  }

  // If a past parse bug stored a non-numeric value, every future comparison against
  // it would also be false. Treat that as unknown so the next good scrape repairs it.
  const isNewChapter = !Number.isFinite(knownChapter) || scrapedChapter > knownChapter;

  if (!isNewChapter) {
    await recordSuccess(serie, update, { announced: false, deliveryFailed: false });
    return;
  }

  console.log(`New chapter for ${serie.name} - ${update.chapterUrl}`);

  let delivered = false;

  for (const { guild, guildId, channel } of await postTargets(serie.id, serie.name, guildsSeries)) {
    try {
      const mentions = serie.subscription
        .filter((s) => s.guildId === guildId)
        .map((s) => `<@${s.userId}>`)
        .join(" ");

      await channel.send(
        buildAnnouncement({
          seriesName: serie.name,
          seriesUrl: serie.url,
          source: serie.source,
          chapter: update.latestChapter,
          chapterUrl: update.chapterUrl,
          imageUrl: update.imageUrl ?? serie.imageUrl,
          mentions,
          publishedAt: update.publishedAt ?? null,
        })
      );
      delivered = true;
      console.log(`Posted update for ${serie.name} in ${guild.name}`);
    } catch (error) {
      console.error(`Failed to post ${serie.name} in ${guild.name}:`, error);
    }
  }

  await recordSuccess(serie, update, { announced: delivered, deliveryFailed: !delivered });

  if (!delivered) {
    console.error(`Nobody received ${serie.name} ch.${update.latestChapter} — leaving it pending for the next pass`);
  }
};

// The web UI shares this process so it can reuse the Prisma singleton and reach
// the Discord client for catalog rebuilds. A failed bind (port already taken)
// throws and takes startup down loudly, same as a missing DATABASE_URL.
const server = startWebServer();

// Without this the container is SIGKILLed mid-pass, which can land between a
// successful send and the row update and re-announce the chapter on restart.
const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down`);
  await schedule.gracefulShutdown().catch(() => {});
  // Force-close in-flight web requests: a hung add-scrape must not out-wait
  // Docker's SIGTERM grace. Prisma disconnects last so handlers can still write.
  await server.stop(true).catch(() => {});
  await client.destroy().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

if (process.env.DISCORD_TOKEN) {
  schedule.scheduleJob("*/30 * * * *", runUpdateCheck);

  client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error("Failed to log in:", error);
    process.exit(1);
  });
} else {
  // Deliberate, for local frontend work: the web UI is fully functional against
  // the database alone. A prod .env always sets the token.
  console.warn("DISCORD_TOKEN is not set — web-only mode: no Discord login, no scheduled update checks");
}
