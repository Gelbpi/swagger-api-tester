import { describe, expect, it } from 'vitest';
import { assertTargetAllowed } from '../../src/engine/http/targetGuard.js';

const reasonOf = (fn: () => unknown): string | 'OK' => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return (e as { reason: string }).reason;
  }
};

describe('TargetGuard (build-prompt §27)', () => {
  it('allows loopback targets', () => {
    expect(reasonOf(() => assertTargetAllowed('http://localhost:8080/x'))).toBe('OK');
    expect(reasonOf(() => assertTargetAllowed('http://127.0.0.1:8080/x'))).toBe('OK');
    expect(reasonOf(() => assertTargetAllowed('http://[::1]:8080/x'))).toBe('OK');
  });

  it('refuses non-loopback unless BOTH flags are set', () => {
    expect(reasonOf(() => assertTargetAllowed('http://example.com/x'))).toBe(
      'TARGET_REFUSED_BY_POLICY',
    );
    expect(
      reasonOf(() => assertTargetAllowed('http://example.com/x', { allowRemoteTargets: true, env: {} })),
    ).toBe('TARGET_REFUSED_BY_POLICY');
    expect(
      reasonOf(() =>
        assertTargetAllowed('http://example.com/x', {
          allowRemoteTargets: true,
          env: { API_TESTER_ALLOW_REMOTE: '1' },
        }),
      ),
    ).toBe('OK');
    // env only, config missing
    expect(
      reasonOf(() =>
        assertTargetAllowed('http://example.com/x', { env: { API_TESTER_ALLOW_REMOTE: '1' } }),
      ),
    ).toBe('TARGET_REFUSED_BY_POLICY');
  });

  it('always refuses prod/live/staging hosts, even with both flags', () => {
    const both = { allowRemoteTargets: true, env: { API_TESTER_ALLOW_REMOTE: '1' } };
    for (const host of ['api.prod.example.com', 'live.example.com', 'staging.example.com']) {
      expect(reasonOf(() => assertTargetAllowed(`http://${host}/x`, both))).toBe(
        'TARGET_REFUSED_BY_POLICY',
      );
    }
  });
});
