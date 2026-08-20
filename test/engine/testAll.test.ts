import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testAll } from '../../src/engine/execution/testAll.js';
import { RunStore } from '../../src/engine/results/runStore.js';
import { makeFetcher } from '../util/fakeFetcher.js';
import { makeHttpFetchImpl, jsonRoute } from '../util/fakeHttp.js';

const BASE = 'http://localhost:8080';
const now = () => Date.parse('2026-08-19T09:12:00Z');

const okBody = { '200': { description: 'ok' } };
const spec = {
  openapi: '3.0.0',
  info: { title: 'T', version: '1.0.0' },
  paths: {
    '/a': { get: { operationId: 'a', responses: okBody } },
    '/b': { get: { operationId: 'b', responses: okBody } },
    '/c': { get: { operationId: 'c', responses: okBody } },
    '/fail': { get: { operationId: 'fail', responses: okBody } },
    '/fail2': {
      get: {
        operationId: 'fail2',
        responses: {
          '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } } } },
        },
      },
    },
    '/w': { post: { operationId: 'w', responses: { '201': { description: 'created' } } } },
  },
};

let projectDir: string;
let dataDir: string;

function base() {
  return {
    project: projectDir,
    dataDir,
    now,
    env: {} as NodeJS.ProcessEnv,
    specFetcher: makeFetcher({ [`${BASE}/v3/api-docs`]: jsonRoute(spec) }).fetcher,
  };
}

const routes = {
  [`GET ${BASE}/a`]: jsonRoute({}),
  [`GET ${BASE}/b`]: { status: 401, body: 'no' },
  [`GET ${BASE}/c`]: { status: 401, body: 'no' },
  [`GET ${BASE}/fail`]: { status: 500, body: 'boom' },
  [`GET ${BASE}/fail2`]: jsonRoute({ id: 'not-int' }),
  [`POST ${BASE}/w`]: jsonRoute({}, 201),
};

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'apitester-ta-'));
  projectDir = join(root, 'proj');
  dataDir = join(root, 'data');
  mkdirSync(join(projectDir, '.api-tester'), { recursive: true });
  writeFileSync(
    join(projectDir, '.api-tester', 'config.json'),
    JSON.stringify({ baseUrl: BASE, openApiUrl: '/v3/api-docs' }),
  );
});
afterAll(() => rmSync(join(projectDir, '..'), { recursive: true, force: true }));

describe('testAll orchestrator (build-prompt §9, §40)', () => {
  it('runs read-only by default; writes are skipped as MUTATIONS_DISABLED', async () => {
    const { fetchImpl } = makeHttpFetchImpl(routes);
    const { summary, runId } = await testAll({ ...base(), httpFetchImpl: fetchImpl });

    expect(summary.totals).toMatchObject({ total: 6, passed: 1, failed: 2, skipped: 3 });
    expect(summary.mutations).toBe(false);

    // Identical 401s collapse into a single AUTH_UNAVAILABLE group with count 2.
    const auth = summary.skipped.find((g) => g.reason === 'AUTH_UNAVAILABLE');
    expect(auth?.count).toBe(2);
    const mut = summary.skipped.find((g) => g.reason === 'MUTATIONS_DISABLED');
    expect(mut?.count).toBe(1);

    // Two distinct failure groups (SERVER_ERROR + SCHEMA_VALIDATION_FAILED).
    expect(summary.failures).toHaveLength(2);

    // Full run persisted and retrievable.
    const run = new RunStore(dataDir).getRun(runId);
    expect(run?.tests).toHaveLength(6);
  });

  it('executes writes when mutations are enabled', async () => {
    const { fetchImpl } = makeHttpFetchImpl(routes);
    const { summary } = await testAll({ ...base(), mutations: true, httpFetchImpl: fetchImpl });
    expect(summary.mutations).toBe(true);
    expect(summary.totals.passed).toBe(2); // /a and /w
    expect(summary.skipped.find((g) => g.reason === 'MUTATIONS_DISABLED')).toBeUndefined();
  });

  it('truncates failure groups per maxFailuresReturned', async () => {
    const { fetchImpl } = makeHttpFetchImpl(routes);
    const { summary } = await testAll({ ...base(), maxFailuresReturned: 1, httpFetchImpl: fetchImpl });
    expect(summary.failures).toHaveLength(1);
    expect(summary.truncated).toBe(true);
    expect(summary.droppedFailureGroups).toBe(1);
  });

  it('honors method filters', async () => {
    const { fetchImpl } = makeHttpFetchImpl(routes);
    const { summary } = await testAll({ ...base(), methods: ['POST'], mutations: true, httpFetchImpl: fetchImpl });
    expect(summary.totals.total).toBe(1);
  });
});
