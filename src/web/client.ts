import { AddSeriesRequest, AddSeriesResponse, ApiError, ListSeriesResponse } from "./api-types";

/** Typed fetch wrappers for the API — the only place the browser talks HTTP. */

const errorMessage = async (res: Response, fallback: string): Promise<string> => {
  try {
    const body = (await res.json()) as ApiError;
    if (typeof body?.error === "string") {
      return body.error;
    }
  } catch {
    // Non-JSON error body — use the fallback.
  }
  return `${fallback} (HTTP ${res.status})`;
};

export const fetchCatalog = async (): Promise<ListSeriesResponse> => {
  const res = await fetch("/api/series");
  if (!res.ok) {
    throw new Error(await errorMessage(res, "Could not load the catalog"));
  }
  return (await res.json()) as ListSeriesResponse;
};

export const addSeries = async (url: string): Promise<AddSeriesResponse> => {
  const res = await fetch("/api/series", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url } satisfies AddSeriesRequest),
  });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "Could not add the series"));
  }
  return (await res.json()) as AddSeriesResponse;
};

export const removeSeries = async (id: string): Promise<void> => {
  const res = await fetch(`/api/series/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await errorMessage(res, "Could not remove the series"));
  }
};
