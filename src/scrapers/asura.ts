import { SeriesSource } from "../db";
import { Scraper, ScrapeOutcome, SeriesMetadata, failure, statusReason, success } from "../types/scraper";
import { fetchWithPolicy } from "../http";
// lol-html, which backs Bun's HTMLRewriter, hands back attribute values as raw
// source text rather than decoding entities, so `props` arrives still escaped.
import { decodeEntities } from "../utils/html-entities";

const SITE = "https://asurascans.com";
const SOURCE = SeriesSource.AsuraScans;

/**
 * Asura suffixes comic URLs with a global build hash (`…/comics/<slug>-00dcbf97`)
 * and 302s to the current one whenever ours is absent or stale, so we always store
 * and request the hash-free form — that survives their rebuilds.
 *
 * The old `asuracomic.net/series/<slug>-<hash>` URLs do not: that domain now 301s
 * to the bare homepage with the path discarded, which is how 29 series froze
 * silently in March. `page.goto` resolved happily on the redirect and no selector
 * matched, so the scraper returned nothing and logged nothing.
 */
export const asuraSeriesUrl = (slug: string) => `${SITE}/comics/${slug}`;

/** Pulls the slug out of either the old or the new URL shape. */
export const asuraSlug = (url: string) =>
  new URL(url).pathname.replace(/^\/(series|comics)\//, "").replace(/-[0-9a-f]{8}$/, "");

/**
 * Gap between series requests. The whole catalog is walked once every 30 minutes,
 * so pacing costs nothing and keeps us clear of Cloudflare's burst limits — which
 * do trigger, and answer with a challenge page rather than an error.
 */
const REQUEST_GAP_MS = 400;

interface AsuraChapter {
  number: number;
  is_locked: boolean;
  early_access_until: string | null;
  /** Asura publishes this on every chapter; it is what dates our history. */
  published_at?: string | null;
}

/**
 * Astro serializes island props as `[typeTag, value]` pairs, where tag 1 marks an
 * array and anything else wraps a scalar or object. Unwrapping recursively hands
 * back plain JSON.
 */
export const unwrapAstro = (node: unknown): unknown => {
  if (Array.isArray(node) && node.length === 2 && typeof node[0] === "number") {
    const [tag, value] = node;
    return tag === 1 && Array.isArray(value) ? value.map(unwrapAstro) : unwrapAstro(value);
  }
  if (node !== null && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, unwrapAstro(v)]));
  }
  return node;
};

/**
 * The chapter list is server-rendered into an Astro island's `props` attribute as
 * structured JSON, which is both easier and far more durable than reading it back
 * out of the rendered DOM — and it carries the gating flags, which the markup does
 * not expose directly.
 */
export const parseChapters = (props: string): AsuraChapter[] => {
  const parsed = unwrapAstro(JSON.parse(decodeEntities(props))) as { chapters?: unknown };
  if (!Array.isArray(parsed.chapters)) return [];
  return parsed.chapters.filter(
    (c): c is AsuraChapter => typeof c === "object" && c !== null && typeof (c as AsuraChapter).number === "number"
  );
};

/**
 * Announce the newest chapter a reader can actually open. Early access expires on
 * a timestamp, so a paid chapter becomes free later rather than staying hidden —
 * the old scraper bailed on the whole series when the newest was gated, which
 * permanently skipped any free chapter released alongside it.
 */
export const readableChapters = (chapters: AsuraChapter[], now: number): AsuraChapter[] =>
  chapters.filter((c) => !c.is_locked && (!c.early_access_until || Date.parse(c.early_access_until) <= now));

/**
 * A second island on the same page carries the series' own metadata — status,
 * total chapter count, author, artist, genres, description, rating. The scraper
 * read only the chapter list and discarded all of it, which meant paying for a
 * request and throwing away most of what it returned.
 *
 * `chapterCount` is the valuable one: the gap against what we have announced is
 * direct evidence that chapters exist which we have not seen.
 */
export const parseDescription = (props: string): SeriesMetadata => {
  const parsed = unwrapAstro(JSON.parse(decodeEntities(props))) as Record<string, unknown>;
  const str = (key: string): string | undefined => {
    const value = parsed[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const count = parsed.chapterCount;
  return {
    status: str("status"),
    chapterCount: typeof count === "number" && Number.isFinite(count) ? count : undefined,
    author: str("author"),
  };
};

const scraper: Scraper = {
  requestGapMs: REQUEST_GAP_MS,

  /**
   * Plain HTTP — Asura server-renders everything we need, so this no longer runs in
   * the puppeteer sidecar.
   */
  async scrapeOne(url: string): Promise<ScrapeOutcome> {
    const response = await fetchWithPolicy(url, { redirect: "follow" });
    if (!response.ok) {
      return failure(
        url,
        SOURCE,
        statusReason(response.status),
        `${response.status} for ${url} (landed on ${response.url})`,
        response.status
      );
    }

    let title: string | undefined;
    let imageUrl: string | undefined;
    let props: string | undefined;
    let descriptionProps: string | undefined;

    await new HTMLRewriter()
      // Same response, same pass, no extra request — see parseDescription.
      .on('astro-island[component-url*="DescriptionModal"]', {
        element(el) {
          descriptionProps = el.getAttribute("props") ?? undefined;
        },
      })
      .on('meta[property="og:title"]', {
        element(el) {
          title = el
            .getAttribute("content")
            ?.replace(/\s*\|\s*Asura Scans\s*$/, "")
            .trim();
        },
      })
      .on('meta[property="og:image"]', {
        element(el) {
          imageUrl = el.getAttribute("content") ?? undefined;
        },
      })
      // The bundle filename carries a content hash that changes on every deploy, so
      // match on the component name rather than the full component-url.
      .on('astro-island[component-url*="ChapterListReact"]', {
        element(el) {
          props = el.getAttribute("props") ?? undefined;
        },
      })
      .transform(response)
      .text();

    if (!title || !props) {
      return failure(url, SOURCE, "parse", `page loaded but ${!title ? "title" : "chapter list"} was missing`);
    }

    let readable: AsuraChapter[];
    try {
      readable = readableChapters(parseChapters(props), Date.now());
    } catch (error) {
      return failure(url, SOURCE, "parse", `chapter props did not parse: ${String(error).slice(0, 200)}`);
    }

    if (readable.length === 0) {
      return failure(url, SOURCE, "empty", "no readable chapters (all locked or in early access)");
    }

    const latest = readable.reduce((a, b) => (b.number > a.number ? b : a));
    const publishedAt = latest.published_at ? new Date(latest.published_at) : undefined;

    // Metadata must never be able to fail the scrape — a chapter update is the job,
    // and the status is a nice-to-have on top of it.
    let metadata: SeriesMetadata | undefined;
    if (descriptionProps) {
      try {
        metadata = parseDescription(descriptionProps);
      } catch (error) {
        console.error(`[asura] could not parse series metadata for ${url}:`, error);
      }
    }

    return success({
      title,
      latestChapter: String(latest.number),
      // The requested URL, not a value reconstructed by index lookup afterwards.
      seriesUrl: url,
      chapterUrl: `${url}/chapter/${latest.number}`,
      source: SOURCE,
      imageUrl,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
      metadata,
    });
  },
};

export default scraper;
