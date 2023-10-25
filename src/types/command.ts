import { PrismaClient } from "@prisma/client";
import { Client, Message } from "discord.js";

export interface Context {
  client: Client;
  msg: Message;
  prisma: PrismaClient;
}

export interface Command {
  name: string;
  group: string;
  usage: string;
  description: string;
  usableBy?: string[];
  run: (ctx: Context, args?: string[]) => Promise<void>;
}
