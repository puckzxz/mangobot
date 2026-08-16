/**
 * Looks up how many chapters the ORIGINAL work has, which no scraper can know.
 *
 * This is a different question from the one `sourceChapterCount` answers, and the
 * two must not be conflated:
 *
 *   sourceChapterCount  what THIS SOURCE has → a gap means we are lagging behind it
 *   anilistChapters     what the WORK has    → a gap means the source has not
 *                                              translated everything yet
 *
 * The second is the Uma Musume case: the Japanese run finished while the English
 * translation sat at roughly chapter 50 of 180. Without it, a completed-and-quiet
 * WeebCentral series looks safe to remove when chapters are still coming — and
 * WeebCentral publishes no chapter total of its own, so 49 of 79 series have no
 * other way to answer it.
 *
 * Measured against the real catalog: 74 of 79 titles matched as stored, 78 with the
 * normalisation below, zero false positives at the 0.6 threshold. AniList only
 * publishes a total for FINISHED works, which is exactly the case that matters here.
 *
 * No prisma import — see the note in scrape-health.ts.
 */

/** AniList is ~30 requests/minute unauthenticated. */
export const ANILIST_ENDPOINT = "https://graphql.anilist.co";

const QUERY = `
query ($q: String) {
  Media(search: $q, type: MANGA) {
    id
    title { romaji english native }
    synonyms
    chapters
    status
  }
}`;

/**
 * Search variants, cheapest first.
 *
 * All five real misses were mechanical rather than semantic: a typographic
 * apostrophe returns zero results, a trailing "(AUTHOR NAME)" breaks the search,
 * and very long titles need truncating. Trying them in order recovered four of the
 * five; the fifth needs a manual link.
 */
export const searchVariants = (title: string): string[] => {
  const straight = title.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const noParens = straight
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const short = noParens.split(/\s+/).slice(0, 8).join(" ");
  return [...new Set([title, straight, noParens, short].filter(Boolean))];
};

const normalise = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // Apostrophes are DELETED rather than replaced with a space, so "reader's"
    // normalises to "readers" and matches a source that writes it without one.
    // Turning them into spaces left a stray "s" token and dropped the score below
    // the match threshold on exactly the titles this normalisation exists for.
    .replace(/['’‘"“”]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s: string): Set<string> =>
  new Set(
    normalise(s)
      .split(" ")
      .filter((t) => t.length > 2)
  );

/**
 * Token overlap with a containment bonus. Enough to separate a real match from
 * noise without pulling in a fuzzy-matching dependency.
 */
export const titleSimilarity = (a: string, b: string): number => {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  const jaccard = shared / (A.size + B.size - shared);
  const na = normalise(a);
  const nb = normalise(b);
  if (na === nb) return 1;
  return na.includes(nb) || nb.includes(na) ? Math.max(jaccard, 0.85) : jaccard;
};

/** Below this, treat it as no match rather than storing a wrong one. */
export const MATCH_THRESHOLD = 0.6;

export interface AnilistMatch {
  id: number;
  title: string;
  /** Null for anything still releasing — AniList only publishes a total once finished. */
  chapters: number | null;
  similarity: number;
}

interface MediaResponse {
  data?: {
    Media?: {
      id: number;
      title?: { romaji?: string | null; english?: string | null; native?: string | null };
      synonyms?: string[];
      chapters?: number | null;
      status?: string;
    } | null;
  };
}

/** Picks the best-scoring of the returned titles, so a match is judged on any of them. */
export const scoreMedia = (
  ourTitle: string,
  media: NonNullable<NonNullable<MediaResponse["data"]>["Media"]>
): AnilistMatch => {
  const candidates = [media.title?.romaji, media.title?.english, media.title?.native, ...(media.synonyms ?? [])].filter(
    (t): t is string => !!t
  );
  const similarity = candidates.reduce((best, candidate) => Math.max(best, titleSimilarity(ourTitle, candidate)), 0);
  return {
    id: media.id,
    title: media.title?.english || media.title?.romaji || String(media.id),
    chapters: typeof media.chapters === "number" && media.chapters > 0 ? media.chapters : null,
    similarity,
  };
};

/**
 * Returns the best confident match, or null when AniList genuinely has nothing.
 *
 * Null means "asked, no match" — a real answer the caller stores so an unmatchable
 * title is not retried forever. A failing REQUEST is different and must not be
 * laundered into that answer, so it propagates: swallowing it here would record a
 * rate-limited lookup as a definitive miss and skip that series for the whole TTL.
 *
 * `doFetch` owns pacing, so the gap applies to every request including the retries
 * across variants — a title needing all four would otherwise fire them back to back
 * and, five series to a pass, burst straight through AniList's ~30/min.
 */
export const lookupChapterTotal = async (
  ourTitle: string,
  doFetch: (query: string, variables: { q: string }) => Promise<unknown>
): Promise<AnilistMatch | null> => {
  for (const variant of searchVariants(ourTitle)) {
    const body = (await doFetch(QUERY, { q: variant })) as MediaResponse;

    const media = body?.data?.Media;
    if (!media) continue; // AniList answers 404 for "no match"; try the next variant

    const match = scoreMedia(ourTitle, media);
    if (match.similarity >= MATCH_THRESHOLD) return match;
  }
  return null;
};

/**
 * Chapters the source has not translated yet.
 *
 * Guarded against AniList's own bad data: two of eighteen totals in the real
 * catalog were plainly wrong (Hero Killer and Ruri Dragon both claim a single
 * chapter against 276 and 50 announced). A total at or below what we already have
 * is discarded rather than believed.
 */
export const untranslatedChapters = (
  anilistChapters: number | null | undefined,
  latestChapter: string
): number | null => {
  if (!anilistChapters) return null;
  const ours = parseFloat(latestChapter);
  if (!Number.isFinite(ours)) return null;
  const remaining = anilistChapters - ours;
  return remaining > 0 ? Math.round(remaining * 10) / 10 : null;
};
