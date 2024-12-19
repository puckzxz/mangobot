import { Client } from "discord.js";
import prisma from "../prisma";
import fs from "fs";
import { commands } from "../commands";

export const handleReady = (client: Client) => {
  console.log(import.meta.dir);
  console.log(`Logged in as ${client.user?.tag}!`);
  client.guilds.cache.forEach(async (guild) => {
    console.log(`Logged in to guild ${guild.name}`);
    await prisma.guild.upsert({
      where: {
        id: guild.id,
      },
      update: {
        name: guild.name,
      },
      create: {
        id: guild.id,
        name: guild.name,
      },
    });
  });
  const commandFiles = fs.readdirSync(`${import.meta.dir}/commands`).filter((file) => file.endsWith(".ts"));
  for (const file of commandFiles) {
    const command = require(`${import.meta.dir}/commands/${file}`).default;
    commands.set(command.name, command);
    console.log(`Loaded command ${command.name}`);
  }
};
