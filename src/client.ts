import { Client, GatewayIntentBits, Partials } from "discord.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.Reaction],
  /**
   * Subscriber pings still work; everything else is inert.
   *
   * discord.js resolves @everyone/@here from a plain substring scan, and series
   * names come from scraped third-party markup and are interpolated raw into
   * announcements — so a title containing "@here" would mass-ping on every
   * release, forever. User arguments echoed back by `!add` are the same risk.
   */
  allowedMentions: { parse: ["users"] },
});

export default client;
