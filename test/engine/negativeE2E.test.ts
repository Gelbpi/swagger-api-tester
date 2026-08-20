import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testAll } from '../../src/engine/execution/testAll.js';
import { makeFetcher } from '../util/fakeFetcher.js';
import { makeHttpFetchImpl, jsonRoute } from '../util/fakeHttp.js';

const BASE = 'http://localhost:8080';
const now = () => 0;

const spec = {
  openapi: '3.0.0',
  info: { title: 'T', version: '1.0.0' },
  paths: {
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } } } },
          '404': { description: 'not found', content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
        },
      },
    },
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
    maxParallelRequests: 1,
  };
}

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'apitester-neg-'));
  projectDir = join(root, 'proj');
  dataDir = join(root, 'data');
  mkdirSync(join(projectDir, '.api-tester'), { recursive: true });
  writeFileSync(join(projectDir, '.api-tester', 'config.json'), JSON.stringify({ baseUrl: BASE, openApiUrl: '/v3/api-docs' }));
});
afterAll(() => rmSync(join(projectDir, '..'), { recursive: true, force: true }));

describe('negative testing end-to-end (#7)', () => {
  it('tests both the happy path and the documented 404', async () => {
    const { fetchImpl } = makeHttpFetchImpl({
      [`GET ${BASE}/users/1`]: jsonRoute({ id: 1 }),
      [`GET ${BASE}/users/2147483647`]: jsonRoute({ error: 'not found' }, 404),
    });
    const { summary } = await testAll({ ...base(), negativeTests: true, httpFetchImpl: fetchImpl });
    // One happy-path test + one negative (404) test, both PASS.
    expect(summary.totals).toMatchObject({ total: 2, passed: 2 });
  });

  it('without negativeTests, only the happy path runs', async () => {
    const { fetchImpl } = makeHttpFetchImpl({ [`GET ${BASE}/users/1`]: jsonRoute({ id: 1 }) });
    const { summary } = await testAll({ ...base(), httpFetchImpl: fetchImpl });
    expect(summary.totals.total).toBe(1);
  });

  it('FAILs the negative case when the API returns success for a non-existent id', async () => {
    const { fetchImpl } = makeHttpFetchImpl({
      [`GET ${BASE}/users/1`]: jsonRoute({ id: 1 }),
      [`GET ${BASE}/users/2147483647`]: jsonRoute({ id: 2147483647 }), // 200, not 404!
    });
    const { summary } = await testAll({ ...base(), negativeTests: true, httpFetchImpl: fetchImpl });
    expect(summary.totals.failed).toBe(1);
    expect(summary.failures.some((g) => g.reason === 'STATUS_MISMATCH')).toBe(true);
  });
});
