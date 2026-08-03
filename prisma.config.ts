// Prisma 7 moved connection configuration out of schema.prisma and into this file.
// The CLI runs under Node rather than Bun, so it does not pick up .env on its own.
import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * `prisma generate` needs no database, and it runs during the image build and in CI
 * where DATABASE_URL is deliberately absent. The `env()` helper throws on a missing
 * variable, so the datasource is attached only when one is actually set — generate
 * works without it, while `migrate deploy` still receives it at runtime.
 */
const url = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  ...(url ? { datasource: { url } } : {}),
});
