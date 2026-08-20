/**
 * HTTP transport types (build-prompt §29).
 */
import type { HttpMethod } from './endpoint.js';

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  durationMs: number;
}

/** How a transport failure is categorized for later result classification. */
export type HttpErrorKind = 'connection_refused' | 'dns' | 'tls' | 'timeout' | 'transport';

/** Minimal fetch surface (undici-compatible) so the client is testable. */
export interface HttpFetchResponse {
  status: number;
  headers: Iterable<[string, string]> & { get(name: string): string | null };
  text(): Promise<string>;
}

export type HttpFetchImpl = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
  },
) => Promise<HttpFetchResponse>;
