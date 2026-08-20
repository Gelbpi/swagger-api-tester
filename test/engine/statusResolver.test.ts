import { describe, expect, it } from 'vitest';
import { resolveExpectedStatus } from '../../src/engine/validation/statusResolver.js';
import type { Endpoint, HttpMethod } from '../../src/engine/types/endpoint.js';

function ep(method: HttpMethod, responses: Record<string, unknown>, path = '/x'): Endpoint {
  return {
    method,
    path,
    tags: [],
    deprecated: false,
    parameters: [],
    responses: responses as Endpoint['responses'],
    operation: {} as never,
  };
}

describe('resolveExpectedStatus (build-prompt §31)', () => {
  it('1: explicit expectStatus wins', () => {
    expect(resolveExpectedStatus(ep('GET', { '200': {} }), { expectStatus: 418 }).status).toBe(418);
  });

  it('2: config.expectations', () => {
    const r = resolveExpectedStatus(ep('POST', { '201': {} }, '/users'), {
      expectations: { 'POST /users': 202 },
    });
    expect(r.status).toBe(202);
  });

  it('3: lowest documented 2xx', () => {
    expect(resolveExpectedStatus(ep('GET', { '204': {}, '200': {}, '404': {} })).status).toBe(200);
    expect(resolveExpectedStatus(ep('GET', { '2XX': {} })).status).toBe(200);
  });

  it('4: method convention when no 2xx documented', () => {
    expect(resolveExpectedStatus(ep('POST', { '400': {} })).status).toBe(201);
    expect(resolveExpectedStatus(ep('DELETE', { '400': {} })).status).toBe(204);
    expect(resolveExpectedStatus(ep('PUT', {})).status).toBe(200);
  });

  it('5: only default documented is flagged', () => {
    const r = resolveExpectedStatus(ep('GET', { default: {} }));
    expect(r.onlyDefault).toBe(true);
  });
});
