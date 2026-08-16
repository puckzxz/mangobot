import type { ScrapeFailureReason } from "./types/scraper";

/**
 * The message sent when a series stops scraping, and when it starts again.
 *
 * Every failure was already typed, counted and persisted — and then reported with a
 * `console.error` nobody reads. That is a quieter version of the problem this
 * codebase keeps having: the bot knew a series was broken and had no way to say so.
 * Discord is where Chris finds things out, so that is where this goes.
 *
 * Pure, and free of any database or discord.js import, so the wording is testable —
 * see the note in scrape-health.ts for why that separation is load-bearing here.
 */

export type HealthEvent =
  | {
      kind: "failing";
      name: string;
      consecutiveFailures: number;
      reason: ScrapeFailureReason;
      detail: string;
    }
  | { kind: "recovered"; name: string; failuresBefore: number };

/**
 * What a human should do about it, which is the difference between an alert and a
 * notification. A blocked source and a changed page look identical in the counter
 * and need completely different responses.
 */
const ADVICE: Record<ScrapeFailureReason, string> = {
  "derive-url": "The stored URL cannot be turned into anything fetchable, so this will not fix itself.",
  blocked: "The source is refusing us — usually Cloudflare rate limits or bot rules, and often temporary.",
  parse: "The page loaded but its shape changed, so the scraper needs updating.",
  empty: "The source answered with no readable chapter for a full day of passes.",
  http: "The source answered with an error status.",
  timeout: "The source stopped responding in time.",
  network: "The request never reached the source.",
  "not-attempted": "The pass never got to this series, which points at the runner rather than the source.",
  internal: "Something in the scraper itself threw.",
};

/** Names and upstream error text are third-party strings; keep the message bounded. */
const clamp = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

export const buildHealthAlert = (event: HealthEvent): string => {
  const name = clamp(event.name, 120);

  if (event.kind === "recovered") {
    const plural = event.failuresBefore === 1 ? "failure" : "failures";
    return `✅ **${name}** is scraping again after ${event.failuresBefore} ${plural}.`;
  }

  // "has failed 1 time in a row" is the common case for derive-url, which alerts on
  // the first failure because there is nothing to wait for.
  const count =
    event.consecutiveFailures === 1 ? "has failed" : `has failed ${event.consecutiveFailures} times in a row`;
  return (
    `⚠️ **${name}** ${count} — ` +
    `\`${event.reason}\`: ${clamp(event.detail, 300)}\n` +
    `${ADVICE[event.reason]} It stays in the catalog and keeps being retried; ` +
    `no chapter is lost, but new ones will be missed until it works again.`
  );
};
