import { Client, GatewayIntentBits } from "discord.js";

const client = new Client({
  /**
   * Guilds alone, which is everything this bot actually needs.
   *
   * It previously also asked for MessageContent — a privileged intent, delivering
   * the text of every message anyone sent in the server — purely so a MessageCreate
   * handler could notice the few that began with `!`. Slash commands arrive as
   * interactions, which need no intent at all, so reading the whole server's
   * conversation to catch six commands is no longer a trade that has to be made.
   *
   * GuildMessages and GuildMessageReactions went with the prefix commands and the
   * reaction catalog. Sending an announcement needs no intent; Guilds is what keeps
   * the channel cache warm enough to fetch one.
   *
   * Partials went too: they existed so the reaction handler could work with an
   * uncached message, and nothing else here observes a partial.
   */
  intents: [GatewayIntentBits.Guilds],
  /**
   * Subscriber pings still work; everything else is inert.
   *
   * discord.js resolves @everyone/@here from a plain substring scan, and series
   * names come from scraped third-party markup and are interpolated raw into
   * announcements — so a title containing "@here" would mass-ping on every
   * release, forever.
   */
  allowedMentions: { parse: ["users"] },
});

export default client;
