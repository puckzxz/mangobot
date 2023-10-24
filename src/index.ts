import { Events } from "discord.js";
import client from "./client";
import prisma from "./prisma";
import fs from "fs";
import { Command } from "./types/command";
import schedule from "node-schedule";
import fetchManga from "./fetch-manga";

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

  const guildsSeries = await prisma.guildsSeries.findMany({
    where: {},
    include: {
      Guild: true,
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
      // This should never happen :^)
      continue;
    }
    // Parse float here since sometimes we'll have partial chapters
    // For example we'll have 97, 98, **98.5**, 99, 100 - so we need to parse
    if (parseFloat(update.latestChapter) > parseFloat(serie.latestChapter)) {
      const relevantGuilds = guildsSeries.filter((gs) => gs.seriesId === serie.id);

      for (const guild of relevantGuilds) {
        if (!guild.Guild.updatesChannelId) {
          // Can't post updates if they don't have a channel set
          continue;
        }
        const channel = client.channels.cache.get(guild.Guild.updatesChannelId);

        if (channel && channel.isTextBased()) {
          channel.send(`New chapter of ${serie.name} is out! ${update.chapterUrl}`);
        }
      }

      await prisma.series.update({
        where: {
          id: serie.id,
        },
        data: {
          latestChapter: update.latestChapter,
          lastCheckedAt: new Date(),
        },
      });
    } else {
      await prisma.series.update({
        where: {
          id: serie.id,
        },
        data: {
          lastCheckedAt: new Date(),
        },
      });
    }
  }

  console.log(
    `Finished checking for updates at ${new Date().toISOString()}, next check at ${job.nextInvocation().toISOString()}`
  );
});

job.invoke();

client.login(process.env.DISCORD_TOKEN);
