import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "./types";
import { SERIES_OPTION, autocompleteCatalog, autocompleteSubscribed, resolveSeries } from "./series-option";
import { subscribe, unsubscribe } from "../subscription-service";
import { notInCatalog, requireGuild } from "./reply";

/**
 * Subscribing is the one thing the reaction catalog did that nothing else could,
 * which is why these had to exist before it could be deleted.
 *
 * Replies are ephemeral: following a series is a private preference, and the old
 * mechanism was silent about whether the click had registered at all.
 */

export const subscribeCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("subscribe")
    .setDescription("Get pinged when a series gets a new chapter")
    .addStringOption((option) =>
      option
        .setName(SERIES_OPTION)
        .setDescription("Series to follow — start typing to search the catalog")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  autocomplete: autocompleteCatalog,

  execute: async (interaction) => {
    const guildId = await requireGuild(interaction);
    if (!guildId) return;

    const series = await resolveSeries(guildId, interaction.options.getString(SERIES_OPTION, true));
    if (!series) {
      await notInCatalog(interaction);
      return;
    }

    const { changed } = await subscribe({ guildId, seriesId: series.id, userId: interaction.user.id });
    await interaction.reply({
      content: changed
        ? `Subscribed to **${series.name}** — you will be pinged on new chapters.`
        : `You are already subscribed to **${series.name}**.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export const unsubscribeCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("unsubscribe")
    .setDescription("Stop getting pinged for a series")
    .addStringOption((option) =>
      option.setName(SERIES_OPTION).setDescription("Series to stop following").setRequired(true).setAutocomplete(true)
    ),

  // Only what they actually follow — suggesting the whole catalog here would offer
  // 79 options for an action that applies to a handful of them.
  autocomplete: autocompleteSubscribed,

  execute: async (interaction) => {
    const guildId = await requireGuild(interaction);
    if (!guildId) return;

    const series = await resolveSeries(guildId, interaction.options.getString(SERIES_OPTION, true));
    if (!series) {
      await notInCatalog(interaction);
      return;
    }

    const { changed } = await unsubscribe({ guildId, seriesId: series.id, userId: interaction.user.id });
    await interaction.reply({
      content: changed ? `Unsubscribed from **${series.name}**.` : `You were not subscribed to **${series.name}**.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
