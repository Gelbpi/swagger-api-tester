import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { startMockApi } from './mockApi.js';
import { testAll } from '../../src/engine/execution/testAll.js';
import { RunStore } from '../../src/engine/results/runStore.js';

let app: FastifyInstance;
let baseUrl: string;
let projectDir: string;
let dataDir: string;
let root: string;

beforeAll(async () => {
  ({ app, baseUrl } = await startMockApi());
  root = mkdtempSync(join(tmpdir(), 'apitester-taint-'));
  projectDir = join(root, 'proj');
  dataDir = join(root, 'data');
  mkdirSync(join(projectDir, '.api-tester'), { recursive: true });
  writeFileSync(
    join(projectDir, '.api-tester', 'config.json'),
    JSON.stringify({ baseUrl, openApiUrl: '/openapi.json', timeoutMs: 700, maxParallelRequests: 3 }),
  );
});
afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('test_all against a real (Fastify) API — MILESTONE 1 (bulk)', () => {
  it('runs the whole spec, continues past failures, and aggregates', async () => {
    const { summary, runId } = await testAll({ project: projectDir, dataDir });

    // /users/{id} PASS, /broken FAIL, /boom FAIL, /slow timeout FAIL, /payments INCONCLUSIVE.
    expect(summary.totals.total).toBe(5);
    expect(summary.totals.passed).toBeGreaterThanOrEqual(1);
    expect(summary.totals.failed).toBeGreaterThanOrEqual(2);
    expect(summary.inconclusive.some((g) => g.reason === 'BUSINESS_RULE_REJECTED')).toBe(true);

    const run = new RunStore(dataDir).getRun(runId);
    expect(run?.tests).toHaveLength(5);
  });
});
