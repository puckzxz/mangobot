import { Command } from "../types/command";
import { addSeriesToGuild } from "../series-service";

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
      channel.send("Please provide a url");
      return;
    }

    const message = await channel.send(`Adding <${url}> to the database...`);

    const result = await addSeriesToGuild(msg.guild!.id, url);

    if (!result.ok) {
      switch (result.reason) {
        case "unsupported-url":
          channel.send("Could not determine source");
          return;
        case "scrape-failed":
          channel.send("Something went wrong");
          return;
        case "name-conflict":
          channel.send(
            result.conflictingSeries
              ? `That title already belongs to a different series: <${result.conflictingSeries.url}>`
              : "That title already belongs to a different series"
          );
          return;
      }
    }

    message.edit(`Added <${url}> to the database`);
  },
};

export default command;
