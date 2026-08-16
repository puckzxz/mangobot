import { Events, Guild, MessageFlags, type Interaction } from "discord.js";
import type { SlashCommand } from "./types";
import { addCommand, removeCommand, subscriptionsCommand } from "./catalog";
import { subscribeCommand, unsubscribeCommand } from "./subscribe";
import { setUpdatesCommand } from "./settings";

/**
 * Static registry, for the same reason the prefix commands used one: runtime
 * directory scanning meant a non-root working directory loaded zero commands and
 * said nothing about it.
 */
export const slashCommands: SlashCommand[] = [
  addCommand,
  removeCommand,
  subscribeCommand,
  unsubscribeCommand,
  subscriptionsCommand,
  setUpdatesCommand,
];

const byName = new Map(slashCommands.map((command) => [command.data.name, command]));

/**
 * Registered per guild rather than globally: guild commands appear the moment
 * they are written, while global ones can take an hour to propagate. With one
 * server that is all upside.
 *
 * The failure worth calling out is 50001/Missing Access. A bot invited before it
 * had slash commands may only hold the `bot` OAuth2 scope, and registering needs
 * `applications.commands` as well. Nothing about the gateway connection reveals
 * this, so it is spelled out here instead of surfacing as a bare 403.
 */
export const registerSlashCommands = async (guild: Guild): Promise<void> => {
  try {
    const registered = await guild.commands.set(slashCommands.map((command) => command.data.toJSON()));
    console.log(`Registered ${registered.size} slash commands in ${guild.name}`);
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code === 50001) {
      console.error(
        `Cannot register slash commands in ${guild.name}: missing the applications.commands scope. ` +
          `Re-invite the bot with that scope — it does not need to be kicked first.`
      );
      return;
    }
    console.error(`Failed to register slash commands in ${guild.name}:`, error);
  }
};

/**
 * One handler for both halves of an interaction. Autocomplete arrives as its own
 * interaction type and must be answered within three seconds or the user sees no
 * suggestions at all, so it never defers and never reports errors to the user —
 * an empty list is the only sensible failure.
 */
export const handleInteraction = async (interaction: Interaction): Promise<void> => {
  if (interaction.isAutocomplete()) {
    const command = byName.get(interaction.commandName);
    try {
      await command?.autocomplete?.(interaction);
    } catch (error) {
      console.error(`Autocomplete for /${interaction.commandName} failed:`, error);
      await interaction.respond([]).catch(() => {});
    }
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const command = byName.get(interaction.commandName);
  if (!command) {
    // Left over from a previous deploy; Discord still offers it until re-registered.
    console.warn(`Unknown slash command: /${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`/${interaction.commandName} failed:`, error);

    // Whether a reply already exists decides which call is legal here, and getting
    // it wrong throws a second time — leaving the user with a spinner and no answer.
    const content = "Something went wrong running that command.";
    const respond = interaction.deferred
      ? interaction.editReply({ content })
      : interaction.replied
        ? interaction.followUp({ content, flags: MessageFlags.Ephemeral })
        : interaction.reply({ content, flags: MessageFlags.Ephemeral });

    await respond.catch((replyError) => console.error("Could not report the command failure:", replyError));
  }
};
