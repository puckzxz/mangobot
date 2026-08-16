import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { ListSeriesResponse, SeriesDto } from "./api-types";
import { addSeries, fetchCatalog } from "./client";
import { SeriesCard } from "./series-card";

type Notice = { kind: "ok" | "error"; text: string };

/**
 * Triage filters, in the order an ops panel is actually read: what is broken, what
 * needs a decision, what is waiting on us. Each renders only when it matches
 * something, so a healthy catalog shows no chips at all.
 */
const TRIAGE = [
  { key: "failing", label: "Failing", match: (s: SeriesDto) => s.consecutiveFailures > 0 },
  { key: "completed", label: "Looks finished", match: (s: SeriesDto) => s.looksCompleted },
  { key: "dormant", label: "Dormant", match: (s: SeriesDto) => s.dormant },
  { key: "behind", label: "Behind upstream", match: (s: SeriesDto) => s.chaptersBehind !== null },
] as const;

type TriageKey = (typeof TRIAGE)[number]["key"];

const App = () => {
  const [data, setData] = useState<ListSeriesResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SeriesDto["source"] | null>(null);
  const [triage, setTriage] = useState<TriageKey | null>(null);
  const [addUrl, setAddUrl] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await fetchCatalog());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submitAdd = async (event: FormEvent) => {
    event.preventDefault();
    const url = addUrl.trim();
    if (!url || addBusy) {
      return;
    }

    setAddBusy(true);
    setNotice(null);
    try {
      const added = await addSeries(url);
      setNotice({
        kind: "ok",
        text: added.alreadyInCatalog ? `${added.series.name} is already in the catalog` : `Added ${added.series.name}`,
      });
      setAddUrl("");
      await refresh();
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setAddBusy(false);
    }
  };

  const sources = useMemo(() => (data ? [...new Set(data.series.map((s) => s.source))] : []), [data]);

  const visible = useMemo(() => {
    if (!data) {
      return [];
    }
    const q = query.trim().toLowerCase();
    const triageMatch = TRIAGE.find((t) => t.key === triage)?.match;
    return data.series.filter(
      (s) =>
        (!sourceFilter || s.source === sourceFilter) &&
        (!q || s.name.toLowerCase().includes(q)) &&
        (!triageMatch || triageMatch(s))
    );
  }, [data, query, sourceFilter, triage]);

  // Counts drive whether a chip renders at all — a healthy catalog shows none.
  const triageCounts = useMemo(
    () => TRIAGE.map((t) => ({ ...t, count: data ? data.series.filter(t.match).length : 0 })),
    [data]
  );

  let body: ReactNode;
  if (loadError) {
    body = (
      <div className="state">
        <h2>Could not load the catalog</h2>
        <p>{loadError}</p>
        <button className="btn" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    );
  } else if (!data) {
    body = (
      <div className="state">
        <p>Loading…</p>
      </div>
    );
  } else if (!data.guild) {
    body = (
      <div className="state">
        <h2>No guild registered</h2>
        <p>
          Invite the bot to a Discord server, or run <code>scripts/seed-dev.ts</code> for local development.
        </p>
      </div>
    );
  } else if (data.series.length === 0) {
    body = (
      <div className="state">
        <h2>The catalog is empty</h2>
        <p>Paste a series URL above to start tracking it.</p>
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <div className="state">
        <p>No series match your search.</p>
      </div>
    );
  } else {
    body = (
      <main className="grid">
        {visible.map((s) => (
          <SeriesCard key={s.id} series={s} onRemoved={refresh} />
        ))}
      </main>
    );
  }

  const noteClass = addBusy ? "muted" : (notice?.kind ?? "muted");
  const noteText = addBusy
    ? "Fetching series details from the source — this can take a few seconds…"
    : (notice?.text ?? "");

  return (
    <div className="shell">
      <header className="top">
        <div className="top-row">
          <span className="wordmark">🥭 mangobot</span>
          {data && <span className="count-pill">{data.series.length} series</span>}
          {data?.guild && <span className="count-pill">{data.guild.name}</span>}
          <input
            className="search"
            type="search"
            placeholder="Search series…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {(sources.length > 1 || triageCounts.some((t) => t.count > 0)) && (
          <div className="chips">
            <button
              className="chip"
              aria-pressed={sourceFilter === null && triage === null}
              onClick={() => {
                setSourceFilter(null);
                setTriage(null);
              }}
            >
              All
            </button>
            {sources.length > 1 &&
              sources.map((source) => (
                <button
                  key={source}
                  className="chip"
                  aria-pressed={sourceFilter === source}
                  onClick={() => setSourceFilter(sourceFilter === source ? null : source)}
                >
                  {source}
                </button>
              ))}
            {triageCounts
              .filter((t) => t.count > 0)
              .map((t) => (
                <button
                  key={t.key}
                  className="chip chip-triage"
                  data-triage={t.key}
                  aria-pressed={triage === t.key}
                  onClick={() => setTriage(triage === t.key ? null : t.key)}
                >
                  {t.label} {t.count}
                </button>
              ))}
          </div>
        )}
      </header>

      <form className="add-form" onSubmit={submitAdd}>
        <input
          type="url"
          placeholder="Paste a series URL (MangaDex, AsuraScans, WeebCentral) to add it"
          value={addUrl}
          onChange={(e) => setAddUrl(e.target.value)}
          disabled={addBusy}
        />
        <button className="btn btn-primary" type="submit" disabled={addBusy || !addUrl.trim()}>
          {addBusy ? "Adding…" : "Add series"}
        </button>
      </form>
      <p className={`form-note ${noteClass}`}>{noteText}</p>

      {body}
    </div>
  );
};

createRoot(document.getElementById("root")!).render(<App />);
