import { SeriesSource } from "../db";

/**
 * Hostname -> source. Matched on an exact parsed hostname rather than a string
 * prefix: `startsWith("https://asura")` also accepted `https://asura.attacker.tld`,
 * which would then be persisted and re-fetched every 30 minutes.
 *
 * MangaSee and ReaperScans are deliberately absent. mangasee123.com no longer
 * resolves and reaperscans.com is returning 502; neither has any rows, so new adds
 * are rejected rather than accepted and then silently never updated.
 */
const SOURCE_BY_HOSTNAME: Record<string, SeriesSource> = {
  "asurascans.com": SeriesSource.AsuraScans,
  "www.asurascans.com": SeriesSource.AsuraScans,
  "mangadex.org": SeriesSource.MangaDex,
  "www.mangadex.org": SeriesSource.MangaDex,
  "weebcentral.com": SeriesSource.WeebCentral,
  "www.weebcentral.com": SeriesSource.WeebCentral,
};

/** Distinct sites, for user-facing "supported sources" messages — derived from the
 * table above so it can never drift from what is actually accepted. */
export const SUPPORTED_HOSTNAMES = [...new Set(Object.keys(SOURCE_BY_HOSTNAME).map((h) => h.replace(/^www\./, "")))];

export const tryToDetermineSeriesSource = (url: string): SeriesSource | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") {
    return null;
  }

  return SOURCE_BY_HOSTNAME[parsed.hostname.toLowerCase()] ?? null;
};
