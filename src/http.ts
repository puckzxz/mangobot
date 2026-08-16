import { USER_AGENT } from "./user-agent";

/**
 * Every outbound scrape request goes through here.
 *
 * The timeout is the point. Nothing set a signal before, so a stalled upstream
 * blocked the whole pass on whatever the runtime's default happened to be — and
 * the `timeout` failure reason could never actually occur.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

export const fetchWithPolicy = (url: string, init?: RequestInit): Promise<Response> =>
  fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

/**
 * How long to wait after a 429, honouring `Retry-After` but never trusting it
 * unbounded — a source answering "come back in a day" must not park the pass.
 */
export const MAX_RETRY_WAIT_MS = 30_000;

export const retryAfterMs = (response: Response, attempt: number, baseMs: number): number => {
  const header = Number(response.headers.get("retry-after"));
  const wanted = Number.isFinite(header) && header > 0 ? header * 1_000 : baseMs * 2 ** (attempt - 1);
  return Math.min(wanted, MAX_RETRY_WAIT_MS);
};
