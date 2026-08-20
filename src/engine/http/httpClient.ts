/**
 * HTTP client (build-prompt §29).
 *
 * Uses undici fetch by default (injectable for tests). Default timeout 10s.
 * Retries ONLY transport errors (ECONNRESET / EPIPE / socket hang up) and ONLY
 * for idempotent methods (GET/HEAD/OPTIONS/PUT), at most once. Never retries
 * POST/PATCH/DELETE and never retries after a timeout. Status-based retries
 * (429/503) are handled by the runner via retryPolicy — not here.
 */
import { fetch } from 'undici';
import type { HttpMethod } from '../types/endpoint.js';
import type { HttpErrorKind, HttpFetchImpl, HttpRequest, HttpResponse } from '../types/http.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const RETRYABLE_METHODS = new Set<HttpMethod>(['GET', 'HEAD', 'OPTIONS', 'PUT']);

export class HttpClientError extends Error {
  readonly kind: HttpErrorKind;
  constructor(kind: HttpErrorKind, message: string) {
    super(message);
    this.name = 'HttpClientError';
    this.kind = kind;
  }
}

const undiciFetch: HttpFetchImpl = (url, init) =>
  fetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
    signal: init.signal,
  });

function codeOf(err: unknown): string {
  const e = err as { code?: string; cause?: { code?: string; message?: string }; message?: string };
  return String(e.code ?? e.cause?.code ?? '');
}

function messageOf(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string } };
  return `${e.message ?? ''} ${e.cause?.message ?? ''}`.toLowerCase();
}

function classifyError(err: unknown, aborted: boolean): HttpErrorKind {
  if (aborted) return 'timeout';
  const code = codeOf(err);
  const msg = messageOf(err);
  if (code === 'ECONNREFUSED') return 'connection_refused';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  if (code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL') || /cert|self-signed|tls|ssl/.test(msg)) {
    return 'tls';
  }
  if (code === 'ECONNRESET' || code === 'EPIPE' || /socket hang up|other side closed|econnreset/.test(msg)) {
    return 'transport';
  }
  return 'transport';
}

function collectHeaders(res: { headers: Iterable<[string, string]> }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of res.headers) out[k.toLowerCase()] = v;
  return out;
}

export interface SendOptions {
  fetchImpl?: HttpFetchImpl;
}

export async function sendRequest(req: HttpRequest, opts: SendOptions = {}): Promise<HttpResponse> {
  const fetchImpl = opts.fetchImpl ?? undiciFetch;
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = RETRYABLE_METHODS.has(req.method) ? 2 : 1;

  let lastError: HttpClientError | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = performance.now();
    try {
      const res = await fetchImpl(req.url, {
        method: req.method,
        headers: req.headers,
        ...(req.body !== undefined ? { body: req.body } : {}),
        signal: controller.signal,
      });
      const bodyText = await res.text();
      return {
        status: res.status,
        headers: collectHeaders(res),
        bodyText,
        durationMs: Math.round(performance.now() - start),
      };
    } catch (err) {
      const kind = classifyError(err, controller.signal.aborted);
      lastError = new HttpClientError(kind, `${req.method} ${req.url} failed: ${kind}`);
      // Retry once, transport errors only, idempotent methods only, never timeout.
      if (kind === 'transport' && attempt < maxAttempts) continue;
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new HttpClientError('transport', 'request failed');
}
