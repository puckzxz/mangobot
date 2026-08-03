import { Events, Guild } from "discord.js";
import client from "./client";
import prisma from "./prisma";
import schedule from "node-schedule";
import fetchManga from "./fetch-manga";
import { emojiNumbers } from "./emoji";
import { commandsByName } from "./commands";
import { parseCatalogLine } from "./catalog-line";

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

  console.log(`Loaded ${commandsByName.size} commands, watching ${readyClient.guilds.cache.size} guild(s)`);

  // Only start scraping once the gateway is connected, otherwise the channel cache
  // is empty and the first pass posts nothing while still advancing latestChapter.
  void runUpdateCheck();
});

// Guilds joined while the bot is running previously had no row at all, so every
// command against them failed on a foreign key.
client.on(Events.GuildCreate, async (guild) => {
  try {
    await registerGuild(guild);
    console.log(`Joined guild ${guild.name}`);
  } catch (error) {
    console.error(`Failed to register guild ${guild.name}:`, error);
  }
});

client.on(Events.MessageCreate, async (msg) => {
  try {
    if (!msg.guild || !msg.content.startsWith("!")) {
      return;
    }

    const args = msg.content.slice(1).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();
    if (!commandName) {
      return;
    }

    const command = commandsByName.get(commandName);
    if (!command) {
      return;
    }

    if (command.usableBy && !command.usableBy.includes(msg.author.id)) {
      await msg.reply("You don't have permission to use that command.");
      return;
    }

    await command.run({ client, msg, prisma }, args);
  } catch (error) {
    console.error(`Command failed:`, error);
    await msg.channel
      .send("There was an error trying to execute that command!")
      .catch((sendError) => console.error("Could not report the command failure:", sendError));
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (user.bot) {
      return;
    }

    if (reaction.partial) {
      await reaction.fetch();
    }
    if (reaction.message.partial) {
      await reaction.message.fetch();
    }

    const guildId = reaction.message.guild?.id;
    if (!guildId) {
      return;
    }

    const guild = await prisma.guild.findUnique({ where: { id: guildId } });
    if (!guild || reaction.message.channel.id !== guild.catalogChannelId) {
      return;
    }

    const emoji = reaction.emoji.name;
    const emojiIndex = emoji ? emojiNumbers.indexOf(emoji) : -1;
    if (!emoji || emojiIndex === -1 || !reaction.message.content) {
      return;
    }

    const line = reaction.message.content.split("\n")[emojiIndex];
    const seriesName = line ? parseCatalogLine(emoji, line) : null;
    if (!seriesName) {
      return;
    }

    const serie = await prisma.series.findUnique({ where: { name: seriesName } });
    if (!serie) {
      console.error(`Catalog reaction referenced an unknown series: ${JSON.stringify(seriesName)}`);
      return;
    }

    const key = { guildId: guild.id, seriesId: serie.id, userId: user.id };
    const existing = await prisma.subscription.findUnique({ where: { guildId_seriesId_userId: key } });

    if (existing) {
      await prisma.subscription.delete({ where: { guildId_seriesId_userId: key } });
    } else {
      await prisma.subscription.create({ data: key });
    }

    // Needs Manage Messages. Uncaught, this let any member crash the bot on demand
    // simply by reacting in a channel where the permission was missing.
    await reaction.users.remove(user.id).catch((error) => console.error("Could not clear the reaction:", error));
  } catch (error) {
    console.error("Reaction handler failed:", error);
  }
});

/**
 * A pass takes over two minutes with pacing, and a stalled upstream could make it
 * much longer. Without this, the 30-minute schedule would stack passes on top of
 * each other and double-post.
 */
let updateCheckRunning = false;

const runUpdateCheck = async () => {
  if (updateCheckRunning) {
    console.warn("Previous update check is still running — skipping this tick");
    return;
  }
  updateCheckRunning = true;

  try {
    console.log(`Checking for updates at ${new Date().toISOString()}`);

    const series = await prisma.series.findMany({ include: { subscription: true } });
    const guildsSeries = await prisma.guildsSeries.findMany({ include: { guild: true } });

    const updates = await fetchManga(series.map((s) => ({ url: s.url, source: s.source })));

    for (const update of updates) {
      try {
        await applyUpdate(update, series, guildsSeries);
      } catch (error) {
        console.error(`Failed to apply update for ${update.title}:`, error);
      }
    }

    console.log(`Finished checking for updates at ${new Date().toISOString()}`);
  } catch (error) {
    console.error("Update check failed:", error);
  } finally {
    updateCheckRunning = false;
  }
};

type SeriesRow = Awaited<ReturnType<typeof prisma.series.findMany<{ include: { subscription: true } }>>>[number];
type GuildSeriesRow = Awaited<ReturnType<typeof prisma.guildsSeries.findMany<{ include: { guild: true } }>>>[number];

const applyUpdate = async (
  update: Awaited<ReturnType<typeof fetchManga>>[number],
  series: SeriesRow[],
  guildsSeries: GuildSeriesRow[]
) => {
  // Joined on the URL we asked for, not on the scraped title. Titles are mutable
  // site text: a re-romanisation froze "MAD (OOTORI Yuusuke)" at chapter 36, and an
  // appended word froze another at 212, both silently and both permanently.
  const serie = series.find((s) => s.url === update.seriesUrl);
  if (!serie) {
    console.error(`No series row for ${update.seriesUrl} (scraped as ${JSON.stringify(update.title)})`);
    return;
  }

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
    await prisma.series.update({
      where: { id: serie.id },
      data: { lastCheckedAt: new Date(), imageUrl: update.imageUrl },
    });
    return;
  }

  console.log(`New chapter for ${serie.name} - ${update.chapterUrl}`);

  let delivered = false;

  for (const guildSeries of guildsSeries.filter((gs) => gs.seriesId === serie.id)) {
    const channelId = guildSeries.guild.updatesChannelId;
    if (!channelId) {
      console.warn(`${guildSeries.guild.name} has no updates channel — skipping ${serie.name}`);
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

      const mentions = serie.subscription
        .filter((s) => s.guildId === guildSeries.guildId)
        .map((s) => `<@${s.userId}>`)
        .join(" ");

      await channel.send(`New chapter of ${serie.name} is out! ${update.chapterUrl}\n${mentions}`.trim());
      delivered = true;
      console.log(`Posted update for ${serie.name} in ${guildSeries.guild.name}`);
    } catch (error) {
      console.error(`Failed to post ${serie.name} in ${guildSeries.guild.name}:`, error);
    }
  }

  // Only advance the chapter once it actually reached somebody. Advancing on a
  // failed send lost that chapter permanently — the next pass compares against the
  // new number and sees nothing new.
  await prisma.series.update({
    where: { id: serie.id },
    data: {
      ...(delivered ? { latestChapter: update.latestChapter } : {}),
      lastCheckedAt: new Date(),
      imageUrl: update.imageUrl,
    },
  });

  if (!delivered) {
    console.error(`Nobody received ${serie.name} ch.${update.latestChapter} — leaving it pending for the next pass`);
  }
};

schedule.scheduleJob("*/30 * * * *", runUpdateCheck);

// Without this the container is SIGKILLed mid-pass, which can land between a
// successful send and the row update and re-announce the chapter on restart.
const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down`);
  await schedule.gracefulShutdown().catch(() => {});
  await client.destroy().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("Failed to log in:", error);
  process.exit(1);
});
