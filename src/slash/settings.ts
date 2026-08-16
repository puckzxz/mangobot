import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "./types";
import prisma from "../prisma";
import { requireGuild } from "./reply";

/**
 * Where chapter announcements go.
 *
 * The prefix version took no argument and silently used whichever channel the
 * message happened to be sent in, so setting it required going to that channel
 * first and there was no way to read back the current value. This takes the
 * channel as an argument, still defaulting to the current one.
 */
export const setUpdatesCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("setupdates")
    .setDescription("Choose the channel chapter announcements are posted in")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("Defaults to the channel you run this in")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false)
    )
    // Announcements are server-wide, so this is not everyone's to change.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  execute: async (interaction) => {
    const guildId = await requireGuild(interaction);
    if (!guildId) return;

    const channel = interaction.options.getChannel("channel") ?? interaction.channel;
    if (!channel) {
      await interaction.reply({
        content: "I could not tell which channel you meant — pass one explicitly.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // A stored id the bot cannot post to is the failure mode that matters: the
    // scrape keeps succeeding and every announcement quietly goes nowhere.
    const resolved = await interaction.guild?.channels.fetch(channel.id).catch(() => null);
    if (!resolved?.isTextBased() || !resolved.isSendable()) {
      await interaction.reply({
        content: `I cannot post in <#${channel.id}> — check my permissions there and try again.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await prisma.guild.update({ where: { id: guildId }, data: { updatesChannelId: channel.id } });
    await interaction.reply(`Chapter announcements will be posted in <#${channel.id}>.`);
  },
};
