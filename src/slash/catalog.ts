import { MessageFlags, SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "./types";
import { SERIES_OPTION, autocompleteCatalog, resolveSeries } from "./series-option";
import { addSeriesToGuild, removeSeriesFromGuild } from "../series-service";
import { listSubscriptions } from "../subscription-service";
import { SUPPORTED_HOSTNAMES } from "../utils/try-to-determine-series-source";
import { defer, notInCatalog, requireGuild } from "./reply";

/** Makes an unhandled result reason a compile error rather than a wrong reply. */
const assertNever = (value: never): never => {
  throw new Error(`Unhandled add result: ${JSON.stringify(value)}`);
};

export const addCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("add")
    .setDescription("Add a series to this server's catalog")
    .addStringOption((option) =>
      option.setName("url").setDescription("Link to the series page on a supported site").setRequired(true)
    ),

  execute: async (interaction) => {
    const guildId = await requireGuild(interaction);
    if (!guildId) return;

    // Scrapes the source before it can answer, which is well past the three-second
    // window an un-deferred interaction gets.
    await defer(interaction);

    const url = interaction.options.getString("url", true).trim();
    const result = await addSeriesToGuild(guildId, url);

    if (!result.ok) {
      switch (result.reason) {
        case "unsupported-url":
          await interaction.editReply(`I cannot read that link. Supported sites: ${SUPPORTED_HOSTNAMES.join(", ")}`);
          return;
        case "scrape-failed":
          await interaction.editReply(`Could not read that series from its source — ${result.detail}`);
          return;
        case "name-conflict":
          await interaction.editReply(
            result.conflictingSeries
              ? `That title already belongs to a different series: <${result.conflictingSeries.url}>`
              : "That title already belongs to a different series."
          );
          return;
        default:
          return assertNever(result);
      }
    }

    await interaction.editReply(
      result.alreadyInCatalog
        ? `**${result.series.name}** was already in the catalog (now at chapter ${result.series.latestChapter}).`
        : `Added **${result.series.name}** at chapter ${result.series.latestChapter}. ` +
            `Use \`/subscribe\` to get pinged for new chapters.`
    );
  },
};

export const removeCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a series from this server's catalog")
    .addStringOption((option) =>
      option
        .setName(SERIES_OPTION)
        .setDescription("Series to remove — start typing to search")
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

    const result = await removeSeriesFromGuild(guildId, { seriesId: series.id });
    if (!result.ok) {
      await interaction.reply({
        content:
          result.reason === "not-found"
            ? "That series no longer exists."
            : "That series is not in this server's catalog.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Say when the row itself went, since that also discards its chapter history
    // and every subscription anyone had to it.
    await interaction.reply(
      result.seriesRowDeleted
        ? `Removed **${result.seriesName}**. No server was still following it, so it is no longer scraped.`
        : `Removed **${result.seriesName}** from this server's catalog.`
    );
  },
};

export const subscriptionsCommand: SlashCommand = {
  data: new SlashCommandBuilder().setName("subscriptions").setDescription("Show the series you are following here"),

  execute: async (interaction) => {
    const guildId = await requireGuild(interaction);
    if (!guildId) return;

    const series = await listSubscriptions(guildId, interaction.user.id);
    if (series.length === 0) {
      await interaction.reply({
        content: "You are not following anything yet — try `/subscribe`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Angle brackets suppress link previews; 79 unfurled embeds would be unreadable.
    const lines = series.map((s) => `- **${s.name}** — ch. ${s.latestChapter} · <${s.url}>`);

    // A reply body is capped at 2000 characters, and this list grows with the
    // catalog. Trim to fit rather than letting the send fail outright.
    const header = `You are following ${series.length} series:\n`;
    let body = "";
    let shown = 0;
    for (const line of lines) {
      if (header.length + body.length + line.length + 40 > 2000) break;
      body += `${line}\n`;
      shown++;
    }
    const omitted = series.length - shown;

    await interaction.reply({
      content: header + body + (omitted > 0 ? `…and ${omitted} more.` : ""),
      flags: MessageFlags.Ephemeral,
    });
  },
};
