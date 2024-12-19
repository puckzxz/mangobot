import { fetchManga } from "../fetch-manga";
import prisma from "../prisma";
import client from "../client";
import schedule from "node-schedule";

const checkForMangaUpdates = schedule.scheduleJob("*/30 * * * *", async () => {
  console.log(`Checking for updates at ${new Date().toISOString()}`);
  const series = await prisma.series.findMany({
    include: {
      subscription: true,
    },
  });

  const guildsSeries = await prisma.guildsSeries.findMany({
    where: {},
    include: {
      guild: true,
    },
  });

  const seriesUpdates = await fetchManga(
    series.map((s) => ({
      url: s.url,
      source: s.source,
    }))
  );

  for (const update of seriesUpdates) {
    const serie = series.find((s) => s.name === update.title);
    if (!serie) {
      console.log(`Could not find serie ${update.title} - for update ${update.chapterUrl}`);
      continue;
    }
    // Parse float here since sometimes we'll have partial chapters
    // For example we'll have 97, 98, **98.5**, 99, 100 - so we need to parse
    if (parseFloat(update.latestChapter) > parseFloat(serie.latestChapter)) {
      console.log(`New chapter for ${serie.name} - ${update.chapterUrl}`);
      const relevantGuilds = guildsSeries.filter((gs) => gs.seriesId === serie.id);

      for (const guild of relevantGuilds) {
        if (!guild.guild.updatesChannelId) {
          // Can't post updates if they don't have a channel set
          continue;
        }
        const channel = client.channels.cache.get(guild.guild.updatesChannelId);

        if (channel && channel.isTextBased()) {
          const ok = await channel.send(
            `New chapter of ${serie.name} is out! ${update.chapterUrl}\n${serie.subscription
              .map((s) => `<@${s.userId}>`)
              .join(" ")}`
          );
          ok
            ? console.log(`Posted update for ${serie.name} in ${guild.guild.name}`)
            : console.log(`Failed to post update for ${serie.name} in ${guild.guild.name}`);
        }
      }

      await prisma.series.update({
        where: {
          id: serie.id,
        },
        data: {
          latestChapter: update.latestChapter,
          lastCheckedAt: new Date(),
          imageUrl: update.imageUrl,
        },
      });
    } else {
      // console.log(`No new chapter for ${serie.name}`);
      await prisma.series.update({
        where: {
          id: serie.id,
        },
        data: {
          lastCheckedAt: new Date(),
          imageUrl: update.imageUrl,
        },
      });
    }
  }

  console.log(
    `Finished checking for updates at ${new Date().toISOString()}, next check at ${checkForMangaUpdates
      .nextInvocation()
      .toISOString()}`
  );
});

export { checkForMangaUpdates };
