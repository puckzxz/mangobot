import { Command } from "../types/command";
import { addSeriesToGuild } from "../series-service";

/** Makes an unhandled result reason a compile error rather than a wrong reply. */
const assertNever = (value: never): never => {
  throw new Error(`Unhandled add result: ${JSON.stringify(value)}`);
};

const command: Command = {
  name: "add",
  description: "Add a manga to the database",
  group: "manga",
  usage: "add <url>",
  run: async ({ msg }, args) => {
    const channel = msg.channel;
    if (!channel.isTextBased() || channel.isDMBased()) {
      return;
    }

    const url = args?.[0];
    if (!url) {
      await channel.send("Please provide a url");
      return;
    }

    const message = await channel.send(`Adding <${url}> to the database...`);

    const result = await addSeriesToGuild(msg.guild!.id, url);

    if (!result.ok) {
      switch (result.reason) {
        case "unsupported-url":
          await channel.send("Could not determine source");
          return;
        case "scrape-failed":
          await channel.send(`Could not read that series from its source — ${result.detail}`);
          return;
        case "name-conflict":
          await channel.send(
            result.conflictingSeries
              ? `That title already belongs to a different series: <${result.conflictingSeries.url}>`
              : "That title already belongs to a different series"
          );
          return;
        default:
          // A new AddSeriesResult reason must not fall through to "Added".
          return assertNever(result);
      }
    }

    await message.edit(`Added <${url}> to the database`);
  },
};

export default command;
