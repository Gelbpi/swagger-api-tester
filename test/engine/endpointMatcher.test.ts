import { describe, expect, it } from 'vitest';
import { EndpointRegistry } from '../../src/engine/openapi/endpointRegistry.js';
import { matchEndpoint } from '../../src/engine/openapi/endpointMatcher.js';
import { sampleDoc } from '../util/sampleDoc.js';
import type { OpenApiDocument } from '../../src/engine/types/openapi.js';

const reg = new EndpointRegistry(sampleDoc);

describe('matchEndpoint (build-prompt §19)', () => {
  it('exact match', () => {
    const r = matchEndpoint(reg, 'GET', '/users/{id}');
    expect(r.match?.operationId).toBe('getUser');
    expect(r.tier).toBe('exact');
  });

  it('concrete value matches a templated param', () => {
    const r = matchEndpoint(reg, 'GET', '/users/123');
    expect(r.match?.path).toBe('/users/{id}');
    expect(r.tier).toBe('template');
  });

  it('param-name and :colon styles are equivalent', () => {
    expect(matchEndpoint(reg, 'GET', '/users/{userId}').match?.path).toBe('/users/{id}');
    expect(matchEndpoint(reg, 'GET', '/users/:id').match?.path).toBe('/users/{id}');
  });

  it('prefix-insensitive match (extra leading segment)', () => {
    const r = matchEndpoint(reg, 'GET', '/api/users');
    expect(r.match?.path).toBe('/users');
    expect(r.tier).toBe('prefix');
  });

  it('edit-distance fallback', () => {
    const r = matchEndpoint(reg, 'GET', '/user');
    expect(r.match?.path).toBe('/users');
    expect(r.tier).toBe('edit-distance');
  });

  it('does not match a different method', () => {
    expect(matchEndpoint(reg, 'PATCH', '/users/{id}').match).toBeUndefined();
  });

  it('returns candidates (no guess) when ambiguous', () => {
    const ambiguous = {
      openapi: '3.0.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/users/{id}': { get: { operationId: 'byId', responses: { '200': { description: 'ok' } } } },
        '/users/{slug}': {
          get: { operationId: 'bySlug', responses: { '200': { description: 'ok' } } },
        },
      },
    } as unknown as OpenApiDocument;
    const r = matchEndpoint(new EndpointRegistry(ambiguous), 'GET', '/users/abc');
    expect(r.match).toBeUndefined();
    expect(r.candidates).toHaveLength(2);
  });

  it('returns no candidates for a totally unknown path', () => {
    expect(matchEndpoint(reg, 'GET', '/completely/different/thing').candidates).toEqual([]);
  });
});
