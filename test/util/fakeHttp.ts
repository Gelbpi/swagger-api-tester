import { Headers } from 'undici';
import type { HttpFetchImpl, HttpFetchResponse } from '../../src/engine/types/http.js';

export interface HttpRoute {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

function response(status: number, body: string, headers: Record<string, string>): HttpFetchResponse {
  return {
    status,
    headers: new Headers(headers) as unknown as HttpFetchResponse['headers'],
    text: async () => body,
  };
}

/** Deterministic HttpFetchImpl keyed by `${method} ${url}`; unknown -> 404. */
export function makeHttpFetchImpl(routes: Record<string, HttpRoute>): {
  fetchImpl: HttpFetchImpl;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl: HttpFetchImpl = async (url, init) => {
    const key = `${init.method} ${url}`;
    calls.push(key);
    const route = routes[key];
    if (!route) return response(404, '{"error":"not found"}', { 'content-type': 'application/json' });
    return response(route.status, route.body ?? '', route.headers ?? {});
  };
  return { fetchImpl, calls };
}

export function jsonRoute(obj: unknown, status = 200): HttpRoute {
  return { status, body: JSON.stringify(obj), headers: { 'content-type': 'application/json' } };
}
