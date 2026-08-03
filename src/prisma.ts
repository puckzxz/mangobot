import { PrismaClient } from "./db";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;

// Fail at startup with a clear message rather than on the first query.
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

/**
 * Prisma 7 requires a driver adapter. Pooling is now the `pg` driver's rather than
 * Prisma's, and `pg` defaults to no connection timeout where Prisma 6 used 5s —
 * so a stalled connect would otherwise hang the update loop indefinitely.
 */
const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 5_000 });

const prisma = new PrismaClient({ adapter });

export default prisma;
