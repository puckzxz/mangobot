import { SeriesSource } from "../db";
import { ScraperResult } from "../types/scraper";
import { USER_AGENT } from "../user-agent";
// lol-html, which backs Bun's HTMLRewriter, hands back attribute values as raw
// source text rather than decoding entities, so `props` arrives still escaped.
import { decodeEntities } from "../utils/html-entities";

const SITE = "https://asurascans.com";

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
}

/**
 * Astro serializes island props as `[typeTag, value]` pairs, where tag 1 marks an
 * array and anything else wraps a scalar or object. Unwrapping recursively hands
 * back plain JSON.
 */
const unwrapAstro = (node: unknown): unknown => {
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
const parseChapters = (props: string): AsuraChapter[] => {
  const parsed = unwrapAstro(JSON.parse(decodeEntities(props))) as { chapters?: unknown };
  if (!Array.isArray(parsed.chapters)) return [];
  return parsed.chapters.filter(
    (c): c is AsuraChapter => typeof c === "object" && c !== null && typeof (c as AsuraChapter).number === "number"
  );
};

const scrapeOne = async (url: string): Promise<ScraperResult | null> => {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
  if (!response.ok) {
    console.error(`[asura] ${response.status} for ${url} (landed on ${response.url})`);
    return null;
  }

  let title: string | undefined;
  let imageUrl: string | undefined;
  let props: string | undefined;

  await new HTMLRewriter()
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
    console.error(`[asura] page loaded but ${!title ? "title" : "chapter list"} was missing: ${url}`);
    return null;
  }

  // Announce the newest chapter a reader can actually open. Early access expires on
  // a timestamp, so a paid chapter becomes free later rather than staying hidden —
  // the old scraper bailed on the whole series when the newest was gated, which
  // permanently skipped any free chapter released alongside it.
  const now = Date.now();
  const readable = parseChapters(props).filter(
    (c) => !c.is_locked && (!c.early_access_until || Date.parse(c.early_access_until) <= now)
  );

  if (readable.length === 0) {
    console.error(`[asura] no readable chapters for ${url}`);
    return null;
  }

  const latest = readable.reduce((a, b) => (b.number > a.number ? b : a));

  return {
    title,
    latestChapter: String(latest.number),
    // The requested URL, not a value reconstructed by index lookup afterwards.
    seriesUrl: url,
    chapterUrl: `${url}/chapter/${latest.number}`,
    source: SeriesSource.AsuraScans,
    imageUrl,
  };
};

export default {
  /**
   * Plain HTTP — Asura server-renders everything we need, so this no longer runs in
   * the puppeteer sidecar. One failing URL logs and is skipped; it no longer
   * abandons the rest of the batch.
   */
  async scrape(urls: string[]): Promise<ScraperResult[]> {
    const results: ScraperResult[] = [];

    for (const [index, url] of urls.entries()) {
      if (index > 0) await Bun.sleep(REQUEST_GAP_MS);
      try {
        const result = await scrapeOne(url);
        if (result) results.push(result);
      } catch (error) {
        console.error(`[asura] failed to scrape ${url}:`, error);
      }
    }

    if (urls.length > 0 && results.length === 0) {
      console.error(`[asura] returned 0 results for ${urls.length} URLs — the site contract has probably changed`);
    }

    return results;
  },
};
