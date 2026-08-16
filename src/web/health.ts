import prisma from "../prisma";
import client from "../client";

/**
 * The real health of the process.
 *
 * The previous `/healthz` was `Response.json({ ok: true })` sitting inside the
 * routes map — Bun builds a static route response once at startup and serves that
 * same object forever, so it structurally could not observe anything. It returned
 * 200 with Postgres unreachable and the gateway logged out, which is worse than no
 * healthcheck at all: it is a green light wired to nothing.
 */

export interface HealthReport {
  ok: boolean;
  db: { ok: boolean; error?: string };
  discord: { ok: boolean; mode: "gateway" | "web-only" };
  series: { total: number; failing: number; stalest: { name: string; hoursSinceSuccess: number } | null } | null;
}

/** Reported healthy in web-only mode: no token is a deliberate local-dev state. */
const discordHealth = (): HealthReport["discord"] =>
  process.env.DISCORD_TOKEN ? { ok: client.isReady(), mode: "gateway" } : { ok: true, mode: "web-only" };

export const checkHealth = async (): Promise<HealthReport> => {
  const discord = discordHealth();

  try {
    // A trivial query, so this measures the connection rather than any one table.
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    return {
      ok: false,
      db: { ok: false, error: error instanceof Error ? error.message.slice(0, 200) : String(error) },
      discord,
      series: null,
    };
  }

  const [total, failing, stalest] = await Promise.all([
    prisma.series.count(),
    prisma.series.count({ where: { consecutiveFailures: { gt: 0 } } }),
    prisma.series.findFirst({ orderBy: { lastSuccessAt: "asc" }, select: { name: true, lastSuccessAt: true } }),
  ]);

  return {
    ok: discord.ok,
    db: { ok: true },
    discord,
    series: {
      total,
      failing,
      stalest: stalest
        ? {
            name: stalest.name,
            hoursSinceSuccess: Math.round((Date.now() - stalest.lastSuccessAt.getTime()) / 36_00_000),
          }
        : null,
    },
  };
};
