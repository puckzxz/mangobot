import { describe, expect, test } from "bun:test";
import { reconcileOutcomes } from "./fetch-manga";
import { SeriesSource } from "./db";
import { failure, success, statusReason, classifyThrown } from "./types/scraper";

const item = (url: string, source: SeriesSource = SeriesSource.WeebCentral) => ({ url, source });

const result = (seriesUrl: string) => ({
  title: "A Series",
  seriesUrl,
  chapterUrl: `${seriesUrl}/chapter/1`,
  latestChapter: "1",
  source: SeriesSource.WeebCentral,
  imageUrl: undefined,
  publishedAt: undefined,
});

describe("reconcileOutcomes", () => {
  test("returns exactly one outcome per requested URL, in request order", () => {
    const requested = [item("https://a"), item("https://b"), item("https://c")];
    const outcomes = reconcileOutcomes(requested, [success(result("https://c")), success(result("https://a"))]);

    expect(outcomes).toHaveLength(3);
    expect(outcomes.map((o) => o.seriesUrl)).toEqual(["https://a", "https://b", "https://c"]);
  });

  /**
   * The regression that matters. Scrapers returned an array shorter than their
   * input, so a dropped series vanished from the caller's loop entirely — no row
   * written, nothing counted, indistinguishable from a series nobody asked about.
   */
  test("a URL the scraper silently dropped comes back as not-attempted, never missing", () => {
    const requested = [item("https://kept"), item("https://dropped")];
    const outcomes = reconcileOutcomes(requested, [success(result("https://kept"))]);

    const dropped = outcomes.find((o) => o.seriesUrl === "https://dropped");
    expect(dropped).toBeDefined();
    expect(dropped!.ok).toBe(false);
    expect(dropped!.ok === false && dropped!.reason).toBe("not-attempted");
  });

  test("an empty scraper response still accounts for every requested URL", () => {
    const requested = [item("https://a"), item("https://b")];
    const outcomes = reconcileOutcomes(requested, []);

    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => !o.ok)).toBe(true);
  });

  test("preserves each item's own source on the synthesised failure", () => {
    const requested = [item("https://md", SeriesSource.MangaDex)];
    const [outcome] = reconcileOutcomes(requested, []);

    expect(outcome!.source).toBe(SeriesSource.MangaDex);
  });

  test("passes through failures the scraper reported itself", () => {
    const requested = [item("https://a")];
    const reported = failure("https://a", SeriesSource.WeebCentral, "blocked", "403", 403);
    const [outcome] = reconcileOutcomes(requested, [reported]);

    expect(outcome!.ok === false && outcome!.reason).toBe("blocked");
  });

  test("ignores outcomes for URLs that were never requested", () => {
    const outcomes = reconcileOutcomes(
      [item("https://a")],
      [success(result("https://a")), success(result("https://z"))]
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.seriesUrl).toBe("https://a");
  });
});

describe("statusReason", () => {
  /**
   * Cloudflare refusing us is the signal that a source has turned on bot rules —
   * it must not be filed under the same reason as a series that 404s.
   */
  test.each([
    [403, "blocked"],
    [429, "blocked"],
    [503, "blocked"],
    [404, "http"],
    [500, "http"],
  ])("%i maps to %s", (status, expected) => {
    expect(statusReason(status as number)).toBe(expected as never);
  });
});

describe("classifyThrown", () => {
  test("an aborted fetch is a timeout, not an internal error", () => {
    const error = new Error("The operation timed out.");
    error.name = "TimeoutError";
    const outcome = classifyThrown("https://a", SeriesSource.AsuraScans, error);

    expect(outcome.ok === false && outcome.reason).toBe("timeout");
  });

  test("a connection failure is network", () => {
    const outcome = classifyThrown("https://a", SeriesSource.AsuraScans, new TypeError("fetch failed"));
    expect(outcome.ok === false && outcome.reason).toBe("network");
  });

  test("anything else is internal, and the detail is bounded", () => {
    const outcome = classifyThrown("https://a", SeriesSource.AsuraScans, new Error("x".repeat(5_000)));
    expect(outcome.ok === false && outcome.reason).toBe("internal");
    expect(outcome.ok === false && outcome.detail.length).toBeLessThanOrEqual(300);
  });
});
