/**
 * Cached, conditional spec fetch (build-prompt §18).
 *
 * Issues a conditional GET (If-None-Match / If-Modified-Since) when a cache
 * entry exists. On 304 or identical SHA-256 the cached body is reused. Network
 * failures are mapped to SPEC_UNREACHABLE.
 */
import { EngineError } from '../types/errors.js';
import type { HttpFetcher } from '../types/openapi.js';
import type { SpecCache } from '../cache/specCache.js';
import { sha256Hex } from '../cache/specCache.js';

export interface FetchedSpec {
  url: string;
  text: string;
  contentType: string | undefined;
  sha256: string;
  fromCache: boolean;
}

export interface FetchSpecOptions {
  fetcher: HttpFetcher;
  cache: SpecCache;
  refreshSpec?: boolean;
  /** Injectable timestamp so runs are reproducible in tests. */
  now?: () => string;
}

export async function fetchSpec(url: string, opts: FetchSpecOptions): Promise<FetchedSpec> {
  const { fetcher, cache, refreshSpec = false } = opts;
  const now = opts.now ?? (() => new Date().toISOString());
  const prior = refreshSpec ? undefined : cache.getMeta(url);

  const headers: Record<string, string> = {};
  if (prior?.etag) headers['If-None-Match'] = prior.etag;
  if (prior?.lastModified) headers['If-Modified-Since'] = prior.lastModified;

  let res;
  try {
    res = await fetcher(url, { method: 'GET', headers });
  } catch (err) {
    throw new EngineError('SPEC_UNREACHABLE', `Could not reach spec at ${url}: ${String(err)}`);
  }

  if (res.status === 304 && prior) {
    const body = cache.getBody(prior.sha256);
    if (body !== undefined) {
      return {
        url,
        text: body,
        contentType: prior.contentType,
        sha256: prior.sha256,
        fromCache: true,
      };
    }
    // Cache metadata without body: fall through to a full refetch.
    return fetchSpec(url, { ...opts, refreshSpec: true });
  }

  if (res.status < 200 || res.status >= 300) {
    throw new EngineError(
      'SPEC_UNREACHABLE',
      `Spec at ${url} returned HTTP ${res.status}.`,
    );
  }

  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? undefined;
  const sha = sha256Hex(text);

  if (prior && prior.sha256 === sha) {
    return { url, text, contentType, sha256: sha, fromCache: true };
  }

  cache.put(url, text, {
    savedAt: now(),
    ...(res.headers.get('etag') ? { etag: res.headers.get('etag')! } : {}),
    ...(res.headers.get('last-modified') ? { lastModified: res.headers.get('last-modified')! } : {}),
    ...(contentType ? { contentType } : {}),
  });

  return { url, text, contentType, sha256: sha, fromCache: false };
}
