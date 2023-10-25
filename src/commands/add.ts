import { SeriesSource } from "@prisma/client";
import { Command } from "../types/command";
import fetchManga from "../fetch-manga";
import { tryToDetermineSeriesSource } from "../utils/try-to-determine-series-source";
import extractMangadexId from "../utils/extract-mangadex-id";
import { updateCatalog } from "../update-catalog";

const command: Command = {
  name: "add",
  description: "Add a manga to the database",
  group: "manga",
  usage: "add <url>",
  run: async ({ msg, prisma }, args) => {
    if (!args) {
      msg.channel.send("Please provide a url");
      return;
    }

    const url = args[0];

    const message = await msg.channel.send(`Adding <${url}> to the database...`);

    const seriesSource = tryToDetermineSeriesSource(url);

    if (!seriesSource) {
      msg.channel.send("Could not determine source");
      return;
    }

    const data = await fetchManga([
      {
        url: url,
        source: seriesSource,
      },
    ]);

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
        sourceId: extractMangadexId(seriesUrl),
        source,
      },
      create: {
        name: title,
        latestChapter,
        url: seriesUrl,
        sourceId: extractMangadexId(seriesUrl),
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

    updateCatalog(msg.guild!.id);
  },
};

export default command;
