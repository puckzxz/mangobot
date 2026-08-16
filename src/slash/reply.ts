import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";

/**
 * Shared replies, so the same situation reads the same way from every command.
 *
 * Discord gives an interaction three seconds to be acknowledged before it shows
 * the user "The application did not respond", which is why anything that touches
 * the network defers first — see `defer` below.
 */

/**
 * Guild-only guard. Every command here writes rows keyed by guild, so a DM has no
 * catalog to act on. Returns the guild id, or null having already replied.
 */
export const requireGuild = async (interaction: ChatInputCommandInteraction): Promise<string | null> => {
  if (interaction.guildId) {
    return interaction.guildId;
  }
  await interaction.reply({
    content: "That only works inside a server, not in DMs.",
    flags: MessageFlags.Ephemeral,
  });
  return null;
};

export const notInCatalog = (interaction: ChatInputCommandInteraction) =>
  interaction.reply({
    content: "I could not find that series in this server's catalog — pick one from the suggestions.",
    flags: MessageFlags.Ephemeral,
  });

/**
 * Buys time for work that outlives the three-second window. `/add` scrapes the
 * source before it can answer, which routinely takes longer than that.
 */
export const defer = (interaction: ChatInputCommandInteraction, ephemeral = false) =>
  interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
