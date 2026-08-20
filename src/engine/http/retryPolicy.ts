/**
 * Rate-limit / unavailable retry policy (build-prompt §30).
 *
 * 429: honor Retry-After, retry once; if still limited -> SKIPPED/RATE_LIMITED;
 *      on the first 429 the runner halves global concurrency for the rest of the
 *      run (signaled by `halveConcurrency`).
 * 503: with Retry-After -> same retry policy; without Retry-After -> FAIL/SERVER_ERROR.
 * Maximum total backoff defaults to 30s.
 */
export const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_429_DELAY_MS = 1_000;

/** Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - nowMs);
  return undefined;
}

export interface RateLimitDecision {
  action: 'retry' | 'skip_rate_limited' | 'fail_server' | 'none';
  delayMs: number;
  halveConcurrency: boolean;
}

/**
 * Decide what to do with a 429/503 response.
 * @param alreadyRetried whether this request has already been retried once.
 */
export function rateLimitPolicy(
  status: number,
  retryAfterHeader: string | null,
  nowMs: number,
  alreadyRetried: boolean,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
): RateLimitDecision {
  const retryAfter = parseRetryAfter(retryAfterHeader, nowMs);

  if (status === 429) {
    if (alreadyRetried) {
      return { action: 'skip_rate_limited', delayMs: 0, halveConcurrency: true };
    }
    return {
      action: 'retry',
      delayMs: Math.min(retryAfter ?? DEFAULT_429_DELAY_MS, maxBackoffMs),
      halveConcurrency: true,
    };
  }

  if (status === 503) {
    if (retryAfter === undefined) {
      return { action: 'fail_server', delayMs: 0, halveConcurrency: false };
    }
    if (alreadyRetried) {
      return { action: 'skip_rate_limited', delayMs: 0, halveConcurrency: false };
    }
    return { action: 'retry', delayMs: Math.min(retryAfter, maxBackoffMs), halveConcurrency: false };
  }

  return { action: 'none', delayMs: 0, halveConcurrency: false };
}
