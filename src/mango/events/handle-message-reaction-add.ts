import { MessageReaction, User, PartialMessageReaction, PartialUser } from "discord.js";
import prisma from "../prisma";
import client from "../client";
import { emojiNumbers } from "../emoji";

export const handleMessageReactionAdd = async (
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
) => {
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
};
