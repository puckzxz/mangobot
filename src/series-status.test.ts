import { describe, expect, test } from "bun:test";
import {
  DORMANT_AFTER_DAYS,
  assessCompletion,
  chaptersBehind,
  isDormant,
  normaliseUpstreamStatus,
} from "./series-status";

const NOW = new Date("2026-08-16T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("normaliseUpstreamStatus", () => {
  /** The two sources genuinely use different words for the same state. */
  test.each([
    ["Ongoing", "ongoing"], // WeebCentral
    ["ongoing", "ongoing"], // AsuraScans
    ["Complete", "completed"], // WeebCentral
    ["completed", "completed"], // AsuraScans
    ["Canceled", "dropped"], // WeebCentral, one L
    ["cancelled", "dropped"], // MangaDex, two
    ["dropped", "dropped"],
    ["hiatus", "hiatus"],
  ])("%s -> %s", (raw, expected) => {
    expect(normaliseUpstreamStatus(raw as string)).toBe(expected as never);
  });

  /** Guessing "ongoing" would silently launder a value we do not understand. */
  test.each([[null], [undefined], [""], ["some new word"]])("%p is unknown, not a guess", (raw) => {
    expect(normaliseUpstreamStatus(raw as string | null)).toBe("unknown");
  });
});

describe("isDormant", () => {
  test("counts from the upstream publish date", () => {
    expect(isDormant(daysAgo(DORMANT_AFTER_DAYS + 1), NOW)).toBe(true);
    expect(isDormant(daysAgo(DORMANT_AFTER_DAYS - 1), NOW)).toBe(false);
  });

  /** Never having seen a date is not evidence of silence. */
  test("an unknown publish date is not dormant", () => {
    expect(isDormant(null, NOW)).toBe(false);
  });
});

describe("chaptersBehind", () => {
  /** The real case: stored 112.7 against an upstream count of 116. */
  test("reports the gap when the source has more than we announced", () => {
    expect(chaptersBehind(116, "112.7")).toBe(3.3);
  });

  test.each([
    [152, "152"],
    [120, "120"],
    [100, "120"], // ours ahead — decimal chapters can do this
  ])("count %p vs ours %s is not behind", (count, ours) => {
    expect(chaptersBehind(count as number, ours as string)).toBeNull();
  });

  test("a source that publishes no count yields null, not zero", () => {
    expect(chaptersBehind(undefined, "50")).toBeNull();
    expect(chaptersBehind(null, "50")).toBeNull();
  });

  test("a non-numeric stored chapter cannot produce a bogus gap", () => {
    expect(chaptersBehind(100, "Special")).toBeNull();
  });
});

describe("assessCompletion", () => {
  const base = {
    upstreamStatus: "Complete",
    latestChapterPublishedAt: daysAgo(400),
    sourceChapterCount: null,
    latestChapter: "220",
    consecutiveFailures: 0,
  };

  test("ended upstream, silent for months, nothing left — looks finished", () => {
    expect(assessCompletion(base, NOW).looksCompleted).toBe(true);
  });

  /**
   * The Uma Musume case, and the reason this is not a one-line status check.
   * Japanese publication finished while the English translation sat at ~50 of ~180.
   * The work being over says nothing about this URL being done.
   */
  test("does NOT look finished while chapters remain upstream", () => {
    const verdict = assessCompletion({ ...base, sourceChapterCount: 224, latestChapter: "220" }, NOW);
    expect(verdict.behind).toBe(4);
    expect(verdict.looksCompleted).toBe(false);
  });

  /**
   * Measured: 19 of 22 series WeebCentral marks Complete got a chapter within
   * 90 days. Recency alone must veto the label.
   */
  test("does NOT look finished when a chapter arrived recently, despite the status", () => {
    const verdict = assessCompletion({ ...base, latestChapterPublishedAt: daysAgo(3) }, NOW);
    expect(verdict.dormant).toBe(false);
    expect(verdict.looksCompleted).toBe(false);
  });

  /** Silence from a broken scraper is not evidence about the work. */
  test("a failing scrape is never dormant and never looks finished", () => {
    const verdict = assessCompletion({ ...base, consecutiveFailures: 5 }, NOW);
    expect(verdict.dormant).toBe(false);
    expect(verdict.looksCompleted).toBe(false);
  });

  test("hiatus is dormant but never looks finished — an author can come back", () => {
    const verdict = assessCompletion({ ...base, upstreamStatus: "hiatus" }, NOW);
    expect(verdict.state).toBe("hiatus");
    expect(verdict.dormant).toBe(true);
    expect(verdict.looksCompleted).toBe(false);
  });

  /** WeebCentral has no hiatus value, so a paused series sits at Ongoing forever. */
  test("an Ongoing series silent for a year is dormant, and still not finished", () => {
    const verdict = assessCompletion({ ...base, upstreamStatus: "Ongoing" }, NOW);
    expect(verdict.state).toBe("ongoing");
    expect(verdict.dormant).toBe(true);
    expect(verdict.looksCompleted).toBe(false);
  });

  test("a dropped series that is caught up looks finished", () => {
    expect(assessCompletion({ ...base, upstreamStatus: "dropped" }, NOW).looksCompleted).toBe(true);
  });

  test("an unrefreshed status never produces a verdict", () => {
    const verdict = assessCompletion({ ...base, upstreamStatus: null }, NOW);
    expect(verdict.state).toBe("unknown");
    expect(verdict.looksCompleted).toBe(false);
  });
});
