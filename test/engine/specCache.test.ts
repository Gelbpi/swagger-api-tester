import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpecCache, sha256Hex } from '../../src/engine/cache/specCache.js';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'apitester-cache-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('SpecCache (build-prompt §18)', () => {
  it('stores and reads body + meta by url and sha', () => {
    const cache = new SpecCache(dir);
    const rec = cache.put('http://x/spec', '{"openapi":"3.0.0"}', {
      savedAt: '2026-01-01T00:00:00Z',
      etag: 'W/"abc"',
      lastModified: 'Wed, 01 Jan 2026 00:00:00 GMT',
      contentType: 'application/json',
    });
    expect(rec.sha256).toBe(sha256Hex('{"openapi":"3.0.0"}'));

    const meta = cache.getMeta('http://x/spec');
    expect(meta?.etag).toBe('W/"abc"');
    expect(meta?.contentType).toBe('application/json');
    expect(cache.getBody(rec.sha256)).toBe('{"openapi":"3.0.0"}');
  });

  it('returns undefined for unknown url/sha', () => {
    const cache = new SpecCache(dir);
    expect(cache.getMeta('http://nope')).toBeUndefined();
    expect(cache.getBody('deadbeef')).toBeUndefined();
  });

  it('sha256Hex is deterministic', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
  });
});
