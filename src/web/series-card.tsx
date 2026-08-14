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
          <span className="chapter">
            Ch. {series.latestChapter}
            {series.latestChapterAt && <span className="chapter-when"> · {relativeTime(series.latestChapterAt)}</span>}
          </span>
        </div>

        <div className="card-times">
          added {relativeTime(series.addedAt)} · checked {relativeTime(series.lastCheckedAt)}
        </div>

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
