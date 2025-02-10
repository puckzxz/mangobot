import { Command } from "../types/command";
import { updateCatalog } from "../update-catalog";

const command: Command = {
  name: "delete",
  description: "Deletes a series from the database",
  group: "manga",
  usage: "delete <url>",
  run: async ({ msg, prisma }, args) => {
    const channel = msg.channel;
    if (!channel.isTextBased() || channel.isDMBased()) {
      return;
    }

    if (!args) {
      channel.send("Please provide a url");
      return;
    }

    const url = args[0];

    if (!url) {
      channel.send("Please provide a url");
      return;
    }

    const series = await prisma.series.findUnique({
      where: {
        url,
      },
    });

    if (!series) {
      channel.send("Could not find series");
      return;
    }

    await prisma.guildsSeries.delete({
      where: {
        guildId_seriesId: {
          guildId: msg.guild!.id,
          seriesId: series.id,
        },
      },
    });

    channel.send(`Deleted ${series.name}`);

    updateCatalog(msg.guild!.id);
  },
};

export default command;
