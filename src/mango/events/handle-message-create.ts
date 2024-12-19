import { Message } from "discord.js";
import { commands } from "../commands";
import client from "../client";
import prisma from "../prisma";

export const handleMessageCreate = async (msg: Message) => {
  if (!msg.guild) {
    return;
  }

  if (!msg.content.startsWith("!")) {
    return;
  }

  const args = msg.content.slice(1).trim().split(/ +/);

  const commandName = args.shift()?.toLowerCase();

  if (!commandName) {
    return;
  }

  const command = commands.get(commandName);

  if (!command) {
    return;
  }

  if (command.usableBy && !command.usableBy.includes(msg.author.id)) {
    await msg.channel.send(
      `You don't have permission to use this command, ${msg.author.displayName}! - ${command.usableBy
        .map((id) => `<@${id}>`)
        .join(" ")}`
    );
    return;
  }

  try {
    await command.run({ client, msg, prisma }, args);
  } catch (error) {
    console.error(error);
    msg.channel.send("There was an error trying to execute that command!");
  }
};
