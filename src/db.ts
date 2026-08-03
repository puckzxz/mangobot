/**
 * Single import point for the generated Prisma client.
 *
 * Prisma 7 emits the client into the project (`src/generated/prisma`) rather than
 * into `node_modules`, so re-exporting it here keeps every call site on one stable
 * specifier instead of a relative path that changes with the file's depth. The
 * generated directory is not committed — `pnpm generate` recreates it.
 */
export * from "./generated/prisma/client";
