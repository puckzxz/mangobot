import { Command } from "../types/command";
import { updateCatalog } from "../update-catalog";

const command: Command = {
  name: "updatecatalog",
  description: "Updates the catalog",
  group: "manga",
  usage: "updatecatalog",
  usableBy: ["135554522616561664"],
  run: async ({ msg }) => {
    await msg.delete();
    await updateCatalog(msg.guild!.id);
  },
};

export default command;
