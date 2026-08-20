import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { startMockApi } from './mockApi.js';
import { testEndpoint } from '../../src/engine/execution/testEndpoint.js';

let app: FastifyInstance;
let baseUrl: string;
let projectDir: string;
let dataDir: string;
let root: string;

beforeAll(async () => {
  ({ app, baseUrl } = await startMockApi());
  root = mkdtempSync(join(tmpdir(), 'apitester-int-'));
  projectDir = join(root, 'proj');
  dataDir = join(root, 'data');
  mkdirSync(join(projectDir, '.api-tester'), { recursive: true });
  writeFileSync(
    join(projectDir, '.api-tester', 'config.json'),
    JSON.stringify({ baseUrl, openApiUrl: '/openapi.json', timeoutMs: 600 }),
  );
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

const run = (method: string, path: string) => testEndpoint({ method, path, project: projectDir, dataDir });

describe('test_endpoint against a real (Fastify) API — MILESTONE 1', () => {
  it('PASS against a documented, valid endpoint', async () => {
    const { compact } = await run('GET', '/users/{id}');
    expect(compact.outcome).toBe('PASS');
    expect(compact.actualStatus).toBe(200);
  });

  it('FAIL/SCHEMA_VALIDATION_FAILED when the live body violates the schema', async () => {
    const { compact } = await run('GET', '/broken');
    expect(compact).toMatchObject({ outcome: 'FAIL', reason: 'SCHEMA_VALIDATION_FAILED' });
  });

  it('FAIL/SERVER_ERROR on a real 500', async () => {
    const { compact } = await run('GET', '/boom');
    expect(compact).toMatchObject({ outcome: 'FAIL', reason: 'SERVER_ERROR' });
  });

  it('FAIL/TIMEOUT_EXCEEDED on a slow endpoint', async () => {
    const { compact } = await run('GET', '/slow');
    expect(compact).toMatchObject({ outcome: 'FAIL', reason: 'TIMEOUT_EXCEEDED' });
  });

  it('INCONCLUSIVE/BUSINESS_RULE_REJECTED on a documented 422', async () => {
    const { compact } = await run('GET', '/payments');
    expect(compact).toMatchObject({ outcome: 'INCONCLUSIVE', reason: 'BUSINESS_RULE_REJECTED' });
  });
});
