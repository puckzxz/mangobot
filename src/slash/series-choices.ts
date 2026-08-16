/**
 * How the series argument searches and renders.
 *
 * Pure, and free of any database import — a test that reaches prisma throws
 * without DATABASE_URL, which is how a whole test file once vanished from CI
 * while passing locally. See the same note in scrape-health.ts.
 */

export const SERIES_OPTION = "series";

/** Discord's hard limits: 25 suggestions, and 100 characters per label. */
export const MAX_CHOICES = 25;
export const MAX_LABEL = 100;

export interface SeriesChoice {
  id: string;
  name: string;
  subscribed: boolean;
}

const truncate = (text: string, room: number) => (text.length > room ? `${text.slice(0, room - 1)}…` : text);

const label = (name: string, subscribed: boolean): string => {
  const mark = subscribed ? "✓ " : "";
  return mark + truncate(name, MAX_LABEL - mark.length);
};

/**
 * Prefix matches first, then substring matches — typing "return" should surface
 * "Return of the Mount Hua Sect" above "The Regressed Son…", which merely contains
 * the word. -1 drops the entry entirely.
 */
const rank = (name: string, query: string): number => {
  if (!query) return 1;
  const lower = name.toLowerCase();
  if (lower.startsWith(query)) return 0;
  return lower.includes(query) ? 1 : -1;
};

/**
 * Rank, cap at what Discord accepts, and label. `sort` is stable in V8, so equally
 * ranked entries keep the catalog order they arrived in.
 */
export const buildChoices = (entries: SeriesChoice[], rawQuery: string): Array<{ name: string; value: string }> => {
  const query = rawQuery.trim().toLowerCase();

  return entries
    .map((entry) => ({ entry, score: rank(entry.name, query) }))
    .filter(({ score }) => score >= 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_CHOICES)
    .map(({ entry }) => ({ name: label(entry.name, entry.subscribed), value: entry.id }));
};
