import { Events } from "discord.js";
import client from "./client";
import prisma from "./prisma";
import fs from "fs";
import { Command } from "./types/command";
import { dispatchToSidecar } from "./dispatcher";
import { ScraperResult } from "./types/scraper-result";
import schedule from "node-schedule";

const commands = new Map<string, Command>();

client.on(Events.ClientReady, (client) => {
  console.log(`Logged in as ${client.user?.tag}!`);
  client.guilds.cache.forEach(async (guild) => {
    console.log(`Logged in to guild ${guild.name}`);
    await prisma.guild.upsert({
      where: {
        id: guild.id,
      },
      update: {
        name: guild.name,
      },
      create: {
        id: guild.id,
        name: guild.name,
      },
    });
  });
  const commandFiles = fs.readdirSync("./src/commands").filter((file) => file.endsWith(".ts"));
  for (const file of commandFiles) {
    const command = require(`./commands/${file}`).default;
    commands.set(command.name, command);
    console.log(`Loaded command ${command.name}`);
  }
});

client.on(Events.MessageCreate, async (msg) => {
  if (!msg.guild) {
    return;
  }

  if (!msg.content.startsWith("!")) {
    return;
  }

  const args = msg.content.slice(1).trim().split(/ +/);

  const commandName = args.shift()?.toLowerCase();

  if (!commandName) {
    return;
  }

  const command = commands.get(commandName);

  if (!command) {
    return;
  }

  try {
    await command.run({ client, msg, prisma }, args);
  } catch (error) {
    console.error(error);
    msg.channel.send("There was an error trying to execute that command!");
  }
});

const job = schedule.scheduleJob("*/30 * * * *", async () => {
  const series = await prisma.series.findMany({});

  for (const serie of series) {
    const data = await dispatchToSidecar<ScraperResult[]>({
      type: "scrape",
      data: [
        {
          url: serie.url,
          source: serie.source,
        },
      ],
    });

    if (!data) {
      console.log("Something went wrong");
      return;
    }

    const returnedSeries = data[0];

    if (!returnedSeries) {
      console.log("Something else went wrong");
      return;
    }

    const { latestChapter } = returnedSeries;

    if (parseInt(latestChapter, 10) > parseInt(serie.latestChapter, 10)) {
      const guildSeries = await prisma.guildsSeries.findMany({
        where: {
          seriesId: serie.id,
        },
        include: {
          Guild: true,
        },
      });

      const relevantGuilds = guildSeries.map((gs) => gs.Guild);

      for (const guild of relevantGuilds) {
        const channel = client.guilds.cache.get(guild.id)?.channels.cache.find((c) => c.id === guild.updatesChannelId);

        if (channel && channel.isTextBased()) {
          channel.send(`New chapter of ${serie.name} is out! ${returnedSeries.chapterUrl}`);
        }
      }

      await prisma.series.update({
        where: {
          id: serie.id,
        },
        data: {
          latestChapter,
        },
      });
    }
  }
});

job.invoke();

client.login(process.env.DISCORD_TOKEN);
