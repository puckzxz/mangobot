import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
} from "discord.js";

/**
 * Slash commands replace the `!` prefix commands, and with them the need for the
 * MessageContent privileged intent — reading every message in the server just to
 * notice the handful that started with `!` was never a fair trade.
 *
 * `data` carries the schema Discord itself validates against, so a missing or
 * mistyped argument is rejected before it ever reaches `execute`.
 */
export interface SlashCommand {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  /** Only for commands with an autocompleting option. */
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}
