import type { FetchResponse, HttpFetcher } from '../../src/engine/types/openapi.js';

export interface Route {
  status: number;
  body?: string;
  /** Header names must be lowercase. */
  headers?: Record<string, string>;
  /** If set and the request's If-None-Match matches, respond 304. */
  etag?: string;
}

function makeResponse(status: number, body: string, headers: Record<string, string>): FetchResponse {
  return {
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

/** A deterministic in-memory fetcher for tests; unknown URLs return 404. */
export function makeFetcher(routes: Record<string, Route>): { fetcher: HttpFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: HttpFetcher = async (url, init) => {
    calls.push(url);
    const route = routes[url];
    if (!route) return makeResponse(404, 'not found', {});
    const headers = { ...(route.headers ?? {}) };
    if (route.etag) {
      headers.etag = route.etag;
      if (init?.headers?.['If-None-Match'] === route.etag) return makeResponse(304, '', {});
    }
    return makeResponse(route.status, route.body ?? '', headers);
  };
  return { fetcher, calls };
}
