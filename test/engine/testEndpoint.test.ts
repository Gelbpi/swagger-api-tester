import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testEndpoint } from '../../src/engine/execution/testEndpoint.js';
import { RunStore } from '../../src/engine/results/runStore.js';
import { MASK, resetRegisteredSecrets } from '../../src/engine/results/sanitizer.js';
import { makeFetcher } from '../util/fakeFetcher.js';
import { makeHttpFetchImpl, jsonRoute } from '../util/fakeHttp.js';

const BASE = 'http://localhost:8080';
const now = () => Date.parse('2026-08-19T09:12:00Z');

const spec = {
  openapi: '3.0.0',
  info: { title: 'T', version: '1.0.0' },
  paths: {
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' }, name: { type: 'string' } } },
              },
            },
          },
        },
      },
      delete: { operationId: 'deleteUser', responses: { '204': { description: 'gone' } } },
    },
    '/broken': {
      get: {
        operationId: 'broken',
        responses: {
          '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } } } },
        },
      },
    },
    '/boom': { get: { operationId: 'boom', responses: { '200': { description: 'ok' } } } },
    '/notify': {
      post: {
        operationId: 'notifyUser',
        responses: { '201': { description: 'created' } },
      },
    },
  },
};

let projectDir: string;
let dataDir: string;

function baseInput() {
  return {
    project: projectDir,
    dataDir,
    now,
    env: {} as NodeJS.ProcessEnv,
    specFetcher: makeFetcher({ [`${BASE}/v3/api-docs`]: jsonRoute(spec) }).fetcher,
  };
}

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'apitester-te-'));
  projectDir = join(root, 'proj');
  dataDir = join(root, 'data');
  mkdirSync(join(projectDir, '.api-tester'), { recursive: true });
  writeFileSync(
    join(projectDir, '.api-tester', 'config.json'),
    JSON.stringify({
      baseUrl: BASE,
      openApiUrl: '/v3/api-docs',
      defaultAuthProfile: 'default',
      auth: { profiles: { default: { type: 'bearer', token: 'plain-secret-xyz' } } },
    }),
  );
});
afterAll(() => rmSync(join(projectDir, '..'), { recursive: true, force: true }));
afterEach(() => resetRegisteredSecrets());

describe('testEndpoint orchestrator (build-prompt §8, Phase 7)', () => {
  it('PASS on a valid response and persists a retrievable run', async () => {
    const { fetchImpl } = makeHttpFetchImpl({
      [`GET ${BASE}/users/1`]: jsonRoute({ id: 1, name: 'a' }),
    });
    const { compact, runId } = await testEndpoint({ ...baseInput(), method: 'GET', path: '/users/{id}', httpFetchImpl: fetchImpl });
    expect(compact.outcome).toBe('PASS');
    expect(compact.actualStatus).toBe(200);
    expect(compact.expectedStatus).toBe(200);
    expect(compact.bodyExcerpt).toBeNull(); // never a full success body

    const run = new RunStore(dataDir).getRun(runId);
    expect(run?.tests[0]?.outcome).toBe('PASS');
    // Auth header is masked in the persisted record.
    expect(run?.tests[0]?.request?.headers.Authorization).toBe(MASK);
    expect(JSON.stringify(run)).not.toContain('plain-secret-xyz');
  });

  it('FAIL/SCHEMA_VALIDATION_FAILED when body violates the schema', async () => {
    const { fetchImpl } = makeHttpFetchImpl({ [`GET ${BASE}/broken`]: jsonRoute({ id: 'not-int' }) });
    const { compact } = await testEndpoint({ ...baseInput(), method: 'GET', path: '/broken', httpFetchImpl: fetchImpl });
    expect(compact).toMatchObject({ outcome: 'FAIL', reason: 'SCHEMA_VALIDATION_FAILED' });
    expect(compact.validationErrors.length).toBeGreaterThan(0);
    expect(compact.bodyExcerpt).toContain('not-int');
  });

  it('FAIL/SERVER_ERROR on 5xx', async () => {
    const { fetchImpl } = makeHttpFetchImpl({ [`GET ${BASE}/boom`]: { status: 500, body: 'boom' } });
    const { compact } = await testEndpoint({ ...baseInput(), method: 'GET', path: '/boom', httpFetchImpl: fetchImpl });
    expect(compact).toMatchObject({ outcome: 'FAIL', reason: 'SERVER_ERROR' });
  });

  it('SKIPs side-effecting POST without confirmSideEffects, runs with it', async () => {
    const { fetchImpl } = makeHttpFetchImpl({ [`POST ${BASE}/notify`]: jsonRoute({}, 201) });
    const skipped = await testEndpoint({ ...baseInput(), method: 'POST', path: '/notify', httpFetchImpl: fetchImpl });
    expect(skipped.compact).toMatchObject({ outcome: 'SKIPPED', reason: 'SIDE_EFFECT_RISK' });

    const run = await testEndpoint({ ...baseInput(), method: 'POST', path: '/notify', confirmSideEffects: true, httpFetchImpl: fetchImpl });
    expect(run.compact.outcome).toBe('PASS');
    expect(run.compact.actualStatus).toBe(201);
  });

  it('SKIPs a destructive DELETE without confirmSideEffects', async () => {
    const { fetchImpl } = makeHttpFetchImpl({});
    const { compact } = await testEndpoint({ ...baseInput(), method: 'DELETE', path: '/users/{id}', httpFetchImpl: fetchImpl });
    expect(compact).toMatchObject({ outcome: 'SKIPPED', reason: 'DESTRUCTIVE_OPERATION' });
  });

  it('dryRun never sends the request', async () => {
    const { fetchImpl, calls } = makeHttpFetchImpl({ [`GET ${BASE}/users/1`]: jsonRoute({ id: 1 }) });
    const { compact, runId } = await testEndpoint({ ...baseInput(), method: 'GET', path: '/users/{id}', dryRun: true, httpFetchImpl: fetchImpl });
    expect(compact.outcome).toBe('SKIPPED');
    expect(compact.actualStatus).toBeNull();
    expect(calls).toEqual([]);
    const run = new RunStore(dataDir).getRun(runId);
    expect(run?.tests[0]?.request?.path).toBe('/users/1'); // shows what would be sent
  });

  it('ENGINE_ERROR when the endpoint is unknown', async () => {
    const { compact } = await testEndpoint({ ...baseInput(), method: 'GET', path: '/definitely/not/here' });
    expect(compact.outcome).toBe('ENGINE_ERROR');
  });
});
