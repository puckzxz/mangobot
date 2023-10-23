import { Command } from "../types/command";

const command: Command = {
  name: "list",
  description: "List all manga you're currently tracking",
  group: "manga",
  usage: "list",
  run: async ({ client, msg, prisma }, args) => {
    const guildSeries = await prisma.guildsSeries.findMany({
      where: {
        guildId: msg.guild!.id,
      },
      include: {
        Series: true,
      },
    });

    const series = guildSeries.map((gs) => gs.Series);

    const formattedTitles = series.map((s) => `- ${s.name}: ${s.source} - <${s.url}>`).join("\n");

    msg.channel.send(formattedTitles);
  },
};

export default command;
