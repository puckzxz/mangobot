import prisma from "./prisma";
import { ANILIST_ENDPOINT, lookupChapterTotal } from "./anilist";
import { USER_AGENT } from "./user-agent";

/**
 * Fills in AniList chapter totals a few series at a time.
 *
 * Separate from the scrapers on purpose: AniList is not a chapter source and must
 * never sit in the path that announces one. This runs after a pass has finished, so
 * a slow or rate-limited AniList delays nothing that matters.
 */

/**
 * AniList allows ~30 requests/minute, and a single lookup may try up to four search
 * variants. Pacing therefore has to be per REQUEST, not per series — five series
 * that each need all four variants is twenty requests, which back to back would
 * burst straight through the limit.
 */
const LOOKUPS_PER_PASS = 5;
const REQUEST_GAP_MS = 2_500;

/**
 * Totals only change when a work ends, so this is close to a one-time cost. The TTL
 * exists so a series that finishes after we looked eventually gets a real total,
 * and so an unmatched title is retried occasionally rather than never.
 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const post = async (query: string, variables: { q: string }): Promise<unknown> => {
  // Every request, variants included. At worst 20 requests * 2.5s = 50s, which is
  // fine for work that runs after the announcements are already out.
  await Bun.sleep(REQUEST_GAP_MS);

  const response = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    // Without a User-Agent AniList answers 403, so this is required rather than polite.
    headers: { "content-type": "application/json", accept: "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  // 404 is AniList's "no match", which lookupChapterTotal handles by trying the
  // next variant — so it must not be thrown as an error.
  if (!response.ok && response.status !== 404) {
    throw new Error(`AniList returned ${response.status}`);
  }
  return response.json();
};

export const refreshAnilistTotals = async (): Promise<void> => {
  const due = await prisma.series.findMany({
    where: {
      OR: [{ anilistCheckedAt: null }, { anilistCheckedAt: { lt: new Date(Date.now() - TTL_MS) } }],
    },
    orderBy: { anilistCheckedAt: { sort: "asc", nulls: "first" } },
    take: LOOKUPS_PER_PASS,
    select: { id: true, name: true },
  });

  if (due.length === 0) return;

  for (const series of due) {
    try {
      const match = await lookupChapterTotal(series.name, post);

      // Always stamp checkedAt, including on a miss — otherwise an unmatchable
      // title is retried on every pass forever.
      await prisma.series.update({
        where: { id: series.id },
        data: {
          anilistCheckedAt: new Date(),
          anilistId: match?.id ?? null,
          anilistTitle: match?.title ?? null,
          anilistChapters: match?.chapters ?? null,
        },
      });

      if (match) {
        console.log(
          `[anilist] ${series.name} -> ${match.title} (${match.chapters ?? "no total"}, ${match.similarity.toFixed(2)})`
        );
      } else {
        console.warn(`[anilist] no confident match for ${JSON.stringify(series.name)} — link it by hand if it matters`);
      }
    } catch (error) {
      // Deliberately leaves anilistCheckedAt untouched, so a rate limit or a network
      // blip is retried next pass rather than being recorded as "no such series".
      // This is why lookupChapterTotal propagates request failures instead of
      // folding them into its null return.
      console.error(`[anilist] lookup failed for ${series.name}, will retry:`, error);
    }
  }
};
