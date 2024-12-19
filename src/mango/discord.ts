import { Events } from "discord.js";
import client from "./client";
import { handleReady } from "./events/handle-ready";
import { handleMessageCreate } from "./events/handle-message-create";
import { handleMessageReactionAdd } from "./events/handle-message-reaction-add";
import { checkForMangaUpdates } from "./jobs/check-for-manga-updates";

client.on(Events.ClientReady, handleReady);
client.on(Events.MessageCreate, handleMessageCreate);
client.on(Events.MessageReactionAdd, handleMessageReactionAdd);

const startDiscordClient = async () => {
  client.login(process.env.DISCORD_TOKEN).then(() => {
    checkForMangaUpdates.invoke();
  });
};

export { startDiscordClient };
