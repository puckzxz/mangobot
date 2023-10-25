import { Command } from "../types/command";

const command: Command = {
  name: "setupdates",
  description: "Sets the channel to get updates in",
  group: "manga",
  usage: "setupdates",
  run: async ({ client, msg, prisma }, args) => {
    const { channelId } = msg;

    await prisma.guild.update({
      where: {
        id: msg.guild!.id,
      },
      data: {
        updatesChannelId: channelId,
      },
    });

    msg.channel.send(`Set updates channel to <#${channelId}>`);
  },
};

export default command;
