import type { ScrapeFailureReason } from "./types/scraper";

/**
 * The policy half of scrape health: pure, and deliberately free of any database
 * import.
 *
 * `scrape-recorder.ts` reaches for the prisma singleton, which throws at import
 * time when DATABASE_URL is unset. Anything importing it is therefore untestable
 * without a database — and worse, `bun test` auto-loads the repo `.env`, so that
 * failure hides on a developer machine and only appears in CI. Keeping the rules
 * here means they can be tested for what they are: arithmetic.
 */

/**
 * How many consecutive failures before a reason is worth a human's attention.
 *
 * `derive-url` is permanent — a URL that cannot be parsed this pass cannot be
 * parsed next pass either, so there is nothing to wait for. `empty` is the
 * opposite: Asura reports it whenever every new chapter is still in early access,
 * which resolves on its own within a day, so it needs a full day of passes before
 * it means anything.
 */
export const ALERT_THRESHOLDS: Record<ScrapeFailureReason, number> = {
  "derive-url": 1,
  blocked: 3,
  parse: 3,
  http: 3,
  timeout: 3,
  network: 3,
  internal: 3,
  "not-attempted": 3,
  empty: 48,
};

/**
 * True only on the pass that crosses the line.
 *
 * Testing the exact crossing rather than `>=` is what makes this stateless: no
 * `alertedAt` column, no risk of re-alerting every 30 minutes forever, and a
 * series that recovers and breaks again alerts once more because a success resets
 * the counter to zero.
 */
export const crossedAlertThreshold = (reason: ScrapeFailureReason, consecutiveFailures: number): boolean =>
  consecutiveFailures === ALERT_THRESHOLDS[reason];
