/**
 * Default HTTP fetcher used for retrieving OpenAPI specs (build-prompt §16).
 *
 * This is intentionally minimal — the full request client with timeouts,
 * retries and the target guard (used against the API under test) is a separate
 * concern implemented in Phase 5. Spec discovery only needs a plain GET.
 */
import { fetch } from 'undici';
import type { HttpFetcher } from '../types/openapi.js';

export const defaultFetcher: HttpFetcher = async (url, init) => {
  const res = await fetch(url, { method: init?.method ?? 'GET', headers: init?.headers });
  return {
    status: res.status,
    headers: { get: (name: string) => res.headers.get(name) },
    text: () => res.text(),
  };
};
