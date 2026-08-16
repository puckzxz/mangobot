import { SeriesSource } from "./db";
import { Scraper, ScrapeOutcome, classifyThrown, failure } from "./types/scraper";
import mangadex from "./scrapers/mangadex";
import asura from "./scrapers/asura";
import weebcentral from "./scrapers/weebcentral";

/**
 * How each source is fetched. Every source is a plain HTTP call — Asura
 * server-renders its chapter list and WeebCentral publishes per-series RSS — which
 * is what allowed the puppeteer sidecar to be deleted outright.
 *
 * `satisfies Record<SeriesSource, …>` is the point of this table: adding a value to
 * the enum stops compiling until it is routed here. Routing used to be by negation
 * — "anything not in the sidecar list goes to MangaDex" — so an unrouted source was
 * silently handed to the MangaDex API and surfaced as a confusing `id null` 404.
 */
const SCRAPERS = {
  [SeriesSource.WeebCentral]: weebcentral,
  [SeriesSource.AsuraScans]: asura,
  [SeriesSource.MangaDex]: mangadex,
} satisfies Record<SeriesSource, Scraper>;

export type Item = { url: string; source: SeriesSource };

/**
 * Fills in anything the scrapers did not account for.
 *
 * The type system cannot express "one outcome out per one URL in", so this
 * enforces it at runtime. Without it a scraper that quietly drops a URL takes that
 * series back out of the caller's loop, which is precisely the silent freeze this
 * whole shape exists to prevent. Pure, so it is directly testable.
 */
export const reconcileOutcomes = (requested: Item[], outcomes: ScrapeOutcome[]): ScrapeOutcome[] => {
  const byUrl = new Map(outcomes.map((outcome) => [outcome.seriesUrl, outcome]));
  return requested.map(
    (item) =>
      byUrl.get(item.url) ??
      failure(item.url, item.source, "not-attempted", "the scraper returned no outcome for this URL")
  );
};

/** One request at a time per source, paced by that source's own gap. */
const scrapeSource = async (scraper: Scraper, items: Item[]): Promise<ScrapeOutcome[]> => {
  const outcomes: ScrapeOutcome[] = [];

  for (const [index, item] of items.entries()) {
    if (index > 0) await Bun.sleep(scraper.requestGapMs);
    try {
      outcomes.push(await scraper.scrapeOne(item.url));
    } catch (error) {
      // A scraper is not supposed to throw — it returns a typed failure. If one
      // does anyway, that is this series' problem and not the batch's.
      outcomes.push(classifyThrown(item.url, item.source, error));
    }
  }

  return outcomes;
};

/**
 * Returns exactly one outcome per requested item, in request order.
 *
 * Each source is isolated: one upstream failing must not discard results already
 * collected from the others, which is what happened when a single MangaDex 429
 * rejected out of the whole batch. A source-level throw now marks only that
 * source's URLs `not-attempted` rather than deleting them from the result.
 */
const fetchManga = async (items: Item[]): Promise<ScrapeOutcome[]> => {
  const collected: ScrapeOutcome[] = [];

  for (const [source, scraper] of Object.entries(SCRAPERS) as [SeriesSource, Scraper][]) {
    const forSource = items.filter((item) => item.source === source);
    if (forSource.length === 0) continue;

    try {
      collected.push(...(await scrapeSource(scraper, forSource)));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[fetch] ${source} failed wholesale:`, error);
      collected.push(
        ...forSource.map((item) => failure(item.url, source, "not-attempted", `source-level failure: ${detail}`))
      );
    }

    // A source answering for none of its series is a contract change, not bad luck.
    const ok = collected.filter((outcome) => outcome.source === source && outcome.ok).length;
    if (ok === 0) {
      console.error(
        `[fetch] ${source} returned 0 results for ${forSource.length} URLs — its contract has likely changed`
      );
    }
  }

  return reconcileOutcomes(items, collected);
};

export default fetchManga;
