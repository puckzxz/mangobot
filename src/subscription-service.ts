import prisma from "./prisma";
import { Series } from "./db";

/**
 * The one implementation of subscribe/unsubscribe, shared by the slash commands
 * and the reaction catalog while both exist.
 *
 * Subscriptions are per (guild, series, user). The row is the only record that a
 * chapter announcement should mention someone, so the writes live in one place
 * rather than being open-coded next to whichever UI happened to trigger them.
 */

export interface SubscriptionKey {
  guildId: string;
  seriesId: string;
  userId: string;
}

/** Idempotent: subscribing twice is a no-op, not an error and not a duplicate row. */
export const subscribe = async (key: SubscriptionKey): Promise<{ changed: boolean }> => {
  const existing = await prisma.subscription.findUnique({ where: { guildId_seriesId_userId: key } });
  if (existing) {
    return { changed: false };
  }
  await prisma.subscription.create({ data: key });
  return { changed: true };
};

/** Idempotent in the same way — unsubscribing from something you do not follow is fine. */
export const unsubscribe = async (key: SubscriptionKey): Promise<{ changed: boolean }> => {
  const { count } = await prisma.subscription.deleteMany({ where: key });
  return { changed: count > 0 };
};

/** What the reaction catalog needs: one click means "flip it, whichever way it was". */
export const toggleSubscription = async (key: SubscriptionKey): Promise<"subscribed" | "unsubscribed"> => {
  const { changed } = await unsubscribe(key);
  if (changed) {
    return "unsubscribed";
  }
  await subscribe(key);
  return "subscribed";
};

/** A user's subscriptions in this guild, in catalog order. */
export const listSubscriptions = async (guildId: string, userId: string): Promise<Series[]> => {
  const rows = await prisma.subscription.findMany({
    where: { guildId, userId },
    include: { series: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => row.series);
};
