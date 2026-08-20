import { afterEach, describe, expect, it } from 'vitest';
import {
  AuthError,
  AuthManager,
  applyAuthMaterial,
} from '../../src/engine/auth/authManager.js';
import { decodeJwtPayload, isExpired, isJwt } from '../../src/engine/auth/jwt.js';
import { maskString, resetRegisteredSecrets } from '../../src/engine/results/sanitizer.js';
import type { AuthProfile } from '../../src/engine/config/schema.js';

afterEach(() => {
  resetRegisteredSecrets();
  delete process.env.APITESTER_TOK;
});

/** Build an unsigned JWT with the given payload (header.payload.sig). */
function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
}

describe('JWT utils (build-prompt §25)', () => {
  it('detects and decodes JWTs without verifying', () => {
    const t = makeJwt({ sub: '1', exp: 9999999999 });
    expect(isJwt(t)).toBe(true);
    expect(decodeJwtPayload(t)?.sub).toBe('1');
    expect(isJwt('not.a.jwt-plain')).toBe(false);
  });

  it('detects expiry from exp', () => {
    expect(isExpired({ exp: 1 }, Date.now())).toBe(true);
    expect(isExpired({ exp: 9999999999 }, Date.now())).toBe(false);
  });
});

describe('AuthManager (build-prompt §25, §37)', () => {
  const profiles: Record<string, AuthProfile> = {
    bearerLive: { type: 'bearer', token: makeJwt({ sub: 'a', exp: 9999999999 }) },
    bearerDead: { type: 'bearer', token: makeJwt({ sub: 'a', exp: 1 }) },
    basic: { type: 'basic', username: 'bob', password: 'hunter2' },
    apikeyHeader: { type: 'apikey', in: 'header', name: 'X-API-Key', value: 'secret-key-123' },
    apikeyQuery: { type: 'apikey', in: 'query', name: 'api_key', value: 'qk' },
    cookie: { type: 'cookie', name: 'session', value: 'abc' },
    fromEnv: { type: 'bearer', token: '${env:APITESTER_TOK}' },
  };
  const mgr = new AuthManager(profiles);

  it('returns null for no profile', async () => {
    expect(await mgr.resolve()).toBeNull();
  });

  it('throws AUTH_PROFILE_MISSING for unknown profile', async () => {
    await expect(mgr.resolve('nope')).rejects.toMatchObject({ reason: 'AUTH_PROFILE_MISSING' });
  });

  it('bearer sets Authorization', async () => {
    const m = await mgr.resolve('bearerLive');
    expect(m?.headers.Authorization).toMatch(/^Bearer /);
  });

  it('refuses an expired bearer with AUTH_UNAVAILABLE', async () => {
    await expect(mgr.resolve('bearerDead')).rejects.toBeInstanceOf(AuthError);
    await expect(mgr.resolve('bearerDead')).rejects.toMatchObject({ reason: 'AUTH_UNAVAILABLE' });
  });

  it('basic encodes and registers the secret', async () => {
    const m = await mgr.resolve('basic');
    expect(m?.headers.Authorization).toBe('Basic ' + Buffer.from('bob:hunter2').toString('base64'));
    expect(maskString(m!.headers.Authorization!)).not.toContain('bob:hunter2');
  });

  it('api key goes to header or query per config', async () => {
    expect((await mgr.resolve('apikeyHeader'))?.headers['X-API-Key']).toBe('secret-key-123');
    expect((await mgr.resolve('apikeyQuery'))?.query).toEqual([['api_key', 'qk']]);
  });

  it('cookie profile yields a cookie', async () => {
    expect((await mgr.resolve('cookie'))?.cookies).toEqual(['session=abc']);
  });

  it('resolves ${env:} placeholders in tokens', async () => {
    process.env.APITESTER_TOK = 'env-token';
    expect((await mgr.resolve('fromEnv'))?.headers.Authorization).toBe('Bearer env-token');
  });

  it('applyAuthMaterial merges headers, query, cookies', () => {
    const headers: Record<string, string> = { Cookie: 'existing=1' };
    const query: Array<[string, string]> = [];
    applyAuthMaterial(
      { headers: { Authorization: 'Bearer x' }, query: [['k', 'v']], cookies: ['a=b'] },
      headers,
      query,
    );
    expect(headers.Authorization).toBe('Bearer x');
    expect(headers.Cookie).toBe('existing=1; a=b');
    expect(query).toEqual([['k', 'v']]);
  });
});
