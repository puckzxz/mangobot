import { describe, expect, test } from "bun:test";
import { BASE_INTERVAL_MS, MAX_INTERVAL_MS, isDueForScrape, quietDays, scrapeIntervalMs } from "./scrape-schedule";

const NOW = new Date("2026-08-16T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
const HOUR = 60 * 60 * 1000;

describe("scrapeIntervalMs", () => {
  test.each([
    [0, BASE_INTERVAL_MS],
    [29, BASE_INTERVAL_MS],
    [30, 1 * HOUR],
    [59, 1 * HOUR],
    [60, 2 * HOUR],
    [90, 4 * HOUR],
    [120, 8 * HOUR],
    [150, 16 * HOUR],
  ])("%i days quiet -> %i ms", (days, expected) => {
    expect(scrapeIntervalMs(days as number)).toBe(expected as number);
  });

  test("caps at a day however long the silence", () => {
    expect(scrapeIntervalMs(180)).toBe(MAX_INTERVAL_MS);
    expect(scrapeIntervalMs(708)).toBe(MAX_INTERVAL_MS); // the quietest real series
    expect(scrapeIntervalMs(100_000)).toBe(MAX_INTERVAL_MS);
  });

  /** 2 ** 40 overflows to Infinity long before the clamp would apply. */
  test("absurd input cannot produce Infinity or NaN", () => {
    expect(Number.isFinite(scrapeIntervalMs(Number.MAX_SAFE_INTEGER))).toBe(true);
    expect(scrapeIntervalMs(NaN)).toBe(BASE_INTERVAL_MS);
    expect(scrapeIntervalMs(-5)).toBe(BASE_INTERVAL_MS);
  });
});

describe("quietDays", () => {
  test("measures from the upstream publish date", () => {
    expect(quietDays(daysAgo(10), NOW)).toBeCloseTo(10, 5);
  });

  test("is null when no publish date is known", () => {
    expect(quietDays(null, NOW)).toBeNull();
  });
});

describe("isDueForScrape", () => {
  const base = {
    latestChapterPublishedAt: daysAgo(1),
    lastAttemptAt: minutesAgo(31),
    sourceHighestChapter: null,
    latestChapter: "100",
  };

  test("an active series is due after 30 minutes, not before", () => {
    expect(isDueForScrape({ ...base, lastAttemptAt: minutesAgo(31) }, NOW)).toBe(true);
    expect(isDueForScrape({ ...base, lastAttemptAt: minutesAgo(29) }, NOW)).toBe(false);
  });

  test("a series quiet for 200 days waits a day between checks", () => {
    const quiet = { ...base, latestChapterPublishedAt: daysAgo(200) };
    expect(isDueForScrape({ ...quiet, lastAttemptAt: minutesAgo(60 * 23) }, NOW)).toBe(false);
    expect(isDueForScrape({ ...quiet, lastAttemptAt: minutesAgo(60 * 25) }, NOW)).toBe(true);
  });

  /** Never leave a series unscraped just because we have never looked at it. */
  test("a never-attempted series is always due", () => {
    expect(isDueForScrape({ ...base, lastAttemptAt: null, latestChapterPublishedAt: daysAgo(700) }, NOW)).toBe(true);
  });

  /** Silence cannot be measured without a publish date, so do not assume it. */
  test("an unknown publish date is always due", () => {
    expect(isDueForScrape({ ...base, latestChapterPublishedAt: null, lastAttemptAt: minutesAgo(1) }, NOW)).toBe(true);
  });

  /**
   * The stranding guard. A dormant series whose source lists a newer chapter than
   * we can read must not sit in the slow tier — the Dark Mage shape, where chapter
   * 101 exists behind early access while we are on 100. It unlocks, the next pass
   * announces it, and the gap closes on its own.
   */
  test("a chapter waiting upstream forces a check regardless of silence", () => {
    const stranded = {
      latestChapterPublishedAt: daysAgo(700),
      lastAttemptAt: minutesAgo(1),
      sourceHighestChapter: 101,
      latestChapter: "100",
    };
    expect(isDueForScrape(stranded, NOW)).toBe(true);
  });

  test("a caught-up dormant series is not forced", () => {
    const caughtUp = {
      latestChapterPublishedAt: daysAgo(700),
      lastAttemptAt: minutesAgo(1),
      sourceHighestChapter: 116,
      latestChapter: "116",
    };
    expect(isDueForScrape(caughtUp, NOW)).toBe(false);
  });

  /**
   * The regression that made the back-off leak. Eternally Regressing Knight has 116
   * chapter entries and a newest chapter of 112.7; while this field carried the
   * count, the guard fired on every pass forever and the series never backed off —
   * as it did for 10 of the 11 rows it flagged, none of which had anything waiting.
   * With a chapter number on both sides, silence is allowed to mean silence.
   */
  test("a decimal-numbered series that is caught up backs off like any other", () => {
    const artifact = {
      latestChapterPublishedAt: daysAgo(700),
      lastAttemptAt: minutesAgo(1),
      sourceHighestChapter: 112.7,
      latestChapter: "112.7",
    };
    expect(isDueForScrape(artifact, NOW)).toBe(false);
  });

  /**
   * The self-healing property: a new chapter moves the publish date, so the
   * interval collapses back to 30 minutes without anything having to reset it.
   */
  test("a chapter arriving returns a long-dormant series to the fast tier", () => {
    const wokenUp = { ...base, latestChapterPublishedAt: daysAgo(0), lastAttemptAt: minutesAgo(31) };
    expect(isDueForScrape(wokenUp, NOW)).toBe(true);
    expect(scrapeIntervalMs(0)).toBe(BASE_INTERVAL_MS);
  });
});
