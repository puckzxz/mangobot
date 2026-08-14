import { Command } from "../types/command";
import { removeSeriesFromGuild } from "../series-service";

const command: Command = {
  name: "delete",
  description: "Deletes a series from the database",
  group: "manga",
  usage: "delete <url>",
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

    const result = await removeSeriesFromGuild(msg.guild!.id, { url });

    if (!result.ok) {
      channel.send(
        result.reason === "not-found" ? "Could not find series" : "That series is not in this server's catalog"
      );
      return;
    }

    channel.send(`Deleted ${result.seriesName}`);
  },
};

export default command;
