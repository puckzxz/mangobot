import { describe, expect, test } from "bun:test";
import { highestChapterNumber, parseChapters, parseDescription, readableChapters, unwrapAstro } from "./asura";

/**
 * Astro serializes island props as `[typeTag, value]` pairs — tag 1 marks an array,
 * anything else wraps a scalar or object. Building fixtures through the same
 * encoding keeps them honest: a test that hand-writes plain JSON would pass while
 * the parser was broken. Shape copied from a real ChapterListReact island.
 */
const scalar = (value: unknown) => [0, value];
const chapter = (fields: Record<string, unknown>) => [
  0,
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, scalar(value)])),
];
const chapterProps = (chapters: Array<Record<string, unknown>>) =>
  JSON.stringify({ chapters: [1, chapters.map(chapter)] });

const HOUR = 3_600_000;
const NOW = Date.parse("2026-08-16T00:00:00Z");

describe("parseChapters", () => {
  test("unwraps the island encoding", () => {
    const parsed = parseChapters(
      chapterProps([
        { id: 1, number: 106.5, title: "Notice", is_locked: false, published_at: "2026-08-06T03:36:37.554Z" },
        { id: 2, number: 107, title: "Chapter 107", is_locked: false, published_at: null },
      ])
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.number).toBe(106.5);
    expect(parsed[0]!.published_at).toBe("2026-08-06T03:36:37.554Z");
  });

  /** A shape we do not recognise must yield nothing rather than a bogus chapter. */
  test("drops entries with no numeric chapter number", () => {
    expect(
      parseChapters(
        chapterProps([
          { id: 1, number: "seven" },
          { id: 2, number: 8 },
        ])
      )
    ).toHaveLength(1);
    expect(parseChapters(JSON.stringify({ chapters: scalar(null) }))).toEqual([]);
  });
});

describe("highestChapterNumber", () => {
  /**
   * The regression this function exists to prevent.
   *
   * Eternally Regressing Knight lists 116 chapters — 0 through 112, plus 112.5,
   * 112.6 and 112.7 — with nothing locked. The page advertises `chapterCount: 116`,
   * which is just `chapters.length`, and comparing that against the newest chapter
   * number reported a 3.3-chapter gap that could never close. The honest answer is
   * the highest number present: 112.7, exactly what we have already announced.
   */
  test("reports the highest chapter NUMBER, not how many chapters there are", () => {
    const chapters = [
      ...Array.from({ length: 113 }, (_, i) => ({ number: i, is_locked: false })),
      { number: 112.5, is_locked: false },
      { number: 112.6, is_locked: false },
      { number: 112.7, is_locked: false },
    ];
    expect(chapters).toHaveLength(116);
    expect(highestChapterNumber(chapters as never)).toBe(112.7);
  });

  /** Gated chapters are the entire point: they are what a gap is supposed to mean. */
  test("counts chapters we cannot read yet", () => {
    const chapters = parseChapters(
      chapterProps([
        { number: 100, is_locked: false },
        { number: 101, is_locked: true },
      ])
    );
    expect(highestChapterNumber(chapters)).toBe(101);
    expect(readableChapters(chapters, NOW)).toHaveLength(1);
  });

  test("is undefined for a series with no chapters at all", () => {
    expect(highestChapterNumber([])).toBeUndefined();
  });
});

describe("readableChapters", () => {
  const chapters = () =>
    parseChapters(
      chapterProps([
        { number: 1, is_locked: false, early_access_until: null },
        { number: 2, is_locked: true, early_access_until: null },
        // Early access that has already expired — a paid chapter becomes free, and
        // 23 of Absolute Regression's 114 chapters carry exactly this shape.
        { number: 3, is_locked: false, early_access_until: new Date(NOW - HOUR).toISOString() },
        { number: 4, is_locked: false, early_access_until: new Date(NOW + HOUR).toISOString() },
      ])
    );

  test("keeps what a reader can open, including expired early access", () => {
    expect(readableChapters(chapters(), NOW).map((c) => c.number)).toEqual([1, 3]);
  });

  /**
   * The old scraper bailed on the whole series when the newest chapter was gated,
   * which permanently skipped any free chapter released alongside it.
   */
  test("a gated newest chapter does not hide the free ones below it", () => {
    const readable = readableChapters(chapters(), NOW);
    expect(readable.reduce((a, b) => (b.number > a.number ? b : a)).number).toBe(3);
  });
});

describe("parseDescription", () => {
  const props = JSON.stringify({
    title: scalar("Worthless Regression"),
    status: scalar("axed"),
    author: scalar("Chugong"),
    chapterCount: scalar(107),
    rating: scalar(9.1),
  });

  test("reads the slow-changing fields", () => {
    expect(parseDescription(props)).toEqual({ status: "axed", author: "Chugong" });
  });

  /**
   * `chapterCount` is a tally of chapter entries, and the only reason this island is
   * read at all is status and author. Surfacing it again would re-open the units
   * mismatch, so it must not come back out of here.
   */
  test("does not hand back the page's chapter tally", () => {
    expect(parseDescription(props)).not.toHaveProperty("chapterCount");
  });

  test("blank fields read as absent, so a stored value is never wiped", () => {
    expect(parseDescription(JSON.stringify({ status: scalar("   "), author: scalar("") }))).toEqual({
      status: undefined,
      author: undefined,
    });
  });
});

describe("unwrapAstro", () => {
  test("leaves plain values alone", () => {
    expect(unwrapAstro([1, [scalar("a"), scalar("b")]])).toEqual(["a", "b"]);
    expect(unwrapAstro(scalar(42))).toBe(42);
    expect(unwrapAstro(null)).toBeNull();
  });
});
