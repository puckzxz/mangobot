/**
 * Turns what a source says about a series into something the panel can act on.
 *
 * Pure, and free of any database import — see the note in scrape-health.ts for why
 * that matters here.
 *
 * The load-bearing fact, measured rather than assumed: of 22 series WeebCentral
 * itself marks `Complete`, 19 received a chapter within 90 days and one within a
 * day. The status field describes whether the ORIGINAL WORK finished, not whether
 * this source has finished translating it. Uma Musume sat at English chapter ~50
 * of ~180 while flagged complete.
 *
 * So: status never gates scraping and never stops a series being checked. It is
 * triage — a label that tells a human where to look.
 */

/** Normalised across two sources that use different words for the same thing. */
export type UpstreamState = "ongoing" | "completed" | "hiatus" | "dropped" | "unknown";

/**
 * Vocabularies observed live:
 *   WeebCentral  Ongoing | Complete | Canceled          (note: no hiatus at all)
 *   AsuraScans   ongoing | completed | hiatus | dropped
 *   MangaDex     ongoing | completed | hiatus | cancelled
 *
 * WeebCentral having no hiatus value is why a dormancy signal is needed at all:
 * a paused series there stays `Ongoing` forever.
 */
const STATE_BY_WORD: Record<string, UpstreamState> = {
  ongoing: "ongoing",
  releasing: "ongoing",
  complete: "completed",
  completed: "completed",
  finished: "completed",
  hiatus: "hiatus",
  paused: "hiatus",
  dropped: "dropped",
  canceled: "dropped",
  cancelled: "dropped",
  axed: "dropped",
};

/** Returns "unknown" for a word we do not recognise, rather than guessing "ongoing". */
export const normaliseUpstreamStatus = (raw: string | null | undefined): UpstreamState => {
  if (!raw) return "unknown";
  return STATE_BY_WORD[raw.trim().toLowerCase()] ?? "unknown";
};

/**
 * How long without a new chapter before a series is worth a second look.
 *
 * Deliberately close to real ongoing gaps — this is a prompt to look, never a rule
 * that writes state. At 120 days it selects 23 of 79 series; at 60 it selects 32
 * and starts catching titles that are merely slow.
 */
export const DORMANT_AFTER_DAYS = 120;

export const isDormant = (latestChapterPublishedAt: Date | null | undefined, now: Date): boolean => {
  if (!latestChapterPublishedAt) return false; // unknown is not evidence of silence
  const days = (now.getTime() - latestChapterPublishedAt.getTime()) / 86_400_000;
  return days >= DORMANT_AFTER_DAYS;
};

/**
 * How many chapters the source has that we have never announced.
 *
 * Free from AsuraScans, which publishes `chapterCount` on the page the scraper
 * already downloads. A positive number is the strongest evidence a series is still
 * alive, whatever its status says — it already caught Eternally Regressing Knight
 * sitting at 112.7 against an upstream count of 116.
 *
 * Null when the source publishes no count, or when the count is not ahead of us.
 */
export const chaptersBehind = (sourceChapterCount: number | null | undefined, latestChapter: string): number | null => {
  if (!sourceChapterCount) return null;
  const ours = parseFloat(latestChapter);
  if (!Number.isFinite(ours)) return null;
  const behind = sourceChapterCount - ours;
  return behind > 0 ? Math.round(behind * 10) / 10 : null;
};

export interface CompletionInput {
  upstreamStatus: string | null | undefined;
  latestChapterPublishedAt: Date | null | undefined;
  sourceChapterCount: number | null | undefined;
  latestChapter: string;
  consecutiveFailures: number;
}

export interface CompletionVerdict {
  state: UpstreamState;
  dormant: boolean;
  behind: number | null;
  /**
   * A prompt for a human to look, never an action, and never a claim that the
   * series is definitely finished.
   *
   * KNOWN BLIND SPOT: the `behind === null` guard only bites where the source
   * publishes a chapter total. AsuraScans does; WeebCentral does not, so for 49 of
   * 79 series this reduces to "ended upstream and silent for months" with nothing
   * verifying that no chapters remain. Measured against AniList, Vinland Saga
   * (220 of 224) and Uma Musume (210 of 211) both flag here despite having
   * untranslated chapters left.
   *
   * That is survivable because nothing acts on this — scraping continues either
   * way and removal is a human decision. Closing it properly needs a chapter total
   * for WeebCentral series, which only a third-party index can supply.
   */
  looksCompleted: boolean;
  /** Whether `behind` was actually checkable, so callers can avoid overclaiming. */
  chapterTotalKnown: boolean;
}

export const assessCompletion = (input: CompletionInput, now: Date): CompletionVerdict => {
  const state = normaliseUpstreamStatus(input.upstreamStatus);
  const behind = chaptersBehind(input.sourceChapterCount, input.latestChapter);

  // Silence is only evidence while reads are succeeding. A scraper that broke 200
  // days ago produces exactly the same silence as a finished series, and belongs in
  // the health view rather than here.
  const dormant = input.consecutiveFailures === 0 && isDormant(input.latestChapterPublishedAt, now);

  const looksCompleted =
    (state === "completed" || state === "dropped") &&
    dormant &&
    // The Uma Musume guard: chapters still exist upstream that we have not
    // announced, so the work being finished says nothing about this URL being done.
    behind === null;

  return { state, dormant, behind, looksCompleted, chapterTotalKnown: !!input.sourceChapterCount };
};
