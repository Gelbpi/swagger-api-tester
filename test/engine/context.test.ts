import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareContext } from '../../src/engine/execution/context.js';
import { makeFetcher } from '../util/fakeFetcher.js';
import { jsonRoute } from '../util/fakeHttp.js';

const BASE = 'http://localhost:8080';
const spec = {
  openapi: '3.0.0',
  info: { title: 'T', version: '1.0.0' },
  paths: { '/ping': { get: { operationId: 'ping', responses: { '200': { description: 'ok' } } } } },
};

let emptyDir: string;
beforeAll(() => {
  emptyDir = mkdtempSync(join(tmpdir(), 'apitester-urlonly-'));
});
afterAll(() => rmSync(emptyDir, { recursive: true, force: true }));

describe('prepareContext URL-only mode (base_url in plugin settings)', () => {
  it('works with NO project when API_TESTER_BASE_URL is set', async () => {
    const specFetcher = makeFetcher({ [`${BASE}/v3/api-docs`]: jsonRoute(spec) }).fetcher;
    const ctx = await prepareContext({
      env: { API_TESTER_BASE_URL: BASE } as NodeJS.ProcessEnv,
      cwd: emptyDir, // no project markers here, so resolveProject fails -> URL-only
      specFetcher,
      now: () => 0,
    });
    expect(ctx.projectDir).toBeUndefined();
    expect(ctx.baseUrl).toBe(BASE);
    expect(ctx.registry.get('GET', '/ping')).toBeDefined();
  });

  it('errors with an actionable message when nothing provides a base URL', async () => {
    await expect(
      prepareContext({ env: {} as NodeJS.ProcessEnv, cwd: emptyDir, now: () => 0 }),
    ).rejects.toMatchObject({ reason: 'CONFIG_NOT_FOUND' });
  });
});
