import { describe, expect, test } from "bun:test";
import { buildHealthAlert } from "./health-alert";
import { ALERT_THRESHOLDS, crossedAlertThreshold, wasAlerted } from "./scrape-health";
import type { ScrapeFailureReason } from "./types/scraper";

const REASONS = Object.keys(ALERT_THRESHOLDS) as ScrapeFailureReason[];

describe("buildHealthAlert", () => {
  test("names the series, the count, the reason and the upstream detail", () => {
    const message = buildHealthAlert({
      kind: "failing",
      name: "Nano Machine",
      consecutiveFailures: 3,
      reason: "blocked",
      detail: "403 for https://asurascans.com/comics/nano-machine",
    });
    expect(message).toContain("Nano Machine");
    expect(message).toContain("3 times");
    expect(message).toContain("blocked");
    expect(message).toContain("403 for https://asurascans.com/comics/nano-machine");
  });

  /**
   * The point of the alert is what to do about it. A blocked source and a changed
   * page produce identical counters and need completely different responses, so
   * every reason has to say something different.
   */
  test("every failure reason carries its own advice", () => {
    const advice = REASONS.map((reason) =>
      buildHealthAlert({ kind: "failing", name: "X", consecutiveFailures: 1, reason, detail: "d" })
    );
    expect(new Set(advice).size).toBe(REASONS.length);
  });

  /** derive-url alerts on the very first failure, so this is not an edge case. */
  test("a single failure does not read as '1 time in a row'", () => {
    const message = buildHealthAlert({
      kind: "failing",
      name: "X",
      consecutiveFailures: 1,
      reason: "derive-url",
      detail: "d",
    });
    expect(message).toContain("**X** has failed —");
    expect(message).not.toContain("1 time");
  });

  test("a permanent fault says so, rather than implying it will pass", () => {
    const message = buildHealthAlert({
      kind: "failing",
      name: "X",
      consecutiveFailures: 1,
      reason: "derive-url",
      detail: "cannot derive a feed URL",
    });
    expect(message).toContain("will not fix itself");
  });

  test("recovery reports how bad it got", () => {
    expect(buildHealthAlert({ kind: "recovered", name: "Nano Machine", failuresBefore: 4 })).toBe(
      "✅ **Nano Machine** is scraping again after 4 failures."
    );
  });

  test.each([
    [1, "1 failure."],
    [2, "2 failures."],
  ])("recovery pluralises %i correctly", (count, ending) => {
    expect(buildHealthAlert({ kind: "recovered", name: "X", failuresBefore: count as number })).toEndWith(
      ending as string
    );
  });

  /**
   * Series names and upstream error text are third-party strings. A 2000-character
   * reply limit that throws inside the pass is exactly the failure class this
   * codebase keeps fixing, so the message stays bounded whatever arrives.
   */
  test("absurd input cannot produce an unsendable message", () => {
    const message = buildHealthAlert({
      kind: "failing",
      name: "A".repeat(5_000),
      consecutiveFailures: 3,
      reason: "parse",
      detail: "B".repeat(5_000),
    });
    expect(message.length).toBeLessThan(2_000);
  });
});

describe("wasAlerted", () => {
  /** A row below its threshold was never announced, so it has nothing to recover from. */
  test("is false below the threshold, true at and above it", () => {
    expect(wasAlerted("blocked", ALERT_THRESHOLDS.blocked - 1)).toBe(false);
    expect(wasAlerted("blocked", ALERT_THRESHOLDS.blocked)).toBe(true);
    expect(wasAlerted("blocked", ALERT_THRESHOLDS.blocked + 5)).toBe(true);
  });

  /**
   * The pairing that matters: crossedAlertThreshold fires once, on the exact pass,
   * and wasAlerted stays true for every count after it. If wasAlerted were also `===`
   * a series that kept failing past its threshold would recover silently.
   */
  test.each(REASONS)("%s stays 'alerted' after the pass that announced it", (reason) => {
    const threshold = ALERT_THRESHOLDS[reason as ScrapeFailureReason];
    expect(crossedAlertThreshold(reason as ScrapeFailureReason, threshold)).toBe(true);
    expect(crossedAlertThreshold(reason as ScrapeFailureReason, threshold + 1)).toBe(false);
    expect(wasAlerted(reason, threshold + 1)).toBe(true);
  });

  test("a healthy row has nothing to announce", () => {
    expect(wasAlerted(null, 0)).toBe(false);
    expect(wasAlerted(undefined, 0)).toBe(false);
    expect(wasAlerted("blocked", 0)).toBe(false);
  });

  /** A reason written by an older deploy must not crash or invent a threshold. */
  test("an unrecognised reason is treated as never alerted", () => {
    expect(wasAlerted("some-old-reason", 999)).toBe(false);
  });
});
