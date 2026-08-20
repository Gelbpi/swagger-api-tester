import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthManager, AuthError } from '../../src/engine/auth/authManager.js';
import { maskString, resetRegisteredSecrets } from '../../src/engine/results/sanitizer.js';
import { testEndpoint } from '../../src/engine/execution/testEndpoint.js';
import type { AuthProfile } from '../../src/engine/config/schema.js';
import type { HttpRequest, HttpResponse } from '../../src/engine/types/http.js';
import { makeFetcher } from '../util/fakeFetcher.js';
import { jsonRoute } from '../util/fakeHttp.js';
import { Headers } from 'undici';

afterEach(() => {
  resetRegisteredSecrets();
  delete process.env.LOGIN_PW;
});

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}
const jwt = (payload: Record<string, unknown>) => `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`;

/** A fake login sender that records requests and replies from a handler. */
function sender(handler: (req: HttpRequest, call: number) => { status: number; body: string }) {
  const calls: HttpRequest[] = [];
  const send = async (req: HttpRequest): Promise<HttpResponse> => {
    const { status, body } = handler(req, calls.length);
    calls.push(req);
    return { status, headers: {}, bodyText: body, durationMs: 0 };
  };
  return { send, calls };
}

describe('AuthManager login profile (build-prompt §25 login flow)', () => {
  const profile = (over: Partial<Extract<AuthProfile, { type: 'login' }>> = {}): Record<string, AuthProfile> => ({
    login: { type: 'login', loginUrl: 'http://api/login', tokenPath: '/token', body: { u: 'a' }, ...over },
  });

  it('logs in and sets a Bearer header from the token', async () => {
    const { send, calls } = sender(() => ({ status: 200, body: JSON.stringify({ token: 'TOK123' }) }));
    const mgr = new AuthManager(profile(), { now: () => 0, httpSend: send });
    const m = await mgr.resolve('login');
    expect(m?.headers.Authorization).toBe('Bearer TOK123');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://api/login');
  });

  it('caches the token (no second login) until invalidated', async () => {
    const { send, calls } = sender(() => ({ status: 200, body: JSON.stringify({ token: 'X' }) }));
    const mgr = new AuthManager(profile(), { now: () => 0, httpSend: send });
    await mgr.resolve('login');
    await mgr.resolve('login');
    expect(calls).toHaveLength(1);
    expect(mgr.isRefreshable('login')).toBe(true);
    mgr.invalidate('login');
    await mgr.resolve('login');
    expect(calls).toHaveLength(2);
  });

  it('extracts a nested token via JSON pointer and honors headerName/headerFormat', async () => {
    const { send } = sender(() => ({ status: 200, body: JSON.stringify({ data: { accessToken: 'ncap' } }) }));
    const mgr = new AuthManager(
      profile({ tokenPath: '/data/accessToken', headerName: 'X-Token', headerFormat: 'Token {token}' }),
      { now: () => 0, httpSend: send },
    );
    const m = await mgr.resolve('login');
    expect(m?.headers['X-Token']).toBe('Token ncap');
  });

  it('re-logs in after the JWT token expires', async () => {
    let now = 0;
    const { send, calls } = sender(() => ({ status: 200, body: JSON.stringify({ token: jwt({ exp: 10 }) }) }));
    const mgr = new AuthManager(profile(), { now: () => now, httpSend: send });
    await mgr.resolve('login');
    now = 5_000; // before exp (10s)
    await mgr.resolve('login');
    expect(calls).toHaveLength(1);
    now = 20_000; // after exp
    await mgr.resolve('login');
    expect(calls).toHaveLength(2);
  });

  it('resolves ${env:} secrets in the login body and masks the token', async () => {
    process.env.LOGIN_PW = 'sup3r-secret';
    const { send, calls } = sender(() => ({ status: 200, body: JSON.stringify({ token: 'leaky-token-xyz' }) }));
    const mgr = new AuthManager(profile({ body: { password: '${env:LOGIN_PW}' } }), {
      now: () => 0,
      httpSend: send,
    });
    await mgr.resolve('login');
    expect(calls[0]?.body).toContain('sup3r-secret'); // sent resolved
    expect(maskString('token is leaky-token-xyz')).not.toContain('leaky-token-xyz'); // masked everywhere
  });

  it('fails with AUTH_UNAVAILABLE on non-2xx login or missing token', async () => {
    const bad = new AuthManager(profile(), {
      now: () => 0,
      httpSend: sender(() => ({ status: 401, body: 'no' })).send,
    });
    await expect(bad.resolve('login')).rejects.toMatchObject({ reason: 'AUTH_UNAVAILABLE' });

    const noToken = new AuthManager(profile(), {
      now: () => 0,
      httpSend: sender(() => ({ status: 200, body: JSON.stringify({ nope: 1 }) })).send,
    });
    await expect(noToken.resolve('login')).rejects.toBeInstanceOf(AuthError);
  });
});

describe('login profile end-to-end: refresh on 401 (build-prompt §25)', () => {
  const BASE = 'http://localhost:8080';
  const spec = {
    openapi: '3.0.0',
    info: { title: 'T', version: '1.0.0' },
    paths: { '/secure': { get: { operationId: 'secure', security: [{ bearerAuth: [] }], responses: { '200': { description: 'ok' } } } } },
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
  };
  let projectDir: string;
  let dataDir: string;

  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), 'apitester-login-'));
    projectDir = join(root, 'proj');
    dataDir = join(root, 'data');
    mkdirSync(join(projectDir, '.api-tester'), { recursive: true });
    writeFileSync(
      join(projectDir, '.api-tester', 'config.json'),
      JSON.stringify({
        baseUrl: BASE,
        openApiUrl: '/v3/api-docs',
        defaultAuthProfile: 'auto',
        auth: { profiles: { auto: { type: 'login', loginUrl: '/auth/login', tokenPath: '/token', body: { user: 'a', pass: 'b' } } } },
      }),
    );
  });
  afterAll(() => rmSync(join(projectDir, '..'), { recursive: true, force: true }));

  it('logs in, and on a stale-token 401 refreshes and retries to PASS', async () => {
    let loginCalls = 0;
    let secureCalls = 0;
    const httpFetchImpl = async (url: string, init: { method: string }) => {
      const respond = (status: number, body: string): HttpResponse & { text(): Promise<string> } =>
        ({ status, headers: new Headers({ 'content-type': 'application/json' }) as never, text: async () => body }) as never;
      if (init.method === 'POST' && url === `${BASE}/auth/login`) {
        loginCalls++;
        return respond(200, JSON.stringify({ token: `tok-${loginCalls}` }));
      }
      if (init.method === 'GET' && url === `${BASE}/secure`) {
        secureCalls++;
        return secureCalls === 1 ? respond(401, '{}') : respond(200, '{}'); // stale first, ok after refresh
      }
      return respond(404, '{}');
    };

    const { compact } = await testEndpoint({
      method: 'GET',
      path: '/secure',
      project: projectDir,
      dataDir,
      now: () => 0,
      env: {} as NodeJS.ProcessEnv,
      specFetcher: makeFetcher({ [`${BASE}/v3/api-docs`]: jsonRoute(spec) }).fetcher,
      httpFetchImpl: httpFetchImpl as never,
    });

    expect(compact.outcome).toBe('PASS');
    expect(loginCalls).toBe(2); // initial + refresh
    expect(secureCalls).toBe(2); // 401 then 200
  });
});
