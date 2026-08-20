import { describe, expect, it } from 'vitest';
import type { OpenAPIV3 } from 'openapi-types';
import type { Endpoint, HttpMethod } from '../../src/engine/types/endpoint.js';
import { buildRequest } from '../../src/engine/generation/requestBuilder.js';

function makeEndpoint(over: Partial<Endpoint> & { method: HttpMethod; path: string }): Endpoint {
  return {
    tags: [],
    deprecated: false,
    parameters: [],
    responses: {},
    operation: {} as OpenAPIV3.OperationObject,
    ...over,
  };
}

const BASE = 'http://localhost:8080';

describe('RequestBuilder (build-prompt §22–24, §21)', () => {
  it('substitutes an integer path param (FormatDefault -> 1)', () => {
    const ep = makeEndpoint({
      method: 'GET',
      path: '/users/{id}',
      operationId: 'getUser',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    });
    const r = buildRequest({ endpoint: ep, baseUrl: BASE });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.path).toBe('/users/1');
      expect(r.request.url).toBe('http://localhost:8080/users/1');
    }
  });

  it('SKIPs NO_TEST_DATA for a free-form required path string (§22)', () => {
    const ep = makeEndpoint({
      method: 'GET',
      path: '/files/{key}',
      parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
    });
    const r = buildRequest({ endpoint: ep, baseUrl: BASE });
    expect(r).toMatchObject({ ok: false, reason: 'NO_TEST_DATA' });
  });

  it('includes required query, defaults, and excludes source-less optionals (§23)', () => {
    const ep = makeEndpoint({
      method: 'GET',
      path: '/search',
      parameters: [
        { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'page', in: 'query', required: false, schema: { type: 'integer' } },
        { name: 'size', in: 'query', required: false, schema: { type: 'integer', default: 20 } },
      ],
    });
    const r = buildRequest({ endpoint: ep, baseUrl: BASE });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const names = r.request.query.map(([k]) => k);
      expect(names).toContain('q');
      expect(names).toContain('size');
      expect(names).not.toContain('page');
      expect(r.request.url).toContain('size=20');
    }
  });

  it('generates a JSON body and self-validates it (§21/§24)', () => {
    const ep = makeEndpoint({
      method: 'POST',
      path: '/users',
      operationId: 'createUser',
      requestBody: {
        content: {
          'application/json': {
            schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
          },
        },
      } as OpenAPIV3.RequestBodyObject,
    });
    const r = buildRequest({ endpoint: ep, baseUrl: BASE });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.contentType).toBe('application/json');
      expect(r.request.body).toEqual({ name: 'string' });
      expect(r.request.headers['Content-Type']).toBe('application/json');
    }
  });

  it('SKIPs UNSUPPORTED_MEDIA_TYPE when no supported content type is documented (§24)', () => {
    const ep = makeEndpoint({
      method: 'POST',
      path: '/upload',
      requestBody: {
        required: true,
        content: { 'application/xml': { schema: { type: 'object' } } },
      } as OpenAPIV3.RequestBodyObject,
    });
    const r = buildRequest({ endpoint: ep, baseUrl: BASE });
    expect(r).toMatchObject({ ok: false, reason: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('SKIPs UNGENERATABLE_SCHEMA when the generated body fails its own schema (§21)', () => {
    const ep = makeEndpoint({
      method: 'POST',
      path: '/codes',
      requestBody: {
        content: {
          'application/json': { schema: { type: 'string', pattern: '^[0-9]{3}$', minLength: 10 } },
        },
      } as OpenAPIV3.RequestBodyObject,
    });
    const r = buildRequest({ endpoint: ep, baseUrl: BASE });
    expect(r).toMatchObject({ ok: false, reason: 'UNGENERATABLE_SCHEMA' });
  });

  it('explicit overrides beat generated values (§8)', () => {
    const ep = makeEndpoint({
      method: 'GET',
      path: '/users/{id}',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    });
    const r = buildRequest({
      endpoint: ep,
      baseUrl: BASE,
      explicit: { pathParams: { id: 99 }, query: { foo: 'bar' }, headers: { 'X-Test': '1' } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.request.path).toBe('/users/99');
      expect(r.request.url).toContain('foo=bar');
      expect(r.request.headers['X-Test']).toBe('1');
    }
  });

  it('seed varies generated data deterministically (§#11)', () => {
    const ep = makeEndpoint({
      method: 'POST',
      path: '/codes',
      requestBody: {
        content: { 'application/json': { schema: { type: 'object', required: ['code'], properties: { code: { type: 'string', pattern: '^[a-z]{8}$' } } } } },
      } as OpenAPIV3.RequestBodyObject,
    });
    const codeFor = (seed: string | number) => {
      const r = buildRequest({ endpoint: ep, baseUrl: BASE, seed });
      return r.ok ? (r.request.body as { code: string }).code : '';
    };
    expect(codeFor('A')).toBe(codeFor('A')); // deterministic per seed
    expect(codeFor('A')).not.toBe(codeFor('B')); // different seed -> different data
    expect(codeFor('A')).toMatch(/^[a-z]{8}$/);
  });

  it('config.requestOverride body is used and can be overridden by explicit body', () => {
    const ep = makeEndpoint({
      method: 'POST',
      path: '/users',
      requestBody: {
        content: { 'application/json': { schema: { type: 'object' } } },
      } as OpenAPIV3.RequestBodyObject,
    });
    const withOverride = buildRequest({
      endpoint: ep,
      baseUrl: BASE,
      requestOverride: { body: { from: 'config' } },
    });
    expect(withOverride.ok && withOverride.request.body).toEqual({ from: 'config' });

    const withExplicit = buildRequest({
      endpoint: ep,
      baseUrl: BASE,
      requestOverride: { body: { from: 'config' } },
      explicit: { body: { from: 'explicit' } },
    });
    expect(withExplicit.ok && withExplicit.request.body).toEqual({ from: 'explicit' });
  });
});
