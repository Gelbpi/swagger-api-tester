import { afterEach, describe, expect, it } from 'vitest';
import {
  MASK,
  maskString,
  registerSecret,
  resetRegisteredSecrets,
  sanitizeHeaders,
  sanitizeValue,
} from '../../src/engine/results/sanitizer.js';

afterEach(() => resetRegisteredSecrets());

const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('sanitizer: known secret shapes (build-prompt §14)', () => {
  it('masks JWTs', () => {
    expect(maskString(`token=${JWT}`)).not.toContain(JWT);
    expect(maskString(`token=${JWT}`)).toContain(MASK);
  });
  it('masks Bearer / Basic / sk- / ghp_ / AKIA / xox', () => {
    const samples = [
      'Authorization: Bearer abc.def.ghi123',
      'Authorization: Basic dXNlcjpwYXNzd29yZA==',
      'key sk-abcdefghijklmnop0123456789',
      'token ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'aws AKIAIOSFODNN7EXAMPLE',
      'slack xoxb-1234567890-abcdefghij',
    ];
    for (const s of samples) {
      const masked = maskString(s);
      expect(masked).toContain(MASK);
    }
    expect(maskString('sk-abcdefghijklmnop0123456789')).not.toContain('abcdefghijklmnop');
  });
});

describe('sanitizer: registered literals', () => {
  it('masks an exact registered secret anywhere', () => {
    registerSecret('super-secret-value-1234');
    expect(maskString('x=super-secret-value-1234;y=1')).toBe(`x=${MASK};y=1`);
  });
});

describe('sanitizer: headers and fields', () => {
  it('masks sensitive header names regardless of value', () => {
    const out = sanitizeHeaders({
      Authorization: 'Bearer whatever',
      Cookie: 'session=abc',
      'X-Api-Key': 'plainkey',
      'Content-Type': 'application/json',
    });
    expect(out.Authorization).toBe(MASK);
    expect(out.Cookie).toBe(MASK);
    expect(out['X-Api-Key']).toBe(MASK);
    expect(out['Content-Type']).toBe('application/json');
  });

  it('masks sensitive field names in nested objects', () => {
    const out = sanitizeValue({
      user: 'bob',
      password: 'hunter2',
      nested: { access_token: 'abc', ok: 'value' },
      list: [{ apiKey: 'x' }],
    }) as Record<string, unknown>;
    expect(out.password).toBe(MASK);
    expect((out.nested as Record<string, unknown>).access_token).toBe(MASK);
    expect((out.nested as Record<string, unknown>).ok).toBe('value');
    expect(((out.list as unknown[])[0] as Record<string, unknown>).apiKey).toBe(MASK);
    expect(out.user).toBe('bob');
  });

  it('handles cycles', () => {
    const a: Record<string, unknown> = { name: 'x' };
    a.self = a;
    const out = sanitizeValue(a) as Record<string, unknown>;
    expect(out.self).toBe('[Circular]');
  });
});

// Property-style check without Math.random (deterministic LCG), build-prompt §14.
describe('sanitizer: secrets cannot escape (property-style)', () => {
  it('a registered secret never survives in any generated payload', () => {
    let state = 123456789;
    const rand = () => (state = (1103515245 * state + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 500; i++) {
      const secret = `S${Math.floor(rand() * 1e9)}xTOKEN`;
      registerSecret(secret);
      const filler = 'abcd'.repeat(1 + Math.floor(rand() * 5));
      const payload = {
        a: `${filler}${secret}${filler}`,
        b: [secret, { deep: `pre-${secret}-post` }],
      };
      const masked = JSON.stringify(sanitizeValue(payload));
      expect(masked.includes(secret)).toBe(false);
      resetRegisteredSecrets();
    }
  });
});
