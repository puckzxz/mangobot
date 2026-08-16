import { describe, expect, test } from "bun:test";
import { ALERT_THRESHOLDS, crossedAlertThreshold } from "./scrape-recorder";
import type { ScrapeFailureReason } from "./types/scraper";

const ALL_REASONS: ScrapeFailureReason[] = [
  "derive-url",
  "http",
  "blocked",
  "parse",
  "empty",
  "timeout",
  "network",
  "not-attempted",
  "internal",
];

describe("alert thresholds", () => {
  test("every failure reason has a threshold", () => {
    for (const reason of ALL_REASONS) {
      expect(ALERT_THRESHOLDS[reason]).toBeGreaterThan(0);
    }
  });

  /** A URL that cannot be parsed this pass cannot be parsed next pass either. */
  test("derive-url alerts immediately, because waiting cannot help", () => {
    expect(ALERT_THRESHOLDS["derive-url"]).toBe(1);
  });

  /**
   * Asura reports `empty` whenever every new chapter is still in early access,
   * which resolves on its own. Alerting at 3 would page on a normal Tuesday.
   */
  test("empty waits a full day of passes, unlike every other reason", () => {
    expect(ALERT_THRESHOLDS.empty).toBe(48);
    for (const reason of ALL_REASONS.filter((r) => r !== "empty")) {
      expect(ALERT_THRESHOLDS[reason]).toBeLessThan(ALERT_THRESHOLDS.empty);
    }
  });
});

describe("crossedAlertThreshold", () => {
  /** Firing on the exact crossing is what makes this stateless — no alertedAt column. */
  test("fires exactly once, on the crossing pass", () => {
    expect(crossedAlertThreshold("blocked", 2)).toBe(false);
    expect(crossedAlertThreshold("blocked", 3)).toBe(true);
    expect(crossedAlertThreshold("blocked", 4)).toBe(false);
    expect(crossedAlertThreshold("blocked", 300)).toBe(false);
  });

  test("does not fire on the first failure for reasons that tolerate a retry", () => {
    expect(crossedAlertThreshold("blocked", 1)).toBe(false);
    expect(crossedAlertThreshold("timeout", 1)).toBe(false);
  });

  test("fires on the first failure for derive-url", () => {
    expect(crossedAlertThreshold("derive-url", 1)).toBe(true);
  });

  test("a recovered series that fails again re-alerts, because the counter reset", () => {
    // recordSuccess sets consecutiveFailures to 0, so the next run of failures
    // walks 1..3 again and crosses once more.
    expect(crossedAlertThreshold("parse", 3)).toBe(true);
  });
});
