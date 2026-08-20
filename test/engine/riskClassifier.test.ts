import { describe, expect, it } from 'vitest';
import { classifyRisk } from '../../src/engine/execution/riskClassifier.js';
import type { Endpoint, HttpMethod } from '../../src/engine/types/endpoint.js';

function ep(method: HttpMethod, path: string, extra: Partial<Endpoint> = {}): Endpoint {
  return { method, path, tags: [], deprecated: false, parameters: [], responses: {}, operation: {} as never, ...extra };
}

describe('RiskClassifier (build-prompt §26)', () => {
  it('reads are READ, even for resource nouns like payments/orders', () => {
    expect(classifyRisk(ep('GET', '/payments'))).toBe('READ');
    expect(classifyRisk(ep('GET', '/orders'))).toBe('READ');
    expect(classifyRisk(ep('HEAD', '/x'))).toBe('READ');
    expect(classifyRisk(ep('OPTIONS', '/x'))).toBe('READ');
  });

  it('DELETE is always destructive', () => {
    expect(classifyRisk(ep('DELETE', '/users/{id}'))).toBe('DESTRUCTIVE');
  });

  it('purge-like write paths are destructive', () => {
    expect(classifyRisk(ep('POST', '/admin/purge'))).toBe('DESTRUCTIVE');
    expect(classifyRisk(ep('POST', '/cache', { operationId: 'wipeCache' }))).toBe('DESTRUCTIVE');
  });

  it('send-like write operations are side-effecting', () => {
    expect(classifyRisk(ep('POST', '/notify'))).toBe('SIDE_EFFECTING');
    expect(classifyRisk(ep('POST', '/messages', { operationId: 'sendEmail' }))).toBe('SIDE_EFFECTING');
    expect(classifyRisk(ep('POST', '/x', { summary: 'dispatch a webhook' }))).toBe('SIDE_EFFECTING');
  });

  it('other writes are MUTATING', () => {
    expect(classifyRisk(ep('POST', '/users'))).toBe('MUTATING');
    expect(classifyRisk(ep('PUT', '/users/{id}'))).toBe('MUTATING');
    expect(classifyRisk(ep('PATCH', '/users/{id}'))).toBe('MUTATING');
  });
});
