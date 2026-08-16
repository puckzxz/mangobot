import { describe, expect, test } from "bun:test";
import {
  MATCH_THRESHOLD,
  lookupChapterTotal,
  scoreMedia,
  searchVariants,
  titleSimilarity,
  untranslatedChapters,
} from "./anilist";

describe("searchVariants", () => {
  /** All five real misses against the live catalog were one of these three shapes. */
  test("straightens a typographic apostrophe, which returns zero results as-is", () => {
    expect(searchVariants("Omniscient Reader’s Viewpoint")).toContain("Omniscient Reader's Viewpoint");
  });

  test("strips a trailing author parenthetical", () => {
    expect(searchVariants("MAD (OTORI Yusuke)")).toContain("MAD");
  });

  test("truncates a very long title to its first eight words", () => {
    const long = "I Was Reincarnated as the 7th Prince so I Can Take My Time Perfecting My Magicals Ability";
    expect(searchVariants(long)).toContain("I Was Reincarnated as the 7th Prince so");
  });

  test("always tries the stored title first", () => {
    expect(searchVariants("One-Punch Man")[0]).toBe("One-Punch Man");
  });

  test("does not emit duplicate variants for a plain title", () => {
    const variants = searchVariants("Vinland Saga");
    expect(new Set(variants).size).toBe(variants.length);
  });
});

describe("titleSimilarity", () => {
  test("an exact match scores 1", () => {
    expect(titleSimilarity("Vinland Saga", "Vinland Saga")).toBe(1);
  });

  test("case and punctuation do not matter", () => {
    expect(titleSimilarity("Omniscient Reader's Viewpoint", "omniscient readers viewpoint")).toBe(1);
  });

  test("a contained title still scores above the threshold", () => {
    expect(titleSimilarity("Omniscient Reader's Viewpoint", "Omniscient Reader")).toBeGreaterThanOrEqual(
      MATCH_THRESHOLD
    );
  });

  test("unrelated titles score below the threshold", () => {
    expect(titleSimilarity("Vinland Saga", "Chainsaw Man")).toBeLessThan(MATCH_THRESHOLD);
    expect(titleSimilarity("Heart Gear", "Solo Leveling")).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe("scoreMedia", () => {
  test("scores against whichever of the returned titles matches best", () => {
    const match = scoreMedia("Frieren - Beyond Journey's End", {
      id: 118586,
      title: { romaji: "Sousou no Frieren", english: "Frieren: Beyond Journey's End", native: "葬送のフリーレン" },
      synonyms: [],
      chapters: null,
    });
    expect(match.similarity).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(match.title).toBe("Frieren: Beyond Journey's End");
  });

  test("a still-releasing work has no total, which is not an error", () => {
    const match = scoreMedia("Nano Machine", {
      id: 1,
      title: { romaji: "Nano Machine" },
      synonyms: [],
      chapters: null,
    });
    expect(match.chapters).toBeNull();
  });
});

describe("lookupChapterTotal", () => {
  test("returns the first confident match and stops querying", () => {
    const asked: string[] = [];
    const fetcher = async (_q: string, v: { q: string }) => {
      asked.push(v.q);
      return { data: { Media: { id: 7, title: { english: "Vinland Saga" }, synonyms: [], chapters: 224 } } };
    };
    return lookupChapterTotal("Vinland Saga", fetcher).then((match) => {
      expect(match?.chapters).toBe(224);
      expect(asked).toHaveLength(1);
    });
  });

  /** AniList answers 404 for "no match", so a miss must fall through to the next variant. */
  test("falls through to a normalised variant when the stored title finds nothing", async () => {
    const asked: string[] = [];
    const fetcher = async (_q: string, v: { q: string }) => {
      asked.push(v.q);
      if (v.q.includes("’")) return { data: { Media: null } };
      return { data: { Media: { id: 9, title: { english: "Omniscient Reader" }, synonyms: [], chapters: null } } };
    };
    const match = await lookupChapterTotal("Omniscient Reader’s Viewpoint", fetcher);
    expect(match).not.toBeNull();
    expect(asked.length).toBeGreaterThan(1);
  });

  test("a confidently wrong match is rejected rather than stored", async () => {
    const fetcher = async () => ({
      data: { Media: { id: 1, title: { english: "Something Else Entirely" }, synonyms: [], chapters: 12 } },
    });
    expect(await lookupChapterTotal("Vinland Saga", fetcher)).toBeNull();
  });

  test("a thrown request yields null rather than propagating", async () => {
    const fetcher = async () => {
      throw new Error("429 rate limited");
    };
    expect(await lookupChapterTotal("Vinland Saga", fetcher)).toBeNull();
  });
});

describe("untranslatedChapters", () => {
  /** The Uma Musume case: 210 announced against an original of 211. */
  test("reports what the source has not translated", () => {
    expect(untranslatedChapters(211, "210")).toBe(1);
    expect(untranslatedChapters(224, "220")).toBe(4);
    expect(untranslatedChapters(301, "282.6")).toBe(18.4);
  });

  test("caught up yields null", () => {
    expect(untranslatedChapters(232, "232")).toBeNull();
  });

  /**
   * AniList publishes bad totals: Hero Killer and Ruri Dragon both claim a single
   * chapter against 276 and 50 announced. Believing those would hide real gaps.
   */
  test("a total below what we already have is discarded", () => {
    expect(untranslatedChapters(1, "276")).toBeNull();
    expect(untranslatedChapters(1, "50")).toBeNull();
  });

  test("no total, or a non-numeric chapter, yields null", () => {
    expect(untranslatedChapters(null, "50")).toBeNull();
    expect(untranslatedChapters(undefined, "50")).toBeNull();
    expect(untranslatedChapters(100, "Special")).toBeNull();
  });
});
