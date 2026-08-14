import prisma from "./prisma";
import client from "./client";
import { emojiNumbers } from "./emoji";
import { formatCatalogLine } from "./catalog-line";

const chunkArray = <T>(array: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
};

export const updateCatalog = async (guildId: string) => {
  // Web mutations can fire this before — or entirely without — a gateway login,
  // where client.channels.fetch would throw rather than find anything.
  if (!client.isReady()) {
    return;
  }

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
  if (!channel || !channel.isTextBased() || !channel.isSendable()) {
    return;
  }

  // Only our own messages, and never mind if one was already deleted.
  // The old guard also tested `m.member?.client.user.bot`, which reads the *client's*
  // user (always true) and short-circuited to skip whenever the author's GuildMember
  // was not cached — leaving stale catalog pages behind with live reactions on them.
  const messages = await channel.messages.fetch({ limit: 100 });
  await Promise.all(
    messages
      .filter((m) => m.author.id === client.user?.id)
      .map((m) => m.delete().catch((error) => console.error("failed to delete a catalog message:", error)))
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

  // One page per available emoji — a page longer than that would render entries
  // nobody could react to.
  const pages = chunkArray(series, emojiNumbers.length);

  const messagesToSend = pages.map((page) =>
    page.map((s, index) => formatCatalogLine(emojiNumbers[index]!, s)).join("\n")
  );

  for (const message of messagesToSend) {
    const sentMessage = await channel.send(message);
    const emojisToSend = emojiNumbers.slice(0, message.split("\n").length);
    for (const emoji of emojisToSend) {
      await sentMessage.react(emoji);
    }
  }
};
