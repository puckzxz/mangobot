import { SeriesSource } from "@prisma/client";
import { dispatchToSidecar } from "../dispatcher";
import { Command } from "../types/command";
import { ScraperResult } from "../types/scraper";

const tryDetermineSource = (url: string): SeriesSource | null => {
  if (url.startsWith("https://mangasee123.com")) {
    return SeriesSource.MangaSee;
  }

  if (url.startsWith("https://asura")) {
    return SeriesSource.AsuraScans;
  }

  return null;
};

const command: Command = {
  name: "add",
  description: "Add a manga to the database",
  group: "manga",
  usage: "add <url>",
  run: async ({ client, msg, prisma }, args) => {
    if (!args) {
      msg.channel.send("Please provide a url");
      return;
    }

    const url = args[0];

    const message = await msg.channel.send(`Adding <${url}> to the database...`);

    const seriesSource = tryDetermineSource(url);

    if (!seriesSource) {
      msg.channel.send("Could not determine source");
      return;
    }

    const data = await dispatchToSidecar<ScraperResult[]>({
      type: "scrape",
      data: [
        {
          url,
          source: seriesSource,
        },
      ],
    });

    if (!data) {
      msg.channel.send("Something went wrong");
      return;
    }

    const series = data[0];

    if (!series) {
      msg.channel.send("Something else went wrong");
      return;
    }

    const { title, latestChapter, seriesUrl, source, chapterUrl } = series;

    const dbSeries = await prisma.series.upsert({
      where: {
        name: title,
      },
      update: {
        latestChapter,
        url: seriesUrl,
        source,
      },
      create: {
        name: title,
        latestChapter,
        url: seriesUrl,
        source,
      },
    });

    await prisma.guildsSeries.upsert({
      where: {
        guildId_seriesId: {
          guildId: msg.guild!.id,
          seriesId: dbSeries.id,
        },
      },
      update: {},
      create: {
        guildId: msg.guild!.id,
        seriesId: dbSeries.id,
      },
    });

    message.edit(`Added <${url}> to the database`);
  },
};

export default command;
