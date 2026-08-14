/**
 * Seeds a guild row for local development.
 *
 * The web API resolves "the" guild from the database, and on a fresh compose db
 * there is none until the bot logs in and registers one — which local web-only
 * mode (no DISCORD_TOKEN) never does. This gives the API a guild to manage.
 *
 *   bun run scripts/seed-dev.ts
 *
 * Idempotent, local-only. Channel IDs stay null so updateCatalog no-ops.
 */
// Shares the configured client rather than constructing its own — Prisma 7 needs a
// driver adapter, and there should only be one place that wires it up.
import prisma from "../src/prisma";

const guild = await prisma.guild.upsert({
  where: { id: "dev-guild" },
  update: {},
  create: { id: "dev-guild", name: "Local Dev Guild" },
});

console.log(`Guild ready: ${guild.name} (${guild.id})`);

await prisma.$disconnect();
