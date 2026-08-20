import { describe, expect, it } from 'vitest';
import { Headers } from 'undici';
import { HttpClientError, sendRequest } from '../../src/engine/http/httpClient.js';
import type { HttpFetchImpl } from '../../src/engine/types/http.js';

function ok(body = '{}', status = 200, headers: Record<string, string> = {}): HttpFetchImpl {
  return async () => ({
    status,
    headers: new Headers(headers) as unknown as Headers & { get(n: string): string | null },
    text: async () => body,
  });
}

function rejectingWith(code: string, message = 'boom'): HttpFetchImpl {
  return async () => {
    throw Object.assign(new Error(message), { cause: { code } });
  };
}

/** Never resolves; aborts when the timeout signal fires. */
const hangs: HttpFetchImpl = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () =>
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
  });

async function kindOf(fetchImpl: HttpFetchImpl, method = 'GET' as const, timeoutMs = 5000) {
  try {
    await sendRequest({ method, url: 'http://localhost/x', headers: {}, timeoutMs }, { fetchImpl });
    return 'NO_ERROR';
  } catch (e) {
    return (e as HttpClientError).kind;
  }
}

describe('HttpClient (build-prompt §29)', () => {
  it('returns a response with headers and duration', async () => {
    const res = await sendRequest(
      { method: 'GET', url: 'http://localhost/x', headers: {} },
      { fetchImpl: ok('hello', 201, { 'content-type': 'text/plain' }) },
    );
    expect(res.status).toBe(201);
    expect(res.bodyText).toBe('hello');
    expect(res.headers['content-type']).toBe('text/plain');
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('maps connection refused / dns / tls / timeout', async () => {
    expect(await kindOf(rejectingWith('ECONNREFUSED'))).toBe('connection_refused');
    expect(await kindOf(rejectingWith('ENOTFOUND'))).toBe('dns');
    expect(await kindOf(rejectingWith('ERR_TLS_CERT_ALTNAME_INVALID'))).toBe('tls');
    expect(await kindOf(hangs, 'GET', 20)).toBe('timeout');
  });

  it('retries a transport error once for GET', async () => {
    let calls = 0;
    const flaky: HttpFetchImpl = async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      return { status: 200, headers: new Headers() as never, text: async () => 'ok' };
    };
    const res = await sendRequest({ method: 'GET', url: 'http://localhost/x', headers: {} }, { fetchImpl: flaky });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('never retries POST', async () => {
    let calls = 0;
    const flaky: HttpFetchImpl = async () => {
      calls++;
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    };
    await expect(
      sendRequest({ method: 'POST', url: 'http://localhost/x', headers: {} }, { fetchImpl: flaky }),
    ).rejects.toBeInstanceOf(HttpClientError);
    expect(calls).toBe(1);
  });

  it('never retries after a timeout', async () => {
    let calls = 0;
    const timeoutThenOk: HttpFetchImpl = (_url, init) => {
      calls++;
      return new Promise((_r, reject) =>
        init.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        ),
      );
    };
    await expect(
      sendRequest({ method: 'GET', url: 'http://localhost/x', headers: {}, timeoutMs: 20 }, { fetchImpl: timeoutThenOk }),
    ).rejects.toMatchObject({ kind: 'timeout' });
    expect(calls).toBe(1);
  });
});
