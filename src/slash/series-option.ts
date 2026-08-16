import type { AutocompleteInteraction } from "discord.js";
import prisma from "../prisma";
import { Series } from "../db";
import { listGuildSeries } from "../series-service";
import { listSubscriptions } from "../subscription-service";
import { type SeriesChoice, buildChoices } from "./series-choices";

/**
 * The "which series?" argument, shared by every command that takes one.
 *
 * This is what actually replaces the reaction catalog. That catalog existed to
 * show people what they could subscribe to, and paid for it by deleting and
 * rebuilding up to a hundred messages and re-adding one reaction per series —
 * sequentially, against a rate limit — every single time a series was added.
 * Autocomplete answers the same question from the database, per keystroke, and
 * searches instead of paginating.
 *
 * The ranking and labelling live in series-choices.ts, which imports no database
 * client so it can be tested directly.
 */

export { SERIES_OPTION } from "./series-choices";

const respond = (interaction: AutocompleteInteraction, entries: SeriesChoice[]): Promise<void> =>
  interaction.respond(buildChoices(entries, String(interaction.options.getFocused() ?? "")));

/** Everything in this guild's catalog, with the caller's own subscriptions ticked. */
export const autocompleteCatalog = async (interaction: AutocompleteInteraction): Promise<void> => {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const entries = await listGuildSeries(interaction.guildId);
  await respond(
    interaction,
    entries.map(({ series, subscriberIds }) => ({
      id: series.id,
      name: series.name,
      subscribed: subscriberIds.includes(interaction.user.id),
    }))
  );
};

/** Only what the caller actually follows — an empty list here is the honest answer. */
export const autocompleteSubscribed = async (interaction: AutocompleteInteraction): Promise<void> => {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const series = await listSubscriptions(interaction.guildId, interaction.user.id);
  await respond(
    interaction,
    series.map((s) => ({ id: s.id, name: s.name, subscribed: true }))
  );
};

/**
 * Turns the submitted option back into a row.
 *
 * The value is a series id when a suggestion was picked, but Discord lets a user
 * type free text and press enter without choosing one — so a title is accepted
 * too. Either way the lookup is scoped to this guild's catalog, so the argument
 * cannot reach a series the guild does not actually have.
 */
export const resolveSeries = async (guildId: string, raw: string): Promise<Series | null> => {
  const value = raw.trim();
  if (!value) {
    return null;
  }

  const link = await prisma.guildsSeries.findFirst({
    where: {
      guildId,
      OR: [{ seriesId: value }, { series: { name: { equals: value, mode: "insensitive" } } }],
    },
    include: { series: true },
  });

  return link?.series ?? null;
};
