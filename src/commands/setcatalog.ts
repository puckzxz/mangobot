import { Command } from "../types/command";

const command: Command = {
  name: "setcatalog",
  description: "Sets the channel to post the catalog in",
  group: "manga",
  usage: "setcatalog",
  usableBy: ["135554522616561664"],
  run: async ({ msg, prisma }) => {
    const channel = msg.channel;
    if (!channel.isTextBased() || channel.isDMBased()) {
      return;
    }

    const { channelId } = msg;

    await prisma.guild.update({
      where: {
        id: msg.guild!.id,
      },
      data: {
        catalogChannelId: channelId,
      },
    });

    channel.send(`Set catalog channel to <#${channelId}>`);
  },
};

export default command;
