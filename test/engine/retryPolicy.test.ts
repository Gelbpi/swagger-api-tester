import { describe, expect, it } from 'vitest';
import { parseRetryAfter, rateLimitPolicy } from '../../src/engine/http/retryPolicy.js';

const NOW = 1_000_000;

describe('retryPolicy (build-prompt §30)', () => {
  it('parses Retry-After seconds and HTTP-date', () => {
    expect(parseRetryAfter('5', NOW)).toBe(5000);
    const date = new Date(NOW + 3000).toUTCString();
    expect(parseRetryAfter(date, NOW)).toBeGreaterThanOrEqual(0);
    expect(parseRetryAfter(null, NOW)).toBeUndefined();
  });

  it('429: retry once honoring Retry-After, then skip; always halves concurrency', () => {
    const first = rateLimitPolicy(429, '2', NOW, false);
    expect(first).toMatchObject({ action: 'retry', delayMs: 2000, halveConcurrency: true });
    const second = rateLimitPolicy(429, '2', NOW, true);
    expect(second).toMatchObject({ action: 'skip_rate_limited', halveConcurrency: true });
  });

  it('503 with Retry-After retries; without Retry-After fails as server error', () => {
    expect(rateLimitPolicy(503, '1', NOW, false)).toMatchObject({ action: 'retry', delayMs: 1000 });
    expect(rateLimitPolicy(503, null, NOW, false)).toMatchObject({ action: 'fail_server' });
  });

  it('caps backoff at the max', () => {
    expect(rateLimitPolicy(429, '9999', NOW, false, 30_000).delayMs).toBe(30_000);
  });

  it('non-rate-limit statuses -> none', () => {
    expect(rateLimitPolicy(200, null, NOW, false).action).toBe('none');
  });
});
