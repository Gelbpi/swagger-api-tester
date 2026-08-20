import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpecCache } from '../../src/engine/cache/specCache.js';
import { loadOpenApi } from '../../src/engine/openapi/loadOpenApi.js';
import { makeFetcher, type Route } from '../util/fakeFetcher.js';
import type { OpenAPIV3 } from 'openapi-types';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'apitester-load-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const BASE = 'http://localhost:8080';
const now = () => '2026-01-01T00:00:00Z';
let counter = 0;
const freshCache = () => new SpecCache(join(dir, `c${counter++}`));

function json(obj: unknown): Route {
  return { status: 200, body: JSON.stringify(obj), headers: { 'content-type': 'application/json' } };
}

const spec30 = {
  openapi: '3.0.0',
  info: { title: 'Users', version: '1.0.0' },
  paths: {
    '/ping': { get: { responses: { '200': { description: 'ok' } } } },
    '/users': {
      post: {
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
        required: ['name'],
      },
    },
  },
};

describe('loadOpenApi (build-prompt §16)', () => {
  it('loads a 3.0 spec via openApiUrl and dereferences $refs', async () => {
    const { fetcher } = makeFetcher({ [`${BASE}/v3/api-docs`]: json(spec30) });
    const loaded = await loadOpenApi({
      baseUrl: BASE,
      openApiUrl: '/v3/api-docs',
      fetcher,
      cache: freshCache(),
      now,
    });
    expect(loaded.version).toBe('3.0');
    const doc = loaded.document as OpenAPIV3.Document;
    const schema = (doc.paths['/users']!.post!.requestBody as OpenAPIV3.RequestBodyObject).content[
      'application/json'
    ]!.schema as OpenAPIV3.SchemaObject;
    // Dereferenced: no $ref, the concrete object is inlined.
    expect(schema.type).toBe('object');
    expect(schema.properties?.name).toBeDefined();
  });

  it('probes the default paths and skips 404s / non-spec pages', async () => {
    const { fetcher, calls } = makeFetcher({
      // /v3/api-docs and /v3/api-docs.yaml 404, swagger-config is not present,
      // /api-docs 404, then /openapi.json serves the spec.
      [`${BASE}/openapi.json`]: json(spec30),
    });
    const loaded = await loadOpenApi({ baseUrl: BASE, fetcher, cache: freshCache(), now });
    expect(loaded.version).toBe('3.0');
    expect(loaded.sourceUrls).toEqual([`${BASE}/openapi.json`]);
    expect(calls).toContain(`${BASE}/v3/api-docs`);
  });

  it('converts a Swagger 2.0 spec found during probing', async () => {
    const swagger2 = {
      swagger: '2.0',
      info: { title: 'Legacy', version: '1.0.0' },
      paths: { '/ping': { get: { responses: { '200': { description: 'ok' } } } } },
    };
    const { fetcher } = makeFetcher({ [`${BASE}/v2/api-docs`]: json(swagger2) });
    const loaded = await loadOpenApi({ baseUrl: BASE, fetcher, cache: freshCache(), now });
    expect(loaded.version).toBe('2.0');
    expect((loaded.document as OpenAPIV3.Document).openapi.startsWith('3.0')).toBe(true);
  });

  it('merges grouped Springdoc APIs deterministically', async () => {
    const config = {
      configUrl: '/v3/api-docs/swagger-config',
      urls: [
        { url: '/v3/api-docs/groupB', name: 'B' },
        { url: '/v3/api-docs/groupA', name: 'A' },
      ],
    };
    const groupA = {
      openapi: '3.0.0',
      info: { title: 'A', version: '1.0.0' },
      paths: { '/a': { get: { responses: { '200': { description: 'ok' } } } } },
    };
    const groupB = {
      openapi: '3.0.0',
      info: { title: 'B', version: '1.0.0' },
      paths: { '/b': { get: { responses: { '200': { description: 'ok' } } } } },
    };
    const { fetcher } = makeFetcher({
      [`${BASE}/v3/api-docs/swagger-config`]: json(config),
      [`${BASE}/v3/api-docs/groupA`]: json(groupA),
      [`${BASE}/v3/api-docs/groupB`]: json(groupB),
    });
    const loaded = await loadOpenApi({ baseUrl: BASE, fetcher, cache: freshCache(), now });
    const doc = loaded.document as OpenAPIV3.Document;
    expect(Object.keys(doc.paths).sort()).toEqual(['/a', '/b']);
    // sorted by group name -> A resolved first
    expect(loaded.sourceUrls).toEqual([
      `${BASE}/v3/api-docs/groupA`,
      `${BASE}/v3/api-docs/groupB`,
    ]);
  });

  it('throws SPEC_UNREACHABLE when nothing is found', async () => {
    const { fetcher } = makeFetcher({});
    await expect(
      loadOpenApi({ baseUrl: BASE, fetcher, cache: freshCache(), now }),
    ).rejects.toMatchObject({ reason: 'SPEC_UNREACHABLE' });
  });

  it('gives an actionable "not running" hint on connection refused', async () => {
    const refusing = async () => {
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    };
    await loadOpenApi({ baseUrl: BASE, fetcher: refusing, cache: freshCache(), now }).catch(
      (e: { reason: string; message: string; hint?: string }) => {
        expect(e.reason).toBe('SPEC_UNREACHABLE');
        expect(`${e.message} ${e.hint ?? ''}`).toMatch(/running/i);
      },
    );
  });

  it('names the openApiUrl host that actually failed, not baseUrl', async () => {
    // baseUrl is fine, but the configured spec lives on a different (dead) host.
    const refusing = async () => {
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    };
    let captured: { message: string; hint?: string } | undefined;
    await loadOpenApi({
      baseUrl: BASE,
      openApiUrl: 'http://specs.internal:9999/openapi.json',
      fetcher: refusing,
      cache: freshCache(),
      now,
    }).catch((e: { message: string; hint?: string }) => {
      captured = e;
    });
    const text = `${captured?.message} ${captured?.hint ?? ''}`;
    expect(text).toContain('specs.internal:9999');
    expect(text).not.toContain('localhost:8080');
  });
});
