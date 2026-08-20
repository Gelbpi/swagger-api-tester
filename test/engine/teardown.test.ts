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
    '/users': {
      post: {
        operationId: 'createUser',
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '201': { description: 'created' } },
      },
    },
    '/users/{id}': {
      delete: {
        operationId: 'deleteUser',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '204': { description: 'gone' } },
      },
    },
    '/logs': {
      post: {
        operationId: 'createLog',
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '201': { description: 'created' } },
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
  const root = mkdtempSync(join(tmpdir(), 'apitester-teardown-'));
  projectDir = join(root, 'proj');
  dataDir = join(root, 'data');
  mkdirSync(join(projectDir, '.api-tester'), { recursive: true });
  writeFileSync(join(projectDir, '.api-tester', 'config.json'), JSON.stringify({ baseUrl: BASE, openApiUrl: '/v3/api-docs' }));
});
afterAll(() => rmSync(join(projectDir, '..'), { recursive: true, force: true }));

describe('teardown (review item #11)', () => {
  it('deletes a resource the tester created, via the API DELETE endpoint', async () => {
    const { fetchImpl, calls } = makeHttpFetchImpl({
      [`POST ${BASE}/users`]: jsonRoute({ id: 5 }, 201),
      [`DELETE ${BASE}/users/5`]: { status: 204, body: '' },
    });
    const { summary } = await testAll({
      ...base(),
      mutations: true,
      teardown: true,
      exclude: ['* /logs'],
      httpFetchImpl: fetchImpl,
    });
    expect(summary.teardown).toEqual({ attempted: 1, deleted: 1, failed: 0 });
    expect(calls).toContain(`DELETE ${BASE}/users/5`); // used the id we created
  });

  it('does not run teardown when mutations are off (nothing was created)', async () => {
    const { fetchImpl } = makeHttpFetchImpl({});
    const { summary } = await testAll({ ...base(), teardown: true, httpFetchImpl: fetchImpl });
    expect(summary.teardown).toBeUndefined();
  });

  it('reports a failure when there is no DELETE endpoint to clean up with', async () => {
    const { fetchImpl } = makeHttpFetchImpl({ [`POST ${BASE}/logs`]: jsonRoute({ id: 9 }, 201) });
    const { summary } = await testAll({
      ...base(),
      mutations: true,
      teardown: true,
      include: ['POST /logs'],
      httpFetchImpl: fetchImpl,
    });
    expect(summary.teardown).toEqual({ attempted: 1, deleted: 0, failed: 1 });
  });
});
