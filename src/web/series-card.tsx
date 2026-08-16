import { useState } from "react";
import type { SeriesDto } from "./api-types";
import { removeSeries } from "./client";

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

// Narrow keeps card lines compact: "3d ago" instead of "3 days ago".
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

const relativeTime = (iso: string): string => {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
};

type Props = {
  series: SeriesDto;
  onRemoved: () => void | Promise<void>;
};

export const SeriesCard = ({ series, onRemoved }: Props) => {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverBroken, setCoverBroken] = useState(false);

  const failing = series.consecutiveFailures > 0;
  const published = series.latestChapterPublishedAt ?? series.latestChapterAt;
  // Only worth showing when it says something the card does not already imply.
  const showState = series.upstreamState !== "ongoing" && series.upstreamState !== "unknown";

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeSeries(series.id);
      await onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <article className="card">
      {series.imageUrl && !coverBroken ? (
        // no-referrer: some source CDNs reject hotlinked requests that carry one.
        <img
          className="cover"
          src={series.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setCoverBroken(true)}
        />
      ) : (
        <div className="cover cover-fallback" aria-hidden="true">
          {(series.name[0] ?? "?").toUpperCase()}
        </div>
      )}

      <div className="card-body">
        <a className="card-title" href={series.url} target="_blank" rel="noreferrer" title={series.name}>
          {series.name}
        </a>

        <div className="card-meta">
          <span className="badge" data-source={series.source}>
            {series.source}
          </span>
          {showState && (
            <span
              className="badge badge-state"
              data-state={series.upstreamState}
              title={`Source says: ${series.upstreamStatusRaw}`}
            >
              {series.upstreamState}
            </span>
          )}
          <span className="chapter">
            Ch. {series.latestChapter}
            {/* Prefer the source's own publish date — latestChapterAt only says when
                the bot noticed, so every series looks fresh after a restart. */}
            {published && <span className="chapter-when"> · {relativeTime(published)}</span>}
          </span>
        </div>

        <div className="card-times">
          added {relativeTime(series.addedAt)} · checked {relativeTime(series.lastSuccessAt)}
          {series.author && ` · ${series.author}`}
        </div>

        {/* Gap A: the source has chapters we have never announced. Strong evidence a
            series is alive whatever its status says, so it outranks the label. */}
        {series.chaptersBehind !== null && (
          <div className="card-note">
            {series.chaptersBehind} more chapter(s) exist upstream — often early-access, which AsuraScans time-gates and
            the scraper deliberately skips until it unlocks
          </div>
        )}

        {series.untranslated !== null && (
          <div
            className="card-note"
            title={series.anilistTitle ? `Matched to "${series.anilistTitle}" on AniList` : undefined}
          >
            {series.untranslated} chapter(s) of the original are not translated here yet
          </div>
        )}

        {series.looksCompleted && (
          <div className="card-note">
            Looks finished — ended upstream, nothing new in months
            {series.chapterTotalKnown
              ? ", and nothing left to fetch"
              : ". No chapter total is known for this title, so check before removing"}
          </div>
        )}

        {failing && (
          <div className="card-warn" title={series.lastFailureMessage ?? undefined}>
            ⚠ scrape failing ({series.lastFailureReason}) — {series.consecutiveFailures}&times; in a row
          </div>
        )}

        {error && <div className="card-error">{error}</div>}

        <div className="card-footer">
          <span className="subs">
            {series.subscribers.length > 0 && (
              <>
                🔔 {series.subscribers.length}
                <span className="subs-pop">
                  {series.subscribers.map((s) => (
                    <span key={s.id} className="subs-pop-row">
                      {s.name ?? s.id}
                    </span>
                  ))}
                </span>
              </>
            )}
          </span>
          {confirming ? (
            <span className="confirm-row">
              Remove?
              <button className="btn btn-danger btn-small" onClick={() => void remove()} disabled={busy}>
                {busy ? "Removing…" : "Yes"}
              </button>
              <button className="btn btn-small" onClick={() => setConfirming(false)} disabled={busy}>
                No
              </button>
            </span>
          ) : (
            <button
              className="btn btn-small"
              onClick={() => {
                setConfirming(true);
                setError(null);
              }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </article>
  );
};
