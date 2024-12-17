import prisma from "./prisma";
import client from "./client";
import { emojiNumbers } from "./emoji";

const chunkArray = (array: any[], chunkSize: number): string[][] => {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
};

export const updateCatalog = async (guildId: string) => {
  const guild = await prisma.guild.findUnique({
    where: {
      id: guildId,
    },
  });

  if (!guild) {
    return;
  }

  const catalogChannelId = guild.catalogChannelId;

  if (!catalogChannelId) {
    return;
  }

  // Delete all messages in the catalog channel
  const channel = await client.channels.fetch(catalogChannelId);
  if (!channel || !channel.isTextBased()) {
    return;
  }

  const messages = await channel.messages.fetch();
  await Promise.all(
    messages.map((m) => {
      if (m.author.id !== client.user?.id || !m.member?.client.user.bot) {
        return;
      }

      return m.delete();
    })
  );

  const guildSeries = await prisma.guildsSeries.findMany({
    where: {
      guildId,
    },
    include: {
      series: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const series = guildSeries.map((gs) => gs.series);

  const titles = series.map((s) => `${s.name} -> [${s.source}](<${s.url}>)`);

  const chunkedTitles = chunkArray(titles, 10);

  for (const chunk of chunkedTitles) {
    for (const index in chunk) {
      chunk[index] = `${emojiNumbers[index]} ${chunk[index]}`;
    }
  }

  const messagesToSend = chunkedTitles.map((chunk) => chunk.join("\n"));

  for (const message of messagesToSend) {
    const sentMessage = await channel.send(message);
    const emojisToSend = emojiNumbers.slice(0, message.split("\n").length);
    for (const emoji of emojisToSend) {
      await sentMessage.react(emoji);
    }
  }
};
