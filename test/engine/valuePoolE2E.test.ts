import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testAll } from '../../src/engine/execution/testAll.js';
import { makeFetcher } from '../util/fakeFetcher.js';
import { makeHttpFetchImpl, jsonRoute } from '../util/fakeHttp.js';

const BASE = 'http://localhost:8080';
const now = () => 0;

// A resource with a FREE-FORM string id: /items/{id} where id is a plain string.
// FormatDefault cannot invent it -> NO_TEST_DATA, unless a real id is harvested
// from the /items collection first.
const spec = {
  openapi: '3.0.0',
  info: { title: 'T', version: '1.0.0' },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        responses: {
          '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } } } } },
        },
      },
    },
    '/items/{id}': {
      get: {
        operationId: 'getItem',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } } },
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
    maxParallelRequests: 1, // deterministic: producer runs before consumer
  };
}

const routes = {
  [`GET ${BASE}/items`]: jsonRoute([{ id: 'k1' }, { id: 'k2' }]),
  [`GET ${BASE}/items/k2`]: jsonRoute({ id: 'k2' }),
};

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'apitester-pool-'));
  projectDir = join(root, 'proj');
  dataDir = join(root, 'data');
  mkdirSync(join(projectDir, '.api-tester'), { recursive: true });
  writeFileSync(
    join(projectDir, '.api-tester', 'config.json'),
    JSON.stringify({ baseUrl: BASE, openApiUrl: '/v3/api-docs' }),
  );
});
afterAll(() => rmSync(join(projectDir, '..'), { recursive: true, force: true }));

describe('ValuePool end-to-end (build-prompt §35/§36) — closes NO_TEST_DATA', () => {
  it('a free-form {id} PASSes because the collection harvested a real id', async () => {
    const { fetchImpl } = makeHttpFetchImpl(routes);
    const { summary } = await testAll({ ...base(), httpFetchImpl: fetchImpl });
    expect(summary.totals).toMatchObject({ total: 2, passed: 2 });
    // No NO_TEST_DATA skip — the item endpoint was actually tested.
    const noData = summary.skipped.find((g) => g.reason === 'NO_TEST_DATA');
    expect(noData).toBeUndefined();
  });

  it('control: without the collection, the same {id} is NO_TEST_DATA', async () => {
    const { fetchImpl } = makeHttpFetchImpl(routes);
    // Exclude the producer -> the pool stays empty -> consumer cannot resolve id.
    const { summary } = await testAll({ ...base(), exclude: ['GET /items'], httpFetchImpl: fetchImpl });
    expect(summary.totals.total).toBe(1);
    expect(summary.skipped.some((g) => g.reason === 'NO_TEST_DATA')).toBe(true);
  });
});
