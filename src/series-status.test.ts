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
  /** The Dark Mage case: chapter 101 exists, sits in early access, we read 100. */
  test("reports the gap when the source lists a newer chapter than we can read", () => {
    expect(chaptersBehind(101, "100")).toBe(1);
    expect(chaptersBehind(112.7, "106.5")).toBe(6.2);
  });

  /**
   * The regression this field was renamed to prevent. Eternally Regressing Knight
   * has 116 chapter entries — 0 through 112, plus 112.5/112.6/112.7 — and its
   * newest readable chapter IS 112.7. Nothing is locked and nothing is missing.
   * Passing the count of 116 here reported "3.3 behind" forever; passing the
   * highest chapter number reports what is true.
   */
  test("a chapter count is not a chapter number, and must not be passed as one", () => {
    expect(chaptersBehind(112.7, "112.7")).toBeNull();
  });

  test.each([
    [152, "152"],
    [120, "120"],
    [100, "120"], // ours ahead — a source can drop a chapter without renumbering
  ])("highest %p vs ours %s is not behind", (highest, ours) => {
    expect(chaptersBehind(highest as number, ours as string)).toBeNull();
  });

  test("a source that states no highest chapter yields null, not zero", () => {
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
    sourceHighestChapter: null,
    anilistChapters: null,
    latestChapter: "220",
    consecutiveFailures: 0,
  };

  test("ended upstream, silent for months, nothing left — looks finished", () => {
    expect(assessCompletion(base, NOW).looksCompleted).toBe(true);
  });

  /** The source itself still has chapters we never announced. */
  test("does NOT look finished while chapters remain on the source", () => {
    const verdict = assessCompletion({ ...base, sourceHighestChapter: 224, latestChapter: "220" }, NOW);
    expect(verdict.behind).toBe(4);
    expect(verdict.looksCompleted).toBe(false);
  });

  /**
   * The Uma Musume case, and the reason a source total is not enough. Japanese
   * publication finished while the English translation sat at ~50 of ~180.
   * WeebCentral publishes no total at all, so only AniList can catch this — and
   * without it Vinland Saga (220 of 224) flagged as finished.
   */
  test("does NOT look finished while the work has untranslated chapters", () => {
    const verdict = assessCompletion({ ...base, anilistChapters: 224, latestChapter: "220" }, NOW);
    expect(verdict.behind).toBeNull();
    expect(verdict.untranslated).toBe(4);
    expect(verdict.looksCompleted).toBe(false);
  });

  test("looks finished only once BOTH gaps are closed", () => {
    const verdict = assessCompletion({ ...base, sourceHighestChapter: 220, anilistChapters: 220 }, NOW);
    expect(verdict.behind).toBeNull();
    expect(verdict.untranslated).toBeNull();
    expect(verdict.looksCompleted).toBe(true);
    expect(verdict.chapterTotalKnown).toBe(true);
  });

  /** Two of eighteen real AniList totals were plainly wrong (1 chapter vs 276). */
  test("an AniList total below what we already have is ignored, not believed", () => {
    const verdict = assessCompletion({ ...base, anilistChapters: 1, latestChapter: "220" }, NOW);
    expect(verdict.untranslated).toBeNull();
    expect(verdict.looksCompleted).toBe(true);
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
