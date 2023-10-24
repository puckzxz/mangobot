import { Command } from "../types/command";

function splitBySize(str: string) {
  const lines = str.split("\n");
  const chunks = [];
  let currentChunk = "";

  for (let line of lines) {
    // If the current chunk plus the new line exceeds maxSize, push the current chunk to chunks
    if (currentChunk.length + line.length + 1 > 2000) {
      chunks.push(currentChunk);
      currentChunk = "";
    }

    // If the current chunk is not empty, add a newline before the next line
    if (currentChunk !== "") currentChunk += "\n";

    currentChunk += line;
  }

  // Push any remaining chunk
  if (currentChunk !== "") {
    chunks.push(currentChunk);
  }

  return chunks;
}

const command: Command = {
  name: "list",
  description: "List all manga you're currently tracking",
  group: "manga",
  usage: "list",
  run: async ({ msg, prisma }) => {
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

    // If characters are over 2000 characters, we can't send it
    // So we'll send it in multiple messages
    const messagesToSend = splitBySize(formattedTitles);

    for (const message of messagesToSend) {
      await msg.channel.send(message);
    }
  },
};

export default command;
