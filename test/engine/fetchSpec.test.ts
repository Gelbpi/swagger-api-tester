import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpecCache } from '../../src/engine/cache/specCache.js';
import { fetchSpec } from '../../src/engine/openapi/fetchSpec.js';
import { makeFetcher } from '../util/fakeFetcher.js';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'apitester-fetchspec-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const now = () => '2026-01-01T00:00:00Z';
const URL = 'http://localhost:8080/v3/api-docs';

describe('fetchSpec caching (build-prompt §18)', () => {
  it('stores on first fetch, reuses via 304 on second', async () => {
    const cache = new SpecCache(join(dir, 'a'));
    const { fetcher } = makeFetcher({
      [URL]: { status: 200, body: '{"openapi":"3.0.0"}', etag: 'W/"v1"' },
    });
    const first = await fetchSpec(URL, { fetcher, cache, now });
    expect(first.fromCache).toBe(false);
    expect(first.text).toBe('{"openapi":"3.0.0"}');

    const second = await fetchSpec(URL, { fetcher, cache, now });
    expect(second.fromCache).toBe(true);
    expect(second.text).toBe('{"openapi":"3.0.0"}');
  });

  it('reuses when SHA-256 is identical even without validators', async () => {
    const cache = new SpecCache(join(dir, 'b'));
    const { fetcher } = makeFetcher({ [URL]: { status: 200, body: 'SAME' } });
    await fetchSpec(URL, { fetcher, cache, now });
    const again = await fetchSpec(URL, { fetcher, cache, now });
    expect(again.fromCache).toBe(true);
  });

  it('refreshSpec bypasses conditional revalidation', async () => {
    const cache = new SpecCache(join(dir, 'c'));
    const { fetcher, calls } = makeFetcher({
      [URL]: { status: 200, body: '{"openapi":"3.0.0"}', etag: 'W/"v1"' },
    });
    await fetchSpec(URL, { fetcher, cache, now });
    const forced = await fetchSpec(URL, { fetcher, cache, now, refreshSpec: true });
    expect(forced.fromCache).toBe(false);
    // Second call sent no If-None-Match, so server returned a full 200 body.
    expect(calls).toHaveLength(2);
  });

  it('maps non-2xx to SPEC_UNREACHABLE', async () => {
    const cache = new SpecCache(join(dir, 'd'));
    const { fetcher } = makeFetcher({ [URL]: { status: 500, body: 'boom' } });
    await expect(fetchSpec(URL, { fetcher, cache, now })).rejects.toMatchObject({
      reason: 'SPEC_UNREACHABLE',
    });
  });
});
