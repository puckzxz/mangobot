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

/**
 * Whether an alert was ever raised for the state a row is currently in — asked of a
 * failing row just before a success clears it, to decide if a recovery is worth
 * announcing.
 *
 * `>=` rather than `===`, and that difference is the whole point: crossedAlertThreshold
 * answers "alert on this pass?", this answers "was anybody ever told?". Without it a
 * series that failed once, below its threshold, would announce that it recovered from
 * an outage nobody heard about.
 *
 * Takes the raw column, which is a nullable String and can hold a reason from an older
 * deploy — an unrecognised one means no threshold, so no alert was sent.
 */
export const wasAlerted = (reason: string | null | undefined, consecutiveFailures: number): boolean => {
  if (!reason) return false;
  const threshold = ALERT_THRESHOLDS[reason as ScrapeFailureReason];
  return threshold !== undefined && consecutiveFailures >= threshold;
};
