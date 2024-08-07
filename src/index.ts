import { Events } from "discord.js";
import client from "./client";
import prisma from "./prisma";
import fs from "fs";
import { Command } from "./types/command";
import schedule from "node-schedule";
import fetchManga from "./fetch-manga";
import { emojiNumbers } from "./emoji";

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

  if (command.usableBy && !command.usableBy.includes(msg.author.id)) {
    await msg.channel.send(
      `You don't have permission to use this command, ${msg.author.displayName}! - ${command.usableBy
        .map((id) => `<@${id}>`)
        .join(" ")}`
    );
    return;
  }

  try {
    await command.run({ client, msg, prisma }, args);
  } catch (error) {
    console.error(error);
    msg.channel.send("There was an error trying to execute that command!");
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      return;
    }
  }
  if (!reaction.message.guild) {
    return;
  }

  if (user.bot) {
    return;
  }

  const guild = await prisma.guild.findUnique({
    where: {
      id: reaction.message.guild.id,
    },
  });

  if (!guild) {
    return;
  }

  if (reaction.message.channel.id !== guild.catalogChannelId) {
    return;
  }

  const emoji = reaction.emoji.name;

  if (!emoji || !emojiNumbers.includes(emoji)) {
    return;
  }

  const message = reaction.message;
  if (!message.content) {
    return;
  }

  const messageSeries = message.content.split("\n");

  const seriesFromIndex = messageSeries[emojiNumbers.indexOf(emoji)];

  if (!seriesFromIndex) {
    return;
  }

  const seriesName = seriesFromIndex
    .replace(/[\u{0080}-\u{FFFF}]/gu, "")
    .slice(2)
    .split(" -> ")[0];

  const serie = await prisma.series.findUnique({
    where: {
      name: seriesName,
    },
  });

  if (!serie) {
    return;
  }

  const resolvedUser = await client.users.fetch(user.id);

  const subscriptionExists = await prisma.subscription.findUnique({
    where: {
      guildId_seriesId_userId: {
        guildId: guild.id,
        seriesId: serie.id,
        userId: user.id,
      },
    },
  });

  if (subscriptionExists) {
    await prisma.subscription.delete({
      where: {
        guildId_seriesId_userId: {
          guildId: guild.id,
          seriesId: serie.id,
          userId: user.id,
        },
      },
    });
    await reaction.users.remove(resolvedUser);
    return;
  }

  await prisma.subscription.create({
    data: {
      guildId: guild.id,
      seriesId: serie.id,
      userId: user.id,
    },
  });

  await reaction.users.remove(resolvedUser);
});

const job = schedule.scheduleJob("*/30 * * * *", async () => {
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
    `Finished checking for updates at ${new Date().toISOString()}, next check at ${job.nextInvocation().toISOString()}`
  );
});

client.login(process.env.DISCORD_TOKEN).then(() => {
  job.invoke();
});
